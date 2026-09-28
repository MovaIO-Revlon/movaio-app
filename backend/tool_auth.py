import base64
import json
import logging
import os
import re
from typing import Any

import requests
from bson import ObjectId
from commonutils import DatabaseCollections
from config_loader import config_loader
from tool_call import DynamicToolExecutor
from utils import decrypt_data

# Initialize a logger for production tracking
logger = logging.getLogger(__name__)

class ToolAuthService(DatabaseCollections):
    def __init__(self):
        super().__init__()
        self.connectors_dir_path = "tool_config"
        self.encryption = config_loader.encryption_key

    def _execute_tool(self, tool_name: str, arguments: dict[str, Any], raw_tools: list[dict], user_id: str) -> str:
        """Finds the tool, resolves dynamic credentials, and executes it."""
        matched_doc = next(
            (doc for doc in raw_tools 
             if "functions" in doc.get("tool_key", {}) 
             and any(f.get("name") == tool_name for f in doc["tool_key"]["functions"])),
            None
        )

        if not matched_doc:
            error_msg = f"Error: Tool '{tool_name}' is not configured."
            logger.error(error_msg)
            return error_msg

        connection_id = matched_doc.get("connection_id")
        
        try:
            # Resolves the connection and populates the actual access tokens / headers
            credentials = self.fetch_and_resolve_credentials(connection_id, user_id)
            
            # credentials now contains 'access_token', 'Authorization', or custom headers ready to use
            executor = DynamicToolExecutor(tool_json=matched_doc["tool_key"], secrets=credentials)
            return executor.execute(tool_name, arguments)
            
        except Exception as e:
            logger.exception(f"Failed to execute tool '{tool_name}' for user {user_id}")
            return f"Execution Error: An internal error occurred while executing {tool_name}."

    def fetch_and_resolve_credentials(self, connection_id: str, user_id: str):
        """Orchestrator: Fetches DB data, reads app.json, and routes to correct auth logic."""
        if not connection_id:
            return {}

        connection = self.connections_collection.find_one({
            "_id": ObjectId(connection_id)
            
        })
        
        if not connection:
            logger.warning(f"Connection {connection_id} not found.")
            return {}
        
        connector_type = connection.get("connector_type", "").lower()
        auth_type = connection.get("auth_type", "no_auth").lower().replace(" ", "")
        raw_credentials = connection.get("credentials", {})
        credentials = decrypt_data(raw_credentials)

        # 1. Handle Mock Execution (Bypasses external auth completely)
        if any("mock" in str(val).lower() for val in credentials.values() if val):
            logger.info("Mock credentials detected. Bypassing auth resolution.")
            return credentials

        # 2. Load the dynamic app.json configuration for this connector
        app_config = self._load_connector_app_json(connector_type)
        if not app_config:
            logger.warning(f"No app.json found for {connector_type}. Falling back to default auth logic.")
            security_scheme = None
        else:
            # 3. Find the exact security scheme based on the auth_type requested in the DB
            security_scheme = self._find_matching_security_scheme(app_config, auth_type)

        # 4. Dynamic Router Map
        auth_handlers = {
            "oauth": self._handle_oauth2_dynamic,
            "oauth2": self._handle_oauth2_dynamic,
            "basic": self._handle_basic_dynamic,
            "bearer": self._handle_bearer_dynamic,
            "api_key": self._handle_api_key_dynamic,
            "no_auth": self._handle_no_auth,
            "noauth": self._handle_no_auth
        }

        handler = auth_handlers.get(auth_type)
        
        if handler:
            try:
                # Pass both the user's DB credentials AND the app.json schema template
                return handler(credentials, security_scheme)
            except requests.exceptions.RequestException as e:
                logger.error(f"[{auth_type}] Network error fetching token for {connection_id}: {e}")
                return {} 
            except Exception as e:
                logger.error(f"[{auth_type}] Token acquisition failed for {connection_id}: {str(e)}")
                return {} 
        else:
            logger.warning(f"Unrecognized auth type '{auth_type}'. Proceeding with raw credentials.")
            return credentials

    # ---------------------------------------------------------
    # JSON PARSING & TEMPLATE RESOLUTION
    # ---------------------------------------------------------

    def _load_connector_app_json(self, connector_type: str):
        print(f"Connector Type:{connector_type}")
        file_path = os.path.join(self.connectors_dir_path, connector_type, "app.json")
        print(f"App.json path:{file_path}")
        try:
            if os.path.exists(file_path):
                with open(file_path, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception as e:
            logger.error(f"Error reading app.json for {connector_type}: {e}")
        return None

    def _find_matching_security_scheme(self, app_config: dict, auth_type: str):
        schemes = app_config.get("security_schemes", {})
        normalized_auth_type = "oauth2" if auth_type == "oauth" else auth_type

        for scheme_name, scheme_data in schemes.items():
            if scheme_data.get("type", "").lower() == normalized_auth_type:
                return scheme_data
        
        logger.warning(f"No security scheme matching type '{normalized_auth_type}' found in app.json.")
        return None

    def _resolve_template_string(self, template_str: str, context: dict[str, Any]) -> str:
        """Replaces {{ key }} with the value from the context dictionary (credentials)."""
        if not isinstance(template_str, str):
            return template_str

        def replace(match):
            key = match.group(1).strip()
            return str(context.get(key, ""))

        return re.sub(r"\{\{\s*(.*?)\s*\}\}", replace, template_str)

    def _resolve_scheme_config(self, scheme_config: dict[str, Any], credentials: dict[str, Any]) -> dict[str, Any]:
        """Resolves all template variables inside a security scheme configuration."""
        resolved = {}
        for key, value in scheme_config.items():
            if isinstance(value, str):
                resolved[key] = self._resolve_template_string(value, credentials)
            else:
                resolved[key] = value
        return resolved

    # ---------------------------------------------------------
    # MODULAR DYNAMIC AUTHENTICATION HANDLERS
    # ---------------------------------------------------------

    def _handle_oauth2_dynamic(self, credentials: dict[str, Any], scheme_config: dict | None):
        """Dynamically builds an OAuth2 Client Credentials payload entirely from app.json."""
        if not scheme_config:
            raise ValueError("Missing security scheme configuration in app.json for OAuth2.")

        # 1. Resolve {{ placeholders }} using DB credentials
        resolved_config = self._resolve_scheme_config(scheme_config, credentials)

        # 2. Extract and remove internal routing fields so they aren't sent in the POST body
        token_url = resolved_config.pop("token_url", None)
        resolved_config.pop("type", None)
        
        if not token_url:
            raise ValueError("app.json security scheme is missing a resolved 'token_url'")

        # 3. Dynamically build payload from remaining fields
        payload = {}
        for key, value in resolved_config.items():
            if key == "flow": 
                # Translate 'flow' to standard OAuth 'grant_type'
                payload["grant_type"] = value
            else:
                # Whatever you put in app.json (e.g. client_id, client_secret, audience) gets passed
                payload[key] = value

        # 4. Execute HTTP POST to get the token
        logger.info(f"Executing dynamic OAuth request to {token_url}")
        response = requests.post(token_url, data=payload, timeout=10)
        response.raise_for_status() 
        
        token_data = response.json()
        access_token = token_data.get("access_token")
        
        if not access_token:
            raise ValueError("OAuth provider responded successfully but did not return an 'access_token'")

        credentials["access_token"] = access_token
        credentials["Authorization"] = f"Bearer {access_token}"
        return credentials

    def _handle_basic_dynamic(self, credentials: dict[str, Any], scheme_config: dict | None):
        """Dynamically handles Basic Auth strictly via app.json variables."""
        if not scheme_config:
            logger.warning("Basic auth selected but no scheme config found in app.json")
            return credentials

        resolved_config = self._resolve_scheme_config(scheme_config, credentials)
        
        # Support either a custom format via "template" or standard username/password keys
        auth_string = resolved_config.get("template")
        
        if not auth_string:
            username = resolved_config.get("username", "")
            password = resolved_config.get("password", "")
            auth_string = f"{username}:{password}"
            
        if auth_string and auth_string != ":":
            encoded = base64.b64encode(auth_string.encode("utf-8")).decode("utf-8")
            credentials["Authorization"] = f"Basic {encoded}"
        else:
            logger.warning("Basic Auth selected but missing 'username' or 'password' in app.json.")
            
        return credentials

    def _handle_bearer_dynamic(self, credentials: dict[str, Any], scheme_config: dict | None):
        """Dynamically handles Bearer Auth mapped purely from app.json."""
        if not scheme_config:
            logger.warning("Bearer auth selected but no scheme config found in app.json")
            return credentials

        resolved_config = self._resolve_scheme_config(scheme_config, credentials)
        token = resolved_config.get("token")
        
        if token:
            credentials["Authorization"] = f"Bearer {token}"
        else:
            logger.warning("Bearer Auth selected but 'token' is missing in app.json.")
            
        return credentials

    def _handle_api_key_dynamic(self, credentials: dict[str, Any], scheme_config: dict | None):
        """Dynamically handles Custom API Keys (e.g., x-api-key)."""
        if not scheme_config:
            logger.warning("api_key auth selected but no scheme config found in app.json")
            return credentials

        resolved_config = self._resolve_scheme_config(scheme_config, credentials)
        
        placement = resolved_config.get("in", "header").lower() 
        header_name = resolved_config.get("name", "Authorization")
        api_value = resolved_config.get("value")

        if api_value:
            if placement == "header":
                credentials[header_name] = api_value
            elif placement == "query":
                credentials[f"query_{header_name}"] = api_value
                
        return credentials

    def _handle_no_auth(self, credentials: dict[str, Any], scheme_config: dict | None):
        return credentials
    
    def authenticate_servicenow(self,data):
        try:
            #print(data)
            data = decrypt_data(data)
            client_id = data.get("client_id")
            client_secret = data.get("client_secrets")
            auth_url = data.get("server_url")

            if not client_id or not client_secret or not auth_url:
                raise ValueError("Missing required authentication parameters.")

            payload = {
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": client_secret,
            }
            token_url = f"{auth_url}/oauth_token.do"
            headers = {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"}

            try:
                response = requests.post(token_url, data=payload, headers=headers, timeout=15)
                response.raise_for_status()
                result = response.json()
            except Exception:
                try:
                    basic_headers = dict(headers)
                    basic_headers["Authorization"] = "Basic " + base64.b64encode(f"{client_id}:{client_secret}".encode()).decode("ascii")
                    response = requests.post(token_url, data=payload, headers=basic_headers, timeout=15)
                    response.raise_for_status()
                    result = response.json()
                except Exception as e:
                    print("Exception - Received OAuth2 token response--2", e)
                    return None

            token = result.get("access_token")
            if token:
                return {
                    "access_token": token,
                    "status": "success"
                }
            else:
                return {
                    "access_token": None,
                    "status": "failure"
                }

        except Exception as e:
            print("Error during ServiceNow authentication:", str(e))
            return {
                "access_token": None,
                "status": "failure",
                "error": str(e)
            }

    def authenticate_onedrive(self,data):
        try:
            data = decrypt_data(data)
            tenant_id = data.get("tenant_id")
            client_id = data.get("client_id")
            client_secret = data.get("client_secrets")
            # auth_url = data.get("server_url")

            token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
            token_data = {
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": client_secret,
                "scope": "https://graph.microsoft.com/.default"
            }
            res = requests.post(token_url, data=token_data, timeout=10)
            if res.status_code != 200:
                raise ValueError(f"Authorization validation error: {res.text}")
            access_token = res.json().get("access_token")
            verify_res = requests.get("https://graph.microsoft.com/v1.0/drive", headers={"Authorization": f"Bearer {access_token}"}, timeout=10)
            if verify_res.status_code != 200:
                raise ValueError("Graph system permission error.")
            if access_token:
                return {
                    "access_token": access_token,
                    "status": "success"
                }
            else:
                return {
                    "access_token": None,
                    "status": "failure"
                }

        except Exception as e:
            print("Error during OneDrive authentication:", str(e))
            return {
                "access_token": None,
                "status": "failure",
                "error": str(e)
            }


