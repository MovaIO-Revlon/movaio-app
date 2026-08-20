import base64
import hashlib
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from functools import wraps
from typing import Any, TypedDict

import jwt
from config_loader import config_loader
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from flask import g, request, session
from utils import AuthorizationError

NONCE_LEN = 12


class User(TypedDict):
    user_id: str
    name: str
    role: str
    ActiveProject: str


class SessionManager:
    def __init__(self):
        self.config = config_loader
        self.sessions = {}  # In-memory storage (use Redis for production)
        self.session_timeout = 1200  # 2 hour in seconds
        self.SECRET_KEY = hashlib.sha256(
            self.config.SESSION_TOKEN_SECRET.encode("utf-8")
        ).digest()

    def create_session(self, user_data):
        """Create new session for user"""
        session_id = str(uuid.uuid4())
        session_data = {
            "session_id": session_id,
            "user_id": user_data.get("Email"),
            "user_name": user_data.get("UserName"),
            "role": user_data.get("Role"),
            "team": user_data.get("Team"),
            "created_at": datetime.now(),
            "last_activity": datetime.now(),
            "is_active": True,
            "ActiveProject": user_data.get("ActiveProject"),
            "ProjectDtl": user_data.get("ProjectDtl"),
        }

        self.sessions[session_id] = session_data
        session["session_id"] = session_id
        session["user_id"] = user_data.get("Email")

        return session_id

    def validate_session(self, session_id):
        """Validate if session exists and is active"""
        if not session_id or session_id not in self.sessions:
            return False

        session_data = self.sessions[session_id]

        # Check if session expired
        if self._is_session_expired(session_data):
            self.destroy_session(session_id)
            return False

        # Update last activity
        session_data["last_activity"] = datetime.now()
        return True

    def get_session_data(self, session_id):
        """Get session data"""
        if session_id in self.sessions:
            return self.sessions[session_id]
        return None

    def update_session(self, session_id, update_data):
        """Update session data"""
        if session_id in self.sessions:
            self.sessions[session_id].update(update_data)
            self.sessions[session_id]["last_activity"] = datetime.now()
            return True
        return False

    def replace_session(self, session_id, new_data):
        """Replace session data completely"""

        if session_id in self.sessions:
            # Keep essential session fields
            essential_fields = {
                "session_id": self.sessions[session_id]["session_id"],
                "created_at": self.sessions[session_id]["created_at"],
                "last_activity": datetime.now(),
                "is_active": True,
                "user_id": self.sessions[session_id]["user_id"],
                "user_name": self.sessions[session_id]["user_name"],
                "role": self.sessions[session_id]["role"],
                "team": self.sessions[session_id]["team"],
                "ActiveProject": new_data.get("ActiveProject"),
                "ProjectDtl": new_data.get("PrjDetails"),
            }
            # Replace with new data but keep essential fields
            self.sessions[session_id] = {**essential_fields}
            return True
        return False

    def destroy_session(self, session_id):
        """Destroy session"""
        if session_id in self.sessions:
            del self.sessions[session_id]
        session.clear()

    def _is_session_expired(self, session_data):
        """Check if session is expired"""
        last_activity = session_data["last_activity"]
        return (datetime.now() - last_activity).seconds > self.session_timeout

    def _get_jwt_secret(self):
        """Get the JWT secret configured for token validation"""
        return (
            getattr(self.config, "JWT_SECRET_KEY", None)
            or getattr(self.config, "SESSION_TOKEN_SECRET", None)
            or getattr(self.config, "SECRET_KEY", None)
            or ""
        )

    def get_session_token(self, user_details):
        current_user = get_current_user()
        active_subscription = current_user.get("ActiveProject", None)
        token_data = {
            "user_id": current_user.get("user_id", None),
            "role_id": list(
                {detail["role_name"] for detail in user_details.get("PrjDetails")}
            ),
            "UserName": current_user.get("name", None),
            "active_subscription": active_subscription,
            "profile_picture": user_details.get("Avatar", None),
        }
        session_token = self._encrypt(token_data)
        return session_token

    def get_tokens(self, payload: dict):
        secret = self._get_jwt_secret()

        iat = datetime.now(tz=timezone.utc)
        payload_for_jwt = {**payload, "iat": iat, "exp": iat + timedelta(hours=1)}

        payload_for_refresh_token = {
            **payload,
            "iat": iat,
            "exp": iat + timedelta(days=7),
        }

        token = jwt.encode(payload_for_jwt, secret, algorithm="HS256")
        refresh_token = jwt.encode(payload_for_refresh_token, secret, algorithm="HS256")

        return {"Token": token, "RefreshToken": refresh_token}

    def validate_token(self, token: str) -> User:
        try:
            secret = self._get_jwt_secret()
            return jwt.decode(token, secret, algorithms=["HS256"])
        except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, jwt.DecodeError):
            raise AuthorizationError(
                "Invalid or expired session", {"redirect": "/login"}
            )

    def extract_token(self) -> str | None:
        authorization_header = request.headers.get("Authorization", "")

        if not authorization_header.startswith("Bearer "):
            return None

        return authorization_header.split(" ", 1)[1].strip()

    def refresh_token(self):
        token = self.extract_token()

        if not token:
            raise AuthorizationError()

        payload = self.validate_token(token)

        return self.get_tokens(payload)

    def _encrypt(self, obj: Any):
        json_bytes = json.dumps(obj).encode("utf-8")

        nonce = os.urandom(NONCE_LEN)
        aesgcm = AESGCM(self.SECRET_KEY)
        cipertext = aesgcm.encrypt(nonce, json_bytes, associated_data=None)

        combined = nonce + cipertext
        return base64.b64encode(combined).decode("utf-8")

    def _decrypt(self, token: str):
        data = base64.b64decode(token.encode("utf-8"))

        nonce = data[:NONCE_LEN]
        ciphertext = data[NONCE_LEN:]

        aesgcm = AESGCM(self.SECRET_KEY)
        decrypted_bytes = aesgcm.decrypt(nonce, ciphertext, associated_data=None)

        return json.loads(decrypted_bytes.decode("utf-8"))


# Global session manager instance
session_manager = SessionManager()


def require_session(f):
    """Decorator to require a valid JWT bearer token."""

    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = session_manager.extract_token()

        if not token:
            raise AuthorizationError()

        payload = session_manager.validate_token(token)

        g.current_user = payload
        g.user_email = payload.get("user_id")

        return f(*args, **kwargs)

    return decorated_function


def get_current_user() -> User:
    current_user = g.current_user
    if not current_user:
        raise AuthorizationError()

    return current_user
