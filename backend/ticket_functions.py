import logging
import json
import time
import uuid
import threading
from typing import Any, Dict

import requests
from flask import jsonify, request

from config_loader import config_loader


log = logging.getLogger(__name__)


class ServiceNowClient:
    def __init__(self, instance: str, client_id: str, client_secret: str, timeout: float = 15.0):
        self.instance = (
            instance.strip().replace("https://", "").replace("http://", "").rstrip("/")
        )
        self.client_id = client_id
        self.client_secret = client_secret
        self.timeout = timeout
        self._access_token = ""
        self._token_expiry_epoch = 0.0

    def generate_access_token(self) -> str:
        """Generate and cache a ServiceNow OAuth access token."""
        now = time.time()
        if self._access_token and now < self._token_expiry_epoch:
            return self._access_token

        token_url = f"{self._base_url()}/oauth_token.do"
        data = {
            "grant_type": "client_credentials",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
        }
        response = requests.post(token_url, data=data, timeout=self.timeout)
        response.raise_for_status()

        token_payload = response.json()
        access_token = token_payload.get("access_token", "")
        if not access_token:
            raise ValueError("ServiceNow token response did not include access_token.")

        expires_in = int(token_payload.get("expires_in", 3600))
        # Keep a 60-second buffer to avoid using nearly expired tokens.
        self._token_expiry_epoch = now + max(expires_in - 60, 60)
        self._access_token = access_token
        return self._access_token

    def _headers(self) -> Dict[str, str]:
        access_token = self.generate_access_token()
        return {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {access_token}",
        }

    def _base_url(self) -> str:
        return f"https://{self.instance}"

    def get_sys_id_by_number(self, number: str) -> str:
        url = (
            f"{self._base_url()}/api/now/table/incident"
            f"?sysparm_query=number={number}&sysparm_fields=sys_id&sysparm_limit=1"
        )
        response = requests.get(
            url,
            headers=self._headers(),
            timeout=self.timeout,
        )
        response.raise_for_status()
        result = response.json().get("result", [])

        if not result:
            raise ValueError(f"Incident not found for number: {number}")

        sys_id = (result[0] or {}).get("sys_id")
        if not sys_id:
            raise ValueError(f"sys_id not found for incident number: {number}")

        return sys_id

    def patch_incident(self, sys_id: str, patch_body: Dict[str, Any]) -> Dict[str, Any]:
        url = f"{self._base_url()}/api/now/table/incident/{sys_id}"
        response = requests.patch(
            url,
            headers=self._headers(),
            json=patch_body,
            timeout=self.timeout,
        )
        if response.status_code in (403, 503):
            time.sleep(5)
            response = requests.patch(
                url,
                headers=self._headers(),
                json=patch_body,
                timeout=self.timeout,
            )
        response.raise_for_status()
        return response.json()


class TicketFunctions:
    PATCH_BY_NUMBER_ALLOWED_FIELDS = {
        "work_notes",
        "state",
        "assignment_group",
        "assigned_to",
        "category",
        "subcategory",
        "urgency",
        "impact",
        "priority",
        "close_code",
        "close_notes",
    }

    def __init__(self):
        cfg = config_loader.config
        self.config = cfg
        self.ticket_api_key = cfg.get("TICKET_FUNCTIONS_API_KEY", "")
        self.sn_client = ServiceNowClient(
            instance=cfg.get("SN_INSTANCE", ""),
            client_id=cfg.get("SN_CLIENT_ID", ""),
            client_secret=cfg.get("SN_CLIENT_SECRET", ""),
            timeout=float(cfg.get("SN_TIMEOUT", 15.0)),
        )
        self.work_note_resolved = cfg.get(
            "SN_WORK_NOTE_RESOLVED",
            "Issue resolved via AI-guided self-service recommendation, confirmed by the end user.",
        )
        self.work_note_unresolved = cfg.get(
            "SN_WORK_NOTE_UNRESOLVED",
            "User marked AI-guided recommendation as unresolved; further investigation is required.",
        )
        self.sn_secret = cfg.get("SN_SECRET", "")

    def _agent_node(self, name: str, tag: str, user_id: str, agent_id: str, extra_params=None) -> Dict[str, Any]:
        params = {
            "config": {
                "user_id": user_id,
                "api_key": self.config.get("LYZR_API_KEY_WEBHOOK", ""),
                "session_id": str(uuid.uuid4()),
                "agent_id": agent_id,
                "api_url": self.config.get("LYZR_AGENT_API_URL_WEBHOOK", ""),
                "agent_name": tag,
            },
            "assets": [],
        }
        if extra_params:
            params.update(extra_params)
        return {"name": name, "tag": tag, "function": "call_lyzr_agent", "params": params}

    @staticmethod
    def _conditional_node(name: str, condition: str, true_target: str, false_target: str, depends_on: str) -> Dict[str, Any]:
        return {
            "name": name,
            "tag": "Conditional",
            "function": "gpt_conditional_block",
            "params": {
                "message": "",
                "condition": condition,
                "openai_api_key": "",
                "model": "gpt-3.5-turbo",
                "temperature": 0,
                "true": true_target,
                "false": false_target,
                depends_on: {"depends": depends_on},
            },
        }

    @staticmethod
    def _normalize_incident_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "sys_id": payload.get("sys_id", ""),
            "number": payload.get("number", ""),
            "short_description": payload.get("short_description", ""),
            "description": payload.get("description", ""),
            "category": payload.get("category", ""),
            "priority": payload.get("priority", ""),
            "urgency": payload.get("urgency", ""),
            "impact": payload.get("impact", ""),
            "state": payload.get("state", ""),
            "assignment_group": payload.get("assignment_group", ""),
            "caller_id": payload.get("caller_id", ""),
            "sys_created_on": payload.get("sys_created_on", ""),
            "sys_updated_on": payload.get("sys_updated_on", ""),
            "event_type": payload.get("event_type", ""),
        }

    def build_dag_payload(self, incident: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "tasks": [
                self._agent_node(
                    "agent_itops_inci",
                    "ITOps Incident Ingestion Agent",
                    self.config.get("INGESTION_USER_ID", ""),
                    self.config.get("INGESTION_AGENT_ID", ""),
                    {"user_message": {"value": json.dumps(incident)}},
                ),
                self._conditional_node(
                    "conditional_lhhx",
                    'Is ingestion_status == "SUCCESS" ?',
                    "agent_itops_tria",
                    "",
                    "agent_itops_inci",
                ),
                self._agent_node(
                    "agent_itops_tria",
                    "ITOps Triage Agent",
                    self.config.get("TRIAGE_USER_ID", ""),
                    self.config.get("TRIAGE_AGENT_ID", ""),
                ),
                self._conditional_node(
                    "conditional_lrrb",
                    'Is "triage_status": "SUCCESS" ?',
                    "agent_itops_guid",
                    "agent_itops_reso",
                    "agent_itops_tria",
                ),
                self._agent_node(
                    "agent_itops_guid",
                    "ITOps Guided Resolution Agent",
                    self.config.get("GUIDED_USER_ID", ""),
                    self.config.get("GUIDED_AGENT_ID", ""),
                    {"user_message": {"value": ""}},
                ),
                self._conditional_node(
                    "conditional_nmqf",
                    'Is resolution_status == "SOP_FOUND" and recommended_sop.resolution_type == "SCRIPT" ?',
                    "agent_itops_runb",
                    "agent_itops_reso",
                    "agent_itops_guid",
                ),
                self._agent_node(
                    "agent_itops_runb",
                    "ITOps Runbook Assistant",
                    self.config.get("RUNBOOK_USER_ID", ""),
                    self.config.get("RUNBOOK_AGENT_ID", ""),
                ),
                self._conditional_node(
                    "conditional_ngxo",
                    'Is runbook_status == "SCRIPT_FOUND" ?',
                    "agent_itops_scri",
                    "agent_itops_reso",
                    "agent_itops_runb",
                ),
                self._agent_node(
                    "agent_itops_scri",
                    "ITOps Script Execution Agent",
                    self.config.get("SCRIPT_EXEC_USER_ID", ""),
                    self.config.get("SCRIPT_EXEC_AGENT_ID", ""),
                ),
                self._agent_node(
                    "agent_itops_reso",
                    "ITOps Resolution Router",
                    self.config.get("ROUTER_USER_ID", ""),
                    self.config.get("ROUTER_AGENT_ID", ""),
                ),
            ],
            "default_inputs": {},
            "flow_name": self.config.get("LYZR_FLOW_NAME", ""),
            "run_name": incident.get("number") or f"RUN-{uuid.uuid4().hex[:8]}",
            "edges": [
                {"source": "conditional_lhhx", "target": "agent_itops_tria", "condition": "true"},
                {"source": "conditional_lrrb", "target": "agent_itops_guid", "condition": "true"},
                {"source": "conditional_nmqf", "target": "agent_itops_runb", "condition": "true"},
                {"source": "conditional_ngxo", "target": "agent_itops_scri", "condition": "true"},
                {"source": "conditional_nmqf", "target": "agent_itops_reso", "condition": "false"},
                {"source": "conditional_ngxo", "target": "agent_itops_reso", "condition": "false"},
            ],
            "flow_data": {
                "node_positions": {
                    "agent_itops_inci": {"x": -665.28, "y": -149.96},
                    "conditional_lhhx": {"x": -672.67, "y": 27.65},
                    "agent_itops_tria": {"x": -334.74, "y": -150.00},
                    "conditional_lrrb": {"x": -330.29, "y": 23.14},
                    "agent_itops_guid": {"x": -4.87, "y": -149.01},
                    "conditional_nmqf": {"x": -14.40, "y": 20.74},
                    "agent_itops_runb": {"x": 339.28, "y": -150.80},
                    "conditional_ngxo": {"x": 331.50, "y": 20.72},
                    "agent_itops_scri": {"x": 691.38, "y": -147.08},
                    "agent_itops_reso": {"x": 206.33, "y": 210.87},
                }
            },
        }

    def call_lyzr_dag(self, incident: Dict[str, Any]) -> None:
        number = incident.get("number", "UNKNOWN")
        payload = self.build_dag_payload(incident)
        print("Calling Lyzr DAG with payload:", json.dumps(payload, indent=2))
        flow_name = payload.get("flow_name", "")
        log.info("[%s] Forwarding to Lyzr run-dag flow=%s", number, flow_name)

        try:
            response = requests.post(
                self.config.get("LYZR_RUN_DAG_URL", ""),
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": self.config.get("LYZR_API_KEY_WEBHOOK", ""),
                },
                json=payload,
                timeout=120,
            )
            print("Lyzr response status:", response.json())
            if response.status_code < 300:
                log.info("[%s] Lyzr accepted status=%d", number, response.status_code)
            else:
                log.error(
                    "[%s] Lyzr error status=%d body=%s",
                    number,
                    response.status_code,
                    response.text[:500],
                )
        except requests.Timeout:
            log.error("[%s] Lyzr DAG timed out after 120s", number)
        except Exception as exc:
            log.exception("[%s] Unexpected error calling Lyzr: %s", number, exc)

    @staticmethod
    def _val(value: Any) -> str:
        return "" if value is None else str(value)

    @staticmethod
    def _error(message: str, status_code: int):
        return jsonify({"success": False, "message": message}), status_code

    def _validate_api_key(self):
        expected_key = self._val(self.ticket_api_key).strip()
        incoming_key = self._val(
            request.headers.get("X-API-Key")
            or request.headers.get("api-key")
            or request.headers.get("x-api-key")
        ).strip()

        if not expected_key:
            log.warning("Ticket function API key is not configured.")
            return self._error("Ticket API key is not configured.", 500)

        if incoming_key != expected_key:
            log.warning("Unauthorized ticket API request - invalid or missing API key header")
            return self._error("Unauthorized", 401)

        return None

    def incident_feedback(self):
        """
        Called by the Resolve / Unresolved action buttons in the end-user chat UI.
        Checks the current SN incident state and applies the appropriate update.

        resolved  + in-progress  -> mark Resolved + work note
        resolved  + already done -> no-op, return already-resolved message
        unresolved + in-progress -> work note only, state unchanged
        unresolved + already done -> no-op, return already-resolved message
        """
        auth_error = self._validate_api_key()
        if auth_error:
            return auth_error

        payload = request.get_json(silent=True) or {}
        number = payload.get("number")
        action = self._val(payload.get("action")).strip().lower()

        if not number:
            return self._error("'number' is required in request body.", 400)

        if action not in {"resolved", "unresolved"}:
            return self._error("'action' must be either 'resolved' or 'unresolved'.", 400)

        if not self.sn_client.instance or not self.sn_client.client_id or not self.sn_client.client_secret:
            return self._error(
                "ServiceNow configuration is missing. Please set SN_INSTANCE, SN_CLIENT_ID and SN_CLIENT_SECRET.",
                500,
            )

        log.info("[FEEDBACK] number=%s action=%s - step 1: resolving sys_id", number, action)

        try:
            sys_id = self.sn_client.get_sys_id_by_number(number)
        except ValueError as exc:
            return self._error(str(exc), 404)
        except requests.Timeout:
            return self._error("ServiceNow did not respond in time.", 504)
        except requests.ConnectionError:
            return self._error("Could not reach ServiceNow.", 503)
        except requests.HTTPError as exc:
            status_code = exc.response.status_code if exc.response is not None else 502
            return self._error(f"ServiceNow error while resolving incident: {status_code}", 502)
        except Exception as exc:
            return self._error(f"Unexpected error while resolving incident: {exc}", 500)

        log.info("[FEEDBACK] number=%s sys_id=%s - step 2: fetching state", number, sys_id)

        inc_url = (
            f"https://{self.sn_client.instance}/api/now/table/incident/{sys_id}"
            f"?sysparm_fields=state&sysparm_display_value=true"
        )

        try:
            inc_resp = requests.get(
                inc_url,
                headers=self.sn_client._headers(),
                timeout=self.sn_client.timeout,
            )
            inc_resp.raise_for_status()
        except requests.Timeout:
            return self._error("ServiceNow did not respond in time.", 504)
        except requests.ConnectionError:
            return self._error("Could not reach ServiceNow.", 503)
        except requests.HTTPError as exc:
            status_code = exc.response.status_code if exc.response is not None else 502
            return self._error(f"ServiceNow error: {status_code}", 502)

        state_display = self._val(inc_resp.json().get("result", {}).get("state")).lower()
        already_resolved = "resolved" in state_display or "closed" in state_display

        log.info(
            "[FEEDBACK] number=%s state='%s' already_resolved=%s",
            number,
            state_display,
            already_resolved,
        )

        if already_resolved:
            return jsonify({"message": f"Thank you, this Incident {number} is already resolved."}), 200

        if action == "resolved":
            patch_body = {
                "state": "6",
                "close_code": "Solution provided",
                "close_notes": (
                    "Issue resolved via AI-guided self-service recommendation, "
                    "confirmed by the end user."
                ),
                "work_notes": self.work_note_resolved,
            }
            log.info("[FEEDBACK] number=%s - step 3: PATCH resolved", number)
            try:
                self.sn_client.patch_incident(sys_id, patch_body)
            except Exception as exc:
                log.error("[FEEDBACK] PATCH failed number=%s error=%s", number, exc)
                return self._error(f"ServiceNow update failed: {exc}", 502)

            log.info("[FEEDBACK] marked resolved number=%s sys_id=%s", number, sys_id)
            return jsonify(
                {
                    "message": (
                        f"Glad to hear your issue {number} has been resolved. "
                        "Thank you for using AI Assist."
                    )
                }
            ), 200

        log.info("[FEEDBACK] number=%s - step 3: PATCH unresolved (work note only)", number)
        try:
            self.sn_client.patch_incident(sys_id, {"work_notes": self.work_note_unresolved})
        except Exception as exc:
            log.error("[FEEDBACK] PATCH failed number=%s error=%s", number, exc)
            return self._error(f"ServiceNow update failed: {exc}", 502)

        log.info("[FEEDBACK] flagged unresolved number=%s sys_id=%s", number, sys_id)
        return jsonify(
            {
                "message": (
                    "Thank you for your feedback. The recommended resolution did not fully "
                    f"address your issue {number} and may require further investigation."
                )
            }
        ), 200

    def patch_incident_by_number(self):
        """
        Voice-friendly PATCH endpoint. Accepts an INC number instead of sys_id.
        Resolves the sys_id internally so callers do not need to handle sys_id values.
        """
        auth_error = self._validate_api_key()
        if auth_error:
            return auth_error

        payload = request.get_json(silent=True) or {}
        log.info("[PATCH-BY-NUMBER] incoming payload: %s", payload)

        number = self._val(payload.get("number")).strip()
        if not number:
            return self._error("'number' is required in request body.", 400)

        if not self.sn_client.instance or not self.sn_client.client_id or not self.sn_client.client_secret:
            return self._error(
                "ServiceNow configuration is missing. Please set SN_INSTANCE, SN_CLIENT_ID and SN_CLIENT_SECRET.",
                500,
            )

        try:
            sys_id = self.sn_client.get_sys_id_by_number(number)
        except ValueError as exc:
            return self._error(str(exc), 404)
        except requests.Timeout:
            return self._error("ServiceNow did not respond in time.", 504)
        except requests.ConnectionError:
            return self._error("Could not reach ServiceNow.", 503)
        except requests.HTTPError as exc:
            status_code = exc.response.status_code if exc.response is not None else 502
            return self._error(f"ServiceNow error while resolving incident: {status_code}", 502)
        except Exception as exc:
            return self._error(f"Unexpected error while resolving incident: {exc}", 500)

        if payload.get("category"):
            payload["category"] = self._val(payload.get("category")).lower()
        if payload.get("subcategory"):
            payload["subcategory"] = self._val(payload.get("subcategory")).lower()

        body = {
            key: value
            for key, value in payload.items()
            if key in self.PATCH_BY_NUMBER_ALLOWED_FIELDS
            and value is not None
            and self._val(value).strip() != ""
        }

        if not body:
            return self._error("No fields to update - provide at least one field besides number.", 400)

        try:
            self.sn_client.patch_incident(sys_id, body)
        except Exception as exc:
            log.error("[%s] ServiceNow PATCH failed: %s", sys_id, exc)
            return self._error(f"ServiceNow PATCH failed: {exc}", 502)

        updated_fields = list(body.keys())
        log.info("[%s / %s] ServiceNow PATCH ok fields=%s", number, sys_id, updated_fields)
        return jsonify(
            {
                "status": "ok",
                "number": number,
                "sys_id": sys_id,
                "fields_updated": updated_fields,
            }
        ), 200

    def preview_dag(self):
        """Returns the DAG payload that would be sent to Lyzr for validation only."""
        auth_error = self._validate_api_key()
        if auth_error:
            return auth_error

        payload = self._normalize_incident_payload(request.get_json(silent=True) or {})
        if not payload.get("sys_id") or not payload.get("number"):
            return self._error("'sys_id' and 'number' are required in request body.", 400)
        return jsonify(self.build_dag_payload(payload)), 200

    def receive_incident(self):
        auth_error = self._validate_api_key()
        if auth_error:
            return auth_error

        payload = self._normalize_incident_payload(request.get_json(silent=True) or {})
        if not payload.get("sys_id") or not payload.get("number"):
            return self._error("'sys_id' and 'number' are required in request body.", 400)

        expected_secret = self._val(self.sn_secret).strip()
        x_sn_secret = self._val(request.headers.get("X-SN-Secret", expected_secret)).strip()
        if not expected_secret or x_sn_secret != expected_secret:
            log.warning("Unauthorized webhook request - bad or missing X-SN-Secret header")
            return self._error("Unauthorized", 401)

        log.info(
            "[%s] Incident received event=%s category=%s priority=%s",
            payload.get("number", ""),
            payload.get("event_type", ""),
            payload.get("category", ""),
            payload.get("priority", ""),
        )

        threading.Thread(target=self.call_lyzr_dag, args=(payload,), daemon=True).start()
        return jsonify({"status": "accepted", "number": payload.get("number", "")}), 202
