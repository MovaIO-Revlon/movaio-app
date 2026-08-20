from typing import Any
import logging
from flask import Request, Response, g, json
from typing import Literal

logger = logging.getLogger("app_logger")

SENSITIVE_KEYS = {
    "password",
    "pass",
    "pwd",
    "token",
    "cookie",
    "session",
    "secret",
    "api_key",
    "avatar",
}

REDACTED = "***"

ALLOWED_HEADERS = {"content-type", "user-agent", "accept"}

MAX_STR_LEN = 120
MAX_ITEMS = 10
MAX_LIST_ITEMS = 5
MAX_DEPTH = 3


def sanitize(obj: dict):
    if isinstance(obj, dict):
        return {
            k: (REDACTED if k.lower() in SENSITIVE_KEYS else sanitize(v))
            for k, v in obj.items()
        }
    
    if isinstance(obj, list):
        return [sanitize(i) for i in obj]
    
    if isinstance(obj, str) and obj.lower() in SENSITIVE_KEYS:
        return REDACTED

    return obj


def sanitize_headers(headers: dict):
    return {k: v for k, v in headers.items() if k.lower() in ALLOWED_HEADERS}


def to_log_string(value) -> str:
    if value is None:
        return "null"

    if isinstance(value, (dict, list, tuple, set)):
        return json.dumps(value, ensure_ascii=False, default=str)

    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")

    return str(value)


def truncate_for_log(obj: Any, *, depth: int = 0) -> Any:
    if depth > MAX_DEPTH:
        return "...[max_depth reached]"

    if obj is None:
        return None

    if isinstance(obj, str):
        if len(obj) <= MAX_STR_LEN:
            return obj
        return obj[:MAX_STR_LEN] + "...[truncated]"

    if isinstance(obj, (int, float, bool)):
        return obj

    if isinstance(obj, (list, tuple)):
        truncated = [
            truncate_for_log(item, depth=depth + 1) for item in obj[:MAX_LIST_ITEMS]
        ]

        if len(obj) > MAX_LIST_ITEMS:
            truncated.append(f"...[{len(obj) - MAX_LIST_ITEMS} more items]")
        return truncated

    if isinstance(obj, dict):
        result = {}
        items = list(obj.items())
        for k, v in items[:MAX_ITEMS]:
            result[str(k)] = truncate_for_log(v, depth=depth + 1)
        if len(items) > MAX_ITEMS:
            result["..."] = f"{len(items) - MAX_ITEMS} more keys"
        return result

    return str(obj)


def parse_request(req: Request) -> list[str]:
    method = to_log_string(req.method)
    path = to_log_string(req.path)
    query_params = to_log_string(req.args.to_dict())
    request_id = to_log_string(req.headers.get("X-Request-Id", "-"))
    source = to_log_string(req.headers.get("X-Source", "-"))

    xfwd = req.headers.get("X-Forwarded-For", "")
    ip = xfwd.split(',')[0].strip() if xfwd else req.remote_addr
    ip = to_log_string(ip)

    user = to_log_string(g.active_user)

    headers = to_log_string(sanitize_headers(req.headers))

    body = truncate_for_log(req.get_json(silent=True) or {})
    body = to_log_string(sanitize(body))

    return [
        "rtype=request",
        f"request_id={request_id}",
        f"project={g.active_project}",
        f"source={source}",
        f"method={method}",
        f"path={path}",
        f"query={query_params}",
        f"ip={ip}",
        f"user={user}",
        f"headers={headers}",
        f"body={body}",
    ]


def parse_response(res: Response, status: int) -> list[str]:
    request_id = to_log_string(res.headers.get("X-Request-Id", "-"))
    headers = to_log_string(sanitize_headers(res.headers))

    body = res.get_json(silent=True) or {}
    desc = to_log_string(body.get("message"))
    body = truncate_for_log(body)
    body = to_log_string(sanitize(body))

    return [
        "rtype=response",
        f"request_id={request_id}",
        f"project={g.active_project}",
        f"status={status}",
        f"desc={desc}",
        f"headers={headers}",
        f"body={body}",
    ]

def parse_file(res: Response, status: int) -> list[str]:
    request_id = to_log_string(res.headers.get("X-Request-Id", "-"))
    headers = to_log_string(sanitize_headers(res.headers))

    body = to_log_string({"file": "unknown"})
    desc = "File downloaded"

    filename = ""

    disposition = res.headers.get("Content-Disposition")
    if disposition:
        filename = disposition.split("filename=")[1]

    if filename:
        desc = desc + f": {filename}"
        body = to_log_string({"file": filename})

    return [
        "rtype=response",
        f"request_id={request_id}",
        f"project={g.active_project}",
        f"status={status}",
        f"desc={desc}",
        f"headers={headers}",
        f"body={body}",
    ]

def log_data(request_id: str, message: str, data = None, type: Literal['info', 'error', 'warning', 'debug'] = 'info', status: int = None) -> list[str]:
    desc = to_log_string(message)
    body = truncate_for_log(data)
    body = to_log_string(sanitize(body))
    
    # Try to get the project from Flask's g object, but handle the case
    # where we're outside the application context
    try:
        project = g.active_project
    except (RuntimeError, AttributeError):
        # We're outside the application context, use a default value
        project = "App Engineering"
    
    log_str = " | ".join([
        "rtype=event",
        f"request_id={request_id}",
        f"project={project}",
        f"desc={desc}",
        f"body={body}",
        f"status={status}",
    ])

    if type == 'info':
        logger.info(log_str)
    elif type == 'error':
        logger.error(log_str)
    elif type == 'warning':
        logger.warning(log_str)
    elif type == 'debug':
        logger.debug(log_str)
    
    return log_str