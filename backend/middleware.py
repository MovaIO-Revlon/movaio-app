# middleware.py
import glob
import logging
import os
import shutil
import threading
import time
from datetime import datetime
from queue import Queue
from logging.handlers import QueueHandler, QueueListener, TimedRotatingFileHandler

from session_manager import session, session_manager
import schedule
from flask import g, request, Response
import atexit
from utils import (
    ApiError,
    handle_api_error,
    handle_exception,
    parse_request,
    parse_response,
    # parse_file,
    AuthorizationError
)

# Ensure logs dir exists
LOG_DIR = "logs"
ARCHIVE_DIR = "logs_archive"
os.makedirs(LOG_DIR, exist_ok=True)
os.makedirs(ARCHIVE_DIR, exist_ok=True)

# Global logger
logger = logging.getLogger("app_logger")
logger.setLevel(logging.INFO)

if logger.hasHandlers():
    logger.handlers.clear()

formatter = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")
formatter.converter = time.gmtime


# --- Function to archive old logs ---
def archive_old_logs():
    try:
        log_files = glob.glob(os.path.join(LOG_DIR, "*.log*"))
        now = time.time()
        fifteen_days_ago = now - (15 * 24 * 60 * 60)
        for log_file in log_files:
            if os.path.getmtime(log_file) < fifteen_days_ago:
                file_date = datetime.fromtimestamp(os.path.getmtime(log_file)).strftime(
                    "%Y-%m"
                )

                archive_month_dir = os.path.join(ARCHIVE_DIR, file_date)
                os.makedirs(archive_month_dir, exist_ok=True)

                archive_path = os.path.join(
                    archive_month_dir, os.path.basename(log_file)
                )

                shutil.move(log_file, archive_path)

    except Exception as e:
        logger.error(f"Archive error: {str(e)}", exc_info=True)


def run_scheduler():
    """Run the scheduler in a separate thread"""
    while True:
        schedule.run_pending()
        time.sleep(3600)


schedule.every().day.at("12:00").do(archive_old_logs)
threading.Thread(target=run_scheduler, daemon=True).start()


class CustomRotatingFileHandler(TimedRotatingFileHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.namer = self.custom_namer

    def custom_namer(self, default_name: str):
        base_dir, file_part = os.path.split(default_name)

        if ".log" in file_part:
            name_root, timestamp = file_part.split(".log", 1)

            raw_ts = timestamp.lstrip(".")
            date_part = raw_ts.split("_")[0]

            try:
                yyyy, mm, dd = date_part.split("-")
                new_name = f"{name_root}-{dd}-{mm}-{yyyy}.log"
                return os.path.join(base_dir, new_name)
            except ValueError:
                return default_name

        return default_name


class ProjectAwareTimedRotatingFileHandler(logging.Handler):
    def __init__(self, log_dir, backup_count=7):
        super().__init__()
        self.log_dir = log_dir
        self.backup_count = backup_count
        self._handlers = {}
        self._lock = threading.Lock()

    def emit(self, record):
        try:
            msg = record.getMessage()
            if msg and "project=" in msg:
                prj_name = msg.split("project=")[1].split("|")[0].strip()
            else:
                prj_name = "App Engineering"

            handler = self._handlers.get(prj_name)

            if handler is None:
                with self._lock:
                    handler = self._handlers.get(prj_name)
                    if handler is None:
                        log_file = os.path.join(self.log_dir, f"{prj_name}.log")

                        handler = CustomRotatingFileHandler(
                            log_file,
                            when="midnight",
                            interval=1,
                            backupCount=self.backup_count,
                            encoding="utf-8",
                            utc=True,
                        )

                        handler.setFormatter(formatter)
                        self._handlers[prj_name] = handler

            handler.emit(record)
        except Exception as e:
            print("LOGGING FAILURE:", e)


log_queue = Queue(maxsize=10000)

queue_handler = QueueHandler(log_queue)
logger.addHandler(queue_handler)

dynamic_file_handler = ProjectAwareTimedRotatingFileHandler(LOG_DIR)

queue_listener = QueueListener(
    log_queue, dynamic_file_handler, respect_handler_level=True
)

queue_listener.start()


def shutdown_logging():
    print("STOPPING LOG QUEUE:")
    queue_listener.stop()


atexit.register(shutdown_logging)


# --- Session helper (as provided) ---
def get_current_user():
    """Get current user from session"""
    token = session_manager.extract_token()
    if not token:
        return None

    try:
        return session_manager.validate_token(token)
    except AuthorizationError:
        return None


EXCLUDE_METHODS = ["OPTIONS"]


# --- Middleware ---
def setup_middlewares(flask_app_obj):
    app = flask_app_obj.app

    @app.before_request
    def set_active_project():
        if request.method in EXCLUDE_METHODS:
            return
        current_user = get_current_user()

        prj_name = (
            current_user.get("ActiveProject", "App Engineering")
            if current_user
            else "App Engineering"
        )
        g.active_project = prj_name  # Store for logging handler
        g.active_user = (
            current_user.get("user_id", request.remote_addr)
            if current_user
            else request.remote_addr or "anonyms"
        )
    
    # start - API key policy (UI optional / Postman mandatory via X-Client)
    # @app.before_request
    # def enforce_api_key_policy():
    #     if request.method in EXCLUDE_METHODS:
    #         return

    #     from api_key_auth import (
    #         path_is_external_category,
    #         validate_api_key,
    #         resolve_category_from_path,
    #     )

    #     route_rule = getattr(request, "url_rule", None)
    #     path = route_rule.rule if route_rule else (request.path or "")

    #     if not path_is_external_category(path):
    #         return  # not external-category → leave alone (login, health, etc.)

    #     api_key = (
    #         request.headers.get("X-API-Key")
    #         or request.headers.get("x-api-key")
    #     )

    #     # Do NOT force a key when absent — login + token-only keep working
    #     if not api_key:
    #         g.api_key_context = None
    #         return

    #     # Key present → validate + allowed_apis
    #     from commonutils import DatabaseCollections
    #     coll = DatabaseCollections().external_applications_collection

    #     ctx = validate_api_key(api_key, coll)
    #     g.api_key_context = ctx

    #     category = resolve_category_from_path(path)
    #     if category and category not in ctx["allowed_apis"]:
    #         raise AuthorizationError(
    #             f"API key not allowed for '{category}'. "
    #             f"Allowed: {ctx['allowed_apis']}"
    #         )

    # end

    @app.before_request
    def log_request():
        if request.method in EXCLUDE_METHODS:
            return
        logger.info(" | ".join(parse_request(request)))

    @app.after_request
    def log_response(response: Response):
        if request.method in EXCLUDE_METHODS:
            return response

        # Get request_id from response headers (set by endpoint), fallback to request headers
        request_id = response.headers.get("X-Request-Id") or request.headers.get("X-Request-Id", "")
        response.headers.set("X-Request-Id", request_id)

        if response.direct_passthrough:
            # logger.info(" | ".join(parse_file(response, response.status_code)))
            return response

        # Skip logging if an exception was already logged by the error handler
        if getattr(g, "exception_logged", False):
            return response

        logger.info(" | ".join(parse_response(response, 200)))

        return response

    @app.errorhandler(ApiError)
    def handle_error(e: ApiError):
        if request.method in EXCLUDE_METHODS:
            return e

        response = handle_api_error(e)

        response[0].headers.set("X-Request-Id", request.headers.get("X-Request-Id", ""))
        logger.info(" | ".join(parse_response(response[0], response[1])))

        g.exception_logged = True
        return response

    @app.errorhandler(Exception)
    def handle_api_exception(e):
        if request.method in EXCLUDE_METHODS:
            return e

        response = handle_exception(app, e)

        response[0].headers.set("X-Request-Id", request.headers.get("X-Request-Id", ""))
        logger.error(" | ".join(parse_response(response[0], response[1])))

        g.exception_logged = True
        return response
