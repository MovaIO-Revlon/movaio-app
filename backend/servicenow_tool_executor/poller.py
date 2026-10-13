"""
poller.py - asynchronously watches a folder (path read from iconfig.ini) for ticket-request
JSON files and creates / updates ServiceNow tickets via the existing app.execute_tool().

Guarantees (the "never skip a file" design)
-------------------------------------------
* Discovery is by periodic directory scan, not by filesystem events, so nothing can be missed.
* A file is only *claimed* (atomically renamed into the processing folder) by a worker at the
  moment it starts work. Everything still waiting in the queue is simply a file sitting in the
  watch folder, so a crash/stop loses nothing.
* Files still being written/copied are not touched: they must be stable (size+mtime unchanged
  across two scans, older than settle_seconds, and openable) before being queued. They are
  retried every scan until they are ready - never dropped.
* Every file ends up in _processed/ or _failed/ with a <name>.result.json describing each
  ticket. Unreadable / invalid JSON goes to _failed/ too; nothing is ever deleted.
* Per-file journal (<claimed>.state.json): after each ticket the outcome is saved. If the
  poller is killed mid-file, the next start resumes that file and does NOT re-run tickets that
  already finished. A *create* that was in flight at the moment of the crash is marked
  "uncertain" (it may or may not exist in ServiceNow) instead of being blindly re-sent, so no
  duplicate tickets. Updates are idempotent and are simply re-run.
* Same-filename drops are fine: each claim gets a unique timestamp+uuid name.
* A lock file stops two poller processes from watching the same folder.

Usage
-----
    python poller.py                       # uses iconfig.ini next to this script
    python poller.py --config D:\\path\\iconfig.ini
    python poller.py --once                # process whatever is there now, then exit

Tip for producers: write to "name.tmp" and rename to "name.json" when done - then the file
appears atomically. (Plain copies work too thanks to the stability check.)
"""

import argparse
import asyncio
import configparser
import json
import logging
import os
import re
import shutil
import signal
import sys
import threading
import time
import uuid
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Optional
from tool_auth import ToolAuthService # noqa: E402  (existing ServiceNow entry point)

# ToolAuthService reads "tool_config/..." relative to the CWD, so always run from this folder.
BASE_DIR = Path(__file__).resolve().parent
#os.chdir(BASE_DIR)
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

logger = logging.getLogger("servicenow_poller")

FUNCTIONS_FILE = Path("tool_config") / "ServiceNow" / "function.json"
SERVICENOW_CONNECTION_ID = "poller-servicenow"  # any truthy value; creds are resolved in tool_auth
POLLER_USER_ID = "mohamed.luthufullah@revlon.com"

# (ticket_type, action) -> tool name defined in tool_config/ServiceNow/function.json
TOOL_MAP = {
    ("incident", "create"): "SERVICENOW__CREATE_INCIDENT",
    ("incident", "update"): "SERVICENOW__UPDATE_INCIDENT",
    ("change_request", "create"): "SERVICENOW__CREATE_CHANGE_REQUEST",
}

# Errors worth retrying. Creates are only retried when the request provably never left the
# machine (connection could not be established) so a retry cannot create a duplicate.
TRANSIENT_RE = re.compile(
    r"timed out|timeout|\b429\b|\b50[234]\b|Service Unavailable|Bad Gateway|Gateway Time-out|"
    r"Connection aborted|Connection reset|ConnectionError|Failed to establish|Max retries exceeded",
    re.I,
)
NEVER_SENT_RE = re.compile(
    r"Failed to establish|NewConnectionError|Name or service not known|getaddrinfo failed|"
    r"ConnectTimeout|Connection to .* timed out",
    re.I,
)


# --------------------------------------------------------------------------- #
# Configuration (iconfig.ini)
# --------------------------------------------------------------------------- #
@dataclass
class Settings:
    watch_dir: Path
    processing_dir: Path
    processed_dir: Path
    failed_dir: Path
    poll_interval: float
    settle_seconds: float
    max_workers: int
    file_pattern: str
    max_retries: int
    retry_backoff: float
    log_file: Optional[Path]
    log_level: str


def load_settings(cfg_path: Path) -> Settings:
    cp = configparser.ConfigParser()
    if not cp.read(cfg_path, encoding="utf-8-sig"):
        raise SystemExit(f"Config file not found or unreadable: {cfg_path}")
    if "poller" not in cp or not cp["poller"].get("watch_dir", "").strip():
        raise SystemExit(f"[poller] watch_dir is required in {cfg_path}")
    s = cp["poller"]

    def as_path(value: str) -> Path:
        p = Path(value.strip().strip('"').strip("'")).expanduser()
        return p if p.is_absolute() else (cfg_path.parent / p).resolve()

    watch = as_path(s["watch_dir"])
    log_value = cp.get("logging", "log_file", fallback="").strip()
    return Settings(
        watch_dir=watch,
        processing_dir=as_path(s["processing_dir"]) if s.get("processing_dir") else watch / "_processing",
        processed_dir=as_path(s["processed_dir"]) if s.get("processed_dir") else watch / "_processed",
        failed_dir=as_path(s["failed_dir"]) if s.get("failed_dir") else watch / "_failed",
        poll_interval=s.getfloat("poll_interval_seconds", fallback=5),
        settle_seconds=s.getfloat("settle_seconds", fallback=3),
        max_workers=max(1, s.getint("max_workers", fallback=4)),
        file_pattern=s.get("file_pattern", "*.json").strip(),
        max_retries=max(0, s.getint("max_retries", fallback=3)),
        retry_backoff=s.getfloat("retry_backoff_seconds", fallback=2),
        log_file=as_path(log_value) if log_value else None,
        log_level=cp.get("logging", "level", fallback="INFO").upper(),
    )


def setup_logging(cfg: Settings) -> None:
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s [%(threadName)s] %(message)s")
    root = logging.getLogger()
    root.setLevel(cfg.log_level)
    console = logging.StreamHandler()
    console.setFormatter(fmt)
    root.addHandler(console)
    if cfg.log_file:
        cfg.log_file.parent.mkdir(parents=True, exist_ok=True)
        fh = RotatingFileHandler(cfg.log_file, maxBytes=5_000_000, backupCount=5, encoding="utf-8")
        fh.setFormatter(fmt)
        root.addHandler(fh)


def acquire_single_instance_lock(lock_path: Path):
    """OS-level exclusive lock; released automatically if the process dies."""
    fh = open(lock_path, "a+")
    try:
        fh.seek(0)
        if os.name == "nt":
            import msvcrt

            if not fh.read(1):
                fh.write(" ")
                fh.flush()
            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        raise SystemExit(f"Another poller instance is already watching this folder (lock: {lock_path})")
    return fh  # keep a reference for the life of the process


# --------------------------------------------------------------------------- #
# Calling ServiceNow (blocking; runs inside worker threads)
# --------------------------------------------------------------------------- #
def load_raw_tools_docs() -> list[dict]:
    with open(FUNCTIONS_FILE, "r", encoding="utf-8") as f:
        functions = json.load(f)["functions"]
    return [
        {
            "connection_id": SERVICENOW_CONNECTION_ID,
            "connector_type": "ServiceNow",
            "tool_action_name": fn["name"],
            "tool_key": {"security_schemes": {}, "functions": [fn]},
        }
        for fn in functions
    ]


class Ctx:
    """Shared, read-mostly state handed to worker threads."""

    def __init__(self, cfg: Settings):
        self.cfg = cfg
        self.tools_docs = load_raw_tools_docs()
        self._key_locks: dict[str, threading.Lock] = defaultdict(threading.Lock)
        self._guard = threading.Lock()

    def key_lock(self, key: str) -> threading.Lock:
        # Serialises concurrent updates to the same incident coming from different files.
        with self._guard:
            return self._key_locks[key]


def _call_once(tool_name: str, args: dict, raw_tools_docs: list[dict], ctx: Ctx) -> tuple[bool, Any, Optional[str]]:
    
    auth_service = ToolAuthService()
    
    print(f"Calling tool: {tool_name} with args: {args} and ctx: {ctx} and POLLER_USER_ID: {POLLER_USER_ID}")
    
    raw = auth_service._execute_tool(tool_name, args, raw_tools_docs, POLLER_USER_ID)
    if not isinstance(raw, str):
        return True, raw, None
    try:
        parsed = json.loads(raw)
    except ValueError:
        return False, None, raw  # "Tool not configured" / "Execution Error ..." plain strings
    if isinstance(parsed, dict) and "error" in parsed:
        return False, parsed, parsed.get("message") or parsed["error"]
    return True, parsed, None


def call_tool(tool_name: str, args: dict, raw_tools_docs: list[dict], ctx: Ctx, is_create: bool) -> tuple[bool, Any, Optional[str]]:
    retry_re = NEVER_SENT_RE if is_create else TRANSIENT_RE
    attempt = 0
    while True:
        ok, body, err = _call_once(tool_name, args, raw_tools_docs, ctx)
        if ok or attempt >= ctx.cfg.max_retries or not (err and retry_re.search(err)):
            return ok, body, err
        delay = ctx.cfg.retry_backoff * (2 ** attempt)
        attempt += 1
        logger.warning("%s transient error (%s); retry %d/%d in %.1fs", tool_name, err[:120], attempt, ctx.cfg.max_retries, delay)
        time.sleep(delay)


def resolve_sys_id(number: str, ctx: Ctx) -> tuple[Optional[str], Optional[str]]:
    ok, body, err = call_tool(
        "SERVICENOW__LIST_INCIDENTS",
        {"query": {"sysparm_query": f"number={number}", "sysparm_fields": "sys_id,number", "sysparm_limit": 1}},
        ctx.tools_docs,
        ctx,
        is_create=False,
    )
    if not ok:
        return None, err
    results = (body or {}).get("result", [])
    if not results:
        return None, f"Incident {number} not found"
    return results[0]["sys_id"], None


# --------------------------------------------------------------------------- #
# Per-ticket processing
# --------------------------------------------------------------------------- #
def _validate_and_build(ticket: dict) -> tuple[Optional[str], Optional[dict], Optional[str], str, str, list[dict]]:
    """Returns (tool_name, base_args, error, ticket_type, action)."""
    ticket_type = str(ticket.get("ticket_type", "incident")).lower()
    action = str(ticket.get("action", "")).lower()
    tool_name = TOOL_MAP.get((ticket_type, action))
    raw_tools_docs = list(ticket.get("raw_tools_docs", [])) if isinstance(ticket.get("raw_tools_docs"), list) else []
    
    if not tool_name:
        supported = ", ".join(f"{t}/{a}" for t, a in TOOL_MAP)
        return None, None, f"Unsupported ticket_type/action. Supported: {supported}", ticket_type, action, raw_tools_docs
    fields = ticket.get("fields")
    if not isinstance(fields, dict) or not fields:
        return None, None, "'fields' must be a non-empty object", ticket_type, action, raw_tools_docs

    if action == "create":
        fields = dict(fields)
        if ticket_type == "incident":
            if not fields.get("short_description") and fields.get("description"):
                fields["short_description"] = str(fields["description"])[:100]
            fields.setdefault("urgency", "3")
            fields.setdefault("impact", fields["urgency"])
            required = ("short_description", "caller_id")
        else:
            required = ("short_description",)
        missing = [k for k in required if not fields.get(k)]
        if missing:
            return None, None, f"Missing required fields: {missing}", ticket_type, action, raw_tools_docs
        return tool_name, {"body": fields}, None, ticket_type, action, raw_tools_docs

    if not ticket.get("sys_id") and not ticket.get("number"):
        return None, None, "Update needs 'number' (e.g. INC0440648) or 'sys_id'", ticket_type, action, raw_tools_docs
    return tool_name, {"body": fields}, None, ticket_type, action, raw_tools_docs


def process_ticket(ticket: Any, ctx: Ctx) -> dict:
    print(f"Processing ticket: {ticket}")
    if not isinstance(ticket, dict):
        return {"status": "failed", "error": "Ticket entry must be a JSON object"}
    tool_name, args, error, ticket_type, action, raw_tools_docs = _validate_and_build(ticket)
    out = {"ticket_type": ticket_type, "action": action, "client_ref": ticket.get("client_ref")}
    if error:
        return {**out, "status": "failed", "error": error}

    if action == "create":
        ok, body, err = call_tool(tool_name, args, raw_tools_docs,ctx, is_create=True)
        sys_id = None
    else:
        lock_key = f"{ticket_type}:{ticket.get('number') or ticket.get('sys_id')}"
        with ctx.key_lock(lock_key):
            sys_id = ticket.get("sys_id")
            if not sys_id:
                sys_id, err = resolve_sys_id(ticket["number"], ctx)
                if not sys_id:
                    return {**out, "number": ticket.get("number"), "status": "failed", "error": err}
            args = {"sys_id": sys_id, **args}
            ok, body, err = call_tool(tool_name, args, raw_tools_docs, ctx, is_create=False)

    if not ok:
        return {**out, "status": "failed", "error": err}
    record = (body or {}).get("result", {}) if isinstance(body, dict) else {}
    if not isinstance(record, dict):
        record = {}
    return {
        **out,
        "status": "success",
        "number": record.get("number") or ticket.get("number"),
        "sys_id": record.get("sys_id") or sys_id,
    }


# --------------------------------------------------------------------------- #
# File handling (blocking; runs inside worker threads)
# --------------------------------------------------------------------------- #
def _atomic_write_json(path: Path, data: Any) -> None:
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def _load_state(state_path: Path) -> dict:
    try:
        with open(state_path, "r", encoding="utf-8") as f:
            st = json.load(f)
        st.setdefault("results", {})
        st.setdefault("in_flight", None)
        return st
    except (FileNotFoundError, ValueError):
        return {"results": {}, "in_flight": None}


def process_claimed(claimed: Path, ctx: Ctx) -> None:
    cfg = ctx.cfg
    state_path = claimed.with_name(claimed.name + ".state.json")
    state = _load_state(state_path)
    interrupted = state["in_flight"]  # non-None only when resuming after a crash
    started = time.time()

    result: dict[str, Any] = {"file": claimed.name, "processed_at": datetime.now().isoformat(timespec="seconds")}
    try:
        with open(claimed, "r", encoding="utf-8-sig") as f:
            payload = json.load(f)
        tickets = payload["tickets"] if isinstance(payload, dict) and "tickets" in payload else [payload]
        if not isinstance(tickets, list) or not tickets:
            raise ValueError("'tickets' must be a non-empty list")
        result["request_id"] = payload.get("request_id") if isinstance(payload, dict) else None

        for i, ticket in enumerate(tickets):
            key = str(i)
            if key in state["results"]:
                continue  # finished before a crash/restart
            if interrupted == key and isinstance(ticket, dict) and str(ticket.get("action", "")).lower() == "create":
                state["results"][key] = {
                    "ticket_type": str(ticket.get("ticket_type", "incident")).lower(),
                    "action": "create",
                    "client_ref": ticket.get("client_ref"),
                    "status": "uncertain",
                    "error": "Poller stopped while this create was in flight; it may already exist in "
                             "ServiceNow. Verify before resubmitting.",
                }
            else:
                state["in_flight"] = key
                _atomic_write_json(state_path, state)
                state["results"][key] = process_ticket(ticket, ctx)
            state["in_flight"] = None
            _atomic_write_json(state_path, state)

        result["results"] = [state["results"][str(i)] for i in range(len(tickets))]
        all_ok = all(r["status"] == "success" for r in result["results"])
    except Exception as exc:  # bad JSON, wrong shape, unexpected crash
        logger.exception("Could not process %s", claimed.name)
        result["results"] = [state["results"][k] for k in sorted(state["results"], key=int)]
        result["error"] = f"{type(exc).__name__}: {exc}"
        all_ok = False

    dest = cfg.processed_dir if all_ok else cfg.failed_dir
    _atomic_write_json(dest / f"{claimed.name}.result.json", result)  # result first ...
    shutil.move(str(claimed), str(dest / claimed.name))              # ... then the original
    try:
        state_path.unlink()
    except FileNotFoundError:
        pass
    counts = {s: sum(1 for r in result["results"] if r["status"] == s) for s in ("success", "failed", "uncertain")}
    logger.info("%s -> %s/ in %.1fs %s", claimed.name, dest.name, time.time() - started, counts)


def handle_item(path: Path, sig: Optional[tuple], ctx: Ctx) -> None:
    """sig is None for files already sitting in the processing folder (crash recovery)."""
    if sig is not None:
        try:
            st = path.stat()
            if (st.st_size, st.st_mtime_ns) != sig:
                logger.info("%s changed while queued; it will be re-evaluated", path.name)
                return
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            claimed = ctx.cfg.processing_dir / f"{stamp}_{uuid.uuid4().hex[:8]}_{path.name}"
            os.rename(path, claimed)  # atomic claim; fails if the file vanished/locked
        except FileNotFoundError:
            return  # already taken/removed
        except OSError as exc:
            logger.warning("Cannot claim %s yet (%s); will retry on next scan", path.name, exc)
            return
        logger.info("Claimed %s", path.name)
    else:
        claimed = path
        logger.info("Resuming interrupted file %s", path.name)

    try:
        process_claimed(claimed, ctx)
    except Exception:
        # Last resort: never leave a file unaccounted for. If even this fails the file stays in
        # the processing folder and is resumed on the next start.
        logger.exception("Unexpected failure on %s", claimed.name)
        try:
            _atomic_write_json(ctx.cfg.failed_dir / f"{claimed.name}.result.json",
                               {"file": claimed.name, "error": "Unexpected internal error, see log"})
            shutil.move(str(claimed), str(ctx.cfg.failed_dir / claimed.name))
        except Exception:
            logger.critical("Could not move %s to failed/; it will be resumed on restart", claimed.name)


# --------------------------------------------------------------------------- #
# Scanning
# --------------------------------------------------------------------------- #
def scan_ready(cfg: Settings, seen: dict, pending: frozenset, require_stable: bool) -> list[tuple[Path, tuple]]:
    """Return files that are complete and ready, oldest first. Anything not ready stays put."""
    ready = []
    present = set()
    now = time.time()
    for p in cfg.watch_dir.glob(cfg.file_pattern):
        try:
            if not p.is_file():
                continue
            present.add(p)
            if p in pending:
                continue
            st = p.stat()
            sig = (st.st_size, st.st_mtime_ns)
            stable = (seen.get(p) == sig) or not require_stable
            if stable and now - st.st_mtime >= cfg.settle_seconds:
                with open(p, "rb"):  # fails with PermissionError while another process holds it
                    pass
                print(f"READY FILE FOUND: {p}")
                logger.info("READY FILE FOUND: %s", p)
                ready.append((st.st_mtime_ns, p.name, p, sig))
            else:
                seen[p] = sig
        except OSError as exc:
            logger.debug("%s not ready (%s); retrying next scan", p.name, exc)
    for k in [k for k in seen if k not in present]:
        del seen[k]
    ready.sort(key=lambda r: (r[0], r[1]))
    return [(p, sig) for _, _, p, sig in ready]


# --------------------------------------------------------------------------- #
# Async orchestration
# --------------------------------------------------------------------------- #
async def scanner(cfg, ctx, queue, pending, stop, scan_pool, once):
    loop = asyncio.get_running_loop()
    seen: dict = {}
    while not stop.is_set():
        try:
            ready = await loop.run_in_executor(scan_pool, scan_ready, cfg, seen, frozenset(pending), not once)
            for path, sig in ready:
                pending.add(path)
                queue.put_nowait((path, sig))
            if ready:
                logger.info("Queued %d file(s); queue depth now %d", len(ready), queue.qsize())
        except Exception:
            logger.exception("Scan failed (share unavailable?); will retry")
        if once:
            return
        try:
            await asyncio.wait_for(stop.wait(), timeout=cfg.poll_interval)
        except asyncio.TimeoutError:
            pass


async def worker(queue, pending, ctx):
    loop = asyncio.get_running_loop()
    while True:
        item = await queue.get()
        try:
            if item is None:
                return
            path, sig = item
            try:
                await loop.run_in_executor(None, handle_item, path, sig, ctx)
            except Exception:
                logger.exception("Worker error on %s", path)
            finally:
                pending.discard(path)
        finally:
            queue.task_done()


async def run(cfg: Settings, once: bool) -> None:
    loop = asyncio.get_running_loop()
    stop = asyncio.Event()

    def _request_stop(*_):
        loop.call_soon_threadsafe(stop.set)

    # for sig_name in ("SIGINT", "SIGTERM", "SIGBREAK"):
    #     if hasattr(signal, sig_name):
    #         signal.signal(getattr(signal, sig_name), _request_stop)
    
    if threading.current_thread() is threading.main_thread():
        for sig_name in ("SIGINT", "SIGTERM", "SIGBREAK"):
            if hasattr(signal, sig_name):
                signal.signal(getattr(signal, sig_name), _request_stop)

    loop.set_default_executor(ThreadPoolExecutor(max_workers=cfg.max_workers, thread_name_prefix="worker"))
    scan_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="scanner")
    ctx = Ctx(cfg)
    queue: asyncio.Queue = asyncio.Queue()
    pending: set = set()

    # Resume anything a previous run left half-done, before looking at new files.
    leftovers = sorted(p for p in cfg.processing_dir.iterdir() if p.is_file() and not p.name.startswith(".") and not p.name.endswith((".state.json", ".tmp")))
    for p in leftovers:
        queue.put_nowait((p, None))
    if leftovers:
        logger.warning("Recovering %d file(s) left in %s by a previous run", len(leftovers), cfg.processing_dir)

    workers = [asyncio.create_task(worker(queue, pending, ctx)) for _ in range(cfg.max_workers)]
    logger.info("Watching %s every %ss with %d worker(s)", cfg.watch_dir, cfg.poll_interval, cfg.max_workers)

    scan_task = asyncio.create_task(scanner(cfg, ctx, queue, pending, stop, scan_pool, once))
    if once:
        await scan_task
        await queue.join()
    else:
        await stop.wait()
        logger.info("Stop requested: finishing files already in progress ...")
        await scan_task
        left = 0
        while not queue.empty():  # not yet claimed => still safely in the watch folder
            queue.get_nowait()
            queue.task_done()
            left += 1
        if left:
            logger.info("%d queued file(s) left untouched in the watch folder; next start will pick them up", left)
    for _ in workers:
        queue.put_nowait(None)
    await asyncio.gather(*workers)
    scan_pool.shutdown(wait=False)
    logger.info("Poller stopped cleanly")


def main() -> None:
    ap = argparse.ArgumentParser(description="Poll a folder for ServiceNow ticket JSON files")
    ap.add_argument("--config", default=str(BASE_DIR / "iconfig.ini"), help="path to iconfig.ini")
    ap.add_argument("--once", action="store_true", help="process the files currently present, then exit")
    args = ap.parse_args()

    cfg = load_settings(Path(args.config).resolve())
    
    print("=" * 80)
    print("WATCH DIR     :", cfg.watch_dir)
    print("PROCESSING DIR:", cfg.processing_dir)
    print("PROCESSED DIR :", cfg.processed_dir)
    print("FAILED DIR    :", cfg.failed_dir)
    print("LOG FILE      :", cfg.log_file)
    print("=" * 80)

    logger.info("WATCH DIR     : %s", cfg.watch_dir)
    logger.info("PROCESSING DIR: %s", cfg.processing_dir)
    logger.info("PROCESSED DIR : %s", cfg.processed_dir)
    logger.info("FAILED DIR    : %s", cfg.failed_dir)
    logger.info("LOG FILE      : %s", cfg.log_file)

    for d in (cfg.watch_dir, cfg.processing_dir, cfg.processed_dir, cfg.failed_dir):
        d.mkdir(parents=True, exist_ok=True)
    setup_logging(cfg)
    if any(os.stat(d).st_dev != os.stat(cfg.watch_dir).st_dev for d in (cfg.processing_dir, cfg.processed_dir, cfg.failed_dir)):
        logger.warning("processing/processed/failed folders are on a different volume than watch_dir; "
                       "the claim rename is not possible across volumes - keep them together")
    _lock = acquire_single_instance_lock(cfg.processing_dir / ".poller.lock")  # noqa: F841

    asyncio.run(run(cfg, args.once))


if __name__ == "__main__":
    main()
