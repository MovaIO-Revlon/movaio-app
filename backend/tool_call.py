
import json
import re
import logging
import requests
from typing import Dict, Any, Union
from urllib.parse import urljoin
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# Configure standard logging
logger = logging.getLogger(__name__)

class DynamicToolExecutor:
    def __init__(self, tool_json: Dict[str, Any], secrets: Dict[str, str] = None):
        self.tool_json = tool_json
        self.secrets = secrets or {}

    def _resolve_variables(self, text: str) -> str:
        if not text or not isinstance(text, str):
            return text
            
        def replace_match(match):
            key = match.group(1).strip()
            # Prioritize injected secrets, fallback to tool_json secrets, fallback to empty
            return self.secrets.get(key, self.tool_json.get("secrets", {}).get(key, ""))
            
        return re.sub(r"\{\{(.*?)\}\}", replace_match, text)

    def _build_auth_headers(self) -> Dict[str, str]:
        """Resolves authentication headers dynamically."""
        headers = {}
        auth_header = self.secrets.get("authorization_header")
        access_token = self.secrets.get("access_token")

        if auth_header:
            headers["Authorization"] = auth_header
        elif access_token:
            headers["Authorization"] = f"Bearer {access_token}"
            
        return headers

    def execute(self, function_name: str, arguments: Dict[str, Any]) -> str:
        
        
        try:
            
            if "mock" in str(self.secrets.get("client_id", "")).lower():
                logger.info(f"Mock execution triggered for {function_name}")
                return json.dumps({
                    "status": "mock",
                    "message": f"Simulated execution of tool '{function_name}'",
                    "arguments": arguments
                })

           
            functions = self.tool_json.get("functions", [])
            func_def = next((f for f in functions if f["name"] == function_name), None)
            if not func_def:
                raise ValueError(f"Function '{function_name}' configuration missing in tool definition.")

            protocol_data = func_def.get("protocol_data", {})
            method = protocol_data.get("method", "GET").upper()
            
            # Resolve URL components safely
            
            # base_url = self._resolve_variables(protocol_data.get("server_url", "")).rstrip("/")
            server_url = self.secrets.get("server_url")

            print(f"Get the Server_URL from Secret : {server_url}")
            
            if server_url is None:
                server_url = protocol_data.get("server_url", "")
                print(f"Get the Server_URL from JSON : {server_url}")

            base_url = self._resolve_variables(str(server_url)).rstrip("/")
    
            print(f"base_url : {base_url}")
            
            path = protocol_data.get("path", "").lstrip("/")

            print(f"path : {path}")
            
            # 3. Dynamic Headers setup
            headers = self._build_auth_headers()
            
            # Allow protocol_data to define specific headers (e.g., custom Content-Type)
            custom_headers = protocol_data.get("headers", {"Content-Type": "application/json"})
            for k, v in custom_headers.items():
                headers[k] = self._resolve_variables(v)

            # 4. Route Arguments (Path vs Query vs Body)
            query_params = {}
            body_data = {}
            raw_data = None 

            for key, value in arguments.items():
                if f"{{{key}}}" in path:
                    path = path.replace(f"{{{key}}}", str(value))
                    continue

                content_type = headers.get("Content-Type", "")

                if content_type in ["text/plain", "application/octet-stream"] and key in ["content", "data", "file"]:
                    raw_data = value.encode("utf-8") if isinstance(value, str) else value
                    continue

                if method in ["GET", "DELETE"]:
                    if isinstance(value, dict):
                        query_params.update(value)
                    else:
                        query_params[key] = value
                else:
                    body_data[key] = value

            url = f"{base_url}/{path}"

            print(f"Concate base URL with Path : {url}")
            
            # 5. Execute Request directly via requests module
            logger.debug(f"Making {method} request to {url}")
            
            req_kwargs = {
                "method": method,
                "url": url,
                "headers": headers,
                "params": query_params if query_params else None,
                "timeout": protocol_data.get("timeout", 15) # Allow custom timeouts
            }

            if raw_data is not None:
                req_kwargs["data"] = raw_data
            elif headers.get("Content-Type") == "application/x-www-form-urlencoded":
                req_kwargs["data"] = body_data
            else:
                # If the function definition places request fields under a single `body` key
                # (common in tool descriptors), unwrap it so the remote API receives the
                # actual resource fields at the top-level instead of an envelope.
                if isinstance(body_data, dict) and len(body_data) == 1 and "body" in body_data and isinstance(body_data["body"], dict):
                    req_kwargs["json"] = body_data["body"]
                else:
                    req_kwargs["json"] = body_data if body_data else None

            # Direct requests call replacing self.session.request
            res = requests.request(**req_kwargs)
            print("Response tool:", res.status_code, res.json())  # Debugging output

            # 6. Process Response
            res.raise_for_status() # Raises HTTPError for bad responses (4xx, 5xx)

            response_text = res.text
            if not response_text:
                return json.dumps({
                    "status": "success",
                    "message": "Request completed successfully but returned no response body.",
                    "status_code": res.status_code
                })

            try:
                parsed_body = res.json()
                return json.dumps(parsed_body)
            except ValueError:
                return response_text

        except Exception as e:
            return json.dumps({"error": "Internal Error", "message": str(e)}) 


  
