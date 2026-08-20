# api_key_auth.py
import json
import os
import re
import threading
from functools import wraps
from datetime import datetime, timezone
from flask import request, g
from bson.objectid import ObjectId
from session_manager import session_manager
from utils import AuthorizationError

# OpenAPI tag → allowed_apis value stored in DB
TAG_TO_CATEGORY = {
    "Agent Management": "agents",
    "Workflow Management": "workflows",
    "Knowledge & Tools": "agents",
    "Insights & Analytics": "insights",
    "Chatbot & Insights": "agents",
    "Voice Agents": "voice_agents",
    "Agency Management": "agents", 
    "User Management": "user_management",
}

# Cache for OpenAPI paths so we only read the file once
_OPENAPI_PATH_MAP = {}
_OPENAPI_LOCK = threading.Lock()

def _normalize_path(path: str) -> str:
    """
    Normalizes paths to lowercase, strips trailing slashes, 
    and standardizes path parameters (e.g., <id> becomes {id}).
    """
    if not path:
        return ""
    # Convert Flask params <string:id> to OpenAPI params {id}
    path = re.sub(r'<(?:\w+:)?(\w+)>', r'{\1}', path)
    return path.lower().rstrip('/')

def _load_openapi_spec(openapi_path="openapi.json"):
    """Loads the OpenAPI spec and builds a path-to-category map.
    Registers both /path and /v1/path so either form resolves.
    """
    global _OPENAPI_PATH_MAP
    with _OPENAPI_LOCK:
        if _OPENAPI_PATH_MAP:
            return _OPENAPI_PATH_MAP

        if not os.path.exists(openapi_path):
            print(f"Warning: {openapi_path} not found. API Key category resolution disabled.")
            return {}

        try:
            with open(openapi_path, "r") as f:
                spec = json.load(f)
        except Exception as e:
            print(f"Error reading openapi.json: {e}")
            return {}

        paths = spec.get("paths", {})
        for path, methods in paths.items():
            norm_path = _normalize_path(path)
            category = None

            for method, details in methods.items():
                if method in ["get", "post", "put", "patch", "delete"]:
                    tags = details.get("tags", [])
                    if tags:
                        category = TAG_TO_CATEGORY.get(tags[0])
                        break

            if category:
                _OPENAPI_PATH_MAP[norm_path] = category
                # Dual form so /GetAllAgents and /v1/GetAllAgents both match
                if norm_path.startswith("/v1/"):
                    _OPENAPI_PATH_MAP[norm_path[3:]] = category
                elif norm_path and norm_path != "/":
                    _OPENAPI_PATH_MAP["/v1" + norm_path] = category

        return _OPENAPI_PATH_MAP


def resolve_category_from_path(path: str) -> str | None:
    """Looks up the DB category. Handles both /path and /v1/path."""
    path_map = _load_openapi_spec()
    if not path_map:
        return None

    norm = _normalize_path(path)
    if norm in path_map:
        return path_map[norm]

    if norm.startswith("/v1/"):
        return path_map.get(norm[3:])
    if norm and norm != "/":
        return path_map.get("/v1" + norm)
    return None


def path_is_external_category(path: str) -> bool:
    """Checks if the path has a mapped category in the OpenAPI spec."""
    return resolve_category_from_path(path) is not None

def require_token_or_api_key(category: str | None = None):
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            try:
                raw_token = session_manager.extract_token()
            except AuthorizationError:
                raw_token = None

            token = (str(raw_token).strip() if raw_token else None) or None

            api_key = (
                request.headers.get("X-API-Key")
                or request.headers.get("x-api-key")
            )
            if api_key:
                api_key = str(api_key).strip() or None

            print(f"[AUTH DEBUG] token={bool(token)} api_key={bool(api_key)} "
                  f"path={getattr(getattr(request, 'url_rule', None), 'rule', request.path)}")

            if not token and not api_key:
                raise AuthorizationError(
                    "Authorization required: provide a Bearer token or X-API-Key"
                )

            if token:
                try:
                    payload = session_manager.validate_token(token)
                    g.current_user = payload
                    g.user_email = payload.get("user_id")
                except AuthorizationError as e:
                    print(f"[AUTH DEBUG] token invalid: {e}")
                    if not api_key:
                        raise
                    g.current_user = None
                    g.user_email = None
                    token = None
            else:
                g.current_user = None
                g.user_email = None

            if api_key:
                from commonutils import DatabaseCollections

                # CRITICAL: external applications are global (master), not project DB
                try:
                    db_collections = DatabaseCollections(user_type="master")
                except TypeError:
                    # If constructor does not accept user_type, fall back
                    db_collections = DatabaseCollections()

                coll = db_collections.external_applications_collection

                try:
                    ctx = validate_api_key(api_key, coll)
                except AuthorizationError as e:
                    print(f"[AUTH DEBUG] validate_api_key failed: {e}")
                    raise

                print(f"[AUTH DEBUG] key OK app={ctx.get('application_name')} "
                      f"allowed={ctx.get('allowed_apis')} project={ctx.get('project_id')}")

                g.api_key_context = ctx

                matched_sub = ctx.get("subscription")
                if (
                    matched_sub
                    and matched_sub.get("project_id") is not None
                    and g.user_email
                ):
                    user_coll = db_collections.user_collection
                    user_doc = user_coll.find_one({
                        "Email": g.user_email,
                        "IsDelete": {"$ne": True},
                    })
                    if not user_doc:
                        raise AuthorizationError("User not found in the system")
                    user_project_ids = [
                        p.get("prj_id")
                        for p in user_doc.get("PrjDetails", [])
                        if p.get("prj_id") is not None
                    ]
                    target = matched_sub["project_id"]
                    if target not in user_project_ids:
                        raise AuthorizationError(
                            f"Access Denied: You are not mapped to project "
                            f"'{matched_sub.get('project_name', target)}' for this API key."
                        )

                resolved = category or resolve_category_from_path(
                    getattr(getattr(request, "url_rule", None), "rule", None)
                    or request.path
                )
                print(f"[AUTH DEBUG] resolved category={resolved}")

                if not resolved:
                    raise AuthorizationError(
                        "This endpoint is not available via API key (Unmapped in OpenAPI tags)"
                    )
                if resolved not in ctx["allowed_apis"]:
                    raise AuthorizationError(
                        f"API key not allowed for '{resolved}'. "
                        f"Allowed: {ctx['allowed_apis']}"
                    )

                try:
                    coll.update_one(
                        {"_id": ObjectId(ctx["application_id"])},
                        {
                            "$set": {"last_used_at": datetime.now(timezone.utc)},
                            "$inc": {"usage_count": 1},
                        },
                    )
                except Exception as e:
                    print(f"[AUTH DEBUG] usage update failed: {e}")
            else:
                g.api_key_context = None

            return f(*args, **kwargs)

        return decorated
    return decorator

# Validation & Decorator
def validate_api_key(api_key: str, collection) -> dict:
    if not api_key or not str(api_key).startswith("sk-movaio-"):
        raise AuthorizationError("Invalid API key")

    app = collection.find_one(
        {
            "is_deleted": {"$ne": True},
            "$or": [
                {"api_key": api_key},
                {"subscriptions.api_key": api_key},
            ],
        }
    )
    if not app:
        raise AuthorizationError("Invalid or unknown API key")

    if app.get("status") not in (None, "active"):
        raise AuthorizationError("External application is inactive")

    matched_sub = None
    for sub in app.get("subscriptions") or []:
        if sub.get("api_key") == api_key:
            if sub.get("status") not in (None, "active"):
                raise AuthorizationError("API key is inactive")
            matched_sub = sub
            break

    if matched_sub is None and app.get("api_key") != api_key:
        raise AuthorizationError("Invalid or unknown API key")

    allowed = (
        (matched_sub or {}).get("allowed_apis")
        or app.get("allowed_apis")
        or []
    )
    if not allowed:
        raise AuthorizationError("API key has no allowed APIs configured")

    return {
        "application_id": str(app["_id"]),
        "application_name": app.get("name"),
        "allowed_apis": list(allowed),
        "subscription": matched_sub,
        "project_id": (matched_sub or {}).get("project_id"),
        "project_name": (matched_sub or {}).get("project_name"),
        "database_name": (matched_sub or {}).get("database_name"),
    }

def is_browser_like_request() -> bool:
    """Treat as browser/UI when common browser-only headers are present."""
    if request.headers.get("Origin"): return True
    if request.headers.get("Sec-Fetch-Mode"): return True
    if request.headers.get("Sec-Fetch-Site"): return True
    return False

def require_session_or_api_key(category: str | None = None):
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            token = session_manager.extract_token()
            if not token:
                raise AuthorizationError("Authorization required (Bearer token)")

            payload = session_manager.validate_token(token)
            g.current_user = payload
            g.user_email = payload.get("user_id") # Assuming user_id in token is the Email

            api_key = request.headers.get("X-API-Key") or request.headers.get("x-api-key")

            # Browser -> key optional; Postman/curl -> key required
            require_key = not is_browser_like_request()

            if require_key and not api_key:
                raise AuthorizationError("X-API-Key is required for non-browser clients")

            if not api_key:
                g.api_key_context = None
                return f(*args, **kwargs)

            from commonutils import DatabaseCollections
            db_collections = DatabaseCollections()
            coll = db_collections.external_applications_collection

            ctx = validate_api_key(api_key, coll)
            g.api_key_context = ctx

            # ==================================================================
            # NEW: Project-User Mapping Validation
            # ==================================================================
            matched_sub = ctx.get("subscription")
            
            # Only validate if the subscription actually has a project_id mapped
            if matched_sub and matched_sub.get("project_id") is not None:
                user_email = g.user_email
                if not user_email:
                    raise AuthorizationError("User identity not found in token")
                
                # NOTE: Change 'users_collection' if your collection name is different
                user_coll = db_collections.user_collection 
                user_doc = user_coll.find_one({
                    "Email": user_email, 
                    "IsDelete": {"$ne": True}
                })
                
                if not user_doc:
                    raise AuthorizationError("User not found in the system")
                
                # Extract all project IDs the user is mapped to
                user_project_ids = [
                    p.get("prj_id") for p in user_doc.get("PrjDetails", []) 
                    if p.get("prj_id") is not None
                ]
                
                target_project_id = matched_sub["project_id"]
                
                if target_project_id not in user_project_ids:
                    raise AuthorizationError(
                        f"Access Denied: You are not mapped to project "
                        f"'{matched_sub.get('project_name', target_project_id)}' for this API key."
                    )
            # ==================================================================

            # CRITICAL: Use url_rule.rule instead of request.path for accurate matching
            route_rule = getattr(request, 'url_rule', None)
            path_to_match = route_rule.rule if route_rule else request.path

            resolved = category or resolve_category_from_path(path_to_match)
            
            if not resolved:
                raise AuthorizationError(
                    "This endpoint is not available via API key (Unmapped in OpenAPI tags)"
                )
            if resolved not in ctx["allowed_apis"]:
                raise AuthorizationError(
                    f"API key not allowed for '{resolved}'. "
                    f"Allowed: {ctx['allowed_apis']}"
                )

            try:
                coll.update_one(
                    {"_id": ObjectId(ctx["application_id"])},
                    {
                        "$set": {"last_used_at": datetime.now(timezone.utc)},
                        "$inc": {"usage_count": 1},
                    },
                )
            except Exception:
                pass

            return f(*args, **kwargs)

        return decorated
    return decorator

