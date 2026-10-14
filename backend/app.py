from datetime import datetime, timezone, timedelta
import hashlib
import os
import secrets
import string
import traceback
from flask import Flask, request, jsonify, json, Response, stream_with_context, send_file, abort, current_app
from html import escape
from bson import json_util
import uuid
from flask_cors import CORS
from session_manager import session_manager, require_session, get_current_user
from pydantic import BaseModel
import base64
import logging
import re
import requests
from json.decoder import JSONDecodeError
from flask_socketio import SocketIO, emit
from fastapi import HTTPException
##from werkzeug.middleware.proxy_fix import ProxyFix  # important behind reverse proxy
import time
from testcaseManage import TestCaseManager
from agentsManage import AgentManager
from agencyManage import AgencyManager
from UserManagement import UserManager
from agent import TestWorkflowManager
from knowledgeStoreManage import KnowledgeStoreManager
from lyzr_api_management import LyzrAPIManagement
from automation_library_api import AutomationLibraryAPI
from config_loader import config_loader
from commonutils import DatabaseCollections, CommonUtils
from middleware import setup_middlewares,logger
from database_manager import select_database_by_user_type
from workflow import WorkflowManager 
from pymongo import DESCENDING
from roleManage import RoleManager
from teamManage import TeamManager
import pytz
from utils import NotFoundError, buildResponse, ValidationError, log_data, ApiError, encrypt_data, AuthorizationError
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from typing import List, Dict, Any, Set
import concurrent
from altair import Dict
import pypandoc
from opensearchpy import OpenSearch, helpers
import pandas as pd
from json_repair import repair_json
import numpy as np
from pathlib import Path
from pymongo import MongoClient
import gridfs
# from gridfs import GridFS
from io import BytesIO
from bson.objectid import ObjectId
from concurrent.futures import ThreadPoolExecutor, as_completed
import websocket
import threading
from queue import Queue
from cryptography.fernet import Fernet
import io
from functools import wraps
from pymongo.errors import DuplicateKeyError
from collections import Counter
from sklearn.metrics.pairwise import cosine_similarity
from Prompt_Repository import PromptRepository
# from voice_agent import voice_bp
from trends_usecase import InsightsManager
from voice_agent import start_session,end_session
from agent_eval import AgentEval
from tool_call import DynamicToolExecutor
from tool_auth import ToolAuthService
import jwt
from external_app import ExternalApp
from ticket_functions import TicketFunctions
from api_key_auth import require_session_or_api_key, require_token_or_api_key

from servicenow_tool_executor import poller

pypandoc.__pandoc_path = config_loader.pandac_path

user_id = config_loader.USER_ID_LYZR
api_key = config_loader.API_KEY_LYZR
trend_agent_id = config_loader.TREND_AGENT_ID_LYZR
insight_agent_id = config_loader.INSIGHT_AGENT_ID_LYZR
insight_limit = config_loader.INSIGHT_LIMIT
snow_folder_path = "servicenow_tool_executor"

JWT_SECRET_KEY = config_loader.JWT_SECRET_KEY

class OTPDetails(BaseModel):
    EmployeeId: str | None = None
    EmailId: str

class OnboardResponseMessage(BaseModel):
    Success: bool
    Message: str | None = None


class SnowRequest(BaseModel):
    snow_action: str
    user_input: str
    user_id: str

def _is_sensitive_query(text: str) -> bool:
    """Return True when the query appears to include sensitive personal data."""
    lowered = text.lower()
    sensitive_patterns = [
        r'\bid\b',
        r'\bpassword is\b',
        r'\bsecret\b',
        r'\botp\b',
        r'\bpin\b',
        r'\bmobile\b',
        r'\bphone\b',
        r'\bemail\b',
        r'\baadhar\b',
        r'\bssn\b',
        r'\bcredit card\b',
        r'\bcvv\b'
    ]
    return any(re.search(pattern, lowered) for pattern in sensitive_patterns)


def _is_low_quality_query(text: str) -> bool:
    """Return True for short greetings, closers, and gibberish-like text."""
    lowered = text.lower()
    if lowered in {'hi', 'hello', 'hey', 'thanks', 'thank you', 'bye', 'goodbye', 'ok', 'okay', 'this is fine'}:
        return True

    if re.search(r'\b(bye|goodbye|thanks|thank you|see you|talk later|this is fine|fine)\b', lowered):
        return True

    word_count = len(text.split())
    alpha_count = sum(1 for ch in text if ch.isalpha())
    if word_count < 3 or alpha_count < 6:
        return True

    if any(token in lowered for token in ['eiu', 'hiv', 'uir', 'uie']):
        return True

    unique_chars = set(text.strip())
    if len(unique_chars) <= 2 and len(text) >= 8:
        return True

    return False


def _score_query(text: str) -> int:
    """Score the query by how much it looks like a useful initiating intent."""
    lowered = text.lower()
    score = min(len(text.split()), 10) * 2

    intent_words = ['create', 'generate', 'make', 'need', 'want', 'show', 'find', 'search', 'draft', 'report']
    if any(word in lowered for word in intent_words):
        score += 4

    topic_words = ['report', 'langchain', 'dashboard', 'workflow', 'document', 'test case', 'analysis', 'query']
    if any(word in lowered for word in topic_words):
        score += 3

    if len(text) >= 20:
        score += 2

    if lowered.startswith(('i want', 'can you', 'please', 'help me')):
        score += 2

    return score


def _is_sensitive_key(key: str) -> bool:
    """Return True when a JSON field name looks sensitive."""
    if not isinstance(key, str):
        return False

    normalized = key.strip().lower()
    sensitive_keywords = {
        'email', 'user_id', 'userid', 'first_name', 'firstname', 'last_name', 'lastname',
        'password', 'pass', 'secret', 'secrets', 'token', 'api_key', 'apikey', 'ssn','caller_id'
    }

    if normalized in sensitive_keywords:
        return True

    parts = re.split(r'[\s_\-.]+', normalized)
    if any(part in sensitive_keywords for part in parts):
        return True

    return any(keyword in normalized for keyword in ('email', 'password', 'secret', 'token', 'user', 'name'))


def _get_fernet() -> Fernet:
    key = config_loader.encryption_key
    if isinstance(key, str):
        key = key.encode('utf-8')
    return Fernet(key)


def _process_sensitive_value(value: Any, fernet: Fernet, action: str) -> Any:
    if value is None:
        return None

    if action == 'encrypt':
        if not isinstance(value, str):
            try:
                value = json.dumps(value)
            except Exception:
                value = str(value)
        return fernet.encrypt(value.encode('utf-8')).decode('utf-8')

    if action == 'decrypt':
        if not isinstance(value, str):
            return value
        try:
            decrypted = fernet.decrypt(value.encode('utf-8')).decode('utf-8')
            try:
                return json.loads(decrypted)
            except JSONDecodeError:
                return decrypted
        except Exception:
            return value

    raise ValueError("Action must be 'encrypt' or 'decrypt'.")


def _decrypt_embedded_fernet_tokens(value: Any, fernet: Fernet) -> Any:
    """Decrypt Fernet tokens embedded inside a larger string, if present."""
    if not isinstance(value, str) or "gAAAAA" not in value:
        return value

    token_pattern = re.compile(r"gAAAAA[A-Za-z0-9_-]+=*")

    def _replace(match: re.Match) -> str:
        token = match.group(0)
        try:
            decrypted = fernet.decrypt(token.encode("utf-8")).decode("utf-8")
            return decrypted
        except Exception:
            return token

    return token_pattern.sub(_replace, value)


def process_sensitive_fields(json_data: Any, action: str) -> Any:
    """Encrypt or decrypt sensitive fields inside a JSON-like object."""
    action = action.strip().lower() if isinstance(action, str) else ''
    if action not in {'encrypt', 'decrypt'}:
        raise ValueError("Action must be 'encrypt' or 'decrypt'.")

    fernet = _get_fernet()

    def _recurse(value: Any, parent_key: str | None = None) -> Any:
        if isinstance(value, dict):
            return {k: _recurse(v, k) for k, v in value.items()}

        if isinstance(value, list):
            return [_recurse(item, parent_key) for item in value]

        if parent_key and _is_sensitive_key(parent_key):
            return _process_sensitive_value(value, fernet, action)

        if action == 'decrypt':
            return _decrypt_embedded_fernet_tokens(value, fernet)

        return value

    return _recurse(json_data)


def find_top_initiating_queries(query_list: List[str], max_results: int = 3) -> List[str]:
    """
    Return up to `max_results` meaningful initiating user queries from a noisy list.

    Filters out short greetings, closing messages, gibberish, and sensitive
    information, then returns the top-scoring valid queries.
    """
    if not isinstance(query_list, list):
        return []

    normalized_queries = []
    for item in query_list:
        if not isinstance(item, str):
            continue

        cleaned = re.sub(r'\s+', ' ', item.strip())
        if not cleaned:
            continue

        if _is_sensitive_query(cleaned):
            continue

        if _is_low_quality_query(cleaned):
            continue

        if re.search(r'\d{4,}', cleaned):
            continue

        normalized_queries.append(cleaned)

    if not normalized_queries:
        return []

    seen = set()
    unique_queries = []
    for query in normalized_queries:
        dedupe_key = re.sub(r'\s+', ' ', query.strip().lower())
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        unique_queries.append(query)

    sorted_queries = sorted(unique_queries, key=_score_query, reverse=True)
    return sorted_queries[:max_results]


def find_initiating_query(query_list: List[str]) -> str | None:
    """
    Pick the most meaningful initiating user query from a noisy conversation list.

    The function filters out short greetings, closing messages, gibberish,
    and sensitive information, then returns the highest-scoring valid query.
    """
    suggestions = find_top_initiating_queries(query_list, max_results=1)
    return suggestions[0] if suggestions else None

# DatabaseManager replaced by DatabaseCollections in commonutils file

class PasswordManager:
    def __init__(self):
        self.secret_key = config_loader.SECRET_KEY
    
    def generate_hash(self, input_password, salt):
        combined = input_password + self.secret_key + salt
        hash_bytes = hashlib.sha256(combined.encode('utf-8')).digest()
        return base64.b64encode(hash_bytes).decode('utf-8')
    
    def pwd_are_equal(self, plain_input, stored_password, salt):
        try:
            new_hash = self.generate_hash(plain_input, salt)
            return new_hash == stored_password
        except Exception:
            return False
    
    def generate_password(self, length=12):
        lower = string.ascii_lowercase
        upper = string.ascii_uppercase
        digits = string.digits
        special = "!@#$%^&*_-=+"
        all_charsets = [lower, upper, digits, special]
        
        password_chars = []
        for _ in range(length):
            charset = secrets.choice(all_charsets)
            password_chars.append(secrets.choice(charset))
        
        return ''.join(password_chars)
    
    def create_salt(self, size: int) -> str:
        random_bytes = secrets.token_bytes(size)
        return base64.b64encode(random_bytes).decode('utf-8')

class ChatbotAgent(DatabaseCollections):
    def __init__(self):
        super().__init__()
        self.utils = CommonUtils()
        self.CONNECTORS_BASE_DIR = "tool_config"
        
    
    def _query_db(self, collection_name, operation, user_type=None):
        """Helper method to query database with user type"""
        if user_type is None:
            current_user = get_current_user()
            prj_name = current_user.get('ActiveProject', 'master') if current_user else 'master'
            
            project_doc = self.project.find_one({'projectName': prj_name})
            if not project_doc:
                user_type = 'master'  # fallback
            else:
                user_type = project_doc['database_name']
        
        return config_loader.query_db(
            collection_name,
            operation,
            condition_func=select_database_by_user_type,
            user_type=user_type
        )
     

    def lyzr_agent_urls(self):
        """Get Lyzr agent URL with trailing slash"""
        if str(config_loader.LYZR_AGENT_URL).endswith('/'):
            return config_loader.LYZR_AGENT_URL
        return config_loader.LYZR_AGENT_URL + '/'
    
     
    def get_agent_api_key_by_id(self, agent_id: str, workflow_id: str = None, user_type: str = 'master') -> str:
        # ✅ FIX: Use chatbot_agent._query_db with user_type
        find_op = {'type': 'find_one', 'filter': {"agent_id": agent_id}}
        agent_details = self.chatbot_agent._query_db('agent', find_op, user_type=user_type)
       
        if agent_details:
            api_key = agent_details.get('agent_api_key')
            if api_key:
                return api_key
       
        # Fallback to workflow_collection if needed
        if workflow_id:
            find_wf_op = {'type': 'find_one', 'filter': {"flow_id": workflow_id}}
            workflow_details = self.chatbot_agent._query_db('workflow_collection', find_wf_op, user_type=user_type)
            if workflow_details:
                api_key = workflow_details.get('api_key')
                if api_key:
                    return api_key
                # Check agents inside workflow
                agents = workflow_details.get('agents', [])
                for agent in agents:
                    if agent.get('agent_id') == agent_id:
                        agent_api_key = agent.get('agent_api_key')
                        if agent_api_key:
                            return agent_api_key
       
        raise NotFoundError("API key not found for agent")
 
    def _capture_websocket_metrics(self, session_id: str, api_key: str, metrics_list: list, duration: int = 8) -> None:
        """
        Capture WebSocket metrics for insights traces.
        Connects to the metrics WebSocket endpoint and collects metrics for the specified duration.
        
        Args:
            session_id: The session ID to connect to
            api_key: The API key for authentication
            metrics_list: List to populate with captured metrics
            duration: Duration in seconds to capture metrics (default: 8)
        """
        try:
            logger.info(f"[INSIGHTS METRICS] Starting WebSocket metrics capture for session_id: {session_id}")
            
            ws_url = f"wss://metrics.studio.lyzr.ai/ws/{session_id}?x-api-key={api_key}"
            collected_metrics = []
            ws_connection = None
            
            # WebSocket event handlers
            def on_message(ws, message):
                try:
                    metric_data = json.loads(message)
                    logger.info(f"[INSIGHTS METRICS] WebSocket message received: {json.dumps(metric_data, indent=2)}")
                    
                    metric_entry = {
                        "type": "metric",
                        "data": metric_data,
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    }
                    collected_metrics.append(metric_entry)
                    metrics_list.append(metric_entry)
                    
                except Exception as e:
                    logger.error(f"[INSIGHTS METRICS] Error parsing WebSocket message: {str(e)}")
                    logger.error(f"[INSIGHTS METRICS] Raw message: {message}")
            
            def on_error(ws, error):
                logger.error(f"[INSIGHTS METRICS] WebSocket error: {str(error)}")
                error_entry = {
                    "type": "error",
                    "message": str(error),
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
                collected_metrics.append(error_entry)
                metrics_list.append(error_entry)
            
            def on_close(ws, close_status_code, close_msg):
                logger.info(f"[INSIGHTS METRICS] WebSocket closed. Code: {close_status_code}, Message: {close_msg}")
                close_entry = {
                    "type": "control",
                    "message": "ws_closed",
                    "close_code": close_status_code,
                    "close_message": close_msg,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
                collected_metrics.append(close_entry)
                metrics_list.append(close_entry)
            
            def on_open(ws):
                logger.info(f"[INSIGHTS METRICS] WebSocket connection opened for session_id: {session_id}")
                open_entry = {
                    "type": "control",
                    "message": "ws_opened",
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
                collected_metrics.append(open_entry)
                metrics_list.append(open_entry)
            
            # Create and start WebSocket connection
            ws_connection = websocket.WebSocketApp(
                ws_url,
                on_message=on_message,
                on_error=on_error,
                on_close=on_close,
                on_open=on_open
            )
            
            ws_thread = threading.Thread(target=ws_connection.run_forever)
            ws_thread.daemon = True
            ws_thread.start()
            
            # Capture metrics for the specified duration
            end_time = time.time() + duration
            while time.time() < end_time:
                time.sleep(0.1)  # Small sleep to avoid busy waiting
            
            # Close WebSocket connection
            if ws_connection:
                ws_connection.close()
                logger.info(f"[INSIGHTS METRICS] WebSocket connection closed. Captured {len(metrics_list)} metric entries")
            
            # Wait for thread to finish
            if ws_thread and ws_thread.is_alive():
                ws_thread.join(timeout=2)
            
        except Exception as e:
            logger.error(f"[INSIGHTS METRICS] Error capturing WebSocket metrics: {str(e)}")
            logger.error(f"[INSIGHTS METRICS] Traceback: {traceback.format_exc()}")
            metrics_list.append({
                "type": "error",
                "message": f"WebSocket capture failed: {str(e)}",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
    
    def _fetch_agent_traces(self, agent_id: str, limit: int = 1, start_date: str = None, end_date: str = None) -> list:
        logger.info(f"[TRACE FETCH] Starting for agent_id: {agent_id}")
        
        try:
            api_key = self.get_agent_api_key_by_ids(agent_id)
            trace_url = f"{self.lyzr_agent_urls()}v3/traces"
            
            headers = {"x-api-key": api_key, "Content-Type": "application/json"}
            params = {"agent_id": agent_id, "limit": limit}
            
            if start_date:
                params["start_date"] = start_date
            if end_date:
                params["end_date"] = end_date
            
            logger.info(f"[TRACE FETCH] URL: {trace_url}")
            logger.info(f"[TRACE FETCH] Params: {params}")
            
            response = requests.get(trace_url, headers=headers, params=params, timeout=30)
            
            logger.info(f"[TRACE FETCH] Status: {response.status_code}")
            logger.info(f"[TRACE FETCH] Response: {response.text[:500]}")
            
            response.raise_for_status()
            
            raw_response = response.json()
            logger.info(f"[TRACE FETCH] Response type: {type(raw_response)}")
            
            if isinstance(raw_response, list):
                logger.info(f"[TRACE FETCH] Returning {len(raw_response)} traces")
                return [self._convert_trace_timestamps_to_utc(trace) for trace in raw_response]
 
            elif isinstance(raw_response, dict):
                traces = raw_response.get('data', raw_response.get('traces', []))
                logger.info(f"[TRACE FETCH] Extracted {len(traces)} traces from dict")
                return [self._convert_trace_timestamps_to_utc(trace) for trace in traces]
            else:
                logger.error(f"[TRACE FETCH] Unexpected format: {raw_response}")
                return []
            
        except Exception as e:
            logger.error(f"[TRACE FETCH] Error: {str(e)}")
            logger.error(f"[TRACE FETCH] Traceback: {traceback.format_exc()}")
            return []


    def _fetch_trace_detail(self, trace_id: str, agent_id: str) -> dict:
        logger.info(f"[TRACE DETAIL] Starting for trace_id: {trace_id}, agent_id: {agent_id}")
        
        try:
            api_key = self.get_agent_api_key_by_ids(agent_id)
            trace_detail_url = f"{self.lyzr_agent_urls()}v3/traces/{trace_id}"
            
            headers = {"x-api-key": api_key, "Content-Type": "application/json"}
            
            logger.info(f"[TRACE DETAIL] URL: {trace_detail_url}")
            
            response = requests.get(trace_detail_url, headers=headers, timeout=30)
            
            logger.info(f"[TRACE DETAIL] Status: {response.status_code}")
            logger.info(f"[TRACE DETAIL] Response: {response.text[:1000]}")
            
            response.raise_for_status()
            
            raw_data = response.json()
            logger.info(f"[TRACE DETAIL] Raw data keys: {raw_data.keys() if isinstance(raw_data, dict) else 'list'}")
            if isinstance(raw_data, dict):
                logger.info(f"[TRACE DETAIL] Chat messages in raw data: {raw_data.get('chat_messages', 'NOT FOUND')}")
            
            # Convert trace data timestamps to UTC
            trace_data = raw_data[0] if isinstance(raw_data, list) and raw_data else raw_data
            trace_data = self._convert_trace_timestamps_to_utc(trace_data)
            
            logger.info(f"[TRACE DETAIL] Trace data keys: {trace_data.keys()}")
            logger.info(f"[TRACE DETAIL] Chat messages in trace_data: {trace_data.get('chat_messages', 'NOT FOUND')}")
            
            # Format spans – extract only the required fields
            formatted_spans = []
            top_level_chat_messages = {}
            
            if "spans" in trace_data and isinstance(trace_data["spans"], list):
                logger.info(f"[TRACE DETAIL] Found {len(trace_data['spans'])} spans")
                for idx, span in enumerate(trace_data["spans"]):
                    # Extract input and output before removing them
                    span_attrs = span.get("SpanAttributes", {})
                    
                    logger.info(f"[TRACE DETAIL] Span {idx} - SpanName: {span.get('SpanName')}, SpanAttributes keys: {span_attrs.keys()}")
                    
                    input_value = span_attrs.get("input", "") or span_attrs.get("prompt", "") or span_attrs.get("query", "") or span_attrs.get("message", "")
                    output_value = span_attrs.get("output", "") or span_attrs.get("response", "") or span_attrs.get("result", "") or span_attrs.get("llm_output", "")
                    output_value = span_attrs.get("output", "") or span_attrs.get("response", "") or span_attrs.get("result", "") or span_attrs.get("llm_output", "")
                    
                    # Also check Events.Attributes for input/output
                    if not input_value or not output_value:
                        for event_attr in span.get("Events.Attributes", []):
                            if not input_value:
                                input_value = event_attr.get("input", "") or event_attr.get("prompt", "") or event_attr.get("query", "") or event_attr.get("message", "")
                            if not output_value:
                                output_value = event_attr.get("output", "") or event_attr.get("response", "") or event_attr.get("result", "") or event_attr.get("llm_output", "")
                    
                    # Create chat_messages if input or output exists
                    chat_messages = {}
                    if input_value or output_value:
                        chat_messages = {
                            "input_message": input_value,
                            "output_message": output_value
                        }
                        # Store first valid chat_messages for top-level response
                        if not top_level_chat_messages and (input_value or output_value):
                            top_level_chat_messages = chat_messages.copy()
                    
                    # Clean SpanAttributes – remove input, output, llm_output and other data fields
                    clean_attrs = span.get("SpanAttributes", {}).copy()
                    clean_attrs.pop("input", None)
                    clean_attrs.pop("output", None)
                    clean_attrs.pop("llm_output", None)
                    clean_attrs.pop("query", None)
                    clean_attrs.pop("message", None)
                    clean_attrs.pop("prompt", None)
                    clean_attrs.pop("response", None)
                    clean_attrs.pop("result", None)
                    
                    # Clean Events.Attributes – remove data fields from each object
                    clean_events_attrs = []
                    for attr in span.get("Events.Attributes", []):
                        clean_attr = attr.copy()
                        clean_attr.pop("query", None)
                        clean_attr.pop("input", None)
                        clean_attr.pop("output", None)
                        clean_attr.pop("message", None)
                        clean_attr.pop("prompt", None)
                        clean_attr.pop("response", None)
                        clean_attr.pop("result", None)
                        clean_events_attrs.append(clean_attr)
                    
                    formatted_span = {
                        "SpanName": span.get("SpanName", ""),
                        "SpanAttributes": clean_attrs,
                        "Events.Name": span.get("Events.Name", []),
                        "Events.Attributes": clean_events_attrs
                    }
                    
                    # Add chat_messages if it has content
                    if chat_messages: 
                        formatted_span["chat_messages"] = chat_messages
                    
                    formatted_spans.append(formatted_span)
        
            logger.info(f"[TRACE DETAIL] Returning {len(formatted_spans)} spans")
            logger.info(f"[TRACE DETAIL] Top-level chat_messages: {top_level_chat_messages}")
            
            # Build the response with top-level chat_messages and real_time_logs
            # Use extracted chat_messages if top-level is empty
            final_chat_messages = trace_data.get("chat_messages", {})
            if not final_chat_messages or (isinstance(final_chat_messages, dict) and not final_chat_messages):
                final_chat_messages = top_level_chat_messages
            
            response_data = {
                "spans": formatted_spans,
                "chat_messages": final_chat_messages,
                "real_time_logs": trace_data.get("real_time_logs", []),
                "span_count": len(formatted_spans),
                "trace_id": trace_data.get("trace_id", trace_id),
                "agent_id": trace_data.get("agent_id", ""),
                "agent_name": trace_data.get("agent_name", ""),
                "llm_provider": trace_data.get("llm_provider", ""),
                "language_model": trace_data.get("language_model", ""),
                "latency_ms": trace_data.get("latency_ms", 0),
                "cost": trace_data.get("cost", 0),
                "total_tokens": trace_data.get("total_tokens", 0),
                "input_messages": trace_data.get("input_messages", []),
                "output_messages": trace_data.get("output_messages", {})
            }
            
            logger.info(f"[TRACE DETAIL] Response chat_messages: {response_data['chat_messages']}")
            return response_data
        
        except Exception as e:
            logger.error(f"[TRACE DETAIL] Error: {str(e)}")
            logger.error(f"[TRACE DETAIL] Traceback: {traceback.format_exc()}")
            return {}



    def mask_pii_sensitive_data(self, text):
        """Masks PII, URLs, and sensitive business data partially using asterisks (***)."""
        # If the tool returned a dictionary/list, convert it to a JSON string first
        if isinstance(text, (dict, list)):
            text = json.dumps(text)
        elif not isinstance(text, str):
            text = str(text)

        # 1. Mask URLs / Links (Keep scheme, partial host)
        # e.g., "https://www.example.com/path" -> "https://ww***.com/path"
        def _mask_url(m):
            url = m.group(0)
            if "://" in url:
                scheme, rest = url.split("://", 1)
                if len(rest) > 6:
                    return f"{scheme}://{rest[:2]}***{rest[-4:]}"
                return f"{scheme}://***"
            return url[:3] + "***"

        url_pattern = r"https?://(?:[-\w.]|(?:%[\da-fA-F]{2}))+[/\w\.-]*"
        text = re.sub(url_pattern, _mask_url, text)

        # 2. Mask Email Addresses (Keep 1st & last char of username + domain extension)
        # e.g., "john.doe@example.com" -> "j***e@e***.com"
        def _mask_email(m):
            user, domain = m.group(1), m.group(2)

            # Mask Username
            masked_user = (
                f"{user[0]}***{user[-1]}" if len(user) > 2 else f"{user[0]}***"
            )

            # Mask Domain
            if "." in domain:
                host, tld = domain.rsplit(".", 1)
                masked_host = (
                    f"{host[0]}***{host[-1]}" if len(host) > 2 else f"{host[0]}***"
                )
                return f"{masked_user}@{masked_host}.{tld}"
            return f"{masked_user}@{domain}"

        email_pattern = r"([a-zA-Z0-9_.+-]+)@([a-zA-Z0-9-.]+)"
        text = re.sub(email_pattern, _mask_email, text)

        # 3. Mask Phone Numbers (Keep only last 4 digits)
        # e.g., "+1 (555) 019-2834" -> "*** (***) ***-2834"
        def _mask_phone(m):
            s = m.group(0)
            digits = [c for c in s if c.isdigit()]
            total_digits = len(digits)

            digit_count = 0
            res = []
            for char in s:
                if char.isdigit():
                    digit_count += 1
                    # Replace all digits except the last 4 with '*'
                    if digit_count <= total_digits - 4:
                        res.append("*")
                    else:
                        res.append(char)
                else:
                    res.append(char)
            return "".join(res)

        phone_pattern = r"(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}"
        text = re.sub(phone_pattern, _mask_phone, text)

        # 4. Mask Credit Card Numbers (Keep first 4 and last 4 digits)
        # e.g., "1234-5678-9012-3456" -> "1234-****-****-3456"
        def _mask_card(m):
            s = m.group(0)
            digits = [c for c in s if c.isdigit()]
            total_digits = len(digits)

            digit_count = 0
            res = []
            for char in s:
                if char.isdigit():
                    digit_count += 1
                    # Keep first 4 and last 4 digits visible
                    if 4 < digit_count <= total_digits - 4:
                        res.append("*")
                    else:
                        res.append(char)
                else:
                    res.append(char)
            return "".join(res)

        cc_pattern = r"\b(?:\d[ -]*?){13,16}\b"
        text = re.sub(cc_pattern, _mask_card, text)

        # 5. Mask UUIDs / API Keys (Keep first 4 and last 4 characters)
        # e.g., "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" -> "a0ee****-****-****-****-****380a11"
        def _mask_uuid(m):
            s = m.group(0)
            return f"{s[:4]}****-****-****-****-****{s[-4:]}"

        uuid_pattern = r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"
        text = re.sub(uuid_pattern, _mask_uuid, text)

        return text
    
    # def mask_pii_sensitive_data(self,text):
        
    #     # If the tool returned a dictionary/list, convert it to a JSON string first
    #     if isinstance(text, (dict, list)):
    #         text = json.dumps(text)
    #     elif not isinstance(text, str):
    #         text = str(text)

    #     # 1. Mask URLs / Links
    #     url_pattern = r'https?://(?:[-\w.]|(?:%[\da-fA-F]{2}))+[/\w\.-]*'
    #     text = re.sub(url_pattern, '[REDACTED_LINK]', text)

    #     # 2. Mask Email Addresses
    #     email_pattern = r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+'
    #     text = re.sub(email_pattern, '[REDACTED_EMAIL]', text)

    #     # 3. Mask Phone Numbers (Basic international and US formats)
    #     phone_pattern = r'(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}'
    #     text = re.sub(phone_pattern, '[REDACTED_PHONE]', text)

    #     # 4. Mask Credit Card Numbers (14-16 digits, with or without dashes)
    #     cc_pattern = r'\b(?:\d[ -]*?){13,16}\b'
    #     text = re.sub(cc_pattern, '[REDACTED_CARD]', text)

    #     # 5. Mask UUIDs / Business API Keys / Tokens (e.g., a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11)
    #     uuid_pattern = r'\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b'
    #     text = re.sub(uuid_pattern, '[REDACTED_ID]', text)

    #     # Add any custom business Regex here (e.g., custom employee ID formats)
    #     # emp_id_pattern = r'\bEMP-\d{5}\b'
    #     # text = re.sub(emp_id_pattern, '[REDACTED_EMP_ID]', text)

    #     return text

    def _extract_tool_call(self, response_payload):
        """Extract a tool call object from mixed Lyzr response payload formats."""

        def normalize_tool_call(candidate):
            if isinstance(candidate, dict):
                if candidate.get("tool_name"):
                    arguments = candidate.get("arguments", {})
                    if isinstance(arguments, str):
                        try:
                            arguments = json.loads(arguments)
                        except Exception:
                            arguments = {"value": arguments}
                    return {
                        "tool_name": candidate.get("tool_name"),
                        "arguments": arguments if isinstance(arguments, dict) else {},
                    }

                # Handle tool call envelope used by some providers.
                if candidate.get("type") == "tool_call" and candidate.get("name"):
                    arguments = candidate.get("arguments", {})
                    if isinstance(arguments, str):
                        try:
                            arguments = json.loads(arguments)
                        except Exception:
                            arguments = {"value": arguments}
                    return {
                        "tool_name": candidate.get("name"),
                        "arguments": arguments if isinstance(arguments, dict) else {},
                    }

                function_payload = candidate.get("function")
                if isinstance(function_payload, dict) and function_payload.get("name"):
                    function_args = function_payload.get("arguments", {})
                    if isinstance(function_args, str):
                        try:
                            function_args = json.loads(function_args)
                        except Exception:
                            function_args = {"value": function_args}
                    return {
                        "tool_name": function_payload.get("name"),
                        "arguments": function_args if isinstance(function_args, dict) else {},
                    }

            return None

        def parse_json_from_text(text):
            if not isinstance(text, str):
                return []

            candidates = []
            stripped = text.strip()
            if not stripped:
                return candidates

            # Parse the full string first.
            try:
                parsed = json.loads(stripped)
                candidates.append(parsed)
            except Exception:
                pass

            # Parse fenced JSON blocks (```json ... ```).
            for block in re.findall(
                r"```(?:json)?\s*([\s\S]*?)\s*```", stripped, flags=re.IGNORECASE
            ):
                candidate_text = block.strip()
                if not candidate_text:
                    continue
                try:
                    candidates.append(json.loads(candidate_text))
                    continue
                except Exception:
                    pass
                try:
                    repaired = repair_json(candidate_text)
                    candidates.append(json.loads(repaired))
                except Exception:
                    pass

            # Parse possible inline JSON objects by balancing braces.
            for start_idx, char in enumerate(stripped):
                if char != "{":
                    continue

                depth = 0
                in_string = False
                escaped = False

                for end_idx in range(start_idx, len(stripped)):
                    ch = stripped[end_idx]

                    if escaped:
                        escaped = False
                        continue

                    if ch == "\\":
                        escaped = True
                        continue

                    if ch == '"':
                        in_string = not in_string
                        continue

                    if in_string:
                        continue

                    if ch == "{":
                        depth += 1
                    elif ch == "}":
                        depth -= 1
                        if depth == 0:
                            snippet = stripped[start_idx : end_idx + 1]
                            try:
                                candidates.append(json.loads(snippet))
                            except Exception:
                                try:
                                    repaired = repair_json(snippet)
                                    candidates.append(json.loads(repaired))
                                except Exception:
                                    pass
                            break

            return candidates

        visited = set()
        stack = [response_payload]

        while stack:
            item = stack.pop()
            item_id = id(item)
            if item_id in visited:
                continue
            visited.add(item_id)

            normalized = normalize_tool_call(item)
            if normalized:
                return normalized

            if isinstance(item, dict):
                # Prioritize common response fields first.
                priority_keys = ["content", "response", "message", "data", "output", "text"]
                for key in priority_keys:
                    if key in item:
                        stack.append(item.get(key))
                for value in item.values():
                    stack.append(value)
            elif isinstance(item, list):
                for value in item:
                    stack.append(value)
            elif isinstance(item, str):
                for parsed_item in parse_json_from_text(item):
                    stack.append(parsed_item)

        return None
        
    def run_lyzr(
    self,
    user_input: str,
    user_id: str,
    lyzr_api_key: str,
    lyzr_agent_id: str,
    session_id: str,
    event_id: str,
    step_callback=None
):
        
        # session_id = f"session-{user_id}-{int(time.time())}"
       
        ws_url = (
            f"wss://metrics.studio.lyzr.ai/ws/{session_id}?x-api-key={lyzr_api_key}"
        )

        log_queue = Queue()
        collected_logs = []
        ws_thread = None
        ws = None
        is_snow_folder_created = False
        servicenow_request_detected = False
        
        def safe_json_loads(value):
            """
            Safely parse JSON.
            Returns:
                dict/list if valid JSON
                original value otherwise
            """
            if not isinstance(value, str):
                return value

            value = value.strip()

            if not value:
                return {}

            try:
                return json.loads(value)
            except Exception:
                return value

        # Helper generator to drain and yield ONLY WebSocket logs in real-time
        def flush_log_queue():
            while not log_queue.empty():
                log_entry = log_queue.get()
                if log_entry.get("type") == "log":
                    yield f"data: {json.dumps({'type': 'log', 'data': log_entry['data']})}\n\n"
                elif log_entry.get("type") == "error":
                    yield f"data: {json.dumps({'type': 'ws_error', 'message': log_entry['message']})}\n\n"

        # Helper to execute blocking tasks in a background thread while continuously yielding runtime logs
        def execute_and_stream_logs(target_func, *args, **kwargs):
            result_container = {}
            error_container = {}

            def worker():
                try:
                    result_container["result"] = target_func(*args, **kwargs)
                except Exception as e:
                    error_container["error"] = e

            thread = threading.Thread(target=worker)
            thread.start()

            # While task runs in background, yield real-time logs to UI
            while thread.is_alive():
                yield from flush_log_queue()
                time.sleep(0.1)

            thread.join()
            yield from flush_log_queue()

            if "error" in error_container:
                raise error_container["error"]

            return result_container.get("result")

        # ------------------------------------------------------------------
        # 1. WEBSOCKET HANDLERS
        # ------------------------------------------------------------------
        def on_message(ws_inst, message):
            try:                
                log_data = json.loads(message)
                print("\n=== WEBSOCKET LOG RECEIVED ===")
                # print(json.dumps(log_data, indent=2))
                print("===============================\n")

                log_entry = {
                    "type": "log",
                    "data": log_data,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                log_queue.put(log_entry)
                collected_logs.append(log_data)
                
                nonlocal is_snow_folder_created
                nonlocal servicenow_request_detected
                # if ( not is_snow_folder_created
                #     and log_data.get("event_type") == "tool_output"
                #     and "STATEFUL" in log_data.get("tool_output", "").upper()
                # ):
                
                if log_data.get("event_type") in ["tool_call_prepare", "tool_called"]:

                    msg = ""

                    if "arguments" in log_data:
                        msg = log_data.get("arguments", {}).get("message", "")

                    elif "tool_input" in log_data:
                        msg = log_data.get("tool_input", "")

                    parsed = safe_json_loads(msg)

                    if isinstance(parsed, dict):
                        if parsed.get("request") in ("SERVICENOW__CREATE_INCIDENT","SERVICENOW__UPDATE_INCIDENT"):
                            
                            servicenow_request_detected = True
                            
                            is_snow_folder_created = True
                    
                            # Use current application directory                    
                            backend_dir = os.path.abspath(snow_folder_path)

                            folder_path = os.path.join(
                                backend_dir,
                                "ServiceNowstate"
                            )

                            os.makedirs(folder_path, exist_ok=True)

                            file_path = os.path.join(
                                folder_path,
                                "SNow_tool_output.json"
                            )

                            # Inputs
                            short_description = user_input
                            description = f"User is experiencing a {user_input}"
                            caller_id = user_id or "mohamed.luthufullah@revlon.com"

                            # Auto-generated values
                            now = datetime.now()

                            request_id = f"REQ-{now.strftime('%Y-%m-%d')}-001"
                            client_ref = f"create-{now.strftime('%Y%m%d%H%M%S')}"

                            inputdata = {
                                "request_id": request_id,
                                "tickets": [
                                    {
                                        "client_ref": client_ref,
                                        "action": "create",
                                        "ticket_type": "incident",
                                        "fields": {
                                            "short_description": short_description,
                                            "description": description,
                                            "urgency": "3",
                                            "impact": "3",
                                            "caller_id": caller_id
                                        }
                                    }
                                ]
                            }

                            with open(file_path, "w", encoding="utf-8") as f:
                                json.dump(inputdata, f, indent=4, ensure_ascii=False)

                            print("=" * 80)
                            print(f"Current Working Directory : {backend_dir}")
                            print(f"Created Folder           : {folder_path}")
                            print(f"Created File             : {file_path}")
                            print(f"Folder Exists            : {os.path.isdir(folder_path)}")
                            print(f"File Exists              : {os.path.isfile(file_path)}")
                            print("=" * 80)
                            
                            print("✅ SERVICENOW__CREATE_OR_UPDATE_INCIDENT detected")
                
            except Exception as e:
                print(f"Error parsing WebSocket message: {e}")

        def on_error(ws_inst, error):
            print(f"🚨 WebSocket error: {error}")
            log_queue.put(
                {
                    "type": "error",
                    "message": str(error),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            )

        def on_close(ws_inst, close_status_code, close_msg):
            print(
                f"❌ WebSocket closed. Code: {close_status_code}, Message: {close_msg}"
            )

        def on_open(ws_inst):
            print("✅ WebSocket connection opened")

        # Start WebSocket thread
        try:
            ws = websocket.WebSocketApp(
                ws_url,
                on_message=on_message,
                on_error=on_error,
                on_close=on_close,
                on_open=on_open,
            )
            ws_thread = threading.Thread(target=ws.run_forever)
            ws_thread.daemon = True
            ws_thread.start()
            time.sleep(1)
        except Exception as e:
            print(f"Failed to initialize WebSocket: {e}")

        # ------------------------------------------------------------------
        # 2. PROMPT & TOOLS PREPARATION
        # ------------------------------------------------------------------
        context = self._get_agent_context(lyzr_agent_id)
        raw_tools_docs = context.get("raw_tools_docs", [])

        user_data = self.user_collection.find_one({
            "Email": re.compile(f"^{re.escape(user_id.lower())}$", re.IGNORECASE),
            "IsActive": True,
            "IsDelete": False
        },{"_id": 0, "Email": 1, "FirstName": 1, "LastName": 1})

        encrypted_user_data = process_sensitive_fields(user_data,"encrypt")
        print("Encrypted user data:", encrypted_user_data)

        current_message = user_input
        #current_message = tools_prompt + "\nUser Query:" + user_input
        final_input_message = current_message
        max_rounds = 10
        final_content = ""

        try:
            # ------------------------------------------------------------------
            # 3. AGENT CALL & TOOL EXECUTION LOOP
            # ------------------------------------------------------------------
            for round_num in range(max_rounds):

                def call_lyzr_api(msg):
                    print(f"User_msg========: {msg}")
                    headers = {
                        "x-api-key": lyzr_api_key,
                        "Content-Type": "application/json",
                    }
                    agent_api_base = getattr(
                        config_loader,
                        "LYZR_AGENT_URL",
                        "https://agent-prod.studio.lyzr.ai",
                    )
                    payload = {
                        "user_id": user_id,
                        "agent_id": lyzr_agent_id,
                        "session_id": session_id,
                        "message": msg,
                    }
                    res = requests.post(
                        f"{agent_api_base}/v3/inference/chat/",
                        headers=headers,
                        json=payload,
                    )
                    return res.json()

                # Call Lyzr API while continuously streaming runtime logs
                response_json = yield from execute_and_stream_logs(
                    call_lyzr_api, current_message
                )
                print(f"agent_response - Round {round_num + 1} Response:", response_json)

                if isinstance(response_json, dict):
                    content = (
                        response_json.get("content")
                        or response_json.get("response")
                        or response_json.get("message")
                        or str(response_json)
                    )
                else:
                    content = str(response_json)
                print("Agent response content:", content)
                
                print(f"Response from the first agent----: {response_json}")

                if servicenow_request_detected:
                    print("Found SNow state in response")
                    servicenow_request_detected = False
                    state_dir = Path(snow_folder_path) / "ServiceNowstate"

                    folders = [
                            state_dir / "_processing",
                            state_dir / "_processed",
                            state_dir / "_failed"
                    ]

                    result_files = []

                    for folder in folders:
                        if folder.exists():
                            result_files.extend(folder.glob("*.result.json"))

                    if not result_files:
                        print("No result files found")
                    else:
                        latest_file = max(
                            result_files,
                            key=lambda f: f.stat().st_mtime
                        )

                        print("Latest result file:", latest_file)

                        with open(latest_file, "r", encoding="utf-8") as f:
                            data = json.load(f)

                        print(f"Data from latest ServiceNow file: {data}")
                        current_message = f"ServiceNow Tool executed successfully.\nResult: {data}\n\nContinue with the next step tool call if required or give final answer."

                else:
                    # Final answer ready
                    final_content = content
                    break

            # ------------------------------------------------------------------
            # 4. FETCH TRACE DETAILS (WHILE YIELDING RUNTIME LOGS)
            # ------------------------------------------------------------------
            time.sleep(2)

            def fetch_trace_data():
                agent_api_base = getattr(
                    config_loader,
                    "LYZR_AGENT_URL",
                    "https://agent-prod.studio.lyzr.ai",
                )
                trace_url = f"{agent_api_base}/v3/traces"
                trace_headers = {
                    "x-api-key": lyzr_api_key,
                    "Content-Type": "application/json",
                }
                trace_params = {
                    "agent_id": lyzr_agent_id,
                    "limit": 1,
                    "sort": "desc",
                }

                max_retries = 5
                retry_delay = 1

                for retry in range(max_retries):
                    try:
                        trace_response = requests.get(
                            trace_url, headers=trace_headers, params=trace_params
                        )
                        trace_response.raise_for_status()
                        traces = trace_response.json()

                        if traces and len(traces) > 0:
                            latest_trace = traces[0]
                            trace_id = latest_trace.get("trace_id")

                            if trace_id:
                                detail_response = requests.get(
                                    f"{trace_url}/{trace_id}", headers=trace_headers
                                )
                                detail_response.raise_for_status()
                                trace_details = detail_response.json()

                                if isinstance(trace_details, list):
                                    trace_details = (
                                        trace_details[0] if trace_details else {}
                                    )

                                spans = trace_details.get("spans", [])
                                our_session = False

                                for span in spans:
                                    span_attrs = span.get("SpanAttributes", {})
                                    if (
                                        span_attrs.get("session_id") == session_id
                                        or (
                                            span_attrs.get("input")
                                            and user_input
                                            in str(span_attrs.get("input", ""))
                                        )
                                    ):
                                        our_session = True
                                        break

                                if our_session:
                                    formatted_spans = []
                                    for span in spans:
                                        clean_attrs = span.get(
                                            "SpanAttributes", {}
                                        ).copy()
                                        clean_attrs.pop("input", None)
                                        clean_attrs.pop("output", None)
                                        clean_attrs.pop("llm_output", None)

                                        clean_events_attrs = []
                                        for attr in span.get(
                                            "Events.Attributes", []
                                        ):
                                            clean_attr = attr.copy()
                                            clean_attr.pop("query", None)
                                            clean_events_attrs.append(clean_attr)

                                        original_attrs = span.get(
                                            "SpanAttributes", {}
                                        )
                                        input_msg = original_attrs.get("input", "")
                                        output_msg = original_attrs.get(
                                            "output", ""
                                        )

                                        formatted_span = {
                                            "SpanName": span.get("SpanName", ""),
                                            "SpanAttributes": clean_attrs,
                                            "Events.Name": span.get(
                                                "Events.Name", []
                                            ),
                                            "Events.Attributes": clean_events_attrs,
                                            "chat_messages": {
                                                "input_message": user_input,
                                                "output_message": final_content,
                                            },
                                        }
                                        formatted_spans.append(formatted_span)

                                    return [
                                        {
                                            "trace_id": trace_id,
                                            "details": {
                                                "spans": formatted_spans,
                                                "trace_id": trace_id,
                                            },
                                        }
                                    ]
                    except Exception as e:
                        print(
                            f"Attempt {retry + 1} trace fetch error: {e}"
                        )

                    time.sleep(retry_delay * (retry + 1))
                return []

            trace_details_data = yield from execute_and_stream_logs(
                fetch_trace_data
            )

            # ------------------------------------------------------------------
            # 5. SEND FINAL RESPONSE AND TRACES AT THE VERY END
            # ------------------------------------------------------------------
            yield from flush_log_queue()

            final_payload = {
                "type": "final_response",
                "data": {
                    "response": final_content,
                    "session_id": session_id,
                    "trace_details": trace_details_data,
                },
            }
            self.chatbot_agent = self
            FlaskApp.update_chat_messages(self, event_id, session_id, final_content, trace_details_data, collected_logs,final_input_message)
            delattr(self, 'chatbot_agent')
            yield f"data: {json.dumps(final_payload)}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

        finally:
            # Flush remaining logs and close WebSocket
            time.sleep(1)
            yield from flush_log_queue()

            if ws and ws_thread and ws_thread.is_alive():
                try:
                    ws.close()
                    ws_thread.join(timeout=3)
                except Exception as e:
                    print(f"Error closing WebSocket: {e}")

            yield "data: [DONE]\n\n"

    def to_standard_json_schema(self,active_tool_doc: dict) -> list:
        tool_key = active_tool_doc.get("tool_key", {})
        standard_schemas = []

        if "functions" in tool_key:
            for func in tool_key["functions"]:
                if func.get("active", True):
                    standard_schemas.append({
                        "name": func.get("name", active_tool_doc.get("tool_action_name", "")),
                        "description": func.get("description", active_tool_doc.get("description", "")),
                        "parameters": func.get("parameters", {
                            "type": "object",
                            "properties": {},
                            "required": []
                        })
                    })
            return standard_schemas

        parameter_doc = active_tool_doc.get("parameter")
        if isinstance(parameter_doc, dict):
            parameters = parameter_doc.get("parameters", {
                "type": "object",
                "properties": {},
                "required": []
            })
            standard_schemas.append({
                "name": parameter_doc.get("name", active_tool_doc.get("tool_action_name", "")),
                "description": parameter_doc.get("description", active_tool_doc.get("description", "")),
                "parameters": parameters
            })

        return standard_schemas

    
    def _get_agent_context(self, agent_id: str) -> dict:
        agent = self.agent_collection.find_one({"api_agent_id": agent_id})
        if not agent:
            raise ValueError(f"Agent {agent_id} not found.")

        system_prompt = f"Role: {agent.get('agent_role', '')}\nGoal: {agent.get('agent_goal', '')}\nInstructions: {agent.get('agent_prompt', '')}"
        tool_ids = agent.get("internal_tool", [])
        print(f"Fetching tools for agent {agent_id}: {tool_ids}")
        active_tools = []
        compiled_schemas = []
        
        # Cache to prevent reading the same functions.json multiple times 
        # if an agent has multiple tools from the same connector
        file_cache = {}

        for tid in tool_ids:
            try:
                tool_doc = self.active_tool_collection.find_one({"_id": ObjectId(tid)})
                if not tool_doc:
                    continue

                connector_type = tool_doc.get("connector_type")
                tool_name = tool_doc.get("tool_action_name")
                tool_type = str(tool_doc.get("tool_type") or tool_doc.get("type", "default")).strip().lower()
                print("tool_type:", tool_type, "tool_name:", tool_name)
                if tool_type == "custom":
                    parameter_doc = tool_doc.get("parameter")
                    if isinstance(parameter_doc, dict):
                        protocol_data = parameter_doc.get("protocol_data", {})
                        tool_doc["tool_key"] = {
                            "functions": [{
                                "name": parameter_doc.get("name") or tool_name,
                                "description": parameter_doc.get("description") or tool_doc.get("description", ""),
                                "parameters": parameter_doc.get("parameters", {
                                    "type": "object",
                                    "properties": {},
                                    "required": []
                                }),
                                "protocol_data": {
                                    "method": protocol_data.get("method", "GET"),
                                    "path": protocol_data.get("path", ""),
                                    "server_url": protocol_data.get("server_url", ""),
                                    "headers": protocol_data.get("headers", {"Content-Type": "application/json"}),
                                    "timeout": protocol_data.get("timeout", 15)
                                },
                                "active": parameter_doc.get("active", True)
                            }]
                        }
                    else:
                        print(f"Warning: Custom tool '{tool_name}' is missing parameter schema in active_tool_collection")
                        continue
                elif connector_type and tool_name:
                    # 1. Load the JSON file for this connector (using cache)
                    if connector_type not in file_cache:
                        # Assuming your file is named 'functions.json' or 'function.json'
                        file_path = os.path.join(self.CONNECTORS_BASE_DIR, connector_type, "function.json")
                        print("Loading schema from:", file_path)
                        
                        if os.path.exists(file_path):
                            with open(file_path, 'r', encoding='utf-8') as f:
                                file_cache[connector_type] = json.load(f)
                        else:
                            print(f"Warning: Schema file not found at {file_path}")
                            continue
                    
                    connector_data = file_cache[connector_type]

                    # 2. Find the specific function schema by tool_name
                    target_function = None
                    for func in connector_data.get("functions", []):
                        if func.get("name") == tool_name:
                            target_function = func
                            break
                    
                    if target_function:
                        # 3. Inject the tool_key back into the tool_doc dynamically 
                        # so `to_standard_json_schema()` continues to work normally
                        tool_doc["tool_key"] = {
                            "security_schemes": connector_data.get("security_schemes", {}),
                            "functions": [target_function]
                        }
                    else:
                        print(f"Warning: Tool '{tool_name}' not found in {connector_type} functions.json")
                        continue

                active_tools.append(tool_doc)
                # Now that tool_doc has the "tool_key" attached, this will work seamlessly
                compiled_schemas.extend(self.to_standard_json_schema(tool_doc))

            except Exception as e:
                print(f"Error processing tool {tid}: {str(e)}")
                continue

        return {
            "system_prompt": system_prompt,
            "tools": compiled_schemas,
            "raw_tools_docs": active_tools
        }

   
        
    def process_request(self, request, data, has_prompt_title=False):
        """Process chatbot request with optional prompt_title and agency_id"""
        print("Processing chatbot request...")
        
        base_dir = snow_folder_path
        file_path = os.path.join(base_dir, "ServiceNowstate", "SNow_tool_output.json")

        file_data = {}

        if os.path.exists(file_path):
            with open(file_path, "r", encoding="utf-8") as f:
                file_data = json.load(f)

            print("File data:", file_data)
        else:
            print(f"File not found: {file_path}")        
        
        user_query = data.get('userQuery', "")
        agent_id = data.get('agent_id', "")
        master_agent_id = data.get('master_agent_id', "")
        user_id = data.get('user_id', '')
        prompt_title = data.get('prompt_title', '') if has_prompt_title else None
        agency_id = ""  # Initialize as empty, will be fetched later
        event_id = data.get('event_id', "")
        map_id = data.get('map_id',"")
        isSavedToRepo = data.get('isSavedToRepo', "")

        session_id = data.get('session_id')
            
        if not session_id:
            session_id = self.utils.generate_uuid()
            print(f"🆕 New session_id generated: {session_id}")
        else:
            print(f"♻️ Using session_id: {session_id}")

        # ================================================

        # Fetch agency_id from agent_agency_mapping_collection
        try:
            # Check if master_agent_id exists and is active
            if master_agent_id:
                master_agent_doc = self.agent_collection.find_one(
                    {"agent_id": master_agent_id, "status": "active"}
                )
                if master_agent_doc:
                    # Get agency_id from agent_agency_mapping_collection
                    mapping_doc = self.agent_agency_mapping_collection.find_one(
                        {"agent_id": master_agent_id, "status": "active"}
                    )
                    if mapping_doc:
                        agency_id = mapping_doc.get("agency_id", "")
                        print(f"Found agency_id: {agency_id} for master_agent_id: {master_agent_id}")
                    else:
                        print(f"No active mapping found for master_agent_id: {master_agent_id}")
                else:
                    print(f"No active master agent found for: {master_agent_id}")
            else:
                print("No master_agent_id provided in the request")
        except Exception as e:
            print(f"Error fetching agency_id: {str(e)}")

        # Prepare the new event document to be inserted into chatbot_tracking
        new_event = {
            "event_id": event_id,
            "user_query": user_query,
            "prompt_title": prompt_title,  # Add this field if present
            "prompt_output": "",
            "agent_id": agent_id,
            "agency_id": agency_id,  # <-- Fetched from agent_agency_mapping_collection
            "status": "inprogress",
            "session_id": session_id,
            "feedback_rating": data.get("feedback_rating"),
            "feedback_comments": data.get("feedback_comments", ""),
            "created_ts": self.utils.get_current_timestamp(),
            "updated_ts": self.utils.get_current_timestamp(),
            "user_id": user_id,
            "map_id": map_id,
            "master_agent_id": master_agent_id,
            "isSavedToRepo" :isSavedToRepo
            
        }

        # Insert into chatbot_tracking
        insert_event_op = {'type': 'insert_one', 'document': new_event}
        self._query_db('chatbot_tracking', insert_event_op)

        tool_res = self.agent_collection.find_one({'agent_id':agent_id})
        print(f"Tool response fetched for agent_id {agent_id}")
        custom_tool_config = tool_res.get("Iscustomtool",'')
        internal_tool_data = tool_res.get("internal_tool", [])
        print(f"Custom tool configuration: {custom_tool_config}")
        if internal_tool_data:
            print("Custom tool configuration detected. Using agent_api_key from agent collection.")
            api_key = tool_res.get("agent_api_key")
            # session_id = data.get('session_id')
            # return self.run_lyzr(
               
            #     user_input=user_query,
            #     user_id=user_id,
            #     lyzr_api_key=api_key,
            #     lyzr_agent_id=agent_id,
            #     session_id=session_id,
            #     event_id=event_id
            # )
            return Response(
                stream_with_context(
                    self.run_lyzr(
                        user_input=user_query,
                        user_id=user_id,
                        lyzr_api_key=api_key,
                        lyzr_agent_id=agent_id,
                        session_id=session_id,
                        event_id=event_id
                    )
                ),
                mimetype="text/event-stream",
                headers={
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no"
                }
            )
        else:
            
    
            # ================================================
            # SESSION ID MANAGEMENT (Simple & Clean)
            # ================================================
            
    
            try:
                agent_data = json.loads(json_util.dumps(self.agent_collection.find_one({"agent_id": agent_id})))
                doc_id = agent_data.get("_id")["$oid"]
                print(f"Agent data fetched for agent_id {doc_id}: {agent_data['version']}")
                execution_count_version = json.loads(json_util.dumps(self.agent_version_history_collection.find_one({"agent_id": doc_id,"version": agent_data["version"]})))
                self.agent_version_history_collection.update_one(
                    {"agent_id": doc_id,"version": agent_data["version"]},
                    {"$set": {"execution_count": execution_count_version.get("execution_count", 0) + 1}}
                )
            except Exception as e:
                print(f"Error updating execution count for agent_id {agent_id}: {str(e)}")
    
            if not agent_id:
                return self.static_chatbot_agent(user_query, event_id, session_id, user_id)
    
            agent_data = self.agent_collection.find_one({"agent_id": agent_id})
            if not agent_data:
                raise NotFoundError("Agent not found")
    
            api_key = agent_data.get('agent_api_key', '')
            if not api_key:
                raise ValidationError("Missing API key for agent")
    
            # Call the agent API and handle the response
            return self.call_agent_api(agent_data, user_query, event_id, api_key, session_id, user_id, prompt_title)

        

    def mask_pii_content(self, text):
        if not isinstance(text, str):
            return text

        # Improved patterns (removed \b to be more aggressive)
        # Using specific patterns that don't rely on word boundaries
        patterns = {
            'email': r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+',
            'phone': r'(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{4,6}',
            'aadhaar': r'\d{4}\s?\d{4}\s?\d{4}|\d{12}',
            'pan': r'[A-Z]{5}[0-9]{4}[A-Z]{1}',
            'ssn': r'\d{3}-\d{2}-\d{4}',
            'card': r'\b(?:\d[ -]*?){13,16}\b'
        }

        masked_text = text
        
        # Apply PAN/SSN/Aadhaar specifically to avoid false positives
        # We use a lambda to ensure we only mask if the content isn't just a label
        masked_text = re.sub(patterns['pan'], "XXXXX1234X", masked_text)
        masked_text = re.sub(patterns['ssn'], "XXX-XX-XXXX", masked_text)
        masked_text = re.sub(patterns['aadhaar'], "XXXXXXXX1234", masked_text)
        
        return masked_text

    def apply_pii_masking_to_doc(self, doc):
        if isinstance(doc, dict):
            return {k: self.apply_pii_masking_to_doc(v) for k, v in doc.items()}
        
        elif isinstance(doc, list):
            return [self.apply_pii_masking_to_doc(item) for item in doc]
        
        elif isinstance(doc, str):
            # IF DATA IS FORMATTED LIKE "step$1~...~123-45-6789"
            if '~' in doc:
                parts = doc.split('~')
                # Only attempt to mask the last part or parts likely to contain data
                # Adjust the logic here based on your data structure
                masked_parts = [self.mask_pii_content(p) for p in parts]
                return "~".join(masked_parts)
            return self.mask_pii_content(doc)
        
        return doc


    
    def call_agent_api_old(self, agent_data, user_query, event_id, api_key, session_id, user_id):
        message = f"""{user_query}"""
        agent_api_url = config_loader.LYZR_STREAMING_AGENT_URL
        payload = {
            "user_id": user_id or "default_user",
            "agent_id": agent_data.get('api_agent_id', agent_data.get('agent_id')),
            "session_id": session_id or "default_session",
            "message": message
        }
        headers = {
            "x-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
        }
        
        # WebSocket connection for metrics
        ws_url = f"wss://metrics.studio.lyzr.ai/ws/{session_id}?x-api-key={api_key}"
        log_queue = Queue()
        ws_thread = None
        full_content_parts = []
        # NOTE: 'request' is available from the outer scope of this function.
        request_id = request.headers.get("X-Request-Id", "-")
        collected_logs = []  # Store all logs here for DB update
        
        # WebSocket event handlers (unchanged)
        def on_message(ws, message):
            try:
                log_data = json.loads(message)
                print("\n=== WEBSOCKET LOG RECEIVED ===")
                print(json.dumps(log_data, indent=2))
                print("===============================\n")
                
                log_entry = {
                    "type": "log",
                    "data": log_data,
                    "timestamp": datetime.now().isoformat()
                }
                log_queue.put(log_entry)
                collected_logs.append(log_data) # Still collect for final DB update
            except Exception as e:
                print(f"Error parsing WebSocket message: {e}")
                print(f"Raw message: {message}")
        
        def on_error(ws, error):
            print(f"🚨 WebSocket error: {error}")
            log_queue.put({
                "type": "error",
                "message": str(error),
                "timestamp": datetime.now().isoformat()
            })
        
        def on_close(ws, close_status_code, close_msg):
            print(f"❌ WebSocket connection closed. Code: {close_status_code}, Message: {close_msg}")
            log_queue.put({
                "type": "control",
                "message": "ws_closed",
                "timestamp": datetime.now().isoformat()
            })
        
        def on_open(ws):
            print("✅ WebSocket connection opened")
            log_queue.put({
                "type": "control",
                "message": "ws_opened",
                "timestamp": datetime.now().isoformat()
            })
        
        def generate_stream():
            nonlocal ws_thread
            
            try:
                # Start WebSocket connection in a separate thread
                ws = websocket.WebSocketApp(
                    ws_url,
                    on_message=on_message,
                    on_error=on_error,
                    on_close=on_close,
                    on_open=on_open
                )
                
                ws_thread = threading.Thread(target=ws.run_forever)
                ws_thread.daemon = True
                ws_thread.start()
                
                # Give WebSocket a moment to connect
                time.sleep(1)
                
                print("PROXYING REAL STREAM FROM LYZR")
                with requests.post(
                    agent_api_url,
                    json=payload,
                    headers=headers,
                    stream=True,
                    timeout=300
                ) as r:
                    r.raise_for_status()
                    msg = f"Lyzr connected: {r.status_code}"
                    print(msg)
                    log_data(request_id, msg, None, 'info')
                    log_data(request_id, "Streaming started", None, 'info')
                    
                    # *** MODIFICATION: Process logs interleaved with the main response ***
                    for line in r.iter_lines():
                        if not line:
                            continue

                        # 1. First, check for and yield any pending WebSocket logs
                        while not log_queue.empty():
                            log_entry = log_queue.get()
                            if log_entry.get("type") == "log":
                                yield f"data: {json.dumps({'type': 'log', 'data': log_entry['data']})}\n\n"
                            elif log_entry.get("type") == "error":
                                yield f"data: {json.dumps({'type': 'ws_error', 'message': log_entry['message']})}\n\n"
                        
                        # 2. Then, process and yield the main response line
                        decoded = line.decode('utf-8')
                        if decoded.startswith("data:"):
                            content = decoded.split("data:", 1)[1].strip()
                            try:
                                json_content = json.loads(content)
                                masked_obj = self.apply_pii_masking_to_doc(json_content)
                                masked_content_str = json.dumps(masked_obj)
                            except json.JSONDecodeError:
                                # If it's not JSON, treat it as a plain string chunk
                                masked_content_str = self.apply_pii_masking_to_doc(content)

                            # Reconstruct the SSE line and yield
                            yield f"data: {masked_content_str}\n\n"
                            full_content_parts.append(masked_content_str)
                            # yield decoded + "\n\n"
                            # content = decoded[6:] # "data: " is 6 chars
                            # if content != "[DONE]": # Optional: exclude control tokens
                                # full_content_parts.append(content)
                        elif decoded == "[DONE]":
                            yield "data: [DONE]\n\n"
                    
                    log_data(request_id, "Streaming ended", None, 'info')
                    yield "data: [DONE]\n\n"

                # *** END OF MODIFICATION ***
                
                # After the main response, check for any final remaining logs
                time.sleep(3)
                while not log_queue.empty():
                    log_entry = log_queue.get()
                    if log_entry.get("type") == "log":
                        yield f"data: {json.dumps({'type': 'log', 'data': log_entry['data']})}\n\n"
                    elif log_entry.get("type") == "error":
                        yield f"data: {json.dumps({'type': 'ws_error', 'message': log_entry['message']})}\n\n"
                
                # Close WebSocket connection
                if ws_thread and ws_thread.is_alive():
                    ws.close()
                    ws_thread.join(timeout=5)
                    
                yield f'data: {json.dumps({"type": "msg", "data": {"message": "Metrics completed", "level": "info"}})}\n\n'
                # --- The rest of the function remains the same ---
                # Fetch trace information after the agent response
                full_response = "".join(full_content_parts)
                trace_info = {}
                
                try:
                    # Get the latest trace for this agent without time constraints
                    agent_id = agent_data.get('api_agent_id', agent_data.get('agent_id'))
                    
                    # Add a delay to ensure the trace has been recorded
                    time.sleep(5)
                    
                    # Call get_trace to get the latest trace (no time constraints)
                    trace_url = f"{config_loader.LYZR_AGENT_URL}/v3/traces"
                    trace_headers = {"x-api-key": api_key, "Content-Type": "application/json"}
                    
                    # Try multiple times with increasing delays to get the most recent trace
                    max_retries = 5
                    retry_delay = 1  # Initial delay in seconds
                    
                    for retry in range(max_retries):
                        trace_params = {
                            "agent_id": agent_id,
                            "limit": 1,
                            "sort": "desc"  # Ensure we get the most recent trace first
                        }
                        
                        try:
                            trace_response = requests.get(trace_url, headers=trace_headers, params=trace_params)
                            trace_response.raise_for_status()
                            traces = trace_response.json()
                            
                            if traces and len(traces) > 0:
                                latest_trace = traces[0]
                                trace_id = latest_trace.get("trace_id")
                                
                                # Check if this trace matches our current session
                                if trace_id:
                                    # Get detailed trace information
                                    trace_detail_url = f"{config_loader.LYZR_AGENT_URL}/v3/traces/{trace_id}"
                                    detail_response = requests.get(trace_detail_url, headers=trace_headers)
                                    detail_response.raise_for_status()
                                    
                                    # Safe handling (Lyzr returns dict, not list)
                                    trace_details = detail_response.json()
                                    if isinstance(trace_details, list):
                                        trace_details = trace_details[0] if trace_details else {}
                                    
                                    # Verify this trace belongs to our session
                                    spans = trace_details.get("spans", [])
                                    our_session = False
                                    
                                    for span in spans:
                                        span_attrs = span.get("SpanAttributes", {})
                                        if (span_attrs.get("session_id") == session_id or 
                                            span_attrs.get("input") and user_query in span_attrs.get("input", "")):
                                            our_session = True
                                            break
                                    
                                    if our_session:
                                        # Clean spans – keep only needed fields + remove unwanted keys
                                        if "spans" in trace_details and isinstance(trace_details["spans"], list):
                                            formatted_spans = []
                                            for span in trace_details["spans"]:
                                                clean_attrs = span.get("SpanAttributes", {}).copy()
                                                clean_attrs.pop("input", None)
                                                clean_attrs.pop("output", None)
                                                clean_attrs.pop("llm_output", None)
                                                
                                                clean_events_attrs = []
                                                for attr in span.get("Events.Attributes", []):
                                                    clean_attr = attr.copy()
                                                    clean_attr.pop("query", None)
                                                    clean_events_attrs.append(clean_attr)
                                                
                                                # Extract chat messages from the span
                                                span_chat_messages = []
                                                input_message = ""
                                                output_message = ""
                                                
                                                # Get original span attributes for chat messages
                                                original_attrs = span.get("SpanAttributes", {})
                                                if "input" in original_attrs:
                                                    input_message = original_attrs["input"]
                                                if "output" in original_attrs:
                                                    output_message = original_attrs["output"]
                                                
                                                # Create chat_messages structure expected by UI
                                                span_chat_messages = {
                                                    "input_message": input_message,
                                                    "output_message": output_message
                                                }
                                                
                                                formatted_span = {
                                                    "SpanName": span.get("SpanName", ""),
                                                    "SpanAttributes": clean_attrs,
                                                    "Events.Name": span.get("Events.Name", []),
                                                    "Events.Attributes": clean_events_attrs,
                                                    "chat_messages": span_chat_messages  # Add chat_messages to each span
                                                }
                                                formatted_spans.append(formatted_span)
                                            
                                            # Replace original spans with cleaned version
                                            trace_details["spans"] = formatted_spans
                                        
                                        # Extract chat messages from the trace (for database storage)
                                        chat_messages = trace_details.get("chat_messages", [])
                                        if not chat_messages:
                                            # If chat_messages is not directly available, try to extract from spans
                                            chat_messages = []
                                            for span in spans:
                                                span_attrs = span.get("SpanAttributes", {})
                                                if "input" in span_attrs:
                                                    chat_messages.append({
                                                        "role": "user",
                                                        "content": span_attrs["input"]
                                                    })
                                                if "output" in span_attrs:
                                                    chat_messages.append({
                                                        "role": "assistant",
                                                        "content": span_attrs["output"]
                                                    })
                                        
                                        # MODIFICATION: Create trace details data structure to match the expected format
                                        trace_details_data = [{
                                            "trace_id": trace_id,
                                            "details": {
                                                "spans": trace_details.get("spans", []),
                                                "trace_id": trace_id
                                            }
                                        }]
                                        
                                        # Store trace info for database update
                                        trace_info = {
                                            "trace_id": trace_id,
                                            "spans": trace_details.get("spans", []),
                                            "chat_messages": chat_messages,
                                            "trace_summary": traces
                                        }
                                        
                                        yield f"data: {json.dumps({'type': 'trace_details', 'data': trace_details_data})}\n\n"
                                        break
                                    else:
                                        # This trace doesn't belong to our session, try again with longer delay
                                        if retry < max_retries - 1:
                                            time.sleep(retry_delay * (retry + 1))
                                            continue
                                else:
                                    # No traces found, try again with longer delay
                                    if retry < max_retries - 1:
                                        time.sleep(retry_delay * (retry + 1))
                                        continue
                                        
                        except Exception as e:
                            print(f"Error fetching trace information (attempt {retry + 1}): {e}")
                            if retry < max_retries - 1:
                                time.sleep(retry_delay * (retry + 1))
                                continue
                            else:
                                # Last attempt failed, send error to client
                                yield f"data: {json.dumps({'type': 'trace_error', 'message': str(e)})}\n\n"
                                break
                    
                    if not trace_info:
                        # If we couldn't find a matching trace after all retries
                        yield f"data: {json.dumps({'type': 'trace_error', 'message': 'Could not find trace for current session'})}\n\n"
                        
                except Exception as e:
                    print(f"Error fetching trace information: {e}")
                    yield f"data: {json.dumps({'type': 'trace_error', 'message': str(e)})}\n\n"
                
                try:
                    update_op = {
                        'type': 'update_one',
                        'filter': {'event_id': event_id},
                        'update': {
                            "$set": {
                                "prompt_output": full_response,
                                "status": "completed",
                                "session_id": session_id,
                                "real_time_logs": collected_logs,
                                "trace_info": trace_info  # Add trace information to the database
                            }
                        }
                    }
                    self._query_db('chatbot_tracking', update_op)
                    log_data(request_id, "Full Response and trace info saved into db", None, 'info')
                except Exception as db_err:
                    msg = f"DB update error: {db_err}"
                    log_data(request_id, msg, None, 'info')
                    print(msg)
                
            except Exception as e:
                msg = f"LYZR ERROR: {e}"
                print(msg)
                log_data(request_id, msg, None, 'info')
                import traceback
                traceback.print_exc()
                yield f"data: ERROR: {str(e)}\n\n"
        
        return Response(
            stream_with_context(generate_stream()),
            mimetype="text/event-stream",
            headers={
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
                "Access-Control-Allow-Origin": "*",
            }
        )  

    def call_agent_api(self, agent_data, user_query, event_id, api_key, session_id, user_id, prompt_title=None):
        message = f"""{user_query}"""
        agent_api_url = config_loader.LYZR_STREAMING_AGENT_URL
        payload = {
            "user_id": user_id or "default_user",
            "agent_id": agent_data.get('api_agent_id', agent_data.get('agent_id')),
            "session_id": session_id or "default_session",
            "message": message
        }
        if prompt_title:
            payload["prompt_title"] = prompt_title.strip()
       
        print(f"Chatbot_payload----{payload}")
       
        headers = {
            "x-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
        }
       
        # WebSocket connection for metrics
        ws_url = f"wss://metrics.studio.lyzr.ai/ws/{session_id}?x-api-key={api_key}"
        log_queue = Queue()
        ws_thread = None
        full_content_parts = []
        # NOTE: 'request' is available from the outer scope of this function.
        request_id = request.headers.get("X-Request-Id", "-")
        collected_logs = []  # Store all logs here for DB update
       
        # WebSocket event handlers (unchanged)
        def on_message(ws, message):
            try:
                log_data = json.loads(message)
                print("\n=== WEBSOCKET LOG RECEIVED ===")
                print(json.dumps(log_data, indent=2))
                print("===============================\n")
               
                log_entry = {
                    "type": "log",
                    "data": log_data,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
                log_queue.put(log_entry)
                collected_logs.append(log_data) # Still collect for final DB update
            except Exception as e:
                print(f"Error parsing WebSocket message: {e}")
                print(f"Raw message: {message}")
       
        def on_error(ws, error):
            print(f"🚨 WebSocket error: {error}")
            log_queue.put({
                "type": "error",
                "message": str(error),
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
       
        def on_close(ws, close_status_code, close_msg):
            print(f"❌ WebSocket connection closed. Code: {close_status_code}, Message: {close_msg}")
            log_queue.put({
                "type": "control",
                "message": "ws_closed",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
       
        def on_open(ws):
            print("✅ WebSocket connection opened")
            log_queue.put({
                "type": "control",
                "message": "ws_opened",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
       
        def generate_stream():
            nonlocal ws_thread
           
            try:
                # Start WebSocket connection in a separate thread
                ws = websocket.WebSocketApp(
                    ws_url,
                    on_message=on_message,
                    on_error=on_error,
                    on_close=on_close,
                    on_open=on_open
                )
               
                ws_thread = threading.Thread(target=ws.run_forever)
                ws_thread.daemon = True
                ws_thread.start()
               
                # Give WebSocket a moment to connect
                time.sleep(1)
               
                print("PROXYING REAL STREAM FROM LYZR")
                with requests.post(
                    agent_api_url,
                    json=payload,
                    headers=headers,
                    stream=True,
                    timeout=300
                ) as r:
                    r.raise_for_status()
                    msg = f"Lyzr connected: {r.status_code}"
                    print(msg)
                    log_data(request_id, msg, None, 'info')
                    log_data(request_id, "Streaming started", None, 'info')
                   
                    # *** MODIFICATION: Process logs interleaved with the main response ***
                    for line in r.iter_lines():
                        if not line:
                            continue
 
                        # 1. First, check for and yield any pending WebSocket logs
                        while not log_queue.empty():
                            log_entry = log_queue.get()
                            if log_entry.get("type") == "log":
                                yield f"data: {json.dumps({'type': 'log', 'data': log_entry['data']})}\n\n"
                            elif log_entry.get("type") == "error":
                                yield f"data: {json.dumps({'type': 'ws_error', 'message': log_entry['message']})}\n\n"
                       
                        # 2. Then, process and yield the main response line
                        decoded = line.decode('utf-8')
                        if decoded.startswith("data:"):
                            yield decoded + "\n\n"
                            content = decoded[6:] # "data: " is 6 chars
                            if content != "[DONE]": # Optional: exclude control tokens
                                full_content_parts.append(content)
                        elif decoded == "[DONE]":
                            yield "data: [DONE]\n\n"
                   
                    log_data(request_id, "Streaming ended", None, 'info')
                    yield "data: [DONE]\n\n"
 
                # *** END OF MODIFICATION ***
               
                # After the main response, check for any final remaining logs
                time.sleep(3)
                while not log_queue.empty():
                    log_entry = log_queue.get()
                    if log_entry.get("type") != "log":
                        log_data(request_id, log_entry.get('message'), None)
                    if log_entry.get("type") == "log":
                        yield f"data: {json.dumps({'type': 'log', 'data': log_entry['data']})}\n\n"
                    elif log_entry.get("type") == "error":
                        yield f"data: {json.dumps({'type': 'ws_error', 'message': log_entry['message']})}\n\n"
               
                # Close WebSocket connection
                if ws_thread and ws_thread.is_alive():
                    ws.close()
                    ws_thread.join(timeout=5)
                   
                yield f'data: {json.dumps({"type": "msg", "data": {"message": "Metrics completed", "level": "info"}})}\n\n'
                log_data(request_id, 'Metrics completed', None)
                # --- The rest of the function remains the same ---
                # Fetch trace information after the agent response
                full_response = "".join(full_content_parts)
                trace_info = {}
               
                try:
                    # Get the latest trace for this agent without time constraints
                    agent_id = agent_data.get('api_agent_id', agent_data.get('agent_id'))
                   
                    # Add a delay to ensure the trace has been recorded
                    time.sleep(5)
                   
                    # Call get_trace to get the latest trace (no time constraints)
                    trace_url = f"{config_loader.LYZR_AGENT_URL}/v3/traces"
                    trace_headers = {"x-api-key": api_key, "Content-Type": "application/json"}
                   
                    # Try multiple times with increasing delays to get the most recent trace
                    max_retries = 5
                    retry_delay = 1  # Initial delay in seconds
                   
                    for retry in range(max_retries):
                        trace_params = {
                            "agent_id": agent_id,
                            "limit": 1,
                            "sort": "desc"  # Ensure we get the most recent trace first
                        }
                       
                        try:
                            trace_response = requests.get(trace_url, headers=trace_headers, params=trace_params)
                            trace_response.raise_for_status()
                            traces = trace_response.json()
                           
                            if traces and len(traces) > 0:
                                latest_trace = traces[0]
                                trace_id = latest_trace.get("trace_id")
                               
                                # Check if this trace matches our current session
                                if trace_id:
                                    # Get detailed trace information
                                    trace_detail_url = f"{config_loader.LYZR_AGENT_URL}/v3/traces/{trace_id}"
                                    detail_response = requests.get(trace_detail_url, headers=trace_headers)
                                    detail_response.raise_for_status()
                                   
                                    # Safe handling (Lyzr returns dict, not list)
                                    trace_details = detail_response.json()
                                    if isinstance(trace_details, list):
                                        trace_details = trace_details[0] if trace_details else {}
                                   
                                    # Verify this trace belongs to our session
                                    spans = trace_details.get("spans", [])
                                    our_session = False
                                   
                                    for span in spans:
                                        span_attrs = span.get("SpanAttributes", {})
                                        if (span_attrs.get("session_id") == session_id or
                                            span_attrs.get("input") and user_query in span_attrs.get("input", "")):
                                            our_session = True
                                            break
                                   
                                    if our_session:
                                        # Clean spans – keep only needed fields + remove unwanted keys
                                        if "spans" in trace_details and isinstance(trace_details["spans"], list):
                                            formatted_spans = []
                                            for span in trace_details["spans"]:
                                                clean_attrs = span.get("SpanAttributes", {}).copy()
                                                clean_attrs.pop("input", None)
                                                clean_attrs.pop("output", None)
                                                clean_attrs.pop("llm_output", None)
                                               
                                                clean_events_attrs = []
                                                for attr in span.get("Events.Attributes", []):
                                                    clean_attr = attr.copy()
                                                    clean_attr.pop("query", None)
                                                    clean_events_attrs.append(clean_attr)
                                               
                                                # Extract chat messages from the span
                                                span_chat_messages = []
                                                input_message = ""
                                                output_message = ""
                                               
                                                # Get original span attributes for chat messages
                                                original_attrs = span.get("SpanAttributes", {})
                                                if "input" in original_attrs:
                                                    input_message =  self.call_agent_api_input_output_replacement(original_attrs["input"], user_query)  
                                                if "output" in original_attrs:
                                                    output_message = self.call_agent_api_input_output_replacement(original_attrs["output"],full_content_parts)
                                               
                                                # Create chat_messages structure expected by UI
                                                span_chat_messages = {
                                                    "input_message": input_message,
                                                    "output_message": output_message
                                                }
                                               
                                                formatted_span = {
                                                    "SpanName": span.get("SpanName", ""),
                                                    "SpanAttributes": clean_attrs,
                                                    "Events.Name": span.get("Events.Name", []),
                                                    "Events.Attributes": clean_events_attrs,
                                                    "chat_messages": span_chat_messages  # Add chat_messages to each span
                                                }
                                                formatted_spans.append(formatted_span)
                                           
                                            # Replace original spans with cleaned version
                                            trace_details["spans"] = formatted_spans
                                       
                                        # Extract chat messages from the trace (for database storage)
                                        chat_messages = trace_details.get("chat_messages", [])
                                        if not chat_messages:
                                            # If chat_messages is not directly available, try to extract from spans
                                            chat_messages = []
                                            for span in spans:
                                                span_attrs = span.get("SpanAttributes", {})
                                                if "input" in span_attrs:
                                                    chat_messages.append({
                                                        "role": "user",
                                                        "content": self.call_agent_api_input_output_replacement(span_attrs["input"], user_query) 
                                                    })
                                                if "output" in span_attrs:
                                                    chat_messages.append({
                                                        "role": "assistant",
                                                        "content": span_attrs["output"]
                                                    })
                                       
                                        # MODIFICATION: Create trace details data structure to match the expected format
                                        trace_details_data = [{
                                            "trace_id": trace_id,
                                            "details": {
                                                "spans": trace_details.get("spans", []),
                                                "trace_id": trace_id
                                            }
                                        }]
                                       
                                        # Store trace info for database update
                                        trace_info = {
                                            "trace_id": trace_id,
                                            "spans": trace_details.get("spans", []),
                                            "chat_messages": chat_messages,
                                            "trace_summary": traces
                                        }
                                       
                                        yield f"data: {json.dumps({'type': 'trace_details', 'data': trace_details_data})}\n\n"
                                        log_data(request_id, 'trace details retrieved', None)
                                        break
                                    else:
                                        # This trace doesn't belong to our session, try again with longer delay
                                        if retry < max_retries - 1:
                                            time.sleep(retry_delay * (retry + 1))
                                            continue
                                else:
                                    # No traces found, try again with longer delay
                                    if retry < max_retries - 1:
                                        time.sleep(retry_delay * (retry + 1))
                                        continue
                                       
                        except Exception as e:
                            msg = f"Error fetching trace information (attempt {retry + 1}): {e}"
                            print(msg)
                            log_data(request_id, msg, None)

                            if retry < max_retries - 1:
                                time.sleep(retry_delay * (retry + 1))
                                continue
                            else:
                                # Last attempt failed, send error to client
                                err = str(e)
                                log_data(request_id, err, None)
                                yield f"data: {json.dumps({'type': 'trace_error', 'message': err})}\n\n"
                                break
                   
                    if not trace_info:
                        # If we couldn't find a matching trace after all retries
                        yield f"data: {json.dumps({'type': 'trace_error', 'message': 'Could not find trace for current session'})}\n\n"
                       
                except Exception as e:
                    msg = f"Error fetching trace information: {e}"
                    print(msg)
                    log_data(request_id, msg, None)
                    yield f"data: {json.dumps({'type': 'trace_error', 'message': str(e)})}\n\n"
               
                # Update database with response and trace info
                try:
                    current_user = get_current_user()
                    prj_name = current_user.get('ActiveProject')
                    user_type = self.project.find_one({'projectName': prj_name})['database_name']
                    full_response = "".join(full_content_parts)
                    prompt_repo = PromptRepository()
                    threading.Thread(
                        target=prompt_repo.run_mlflow_evaluation,
                        args=(event_id, user_query, full_response,user_type),
                        daemon=True
                    ).start()
 
                    # === Send 'type: metrics' to UI BEFORE saving to DB (wait up to 3 minutes) ===
                    print("⏳ Waiting for MLflow evaluation to complete (up to 3 minutes)...")
                   
                    metrics_doc = None
                    for i in range(90):  # 90 * 2 seconds = 180 seconds (3 minutes)
                        time.sleep(2)
                        fetch_op = {
                            'type': 'find_one',
                            'filter': {'event_id': event_id},
                            'projection': {'metrics': 1, 'detailed_results': 1, 'evaluated_at': 1}
                        }
                        metrics_doc = prompt_repo._query_db('chatbot_tracking', fetch_op)
                       
                        if metrics_doc and metrics_doc.get('metrics'):
                            print(f"✅ Metrics found after {(i+1)*2} seconds")
                            break
                   
                    if metrics_doc and metrics_doc.get('metrics'):
                        metrics_payload = {
                            "metrics": metrics_doc.get('metrics'),
                            "detailed_results": metrics_doc.get('detailed_results'),
                            "evaluated_at": metrics_doc.get('evaluated_at')
                        }
                        print("🚀 Sending 'type: metrics' to UI")
                        print(f"Metrics keys: {list(metrics_doc.get('metrics', {}).keys())}")
                        yield f"data: {json.dumps({'type': 'metrics', 'data': metrics_payload})}\n\n"
                    else:
                        print("⚠️ No metrics found even after 3 minutes")
 
                    try:
                        update_op = {
                            'type': 'update_one',
                            'filter': {'event_id': event_id},
                            'update': {
                                "$set": {
                                    "prompt_output": full_response,
                                    "status": "completed",
                                    "user_prompt": user_query,
                                    "session_id": session_id,
                                    "real_time_logs": collected_logs,
                                    "trace_info": trace_info
                                }
                            }
                        }
                        self._query_db('chatbot_tracking', update_op)
                        print("Full Response and trace info saved into db111")
                        log_data(request_id, "Full Response and trace info saved into db", None, 'info')

                        # Fetch chat messages from DB and replace in spans
                        self.chatbot_agent = self
                        chat_messages_from_db = FlaskApp.get_chat_messages(self, event_id, None)
                        delattr(self, 'chatbot_agent')
                        print("chat_messages from db:", chat_messages_from_db)

                        # Replace chat_messages in each span with DB data
                        for span in trace_details["spans"]:
                            span['chat_messages'] = chat_messages_from_db

                        yield f"data: {json.dumps({'type': 'trace_details', 'data': trace_details_data})}\n\n"

                    except Exception as db_err:
                        msg = f"DB update error: {db_err}"
                        log_data(request_id, msg, None, 'info')
                        print(msg)
 
                except Exception as e:
                    msg = f"LYZR ERROR: {e}"
                    status = getattr(getattr(e, 'response', None) ,'status_code', 500)
                    log_data(request_id, msg, None, 'info', status)
                    print(msg)
               
            except Exception as e:
                msg = f"LYZR ERROR: {e}"
                print(msg)
                status = getattr(getattr(e, 'response', None) ,'status_code', 500)
                log_data(request_id, msg, None, 'info', status)
                import traceback
                traceback.print_exc()
                yield f"data: ERROR: {str(e)}\n\n"
       
        return Response(
            stream_with_context(generate_stream()),
            mimetype="text/event-stream",
            headers={
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
                "Access-Control-Allow-Origin": "*",
            }
        )  
 
 
    def call_agent_api_input_output_replacement(self,Input_query,user_query):
        
        print(f"Input :{Input_query}--- UserQuery :{user_query}")
        
        blocked_query="[redacted] Message storage is disabled for this agent"
        
        if Input_query == blocked_query:
            return user_query
        return Input_query


    def process_chat(self, request, data, has_prompt_title=False):
        """Process chatbot request with optional prompt_title and agency_id"""
        print("Processing standard chatbot request...")
        user_query = data.get('userQuery', "")
        agent_id = data.get('agent_id', "")
        user_id = data.get('user_id', '')

        session_id = data.get('session_id')
            
        if not session_id:
            session_id = self.utils.generate_uuid()
            print(f"🆕 New session_id generated: {session_id}")
        else:
            print(f"♻️ Using session_id: {session_id}")


        print(f"Teams-bot Chat input agent_id :{agent_id}")

        tool_res = self.agent_collection.find_one({'agent_id': agent_id})
        
        #print(f"Agent Details :{tool_res}")
        
        custom_tool_config = tool_res.get("Iscustomtool", False)
        internal_tool_data = tool_res.get("internal_tool", [])
        api_key = tool_res.get("agent_api_key")
        if custom_tool_config and internal_tool_data:
            print("Custom tool configuration detected. Routing to run_lyzr.")
            
            
            # Call synchronous run_lyzr
            return self.run_lyzr_chat(
                user_input=user_query,
                user_id=user_id,
                lyzr_api_key=api_key,
                lyzr_agent_id=agent_id,
                session_id=session_id,
               
            )
        else:

            # Call synchronous call_agent_api
            return self.call_agent_api_chat( user_query, api_key, session_id, user_id,agent_id)

    def run_lyzr_chat_old(self, user_input: str, user_id: str, lyzr_api_key: str, lyzr_agent_id: str, session_id: str):
        
        # 1. Prepare Tools and Prompt
        context = self._get_agent_context(lyzr_agent_id)
        raw_tools_docs = context.get("raw_tools_docs", [])
        tools_called = []
        user_data = self.user_collection.find_one({
            "Email": re.compile(f"^{re.escape(user_id.lower())}$", re.IGNORECASE),
            "IsActive": True,
            "IsDelete": False
        }, {"_id": 0, "Email": 1, "FirstName": 1, "LastName": 1})
        if not user_data:
            user_data = {"Email": user_id, "FirstName": "", "LastName": ""}

        encrypted_user_data = process_sensitive_fields(user_data, "encrypt")

        tools_prompt = f"""\n\n Important Instruction: You have access to these tools. When you need to use a tool, respond with ONLY a valid JSON object with 'tool_name' and 'arguments'. The tool call will happen from client side so respond only with given JSON format and not from the lyzr tool. Do not add any extra text. If multiple tool calls are required for a result do it in sequence. \n

            !!!IMPORTANT: Do not execute any URL from your end. The tool call should happen from the client side. You are only responsible for providing the correct tool call in JSON format. Do not provide any additional text or explanations.
            
            Workflow:
            1. Review the user query + the attached tool schemas
            2. Select the most relevant tool(s) .
            3. Output the tool call in the exact required format.
            4. Wait for the backend to execute the tool and return the result.
            5. Analyze the tool response.
            6. Give the final clear answer to the user.

            Rules:
            - Think step-by-step before calling tools.
            - Only use available tool schemas.
            - Never hallucinate tool results.
            - After receiving tool response, provide the final response to the user.
            - Be professional, patient, and clear.
            - Use numbered steps.
            - Include warnings when needed.
            - Ask clarifying questions if information is missing.

            Use user data if required. User Data: \n{json.dumps(encrypted_user_data)}

            """
        
        for doc in raw_tools_docs:
            if not isinstance(doc, dict): continue
            tool_key = doc.get("tool_key", {})
            if not isinstance(tool_key, dict): continue

            functions = tool_key.get("functions", [])
            if isinstance(functions, list):
                for func in functions:
                    if not isinstance(func, dict): continue
                    if func.get("active", True):
                        name = func.get("name", "Unknown_Tool")
                        description = func.get("description", "No description provided.")
                        parameters = func.get("parameters", {})
                        properties_only = parameters.get("properties", parameters) if isinstance(parameters, dict) else {}
                        tools_prompt += f"- {name}: {description}\n Parameters: {json.dumps(properties_only)}\n"

        #current_message = tools_prompt + "\nUser Query:" + user_input
        current_message = user_input
        max_rounds = 10
        final_content = ""
        agent_api_base = "https://agent-prod.studio.lyzr.ai"

        try:
            # 2. Synchronous Agent Execution Loop
            for _ in range(max_rounds):
                headers = {
                    "x-api-key": lyzr_api_key,
                    "Content-Type": "application/json",
                }
                payload = {
                    "user_id": user_id,
                    "agent_id": lyzr_agent_id,
                    "session_id": session_id,
                    "message": current_message,
                }
                
                # Make Standard Blocking API Call
                res = requests.post(f"{agent_api_base}/v3/inference/chat/", headers=headers, json=payload)
                res.raise_for_status()
                response_json = res.json()
                
                print("Agent Response JSON:", json.dumps(response_json, indent=2))

                # Parse Response Content
                content = (
                    response_json.get("content") or 
                    response_json.get("response") or 
                    response_json.get("message") or 
                    str(response_json)
                )
                print("Agent Response Content:", content)
                # Parse tool call robustly from dict/string/fenced-json payloads.
                tool_call = self._extract_tool_call(response_json)

                # Execute Tool OR End Loop
                if tool_call and isinstance(tool_call, dict) and "tool_name" in tool_call:
                    tool_name = tool_call["tool_name"]
                    tools_called.append(tool_name)
                    args = tool_call.get("arguments", {})
                    decrypted_args = process_sensitive_fields(args, "decrypt")
                    
                    auth_service = ToolAuthService()
                    
                    print(f"ServiceNow Tool_Name-1: {tool_name}")
                    print(f"ServiceNow Raw_Tool_Docs Args-1: {args}")
                    print(f"ServiceNow Raw_Tool_Docs Args decrypted-1: {decrypted_args}")
                    print(f"ServiceNow Raw_Tool_Docs-1: {raw_tools_docs}")
                    
                    tool_result = ""#auth_service._execute_tool(tool_name, decrypted_args, raw_tools_docs, user_id)
                    masked_tool_result = "" #self.mask_pii_sensitive_data(tool_result)
                    
                    current_message = f"Tool '{tool_name}' executed successfully.\nResult: {masked_tool_result}\n\nContinue with the next step tool call if required or give final answer."
                else:
                    # Final response generated
                    final_content = content
                    break

            # 3. Save to database and return result immediately
            

            return {
                "type": "final_response",
                "data": {
                    "response": final_content,
                    "session_id": session_id,
                    "tools_called": tools_called
                }
            }

        except Exception as e:
            # Save failure to db and return error
            return {"type": "error", "message": str(e)}

    def run_lyzr_chat(
        self,
        user_input: str,
        user_id: str,
        lyzr_api_key: str,
        lyzr_agent_id: str,
        session_id: str
    ):

        def get_servicenow_action(spans):

            for span in spans:

                attrs = span.get(
                    "SpanAttributes",
                    {}
                )

                #
                # tool call arguments
                #
                args = attrs.get(
                    "llm.tool_calls.0.function.arguments"
                )

                if args:

                    if (
                        "SERVICENOW__CREATE_INCIDENT"
                        in args
                    ):
                        return "create"

                    if (
                        "SERVICENOW__UPDATE_INCIDENT"
                        in args
                    ):
                        return "update"

                #
                # input/query fields
                #
                for field in [
                    "input",
                    "query",
                    "output",
                ]:

                    value = attrs.get(field)

                    if not value:
                        continue

                    if (
                        "SERVICENOW__CREATE_INCIDENT"
                        in str(value)
                    ):
                        return "create"

                    if (
                        "SERVICENOW__UPDATE_INCIDENT"
                        in str(value)
                    ):
                        return "update"

            return None

        context = self._get_agent_context(lyzr_agent_id)
        raw_tools_docs = context.get("raw_tools_docs", [])

        tools_called = []

        user_data = self.user_collection.find_one(
            {
                "Email": re.compile(
                    f"^{re.escape(user_id.lower())}$",
                    re.IGNORECASE
                ),
                "IsActive": True,
                "IsDelete": False
            },
            {
                "_id": 0,
                "Email": 1,
                "FirstName": 1,
                "LastName": 1
            }
        )

        if not user_data:
            user_data = {
                "Email": user_id,
                "FirstName": "",
                "LastName": ""
            }

        current_message = user_input

        max_rounds = 10
        final_content = ""

        agent_api_base = config_loader.LYZR_AGENT_URL.rstrip("/")

        servicenow_processed = False

        trace_details = None
        trace_id = None

        try:

            for round_num in range(max_rounds):

                print("=" * 100)
                print(f"ROUND : {round_num + 1}")
                print("=" * 100)

                headers = {
                    "x-api-key": lyzr_api_key,
                    "Content-Type": "application/json",
                }

                payload = {
                    "user_id": user_id,
                    "agent_id": lyzr_agent_id,
                    "session_id": session_id,
                    "message": current_message,
                }

                response = requests.post(
                    f"{agent_api_base}/v3/inference/chat/",
                    headers=headers,
                    json=payload,
                    timeout=120
                )

                response.raise_for_status()

                response_json = response.json()

                print(
                    "Agent Response JSON:",
                    json.dumps(response_json, indent=2)
                )

                content = (
                    response_json.get("content")
                    or response_json.get("response")
                    or response_json.get("message")
                    or str(response_json)
                )

                print(f"Agent Content : {content}")

                #
                # FETCH TRACE
                #
                trace_details = None
                trace_id = None

                time.sleep(2)

                def fetch_trace_data():

                    trace_url = (
                        f"{config_loader.LYZR_AGENT_URL.rstrip('/')}/v3/traces"
                    )

                    trace_headers = {
                        "x-api-key": lyzr_api_key,
                        "Content-Type": "application/json",
                    }

                    max_retries = 15
                    retry_delay = 2

                    print(
                        f"Trace polling started "
                        f"for session: {session_id}"
                    )

                    for retry in range(max_retries):

                        try:

                            #
                            # Always get latest traces
                            #
                            trace_response = requests.get(
                                trace_url,
                                headers=trace_headers,
                                json={
                                    "agent_id": lyzr_agent_id,
                                    "limit": 100,
                                    "sort": "desc",
                                },
                                timeout=30,
                            )

                            trace_response.raise_for_status()

                            traces = trace_response.json() or []

                            print(
                                f"Retry {retry + 1}/{max_retries} "
                                f"returned {len(traces)} traces"
                            )

                            matching_traces = []

                            for trace in traces:

                                trace_session_id = (
                                    str(
                                        trace.get(
                                            "session_id",
                                            ""
                                        )
                                    )
                                    .strip()
                                    .lower()
                                )

                                expected_session = (
                                    str(session_id)
                                    .strip()
                                    .lower()
                                )

                                if (
                                    trace_session_id
                                    == expected_session
                                ):

                                    matching_traces.append(
                                        trace
                                    )

                            #
                            # Session not indexed yet
                            #
                            if not matching_traces:

                                print(
                                    f"Session not found yet: "
                                    f"{session_id}"
                                )

                                time.sleep(
                                    retry_delay
                                )

                                continue

                            #
                            # Newest matching trace
                            #
                            matched_trace = matching_traces[0]

                            trace_id = matched_trace.get(
                                "trace_id"
                            )

                            if not trace_id:

                                print(
                                    "Matching trace found "
                                    "but trace_id missing"
                                )

                                time.sleep(
                                    retry_delay
                                )

                                continue

                            print(
                                f"Matched TraceId: "
                                f"{trace_id}"
                            )

                            #
                            # Fetch trace details
                            #
                            detail_response = requests.get(
                                f"{trace_url}/{trace_id}",
                                headers=trace_headers,
                                timeout=30,
                            )

                            detail_response.raise_for_status()

                            detail = (
                                detail_response.json()
                            )

                            #
                            # Handle list payload
                            #
                            if isinstance(
                                detail,
                                list
                            ):
                                detail = (
                                    detail[0]
                                    if detail
                                    else {}
                                )

                            spans = detail.get(
                                "spans",
                                []
                            )

                            print(
                                f"Span Count: "
                                f"{len(spans)}"
                            )

                            #
                            # Sometimes trace exists but
                            # spans haven't been indexed yet
                            #
                            if not spans:

                                print(
                                    f"Trace {trace_id} "
                                    f"has no spans yet"
                                )

                                time.sleep(
                                    retry_delay
                                )

                                continue

                            formatted_spans = []

                            for span in spans:

                                clean_attrs = (
                                    span.get(
                                        "SpanAttributes",
                                        {}
                                    ).copy()
                                )

                                clean_attrs.pop(
                                    "input",
                                    None
                                )
                                clean_attrs.pop(
                                    "output",
                                    None
                                )
                                clean_attrs.pop(
                                    "llm_output",
                                    None
                                )

                                clean_events = []

                                for attr in span.get(
                                    "Events.Attributes",
                                    []
                                ):

                                    clean_attr = (
                                        attr.copy()
                                    )

                                    clean_attr.pop(
                                        "query",
                                        None
                                    )

                                    clean_events.append(
                                        clean_attr
                                    )

                                formatted_spans.append(
                                    {
                                        "SpanName": span.get(
                                            "SpanName",
                                            ""
                                        ),
                                        "SpanAttributes": (
                                            clean_attrs
                                        ),
                                        "Events.Name": span.get(
                                            "Events.Name",
                                            []
                                        ),
                                        "Events.Attributes": (
                                            clean_events
                                        ),
                                        "chat_messages": {
                                            "input_message":
                                                user_input,
                                            "output_message":
                                                content,
                                        },
                                    }
                                )

                            return {
                                "trace_id": trace_id,
                                "spans": formatted_spans,
                                "raw_spans": spans,
                            }

                        except Exception as ex:

                            print(
                                f"Trace polling retry "
                                f"{retry + 1} failed: {ex}"
                            )

                        time.sleep(
                            retry_delay
                        )

                    print(
                        f"No trace found after "
                        f"{max_retries} retries "
                        f"for session {session_id}"
                    )

                    return None

                trace_result = fetch_trace_data()

                print(f"Traces Result : {trace_result}")

                if trace_result:

                    trace_id = trace_result.get("trace_id")
                    trace_details = {
                        "trace_id": trace_id,
                        "spans": trace_result.get("spans",[]),
                        "raw_spans": trace_result.get("raw_spans",[]),
                    }

                print(f"Matched Trace Id : {trace_id}")
                #
                # SERVICENOW DETECTION FROM TRACE
                #
                if (not servicenow_processed and trace_details):

                    spans = trace_details.get("raw_spans",trace_details.get("spans",[]))

                    snow_action = get_servicenow_action(spans)

                    if snow_action:

                        print(f"ServiceNow action detected : {snow_action}")

                        backend_dir = os.path.abspath(snow_folder_path)
                        folder_path = os.path.join(backend_dir,"ServiceNowstate")
                        os.makedirs(folder_path,exist_ok=True)
                        file_path = os.path.join(folder_path,"SNow_tool_output.json")
                        now = datetime.now()
                        request_id = (f"REQ-{now.strftime('%Y-%m-%d')}-001")
                        client_ref = (f"{snow_action}-{now.strftime('%Y%m%d%H%M%S')}")

                        payload_data = {
                            "request_id": request_id,
                            "tickets": [
                                {
                                    "client_ref": client_ref,
                                    "action": snow_action,
                                    "ticket_type": "incident",
                                    "fields": {
                                        "short_description": user_input,
                                        "description": (
                                            f"User is experiencing a "
                                            f"{user_input}"
                                        ),
                                        "urgency": "3",
                                        "impact": "3",
                                        "caller_id": user_id
                                    }
                                }
                            ]
                        }

                        with open(file_path,"w",encoding="utf-8") as f:

                            json.dump(payload_data,f,indent=4,ensure_ascii=False)

                        print(f"Created ServiceNow file: {file_path}")

                        state_dir = (Path(snow_folder_path)/ "ServiceNowstate")

                        folders = [
                            state_dir / "_processing",
                            state_dir / "_processed",
                            state_dir / "_failed"
                        ]

                        result_data = None

                        #
                        # Wait up to 30 seconds
                        #
                        for _ in range(30):

                            result_files = []

                            for folder in folders:

                                if folder.exists():
                                    result_files.extend(folder.glob("*.result.json"))

                            if result_files:

                                latest_file = max(result_files,key=lambda f: f.stat().st_mtime)

                                print(f"Latest Result File : {latest_file}")

                                with open(latest_file,"r",encoding="utf-8") as f:
                                    result_data = json.load(f)

                                break

                            time.sleep(1)

                        #
                        # Only continue if result found
                        #
                        if result_data:
                            servicenow_processed = True
                            current_message = (
                                    "ServiceNow Tool executed successfully.\n"
                                    f"Result: {json.dumps(result_data)}\n\n"
                                    "Continue with next step tool call "
                                    "if required or give final answer."
                                )
                            continue

                #
                # FINAL RESPONSE
                #
                final_content = content
                break

            #
            # COMPARISON FILE
            #
            comparison = {
                "session_id": session_id,
                "trace_id": trace_id,
                "incident_found": False,
                "incident_type": None
            }

            if trace_details:

                spans = trace_details.get("raw_spans",trace_details.get("spans",[]))

                action = get_servicenow_action(spans)

                if action == "create":

                    tools_called.append("SERVICENOW__CREATE_INCIDENT")

                    comparison["incident_found"] = True
                    comparison["incident_type"] = "create"

                elif action == "update":

                    tools_called.append(
                        "SERVICENOW__UPDATE_INCIDENT"
                    )

                    comparison["incident_found"] = True
                    comparison["incident_type"] = "update"

            return {
                "type": "final_response",
                "data": {
                    "response": final_content,
                    "session_id": session_id,
                    "tools_called": tools_called
                }
            }

        except Exception as e:

            print(f"run_lyzr_chat error : {e}")

            return {
                "type": "error",
                "message": str(e)
            }

    def call_agent_api_chat(self, user_query,api_key, session_id, user_id, agent_id):
        
        
        agent_api_base ="https://agent-prod.studio.lyzr.ai"
        agent_api_url = f"{agent_api_base}/v3/inference/chat/" # Standard chat API (non-streaming)
        
        payload = {
            "user_id": user_id or "default_user",
            "agent_id": agent_id,
            "session_id": session_id or "default_session",
            "message": user_query
        }
        
        
        headers = {
            "x-api-key": api_key,
            "Content-Type": "application/json"
        }
        
        try:
            # Standard synchronous post request (no stream=True)
            response = requests.post(agent_api_url, json=payload, headers=headers)
            response.raise_for_status()
            response_json = response.json()
            
            # Extract content
            final_content = (
                response_json.get("content") or 
                response_json.get("response") or 
                response_json.get("message") or 
                str(response_json)
            )
            

            return {
                "type": "final_response",
                "data": {
                    "response": final_content,
                    "session_id": session_id
                }
            }
            
        except Exception as e:
            print(f"LYZR ERROR: {e}")
            # Mark as failed in DB
            
            return {"type": "error", "message": str(e)}

    def get_trace_details(self, agent_data, api_key, chat_response):
        time.sleep(2)
        trace_url = config_loader.LYZR_AGENT_URL + '/v3/ops/traces'
        headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        params = {"agent_id": agent_data.get('api_agent_id', agent_data.get('agent_id')), "limit": 1}
        
        try:
            trace_response = requests.get(trace_url, headers=headers, params=params)
            trace_response.raise_for_status()
            trace = trace_response.json()
        except requests.exceptions.RequestException as e:
            return jsonify({"error": f"Error calling trace endpoint: {str(e)}"}), 500
        
        if trace["traces"]:
            trace_id = trace["traces"][0]["trace_id"]
            trace_detail_url = f"{config_loader.LYZR_AGENT_URL}/v3/ops/trace/{trace_id}"
            
            try:
                detail_response = requests.get(trace_detail_url, headers=headers)
                detail_response.raise_for_status()
                detail_data = detail_response.json()
                
                target = next(
                    (item for item in detail_data if any(
                        isinstance(msg, dict) and msg.get("content") == "Perform the reflection analysis."
                        for msg in item.get("input_messages", [])
                    )),
                    None
                )
                
                improvement_contents = []
                for item in detail_data:
                    input_messages = item.get("input_messages", [])
                    for msg in input_messages:
                        if (isinstance(msg, dict) and 
                           msg.get("role") == "user" and 
                           ("You are an AI assistant tasked" in msg.get("content", "") or "You have access to these tools. When you need to use a tool" in msg.get("content", ""))):
                           improvement_contents.append(msg.get("content", ""))
                
                content = target.get("output_messages", {}).get("content", "") if target else ""
                explanation = improvement_contents[0] if improvement_contents else ""
                
                return jsonify({
                    "status": chat_response.status_code,
                    "content": content,
                    "explanation": explanation,
                    "response": chat_response.json() if chat_response.headers.get('Content-Type') == 'application/json' else chat_response.text
                }), chat_response.status_code
                
            except requests.exceptions.RequestException as e:
                return jsonify({"error": f"Failed to fetch trace data: {str(e)}"}), 500
            except JSONDecodeError:
                return jsonify({"error": "Invalid JSON response from API"}), 500
        else:
            return jsonify({
                "status": chat_response.status_code,
                "content": 'No data available',
                "explanation": 'No Explanation data available',
                "response": chat_response.json() if chat_response.headers.get('Content-Type') == 'application/json' else chat_response.text
            }), chat_response.status_code
    
    def static_chatbot_agent(self, user_query, event_id,session_id,user_id):
        lyzr_api_url, lyzr_api_key, lyzr_user_id, lyzr_agent_id, lyzr_session_id = config_loader.get_lyzr_external_agent_details()
        
        payload = {
            "user_id": user_id,
            "agent_id": lyzr_agent_id,
            "session_id": session_id,
            "message": user_query
        }
        headers = {
            "x-api-key": lyzr_api_key,
            "Content-Type": "application/json"
        }
        
        try:
            response = requests.post(lyzr_api_url, json=payload, headers=headers)
            self.utils.update_document(
                self.chatbot_tracking_collection,
                {"event_id": event_id},
                {
                    "prompt_output": response.json() if response.headers.get('Content-Type') == 'application/json' else response.text,
                    "status": "completed",
                    "agent_id": lyzr_agent_id,
                    "session_id":session_id
                }
            )
            update_op = {
                'type': 'update_one',
                'filter': {'event_id': event_id},
                'update': {
                    "$set": {
                        "prompt_output": response.json()
                        if response.headers.get('Content-Type') == 'application/json'
                        else response.text,
                        "status": "completed",
                        "agent_id": lyzr_agent_id,
                        "session_id":session_id
                    }
                }
            }
            self._query_db('chatbot_tracking', update_op)

            return buildResponse("Chatbot response", {
                "status": response.status_code,
                "session_id":session_id,
                "response": response.json() if response.headers.get('Content-Type') == 'application/json' else response.text
            }, response.status_code)
        except Exception as e:
            raise ApiError(str(e), e,500)

    def fetch_query_response(self, master_agent_id: str = None, user_type=None):
        # Step 1: Fetch ALL records matching master_agent_id
        query = {}
        if master_agent_id:
            query["master_agent_id"] = master_agent_id
        operation = {
            'type': 'find_all',
            'filter': query
        }
        all_records = self._query_db('chatbot_tracking', operation, user_type)
        if not all_records:
            return []
        filtered_records = []
        if not master_agent_id:
            for all_record in all_records:
                
                master_id = all_record.get("master_agent_id")
                agent_id = all_record.get("agent_id")
                if master_id:
                    master_agent_doc = self.agent_collection.find_one({"agent_id": master_id,"status": "active"})
                    if master_agent_doc:
                        res = self.agent_agency_mapping_collection.find_one({"agent_id":master_id, "status":"active"})
                        agency_id = res.get("agency_id") if res else None
                        if agency_id:
                            task = self.agent_agency_mapping_collection.find({"agency_id": agency_id, "status": "active","order_number": 2})
                            for t in task:
                                sub_agent_id = t.get("agent_id")
                                if sub_agent_id == agent_id:
                                        filtered_records.append(all_record)
                                        break

            all_records = filtered_records
        processed_records = []
        for r in all_records:
            r["_id"] = str(r["_id"])
            # === 1. Safe Rating Extraction ===
            raw_rating = r.get("feedback_rating")
            rating_val = 0.0
            try:
                if raw_rating is not None:
                    rating_val = float(raw_rating)
            except (ValueError, TypeError):
                rating_val = 0.0
            # === 2. Validate Response ===
            prompt_output = r.get("prompt_output")
            response_text = ""
            if not prompt_output:
                continue
               
                    
            else:
                if isinstance(prompt_output, dict):
                    if prompt_output.get("detail") == "Credits exhausted":
                        continue
                    if "error" in prompt_output or "exhausted" in str(prompt_output).lower():
                        continue
                    if not prompt_output.get("response") and not prompt_output.get("module_outputs"):
                        if rating_val > 0:
                            response_text = "[No Response Logged]"
                        else:
                            continue
                    else:
                        response_text = prompt_output.get("response", "")
                elif isinstance(prompt_output, str):
                    response_text = prompt_output.strip()
                    if not response_text:
                        if rating_val > 0:
                            response_text = "[No Response Logged]"
                        else:
                            continue
                else:
                    continue # unknown format
            # === 3. Validate Query ===
            raw_query = r.get("user_query", "").strip()
            if not raw_query:
                continue
            cleaned_query = ' '.join(re.sub(r'[^a-z0-9\s]', '', raw_query.lower()).split())
            # === 4. Safe Timestamp Extraction ===
            ts = r.get("updated_ts")
            timestamp = 0.0
            if isinstance(ts, datetime):
                timestamp = ts.timestamp()
            elif isinstance(ts, (int, float)):
                timestamp = float(ts)
            processed_records.append({
                "record": r,
                "query_text": cleaned_query,
                "timestamp": timestamp,
                "rating": rating_val
            })
        if not processed_records:
            return []
        # === Step 5: Sort by Rating (desc), then Timestamp (desc) ===
        processed_records.sort(
            key=lambda x: (x["rating"], x["timestamp"]),
            reverse=True
        )
                # === Step 6: TF-IDF Vectorization ===
        all_words = set()
        for pr in processed_records:
            all_words.update(pr["query_text"].split())
        word_list = sorted(all_words)
        word_to_index = {word: i for i, word in enumerate(word_list)}
        vocab_size = len(word_list)
        doc_freq = Counter()
        for pr in processed_records:
            doc_freq.update(set(pr["query_text"].split()))
        N = len(processed_records)
        vectors = []
        for pr in processed_records:
            vec = np.zeros(vocab_size)
            words = pr["query_text"].split()
            term_freq = Counter(words)
            for word, tf in term_freq.items():
                if word in word_to_index:
                    idx = word_to_index[word]
                    df = doc_freq[word]
                    idf = np.log((N + 1) / (df + 1)) + 1  # Standard smoothed IDF
                    vec[idx] = tf * idf
            norm = np.linalg.norm(vec)
            if norm > 0:
                vec /= norm
            vectors.append(vec)
        vectors = np.array(vectors)
        if len(processed_records) <= 1:
            final_candidates = processed_records
        else:
            # === Step 7: Simple Pairwise Deduplication with Low Threshold ===
            similarity_threshold = 0.4 # Merge if cosine similarity > 0.15
            # Compute full cosine similarity matrix
            sim_matrix = cosine_similarity(vectors)
            kept_indices = []
            for i in range(len(processed_records)):
                # Always keep the first (best) one
                if not kept_indices:
                    kept_indices.append(i)
                    continue
                # Check if current is too similar to any already kept
                is_duplicate = False
                for k in kept_indices:
                    if sim_matrix[i][k] > similarity_threshold:
                        is_duplicate = True
                        break
                if not is_duplicate:
                    kept_indices.append(i)
            final_candidates = [processed_records[i] for i in kept_indices]
            print(f"[DEBUG] Deduplication complete → kept {len(final_candidates)} / {len(processed_records)}")
        # === Step 8: Limit to 5 unique groups ===
        limited_candidates = final_candidates[:5]
        # === Step 9: Enrich with Agent Name ===
        results = []
        for item in limited_candidates:
            r = item["record"]
            agent_id = r.get("agent_id")
            r["name"] = ""
            if agent_id:
                agent_operation = {
                    'type': 'find_one',
                    'filter': {"agent_id": agent_id},
                    'projection': {"name": 1, "_id": 0}
                }
                agent_doc = self._query_db('agent', agent_operation, user_type)
                if agent_doc:
                    r["name"] = agent_doc.get("name", "")
            results.append(r)
        return results


class FlaskApp(DatabaseCollections):
    def __init__(self):
        super().__init__()
        self.app = Flask(__name__)# NOSONAR - Test fixture only, no external requests
        self.app.secret_key = config_loader.SECRET_KEY
        self.encryption = config_loader.encryption_key
        self.tempdir = config_loader.temp_dir
        self.INCIDENT_FILE_PATH = config_loader.incident_file_path
        self.INDEX_NAME = config_loader.index_name
        self.IsServiceMode = config_loader.IsServiceMode
        self.Isprod = config_loader.Isprod
        self.Is_UAT = config_loader.Is_UAT
        
        self.mongo_client = config_loader.mongo_client
        self.db =config_loader.main_db
        self.fs = gridfs.GridFS(self.db)
        
        
        opensearch = config_loader.get_opensearch_details()
        
        self.client = OpenSearch(
            hosts=[{'host': opensearch["host"], 'port': opensearch["port"], 'scheme': 'http'}],
            http_auth=(opensearch["username"], opensearch["password"]), 
            verify_certs=False,
            
            ssl_show_warn=False,
            sniff_on_start=False,
            sniff_on_connection_fail=False
        )
        CORS(self.app)
        # ➕ Register middleware BEFORE setting up routes (good practice)
        setup_middlewares(self)
        self.password_manager = PasswordManager()
        self.chatbot_agent = ChatbotAgent()
        self.utils = CommonUtils()
        self.testcase_manager = TestCaseManager()
        self.agent_manager = AgentManager()
        self.agency_manager = AgencyManager()
        self.user_manager = UserManager()
        self.workflow_manager = TestWorkflowManager()
        self.knowledgestore_manager = KnowledgeStoreManager()
        self.role_manager = RoleManager()
        self.team_manager = TeamManager()
        self.lyzr_api_manager = LyzrAPIManagement()
        self.automation_library_api_manager = AutomationLibraryAPI()
        self.insight_manager = InsightsManager()
        self.external_app_manager = ExternalApp()
        self.ticket_functions = TicketFunctions()
        
        ## self.socketio = SocketIO(self.app, cors_allowed_origins="*",async_mode='threading')
        
            # Cleanup if needed
        # CRITICAL FIXES for IIS/ARR compatibility
        self.socketio = SocketIO(
        self.app,
        cors_allowed_origins="*,http://localhost:4200/",
        async_mode='threading',
        path='/socket.io',
        perMessageDeflate=False,
        logger=True,
        engineio_logger=True,
        )

        self.workflow_service = WorkflowManager(socketio=self.socketio)
        self.register_socket_events()

        self.setup_routes()
        # self.app.register_blueprint(voice_bp, url_prefix='/voice-agent')
    
        original_add_url_rule = self.app.add_url_rule
 
        # Create a list of existing rules before modifying the map
        existing_rules = list(self.app.url_map.iter_rules())
        for rule in existing_rules:
            rule_string = rule.rule
            endpoint_name = rule.endpoint
            # Skip if it's static, docs, or already starts with /v1
            if (rule_string.startswith('/v1') or 
                rule_string in ['/openapi.json', '/docs', '/static'] or
                endpoint_name.startswith('static')):
                continue
            # Get the view function safely
            try:
                view_func = self.app.view_functions.get(endpoint_name)
            except:
                continue
            if view_func is None:
                continue
 
            # Extract the original HTTP methods
            methods = list(rule.methods) if rule.methods else ['GET']
            if 'OPTIONS' in methods:
                methods.remove('OPTIONS')
            if 'HEAD' in methods:
                methods.remove('HEAD')
            # Register the exact same route, but with /v1
            v1_rule = f"/v1{rule_string}"
            v1_endpoint = f"{endpoint_name}_v1"
            original_add_url_rule(v1_rule, endpoint=v1_endpoint, view_func=view_func, methods=methods)

    def register_socket_events(self):

        @self.socketio.on("connect")
        def handle_connect():
            print("✅ CLIENT CONNECTED")
            print("SID:", request.sid)
            emit("connected", {"data": "Connected to server"})

        @self.socketio.on("disconnect")
        def handle_disconnect():
            print("❌ CLIENT DISCONNECTED")
            print("SID:", request.sid)

    def _fetch_agent_traces(self, agent_id: str, limit: int = 1, start_date: str = None, end_date: str = None) -> list:
        """Fetch traces from Lyzr agent API"""
        logger.info(f"[TRACE FETCH] Starting for agent_id: {agent_id}")
        
        try:
            doc = self.agent_collection.find_one({"agent_id": agent_id}, {"api_agent_id": 1})
            lyzr_agent_id = doc.get("api_agent_id") if doc else agent_id
            logger.info(f"[TRACE FETCH] Mapped internal_id={agent_id} to lyzr_id={lyzr_agent_id}")

            api_key = self.get_agent_api_key_by_id(agent_id)
            trace_url = f"{self.lyzr_agent_urls()}v3/traces"
            
            headers = {"x-api-key": api_key, "Content-Type": "application/json"}
            params = {"agent_id": lyzr_agent_id, "limit": limit}
            
            if start_date:
                params["start_date"] = start_date
            if end_date:
                params["end_date"] = end_date
            
            response = requests.get(trace_url, headers=headers, params=params, timeout=30)
            response.raise_for_status()
            
            raw_response = response.json()
            
            if isinstance(raw_response, list):
                return [self._convert_trace_timestamps_to_utc(trace) for trace in raw_response]
 
            elif isinstance(raw_response, dict):
                traces = raw_response.get('data', raw_response.get('traces', []))
                return [self._convert_trace_timestamps_to_utc(trace) for trace in traces]
            else:
                logger.error(f"[TRACE FETCH] Unexpected response format from API")
                return []
            
        except Exception as e:
            logger.error(f"[TRACE FETCH] Error fetching traces for agent {agent_id}: {str(e)}")
            return []

    def _fetch_trace_detail(self, trace_id: str, agent_id: str) -> dict:
        """Fetch detailed trace information from Lyzr agent API"""
        try:
            api_key = self.get_agent_api_key_by_id(agent_id)
            trace_detail_url = f"{self.lyzr_agent_urls()}v3/traces/{trace_id}"
            
            headers = {"x-api-key": api_key, "Content-Type": "application/json"}
            
            response = requests.get(trace_detail_url, headers=headers, timeout=30)
            response.raise_for_status()
            
            raw_data = response.json()
             # Convert trace data timestamps to UTC
            
            trace_data = raw_data[0] if isinstance(raw_data, list) and raw_data else raw_data
            trace_data = self._convert_trace_timestamps_to_utc(trace_data)
            
            # Format spans – extract only the required fields
            formatted_spans = []
            if "spans" in trace_data and isinstance(trace_data["spans"], list):
                for span in trace_data["spans"]:
                    # Extract input and output before removing them
                    input_value = span.get("SpanAttributes", {}).get("input", "")
                    output_value = span.get("SpanAttributes", {}).get("output", "")
                    
                    # Create chat_messages if input or output exists
                    chat_messages = {}
                    if input_value or output_value:
                        chat_messages = {
                            "input_message": input_value,
                            "output_message": output_value
                        }
                    
                    # Clean SpanAttributes – remove input, output, llm_output
                    clean_attrs = span.get("SpanAttributes", {}).copy()
                    clean_attrs.pop("input", None)
                    clean_attrs.pop("output", None)
                    clean_attrs.pop("llm_output", None)
                    
                    # Clean Events.Attributes – remove "query" from each object
                    clean_events_attrs = []
                    for attr in span.get("Events.Attributes", []):
                        clean_attr = attr.copy()
                        clean_attr.pop("query", None)
                        clean_events_attrs.append(clean_attr)
                    
                    formatted_span = {
                        "SpanName": span.get("SpanName", ""),
                        "SpanAttributes": clean_attrs,
                        "Events.Name": span.get("Events.Name", []),
                        "Events.Attributes": clean_events_attrs
                    }
                    
                    # Add chat_messages if it has content
                    if chat_messages: 
                        formatted_span["chat_messages"] = chat_messages
                    
                    formatted_spans.append(formatted_span)
        
            return {"spans": formatted_spans}
        
        except Exception as e:
            logger.error(f"[TRACE DETAIL] Error fetching trace {trace_id}: {str(e)}")
            return {}

    def lyzr_agent_urls(self):
        """Get Lyzr agent URL with trailing slash"""
        if str(config_loader.LYZR_AGENT_URL).endswith('/'):
            return config_loader.LYZR_AGENT_URL
        return config_loader.LYZR_AGENT_URL + '/'

    @staticmethod
    def daily_limits(limit_count=5, cooldown_seconds=10):
        def decorator(f):
            @wraps(f)
            def decorated_function(instance, *args, **kwargs):
                current_user = get_current_user()
                user_id = current_user.get("user_id") if current_user else "anonymous"
                
                now = datetime.now(timezone.utc)
                today = now.strftime("%Y-%m-%d")
                record_id = f"{user_id}_{today}"
                cooldown_threshold = now - timedelta(seconds=cooldown_seconds)

                # STEP 1: Check if the daily limit is already hit (Read-only)
                doc = instance.rate_limiting_collection.find_one({"_id": record_id})
                if doc and doc.get("count", 0) >= limit_count:
                    return jsonify({"error": "Daily limit reached"}), 429

                # STEP 2: Atomic Update with Filter
                # This is the part that prevents the 6-api burst issue.
                try:
                    # We try to increment ONLY if last_updated is old.
                    # If 6 hit at once, only the FIRST one will find a match and update.
                    result = instance.rate_limiting_collection.update_one(
                        {
                            "_id": record_id,
                            "$or": [
                                {"last_updated": {"$lt": cooldown_threshold}},
                                {"last_updated": {"$exists": False}}
                            ]
                        },
                        {
                            "$inc": {"count": 1},
                            "$set": {"last_updated": now},
                            "$setOnInsert": {"user_id": user_id, "createdAt": now}
                        },
                        upsert=True
                    )
                    

                except Exception as e:
                    print(f"Error occurred: {e}")
                    

                return f(instance, *args, **kwargs)
            return decorated_function
        return decorator

    # @staticmethod
    # def daily_limit(limit_count=5, cooldown_seconds=10, scope=None):
        # def decorator(f):
            # @wraps(f)
            # def decorated_function(instance, *args, **kwargs):
                # current_user = get_current_user()
                # user_id = current_user.get("user_id") if current_user else "anonymous"
                
                # # Use the provided scope, or default to the function name
                # # This ensures 'API_A' and 'API_B' have separate buckets
                # api_name = scope or f.__name__

                # if api_name.startswith("call_agent"):
                    # api_name = "insights_call_agent"
                
                # now = datetime.now(timezone.utc)
                # today = now.strftime("%Y-%m-%d")
                
                # # Unique ID per User + API + Date
                # record_id = f"{user_id}_{api_name}_{today}"
                # cooldown_threshold = now - timedelta(seconds=cooldown_seconds)

                # # 1. PRE-CHECK: Prevent database write if we know it's already full
                # doc = instance.rate_limiting_collection.find_one({"_id": record_id})
                # if doc and doc.get("count", 0) >= limit_count:
                    # return jsonify({"error": f"Daily limit for {api_name} reached"}), 429

                # # 2. ATOMIC UPDATE
                # try:
                    # result = instance.rate_limiting_collection.update_one(
                        # {
                            # "_id": record_id,
                            # "$or": [
                                # {"last_updated": {"$lt": cooldown_threshold}},
                                # {"last_updated": {"$exists": False}}
                            # ],
                            # "count": {"$lt": limit_count} # Double check limit inside atomic op
                        # },
                        # {
                            # "$inc": {"count": 1},
                            # "$set": {"last_updated": now},
                            # "$setOnInsert": {
                                # "user_id": user_id, 
                                # "api_name": api_name, 
                                # "createdAt": now
                            # }
                        # },
                        # upsert=True
                    # )
                    
                    # # If matched_count is 0 and upserted_id is None, 
                    # # it means the cooldown is still active or limit was reached 
                    # # between our Pre-check and this Update.
                    # if result.matched_count == 0 and result.upserted_id is None:
                        # return jsonify({"error": "Too many requests. Please wait."}), 429

                # except Exception as e:
                    # # Handle Duplicate Key Error (common in high-concurrency upserts)
                    # print(f"Rate limit concurrency trigger: {e}")
                    # return jsonify({"error": "Too many requests. Please wait."}), 429

                # return f(instance, *args, **kwargs)
            # return decorated_function
        # return decorator
        
    @staticmethod
    def daily_limit(limit_count=5, cooldown_seconds=10, grace_period_seconds=2, scope=None):
        def decorator(f):
            @wraps(f)
            def decorated_function(instance, *args, **kwargs):
                current_user = get_current_user()
                user_id = current_user.get("user_id") if current_user else "anonymous"
                
                api_name = scope or f.__name__
                if api_name.startswith("call_agent"):
                    api_name = "insights_call_agent"
                
                now = datetime.now(timezone.utc)
                today = now.strftime("%Y-%m-%d")
                record_id = f"{user_id}_{api_name}_{today}"
                
                is_refresh = False
                try:
                    # Safely check if 'refresh' is true in the JSON body
                    if request.is_json:
                        is_refresh = request.json.get('refetch') is True
                except Exception:
                    pass

                # 1. READ STATE
                doc = instance.rate_limiting_collection.find_one({"_id": record_id})
                
                if doc:
                    last_updated = doc.get("last_updated")
                    if last_updated:
                        if last_updated.tzinfo is None:
                            last_updated = last_updated.replace(tzinfo=timezone.utc)
                        
                        seconds_since_last = (now - last_updated).total_seconds()

                        # --- GRACE PERIOD LOGIC ---
                        # If the call is within 2 seconds, it's the same "click".
                        # We allow it immediately and DO NOT increment the DB count.
                        if seconds_since_last < grace_period_seconds:
                            return f(instance, *args, **kwargs)

                        # --- COOLDOWN LOGIC ---
                        if seconds_since_last < cooldown_seconds:
                            wait_time = int(cooldown_seconds - seconds_since_last)
                            return jsonify({
                                "error": f"Too fast. Please wait {wait_time} seconds."
                            }), 429

                    # --- DAILY LIMIT CHECK ---
                    if doc.get("count", 0) >= limit_count:
                        return jsonify({"error": f"Daily limit for {api_name} reached"}), 429

                # 2. ATOMIC UPDATE (Only reached if outside grace/cooldown window)
                try:
                    # Prepare update operations
                    update_ops = {
                        "$set": {"last_updated": now},
                        "$setOnInsert": {
                            "user_id": user_id, 
                            "api_name": api_name, 
                            "createdAt": now
                        }
                    }

                    # ONLY increment if NOT a refresh
                    if not is_refresh:
                        update_ops["$inc"] = {"count": 1}
                    else:
                        # If it's a refresh, ensure the field exists if it's an upsert
                        update_ops["$setOnInsert"]["count"] = 0

                    result = instance.rate_limiting_collection.update_one(
                        {
                            "_id": record_id,
                            "count": {"$lt": limit_count} 
                        },
                        update_ops,
                        upsert=True
                    )
                    
                    if result.matched_count == 0 and result.upserted_id is None:
                        return jsonify({"error": f"Daily limit reached"}), 429
                    
                    

                except DuplicateKeyError:
                    # Handle race condition where two requests hit update_one at the exact same ms
                    # If one just bumped it to the limit, this one fails.
                    return jsonify({"error": "Daily limit reached"}), 429
                except Exception as e:
                    return jsonify({"error": "Internal server error"}), 500

                return f(instance, *args, **kwargs)
            return decorated_function
        return decorator

    def setup_routes(self):
        # Health check endpoint
        self.app.add_url_rule('/health', 'health_check', self.health_check, methods=['GET'])   
        self.app.add_url_rule('/test-sensitive-encryption', 'test_sensitive_encryption', self.test_sensitive_encryption, methods=['POST'])

        #Subscription-Re_Sync_All
        self.app.add_url_rule('/refreshsubScriptionDetails', 'refresh_subscription_details', self.refreshsubScriptionDetails, methods=['POST'])
        
        # User Management Routes
        self.app.add_url_rule('/DoLogin', 'do_login', self.do_login, methods=['POST'])
        self.app.add_url_rule('/api/DoLogin', 'do_login', self.do_login, methods=['POST'])
        self.app.add_url_rule('/refresh-token', 'refresh_token', session_manager.refresh_token, methods=['POST'])
        self.app.add_url_rule('/session-token', 'session', self.session_token, methods=['POST'])
        self.app.add_url_rule('/verify-token', 'verify-token', self.verify_token, methods=['POST'])
        self.app.add_url_rule('/GetReCaptchaConfig', 'get_recaptcha_config', self.get_recaptcha_config, methods=['GET'])
        self.app.add_url_rule('/OTPDetails', 'otp_details', self.otp_details, methods=['POST'])
        self.app.add_url_rule('/ValidateOTP', 'validate_otp', self.validate_otp, methods=['POST'])
        self.app.add_url_rule('/GetUserDetails', 'get_user_details', self.get_user_details, methods=['GET'])
        self.app.add_url_rule('/SendRecoveryMail/<email>', 'send_recovery_mail', self.send_recovery_mail, methods=['POST'])
        self.app.add_url_rule('/SendAgentApprovalMail', 'send_agent_approval_mail', self.send_agent_approval_mail, methods=['POST'])
        self.app.add_url_rule('/SentMailUserManagement/<mail_id>', 'sent_mail_user_management', self.sent_mail_user_management, methods=['POST'])
        self.app.add_url_rule('/AddUser', 'add_user', self.add_user, methods=['POST'])
        self.app.add_url_rule('/Updatedetails', 'update_user', self.update_user, methods=['POST'])
        self.app.add_url_rule('/UserActiveOrInActive', 'user_active_or_in_active', self.user_active_or_in_active, methods=['POST'])
        self.app.add_url_rule('/DeleteUserDetails', 'delete_user_detail', self.delete_user_detail, methods=['POST'])
        self.app.add_url_rule('/UploadUserImage', 'upload_image', self.upload_image, methods=['POST'])
        self.app.add_url_rule('/checkPassword', 'check_password', self.check_password, methods=['POST'])
        self.app.add_url_rule('/getProjectTeamsRoles', 'get_project_teams_roles_route', self.get_project_teams_roles_route, methods=['POST'])
        self.app.add_url_rule('/getTeamsByProject', 'get_teams_by_project', self.get_teams_by_project, methods=['POST'])
        self.app.add_url_rule('/getRolesByProjectAndTeam', 'get_roles_by_project_and_team', self.get_roles_by_project_and_team, methods=['POST'])
        
        # Role Management Routes
        self.app.add_url_rule('/roles', 'get_roles', self.get_roles, methods=['GET'])
        self.app.add_url_rule('/allPermissions', 'get_all_permissions', self.get_all_permissions, methods=['GET'])
        self.app.add_url_rule('/permissions', 'get_permissions', self.get_permissions, methods=['GET'])
        self.app.add_url_rule('/permissions', 'get_permissions_for_role', self.get_permissions_for_role, methods=['POST'])
        self.app.add_url_rule('/permissions', 'update_permissions', self.update_permissions, methods=['PUT'])
        self.app.add_url_rule('/update_permissions', 'update_role_permissions', self.update_role_permissions, methods=['PUT'])
        self.app.add_url_rule('/getPageConfiguration', 'get_page_configuration', self.get_page_configuration, methods=['GET'])
        self.app.add_url_rule('/getAllRolePermissions', 'get_all_role_permissions', self.get_all_role_permissions, methods=['GET'])
        
        # Insights Routes
        self.app.add_url_rule('/GetInsightAgentsDetails', 'get_insight_agents', self.get_insight_agents, methods=['GET'])
        
        # Test Case Routes
        self.app.add_url_rule('/langflow', 'run_workflow_endpoint', self.run_workflow_endpoint, methods=['POST'])
        self.app.add_url_rule('/GetEventResponse', 'get_event_workflow', self.get_event_workflow, methods=['POST'])
        self.app.add_url_rule('/GetEvents', 'get_user_events', self.get_user_events, methods=['POST'])
        self.app.add_url_rule('/DeleteAgent/<agent_id>', 'delete_agent', self.delete_agent, methods=['POST'])
        self.app.add_url_rule('/DeleteAgentWithApproval', 'delete_agent_with_approval', self.delete_agent_with_approval, methods=['POST'])
        
        # Agent Management Routes
        self.app.add_url_rule('/GetAllAgents', 'get_all_agents', self.get_all_agents, methods=['POST'])
        self.app.add_url_rule('/GetAgentDetailsForApproval/<agent_id>', 'get_agent_details_for_approval', self.get_agent_details_for_approval, methods=['GET'])
        self.app.add_url_rule('/GetAllVoiceAgents', 'get_all_voice_agents', self.get_all_voice_agents, methods=['POST'])
        self.app.add_url_rule('/voice-agent/sessions/start', 'get_session_start_agent', self.get_session_start_agent, methods=['POST'])
        self.app.add_url_rule('/voice-agent/sessions/end', 'get_session_end_agent', self.get_session_end_agent, methods=['POST'])
        self.app.add_url_rule('/dropdowns/all', 'get_all_dropdowns', self.get_all_dropdowns, methods=['GET'])
        self.app.add_url_rule('/AddExternalAgent', 'fetch_and_insert_agent', self.fetch_and_insert_agent, methods=['POST'])
        self.app.add_url_rule('/AddUpdateExternalNewAgent', 'add_update_external_new_agent', self.add_update_external_new_agent, methods=['POST'])
        self.app.add_url_rule('/AddAgentDetails', 'add_agent_details', self.add_agent_details, methods=['POST'])
        self.app.add_url_rule('/UpdateAgentDetails/<agent_id>', 'update_agent_details', self.update_agent_details, methods=['PUT'])
        self.app.add_url_rule('/agentcounts', 'get_agent_counts', self.get_agent_counts, methods=['GET'])
        self.app.add_url_rule('/GetProviderDetails', 'get_provider_details', self.get_provider_details, methods=['POST'])
        self.app.add_url_rule('/LatestAgentDetails', 'get_external_data', self.get_external_data, methods=['POST'])
        
        # Agency Management Routes
        self.app.add_url_rule('/GetAgencyWithAgents', 'get_agency_with_agents', self.get_agency_with_agents, methods=['GET'])
        self.app.add_url_rule('/agencytypes', 'get_agency_types', self.get_agency_types, methods=['GET'])
        self.app.add_url_rule('/OnboardAgencyWithAgents', 'onboard_and_update_agency_with_agents', self.onboard_and_update_agency_with_agents, methods=['POST'])
        self.app.add_url_rule('/agency/stats', 'get_trending_agency_stats', self.get_trending_agency_stats, methods=['GET'])
        self.app.add_url_rule('/DeleteAgencyDetails/<agency_id>', 'delete_agency', self.delete_agency, methods=['DELETE'])
        self.app.add_url_rule('/GetTaskAgentsDetails', 'get_task_agents_with_agencies', self.get_task_agents_with_agencies, methods=['GET'])
        self.app.add_url_rule('/GetAgentAndOrder2Agents', 'get_agent_and_order2_agents', self.get_agent_and_order2_agents, methods=['POST'])
        self.app.add_url_rule('/AgencyMappings', 'agency_mappings', self.agency_mappings, methods=['POST'])
        self.app.add_url_rule('/AgencyStatistics', 'agency_statistics', self.agency_statistics, methods=['GET'])
        self.app.add_url_rule('/getMCPStatistics', 'get_mcp_statistics', self.get_mcp_statistics, methods=['GET'])

        # Chatbot Routes
        self.app.add_url_rule('/chatbotagent', 'chatbot_agent_handler', self.chatbot_agent_handler, methods=['POST'])
        self.app.add_url_rule('/chatbotagent/chat', 'chatbot_agent_handler_chat', self.chatbot_agent_handler_chat, methods=['POST'])
        self.app.add_url_rule('/popularQueries', 'get_popular_queries', self.get_popular_queries, methods=['POST'])
        self.app.add_url_rule('/getRecentData', 'get_recent_data', self.get_recent_data, methods=['POST'])
        self.app.add_url_rule('/getRecentDataAgent', 'get_recent_data_agent', self.get_recent_data_agent, methods=['POST'])
        self.app.add_url_rule('/getmasteragent', 'get_master', self.get_master, methods=['POST'])
        self.app.add_url_rule('/routeQuery', 'route_query_api', self.route_query_api, methods=['POST'])
        self.app.add_url_rule('/feedback', 'incident_feedback', self.ticket_functions.incident_feedback, methods=['POST'])
        self.app.add_url_rule('/patch-by-number', 'patch_incident_by_number', self.ticket_functions.patch_incident_by_number, methods=['POST'])
        self.app.add_url_rule('/webhook/incident/preview', 'preview_dag', self.ticket_functions.preview_dag, methods=['POST'])
        self.app.add_url_rule('/webhook/incident', 'receive_incident', self.ticket_functions.receive_incident, methods=['POST'])
        self.app.add_url_rule('/updateFeedBackDetails', 'update_feedback_details', self.update_feedback_details, methods=['POST'])
        self.app.add_url_rule('/updatereviewFeedBackDetails', 'update_review_feedback_details', self.update_review_feedback_details, methods=['POST'])
        self.app.add_url_rule('/getGraphData', 'fetch_and_transform_graph', self.fetch_and_transform_graph, methods=['POST'])
        self.app.add_url_rule('/getKnowlegeGraphDetails', 'get_knowlege_graph_collections', self.get_knowlege_graph_collections, methods=['GET'])
        self.app.add_url_rule('/switchProject', 'switch_project', self.switch_project, methods=['PUT'])
        self.app.add_url_rule('/addProject', 'add_project', self.add_project_details, methods=['POST'])
        self.app.add_url_rule('/getProject', 'get_all_projects', self.get_all_projects, methods=['GET'])
        self.app.add_url_rule('/updateProject/<project_id>', 'update_project', self.update_project_details, methods=['PUT'])
        self.app.add_url_rule('/deleteProject/<project_id>', 'delete_project', self.delete_project, methods=['DELETE'])
        self.app.add_url_rule('/getTeams', 'get_all_teams', self.get_all_teams, methods=['GET'])
        self.app.add_url_rule('/getRoles', 'get_all_roles', self.get_all_roles, methods=['GET'])
        self.app.add_url_rule('/download', 'download_file', self.download_file, methods=['POST'])
        self.app.add_url_rule('/download-docx', 'download_docx', self.download_docx, methods=['POST'])
        self.app.add_url_rule('/getqueryresponse', 'getqueryresponse', self.get_query_response, methods=['POST'])

        #lyzr traces
        self.app.add_url_rule('/traces', 'get_trace', self.get_trace, methods=['GET'])
        self.app.add_url_rule('/trace/<trace_id>', 'trace_details', self.trace_details, methods=['GET'])
        self.app.add_url_rule('/grouped-logs', 'grouped_loges', self.grp_log, methods=['GET'])
        self.app.add_url_rule('/log-details', 'log_details', self.log_details, methods=['GET'])
        
        self.app.add_url_rule('/capture-workflow-agent-traces', 'capture_workflow_agent_traces', self.capture_workflow_agent_traces, methods=['POST'])

        # self.app.add_url_rule('/switchProject', 'switch_project', self.switch_project, methods=['PUT'])
    
        #KnowlegeGraph Routes
        self.app.add_url_rule('/getKnowledgestoreDetailsCounts', 'get_knowledgestore_details_counts', self.get_knowledgestore_details_counts, methods=['GET'])
        self.app.add_url_rule('/GetKnowledgeStoreDetails', 'get_knowledgestore_details', self.get_knowledgestore_details, methods=['POST'])
        self.app.add_url_rule('/GetKnowledgeStoreDocDetails/<rag_id>', 'get_knowledgestore_doc_details', self.get_knowledgestore_doc_details, methods=['POST'])
        self.app.add_url_rule('/GetKnowledgeStoreStatistics', 'get_knowledgestore_statistics', self.get_knowledgestore_statistics, methods=['GET'])

        #Cronjob
        self.app.add_url_rule('/getScheduledAgents', 'get_scheduled_agents', self.get_scheduled_agents, methods=['GET'])
        
        #Work_Flow
        self.app.add_url_rule('/workflows', 'get_all_workflows', self.get_all_workflows, methods=['GET'])
        self.app.add_url_rule('/workflows/<flow_id>', 'get_workflow', self.get_workflow, methods=['GET'])
        self.app.add_url_rule('/workflows', 'create_workflow', self.create_workflow, methods=['POST'])
        self.app.add_url_rule('/workflows/<flow_id>', 'update_workflow', self.update_workflow, methods=['PUT'])
        self.app.add_url_rule('/workflows/<flow_id>', 'delete_workflow', self.delete_workflow, methods=['DELETE'])
        self.app.add_url_rule('/workflowRun', 'workflow_run_agent', self.workflow_run_agent, methods=['POST'])
        self.app.add_url_rule('/workflows/import', 'import_workflow', self.import_workflow, methods=['POST'])
        self.app.add_url_rule('/getWorkflowStatistics', 'get_workflow_statistics', self.get_workflow_statistics, methods=['GET'])
        self.app.add_url_rule('/getAllMappings','get_all_mappings',self.get_all_mappings, methods=['GET'])
        self.app.add_url_rule('/getWorkflowResponse/<workflow_id>/<is_review>', 'get_latest_completed', self.get_latest_completed, methods=['GET'])
        self.app.add_url_rule('/getWorkflowEventResponse', 'get_workflow_event_response', self.get_workflow_event_response, methods=['POST'])
        self.app.add_url_rule('/api/logs', 'get_logs', self.get_logs, methods=['GET'])
        self.app.add_url_rule('/workflow/<workflow_id>/<event_id>/logs-and-traces', 'get_workflow_logs_and_traces_api', self.get_workflow_logs_and_traces_api, methods=['GET'])
        
        #role management routes
        self.app.add_url_rule('/roles', 'create_role', self.create_role, methods=['POST'])
        self.app.add_url_rule('/roles', 'get_all_roles', self.get_all_roles, methods=['GET'])
        self.app.add_url_rule('/roles/<role_id>', 'get_role_by_id', self.get_role_by_id, methods=['GET'])
        self.app.add_url_rule('/roles/<role_id>', 'update_role', self.update_role, methods=['PUT'])
        self.app.add_url_rule('/roles/<role_id>', 'delete_role', self.delete_role, methods=['DELETE'])
        self.app.add_url_rule('/roles/active', 'get_active_roles', self.get_active_roles, methods=['GET'])
        self.app.add_url_rule('/roles/bulk', 'create_multiple_roles', self.create_multiple_roles, methods=['POST'])
 
 
        #team management routes
        self.app.add_url_rule('/teams', 'create_team', self.create_team, methods=['POST'])
        self.app.add_url_rule('/teams', 'get_all_teams_manage', self.get_all_teams_manage, methods=['GET'])
        self.app.add_url_rule('/teams/<team_id>', 'get_team_by_id', self.get_team_by_id, methods=['GET'])
        self.app.add_url_rule('/teams/<team_id>', 'update_team', self.update_team, methods=['PUT'])
        self.app.add_url_rule('/teams/<team_id>', 'delete_team', self.delete_team, methods=['DELETE'])
        self.app.add_url_rule('/teams/active', 'get_active_teams', self.get_active_teams, methods=['GET'])
        self.app.add_url_rule('/teams/bulk', 'create_multiple_teams', self.create_multiple_teams, methods=['POST'])
        
        #Insight routes
        self.app.add_url_rule('/insightanalytics', 'get_all_analytics', self.get_all_analytics, methods=['POST']) 
        self.app.add_url_rule('/smartinsightanalytics', 'analyze_single_incident', self.analyze_single_incident, methods=['POST']) 
        self.app.add_url_rule('/insightingestion', 'trigger_ingestion', self.trigger_ingestion, methods=['POST'])
        self.app.add_url_rule('/createinsightindex', 'create_insight_index', self.create_insight_index, methods=['POST'])
        self.app.add_url_rule('/insights/kpis', 'get_kpis', self.get_kpis, methods=['POST'])
        self.app.add_url_rule('/insights/call_agent/topapplications', 'call_agent_get_top_applications', self.call_agent_get_top_applications, methods=['POST'])
        self.app.add_url_rule('/insights/call_agent/topinfrastructuresystems', 'call_agent_get_top_infrastructure_systems', self.call_agent_get_top_infrastructure_systems, methods=['POST'])
        self.app.add_url_rule('/insights/call_agent/topissues', 'call_agent_get_top_issues', self.call_agent_get_top_issues, methods=['POST'])
        # self.app.add_url_rule('/insights/trendbyapplication', 'get_trend_by_application', self.get_trend_by_application, methods=['POST'])
        # self.app.add_url_rule('/insights/trendbyapplication', 'process_incident_trends', self.process_incident_trends, methods=['POST'])
        self.app.add_url_rule('/insights/call_agent/topresolution', 'call_agent_get_top_resolution_application', self.call_agent_get_top_resolution_application, methods=['POST'])
        self.app.add_url_rule('/insights/call_agent/toprootcause', 'call_agent_get_top_rootcause_application', self.call_agent_get_top_rootcause_application, methods=['POST'])
        self.app.add_url_rule('/insights/call_agent/aiinference', 'call_agent_get_ai_inference_application', self.call_agent_get_ai_inference_application, methods=['POST'])
        self.app.add_url_rule('/insights/call_agent/automationsteps', 'call_agent_get_potential_automation', self.call_agent_get_potential_automation, methods=['POST'])
        self.app.add_url_rule('/insights/call_agent/topdefects', 'call_agent_get_top_defects', self.call_agent_get_top_defects, methods=['POST'])
        # self.app.add_url_rule('/insights/defectsolution', 'get_defect_solution', self.get_defect_solution, methods=['POST'])
        self.app.add_url_rule('/insights/call_agent/featureimpacted', 'call_agent_get_feature_impacted', self.call_agent_get_feature_impacted, methods=['POST'])
        self.app.add_url_rule('/insights/call_agent/epicimpacted', 'call_agent_get_epic_impacted', self.call_agent_get_epic_impacted, methods=['POST'])
        self.app.add_url_rule('/insights/call_agent/testcaseimpacted', 'call_agent_get_testcase_impacted', self.call_agent_get_testcase_impacted, methods=['POST'])
        self.app.add_url_rule('/insights/call_agent/testcasefrequency', 'call_agent_get_testcase_prioritization', self.call_agent_get_testcase_prioritization, methods=['POST'])
        self.app.add_url_rule('/insights/call_agent/testcaseprioritization', 'call_agent_get_testcase_prioritization_epicfeature', self.call_agent_get_testcase_prioritization_epicfeature, methods=['POST'])
        self.app.add_url_rule('/insights/call_agent/testcaseregression', 'call_agent_get_potential_testcaseregression', self.call_agent_get_potential_testcaseregression, methods=['POST'])
        self.app.add_url_rule('/insights/call_agent/testcasecoverage', 'call_agent_test_coverage', self.call_agent_test_coverage, methods=['POST'])
        self.app.add_url_rule('/insights/call_agent/testquality', 'call_agent_test_quality_indicators', self.call_agent_test_quality_indicators, methods=['POST'])
        self.app.add_url_rule('/insights/call_agent/testimpacted', 'call_agent_impacted_tests', self.call_agent_impacted_tests, methods=['POST'])
        self.app.add_url_rule('/insights/call_agent/testduplication', 'call_agent_potential_duplication_signals', self.call_agent_potential_duplication_signals, methods=['POST'])
        self.app.add_url_rule('/insights/call_agent/testgap', 'call_agent_test_gap', self.call_agent_test_gap, methods=['POST'])
        self.app.add_url_rule('/insights/call_agent/testautomation', 'call_agent_potential_test_automation', self.call_agent_potential_test_automation, methods=['POST'])
        
        self.app.add_url_rule('/insights/opensearchindex', 'get_indexes', self.get_indexes, methods=['POST'])
        self.app.add_url_rule('/insights/indexbyid', 'get_indexesbyid', self.get_indexesbyid, methods=['POST'])
        self.app.add_url_rule('/insights/extractcolumn', 'extract_column', self.extract_column, methods=['POST'])
        self.app.add_url_rule('/insights/extractsheet', 'extract_sheets', self.extract_sheets, methods=['POST'])
        self.app.add_url_rule('/insights/ingestandupdatedoc', 'ingest_details_document', self.ingest_details_document, methods=['POST'])
        self.app.add_url_rule('/insights/opensearchingestandupdate', 'ingest_document', self.ingest_document, methods=['POST'])
        self.app.add_url_rule('/insights/deleteindex', 'delete_index', self.delete_index, methods=['POST'])
        self.app.add_url_rule('/insights/jiraprojectkey', 'get_projectkeys', self.get_projectkeys, methods=['POST'])
        self.app.add_url_rule('/insights/insightshistory', 'get_insights_history', self.get_insights_history, methods=['POST'])
        self.app.add_url_rule('/insights/insightindexhistory', 'get_insights_history_by_index', self.get_insights_history_by_index, methods=['POST'])
        self.app.add_url_rule('/insights/fetchappid', 'fetch_app_id', self.fetch_app_id, methods=['POST'])
        self.app.add_url_rule('/getMCPStatistics', 'get_mcp_statistics', self.get_mcp_statistics, methods=['GET'])
        
        self.app.add_url_rule('/insights/usecases','insight_suggestion', self.insight_suggestion, methods=['POST'])
        self.app.add_url_rule('/insights/trends_usecase','trends_usecase', self.trends_usecase, methods=['POST'])
        self.app.add_url_rule('/insights/call_agent/dynamicusecases', 'call_agent_insight_new_cases', self.call_agent_insight_new_cases, methods=['POST'])
        self.app.add_url_rule('/insights/dynamictrenduc', 'get_trends_usecase', self.get_trends_usecase, methods=['POST'])
        self.app.add_url_rule('/insights/fetchjiradata', 'fetch_unique_status_and_priority', self.fetch_unique_status_and_priority, methods=['POST'])
        self.app.add_url_rule('/insights/deleteusecases', 'delete_usecase', self.delete_usecase, methods=['POST'])
        self.app.add_url_rule('/limitcount', 'api_limit_count', self.api_limit_count, methods=['POST'])
        self.app.add_url_rule('/insights/checkindex', 'check_index', self.check_index, methods=['POST'])
        
        # Plugins Management Routes
        self.app.add_url_rule('/getAllPlugins', 'getallplugins', self.getallplugins, methods=['GET'])
        self.app.add_url_rule('/getPluginById/<plugin_id>', 'get_plugin_by_id', self.get_plugin_by_id, methods=['GET'])  
        # self.app.add_url_rule('/addPlugin', 'add_plugin', self.add_plugin, methods=['POST'])
        self.app.add_url_rule('/updatePlugin', 'update_plugin', self.update_plugin, methods=['PUT'])
        self.app.add_url_rule('/deletePlugin/<plugin_id>', 'delete_plugin', self.delete_plugin, methods=['DELETE'])

        #Lyzr APIs
        self.app.add_url_rule('/lyzr/getTools', 'lyzr_get_tools', self.lyzr_get_tools, methods=['GET'])
        self.app.add_url_rule('/lyzr/createTools', 'lyzr_create_tools', self.lyzr_create_tools, methods=['POST'])
        self.app.add_url_rule('/lyzr/getProvidersModel', 'lyzr_get_providers_model', self.lyzr_get_providers_model, methods=['GET'])
        self.app.add_url_rule('/lyzr/getProviderMemory', 'lyzr_get_provider_memory', self.lyzr_get_provider_memory, methods=['GET'])
        self.app.add_url_rule('/lyzr/getKnowledgeBase', 'lyzr_get_knowledge_base', self.lyzr_get_knowledge_base, methods=['GET'])
        self.app.add_url_rule('/lyzr/createAgent', 'lyzr_create_agent', self.lyzr_create_agent, methods=['POST'])
        self.app.add_url_rule('/lyzr/getMCPServers', 'lyzr_get_mcp_servers', self.lyzr_get_mcp_servers, methods=['GET'])
        self.app.add_url_rule('/lyzr/createMCPServer', 'lyzr_create_mcp_server', self.lyzr_create_mcp_server, methods=['POST'])
        self.app.add_url_rule('/lyzr/generatewithAI', 'lyzr_generate_with_ai', self.lyzr_generate_with_ai, methods=['POST'])
        self.app.add_url_rule('/lyzr/getContext', 'lyzr_get_context', self.lyzr_get_context, methods=['GET'])
        self.app.add_url_rule('/lyzr/createContext', 'lyzr_create_context', self.lyzr_create_context, methods=['POST'])
        self.app.add_url_rule('/lyzr/deleteAgent', 'lyzr_delete_agent', self.lyzr_delete_agent, methods=['POST'])
        self.app.add_url_rule('/lyzr/getSemanticData', 'lyzr_get_semantic_data', self.lyzr_get_semantic_data, methods=['GET'])
        self.app.add_url_rule('/approvalAPI/<agent_id>/<sourceform>/<status>', 'approval_api', self.approval_api, methods=['GET','POST'])
        self.app.add_url_rule('/approvalAPI/<agent_id>/<sourceform>/<status>/confirm', 'approval_confirm', self.approval_confirm, methods=['GET'])
        self.app.add_url_rule('/getApproversList', 'get_approvers_list', self.get_approvers_list, methods=['GET'])

        #Automation Library Routes
        self.app.add_url_rule('/automationLibrary', 'get_automation_library', self.get_automation_library, methods=['GET'])
        self.app.add_url_rule('/automationLibrary/<library_id>', 'get_automation_library_by_id', self.get_automation_library_by_id, methods=['GET'])
        self.app.add_url_rule('/AddAutomationLibrary', 'add_automation_library', self.add_automation_library, methods=['POST'])
        self.app.add_url_rule('/GetAutomationScriptTypes', 'get_automation_script_types', self.get_automation_script_types, methods=['GET'])
        self.app.add_url_rule('/UpdateAutomationLibrary', 'update_automation_library', self.update_automation_library, methods=['POST'])
        self.app.add_url_rule('/DeleteAutomationLibrary/<library_id>', 'delete_automation_library', self.delete_automation_library, methods=['DELETE'])
        
        # Prompt Repository
        self.app.add_url_rule('/GetAgencyWithAgentsEnhanced', 'get_agency_with_agents_enhanced', self.get_agency_with_agents_enhanced, methods=['GET'])
        self.app.add_url_rule('/SavePrompt', 'save_prompt', self.save_prompt, methods=['POST'])
        self.app.add_url_rule('/UpdatePrompt', 'update_prompt', self.update_prompt, methods=['POST'])
        self.app.add_url_rule('/BatchUpdate', 'batch_update_prompts', self.batch_update_prompts, methods=['POST'])
        self.app.add_url_rule('/DeletePrompt', 'delete_prompt', self.delete_prompt, methods=['POST'])
        self.app.add_url_rule('/recoverDuplicateTitle', 'deduplicate_prompt_titles', self.deduplicate_prompt_titles, methods=['POST'])

        # Agent Evaluation (Offline)
        self.app.add_url_rule('/agent-evaluation', 'agent_evaluation', self.agent_evaluation_handler, methods=['POST'])
        self.app.add_url_rule('/agent-evaluation/fetch', 'fetch_agent_evaluation', self.fetch_agent_evaluation_handler, methods=['GET'])


        #version history endpoints
        self.app.add_url_rule('/fetchAgentVersionHistory', 'fetch_agent_version_history', self.fetch_agent_version_history, methods=['POST'])
        self.app.add_url_rule('/fetchAgentVersionDetails', 'fetch_agent_version_details', self.fetch_agent_version_details, methods=['POST'])

        #Tool Management Routes
        self.app.add_url_rule('/tools', 'get_all_tools', self.get_all_tools, methods=['GET'])
        self.app.add_url_rule('/tools/<tool_id>', 'get_tool_by_id', self.get_tool_by_id, methods=['GET'])
        self.app.add_url_rule('/saveconnection', 'save_connections_details', self.save_connections_details, methods=['POST'])
        self.app.add_url_rule('/fetchconnection', 'fetch_connections', self.fetch_connections, methods=['POST'])
        self.app.add_url_rule('/getconnectiondata/<connection_id>', 'get_connection_data_by_id', self.get_connection_data_by_id, methods=['GET'])
        self.app.add_url_rule('/toolauthentication', 'authenticate_tool', self.authenticate_tool, methods=['POST'])
        self.app.add_url_rule('/deleteconnection/<connection_id>', 'delete_connection', self.delete_connection, methods=['DELETE'])
        self.app.add_url_rule('/getCustomAction/<tool_id>', 'get_custom_action', self.get_custom_action, methods=['GET'])

        # Conversational chat history routes
        self.app.add_url_rule('/getSessionList', 'get_session_list', self.get_session_list, methods=['GET'])
        self.app.add_url_rule('/getSessionDetails/<session_id>', 'get_session_details', self.get_session_details, methods=['GET'])
        self.app.add_url_rule('/getRecentQuery/<agent_id>', 'get_recent_query', self.get_recent_query, methods=['GET'])

        # Notification Routes
        self.app.add_url_rule('/getNotificationsByUser/<email_id>', 'get_notifications', self.get_notifications, methods=['GET'])
        
        # External Application routes
        self.app.add_url_rule('/registerExternalApplication', 'register_external_application', self.register_external_application, methods=['POST'])
        self.app.add_url_rule('/getExternalApplications', 'get_external_applications', self.get_external_applications, methods=['GET'])
        self.app.add_url_rule('/getExternalApplication/<application_id>', 'get_external_application_by_id', self.get_external_application_by_id, methods=['GET'])
        self.app.add_url_rule('/deleteExternalApplication/<application_id>', 'delete_external_application', self.delete_external_application, methods=['POST'])
        self.app.add_url_rule('/updateExternalApplication/<application_id>','update_external_application',self.update_external_application,methods=['POST'])
        
        # Serve the raw openapi.json file for Postman Import
        self.app.add_url_rule('/openapi.json', 'serve_openapi_json', self.serve_openapi_json, methods=['GET'])
        # Serve the Swagger UI HTML
        self.app.add_url_rule('/docs', 'serve_swagger_ui', self.serve_swagger_ui, methods=['GET'])
        
        # External Application using API only
        self.app.add_url_rule('/GetAgentsForSubscriptionUser', 'get_agents_for_subscription_user', self.get_agents_for_subscription_user, methods=['GET', 'POST'])

        # ServiceNow Integration Routes
        self.app.add_url_rule('/executeservicenowaction', 'execute_servicenow_action', self.execute_servicenow_action, methods=['POST'])
        
        self.app.add_url_rule('/executeservicenowactiontest', 'execute_servicenow_action_test', self.execute_servicenow_action_test, methods=['POST'])

    # User Management Methods
    def do_login(self):
        try:
            user_details = self.utils.validate_json_request(request)
            response = self.user_manager.perform_login(user_details)
            
            if response.get("Success"):

                if response.get("IsOTP", False):
                    if config_loader.OTP_EXTERNAL_SERVICE:
                        self.user_manager.send_otp_details_external({
                            "UserId": user_details.get("EmployeeId", "CSS151837"),
                            "UserEmail": user_details.get("EmailId"),
                            "ClientName": self.configloader.CLIENT_NAME,
                            "otp": ""
                        })
                    else:
                        self.user_manager.send_otp_details_internal({ "EmailId": user_details.get("EmailId")})

                    return jsonify(response), 200

                tokens = session_manager.get_tokens({
                        "user_id": response.get("Email"),
                        "name": response.get("UserName"),
                        "role": response.get("Role"),
                        "ActiveProject": response.get("ActiveProject"),
                    })
                
                return jsonify({ **response, **tokens }), 200
                
            return jsonify({"Success": False, "Message": response.get('Message', 'Login error') }), 500
        except Exception as ex:
            self.utils.log_error("Error in DoLogin:")
            return jsonify({"Success": False, "Message": str(ex)}), 500
   
    @require_session
    def session_token(self):
        user = get_current_user()
        user_op = {
            'type': 'find_one',
            'filter': {
                "Email": user.get('user_id'),
                "IsActive": True,
                "IsDelete": False
            }     
        }
        user_data = self.user_manager._query_db('user', user_op, user_type='master')
                
        token = session_manager.get_session_token(user_data)
        return buildResponse("Session token generated successfully", { "session_token": token }, 201)

    @require_session
    def verify_token(self):
        user = get_current_user()

        user_op = {
                    'type': 'find_one',
                    'filter': {
                        "Email": user.get('user_id'),
                        "IsActive": True,
                        "IsDelete": False
                    }     
                }
        user_data = self.user_manager._query_db('user', user_op, user_type='master')

        if not user_data:
            raise AuthorizationError()

        role_ids = {user.get('role')}
        role_ids.update(
                [detail["role_name"] for detail in user_data.get("PrjDetails")]
            )
        user_data = {
            "user_id": user.get("user_id", None),
            "role_id": list(role_ids),
            "UserName": user.get("name", None),
            "active_subscription": user.get("ActiveProject", None),
            "profile_picture": user_data.get("Avatar", None),
        }
        

        return buildResponse("Token verified successfully", user_data, 200)

    def health_check(self):
        """Simple health check endpoint"""
        return jsonify({"status": "healthy", "message": "Service is running"}), 200

    def test_sensitive_encryption(self):
        """Test endpoint for encrypting/decrypting sensitive JSON fields."""
        payload = self.utils.validate_json_request(request)
        action = payload.get('action', '').strip().lower()
        data = payload.get('data')

        if action not in {'encrypt', 'decrypt'}:
            return buildResponse("Invalid action. Use 'encrypt' or 'decrypt'", {}, 400)
        if data is None:
            return buildResponse("Missing 'data' field in request body", {}, 400)

        try:
            result = process_sensitive_fields(data, action)
            return buildResponse("Sensitive fields processed", result, 200)
        except Exception as exc:
            return buildResponse("Failed to process sensitive fields", {"error": str(exc)}, 500)
    
    def get_recaptcha_config(self):
       
        config = self.user_manager.fetch_recaptcha_config()
        return buildResponse("Captcha config fetched", config, 200)
    
    def otp_details(self):
        usr = self.utils.validate_json_request(request)
        # otpSent = self.user_manager.send_otp_details(usr)
        if config_loader.OTP_EXTERNAL_SERVICE:
            response = self.user_manager.send_otp_details_external(usr)
        else:
            response = self.user_manager.send_otp_details_internal(usr)
        return buildResponse("OTP sent successfully", response, 200)

    def validate_otp(self):
        user_details = self.utils.validate_json_request(request)
        # result = self.user_manager.validate_otp_service(user_details)
        if config_loader.OTP_EXTERNAL_SERVICE:
            result = self.user_manager.validate_otp_service_external(user_details)                
        else:
            result = self.user_manager.validate_otp_service_internal(user_details)

        user = self.user_manager.get_user_by_email(user_details.get("EmailId"))
        details = self.user_manager.get_user_login_details(user)
        tokens = session_manager.get_tokens({
                    "user_id": details.get("Email"),
                    "name": details.get("UserName"),
                    "role": details.get("Role"),
                    "ActiveProject": details.get("ActiveProject"),
                })
        
        return buildResponse("OTP validated", { "Success": True, **tokens, **details }, 200)
    
    
    @require_session  
    def get_teams_by_project(self):
        payload = self.utils.validate_json_request(request)
        response = self.user_manager.perform_get_teams(payload)
        return buildResponse("Team details fetched successfully", response, 200)

    @require_session
    def get_roles_by_project_and_team(self):
        payload = self.utils.validate_json_request(request)
        response = self.user_manager.perform_get_roles(payload)
        return buildResponse("Details fetched successfully", response, 200)
        
    @require_session
    def get_mcp_statistics(self):
        stats = self.knowledgestore_manager.get_mcp_statistics()
        return buildResponse("MCP statistics fetched successfully", stats, 200)
     
    def _create_websocket_connection_events(self) -> list:
        """
        Create websocket connection events to display in traces.
        These represent WebSocket metrics capture lifecycle.
        """
        try:
            now = datetime.now(timezone.utc).isoformat()
            events = [
                {
                    "feature": "websocket_connections",
                    "timestamp": now,
                    "message": "WebSocket Connection Initiated",
                    "status": "active",
                    "body": json.dumps({
                        "connection_type": "metrics",
                        "endpoint": "wss://metrics.studio.lyzr.ai/ws",
                        "status": "connected"
                    }),
                    "event_type": "websocket"
                },
                {
                    "feature": "websocket_connections",
                    "timestamp": now,
                    "message": "WebSocket Metrics Collected",
                    "status": "active",
                    "body": json.dumps({
                        "metrics_collected": True,
                        "connection_type": "metrics",
                        "data_points": "performance metrics"
                    }),
                    "event_type": "websocket"
                },
                {
                    "feature": "websocket_connections",
                    "timestamp": now,
                    "message": "WebSocket Connection Closed",
                    "status": "completed",
                    "body": json.dumps({
                        "connection_type": "metrics",
                        "status": "disconnected",
                        "reason": "metrics_capture_complete"
                    }),
                    "event_type": "websocket"
                }
            ]
            return events
        except Exception as e:
            logger.error(f"Error creating websocket connection events: {str(e)}")
            return []

     
    @require_session
    def get_logs(self):
        try:
            # Validate basic requirements
            logs_dir = "logs"
            if not os.path.isdir(logs_dir):
                return self._handle_error("Logs folder missing")

            raw_project = request.args.get("project")
            if not raw_project:
                return self._handle_error("Missing project")

            projects = [p.strip() for p in raw_project.split(",") if p.strip()]
            if not projects:
                return self._handle_error("No valid project names")

            # Parse request parameters
            filters = self._parse_log_filters()
            is_streaming = request.args.get("stream") == "true"
            params = self._parse_log_params(is_streaming)
            user_timezone: str = filters["timezone"] or ""

            from_date = filters["from_date"]
            to_date = filters["to_date"]
            user_tz = pytz.timezone(user_timezone)

            start = None
            end = None

            if from_date:
                start = datetime.strptime(from_date, "%Y-%m-%d")
                end = start + timedelta(days=1)
                end = user_tz.localize(end)
                start = user_tz.localize(start)

            if end and to_date:
                end = user_tz.localize(
                    datetime.strptime(to_date, "%Y-%m-%d") + timedelta(days=1)
                )

            if start:
                start = start.astimezone(timezone.utc)
                if end:
                    end = end.astimezone(timezone.utc)

            # Get relevant files
            relevant_files = self._get_relevant_files(logs_dir, projects, start, end)

            if is_streaming:
                return self._handle_streaming_logs(
                    relevant_files, filters, params, raw_project, start, end
                )
            else:
                return self._handle_regular_logs(
                    relevant_files, filters, params, raw_project, start, end
                )

        except Exception as e:
            import traceback

            if request.args.get("stream") == "true":

                def generate_error(e):
                    error_data = {
                        "type": "error",
                        "message": str(e),
                        "trace": traceback.format_exc(),
                    }
                    yield f"data: {json.dumps(error_data)}\n\n"

                return Response(
                    stream_with_context(generate_error(e)), mimetype="text/event-stream"
                )
            else:
                raise ValidationError("Server error",{
                        "details": str(e),
                        "trace": traceback.format_exc()}
                )

    def _handle_error(self, message):
        """Handle errors for both streaming and regular responses"""
        if request.args.get("stream") == "true":

            def generate_error():
                yield f"data: {json.dumps({'type': 'error', 'message': message})}\n\n"

            return Response(
                stream_with_context(generate_error()), mimetype="text/event-stream"
            )
        else:
            raise ValidationError(message)

    def _parse_log_filters(self):
        """Parse filter parameters from request"""
        return {
            "timezone": request.args.get("timezone"),
            "from_date": request.args.get("from_date"),
            "to_date": request.args.get("to_date"),
            "type": request.args.get("type"),
            "timestamp": request.args.get("timestamp"),
            "status": request.args.get("status"),
            "user": request.args.get("user"),
        }

    def _parse_log_params(self, is_streaming):
        """Parse parameters based on streaming mode"""
        if is_streaming:
            return {
                'batch_size': int(request.args.get('batch_size', 20)),
                'delay': float(request.args.get('delay', 0.05)),
                'max_logs': int(request.args.get('max_logs', 10000))
            }
        else:
            page = int(request.args.get('page', 1))
            per_page = min(int(request.args.get('per_page', 50)), 200)
            return {
                'page': page,
                'per_page': per_page,
                'offset': (page - 1) * per_page,
                'truncate_messages': request.args.get('truncate', 'true').lower() == 'true',
                'max_message_length': int(request.args.get('max_length', 200))
            }
        
    def _in_range(self, ts, start, end):
        if start and ts < start:
            return False
        if end and ts >= end:
            return False
        return True

    def _get_relevant_files(self, logs_dir, projects, start, end):
        """Filter log files by project and date"""
        relevant_files = []
        for filename in os.listdir(logs_dir):
            filepath = os.path.join(logs_dir, filename)
            if not os.path.isfile(filepath) or not filename.endswith('.log'):
                continue

            project_name, log_date = self._extract_file_info(filename, projects)
            if not project_name:
                continue

            if start and log_date != 'unknown':
               file_start = datetime.strptime(log_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
               file_end = file_start + timedelta(days=1)

               if not (self._in_range(file_start, start, end) or self._in_range(file_end, start, end)):
                  continue

                
            relevant_files.append((filepath, project_name, log_date))
        return relevant_files


    def _extract_file_info(self, filename, projects):
        """Extract project name and date from filename"""
        match = re.match(r'^(.+?)[_.-]((\d{4}-\d{2}-\d{2})|(\d{6}))\.log$', filename)
        if not match:
            clean_name = filename.replace('.log', '')
            if not any(p.lower() in clean_name.lower() for p in projects):
                return None, None
            project_name = clean_name.replace('.', ' ').replace('_', ' ').replace('-', ' ').strip()
            return project_name, 'unknown'
        
        raw_proj = match.group(1)
        date_part = match.group(2)
        project_name = raw_proj.replace('.', ' ').replace('_', ' ').replace('-', ' ').strip()
        
        if not any(p.lower() in project_name.lower() for p in projects):
            return None, None

        try:
            if len(date_part) == 6:
                parsed = datetime.strptime(date_part, '%y%m%d')
            else:
                parsed = datetime.strptime(date_part, '%Y-%m-%d')
            log_date = parsed.strftime('%Y-%m-%d')
        except:
            log_date = 'unknown'
            
        return project_name, log_date

    def _parse_log_line(self, line: str):
        """Parse a single log line and extract components"""
        parts = line.split(" | ", 2)
        if len(parts) != 3:
            return None
 
        ts, typ = parts[0].strip(), parts[1].strip()
        size = 2
        if line.find("type=request"):
            size = 11
        elif line.find("type=response"):
            size = 7
        elif line.find("type=event"):
            size = 7

 
        result = {}
        for part in parts[2].strip().split(" | ", size):
            if "=" not in part:
                continue
            key, value = part.split("=", 1)
            result[key] = value
 
        return {"timestamp": ts, "type": typ, **result}

    def _apply_filters(self, log_entry, filters, start, end):
        """Apply filters to a log entry"""       
        if start and end and log_entry['timestamp']:
            try:
                # Try standard log format first
                ts = datetime.strptime(log_entry['timestamp'], "%Y-%m-%d %H:%M:%S,%f").replace(tzinfo=timezone.utc)
            except ValueError:
                try:
                    # Try ISO format with timezone
                    ts = datetime.fromisoformat(log_entry['timestamp'].replace('Z', '+00:00'))
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                except ValueError:
                    # If parsing fails, skip the filter
                    return True
            if not (start <= ts < end):
               return False
        
        if filters['type'] and filters['type'].lower() != log_entry['type'].lower():
            return False
        if filters['status'] and filters['status'] != log_entry['status']:
            return False
        if filters['timestamp'] and not log_entry['timestamp'].startswith(filters['timestamp']):
            return False
        if filters['user'] and filters['user'].lower() != log_entry['user'].lower():
            return False
        return True

    # def _handle_streaming_logs(self, relevant_files, filters, params, raw_project):
        # """Handle streaming log response"""
        # def generate():
            # processed_count = 0
            # files_processed = 0
            # all_entries = []
            
            # try:
                # # Send initial metadata
                # start_msg = {'type': 'start', 'message': 'Starting log stream...', 'filters': {**filters, 'project': raw_project}}
                # yield f"data: {json.dumps(start_msg)}\n\n"
                
                # files_msg = {'type': 'progress', 'message': f'Found {len(relevant_files)} relevant log files', 'files_count': len(relevant_files)}
                # yield f"data: {json.dumps(files_msg)}\n\n"

                # for filepath, project_name, log_date in relevant_files:
                    # files_processed += 1
                    
                    # progress_msg = {
                        # 'type': 'progress',
                        # 'message': f'Processing file {files_processed}/{len(relevant_files)}: {os.path.basename(filepath)}',
                        # 'files_processed': files_processed,
                        # 'total_files': len(relevant_files)
                    # }
                    # yield f"data: {json.dumps(progress_msg)}\n\n"
                    
                    # content = self._safe_read(filepath)
                    # lines_processed = 0
                    
                    # for raw_line in content.splitlines():
                        # line = raw_line.rstrip()
                        # if not line:
                            # continue

                        # log_entry = self._parse_log_line(line)
                        # if not log_entry or not self._apply_filters(log_entry, filters):
                            # continue

                        # all_entries.append({
                            # **log_entry,
                            # "project": project_name,
                            # "log_date": log_date
                        # })

                        # if len(all_entries) >= params['batch_size']:
                            # batch = all_entries[:params['batch_size']]
                            # all_entries = all_entries[params['batch_size']:]
                            
                            # batch_msg = {'type': 'logs', 'data': batch, 'count': len(batch)}
                            # yield f"data: {json.dumps(batch_msg)}\n\n"
                            
                            # if params['delay'] > 0:
                                # time.sleep(params['delay'])
                            # processed_count += len(batch)
                            
                            # if processed_count >= params['max_logs']:
                                # warning_msg = {'type': 'warning', 'message': f'Reached maximum log limit of {params["max_logs"]}'}
                                # yield f"data: {json.dumps(warning_msg)}\n\n"
                                # break

                        # lines_processed += 1

                    # complete_msg = {'type': 'progress', 'message': f'Completed {os.path.basename(filepath)}: {lines_processed} lines processed'}
                    # yield f"data: {json.dumps(complete_msg)}\n\n"

                # if all_entries:
                    # remaining_msg = {'type': 'logs', 'data': all_entries, 'count': len(all_entries)}
                    # yield f"data: {json.dumps(remaining_msg)}\n\n"
                    # processed_count += len(all_entries)

                # end_msg = {'type': 'end', 'total': processed_count, 'files_processed': files_processed}
                # yield f"data: {json.dumps(end_msg)}\n\n"

            # except Exception as e:
                # import traceback
                # error_msg = {'type': 'error', 'message': str(e), 'trace': traceback.format_exc()}
                # yield f"data: {json.dumps(error_msg)}\n\n"

        # return Response(
            # stream_with_context(generate()),
            # mimetype='text/event-stream',
            # headers={
                # 'Cache-Control': 'no-cache',
                # 'Connection': 'keep-alive',
                # 'Access-Control-Allow-Origin': '*',
                # 'Access-Control-Allow-Headers': 'Cache-Control',
                # 'X-Accel-Buffering': 'no'
            # }
        # )
        
    def _handle_streaming_logs(self, relevant_files, filters, params, raw_project, start, end):
        """Handle streaming log response"""
        request_id = request.headers.get("X-Request-Id", "-")
        def generate():
            processed_count = 0
            files_processed = 0
            all_entries = []
            try:
                # Send initial metadata
                start_msg = {'type': 'start', 'message': 'Starting log stream...', 'filters': {**filters, 'project': raw_project}}
                log_data(request_id, "Starting log stream...", { 'filters': { **filters } })

                yield f"data: {json.dumps(start_msg)}\n\n"
                files_msg = {'type': 'progress', 'message': f'Found {len(relevant_files)} relevant log files', 'files_count': len(relevant_files)}
                log_data(request_id, f'Found {len(relevant_files)} relevant log files', { 'files_count': files_msg['files_count'] })
                yield f"data: {json.dumps(files_msg)}\n\n"
     
                for filepath, project_name, log_date in relevant_files:
                    files_processed += 1
                    progress_msg = {
                        'type': 'progress',
                        'message': f'Processing file {files_processed}/{len(relevant_files)}: {os.path.basename(filepath)}',
                        'files_processed': files_processed,
                        'total_files': len(relevant_files)
                    }
                    log_data(request_id, progress_msg['message'], progress_msg)
                    yield f"data: {json.dumps(progress_msg)}\n\n"
                    content = self._safe_read(filepath)
                    lines_processed = 0
                    # Read lines in reverse order to get newest logs first
                    for raw_line in reversed(content.splitlines()):
                        line = raw_line.rstrip()
                        if not line:
                            continue
     
                        log_entry = self._parse_log_line(line)
                        if not log_entry or not self._apply_filters(log_entry, filters, start, end):
                            continue
     
                        all_entries.append({
                            **log_entry,
                            "project": project_name,
                            "log_date": log_date
                        })
     
                        if len(all_entries) >= params['batch_size']:
                            # Sort by timestamp to ensure newest logs are first
                            all_entries.sort(key=lambda x: x["timestamp"], reverse=True)
                            batch = all_entries[:params['batch_size']]
                            all_entries = all_entries[params['batch_size']:]
                            batch_msg = {'type': 'logs', 'data': batch, 'count': len(batch)}
                            yield f"data: {json.dumps(batch_msg)}\n\n"
                            if params['delay'] > 0:
                                time.sleep(params['delay'])
                            processed_count += len(batch)
                            if processed_count >= params['max_logs']:
                                warning_msg = {'type': 'warning', 'message': f'Reached maximum log limit of {params["max_logs"]}'}
                                log_data(request_id,warning_msg['message'], {})
                                yield f"data: {json.dumps(warning_msg)}\n\n"
                                break
     
                        lines_processed += 1
     
                    complete_msg = {'type': 'progress', 'message': f'Completed {os.path.basename(filepath)}: {lines_processed} lines processed'}
                    log_data(request_id,complete_msg['message'], {})
                    yield f"data: {json.dumps(complete_msg)}\n\n"
     
                if all_entries:
                    # Sort the remaining entries by timestamp
                    all_entries.sort(key=lambda x: x["timestamp"], reverse=True)
                    remaining_msg = {'type': 'logs', 'data': all_entries, 'count': len(all_entries)}
                    log_data(request_id, "Remaining entries", { 'count': remaining_msg['count']})
                    yield f"data: {json.dumps(remaining_msg)}\n\n"
                    processed_count += len(all_entries)
     
                end_msg = {'type': 'end', 'total': processed_count, 'files_processed': files_processed}
                log_data(request_id, "stream ended", { 'total': end_msg['total'], 'files_processed': end_msg['files_processed'] })
                yield f"data: {json.dumps(end_msg)}\n\n"
     
            except Exception as e:
                import traceback
                error_msg = {'type': 'error', 'message': str(e), 'trace': traceback.format_exc()}
                log_data(request_id, error_msg["message"], { "trace": error_msg['trace'] }, 'error')
                yield f"data: {json.dumps(error_msg)}\n\n"
     
        return Response(
            stream_with_context(generate()),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Cache-Control',
                'X-Accel-Buffering': 'no'
            }
        )

    def _handle_regular_logs(self, relevant_files, filters, params, raw_project, start, end):
        """Handle regular (non-streaming) log response"""
        all_entries = []
        for filepath, project_name, log_date in relevant_files:
            content = self._safe_read(filepath)
            for raw_line in content.splitlines():
                line = raw_line.rstrip()
                if not line:
                    continue

                log_entry = self._parse_log_line(line)
                if not log_entry or not self._apply_filters(log_entry, filters, start, end):
                    continue

                display_message = log_entry['message']
                if params['truncate_messages'] and len(log_entry['message']) > params['max_message_length']:
                    display_message = log_entry['message'][:params['max_message_length']] + "... [truncated]"

                all_entries.append({
                    **log_entry,
                    "project": project_name,
                    "message": display_message,
                    "message_size": len(log_entry['message']) if params['truncate_messages'] else None
                })

        # Apply today filter if no other filters
        today_str = datetime.now(timezone.utc).strftime('%Y-%m-%d')
        apply_today = not any(filters.values())
        if apply_today:
            all_entries = [e for e in all_entries if e["timestamp"].startswith(today_str)]

        all_entries.sort(key=lambda x: x["timestamp"], reverse=True)
        
        total = len(all_entries)
        paginated_entries = all_entries[params['offset']:params['offset'] + params['per_page']]
        effective_date = filters['date'] or ("today" if apply_today else None)

        return jsonify({
            "project": raw_project,
            "filters": {**filters, "date": effective_date},
            "pagination": {
                "page": params['page'],
                "per_page": params['per_page'],
                "total": total,
                "pages": (total + params['per_page'] - 1) // params['per_page']
            },
            "logs": paginated_entries
        })
 

    # def _safe_read(self, filepath: str) -> str:
        # encodings = ['utf-8', 'utf-8-sig', 'latin-1']
        # for enc in encodings:
            # try:
                # with open(filepath, 'r', encoding=enc) as f:
                    # return f.read()
            # except UnicodeDecodeError:
                # continue
            # except Exception:
                # break
        # try:
            # with open(filepath, 'rb') as f:
                # return f.read().decode('utf-8', errors='replace')
        # except Exception:
            # return "[ERROR: Could not read file]"
            
    def _safe_read(self, filepath: str) -> str:
        encodings = ['utf-8', 'utf-8-sig', 'latin-1']
        for enc in encodings:
            try:
                with open(filepath, 'r', encoding=enc) as f:
                    return f.read()
            except UnicodeDecodeError:
                continue
            except Exception:
                break
        try:
            with open(filepath, 'rb') as f:
                return f.read().decode('utf-8', errors='replace')
        except Exception:
            return "[ERROR: Could not read file]"
            
    def _safe_stream_lines(self, filepath: str):
        """
        Safely opens a file with multiple encodings and yields one line at a time.
        This is a memory-efficient way to process large log files.
        """
        encodings = ['utf-8', 'utf-8-sig', 'latin-1']
        for enc in encodings:
            try:
                # 'errors="ignore"' will skip problematic characters, which is fine for log analysis
                with open(filepath, 'r', encoding=enc, errors='ignore') as f:
                    for line in f:
                        yield line
                return  # If we successfully read the file, exit the function
            except UnicodeDecodeError:
                continue  # Try the next encoding
            except Exception:
                break  # For other errors (e.g., file not found), stop trying
 
        # Final fallback: read as binary and decode with error replacement
        try:
            with open(filepath, 'rb') as f_binary:
                for line_bytes in f_binary:
                    yield line_bytes.decode('utf-8', errors='replace')
        except Exception:
            # If even this fails, we can't read the file. We simply yield nothing.
            pass
    
    @require_session
    def get_user_details(self):
        result = self.user_manager.get_user_details_service()
        return buildResponse("User details fetched", result, 200)
    
    def send_recovery_mail(self, email):
        user_data = self.user_collection.find_one({
            "Email": re.compile(f"^{re.escape(email.lower())}$", re.IGNORECASE),
            "IsActive": True,
            "IsDelete": False
        })
        
        if user_data is None:
            raise NotFoundError("User not found or Inactive.")
        
        password = self.password_manager.generate_password(10)
        full_name = f"{user_data.get('FirstName', '')} {user_data.get('LastName', '')}"
        
        result = self.user_manager.send_mail(email, full_name, password, "Recovery")
        
        if result:
            hashed_password = self.password_manager.generate_hash(password, user_data.get('Salt', ''))
            self.user_collection.update_one(
                {"Email": re.compile(f"^{re.escape(email)}$", re.IGNORECASE),
                    "IsActive": True,
                    "IsDelete": False},
                {"$set": {
                    "Password": hashed_password,
                    "UpdatedDate": self.utils.get_current_timestamp()
                }}
            )
            return buildResponse( "Welcome mail has been sent to your email.", None, 200)
        
        return buildResponse("Failed to send recovery email.", None, 200)

    def sent_mail_user_management(self, mail_id):
        self.user_manager.perform_sent_mail_user_management(mail_id)
        return buildResponse("Welcome mail has been sent to your email.", None, 200)

    @require_session
    def add_user(self):
        user_details = self.utils.validate_json_request(request)
        response = self.user_manager.perform_add_user(user_details)
        return buildResponse("User added successfully", response, 200)
    
    @require_session       
    def get_external_data(self):
        result = self.agent_manager.fetch_data(request)
        return buildResponse("Agent data updated successfully.", result, 200)
        
    @require_session    
    def get_project_teams_roles_route(self):
        data = self.utils.validate_json_request(request)  # or request.get_json()
        response = self.user_manager.get_project_teams_roles(data)
        return buildResponse(response.get("message") or "Details fetched", response, 200)
        
    @require_session
    def perform_get_teams(self, payload):
            try:
                project_name = payload.get("projectName", "").strip()
                if not project_name:
                    return {"Success": False, "Message": "projectName is required"}

                project_doc = self.project.find_one(
                    {"projectName": project_name},
                    {"_id": 0, "teams": 1}
                )
                if not project_doc or not project_doc.get("teams"):
                    return {"Success": False, "Message": f"No teams found for project: {project_name}"}

                teams_response = [
                    {
                        "teamName": t.get("teamName"),
                        "roles": [r.get("role") for r in t.get("roles", [])]
                    } for t in project_doc.get("teams", [])
                ]

                return {"Success": True, "ProjectName": project_name, "Teams": teams_response}

            except Exception as ex:
                logging.error("Error in perform_get_teams: %s", ex, exc_info=True)
                return {"Success": False, "Message": str(ex)}
                
    # @require_session           
    # def import_workflow_old(self):
    #     data = request.json
    #     api_key = data.get('api_key')
    #     workflow_id = data.get('workflow_id')

    #     if not api_key:
    #         raise ValidationError("Missing api_key")
        
    #     if not workflow_id:
    #         raise ValidationError("Missing workflow_id")

    #     lyzr_url = f"https://agent-prod.studio.lyzr.ai/v3/workflows/{workflow_id}"
    #     headers = {'accept': 'application/json', 'x-api-key': api_key}

    #     response = requests.get(lyzr_url, headers=headers)

    #     if response.status_code != 200:
    #        raise ValidationError("Failed to fetch data from Lyzr", { "details": response.text, "status_code": response.status_code })

    #     data_response = response.json()
        
       
    #     # Remove node_positions (your original logic)
    #     if ('flow_data' in data_response and
    #             isinstance(data_response['flow_data'], dict) and
    #             'node_positions' in data_response['flow_data']):
    #         del data_response['flow_data']['node_positions']
            
    #     # --- Build Sequential Edges ---
    #     tasks = data_response.get('flow_data', {}).get('tasks', [])
    #     print("tasks",tasks)
        
    #     for task in tasks:
    #         if task['function'] == "call_lyzr_agent":
    #             api_agent_id = task['params']['config']['agent_id']
    #             task['params']['config']['api_agent_id'] = api_agent_id
 
    #     print("tttaaaa",tasks)      
    #     edges = []
        
    #     # for i in range(len(tasks) - 1):
    #         # source = tasks[i]['name']
    #         # target = tasks[i + 1]['name']
    #         # edge_id = f"{source}->{target}"

    #         # edges.append({
    #             # "id": edge_id,
    #             # "source": source,
    #             # "target": target,
    #             # "type": "template"
    #         # })
            
    #     edges = self.generate_edges(tasks)        
        

    #     # Attach edges to top level
    #     data_response['edges'] = edges
    #     data_response['flow_description'] = "Lyzr workflow"
    #     data_response['IsExternal'] = True
      
    #     # Store in MongoDB
    #     existing=self.workflow_collection.find_one({"flow_id":workflow_id},{"_id":0})
    #     if not existing:
    #         self.workflow_collection.insert_one(data_response)
    #         return buildResponse("Workflow imported Successful", {
    #             "edges_count": len(edges),
    #             "total_tasks": len(tasks)
    #             }, 201)
        

    #     raise ValidationError("Workflow already exists")

    # def generate_edges(self, tasks):
    #     edges = []
    #     edge_ids = set()  # Track to avoid duplicates
        
    #     # Helper to safely add edge
    #     def add_edge(source, target, edge_type="template", condition=None):
    #         edge_id = f"{source}->{target}"
    #         if edge_id in edge_ids:
    #             return
            
    #         edge = {
    #             "id": edge_id,
    #             "source": source,
    #             "target": target,
    #             "type": edge_type
    #         }
    #         if condition:
    #             edge["condition"] = condition
            
    #         edges.append(edge)
    #         edge_ids.add(edge_id)
        
    #     # Pass 1: Handle conditional branching
    #     for task in tasks:
    #         if task.get("tag") == "Conditional" or "true" in task.get("params", {}):
    #             params = task["params"]
    #             source = task["name"]
                
    #             # True branch
    #             if params.get("true"):
    #                 add_edge(source, params["true"], condition="true")
                
    #             # False branch
    #             if params.get("false"):
    #                 add_edge(source, params["false"], condition="false")
        
    #     # Pass 2: Handle explicit dependencies (scan all params for 'depends' structures)
    #     for task in tasks:
    #         target = task["name"]
    #         params = task.get("params", {})
            
    #         # Check all params for dependency declarations
    #         for key, value in params.items():
    #             # Handle pattern: "agent_name": { "depends": "agent_name" }
    #             if isinstance(value, dict) and "depends" in value:
    #                 source = value["depends"]
    #                 add_edge(source, target)
                
    #             # Handle pattern: direct dependency in params (less common)
    #             elif key == "depends" and isinstance(value, str):
    #                 add_edge(value, target)
        
    #     # Pass 3: Infer sequential flow for tasks without explicit dependencies
    #     # (Only connect consecutive tasks if NO other edges exist for the source)
    #     for i in range(len(tasks) - 1):
    #         source = tasks[i]["name"]
    #         target = tasks[i + 1]["name"]
            
    #         # Only add if source has no outgoing edges yet AND target has no incoming edges yet
    #         has_outgoing = any(edge["source"] == source for edge in edges)
    #         has_incoming = any(edge["target"] == target for edge in edges)
            
    #         if not has_outgoing and not has_incoming:
    #             add_edge(source, target)
    
    #     return edges

    def clean_and_validate_edges(self, raw_edges: List[Dict], task_names: Set[str]) -> List[Dict]:
        """
        Clean edges: remove invalid targets, circular deps, duplicates.
        Preserves parallel conditional branches (same source+condition, different targets).
        """
        cleaned = []
        seen = set()  # Track (source, target, condition) tuples
        
        for edge in raw_edges:
            if not isinstance(edge, dict):
                continue
                
            source = edge.get("source")
            target = edge.get("target")
            condition = edge.get("condition")
            
            # Skip invalid references or self-loops
            if not source or not target or source == target:
                continue
            if source not in task_names or target not in task_names:
                continue
                
            # Block dangerous circular dependency
            if source == "agent_testcase_g" and target == "agent_user_story":
                continue
                
            # Skip duplicates using composite key
            edge_key = (source, target, condition)
            if edge_key in seen:
                continue
            seen.add(edge_key)
            
            # Standardize edge structure
            cleaned_edge = {
                "id": f"{source}->{target}" + (f"|{condition}" if condition else ""),
                "source": source,
                "target": target,
                "type": edge.get("type", "template")
            }
            if condition:
                cleaned_edge["condition"] = condition
            
            cleaned.append(cleaned_edge)
        
        return cleaned

    def generate_dependency_edges(self, tasks: List[Dict]) -> List[Dict]:
        """
        Generate edges from dependency declarations in task parameters.
        Handles pattern: "any_param": { "depends": "source_task" }
        """
        edges = []
        edge_ids = set()
        task_names = {t["name"] for t in tasks}
        
        def add_edge(source: str, target: str, edge_type: str = "template"):
            if source not in task_names or target not in task_names or source == target:
                return
                
            edge_id = f"{source}->{target}"
            if edge_id in edge_ids:
                return
                
            edge = {
                "id": edge_id,
                "source": source,
                "target": target,
                "type": edge_type
            }
            edges.append(edge)
            edge_ids.add(edge_id)
        
        # Scan ALL tasks for dependency declarations
        for task in tasks:
            target = task["name"]
            params = task.get("params", {})
            
            for key, value in params.items():
                # Pattern: ANY_PARAM: { "depends": "source" }
                if isinstance(value, dict) and "depends" in value:
                    source = value["depends"]
                    if source in task_names and source != target:
                        add_edge(source, target)
        
        return edges

    def generate_conditional_edges(self, tasks: List[Dict]) -> List[Dict]:
        """
        Generate edges from conditional branching logic.
        Handles both string and array values for 'true'/'false' branches.
        Uses the canonical config.true_cond_ids / config.false_cond_ids fields
        after your transformation step — avoids scanning all params keys for 'depends'.
        """
        edges = []
        edge_ids = set()
        task_names = {t["name"] for t in tasks}
        
        def add_edge(source: str, target: str, edge_type: str = "template", condition: str = None):
            if source not in task_names or target not in task_names or source == target:
                return
                
            edge_id = f"{source}->{target}" + (f"|{condition}" if condition else "")
            if edge_id in edge_ids:
                return
                
            edge = {
                "id": edge_id,
                "source": source,
                "target": target,
                "type": edge_type
            }
            if condition:
                edge["condition"] = condition
                
            edges.append(edge)
            edge_ids.add(edge_id)
        
        # Process conditional tasks
        for task in tasks:
            if task.get("tag") == "Conditional":
                source = task["name"]
                params = task.get("params", {})
                config = params.get("config", {})
                
                # ── Preferred: use the transformed config fields ──
                # (you already move true/false → config.true_cond_ids / false_cond_ids)
                
                # True branch
                true_vals = config.get("true_cond_ids", [])
                if isinstance(true_vals, str):
                    true_vals = [true_vals]
                true_targets = [
                    t for t in true_vals
                    if isinstance(t, str) and t in task_names and t != source
                ]
                
                for target in true_targets:
                    add_edge(source, target, condition="true")
                
                # False branch
                false_vals = config.get("false_cond_ids", [])
                if isinstance(false_vals, str):
                    false_vals = [false_vals]
                false_targets = [
                    t for t in false_vals
                    if isinstance(t, str) and t in task_names and t != source
                ]
                
                for target in false_targets:
                    add_edge(source, target, condition="false")
                
                # ── Optional fallback for very old workflows (only if config is empty) ──
                # You can remove/comment this block if you're sure transformation always happens
                if not true_targets and not false_targets:
                    # Legacy direct "true" / "false" keys (before transformation)
                    true_val = params.get("true")
                    if true_val:
                        true_targets = [true_val] if isinstance(true_val, str) else true_val
                        true_targets = [
                            t for t in true_targets
                            if isinstance(t, str) and t in task_names and t != source
                        ]
                        for target in true_targets:
                            add_edge(source, target, condition="true")
                    
                    false_val = params.get("false")
                    if false_val:
                        false_targets = [false_val] if isinstance(false_val, str) else false_val
                        false_targets = [
                            t for t in false_targets
                            if isinstance(t, str) and t in task_names and t != source
                        ]
                        for target in false_targets:
                            add_edge(source, target, condition="false")
        
        return edges

    @require_session
    def import_workflow(self):
        data = request.json
        api_key = data.get('api_key')
        workflow_id = data.get('workflow_id')
        isRefresh = data.get('isRefresh','')
        agency_name = data.get('agency_name','')
        print("agency_name",agency_name)
        print("isRefresh",isRefresh)

        if not api_key:
            raise ValidationError("Missing api_key")
        if not workflow_id:
            raise ValidationError("Missing workflow_id")

        # CRITICAL FIX: Removed extra spaces in URL (was causing 404s)
        lyzr_url = f"https://agent-prod.studio.lyzr.ai/v3/workflows/{workflow_id}"  # CORRECTED: No spaces
        headers = {'accept': 'application/json', 'x-api-key': api_key}

        response = requests.get(lyzr_url, headers=headers)
        if response.status_code != 200:
            raise ValidationError("Failed to fetch data from Lyzr", {
                "details": response.text,
                "status_code": response.status_code
            })

        data_response = response.json()
        
        # Clean node_positions
        if ('flow_data' in data_response and 
            isinstance(data_response['flow_data'], dict) and 
            'node_positions' in data_response['flow_data']):
            del data_response['flow_data']['node_positions']
        
        tasks = data_response.get('flow_data', {}).get('tasks', [])
        task_names = {t['name'] for t in tasks}
        
        # ======================
        # TRANSFORM CONDITIONAL NODES
        # ======================
        for task in tasks:
            if task.get('tag') == 'Conditional' and isinstance(task.get('params'), dict):
                params = task['params']
                if 'true' in params or 'false' in params:
                    if 'config' not in params:
                        params['config'] = {}
                    if 'true' in params:
                        true_val = params.pop('true')
                        if true_val:
                            params['config']['true_cond_ids'] = (
                                true_val if isinstance(true_val, list) else [true_val]
                            )
                    if 'false' in params:
                        false_val = params.pop('false')
                        if false_val:
                            params['config']['false_cond_ids'] = (
                                false_val if isinstance(false_val, list) else [false_val]
                            )
        
        # ======================
        # FIX API AGENT ID MAPPING
        # ======================
        for task in tasks:
            if task['function'] == "call_lyzr_agent":
                cfg = task['params'].get('config', {})
                task['params']['config']['api_agent_id'] = cfg.get('agent_id', '')
        
        # ======================
        # HYBRID EDGE GENERATION
        # ======================
        studio_edges = []
        if 'flow_data' in data_response and 'edges' in data_response['flow_data']:
            studio_edges = data_response['flow_data']['edges']
            print(f"✅ Found {len(studio_edges)} visual edges from Lyzr Studio")
        elif 'edges' in data_response and isinstance(data_response['edges'], list):
            studio_edges = data_response['edges']
            print(f"⚠️  Using top-level edges as visual edges")
        
        dependency_edges = self.generate_dependency_edges(tasks)
        print(f"✅ Generated {len(dependency_edges)} dependency edges")
        
        conditional_edges = self.generate_conditional_edges(tasks)
        print(f"✅ Generated {len(conditional_edges)} conditional edges")
        
        all_edges = studio_edges + dependency_edges + conditional_edges
        edges = self.clean_and_validate_edges(all_edges, task_names)
        print(f"✅ Final edge count after cleaning: {len(edges)}")
        
        # ======================
        # SAFE STRUCTURAL VALIDATION (ALL ENVIRONMENTS)
        # ======================
        # NEVER blocks import – only logs warnings for debugging
        validation_warnings = []
        
        # Build edge index for validation
        incoming_edges = {}
        outgoing_edges = {}
        for e in edges:
            src, tgt = e['source'], e['target']
            outgoing_edges.setdefault(src, []).append(e)
            incoming_edges.setdefault(tgt, []).append(e)
        
        # 1. CRITICAL: Validate edge integrity (block import if broken)
        invalid_edges = []
        for e in edges:
            if e['source'] not in task_names:
                invalid_edges.append(f"Edge source '{e['source']}' not in tasks")
            if e['target'] not in task_names:
                invalid_edges.append(f"Edge target '{e['target']}' not in tasks")
        
        if invalid_edges:
            # This is a true data integrity failure – block import
            raise ValidationError(
                "Workflow contains edges referencing non-existent tasks",
                {
                    "invalid_edges": invalid_edges[:10],  # Limit payload size
                    "task_names": sorted(task_names),
                    "edge_count": len(edges)
                }
            )
        
        # 2. WARN: Conditional nodes missing configured branches (non-blocking)
        conditional_tasks = [t for t in tasks if t.get('tag') == 'Conditional']
        for task in conditional_tasks:
            task_name = task['name']
            outs = outgoing_edges.get(task_name, [])
            
            # Normalize condition values for comparison
            edge_conditions = {
                str(e.get('condition', '')).strip().lower() 
                for e in outs 
                if e.get('condition') not in (None, "")
            }
            
            cfg = task.get('params', {}).get('config', {})
            has_true_branch = bool(cfg.get('true_cond_ids'))
            has_false_branch = bool(cfg.get('false_cond_ids'))
            
            # Check if configured branches exist in edges
            if has_true_branch and 'true' not in edge_conditions:
                validation_warnings.append(
                    f"Conditional node '{task_name}' has true branch configured but no 'true' edge found"
                )
            if has_false_branch and 'false' not in edge_conditions:
                validation_warnings.append(
                    f"Conditional node '{task_name}' has false branch configured but no 'false' edge found"
                )
        
        # 3. WARN: Orphaned tasks (tasks with dependencies but no incoming edges)
        orphaned_tasks = []
        for task in tasks:
            task_name = task['name']
            deps = task.get('dependencies', [])
            
            # Skip start nodes (no dependencies)
            if not deps:
                continue
                
            # Skip if has incoming edges
            if task_name in incoming_edges:
                continue
                
            orphaned_tasks.append(task_name)
        
        if orphaned_tasks:
            validation_warnings.append(
                f"Tasks with dependencies but no incoming edges (may be unreachable): {orphaned_tasks[:5]}"
            )
        
        # 4. WARN: No start nodes detected
        start_nodes = [t['name'] for t in tasks if not t.get('dependencies')]
        if not start_nodes:
            validation_warnings.append("Workflow has no start node (tasks with empty dependencies)")
        
        # Log warnings for observability (never block import)
        if validation_warnings:
            env = current_app.config.get("ENV", "unknown")
            print(f"⚠️  WORKFLOW VALIDATION WARNINGS (env={env}, workflow_id={workflow_id}):")
            for i, warn in enumerate(validation_warnings, 1):
                print(f"  {i}. {warn}")
            print("💡 Note: Warnings do not block import – workflow structure comes from Lyzr Studio")
        
        # ======================
        # FINALIZE WORKFLOW
        # ======================
        data_response['edges'] = edges
        data_response['IsExternal'] = True
        
        # Remove duplicate edge definitions
        if 'flow_data' in data_response and 'edges' in data_response['flow_data']:
            del data_response['flow_data']['edges']
        
        # MongoDB storage
        if isRefresh is True:
            if agency_name:
                if self.workflow_collection.find_one({"flow_id": workflow_id}):
                    self.workflow_collection.update_one(
                        {"flow_id": workflow_id},
                        {"$set": data_response}
                    )
                    print("ddd",data_response)
                    response_data = {
                        "edges_count": len(edges),
                        "total_tasks": len(tasks),
                        "workflow_id": workflow_id,
                        "edge_sources": {
                            "studio": len(studio_edges),
                            "dependency": len(dependency_edges),
                            "conditional": len(conditional_edges)
                        },
                        "validation_warnings_count": len(validation_warnings)
                    }
                
                
                team =self.agency_collection.find_one({"agency_name" :agency_name,"is_deleted": False},{"_id":0,"assigned_to":1})
                seen_projects = set()
                if team and "assigned_to" in team:
                    cursor = self.project.find(
                        {"teams.teamName": team["assigned_to"], "active" : True},
                        {"_id": 0, "projectName": 1}
                    )
                    project_names = []
                    for proj in cursor:
                        pname = proj.get("projectName")
                        print("pnme",pname)
                        if pname and pname not in seen_projects:
                            project_names.append(pname)
                            seen_projects.add(pname)
                print("sss",seen_projects)           
                for seen_project in seen_projects:
                        user_type = self.project.find_one(
                            {"projectName": seen_project}, {"_id": 0, "database_name": 1})
                        
                        
                        if user_type:
                            print("flow_id2",workflow_id)
                            find_op = {'type': 'find_one', 'filter': {'flow_id': workflow_id}}
                            existing = self.chatbot_agent._query_db('workflow_collection', find_op,user_type= user_type.get("database_name"))
                            flow_name = data_response.get("flow_name", "Unnamed Workflow")
                            mapping_doc = {
                                "flow_name": flow_name,
                            }
                            existing_agency_mapping = self.chatbot_agent._query_db('workflow_agency_mapping_collection', find_op,user_type= user_type.get("database_name"))
                            if existing :
                                print("yes")
                                data_response.pop("_id", None)
                                update_op = {'type': 'update_one', 'filter' : {'flow_id': workflow_id}, 'update' : {'$set': data_response}}
                                self.chatbot_agent._query_db('workflow_collection', update_op,user_type= user_type.get("database_name"))
                         
                                
                            else:
                                    
                                insert_op= {'type': 'insert_one', 'document': data_response}
                                self.chatbot_agent._query_db('workflow_collection', insert_op,user_type= user_type.get("database_name"))

                            if existing_agency_mapping:
                                update_mapping_op = {'type': 'update_one', 'filter' : {'flow_id': workflow_id}, 'update' : {'$set': mapping_doc}}
                                self.chatbot_agent._query_db('workflow_agency_mapping_collection', update_mapping_op,user_type= user_type.get("database_name"))
                           
            
                return buildResponse("Workflow imported successfully", response_data, 200)
            
            else:
                if self.workflow_collection.find_one({"flow_id": workflow_id}):
                    self.workflow_collection.update_one(
                        {"flow_id": workflow_id},
                        {"$set": data_response}
                    )
                    print("ddd",data_response)
                    response_data = {
                        "edges_count": len(edges),
                        "total_tasks": len(tasks),
                        "workflow_id": workflow_id,
                        "edge_sources": {
                            "studio": len(studio_edges),
                            "dependency": len(dependency_edges),
                            "conditional": len(conditional_edges)
                        },
                        "validation_warnings_count": len(validation_warnings)
                    }
                    
                    return buildResponse("Workflow imported successfully", response_data, 200)
            
            
            
            
        else:
            print("hiiiii")
            data_response['flow_description'] = "Base workflow"
            if not self.workflow_collection.find_one({"flow_id": workflow_id}):
                self.workflow_collection.insert_one(data_response)
                response_data = {
                    "edges_count": len(edges),
                    "total_tasks": len(tasks),
                    "workflow_id": workflow_id,
                    "edge_sources": {
                        "studio": len(studio_edges),
                        "dependency": len(dependency_edges),
                        "conditional": len(conditional_edges)
                    },
                    "validation_warnings_count": len(validation_warnings)
                }
                
                return buildResponse("Workflow imported successfully", response_data, 200)
        
        raise ValidationError("Workflow already exists")
            

    @require_session
    def get_latest_completed(self, workflow_id, is_review=False):
        print("Fetching unique workflow_ids...")

        final_output = []

        if is_review == "false" or is_review == False:

            unique_workflow_ids = self.workflow_collection.distinct("flow_id")

            if not unique_workflow_ids:
                print("No workflow_ids found.")
                return buildResponse(
                    "Workflow status fetched", [], 200
                )  # Return empty array directly

            print(f"Found {len(unique_workflow_ids)} unique workflow_ids.")

            for wf_id in unique_workflow_ids:
                print(f"\n--- Processing workflow_id: '{wf_id}' ---")

                # Get latest completed event by timestamp
                latest_event = (
                    self.workflow_response_collection.find(
                        {"workflow_id": wf_id}, {"event_id": 1}
                    )
                    .sort("timestamp", DESCENDING)
                    .limit(1)
                )

                event = next(latest_event, None)
                if not event:
                    continue

                event_recent_id = event["event_id"]

                docs = list(
                    self.workflow_response_collection.find(
                        {"event_id": event_recent_id}
                    )
                )

                if not docs:
                    continue
                base = docs[0]

                real_time_logs = base.get("real_time_logs", {})
                trace_info = base.get("trace_info", {})
                user_query = base.get("user_query", {})  # === ADD USER QUERY FIELD ===

                if real_time_logs:
                    if isinstance(real_time_logs, dict):
                        pass
                    elif isinstance(real_time_logs, list):
                        logs_dict = {}
                        for log in real_time_logs:
                            if isinstance(log, dict):
                                agent_name = log.get("agent_name", "unknown")
                                if agent_name not in logs_dict:
                                    logs_dict[agent_name] = {
                                        "agent_id": log.get("agent_id", ""),
                                        "logs": [],
                                    }
                                logs_dict[agent_name]["logs"].append(log)
                        real_time_logs = logs_dict
                    else:
                        real_time_logs = {}

                # Build clean response object with trace and log data
                clean_doc = {
                    "_id": str(base["_id"]),
                    "workflow_id": base.get("workflow_id"),
                    "event_id": base.get("event_id"),
                    "dag_task_id": base.get("dag_task_id"),
                    "session_id": base.get("session_id"),
                    "user_id": base.get("user_id"),
                    "username": base.get("username"),
                    "response": {
                        "results": [
                            {
                                "key": doc.get("key"),
                                "description": doc.get("description"),
                                "response": doc.get("response"),
                            }
                            for doc in docs
                            if doc.get("response")
                        ]
                    },
                    "status": base.get("status", "completed"),
                    "timestamp": base.get("timestamp", ""),
                    "saved_at": base.get("saved_at"),
                    "real_time_logs": real_time_logs,
                    "trace_info": trace_info,
                    "user_query": user_query,  # === ADD USER QUERY FIELD ===
                }

                ts = clean_doc["timestamp"]
                if hasattr(ts, "isoformat"):
                    clean_doc["timestamp"] = ts.isoformat()
                elif isinstance(ts, str) and "GMT" in ts:
                    from email.utils import parsedate_to_datetime

                    clean_doc["timestamp"] = parsedate_to_datetime(ts).isoformat()

                saved_at = clean_doc.get("saved_at")
                if saved_at:
                    if hasattr(saved_at, "isoformat"):
                        clean_doc["saved_at"] = saved_at.isoformat()
                    elif isinstance(saved_at, str) and "GMT" in saved_at:
                        from email.utils import parsedate_to_datetime

                        clean_doc["saved_at"] = parsedate_to_datetime(
                            saved_at
                        ).isoformat()

                final_output.append(clean_doc)

        else:

            docs = list(self.workflow_response_collection.find({"workflow_id": workflow_id}).sort("timestamp", DESCENDING).limit(1))

            if not docs:
                return buildResponse("No workflow data found", [], 404)
                
            base = docs[0]

            real_time_logs = base.get("real_time_logs", {})
            trace_info = base.get("trace_info", {})
            user_query = base.get("user_query", {})  # === ADD USER QUERY FIELD ===

            if real_time_logs:
                if isinstance(real_time_logs, dict):
                    pass
                elif isinstance(real_time_logs, list):
                    logs_dict = {}
                    for log in real_time_logs:
                        if isinstance(log, dict):
                            agent_name = log.get("agent_name", "unknown")
                            if agent_name not in logs_dict:
                                logs_dict[agent_name] = {
                                    "agent_id": log.get("agent_id", ""),
                                    "logs": [],
                                }
                            logs_dict[agent_name]["logs"].append(log)
                    real_time_logs = logs_dict
                else:
                    real_time_logs = {}

            # Build clean response object with trace and log data
            clean_doc = {
                "_id": str(base["_id"]),
                "workflow_id": base.get("workflow_id"),
                "event_id": base.get("event_id"),
                "dag_task_id": base.get("dag_task_id"),
                "session_id": base.get("session_id"),
                "user_id": base.get("user_id"),
                "username": base.get("username"),
                "response": {
                    "results": [
                        {
                            "key": doc.get("key"),
                            "description": doc.get("description"),
                            "response": doc.get("response"),
                        }
                        for doc in docs
                        if doc.get("response")
                    ]
                },
                "status": base.get("status", "completed"),
                "timestamp": base.get("timestamp", ""),
                "saved_at": base.get("saved_at"),
                "real_time_logs": real_time_logs,
                "trace_info": trace_info,
                "user_query": user_query,  # === ADD USER QUERY FIELD ===
            }

            ts = clean_doc["timestamp"]
            if hasattr(ts, "isoformat"):
                clean_doc["timestamp"] = ts.isoformat()
            elif isinstance(ts, str) and "GMT" in ts:
                from email.utils import parsedate_to_datetime

                clean_doc["timestamp"] = parsedate_to_datetime(ts).isoformat()

            saved_at = clean_doc.get("saved_at")
            if saved_at:
                if hasattr(saved_at, "isoformat"):
                    clean_doc["saved_at"] = saved_at.isoformat()
                elif isinstance(saved_at, str) and "GMT" in saved_at:
                    from email.utils import parsedate_to_datetime

                    clean_doc["saved_at"] = parsedate_to_datetime(
                        saved_at
                    ).isoformat()

            final_output.append(clean_doc)

        return buildResponse("Workflow status fetched", final_output, 200)

   
 
    @require_session 
    def get_workflow_event_response(self):
        data = request.json
        event_id = data.get('event_id')
        cursor = self.workflow_response_collection.find(
            {"status": "completed", "event_id": event_id},
            {"key": 1, "event_id": 1, "status": 1, "timestamp": 1, "response": 1}  # Changed to get the entire response field
        )
    
        enriched_docs = []
        for doc in cursor:
            # Get the response string directly
            response_text = doc.get("response", "")
            
            enriched_doc = {
                "_id": doc["_id"],
                "event_id": doc["event_id"],
                "key": doc.get("key"),
                "status": doc["status"],
                "timestamp": doc["timestamp"],
                "response": response_text  # Return the response as a string
            }
            enriched_docs.append(enriched_doc)
        
        for d in enriched_docs:
            if "_id" in d:
                d["_id"] = str(d["_id"])
            if "timestamp" in d and isinstance(d["timestamp"], datetime):
                d["timestamp"] = d["timestamp"].isoformat()

        return buildResponse("Workflow event response fetched", enriched_docs or [], 200)

            
    # @require_session       
    # def get_all_mappings_old(self):
    #     # 1. Get workflow mappings
    #     mappings = list(self.workflow_agency_mapping_collection.find())
        
    #     # 2. Extract agency_ids and flow_ids
    #     agency_ids = [m['agency_id'] for m in mappings if 'agency_id' in m]
    #     flow_ids = [m['flow_id'] for m in mappings if 'flow_id' in m]

    #     # 3. Get agencies with $in query
    #     agencies = list(self.agency_collection.find({
    #         'agency_id': {'$in': agency_ids}
    #     })) if agency_ids else []

    #     # 4. Get workflows using flow_id
    #     workflows = list(self.workflow_collection.find({
    #         'flow_id': {'$in': flow_ids}
    #     })) if flow_ids else []

    #     # 5. Create lookup maps
    #     agency_map = {a['agency_id']: a for a in agencies}
    #     workflow_map = {w['flow_id']: w for w in workflows}

    #     # 6. Join data
    #     results = []
    #     for mapping in mappings:
    #         agency = agency_map.get(mapping.get('agency_id'), {})
    #         workflow = workflow_map.get(mapping.get('flow_id'), {})
            
    #         result = {
    #             **mapping,  # All mapping fields
    #             'confidence_perc': f"{80 + secrets.choice([2, 4, 8, 10, 14, 16, 18])}%",
    #             'assigned_to': agency.get('assigned_to', 'Unknown'),
    #             'confidence_status': 'In Progress',
    #             # Use workflow description instead of agency_desc
    #             'description': workflow.get('description', ''),
    #             'avatar': agency.get('avatar', ''),
    #             'run_status': 'completed'  # Default for workflows
    #         }
            
    #         # Convert ObjectId and dates
    #         result['_id'] = str(result['_id'])
    #         if 'created_ts' in result:
    #             result['created_ts'] = result['created_ts'].isoformat()
    #         if 'updated_ts' in result:
    #             result['updated_ts'] = result['updated_ts'].isoformat()
                
    #         results.append(result)
            
    #     return buildResponse("Workflow agency mapping fetched successfully", results, 200)

    def get_all_mappings(self):
        # 1. Get workflow mappings
        mappings = list(self.workflow_agency_mapping_collection.find())
        
        # 2. Extract agency_ids and flow_ids
        agency_ids = [m['agency_id'] for m in mappings if 'agency_id' in m]
        flow_ids = [m['flow_id'] for m in mappings if 'flow_id' in m]

        # 3. Get agencies with $in query
        agencies = list(self.agency_collection.find({
            'agency_id': {'$in': agency_ids}
        })) if agency_ids else []

        # 4. Get workflows using flow_id
        workflows = list(self.workflow_collection.find({
            'flow_id': {'$in': flow_ids}
        })) if flow_ids else []

        # 5. Create lookup maps
        agency_map = {a['agency_id']: a for a in agencies}
        workflow_map = {w['flow_id']: w for w in workflows}

        # ── Added: get latest execution timestamp per flow_id ──
        latest_updated = {}
        if flow_ids:
            pipeline = [
                {"$match": {"workflow_id": {"$in": flow_ids}, "status": "completed"}},
                {"$sort": {"saved_at": -1}},
                {"$group": {"_id": "$workflow_id", "ts": {"$first": "$saved_at"}}}
            ]
            for row in self.workflow_response_collection.aggregate(pipeline):
                ts = row["ts"]
                latest_updated[row["_id"]] = ts.isoformat() if hasattr(ts, 'isoformat') else str(ts)

        # 6. Join data
        results = []
        for mapping in mappings:
            agency = agency_map.get(mapping.get('agency_id'), {})
            workflow = workflow_map.get(mapping.get('flow_id'), {})
            
            flow_id = mapping.get('flow_id')
            
            # ── Added: override updated_ts with latest execution time (if exists) ──
            if flow_id in latest_updated:
                mapping['updated_ts'] = latest_updated[flow_id]
            
            result = {
                **mapping,  # All mapping fields (updated_ts may be overridden)
                'confidence_perc': f"{80 + secrets.choice([2, 4, 8, 10, 14, 16, 18])}%",
                'assigned_to': agency.get('assigned_to', 'Unknown'),
                'confidence_status': 'In Progress',
                'description': workflow.get('description', ''),
                'avatar': agency.get('avatar', ''),
                'run_status': 'completed'
            }
            
            # Convert ObjectId and dates
            result['_id'] = str(result['_id'])
            if 'created_ts' in result:
                result['created_ts'] = result['created_ts'].isoformat()
            if 'updated_ts' in result:
                # updated_ts is already string → no need to convert again
                pass
                    
            results.append(result)
            
        return buildResponse("Workflow agency mapping fetched successfully", results, 200)

    @require_session
    def perform_get_roles(self, payload):
        try:
            project_name = payload.get("projectName", "").strip()
            team_name = payload.get("teamName", "").strip()

            if not project_name or not team_name:
                return {"Success": False, "Message": "projectName and teamName are required"}

            project_doc = self.project.find_one({"projectName": project_name})
            if not project_doc or not project_doc.get("teams"):
                return {"Success": False, "Message": "Project not found or has no teams"}

            team_data = next(
                (t for t in project_doc.get("teams", []) if t.get("teamName") == team_name),
                None
            )
            if not team_data:
                return {"Success": False, "Message": "Team not found in this project"}

            roles = [r.get("role") for r in team_data.get("roles", [])]
            return {"Success": True, "Project": project_name, "Team": team_name, "Roles": roles}

        except Exception as ex:
            logging.error("Error in perform_get_roles: %s", ex, exc_info=True)
            return {"Success": False, "Message": str(ex)}
    
    @require_session
    def update_user(self):
        request_data = self.utils.validate_json_request(request)
        status,data = self.user_manager.update_user_service(request_data)
        return buildResponse("User details updated successfully",data, 200)
    
    @require_session
    def user_active_or_in_active(self):
        user_dtls = self.utils.validate_json_request(request)
        result = self.user_manager.user_active_or_inactive_service(user_dtls)
        return buildResponse(
                f"User {result.get('IsActive') if 'activated' else 'de-activated' } successfully",
                { "UserManagement": result["UserManagement"]},
                200)
    
    @require_session
    def delete_user_detail(self):
        user_dtls = self.utils.validate_json_request(request)
        result = self.user_manager.delete_user_details_service(user_dtls)
        return buildResponse('User deleted successfully', result, 200)
    
    # Role Management methods
    @require_session
    def create_role(self):
        role_id = self.role_manager.create_role(request)
        return buildResponse("Role created successfully", {"role_id": role_id}, 201)
    
    @require_session
    def get_all_roles(self):
        user_type = request.args.get("user_type")
        result = self.role_manager.get_all_roles(user_type)
        return buildResponse("Fetched all roles successfully", result, 200)

    def get_role_by_id(self, role_id):
        role = self.role_manager.get_role_by_id(role_id)
        return buildResponse("Role details fetched successfully", role, 200)
    
    @require_session
    def update_role(self, role_id):
        result = self.role_manager.update_role(role_id, request)
        return buildResponse("Role updated successfully", {"role_id": result}, 200)

    @require_session
    def delete_role(self, role_id):
        result = self.role_manager.delete_role(role_id)
        return buildResponse("Role deleted successfully", {"role_id": result}, 200)
    
    @require_session
    @daily_limit(limit_count=insight_limit)
    def get_active_roles(self):
        user_type = request.args.get("user_type")
        result = self.role_manager.get_active_roles(user_type)
        return buildResponse("Fetched Active Roles successfully", result, 200)

    @require_session
    def create_multiple_roles(self):
        created_roles = self.role_manager.create_multiple_roles(request)
        return buildResponse(
            f"{len(created_roles)} roles created successfully", {}, 201
        )
    
    # Team Management method
    @require_session
    def create_team(self):
        team_id = self.team_manager.create_team(request)
        return buildResponse("Team created successfully", {"team_id": team_id}, 201)

    @require_session
    def get_all_teams_manage(self):
        result = self.team_manager.get_all_teams_manage()
        return buildResponse("Fetched teams successfully", result, 200)

    @require_session
    def get_team_by_id(self, team_id):
        team = self.team_manager.get_team_by_id(team_id)
        return buildResponse("Team details fetched successfully", team, 200)

    @require_session
    def update_team(self, team_id):
        result = self.team_manager.update_team(team_id, request)
        return buildResponse("Team updated successfully", {"team_id": result}, 200)
 
    @require_session
    def delete_team(self, team_id):
        result = self.team_manager.delete_team(team_id)
        return buildResponse("Team deleted successfully", {"team_id": result}, 200)

    @require_session
    def get_active_teams(self):
        user_type = request.args.get("user_type")
        result = self.team_manager.get_active_teams(user_type)
        return buildResponse("Fetched active teams successfully", result, 200)
       
    @require_session
    def create_multiple_teams(self):
        created_teams = self.team_manager.create_multiple_teams(request)
        return buildResponse(
            f"{len(created_teams)} teams created successfully", created_teams, 200
        )
    
    @require_session
    def upload_image(self):
        result = self.user_manager.upload_image_helper()
        return buildResponse("Image processed for upload", result, 200)
    
    def check_password(self):
        self.user_manager.validate_password()
        print("validate_password-success")
        return buildResponse("Password validated successfully", None, 200)
    
    # Role Management Methods
    def get_roles(self):
         return list(self.role_collection.find({}, {"_id": 1, "RoleName": 1,"permissions":1}))

    @require_session
    def get_all_permissions(self):
        return list(self.role_permissions_collection.find({}, {"_id": 0}))

    @require_session
    def get_permissions(self):
        mappings = self.role_permissions_collection.find({}, {"_id": 0})
        data = list(mappings)
        return buildResponse("Permissions fetched successfully", data, 200)
    
    @require_session
    def get_permissions_for_role(self):
        new_perms = self.utils.validate_json_request(request)
        data = json.loads(json_util.dumps(self.role_permissions_collection.find_one({
            "ProjectId": new_perms.get("ProjectId"),
            "TeamId": new_perms.get("TeamId"),
            "RoleName": new_perms.get("RoleId")
        })))
        
        return buildResponse("Permissions fetched successfully", data, 200)
    
    @require_session
    def update_permissions(self):

        new_perms = self.utils.validate_json_request(request)

        # Define query filter with all 3 IDs
        filter_query = {
            "ProjectId": new_perms.get("ProjectId"),
            "TeamId": new_perms.get("TeamId"),
            "RoleName": new_perms.get("RoleId")
        }

        role_id = self.role_collection.find_one({"RoleName": new_perms.get("RoleId")}, {"_id": 1})
        if role_id:
            role_id=role_id.get("_id").get("$oid") if isinstance(role_id.get("_id"), dict) else str(role_id.get("_id"))
            print("Role found for RoleName:", new_perms.get("RoleId"))

        # Update or insert if not found
        result = self.role_permissions_collection.update_one(
            filter_query,
            {"$set": {"permissions": new_perms.get("permissions", []),
                      "ProjectId": new_perms.get("ProjectId"), 
                      "TeamId": new_perms.get("TeamId"), 
                      "RoleName": new_perms.get("RoleId"),
                      "RoleId": role_id,
                      "Created_Date": datetime.utcnow(),
                      "IsActive": True,
                      "Created_By":"Super Admin"
                      }},
            upsert=True
        )

        return buildResponse("Role permissions upserted", {
            "Matched": result.matched_count,
            "Modified": result.modified_count,
            "UpsertedId": str(result.upserted_id) if result.upserted_id else None
        }, 200)

    @require_session
    def update_role_permissions(self):
        new_perms = self.utils.validate_json_request(request)
        # result = self.role_collection.update_many({"_id": ObjectId(new_perms.get("role_id"))}, {"$set": {"permissions": new_perms.get("permissions")}})

        if self.role_permissions_collection.find_one({
            "ProjectId": new_perms.get("ProjectId"),
            "TeamId": new_perms.get("TeamId"),
            "RoleName": new_perms.get("RoleName")
        }):
            # Update existing permissions
            result = self.role_permissions_collection.update_one(
                {
                    "ProjectId": new_perms.get("ProjectId"),
                    "TeamId": new_perms.get("TeamId"),
                    "RoleName": new_perms.get("RoleName")
                },
                {"$set": {"permissions": new_perms.get("permissions")}}
            )
        else:
            # Insert new permissions
            result = self.role_permissions_collection.insert_one(new_perms)

        return buildResponse("Role permissions upserted", {
            "Modified": result.modified_count,
            "UpsertedId":new_perms.get("role_id","")
        }, 200)

    @require_session
    def get_page_configuration(self):
        config = list(self.page_configuration_collection.find({}, {"_id": 0}))
        return buildResponse("Page configuration fetched successfully", config, 200)
    
    @require_session
    def get_all_role_permissions(self):
        data = self.role_manager.get_all_role_permissions()
        return buildResponse("Role permissions fetched successfully", data, 200)

    
    # Insights Methods
    @require_session
    def get_insight_agents(self):
        insights = self.testcase_manager.get_insight_agent_details()
        return buildResponse("Insight details fetched successfully",  insights, 200)
    
    # Test Case Methods
    @require_session
    def run_workflow_endpoint(self):
        try:
            result = self.testcase_manager.run_workflow_endpoint_details(self.configloader.USER_STORY_FOLDER, request)
            if result is None:
                return jsonify({"success": False, "Message": "Workflow execution failed"}), 500
            return jsonify({"success": True, "Message": "Workflow executed successfully"}), 200
        except Exception as ex:
            self.utils.log_error("Error in Response:")
            return jsonify({"Success": False, "Message": str(ex)}), 500
    
    @require_session
    def get_event_workflow(self):
        try:
            result, status_result = self.testcase_manager.get_event_workflow_details(request)
            return jsonify({
                "Success": True,
                "Message": "Event workflow data fetched successfully",
                "data": result,
                "statusLoader": status_result
            }), 200
        except Exception as ex:
            self.utils.log_error("Error in GetEventResponse:")
            return jsonify({"Success": False, "Message": str(ex)}), 500
    
    @require_session
    def get_user_events(self):
        try:
            result = self.testcase_manager.get_user_events_details(request)
            return jsonify({
                "Success": True,
                "Message": "Events with latest current_ts and email fetched successfully",
                "data": result
            }), 200
        except Exception as ex:
            self.utils.log_error("Error in GetEventsWorkflow:")
            return jsonify({"Success": False, "Message": str(ex)}), 500
    
    @require_session
    def delete_agent(self, agent_id):
        self.agent_manager.delete_agent_details(agent_id)
        return buildResponse("Agent deleted successfully",None, 200)

    @require_session
    def delete_agent_with_approval(self):
        try:
            data = self.utils.validate_json_request(request)
            result = self.agent_manager.delete_agent_with_approval_details(data)
            return buildResponse("Agent deletion request processed successfully", result, 200)
        except Exception as ex:
            return buildResponse("Error occurred while processing agent deletion request", {"error": str(ex)}, 500)

    # Agent Management Methods
    @require_session
    def get_all_agents(self):
        agents = self.agent_manager.get_all_agent_details()
        return buildResponse("Agents fetched successfully", agents, 200)

    @require_session
    def get_agent_details_for_approval(self, agent_id):
        agent_details = self.agent_manager.get_agent_details_for_approval(agent_id)
        return buildResponse("Agent details fetched successfully", agent_details, 200)
        
    @require_session
    def get_all_voice_agents(self):
        agents = self.agent_manager.get_all_voice_agent_details()
        return buildResponse("Agents fetched successfully", agents, 200)
    
    @require_session
    def get_session_start_agent(self):
        return start_session()
        

    @require_session
    def get_session_end_agent(self):
        return end_session()
        # return buildResponse("Agents fetched successfully", agents, 200)

    @require_session
    def get_all_dropdowns(self):
        mcp_connector, ai_models, roles, agent_types, agent_providers,knowledge_store,ai_foundations = self.agent_manager.get_all_dropdown_details()
        return buildResponse("All dropdowns values fetched successfully",{
                "mcp_connectors": mcp_connector,
                "ai_models": ai_models,
                "roles": roles,
                "agent_types": agent_types,
                "agent_providers": agent_providers,
                "knowledge_store": knowledge_store,
                "ai_foundations": ai_foundations,
            }, 200)
    
    @require_session
    def fetch_and_insert_agent(self):
        self.agent_manager.insert_external_agent(request)
        return buildResponse( "Agent onboarded successfully", None, 200)
    
    @require_session
    def add_agent_details(self):
        self.agent_manager.onboard_agent_details(request)
        return buildResponse( "Agent details added successfully", None, 200)
    
    @require_session
    def add_update_external_new_agent(self):
        result = self.agent_manager.add_update_agent_details(request)
        return buildResponse("Agent details added/updated successfully", result, 200)

    @require_session
    def update_agent_details(self, agent_id):
        result = self.agent_manager.update_agent_manage_details(request, agent_id)
        message = "Agent Updated Successfully" if result else "Agent Updated Failed"
        return buildResponse(message, None, 200)
    
    # @require_session
    # def switch_project(self):
    #     try:
    #         result = self.user_manager.switch_projectname(request)
    #         message = "Project Switched  Successfully" if result else "Project Failed to Switch"
    #         return jsonify({"Success": result, "Message": message}), 200
    #     except Exception as ex:
    #         self.utils.log_error("Error in SwitchProject:")
    #         return jsonify({"Success": False, "Message": str(ex)}), 500
        
    

    @require_session
    def get_agent_counts(self):
        total, active, trending = self.agent_manager.get_agent_details_counts()
        return buildResponse("Agents counts fetched successfully", {
                "total_agents": total,
                "active_agents": active,
                "trending_agents": trending
        },200)
    
    @require_session
    def get_provider_details(self):
        result = self.agent_manager.get_provider_dtls(request)
        return jsonify("Provider details fetched successfully", result, 200)
    
    # Agency Management Methods
    @require_session
    def get_agency_with_agents(self):
        results = self.agency_manager.get_agency_with_agents_details()
        return buildResponse("Agency with agents details fetched successfully", results, 200)
    
    @require_session
    def get_agency_types(self):
        agency_types = self.agency_manager.get_agency_types_details()
        return buildResponse("Agency types fetched successfully", agency_types, 200)
    
    @require_session
    def onboard_and_update_agency_with_agents(self):
        is_update, agency_id, type_counts = self.agency_manager.onboard_and_update_agency_with_agents_details(request)
        return buildResponse(
            f"Agency {'updated' if is_update else 'onboarded'} successfully", {
            "agency_id": agency_id,
            "agent_type_counts": type_counts
        }, 200)
    
    @require_session
    def get_trending_agency_stats(self):
        total_count, trending_count, trending_agencies = self.agency_manager.get_trending_agency_stats_dtls()
        return buildResponse("Agency trend stats fetched successfully",{
            "total_agencies": total_count,
            "trending_agencies": trending_count,
            "filter_status": "trending",
            "agencies": trending_agencies
        }, 200)
    
    @require_session
    def delete_agency(self, agency_id):
        try:
            result = self.agency_manager.delete_agency_details(agency_id)
            if not result.get("success"):
                return jsonify(result), 200
            return jsonify({
                "Success": True,
                "Message": result["message"],
                "agency_id": agency_id,
                "is_deleted": True
            }), 200
        except Exception as ex:
            self.utils.log_error("Error in DeleteAgency:")
            return jsonify({"Success": False, "Message": str(ex)}), 500
    
    @require_session
    def get_task_agents_with_agencies(self):
        sorted_agents = self.agency_manager.get_task_agents_with_agencies_details()
        return buildResponse("Agents with agency details fetched successfully", sorted_agents, 200)    
    
    @require_session
    def get_agent_and_order2_agents(self):
        main_agent_info, order_2_agents = self.agency_manager.get_agent_and_order2_agents_details(request)
        return buildResponse("Agent and order to Agent details fetched successfully", {
            "main_agent": main_agent_info,
            "order_2_agents": order_2_agents
        }, 200)
    
    @require_session
    def agency_mappings(self):
        mappings, agents = self.agency_manager.update_agency_mappings(request)
        return buildResponse("Mappings and agents fetched successfully", {
            "mappings": mappings,
            "agents": agents
        }, 200)

    @require_session
    def agency_statistics(self):
        stats = self.agency_manager.get_agency_statistics()
        return buildResponse("Agency statistics fetched successfully", stats, 200)
     
    @require_session
    def get_workflow_statistics(self):
        stats = self.workflow_service.get_workflow_statistics()
        return buildResponse("Workflow statistics fetched successfully", stats, 200)
 
    @require_session
    def get_knowledgestore_statistics(self):
        stats = self.knowledgestore_manager.get_knowledgestore_statistics()
        return buildResponse("Knowledge store statistics fetched successfully", stats, 200)
 
    @require_session
    def get_mcp_statistics(self):
        stats = self.knowledgestore_manager.get_mcp_statistics()
        return buildResponse("MCP statistics fetched successfully", stats, 200)
 
    
    # Chatbot Methods
    @require_session
    def chatbot_agent_handler(self):
        """Handle chatbot requests from both chatbot page and prompt repository"""
        try:
            data = self.utils.validate_json_request(request)
            
            # Check if prompt_title is present (from prompt repository)
            has_prompt_title = "prompt_title" in data
            
            # Process the request with or without prompt_title
            return self.chatbot_agent.process_request(request, data, has_prompt_title)
            
        except Exception as e:
            print(f"Error in chatbot_agent_handler: {str(e)}")
            return buildResponse(f"Error processing request: {str(e)}", 500)

    @require_session
    def chatbot_agent_handler_chat(self):
        """Handle chatbot requests from both chatbot page and prompt repository"""
        try:
            data = self.utils.validate_json_request(request)
            
            # Check if prompt_title is present (from prompt repository)
            has_prompt_title = "prompt_title" in data
            
            print(f"Teams-bot Chat input :{data}")
            
            # Process the request with or without prompt_title
            return self.chatbot_agent.process_chat(request, data, has_prompt_title)
            
        except Exception as e:
            print(f"Error in chatbot_agent_handler: {str(e)}")
            return buildResponse(f"Error processing request: {str(e)}", 500)
            
    @require_session     
    def get_knowlege_graph_collections(self):
        serialized_docs = self.testcase_manager.fetch_graph_data()
        return buildResponse("Knowledge graph collection fetched successfully", serialized_docs, 200)
    
    @require_session
    def get_popular_queries(self):
        data = request.get_json()
        teams = data.get("teams", "").strip()
        popular_queries = self.testcase_manager.fetch_popular_queries(teams)
        return buildResponse("Popular query fetched successfully", popular_queries, 200)
            
    
    @require_session
    def get_recent_data(self):
        data = request.get_json()
        print("dd",data)
        master_agent_id = data.get("master_agent_id","")
        print("masss",master_agent_id)
        results = self.testcase_manager.fetch_recent_data(master_agent_id)
        return buildResponse("Recent data fetched successfully", results, 200)
    
    # @require_session
    def get_recent_data_agent(self):
        data = request.get_json()
        agent_id = data.get("agent_id","")
        print("agent_id",agent_id)
        result = json.loads(json_util.dumps(self.chatbot_tracking_collection.find({"agent_id":agent_id},{"_id":0,"user_query":1})))
        return buildResponse("Recent data fetched successfully", result, 200)
    
    @require_session
    def get_master(self):
        try:
            data = request.get_json(silent=True) or {}
            agent_id = data.get("agent_id", "").strip()
            
            if not agent_id:
                return {"success": False, "message": "agent_id is required"}
            
            task_agent_data = self.agent_collection.find_one(
                {"agent_id": agent_id, "status": "active", "agent_type_name": "Task Agent"},
                {"_id": 0}
            )
            if not task_agent_data:
                return {"success": False, "message": "Task agent not found"}
            
            mapping_doc = self.agent_agency_mapping_collection.find_one(
                {"agent_id": agent_id, "status": "active"},
                {"agency_id": 1, "_id": 0}
            )
            if not mapping_doc:
                return {"success": False, "message": "No agency mapping found"}
            
            agency_id = mapping_doc.get("agency_id")
            
            master_mapping = self.agent_agency_mapping_collection.find_one(
                {"agency_id": agency_id, "order_number": 1, "status": "active"}
            )
            if not master_mapping:
                return {"success": False, "message": "Master mapping not found"}
            
            master_agent_id = master_mapping.get("agent_id")
            master_agent = self.agent_collection.find_one(
                {"agent_id": master_agent_id},
                {"_id": 0}
            )
            if not master_agent:
                return {"success": False, "message": "Master agent not found"}
            
            master_agent["subagent"] = task_agent_data
            
            # Return response in the structure expected by the UI
            return {
                "success": True,
                "data": master_agent
            }
            
        except Exception as e:
            # Handle any unexpected errors
            return {
                "success": False,
                "message": str(e)
            }
    
    @require_session
    def update_feedback_details(self):
        data = request.get_json()
        results = self.testcase_manager.update_feedback_dtls(data)
        return buildResponse("Feedback updated successfully", results, 200)
            
    @require_session
    def update_review_feedback_details(self):
        data = request.get_json()
        results = self.testcase_manager.update_review_feedback_dtls(data)
        return buildResponse("Feedback updated successfully", results, 200)
        
    @require_session
    def route_query_api(self):
        data = request.get_json()
        user_query = data.get("userQuery", "").strip()
        teams = data.get("teams", "").strip()

        if not user_query:
            raise ValidationError("user_query is required", ["user_query is required"])

        result = self.testcase_manager.route_query(user_query, teams)

        if isinstance(result, dict) and not result.get("success", True):
            error_response = {
                "success": False,
                "message": result.get("message", "Please refine your query.")
            }
            return jsonify(error_response), 200
        
        return buildResponse("Query details fetched successfully", result, 200)


    @require_session
    def fetch_and_transform_graph(self):
        data = request.get_json()
        rag_id = data.get("rag_id")
        
        if not rag_id:
            return jsonify({"error": "rag_id is required"}), 500
        
        print("rag_id",rag_id)

        kg_operation = {
                    'type': 'find_one',
                    'filter': {"rag_id": rag_id}
                    }
        kg_api_id = self.chatbot_agent._query_db('kb_collection', kg_operation)

        print("kg_api_id",kg_api_id)
        
        url = f"{config_loader.LYZR_RAG_URL}/v4/knowledge_graph/neo4j/graph/?rag_id={rag_id}"
        headers = {"x-api-key": kg_api_id['user_id'], "Content-Type": "application/json"}
        
        response = requests.request("GET", url, headers=headers)
        data = response.json()
        
        graph = data.get("graph_data")
        
        if graph is None:
            raise ValueError("API response does not contain 'graph_data'")
        
        filtered_nodes = [
            {"text": node.get("text"), "id": node.get("id"), "type": node.get("type")}
            for node in graph.get("nodes", [])
            if node.get("text") and node.get("text").strip() and node.get("text") != "null"
        ]
        
        graph_data = {
                "node_labels": graph.get("node_labels", []),
                "relationship_types": graph.get("relationship_types", []),
                "nodes": filtered_nodes,
                "edges": graph.get("edges", [])
            }
        
        return buildResponse("Graph data fetched successfully", graph_data, 200)

    
    
        
    @require_session     
    def get_knowledgestore_details_counts(self):
        total = self.knowledgestore_manager.get_knowledgestore_details_counts()
        return buildResponse("Knowledge store count fetched successfully",  {
                "total_knowlegeGraph": total,
        }, 200)
        
    @require_session
    def get_knowledgestore_details(self):
        result = self.knowledgestore_manager.get_knowledgestore_details()
        return buildResponse("Knowledge graph data fetched successfully", result, 200)   
    
    @require_session
    def get_knowledgestore_doc_details(self,rag_id):
        result = self.knowledgestore_manager.get_knowledgestore_doc_details(rag_id)
        return buildResponse("Knowledge store doc details fetched successfully", result, 200)
        
    @require_session  
    def add_project_details(self):
        result = self.user_manager.onboard_project_details(request)
        return buildResponse("Project details added successfully", {'result': result}, 200)
        
    @require_session
    def get_all_projects(self):
        result = self.user_manager.get_all_projects()
        return buildResponse("Projects fetched successfully", result, 200)
        
    @require_session
    def update_project_details(self, project_id):
        result = self.user_manager.update_project_details(project_id, request)
        return buildResponse("Project updated successfully", result, 200)
    
    @require_session
    def delete_project(self, project_id):
        result = self.user_manager.delete_project(project_id)
        return buildResponse("Project deleted successfully", result, 200)
        
    @require_session
    def get_all_teams(self):
        result = self.user_manager.get_all_teams_service()
        return buildResponse("Teams fetched successfully", result, 200)
        
    # @require_session
    # def get_all_roles(self):
    #     try:
    #         result = self.user_manager.get_all_roles_service()
    #         return jsonify(result), 200
    #     except Exception as ex:
    #         self.utils.log_error("Exception while Get the Roles:")
    #         return jsonify({"Success": False, "Message": str(ex)}), 500
        
    @require_session
    def switch_project(self):
        data = request.get_json()
        project_name = data.get('prj_name')
        if not project_name:
            raise ValidationError( "project_name is required")
        
        result = self.user_manager.switch_projectname(project_name)

        if not result:
            raise ValidationError("Failed to switch project")
        
        tokens = session_manager.get_tokens({ **get_current_user(), "ActiveProject": project_name })
        return buildResponse("Project switched successfully", tokens, 200)
            
           
    def get_scheduled_agents(self):
        # Query agents with non-empty scheduleFrequency and schedulerTime
        agents_cursor = self.agent_collection.find(
            {
                "scheduleFrequency": {"$exists": True, "$ne": [], "$not": {"$size": 0}},
                "schedulerTime": {"$exists": True, "$ne": {}},
                "status": "active"
            },
            {
                "_id": 0,
                "name": 1,
                "agent_id": 1,
                "schedulerTime": 1,
                "scheduleFrequency": 1
            }
        )
        agents = list(agents_cursor)

        if not agents:
            raise NotFoundError("No agents with scheduler found")

        return buildResponse("Scheduled agent details fetched", agents, 200)
        
        
    #WorkFlow
    @require_session
    def get_all_workflows(self):
        workflows = self.workflow_service.get_all()
        return buildResponse("Fetched workflows successfully", workflows, 200)
 
    @require_session
    def get_workflow(self, flow_id):
        workflow = self.workflow_service.get_by_id(flow_id)
        return buildResponse("Workflow fetched", workflow, 200)
 
    @require_session
    def create_workflow(self):
        data = request.get_json(force=True)
        if not data:
            raise ValidationError("Invalid JSON payload")
        
        workflow = self.workflow_service.create(data)
        return buildResponse("Workflow created successfully", workflow, 201)
 
    @require_session
    def update_workflow(self, flow_id):
        data = request.get_json(force=True)
        if not data:
            raise ValidationError("Invalid JSON payload")
        
        updated = self.workflow_service.update(flow_id, data)

        return buildResponse("Workflow updated successfully", updated, 200)
 
    @require_session
    def delete_workflow(self, flow_id):
        self.workflow_service.delete(flow_id)
        return buildResponse(f"Workflow '{flow_id}' deleted successfully", { "flow_id": flow_id }, 200)
            
    @require_session
    def download_file(self):
            try:
                if 'file' not in request.files:
                    raise ValidationError("No file uploaded")
                
                md_file = request.files['file']
                if md_file.filename == '':
                    raise ValidationError("No file selected")
                
                # Optional: validate it's a .md file
                if not md_file.filename.lower().endswith('.md'):
                    raise ValidationError("File must be a Markdown (.md) file")
                
                print(f"Uploaded filename: {md_file.filename}")
                
                uniq_id = str(uuid.uuid4())
                md_path = os.path.join(self.tempdir, f"{uniq_id}.md")  # Safer extension
                docx_path = os.path.join(self.tempdir, f"{uniq_id}.docx")
                
                md_file.save(md_path)

                # pypandoc.convert_file(
                    # md_path,
                    # 'docx',
                    # format='markdown',
                    # outputfile=docx_path
                # )
                pypandoc.convert_file(
                    source_file=md_path,
                    to='docx',
                    format='gfm+hard_line_breaks',
                    outputfile=docx_path,
                    extra_args=[
                        "--standalone",
                        "--wrap=none"
                    ]
                )
                
                # Apply visible table borders
                self.fix_all_table_borders(docx_path)
                
                response = send_file(
                    docx_path,
                    as_attachment=True,
                    download_name="output.docx"
                )
                
                # # Clean up temp files after sending (use a background task in production if needed)
                # @response.call_on_close
                # def cleanup(self):
                #     try:
                #         if os.path.exists(md_path):
                #             os.remove(md_path)
                #         if os.path.exists(docx_path):
                #             os.remove(docx_path)
                #     except Exception as e:
                #         print(f"Cleanup error: {e}")
                
                return response
            
            except Exception as ex:
                self.utils.log_error("Error in download")
        
    @require_session
    def download_docx(self):
        try:
            if 'file' not in request.files:
                return jsonify({"Success": False, "Message": "No file uploaded"}), 400
            
            md_file = request.files['file']
            if md_file.filename == '':
                return jsonify({"Success": False, "Message": "No file selected"}), 400
            
            uniq_id = str(uuid.uuid4())
            docx_path = os.path.join(self.tempdir, f"{uniq_id}.docx")
            
            content = md_file.stream.read()
            pypandoc.convert_text(
                source=content,
                to='docx',
                format='html',
                outputfile=docx_path
            )
            # Apply visible table borders
            self.fix_all_table_borders(docx_path)
            
            response = send_file(
                docx_path,
                as_attachment=True,
                download_name="output.docx"
            )
            
            return response
        
        except Exception as ex:
            self.utils.log_error("Error in download")
            return jsonify({"Success": False, "Message": str(ex)}), 500
    
    def set_cell_borders(self,cell, thickness=12, color="000000"):
            """
            Set black single-line borders on all four sides of a cell.
            thickness: in 1/8 pt (12 = 1.5 pt, visible and thick; adjust as needed)
            """
            tc = cell._tc
            tcPr = tc.get_or_add_tcPr()
        
            tcBorders = tcPr.first_child_found_in("w:tcBorders")
            if tcBorders is None:
                tcBorders = OxmlElement('w:tcBorders')
                tcPr.append(tcBorders)
        
            for side in ["top", "left", "bottom", "right"]:
                border = OxmlElement(f'w:{side}')
                border.set(qn('w:val'), 'single')
                border.set(qn('w:sz'), str(thickness))   # Thickness
                border.set(qn('w:color'), color)         # Black
                tcBorders.append(border)
        
    def fix_all_table_borders(self,input_path, output_path=None):
            if output_path is None:
                output_path = input_path  # Overwrite original
        
            doc = Document(input_path)
        
            table_count = len(doc.tables)
            print(f"Found {table_count} table(s) in the document.")
        
            if table_count == 0:
                print("No tables to fix.")
                return
        
            for idx, table in enumerate(doc.tables, start=1):
                print(f"Fixing table {idx}/{table_count}...")
                for row in table.rows:
                    for cell in row.cells:
                        self.set_cell_borders(cell, thickness=12)  # Thick black borders
        
            doc.save(output_path)
            print(f"Full grid borders applied! Saved to: {output_path}")
 
    @require_session
    def workflow_run_agent(self):
        data = self.utils.validate_json_request(request)
        # ✅ Capture user_type BEFORE starting background thread
        current_user = get_current_user()
        prj_name = current_user.get('ActiveProject', 'master') if current_user else 'master'
        project_doc = self.project.find_one({'projectName': prj_name})
        if project_doc:
            data['user_type'] = project_doc['database_name']
        else:
            data['user_type'] = self.config.config["MONGODB_COLLECTION_NAME_MASTER"]
        # Now pass this to workflow service
        result = self.workflow_service.workflow_run_agent_details(data)
        return buildResponse("Workflow started", result, 200)
        
    def lyzr_agent_url(self):
       if str(config_loader.LYZR_AGENT_URL).endswith('/'):
           return config_loader.LYZR_AGENT_URL
       return config_loader.LYZR_AGENT_URL + '/'
    

    def get_agent_api_key_by_id(self, agent_id: str, workflow_id: str = None) -> str:
        # First try to find in agent_collection
        agent_details = self.agent_collection.find_one({"agent_id": agent_id})

        if agent_details:
            api_key = agent_details.get('agent_api_key')
            if api_key:
                return api_key

        # If not found in agent_collection or no API key, try workflow_collection if workflow_id is provided
        if workflow_id:
            workflow_details = self.workflow_collection.find_one({"flow_id": workflow_id})
            
            if workflow_details:
                # Check if the workflow has an API key
                api_key = workflow_details.get('api_key')
                if api_key:
                    return api_key
                
                # Check if the workflow has agents and if any of them match our agent_id and have an API key
                agents = workflow_details.get('agents', [])
                for agent in agents:
                    if agent.get('agent_id') == agent_id:
                        agent_api_key = agent.get('agent_api_key')
                        if agent_api_key:
                            return agent_api_key
        
        # If we still haven't found an API key, raise an error
        raise NotFoundError("API key not found for agent")

    def _get_event_id_from_logs(self, request_id: str, selected_project: str) -> str:
        logs_dir = "logs"
        if not os.path.isdir(logs_dir):
            return None

        raw_project = selected_project
        print(f"Selected project: {raw_project}")
        if not raw_project:
            return None

        projects = [p.strip() for p in raw_project.split(",") if p.strip()]
        if not projects:
            return None

        # Get relevant log files for this project
        relevant_files = self._get_relevant_files(
            logs_dir, projects, start=None, end=None
        )

        # Sort files by modified time (newest first)
        relevant_files.sort(key=lambda x: os.path.getmtime(x[0]), reverse=True)

        for filepath, project_name, log_date in relevant_files:
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    for line in f:
                        # Check if this line belongs to the request_id
                        if f"request_id={request_id}" in line or request_id in line:
                            print("iiiiiii")
                            print("line",line)

                            # 1. Extract JSON from body={...}
                            body_match = re.search(
                                r"body=(\{.*?\})(?:\s*\||$)", line
                            )
                            if body_match:
                                try:
                                    body_data = json.loads(body_match.group(1))
                                    event_id = body_data.get("event_id")
                                    if event_id:
                                        return str(event_id)
                                except json.JSONDecodeError:
                                    pass

                            # 2. Fallback regex to capture "event_id": "VALUE"
                            event_match = re.search(
                                r'["\']event_id["\']\s*:\s*["\']([^"\']+)["\']',
                                line,
                            )
                            
                            if event_match:
                                return event_match.group(1)

                            # If event_id wasn't found on this line (e.g. rtype=response),
                            # the loop will continue to check other lines for this request_id!
            except Exception as e:
                print(f"Error reading log file {filepath}: {e}")
                continue

        return None
    def get_chat_messages(self, request_id: str, user_type: str, selected_project: str):
        try:

            event_id = self._get_event_id_from_logs(request_id,selected_project)
            find_op = {
                'type': 'find_one',
                'filter': {"event_id": event_id}
            }

            data = self.chatbot_agent._query_db(
                'chatbot_tracking',
                find_op,
                user_type=user_type
            )

            if data and isinstance(data, dict):
                return {
                    'output_message': data.get("prompt_output", ""),
                    'input_message': data.get("user_prompt") or data.get("user_query", "")
                }
        except Exception as e:
            print(f"Error fetching chat messages: {e}")

        return {}

    def update_chat_messages(self,event_id, session_id, final_content, trace_details_data,collected_logs,final_input_message):
        try:
            update_op = {
                'type': 'update_one',
                'filter': {'event_id': event_id},
                'update': {
                    "$set": {
                        "prompt_output": final_content,
                        "status": "completed",
                        "session_id": session_id,
                        "real_time_logs": collected_logs,
                        "trace_info": trace_details_data,
                        "user_prompt": final_input_message
                    }
                }
            }
            self.chatbot_agent._query_db('chatbot_tracking', update_op)
            print("Full Response and trace info saved into db111")
        except Exception as e:
            print("No data found for the given event_id to update", e)
    
    @require_session
    def grp_log(self):
        run_id = request.args.get('run_id')
        log_id = request.args.get('log_id')
        trace_id = request.args.get('trace_id')
        agent_id = request.args.get('agent_id')

        api_key = self.get_agent_api_key_by_id(agent_id)

        log_grp_url = f"{self.lyzr_agent_url()}v3/ops/grouped-logs"
        headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        params = {"run_id": run_id,"log_id": log_id,"trace_id": trace_id}
        try:
            log_grp_response = requests.get(log_grp_url, headers=headers, params=params)
            log_grp_response.raise_for_status()
            log_grp_details = log_grp_response.json()
            return buildResponse("Log group details fetched succesfully", log_grp_details, 200)
        
        except requests.exceptions.RequestException as e:
            raise ApiError(f"Error calling log detail endpoint: {str(e)}", e, e.response.status_code or 500)

    @require_session
    def log_details(self):
        run_id = request.args.get('run_id')
        log_id = request.args.get('log_id')
        trace_id = request.args.get('trace_id')
        feature = request.args.get('feature')
        agent_id = request.args.get('agent_id')
    
        api_key = self.get_agent_api_key_by_id(agent_id)

        log_detail_url = f"{self.lyzr_agent_url()}v3/ops/logs"
        headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        params = {"run_id": run_id,"log_id": log_id,"trace_id": trace_id,"feature": feature}
        try:
            log_detail_response = requests.get(log_detail_url, headers=headers, params=params)
            log_detail_response.raise_for_status()
            log_details = log_detail_response.json()

            return buildResponse("Log details fetched successfully", log_details, 200)
        except requests.exceptions.RequestException as e:
            return ApiError(f"Error calling log detail endpoint: {str(e)}", e, e.response.status_code or 500)
        
    
    @require_session
    def get_workflow_logs_and_traces_api(self, workflow_id, event_id):
        """
        API endpoint to fetch logs and traces for a specific workflow execution
        """
        try:
            workflow_manager = self.workflow_service 
            
            # Fetch logs and traces
            logs_and_traces = workflow_manager.get_workflow_logs_and_traces(workflow_id, event_id)
            
            if logs_and_traces.get("success"):
                return buildResponse("Logs and traces fetched successfully", logs_and_traces, 200)
            else:
                return buildResponse(
                    "Failed to fetch logs and traces", 
                    logs_and_traces.get("message", "No logs or traces found"), 
                    200
                )
                
        except Exception as e:
            print(f"Error fetching logs and traces: {e}")
            import traceback
            traceback.print_exc()
            return buildResponse(
                f"Error fetching logs and traces: {str(e)}", 
                {"error": str(e)}, 
                500
            )     
    def _convert_trace_timestamps_to_utc(self, trace_obj: dict) -> dict:
        """
        Convert any timestamp fields in a trace object to UTC ISO format.
        Handles trace_start_time, trace_end_time, timestamp, created_at, started_at, etc.
        """
        if not isinstance(trace_obj, dict):
            return trace_obj
        
        trace_copy = trace_obj.copy()
        timestamp_fields = ['timestamp', 'created_at', 'started_at', 'trace_start_time', 'trace_end_time', 'recorded_at']
        
        for field in timestamp_fields:
            if field in trace_copy and trace_copy[field]:
                try:
                    ts_value = trace_copy[field]
                    
                    # If it's already a string in ISO format, try to parse it
                    if isinstance(ts_value, str):
                        # Try parsing ISO format with timezone info
                        try:
                            dt = datetime.fromisoformat(ts_value.replace('Z', '+00:00'))
                        except:
                            # If that fails, try other common formats
                            try:
                                # Try parsing without timezone (assume local time)
                                dt = datetime.fromisoformat(ts_value)
                                # If no tzinfo, assume UTC
                                if dt.tzinfo is None:
                                    dt = dt.replace(tzinfo=timezone.utc)
                            except:
                                # Skip if we can't parse
                                continue
                        
                        # Convert to UTC and return ISO format
                        if dt.tzinfo is not None:
                            dt_utc = dt.astimezone(timezone.utc)
                            trace_copy[field] = dt_utc.isoformat()
                        else:
                            # If no timezone info, assume it's UTC
                            trace_copy[field] = dt.replace(tzinfo=timezone.utc).isoformat()
                    
                    elif isinstance(ts_value, datetime):
                        # If it's already a datetime object
                        if ts_value.tzinfo is None:
                            dt_utc = ts_value.replace(tzinfo=timezone.utc)
                        else:
                            dt_utc = ts_value.astimezone(timezone.utc)
                        trace_copy[field] = dt_utc.isoformat()
                
                except Exception as e:
                    logger.warning(f"Could not convert timestamp field '{field}': {str(e)}")
                    continue
        
        return trace_copy
    
    @require_session      
    def capture_workflow_agent_traces_old(self):
        try:
            data = request.json
            workflow_id = data.get('workflow_id')
            event_id = data.get('event_id')
            agents = data.get('agents', [])
            limit = data.get('limit', 1)
           
            if not workflow_id or not event_id:
                raise ValidationError("Missing workflow_id or event_id")
            if not agents:
                raise ValidationError("No agents provided")
           
            # ✅ FIX: Get user_type for multi-tenant support
            current_user = get_current_user()
            prj_name = current_user.get('ActiveProject', 'master') if current_user else 'master'
            project_doc = self.project.find_one({'projectName': prj_name})
            user_type = project_doc['database_name'] if project_doc else 'master'
           
            all_traces = []
            agent_traces_map = {}
           
            with ThreadPoolExecutor(max_workers=min(5, len(agents))) as agent_executor:
                agent_futures = {}
                for agent_info in agents:
                    agent_id = agent_info.get('agent_id')
                    agent_name = agent_info.get('agent_name', 'Unknown')
                    if not agent_id:
                        continue
                        
                        
                    print(f"agent_id------{agent_id}")
                    future = agent_executor.submit(
                        self._fetch_workflow_agent_traces,
                        agent_id,
                        limit=limit,
                        workflow_id=workflow_id,
                        user_type=user_type  # ✅ Pass user_type
                    )
                    
                    print(f"agent_executor---Traces---:{future}")
                    agent_futures[future] = {
                        'agent_id': agent_id,
                        'agent_name': agent_name
                    }
               
                for future in as_completed(agent_futures):
                    print(f"agent_future---Traces---:{future}")
                    agent_meta = agent_futures[future]
                    agent_id = agent_meta['agent_id']
                    agent_name = agent_meta['agent_name']
                    try:
                        traces_list = future.result()
                        if not traces_list or (isinstance(traces_list, list) and len(traces_list) == 0):
                            continue
                        agent_traces_map[agent_id] = {
                            'agent_name': agent_name,
                            'traces': traces_list
                        }
                    except Exception as e:
                        logger.warning(f"Failed to capture traces for agent {agent_id}: {str(e)}")
                        continue
           
           
            print(f"agent_traces_map---Traces---:{agent_traces_map}")
            if agent_traces_map:
                with ThreadPoolExecutor(max_workers=10) as trace_executor:
                    trace_futures = {}
                    for agent_id, agent_data in agent_traces_map.items():
                        agent_name = agent_data['agent_name']
                        traces_list = agent_data['traces']
                        for trace in traces_list:
                            trace_id = trace.get('trace_id')
                            if trace_id:
                                future = trace_executor.submit(
                                    self._fetch_workflow_trace_detail,
                                    trace_id,
                                    agent_id,
                                    workflow_id=workflow_id,
                                    user_type=user_type  # ✅ Pass user_type
                                )
                                print(f"agent_executor---Traces---map:{future}")
                                trace_futures[future] = {
                                    'agent_id': agent_id,
                                    'agent_name': agent_name,
                                    'trace_summary': trace
                                }
                   
                    for future in as_completed(trace_futures):
                        trace_meta = trace_futures[future]
                        try:
                            trace_detail = future.result()
                            # ✅ Pass user_type
                            real_time_logs = self._fetch_agent_real_time_logs(
                                workflow_id,
                                event_id,
                                trace_meta['agent_id'],
                                user_type=user_type
                            )
                            all_traces.append({
                                'agent_id': trace_meta['agent_id'],
                                'agent_name': trace_meta['agent_name'],
                                'trace_id': trace_meta['trace_summary'].get('trace_id'),
                                'trace_summary': trace_meta['trace_summary'],
                                'trace_details': trace_detail,
                                'real_time_logs': real_time_logs,
                                'captured_at': datetime.now(timezone.utc).isoformat()
                            })
                        except Exception as e:
                            logger.warning(f"Failed to capture trace detail: {str(e)}")
                            continue
           
            if all_traces:
                return buildResponse(
                    "Workflow agent traces captured successfully",
                    {
                        "workflow_id": workflow_id,
                        "event_id": event_id,
                        "limit_per_agent": limit,
                        "traces_captured": len(all_traces),
                        "traces": all_traces
                    },
                    200
                )
            else:
                return buildResponse(
                    "No traces found for workflow agents",
                    {
                        "workflow_id": workflow_id,
                        "event_id": event_id,
                        "traces_captured": 0
                    },
                    200
                )
        except ValidationError as e:
            raise e
        except Exception as e:
            logger.error(f"Error capturing workflow traces: {str(e)}")
            raise ApiError(f"Error capturing workflow traces: {str(e)}", e, 500)
 
    
    @require_session
    def capture_workflow_agent_traces(self):
        try:
            data = request.json
            workflow_id = data.get('workflow_id')
            event_id = data.get('event_id')
            agents = data.get('agents', [])
            limit = data.get('limit', 100)
            
            # accept project from request body
            project_name = data.get('project') or data.get('prj_name')
            
            if not workflow_id or not event_id:
                raise ValidationError("Missing workflow_id or event_id")
            if not agents:
                raise ValidationError("No agents provided")
            
            # Get current user 
            current_user = get_current_user()
            
            if not project_name:
                project_name = current_user.get('ActiveProject') if current_user else 'master'

            project_doc = self.project.find_one({'projectName': project_name})
            if not project_doc:
                user_type = self.config.config.get("MONGODB_COLLECTION_NAME_MASTER", "master")
            else:
                user_type = project_doc['database_name']
            
            all_traces = []
            agent_traces_map = {}
            # Create agent position map from original request order, BUT REVERSE IT
            # Because agents come in reverse execution order in the request
            num_agents = len(agents)
            agent_position_map = {agent_info.get('agent_id'): (num_agents - 1 - idx) for idx, agent_info in enumerate(agents)}
            
            # ============================================================
            # FIX: Add initial delay to allow traces to be written
            # ============================================================
            initial_delay = int(data.get('initial_delay', 3))
            max_concurrent = int(data.get('max_concurrent', 2))
            logger.info(f"Waiting {initial_delay}s for traces to be written before fetching...")
            time.sleep(initial_delay)
            
            # ============================================================
            # FIX: Use semaphore to limit concurrent API calls
            # ============================================================
            semaphore = threading.Semaphore(max_concurrent)
            
            def is_conditional_agent(agent_name: str) -> bool:
                """Check if agent is a conditional/control flow agent that won't have traces"""
                if not agent_name:
                    return False
                agent_name_lower = agent_name.lower()
                conditional_keywords = ['conditional', 'condition', 'control_flow', 'if_', 'switch', 'decision']
                return any(keyword in agent_name_lower for keyword in conditional_keywords)
            
            def fetch_with_semaphore(agent_info):
                """Wrapper that limits concurrent API calls"""
                with semaphore:
                    agent_id = agent_info.get('agent_id')
                    agent_name = agent_info.get('agent_name', 'Unknown')
                    try:
                        return agent_id, self._fetch_workflow_agent_traces(
                            agent_id,
                            limit=limit,
                            workflow_id=workflow_id,
                            user_type=user_type
                        )
                    except Exception as e:
                        logger.error(f"Failed to fetch traces for {agent_name}: {e}")
                        return agent_id, []
            
            with ThreadPoolExecutor(max_workers=min(5, len(agents))) as agent_executor:
                agent_futures = {}
                for agent_info in agents:
                    agent_id = agent_info.get('agent_id')
                    agent_name = agent_info.get('agent_name', 'Unknown')
                    if not agent_id:
                        continue
                    
                    # Skip conditional/control flow agents that won't have traces
                    if is_conditional_agent(agent_name):
                        logger.info(f"Skipping conditional agent '{agent_name}' - condition nodes don't produce traces")
                        continue
                    
                    future = agent_executor.submit(fetch_with_semaphore, agent_info)
                    agent_futures[future] = {
                        'agent_id': agent_id,
                        'agent_name': agent_name
                    }
                
                for future in as_completed(agent_futures):
                    agent_meta = agent_futures[future]
                    agent_id = agent_meta['agent_id']
                    agent_name = agent_meta['agent_name']
                    try:
                        returned_id, traces_list = future.result()
                        if not traces_list or (isinstance(traces_list, list) and len(traces_list) == 0):
                            continue
                        agent_traces_map[agent_id] = {
                            'agent_name': agent_name,
                            'traces': traces_list
                        }
                    except Exception as e:
                        logger.warning(f"Failed to capture traces for agent {agent_id}: {str(e)}")
                        continue
            
            if agent_traces_map:
                with ThreadPoolExecutor(max_workers=10) as trace_executor:
                    trace_futures = {}
                    trace_index = 0  # Track trace order globally
                    
                    # Iterate through original agents list to maintain execution order
                    for agent_info in agents:
                        agent_id = agent_info.get('agent_id')
                        
                        # Skip if agent not in map (no traces found)
                        if agent_id not in agent_traces_map:
                            continue
                        
                        agent_data = agent_traces_map[agent_id]
                        agent_name = agent_data['agent_name']
                        traces_list = agent_data['traces']
                        
                        # Keep trace order as returned from API - don't sort
                        # Each trace gets an index based on its position in the list
                        for idx, trace in enumerate(traces_list):
                            trace_id = trace.get('trace_id')
                            if trace_id:
                                # Convert trace summary timestamps to UTC before adding to futures
                                converted_trace = self._convert_trace_timestamps_to_utc(trace)
                                future = trace_executor.submit(
                                    self._fetch_workflow_trace_detail,
                                    trace_id,
                                    agent_id,
                                    workflow_id=workflow_id
                                )
                                trace_futures[future] = {
                                    'agent_id': agent_id,
                                    'agent_name': agent_name,
                                    'trace_summary': converted_trace,
                                    'trace_index': trace_index,
                                    'agent_position': agent_position_map.get(agent_id, 999),
                                    'trace_order_in_agent': idx  # Track position within agent's traces
                                }
                                trace_index += 1
                    
                    # Collect traces from completed futures
                    for future in as_completed(trace_futures):
                        trace_meta = trace_futures[future]
                        try:
                            trace_detail = future.result()
                            real_time_logs = self._fetch_agent_real_time_logs(
                                workflow_id,
                                event_id,
                                trace_meta['agent_id'],
                                user_type=user_type
                            )
                            all_traces.append({
                                'agent_id': trace_meta['agent_id'],
                                'agent_name': trace_meta['agent_name'],
                                'trace_id': trace_meta['trace_summary'].get('trace_id'),
                                'trace_summary': trace_meta['trace_summary'],
                                'trace_details': trace_detail,
                                'real_time_logs': real_time_logs,
                                'captured_at': datetime.now(timezone.utc).isoformat(),
                                'trace_index': trace_meta.get('trace_index', 0),
                                'agent_position': trace_meta.get('agent_position', 999),
                                'trace_order_in_agent': trace_meta.get('trace_order_in_agent', 0)
                            })
                        except Exception as e:
                            logger.warning(f"Failed to capture trace detail: {str(e)}")
                            continue
                
                # Sort by agent position, then trace order within agent
                # Ascending order: position 0 (Epic Feature Generator - first) → position 4 (Unit Testcases Creator - last)
                all_traces.sort(key=lambda x: (x.get('agent_position', 999), x.get('trace_order_in_agent', 0)))
                
                # Log the final order for debugging
                logger.info(f"Final trace order after sort: {[(t.get('agent_name'), t.get('agent_position')) for t in all_traces]}")
                
                # Remove internal tracking fields before sending response
                for trace in all_traces:
                    trace.pop('trace_index', None)
                    trace.pop('agent_position', None)
                    trace.pop('trace_order_in_agent', None)
            
            if all_traces:
                return buildResponse(
                    "Workflow agent traces captured successfully",
                    {
                        "workflow_id": workflow_id,
                        "event_id": event_id,
                        "project_name": project_name,  
                        "user_type": user_type,  
                        "limit_per_agent": limit,
                        "traces_captured": len(all_traces),
                        "traces": all_traces
                    },
                    200
                )
            else:
                return buildResponse(
                    "No traces found for workflow agents",
                    {
                        "workflow_id": workflow_id,
                        "event_id": event_id,
                        "project_name": project_name, 
                        "user_type": user_type, 
                        "traces_captured": 0
                    },
                    200
                )
        except ValidationError as e:
            raise e
        except Exception as e:
            logger.error(f"Error capturing workflow traces: {str(e)}")
            raise ApiError(f"Error capturing workflow traces: {str(e)}", e, 500)
            
    def _fetch_agent_real_time_logs_old(self, workflow_id: str, event_id: str, agent_id: str, user_type: str = 'master'):
        """
        Fetch real-time logs for a specific agent from the workflow_response collection.
        """
        try:
            # ✅ FIX: Use chatbot_agent._query_db with user_type
            find_op = {
                'type': 'find_one',
                'filter': {
                    "workflow_id": workflow_id,
                    "event_id": event_id
                }
            }
           
            # Fetch the workflow response doc from the correct tenant DB
            workflow_log_data = self.chatbot_agent._query_db(
                'workflow_response_collection',
                find_op,
                user_type=user_type
            )
           
            if not workflow_log_data or "real_time_logs" not in workflow_log_data:
                return []
           
            real_time_logs = workflow_log_data["real_time_logs"]
           
            # Handle the case where real_time_logs is a dictionary
            if isinstance(real_time_logs, dict):
                for agent_name, agent_data in real_time_logs.items():
                    if isinstance(agent_data, dict) and agent_data.get("agent_id") == agent_id:
                        return agent_data.get("logs", [])
                if agent_id in real_time_logs:
                    agent_data = real_time_logs[agent_id]
                    if isinstance(agent_data, dict) and "logs" in agent_data:
                        return agent_data["logs"]
            return []
        except Exception as e:
            logger.error(f"Error fetching real-time logs for agent {agent_id}: {str(e)}")
            return []
 
    def _fetch_workflow_agent_traces_old(self, agent_id: str, limit: int = 1, start_date: str = None, end_date: str = None, workflow_id: str = None, user_type: str = 'master') -> list:
        try:
            # ✅ Pass user_type
            api_key = self.get_agent_api_key_by_id(agent_id, workflow_id)
            trace_url = f"{self.lyzr_agent_url()}v3/traces"
            headers = {"x-api-key": api_key, "Content-Type": "application/json"}
            params = {
                "agent_id": agent_id,
                "limit": limit
            }
            if start_date:
                params["start_date"] = start_date
            if end_date:
                params["end_date"] = end_date
                
            print(f"Fetching traces for agent {agent_id} with params: {params}")
            print(f"API Key used: {api_key}")
            print(f"Workflow ID: {workflow_id}, User Type: {user_type}")
            print(f"Trace URL: {trace_url}")
            
            response = requests.get(trace_url, headers=headers, params=params, timeout=30)
            response.raise_for_status()
            # Return response directly as list (matching get_trace pattern)
            return response.json()
        except Exception as e:
            logger.error(f"Error fetching traces for agent {agent_id}: {str(e)}")
            return []
            
    def _fetch_workflow_trace_detail_old(self, trace_id: str, agent_id: str, workflow_id: str = None) -> dict:
        """
        Fetch detailed information for a specific trace.
        Extracts only SpanName, SpanAttributes, Events.Name, and Events.Attributes.
        Also extracts input/output from SpanAttributes and formats them as chat_messages.
        
        Args:
            trace_id: The trace's unique identifier
            agent_id: The agent's MongoDB ID (needed for API key)
            workflow_id: The workflow ID for fallback API key lookup
            
        Returns:
            Dictionary containing only the required trace information
        """
        try:
            api_key = self.get_agent_api_key_by_id(agent_id, workflow_id)
            trace_detail_url = f"{self.lyzr_agent_url()}v3/traces/{trace_id}"
            
            headers = {"x-api-key": api_key, "Content-Type": "application/json"}
            
            response = requests.get(trace_detail_url, headers=headers, timeout=30)
            response.raise_for_status()
            
            raw_data = response.json()
            
            # Handle both list and dict safely
            trace_data = raw_data[0] if isinstance(raw_data, list) and raw_data else raw_data
            
            # Format spans – extract only the required fields
            formatted_spans = []
            if "spans" in trace_data and isinstance(trace_data["spans"], list):
                for span in trace_data["spans"]:
                    # Extract input and output before removing them
                    input_value = span.get("SpanAttributes", {}).get("input", "")
                    output_value = span.get("SpanAttributes", {}).get("output", "")
                    
                    # Create chat_messages if input or output exists
                    chat_messages = {}
                    if input_value or output_value:
                        chat_messages = {
                            "input_message": input_value,
                            "output_message": output_value
                        }
                    
                    # Clean SpanAttributes – remove input, output, llm_output
                    clean_attrs = span.get("SpanAttributes", {}).copy()
                    clean_attrs.pop("input", None)
                    clean_attrs.pop("output", None)
                    clean_attrs.pop("llm_output", None)
                    
                    # Clean Events.Attributes – remove "query" from each object
                    clean_events_attrs = []
                    for attr in span.get("Events.Attributes", []):
                        clean_attr = attr.copy()
                        clean_attr.pop("query", None)
                        clean_events_attrs.append(clean_attr)
                    
                    formatted_span = {
                        "SpanName": span.get("SpanName", ""),
                        "SpanAttributes": clean_attrs,
                        "Events.Name": span.get("Events.Name", []),
                        "Events.Attributes": clean_events_attrs
                    }
                    
                    # Add chat_messages if it has content
                    if chat_messages:
                        formatted_span["chat_messages"] = chat_messages
                    
                    formatted_spans.append(formatted_span)
            
            # Return only the formatted spans
            return {"spans": formatted_spans}
        
        except Exception as e:
            logger.error(f"Error fetching trace detail for {trace_id}: {str(e)}")
            return {}

    def _fetch_agent_real_time_logs(self, workflow_id: str, event_id: str, agent_id: str, user_type: str = 'master'):
        """
        Fetch real-time logs for a specific agent from the workflow_response collection.
        Also includes websocket connection events.
        Only matches by agent_id, not by agent name.
        Converts all timestamps to UTC before returning.
        """
        try:
            #Sort by saved_at or created_ts in descending order to get the latest document
            find_op = {
                'type': 'find_one',
                'filter': {
                    "workflow_id": workflow_id,
                    "event_id": event_id
                },
                'sort': [('saved_at', -1), ('created_ts', -1)]  # Get the most recent document
            }
        
            # Fetch the workflow response doc from the correct tenant DB
            workflow_log_data = self.chatbot_agent._query_db(
                'workflow_response_collection',
                find_op,
                user_type=user_type
            )
            print("user_typr",user_type)
            print("user_typr1",workflow_log_data)
        
            logs_to_return = []
            
            if workflow_log_data and "real_time_logs" in workflow_log_data:
                real_time_logs = workflow_log_data["real_time_logs"]
                
                # Handle the case where real_time_logs is a dictionary (consolidated format)
                if isinstance(real_time_logs, dict):
                    
                    # ONLY match by agent_id, no name matching fallback
                    for agent_name, agent_data in real_time_logs.items():
                        if isinstance(agent_data, dict):
                            stored_agent_id = agent_data.get("agent_id")
                            
                            # Strict comparison - only match if agent_id exactly matches
                            if stored_agent_id == agent_id:
                                logs = agent_data.get("logs", [])
                                # Convert timestamps to UTC for each log entry
                                logs_to_return = [self._convert_trace_timestamps_to_utc(log) if isinstance(log, dict) else log for log in logs]
                                break
                
                # Handle the case where real_time_logs is an array (individual agent responses)
                elif isinstance(real_time_logs, list):
                    for i, log_entry in enumerate(real_time_logs):
                        if isinstance(log_entry, dict):
                            entry_agent_id = log_entry.get("agent_id")
                            if entry_agent_id == agent_id:
                                logs = log_entry.get("logs", log_entry)
                                # Convert timestamps to UTC for each log entry
                                if isinstance(logs, list):
                                    logs_to_return = [self._convert_trace_timestamps_to_utc(log) if isinstance(log, dict) else log for log in logs]
                                else:
                                    logs_to_return = [self._convert_trace_timestamps_to_utc(logs)] if isinstance(logs, dict) else [logs]
                                break
            
            # Add websocket connection events to the logs
            websocket_events = self._create_websocket_connection_events()
            if websocket_events:
                logs_to_return.extend(websocket_events)
                logger.info(f"Added {len(websocket_events)} websocket events to logs for agent {agent_id}")
            
            return logs_to_return
        except Exception as e:
            logger.error(f"Error fetching real-time logs for agent {agent_id}: {str(e)}")
            return []        
            
    def _fetch_workflow_agent_traces(self, agent_id: str, limit: int = 1, start_date: str = None, end_date: str = None, workflow_id: str = None, user_type: str = 'master') -> list:
        try:
            # ============================================================
            # FIX: Map Internal agent_id to Lyzr api_agent_id
            # ============================================================
            doc = self.agent_collection.find_one({"agent_id": agent_id}, {"api_agent_id": 1})
            
            # 2. Use the mapped ID, or fallback to the original if not found
            lyzr_agent_id = doc.get("api_agent_id") if doc else agent_id
            
            if not lyzr_agent_id:
                logger.warning(f"Could not find api_agent_id for agent {agent_id}")
                return []

            # 3. Get the API Key
            api_key = self.get_agent_api_key_by_id(agent_id, workflow_id)
            trace_url = f"{self.lyzr_agent_url()}v3/traces"
            headers = {"x-api-key": api_key, "Content-Type": "application/json"}
            
            # 4. Pass the correct Lyzr ID in the params
            params = {
                "agent_id": lyzr_agent_id, 
                "limit": limit
            }
            
            if start_date:
                params["start_date"] = start_date
            if end_date:
                params["end_date"] = end_date
                
            # Debug log to verify the ID being used
            print(f"Fetching traces for internal_id={agent_id} using lyzr_id={lyzr_agent_id}")
            
            # ============================================================
            # FIX: Retry logic with exponential backoff + empty result handling
            # ============================================================
            max_retries = 5
            retry_delay = 2
            timeout = 60
            empty_result_count = 0
            max_empty_results = 3
            
            for attempt in range(max_retries):
                try:
                    logger.debug(f"Attempt {attempt + 1}/{max_retries} for agent {agent_id}")
                    
                    response = requests.get(trace_url, headers=headers, params=params, timeout=timeout)
                    response.raise_for_status()
                    traces = response.json()
                    
                    # ============================================================
                    # FIX: Handle empty result - trace might not be ready yet
                    # ============================================================
                    if isinstance(traces, list):
                        if len(traces) == 0:
                            empty_result_count += 1
                            if empty_result_count < max_empty_results:
                                logger.warning(
                                    f"Empty traces for {agent_id} (attempt {attempt + 1}/{max_retries}), "
                                    f"trace may not be ready yet. Retrying in {retry_delay}s..."
                                )
                                time.sleep(retry_delay)
                                retry_delay *= 2
                                continue
                            else:
                                logger.warning(f"Empty traces for {agent_id} after {max_empty_results} empty results. Giving up.")
                                return []
                        else:
                            # Got traces! Convert timestamps to UTC before returning
                            if isinstance(traces, list):
                                return [self._convert_trace_timestamps_to_utc(trace) for trace in traces]
                            else:
                                return traces
                    else:
                        # Non-list response (shouldn't happen but handle gracefully)
                        logger.warning(f"Unexpected response type for {agent_id}: {type(traces)}")
                        return []
                        
                except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
                    logger.warning(f"Timeout fetching traces for {agent_id} (attempt {attempt + 1}/{max_retries}): {str(e)}")
                    if attempt < max_retries - 1:
                        time.sleep(retry_delay)
                        retry_delay *= 2
                    else:
                        logger.error(f"Failed to fetch traces after {max_retries} retries: {str(e)}")
                        
                except requests.exceptions.HTTPError as e:
                    if e.response is not None and e.response.status_code == 429:
                        logger.warning(f"Rate limited for {agent_id} (attempt {attempt + 1}). Backing off...")
                        if attempt < max_retries - 1:
                            time.sleep(retry_delay * 2)
                            retry_delay *= 2
                        continue
                    else:
                        logger.error(f"HTTP error fetching traces for {agent_id}: {e}")
                        
                except Exception as e:
                    logger.error(f"Unexpected error fetching traces for agent_id {agent_id}: {str(e)}")
                    break
            
            logger.error(f"All retries exhausted for agent {agent_id}. Returning empty list.")
            return []
            
        except Exception as e:
            logger.error(f"Error fetching traces for agent {agent_id}: {str(e)}")
            return []
            
    def _fetch_workflow_trace_detail(self, trace_id: str, agent_id: str, workflow_id: str = None) -> dict:
        """
        Fetch detailed information for a specific trace.
        Extracts only SpanName, SpanAttributes, Events.Name, and Events.Attributes.
        Also extracts input/output from SpanAttributes and formats them as chat_messages.
        Converts all timestamps to UTC before returning.
        
        Args:
            trace_id: The trace's unique identifier
            agent_id: The agent's MongoDB ID (needed for API key)
            workflow_id: The workflow ID for fallback API key lookup
            
        Returns:
            Dictionary containing only the required trace information
        """
        try:
            # Use the FlaskApp's get_agent_api_key_by_id method
            api_key = self.get_agent_api_key_by_id(agent_id, workflow_id)
            trace_detail_url = f"{self.lyzr_agent_url()}v3/traces/{trace_id}"
            
            headers = {"x-api-key": api_key, "Content-Type": "application/json"}
            
            response = requests.get(trace_detail_url, headers=headers, timeout=30)
            response.raise_for_status()
            
            raw_data = response.json()
            
            # Handle both list and dict safely
            trace_data = raw_data[0] if isinstance(raw_data, list) and raw_data else raw_data
            
            # Format spans – extract only the required fields
            formatted_spans = []
            if "spans" in trace_data and isinstance(trace_data["spans"], list):
                for span in trace_data["spans"]:
                    # Extract input and output before removing them
                    input_value = span.get("SpanAttributes", {}).get("input", "")
                    output_value = span.get("SpanAttributes", {}).get("output", "")
                    
                    # Create chat_messages if input or output exists
                    chat_messages = {}
                    if input_value or output_value:
                        chat_messages = {
                            "input_message": input_value,
                            "output_message": output_value
                        }
                    
                    # Clean SpanAttributes – remove input, output, llm_output
                    clean_attrs = span.get("SpanAttributes", {}).copy()
                    clean_attrs.pop("input", None)
                    clean_attrs.pop("output", None)
                    clean_attrs.pop("llm_output", None)
                    
                    # Clean Events.Attributes – remove "query" from each object
                    clean_events_attrs = []
                    for attr in span.get("Events.Attributes", []):
                        clean_attr = attr.copy()
                        clean_attr.pop("query", None)
                        clean_events_attrs.append(clean_attr)
                    
                    formatted_span = {
                        "SpanName": span.get("SpanName", ""),
                        "SpanAttributes": clean_attrs,
                        "Events.Name": span.get("Events.Name", []),
                        "Events.Attributes": clean_events_attrs
                    }
                    
                    # Add chat_messages if it has content
                    if chat_messages:
                        formatted_span["chat_messages"] = chat_messages
                    
                    formatted_spans.append(formatted_span)
            
            # Convert all timestamps to UTC in formatted spans
            formatted_spans = [self._convert_trace_timestamps_to_utc(span) for span in formatted_spans]
            
            # Return only the formatted spans
            return {"spans": formatted_spans}
        
        except Exception as e:
            logger.error(f"Error fetching trace detail for {trace_id}: {str(e)}")
            return {}
    
    def _save_workflow_traces(self, workflow_id: str, event_id: str, traces: list) -> None:
     
        try:
            # Log workflow trace header
            logger.info(f"================ WORKFLOW TRACE CAPTURE ================")
            logger.info(f"type=workflow_traces | workflow_id={workflow_id} | event_id={event_id}")
            logger.info(f"timestamp={datetime.now(timezone.utc).isoformat()} | total_traces={len(traces)}")
            
            # Log each trace with detailed information
            for idx, trace in enumerate(traces, 1):
                agent_id = trace.get('agent_id', 'Unknown')
                agent_name = trace.get('agent_name', 'Unknown')
                trace_id = trace.get('trace_id', 'Unknown')
                captured_at = trace.get('captured_at', '')
                
                # Log trace header
                logger.info(f"--- TRACE {idx}/{len(traces)} ---")
                logger.info(f"agent_id={agent_id} | agent_name={agent_name} | trace_id={trace_id}")
                logger.info(f"captured_at={captured_at}")
                
                # Log trace summary
                trace_summary = trace.get('trace_summary', {})
                if trace_summary:
                    logger.info(f"TRACE_SUMMARY | {json.dumps(trace_summary, default=str)}")
                
                # Log trace details - spans with required fields
                trace_details = trace.get('trace_details', {})
                spans = trace_details.get('spans', [])
                if spans:
                    for span_idx, span in enumerate(spans, 1):
                        logger.info(f"--- SPAN {span_idx} ---")
                        logger.info(f"SpanName | {span.get('SpanName', '')}")
                        
                        span_attrs = span.get('SpanAttributes', {})
                        if span_attrs:
                            logger.info(f"SpanAttributes | {json.dumps(span_attrs, default=str)}")
                        
                        events_name = span.get('Events.Name', [])
                        if events_name:
                            logger.info(f"Events.Name | {json.dumps(events_name, default=str)}")
                        
                        events_attrs = span.get('Events.Attributes', [])
                        if events_attrs:
                            logger.info(f"Events.Attributes | {json.dumps(events_attrs, default=str)}")
            
            logger.info(f"====================================================\n")
        
        except Exception as e:
            logger.error(f"Error logging workflow traces: {str(e)}")
            raise ApiError(f"Error logging workflow traces: {str(e)}", e, 500)
           
    @require_session
    def get_trace(self):
        old_agent_id = request.args.get('agent_id')
        doc = self.agent_collection.find_one({"agent_id": old_agent_id}, {"api_agent_id": 1})
        agent_id = doc["api_agent_id"] if doc else None
        print("agent_id",agent_id)
        start_time = request.args.get('start_time')
        end_time   = request.args.get('end_time')

        api_key = self.get_agent_api_key_by_id(old_agent_id)

        trace_url = f"{self.lyzr_agent_url()}v3/traces"
        headers = {"x-api-key": api_key, "Content-Type": "application/json"}

        params = {
            "agent_id": agent_id,
            "start_time": start_time,
            "end_time": end_time,
            "limit": 1
        }

        try:
            trace_response = requests.get(trace_url, headers=headers, params=params)
            trace_response.raise_for_status()
            raw_traces = trace_response.json()
            

            if not raw_traces or (isinstance(raw_traces, list) and len(raw_traces) == 0):
                return buildResponse(
                    "No traces found for this agent in the given time range",
                    [],
                    200
                )

            # Extract only the 6 fields you want
            formatted_traces = []
            for trace in raw_traces:
                trace_utc = self._convert_trace_timestamps_to_utc(trace)
                formatted = {
                      "trace_id": trace_utc.get("trace_id", ""),
                      "name": trace_utc.get("name", ""),
                      "trace_start_time": trace_utc.get("trace_start_time",""),
                      "trace_end_time": trace_utc.get("trace_end_time",""),
                      "trace_duration": trace_utc.get("trace_duration", 0),
                      "llm_input_tokens": trace_utc.get("llm_input_tokens", 0),
                      "llm_output_tokens": trace_utc.get("llm_output_tokens", 0),
                      "action_cost": trace_utc.get("action_cost", 0.0)
                }
                formatted_traces.append(formatted)

            return buildResponse("Traces fetched successfully", formatted_traces, 200)

        except requests.exceptions.RequestException as e:
            raise ApiError(f"Error calling trace endpoint: {str(e)}", e, e.response.status_code or 500) 
        
    @require_session
    def trace_details(self, trace_id):
        
        current_user = get_current_user()
        
        selected_project = request.args.get('project') or request.args.get('prj_name')

        if not selected_project:
            selected_project = current_user.get('ActiveProject') if current_user else None

        print("Selected Project for trace:", selected_project)

        project_doc = self.project.find_one({'projectName': selected_project})
        user_type = project_doc['database_name'] if project_doc else \
        self.configloader.config.get("MONGODB_COLLECTION_NAME_MASTER", "master")

        print("Using database (user_type):", user_type)
        request_id = request.args.get('request_id', '')
        old_agent_id = request.args.get('agent_id', '')

        doc = self.agent_collection.find_one({"agent_id": old_agent_id}, {"api_agent_id": 1})
        agent_id = doc["api_agent_id"] if doc else None
        print("agent_id", agent_id)

        api_key = self.get_agent_api_key_by_id(old_agent_id)

        trace_detail_url = f"{self.lyzr_agent_url()}v3/traces/{trace_id}"
        headers = {"x-api-key": api_key, "Content-Type": "application/json"}

        try:
            trace_detail_response = requests.get(trace_detail_url, headers=headers)
            trace_detail_response.raise_for_status()

            trace_details = trace_detail_response.json()
            if isinstance(trace_details, list):
                trace_details = trace_details[0] if trace_details else {}
            print("tttttt",trace_details)

            # Extract chat messages from spans BEFORE removing input/output
            priority_text = "You have access to these tools. When you need to use a tool"

            extracted_chat_messages = {"input_message": "", "output_message": ""}

            if "spans" in trace_details and isinstance(trace_details["spans"], list):
                first_input = ""
                priority_input = ""
                first_output = ""

                for span in trace_details["spans"]:
                    span_attrs = span.get("SpanAttributes", {})
                    inp = span_attrs.get("input", "")
                    out = span_attrs.get("output", "")

                    # 1. Handle Output (First output found, exactly like previous logic)
                    if not first_output and out:
                        first_output = out

                    # 2. Handle Input (Store first input, but prioritize if it contains the tools text)
                    if inp:
                        if not first_input:
                            first_input = inp

                        if priority_text in str(inp):
                            priority_input = inp

                # Set final input: Use priority input if found, otherwise default to first input
                extracted_chat_messages["input_message"] = (
                    priority_input if priority_input else first_input
                )

                # Set final output: Normal first available output
                extracted_chat_messages["output_message"] = first_output


            # extracted_chat_messages = {}
            # if "spans" in trace_details and isinstance(trace_details["spans"], list):
            #     for span in trace_details["spans"]:
            #         span_attrs = span.get("SpanAttributes", {})
            #         if span_attrs.get("input") or span_attrs.get("output"):
            #             extracted_chat_messages = {
            #                 "input_message": span_attrs.get("input", ""),
            #                 "output_message": span_attrs.get("output", "")
            #             }
            #             if extracted_chat_messages["input_message"] or extracted_chat_messages["output_message"]:
            #                 break  # Found messages, stop searching

            # Clean spans
            if "spans" in trace_details and isinstance(trace_details["spans"], list):
                formatted_spans = []
                for span in trace_details["spans"]:
                    clean_attrs = span.get("SpanAttributes", {}).copy()
                    clean_attrs.pop("input", None)
                    clean_attrs.pop("output", None)
                    clean_attrs.pop("llm_output", None)

                    clean_events_attrs = []
                    for attr in span.get("Events.Attributes", []):
                        clean_attr = attr.copy()
                        clean_attr.pop("query", None)
                        clean_events_attrs.append(clean_attr)

                    formatted_span = {
                        "SpanName": span.get("SpanName", ""),
                        "SpanAttributes": clean_attrs,
                        "Events.Name": span.get("Events.Name", []),
                        "Events.Attributes": clean_events_attrs
                    }
                    formatted_spans.append(formatted_span)

                trace_details["spans"] = formatted_spans

        except requests.exceptions.RequestException as e:
            raise ApiError(f"Error calling trace detail endpoint: {str(e)}", 
                        e, getattr(e.response, 'status_code', 500))

        # Use extracted chat messages first, fallback to database query if not found
        chat_messages = self.get_chat_messages(request_id, user_type, selected_project)

        real_time_logs = []
        try:
            event_id = self._get_event_id_from_logs(request_id,selected_project)
            find_op = {
                'type': 'find_one',
                'filter': {"event_id": event_id}
            }

            tracking_doc = self.chatbot_agent._query_db(
                'chatbot_tracking',  
                find_op,
                user_type=user_type
            )

            if tracking_doc and isinstance(tracking_doc, dict):
                real_time_logs = tracking_doc.get("real_time_logs", [])

        except Exception as e:
            print(f"Error retrieving real-time logs: {e}")
            
        trace_details_utc = self._convert_trace_timestamps_to_utc(trace_details)
 
        return buildResponse(
            "Trace details fetched successfully",
            {
                **trace_details_utc,
                'chat_messages': chat_messages,
                'real_time_logs': real_time_logs
            },
            200
        )
    
    
    
    def extract_and_parse_json(self, raw_str: str):
        if not raw_str.strip():
            return None

        # Step 1: Remove common markdown fences / wrappers
        cleaned = re.sub(r'^```(?:json)?\s*\n?', '', raw_str.strip(), flags=re.IGNORECASE)
        cleaned = re.sub(r'\n?```$', '', cleaned.strip())
        cleaned = cleaned.strip()

        # Step 2: Repair
        try:
            repaired_str = repair_json(cleaned)          # returns repaired JSON string
            parsed = json.loads(repaired_str)
            return parsed
        except Exception as e:
            # If repair_json itself fails badly or json.loads still can't handle it
            print("JSON repair / parse failed:", str(e))
            if hasattr(e, 'pos'):
                pos = e.pos
                snippet = cleaned[max(0, pos-60):pos+60]
                print("Around error position:", snippet)
            
            return {
                "error": "JSON parse failed after repair",
                "detail": str(e),
                "raw_snippet": raw_str[:400] + "..." if len(raw_str) > 400 else raw_str
            }
        
    def get_agent_execution_context(self,query,start_date,end_date,user_id,session_id,agent_id,api_key,api_url):
        
        # message = f"""Give json response for our insight on incident management based on the data ingested into the system in particular date range {start_date} to {end_date}."""
        session_unique_id = str(uuid.uuid4())
        payload = {
            "user_id": user_id,
            "agent_id": agent_id,
            "session_id": session_unique_id,
            "message": query
        }
        headers = {
                "x-api-key": api_key,
                "Content-Type": "application/json"
            }
            
        try:
            response = requests.post(api_url, json=payload, headers=headers)
            response.raise_for_status()
            return response.json() if response.headers.get('Content-Type') == 'application/json' else response.text

        except Exception as e:
            print(f"Agent Execution Error: {e}")
            return None



    

    @require_session
    def get_all_analytics(self):
        req_data = request.json
        start_date = req_data.get('start_date')
        end_date   = req_data.get('end_date')

        if not start_date or not end_date:
            return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

        # Parse dates (assuming ISO format with possible Z)
        try:
            start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
            end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
        except Exception as e:
            return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

        api_url,api_key, user_id, agent_id, session_id = config_loader.get_insight_agent_details()
        # agent_id  = "6970af901d92f5e2dd229ce6"
        # session_id = "6970af901d92f5e2dd229ce6-nwr7whgitup"
        # api_key   = "sk-default-GwgqWJY0Ow1eRfLyoQGg5spTiR0CzYeo"
        # user_id   = "psramu03@gmail.com"
        # agent_id  = "696f758bb50537828e0b1ad0"
        # session_id = "696f758bb50537828e0b1ad0-hgwbis2a7ru"
        # api_key   = "sk-default-k6X5y4G76crcjmc7FzWmyQ3qYkXiB90f"
        # user_id   = "meena.rahulmalu@movate.com"

        # ── Agent-based queries (always run) ─────────────────────────────────────
        base_phrase = f"from {start} to {end}"

        queries = [
            f"Top 10 application impacted {base_phrase}",
            f"Top 10 Issues Reported {base_phrase}",
            f"Top 10 Infrastructure Systems Impacted {base_phrase}",
            f"Trend analysis for incidents grouped by application {base_phrase}",
            f"Top 10 Root Causes {base_phrase}",
            "top resolutions",

        ]

        def run_single_query(q: str) -> Dict:
            try:
                print("Running agent query:", q)
                agent_result = self.get_agent_execution_context(
                    query=q,
                    start_date=start_date,
                    end_date=end_date,
                    user_id=user_id,
                    session_id=session_id,
                    agent_id=agent_id,
                    api_key=api_key,
                    api_url=api_url
                )
                raw = agent_result.get('response', '')
                print("res",raw)
                parsed = self.extract_and_parse_json(raw)
                print(f"Query completed: {q[:60]}...")
                return parsed
            except Exception as exc:
                return {
                    "error": str(exc),
                    "query": q,
                    "status": "failed"
                }

        # Run agent queries concurrently
        results: List[Dict] = [None] * len(queries)
        max_workers = min(6, len(queries))

        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_idx = {
                executor.submit(run_single_query, query): i
                for i, query in enumerate(queries)
            }
            for future in concurrent.futures.as_completed(future_to_idx):
                idx = future_to_idx[future]
                results[idx] = future.result()

        # Build agent response structure
        combined: Dict[str, Any] = {
            "overview": {
                "title": "Full Incident Overview",
                "date_range": f"{start_date} – {end_date}",
                "generated_at": datetime.now().isoformat(timespec='seconds'),
                "timezone": "Asia/Kolkata"
            },
            "top_10_applications":     results[0],
            "top_10_issues":           results[1],
            "top_10_infrastructure_systems": results[2],
            "trend_by_application":    results[3],
            "Top 10 Root Causes":      results[4],
            "Top 10 Resolutions":        results[5],
            "errors": []
        }

        # Collect errors
        for i, res in enumerate(results):
            if isinstance(res, dict) and "error" in res:
                combined["errors"].append({
                    "query": queries[i],
                    "error_message": res["error"]
                })

        # ── OpenSearch part ── only if client exists and is reachable ─────────────
        opensearch_part = {
            "meta": {
                "start_date": start,
                "end_date": end,
                "total_incidents": 0,
                "note": "OpenSearch unavailable"
            },
            "kpis": {
                "avg_incidents_per_day": 0,
                "sla_compliance_pct": 0,
                "recurring_issue_pct": 0,
                "similar_incidents": [],
                "avg_mttr": "N/A"
            },
            "analytics": {
                "status": [], "priority": [], "severity": [], "category": []
            }
        }

        if self.client is not None:
            try:
                if not self.client.ping():
                    print("OpenSearch ping failed → skipping OpenSearch query")
                else:
                    print("Executing OpenSearch Query on index:", self.INDEX_NAME)

                    query_body = {
                        "size": 0, 
                        "query": {
                            "range": {
                                "created_at": {
                                    "gte": start,
                                    "lte": end
                                }
                            }
                        },
                        "aggs": {
                            # KPIs
                            "daily_trend": {
                                "date_histogram": {
                                    "field": "created_at",
                                    "calendar_interval": "day"
                                }
                            },
                            "sla_stats": {
                                "terms": {"field": "is_sla_met"}
                            },
                            # 5. Average MTTR (Mean Time To Resolve)
                            # Option A: If you have a pre-calculated field (Recommended)
                            "avg_mttr_calc": {
                                "avg": {"field": "mttr_seconds"}
                            },
                            
                            # --- NEW: Similar Incidents (Grouping by Title) ---
                            "similar_grouping": {
                                "terms": {
                                    "field": "title.keyword",  # Exact match on Short Description
                                    "size": 10,
                                    "min_doc_count": 2         # Must appear at least twice to be 'similar'
                                }
                            },
                            "recurring_issues": {
                                "terms": {
                                    "field": "issue_key",
                                    "size": 100,
                                    "min_doc_count": 2 
                                }
                            },
                            # Charts
                            "group_by_status": {"terms": {"field": "status", "size": 20}},
                            "group_by_priority": {"terms": {"field": "priority", "size": 20}},
                            "group_by_severity": {"terms": {"field": "severity", "size": 20}},
                            "group_by_category": {"terms": {"field": "category", "size": 20}}
                        }
                    }

                    res = self.client.search(index=self.INDEX_NAME, body=query_body)
                    print("OpenSearch Query Executed.", res)
                    total_docs = res['hits']['total']['value']
                    aggs = res['aggregations']

                    # --- KPI Calculations ---
                    
                    # Avg Incidents/Day
                    num_days = len(aggs['daily_trend']['buckets'])
                    avg_per_day = round(total_docs / num_days, 2) if num_days > 0 else 0

                    # SLA %
                    sla_true_bucket = next((b for b in aggs['sla_stats']['buckets'] if b['key_as_string'] == 'true'), None)
                    sla_true_count = sla_true_bucket['doc_count'] if sla_true_bucket else 0
                    sla_pct = round((sla_true_count / total_docs * 100), 2) if total_docs > 0 else 0

                    # Recurring %
                    recurring_count = sum(b['doc_count'] for b in aggs['recurring_issues']['buckets'])
                    recurring_pct = round((recurring_count / total_docs * 100), 2) if total_docs > 0 else 0

                    avg_mttr_seconds = aggs['avg_mttr_calc']['value']
                    mttr_display = "N/A"
                    if avg_mttr_seconds:
                        # Convert seconds to Hours or Minutes
                        hours = int(avg_mttr_seconds // 3600)
                        minutes = int((avg_mttr_seconds % 3600) // 60)
                        mttr_display = f"{hours}h {minutes}m"

                    # 2. Similar Incidents List
                    similar_incidents_data = []
                    for bucket in aggs['similar_grouping']['buckets']:
                        similar_incidents_data.append({
                            "title": bucket['key'],
                            "count": bucket['doc_count']
                        })

                    # --- Formatter ---
                    def format_buckets(bucket_list):
                        data = []
                        for b in bucket_list:
                            pct = (b['doc_count'] / total_docs * 100) if total_docs > 0 else 0
                            data.append({
                                "label": b['key'],
                                "count": b['doc_count'],
                                "percentage": round(pct, 1)
                            })
                        return data

                    opensearch_part = {
                        "meta": {
                            "start_date": start_date,
                            "end_date": end_date,
                            "total_incidents": total_docs
                        },
                        "kpis": {
                            "avg_incidents_per_day": avg_per_day,
                            "sla_compliance_pct": sla_pct,
                            "recurring_issue_pct": recurring_pct,
                            "similar_incidents":similar_incidents_data,
                            "avg_mttr": mttr_display
                        },
                        "analytics": {
                            "status": format_buckets(aggs['group_by_status']['buckets']),
                            "priority": format_buckets(aggs['group_by_priority']['buckets']),
                            "severity": format_buckets(aggs['group_by_severity']['buckets']),
                            "category": format_buckets(aggs['group_by_category']['buckets'])
                        }
                    }


            except Exception as e:
                print(f"OpenSearch failed: {type(e).__name__}: {str(e)} → using agent data only")

        # ── Final response ───────────────────────────────────────────────────────
        response = {
            **opensearch_part,
            "agent_execution": combined
        }

        return buildResponse("success", response, 200)
        
    # api for KPI's and analytics graph in insights page 
    # def sanitize_data(self, data):
        # """Recursively replaces '∞' with None or a large number."""
        # if isinstance(data, dict):
            # return {k: self.sanitize_data(v) for k, v in data.items()}
        # elif isinstance(data, list):
            # return [self.sanitize_data(i) for i in data]
        # elif data == '∞':
            # return None  # Or use a large number like 999999
        # return data
        
    

    def sanitize_data(self, data):
        """Recursively replaces '∞' with None and fixes date formatting for OpenSearch."""
        if isinstance(data, dict):
            return {k: self.sanitize_data(v) for k, v in data.items()}
        elif isinstance(data, list):
            return [self.sanitize_data(i) for i in data]
        elif isinstance(data, str):
            if data == '∞':
                return None
            
            # Check if the string matches 'YYYY-MM-DD HH:MM:SS'
            # OpenSearch prefers 'YYYY-MM-DDTHH:MM:SS' (ISO 8601)
            date_pattern = r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$'
            if re.match(date_pattern, data):
                return data.replace(" ", "T")
                
        return data
    
     
    def format_dates_iso(self, data):
        """Recursively find and convert dd-MMM-yy strings to YYYY-MM-DD."""
        if isinstance(data, dict):
            return {k: self.format_dates_iso(v) for k, v in data.items()}
        elif isinstance(data, list):
            return [self.format_dates_iso(i) for i in data]
        elif isinstance(data, str):
            # Regex to catch '24-Sep-25' or '4-Sep-25'
            if re.match(r'^\d{1,2}-[A-Za-z]{3}-\d{2}$', data):
                try:
                    # Convert '24-Sep-25' to '2025-09-24'
                    return datetime.strptime(data, '%d-%b-%y').strftime('%Y-%m-%d')
                except:
                    return data
        return data
    
    
    def sanitize_keys(self, data):
        """Recursively clean keys that start or end with a dot."""
        if isinstance(data, dict):
            new_dict = {}
            for k, v in data.items():
                # Remove leading/trailing dots and replace internal dots if necessary
                # or simply strip them to prevent the illegal_argument_exception
                clean_k = k.strip('.')
                new_dict[clean_k] = self.sanitize_keys(v)
            return new_dict
        elif isinstance(data, list):
            return [self.sanitize_keys(i) for i in data]
        else:
            return data
     

    def mapping_data(self, obj):
        """
        Recursively finds 'suggested_test_count_estimate' and ensures it is an int.
        Modifies in place AND returns the object.
        """
        if isinstance(obj, dict):
            for k, v in list(obj.items()):
                # Check if this is the problematic key
                if k == "suggested_test_count_estimate":
                    if isinstance(v, str):
                        # Extract only digits (e.g., "6-8" -> 6)
                        match = re.search(r'\d+', v)
                        if match:
                            obj[k] = int(match.group())
                        else:
                            # If it's a string like "None" or "Unknown", remove it
                            del obj[k]
                    elif v is None:
                        del obj[k]
                    # If it's already an int, we leave it alone
                
                # ALWAYS recurse into the value if it's a dict or list 
                # (Remove the 'else' so we check every single key)
                if isinstance(v, (dict, list)):
                    self.mapping_data(v)

        elif isinstance(obj, list):
            for item in obj:
                self.mapping_data(item)
                
        return obj
                
    def store_kpi_history(self, run_id, page_name, entity,start, end, agent_name, index_name, **response):
        if self.client is None:
            return None
        if self.Is_UAT :
            entity = entity.lower().strip() if entity else "incident"
            if page_name == "insights":
                index_names = f"{entity}_history_insights_prod"
                
            else:
                index_names = f"{entity}_history_trend_prod"
        else:
            entity = entity.lower().strip() if entity else "incident"
            if page_name == "insights":
                index_names = f"{entity}_history_insights"
                
            else:
                index_names = f"{entity}_history_trend"
        
            
        
       
        # 1. Sanitize the incoming data
        clean_response = self.sanitize_data(response)
        clean_response = self.format_dates_iso(clean_response)
        clean_response = self.sanitize_keys(clean_response)
        clean_response = self.mapping_data(clean_response)
       
        # 2. Prepare the new data chunk
        doc = {
            "@timestamp": datetime.utcnow().isoformat(),
            "run_id": run_id,
            "entity": entity,
            "start": start,
            "end": end,
            "agent_name": agent_name,
            "index_name": index_name,
            **clean_response,
        }

        index_body = {
            "settings": {
                "index": {
                    "knn": True,
                    "refresh_interval": "1s",
                    "number_of_replicas": 0
                }
            },
            "mappings": {
                "date_detection": False,  # Disable automatic date guessing
                "dynamic_templates": [
                    {
                        # FORCE all strings in the response to be keywords.
                        # This prevents impossible dates (like Feb 29) from crashing the ingest.
                        "strings_as_keywords": {
                            "match_mapping_type": "string",
                            "mapping": {
                                "type": "keyword",
                                "ignore_above": 32766
                            }
                        }
                    }
                ],
                "properties": {
                    # Only define the specific fields you actually need to use as Dates
                    "@timestamp": {"type": "date"},
                    "start": {"type": "date"},
                    "end": {"type": "date"},
                    
                    # Metadata as keywords
                    "run_id": {"type": "keyword"},
                    "entity": {"type": "keyword"},
                    "agent_name": {"type": "keyword"},
                    "index_name": {"type": "keyword"},
                    
                    # KNN Vector
                    "combined_vector": {
                        "type": "knn_vector",
                        "dimension": 384,
                        "method": {"name": "hnsw", "engine": "lucene", "space_type": "l2"}
                    }
                }
            }
        }

        max_retries = 3
        for attempt in range(max_retries):
            try:
                try:
                    self.client.indices.put_settings(
                        index=index_names,
                        body={"index.mapping.total_fields.limit": 5000}
                    )
                except Exception:
                    pass # If index doesn't exist yet, this will fail silently and that's okay
                    
                # 3. CREATE INDEX SAFELY (Handles the 6 API concurrency clash)
                if not self.client.indices.exists(index=index_names):
                    try:
                        self.client.indices.create(index=index_names, body=index_body)
                    except Exception as idx_err:
                        # If another API created it a millisecond ago, ignore the error and proceed safely!
                        if "resource_already_exists_exception" in str(idx_err):
                            pass
                        else:
                            raise idx_err 
                
                # 4. SILENTLY CLEAN UP OLD RUNS (Background task, non-blocking)
                try:
                    # self.client.delete_by_query(
                        # index=index_names,
                        # body={
                            # "query": {
                                # "bool": {
                                    # "must_not": {"term": {"run_id": run_id}}
                                # }
                            # }
                        # },
                        # conflicts="proceed",       # Ignore conflicts if 6 APIs trigger this
                        # wait_for_completion=False, # Let it run in the background without freezing the API
                        # request_timeout=10
                    # )
                    self.client.delete_by_query(
                        index=index_names,
                        body={
                            "query": {
                                "bool": {
                                    "must": [
                                        {"term": {"index_name.keyword": index_name}},   # must match this index_name
                                        {"must_not": {"term": {"run_id": run_id}}}      # but NOT this run_id
                                    ]
                                }
                            }
                        },
                        conflicts="proceed",
                        wait_for_completion=False,
                        slices="auto",           # parallel delete for better performance
                        request_timeout=30
                    )
                except Exception:
                    pass # Ignore background delete errors so API succeeds

                # 5. NATIVE UPSERT MERGE
                # retry_on_conflict=10 queues up the 6 concurrent APIs so they don't overwrite/crash each other
                self.client.update(
                    index=index_names,
                    id=run_id,
                    body={
                        "doc": doc,
                        "doc_as_upsert": True
                    },
                    retry_on_conflict=10, 
                    request_timeout=60,
                    refresh=True
                )
               
                print(f" Successfully merged API data into run_id: {run_id}")
                return run_id 
               
            except Exception as e:
                print(f" Attempt {attempt + 1}/{max_retries} failed for run_id {run_id}: {str(e)}")
                
                # Wait 2 seconds before trying again so the 6 APIs clear their traffic jam
                if attempt < max_retries - 1:
                    time.sleep(2)
                else:
                    print(f" FINAL FAILURE: Could not store data for run_id {run_id}. Check OpenSearch Disk Space.")
           
        return run_id
    
    @require_session
    def get_insights_history(self):
        """
        Returns the latest consolidated history for the requested entity.
        Because we use doc_as_upsert in storage, this single document 
        contains all merged data (KPIs, Applications, Infrastructure, etc.) 
        for the most recent run.
        """
        try:
            # 1. Parse request data
            req_data = request.json or {}
            entity = req_data.get('entity', 'incident').lower().strip()
            page_name = req_data.get('page_name', 'insight')
            if self.Is_UAT :
                entity = entity.lower().strip() if entity else "incident"
                if page_name == "insights":
                    index_names = f"{entity}_history_insights_prod"
                    
                else:
                    index_names = f"{entity}_history_trend_prod"
            else:
                entity = entity.lower().strip() if entity else "incident"
                if page_name == "insights":
                    index_names = f"{entity}_history_insights"
                    
                else:
                    index_names = f"{entity}_history_trend"
                


            # 2. Check if client is initialized
            if self.client is None:
                return jsonify({"error": "OpenSearch client not initialized"}), 500

            # 3. Check if the index exists at all
            if not self.client.indices.exists(index=index_names):
                return buildResponse("success", {
                    "message": f"No history index found for entity: {entity}",
                    "entity": entity,
                    "history": None
                }, 200)

            # 4. Fetch the most recent document
            # We sort by @timestamp descending and take size: 1 to get the latest run
            

            res = self.client.search(index=index_names)
            hits = res['hits']['hits']
            

            # 5. Handle case where index exists but is empty
            if not hits:
                return buildResponse("success", {
                    "message": f"No history records found for entity: {entity}",
                    "entity": entity,
                    "history": None
                }, 200)

            # 6. Extract the document source
            # This will contain: run_id, kpis, top_10_applications, top_10_infrastructure_systems, etc.
            data = hits[0]['_source']
            
            # Ensure run_id is included (it's stored as the document ID)
            # if "run_id" not in data:
                # data["run_id"] = hits[0].get("_id")

            # 7. Return the consolidated response
            return buildResponse("success", data, 200)

        except Exception as e:
            print(f"Error fetching history for {entity}: {str(e)}")
            return jsonify({"error": f"Failed to fetch history: {str(e)}"}), 500
     
    @require_session
    def get_insights_history_by_index(self):
        
        try:
            # 1. Parse request data
            req_data = request.json or {}
            entity = req_data.get('entity', 'incident').lower().strip()
            page_name = req_data.get('page_name', 'insight')
            index = req_data.get('index', '').strip()
            if self.Is_UAT :
                entity = entity.lower().strip() if entity else "incident"
                if page_name == "insights":
                    index_names = f"{entity}_history_insights_prod"
                    
                else:
                    index_names = f"{entity}_history_trend_prod"
            else:
                entity = entity.lower().strip() if entity else "incident"
                if page_name == "insights":
                    index_names = f"{entity}_history_insights"
                    
                else:
                    index_names = f"{entity}_history_trend"

            # 2. Check if client is initialized
            if self.client is None:
                return jsonify({"error": "OpenSearch client not initialized"}), 500

            # 3. Check if the index exists at all
            if not self.client.indices.exists(index=index_names):
                return buildResponse("success", {
                    "message": f"No history index found for entity: {entity}",
                    "entity": entity,
                    "history": None
                }, 200)

            # 4. Fetch the most recent document
            # We sort by @timestamp descending and take size: 1 to get the latest run
            

            res = self.client.search(
                index=index_names,
                body={
                    "size": 1,
                    "query": {
                        "bool": {
                            "should": [
                                {"term": {"index_name.keyword": index}},   # preferred
                                {"term": {"index_name": index}}            # fallback
                            ],
                            "minimum_should_match": 1
                        }
                    },
                    "_source": True
                }
            )
            hits = res['hits']['hits']
            

            # 5. Handle case where index exists but is empty
            if not hits:
                return buildResponse("success", {
                    "message": f"No history records found for entity: {entity}",
                    "entity": entity,
                    "history": None
                }, 200)

            # 6. Extract the document source
            # This will contain: run_id, kpis, top_10_applications, top_10_infrastructure_systems, etc.
            data = hits[0]['_source']
            
            # Ensure run_id is included (it's stored as the document ID)
            # if "run_id" not in data:
                # data["run_id"] = hits[0].get("_id")

            # 7. Return the consolidated response
            return buildResponse("success", data, 200)

        except Exception as e:
            print(f"Error fetching history for {entity}: {str(e)}")
            return jsonify({"error": f"Failed to fetch history: {str(e)}"}), 500
    
         
    @require_session
    def get_kpis(self):
        req_data = request.json
        start_date = req_data.get('start_date')
        end_date   = req_data.get('end_date')
        run_id = req_data.get('run_id',"") 
        index_name = req_data.get('index_name','')
        entity = req_data.get('entity','')
        page_name= req_data.get('page_name',"")
        print("index",index_name)

        if not start_date or not end_date:
            return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

        # Parse dates (assuming ISO format with possible Z)
        try:
            start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
            end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
        except Exception as e:
            return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

        # ── OpenSearch part ── only if client exists and is reachable ─────────────
        print("start",start)
        print("end",end)
        
        if entity == 'defect':
            opensearch_part = {
            "meta": {
                "start_date": start,
                "end_date": end,
                "total_defects": 0,
                "note": "OpenSearch unavailable"
            },
            "kpis": {
                "avg_defects_per_day": 0,
                
                "similar_defects": [],
                "avg_mttr": "N/A"
            },
            "analytics": {
                "status": [], "priority": [], "severity": [], "category": []
            }
            
        }
        elif entity == 'testcase':
            opensearch_part = {
            "meta": {
                "start_date": start,
                "end_date": end,
                "total_testcase": 0,
                "note": "OpenSearch unavailable"
            },
            "kpis": {
                "avg_testcase_per_day": 0,
                "sla_compliance_pct": 0,
                "recurring_issue_pct": 0,
                "similar_testcase": [],
                "avg_mttr": "N/A"
            },
            "analytics": {
                "status": [], "priority": [], "severity": [], "category": []
            }
            
        }
        
        else:
            result = {
                "periods": [],
                "weekdays": [],
                "weekends": [],
                "business_hours": [],
                "off_hours": [],
                "details": {}
            }
            opensearch_part = {
            "meta": {
                "start_date": start,
                "end_date": end,
                "total_incidents": 0,
                "note": "OpenSearch unavailable"
            },
            "kpis": {
                "avg_incidents_per_day": 0,
                "sla_compliance_pct": 0,
                "recurring_issue_pct": 0,
                "similar_incidents": [],
                "avg_mttr": "N/A"
            },
            "analytics": {
                "status": [], "priority": [], "severity": [], "category": []
            },
            "trends":{
                "incident_trends":result
                
            }
        }
        
        
        
        

        if self.client is not None:
            try:
                if not self.client.ping():
                    print("OpenSearch ping failed → skipping OpenSearch query")
                else:
                    print("Executing OpenSearch Query on index:", index_name)

                    query_body = {
                        "size": 6000, 
                        "query": {
                            "range": {
                                "created_at": {
                                    "gte": start,
                                    "lte": end
                                }
                            }
                        },
                        "_source": [
                    "id",           # use this only if you stored a custom "id" field
                    "title",
                    "status",
                    "priority",
                    "severity",
                    "created_at",
                    "created",
                    "category",
                    "description",
                    "execution_count",
                    "failure_count"
                    
                ],
                        "aggs": {
                            # KPIs
                            "daily_trend": {
                                "date_histogram": {
                                    "field": "created_at",
                                    "calendar_interval": "day"
                                }
                            },
                            "sla_stats": {
                                "terms": {"field": "is_sla_met"}
                            },
                            # 5. Average MTTR (Mean Time To Resolve)
                            # Option A: If you have a pre-calculated field (Recommended)
                            "avg_mttr_calc": {
                                "avg": {"field": "mttr_seconds"}
                            },
                            
                            # --- NEW: Similar Incidents (Grouping by Title) ---
                            "similar_grouping": {
                                "terms": {
                                    "field": "title.keyword",  # Exact match on Short Description
                                    "size": 10,
                                    "min_doc_count": 2         # Must appear at least twice to be 'similar'
                                }
                            },
                            "recurring_issues": {
                                "terms": {
                                    "field": "issue_key",
                                    "size": 100,
                                    "min_doc_count": 2 
                                }
                            },
                            # Charts
                            "group_by_status": {"terms": {"field": "status", "size": 20}},
                            "group_by_priority": {"terms": {"field": "priority", "size": 20}},
                            "group_by_severity": {"terms": {"field": "severity", "size": 20}},
                            "group_by_category": {"terms": {"field": "category", "size": 20}}
                        }
                    }

                    res = self.client.search(index=index_name, body=query_body)
                    print("OpenSearch Query Executed.", res)
                    total_docs = res['hits']['total']['value']
                    print("total",total_docs)
                    aggs = res['aggregations']
                    hits = res['hits']['hits']
                    
                    

                    # --- KPI Calculations ---
                    
                    # Avg Incidents/Day
                    num_days = len(aggs['daily_trend']['buckets'])
                    avg_per_day = round(total_docs / num_days, 2) if num_days > 0 else 0

                    # SLA %
                    sla_true_bucket = next((b for b in aggs['sla_stats']['buckets'] if b['key_as_string'] == 'true'), None)
                    sla_true_count = sla_true_bucket['doc_count'] if sla_true_bucket else 0
                    sla_pct = round((sla_true_count / total_docs * 100), 2) if total_docs > 0 else 0

                    # Recurring %
                    recurring_count = sum(b['doc_count'] for b in aggs['recurring_issues']['buckets'])
                    recurring_pct = round((recurring_count / total_docs * 100), 2) if total_docs > 0 else 0

                    avg_mttr_seconds = aggs['avg_mttr_calc']['value']
                    mttr_display = "N/A"
                    if avg_mttr_seconds:
                        # Convert seconds to Hours or Minutes
                        hours = int(avg_mttr_seconds // 3600)
                        minutes = int((avg_mttr_seconds % 3600) // 60)
                        mttr_display = f"{hours}h {minutes}m"

                    # 2. Similar Incidents List
                    similar_incidents_data = []
                    for bucket in aggs['similar_grouping']['buckets']:
                        similar_incidents_data.append({
                            "title": bucket['key'],
                            "count": bucket['doc_count']
                        })

                    # --- Formatter ---
                    def format_buckets(bucket_list):
                        data = []
                        for b in bucket_list:
                            pct = (b['doc_count'] / total_docs * 100) if total_docs > 0 else 0
                            data.append({
                                "label": b['key'],
                                "count": b['doc_count'],
                                "percentage": round(pct, 1)
                            })
                        return data
                        
                    all_records = []
                    for hit in hits:
                        src = hit.get('_source', {})
                        record = {
                            "id": hit.get('_id'),  # document ID (most reliable)
                            # "id": src.get("id"), # ← use this line instead if you store custom "id" field
                            "title": src.get("title", ""),
                            "status": src.get("status", ""),
                            "priority": src.get("priority", ""),
                            "severity": src.get("severity", ""),
                            "created_at": src.get("created_at", ""),
                            "created": src.get("created", ""),
                            "category": src.get("category", ""),
                            "description": src.get("description",""),
                            "execution_count":src.get("execution_count",""),
                            "failure_count":src.get("failure_count","")
                        }
                        all_records.append(record)
                        
                    
                 
                    df = pd.DataFrame(all_records)
                    df['created'] = pd.to_datetime(df['created'], utc=True, errors='coerce')
                    # Optional but recommended: drop rows with invalid dates
                    df = df.dropna(subset=['created'])
                    
                    
                    print("dff",df["created"])
                    if entity == "defect":
                        # OPEN_STATUSES = {"Open", "New", "In Progress", "Assigned", "Reopened", "Under Review"}
                       
                        # df = df[df["status"].isin(OPEN_STATUSES)].copy()
                        

                        NOW = pd.Timestamp.utcnow()

                        BUCKETS = [
                            (0, 7,   "0-7d"),
                            (8, 14,  "8-14d"),
                            (15, 30, "15-30d"),
                            (31, 60, "31-60d"),
                            (61, 90, "61-90d"),
                            (91, None, ">90d"),
                        ]

                        df["age_days"] = (NOW - df["created"]).dt.days.clip(lower=0)  # avoid negative ages
                        df["age_bucket"] = df["age_days"].apply(
                            lambda age: next((label for lo, hi, label in BUCKETS
                                              if (hi is None and age >= lo) or (lo <= age <= hi)), ">90d")
                        )

                        states = sorted(df["status"].dropna().unique().tolist())
                        bucket_labels = [b[2] for b in BUCKETS]

                        # Counts & details directly from df
                        counts = {s: {b: 0 for b in bucket_labels} for s in states}
                        details_by_bucket_status = {b: {s: [] for s in states} for b in bucket_labels}

                        for _, row in df.iterrows():
                            if pd.isna(row["status"]) or pd.isna(row["age_bucket"]):
                                continue
                            b = row["age_bucket"]
                            s = row["status"]
                            counts[s][b] += 1

                            defect_detail = {
                                "id": row.get("id"),
                                "title": row.get("title"),
                                "priority": row.get("priority"),
                                "severity": row.get("severity"),
                                "category": row.get("category"),
                                "age_days": int(row["age_days"]) if not pd.isna(row["age_days"]) else None,
                                "created": row["created"].isoformat(timespec="seconds") if pd.notna(row["created"]) else None,
                                "status": s,
                            }
                            details_by_bucket_status[b][s].append(defect_detail)

                        # Build series for stacked bar
                        series = [
                            {"name": s, "data": [counts[s][b] for b in bucket_labels]}
                            for s in states
                        ]

                        # Drill-down friendly
                        series_with_custom = []
                        for s in states:
                            points = []
                            for b in bucket_labels:
                                defects = details_by_bucket_status[b][s]
                                points.append({
                                    "y": counts[s][b],
                                    "custom": {"bucket": b, "status": s, "defects": defects}
                                })
                            series_with_custom.append({"name": s, "data": points})

                        totals_by_bucket = [sum(counts[s][b] for s in states) for b in bucket_labels]

                        chart_json = {
                            "chart": {
                                "title": "Defect Age Distribution by Status",
                                "xAxis": {"categories": bucket_labels, "title": "Age Buckets"},
                                "yAxis": {"title": "Count"},
                                "stacking": "normal"
                            },
                            "series": series,
                            "seriesWithCustom": series_with_custom,           # ← most useful for drilldown
                            "totalsByBucket": totals_by_bucket,
                            "bucketDefinitions": [
                                {"label": label, "minDays": lo, "maxDays": hi or "∞"}
                                for lo, hi, label in BUCKETS
                            ],
                            "statusOrder": states,
                            "generatedOn": NOW.isoformat(),
                            "notes": "Age = current UTC time - created date"
                        }
                        
                    

                    # Add classification columns
                    classifications = df.apply(self.classify_incident, axis=1)
                    df = pd.concat([df, classifications], axis=1)
                   

                    # Determine if data spans a single month
                    df['month_period'] = df['created'].dt.to_period('M')
                    is_single_month = (df['month_period'].nunique() == 1)

                    if is_single_month:
                        # Weekly breakdown for the single month
                        df['day'] = df['created'].dt.day
                        df['week_num'] = ((df['day'] - 1) // 7) + 1
                        month_str = df['created'].dt.strftime('%b-%Y').iloc[0]
                        df['period'] = 'week' + df['week_num'].astype(str)
                        
                        # Get sorted unique periods by week_num
                        temp_df = df.groupby('period')['week_num'].min().reset_index().sort_values('week_num')
                        periods = temp_df['period'].tolist()
                    else:
                        # Monthly breakdown with chronological sort and lowercase
                        df['period'] = df['created'].dt.strftime('%b-%Y')
                        periods = sorted(df['period'].unique(), key=lambda x: pd.to_datetime(x, format='%b-%Y'))

                    # Aggregate counts per period
                    agg = df.groupby('period').agg({
                        'is_weekday': 'sum',
                        'is_weekend': 'sum',
                        'is_business_hour': 'sum',
                        'is_off_hour': 'sum'
                    }).reindex(periods, fill_value=0)

                    agg = agg.rename(columns={
                        'is_weekday': 'weekdays',
                        'is_weekend': 'weekends',
                        'is_business_hour': 'business_hours',
                        'is_off_hour': 'off_hours'
                    })

                    # Prepare details per period
                    details = {}

                    output_cols = ['id', 'title', 'priority', 'status', 'category', 'description', 'severity']

                    for period in periods:
                        period_df = df[df['period'] == period].copy()
                        if period_df.empty:
                            details[period] = {
                                'weekdays': [], 'weekends': [],
                                'business_hours': [], 'off_hours': []
                            }
                            continue

                        # Create JSON-safe timestamp
                        period_df['timestamp'] = period_df['created'].dt.strftime('%Y-%m-%dT%H:%M:%S')

                        # Extract selected fields + timestamp
                        extract_cols = output_cols + ['timestamp']

                        weekdays_list  = self.safe_extract(period_df, 'is_weekday',       extract_cols)
                        weekends_list  = self.safe_extract(period_df, 'is_weekend',       extract_cols)
                        business_list  = self.safe_extract(period_df, 'is_business_hour', extract_cols)
                        off_list       = self.safe_extract(period_df, 'is_off_hour',      extract_cols)

                        # Rename fields in each item
                        for lst in [weekdays_list, weekends_list, business_list, off_list]:
                            for item in lst:
                                if 'record_id' in item:
                                    item['id'] = item.pop('record_id')
                                    
                                
                                    
                                if 'timestamp' in item:
                                    item['created_at'] = item.pop('timestamp')
                                    
                                if 'severity' in item:
                                    # Convert to string to safely handle float(nan)
                                    s_val = str(item['severity']).strip()
                                    if not s_val or s_val.lower() == 'nan':
                                        item['severity'] = ""
                                    else:
                                        item['severity'] = s_val
                                    
                                if 'priority' in item:
                                    # Convert to string to safely handle float(nan)
                                    p_val = str(item['priority']).strip()
                                    if not p_val or p_val.lower() == 'nan':
                                        item['priority'] = ""
                                    else:
                                        item['priority'] = p_val

                        details[period] = {
                            'weekdays': weekdays_list,
                            'weekends': weekends_list,
                            'business_hours': business_list,
                            'off_hours': off_list
                        }

                    # Final structure
                    result = {
                        "periods": periods,                             # e.g., ["dec-2025", "jan-2026", "feb-2026"] or ["jan-2026-w1", "jan-2026-w2", ...]
                        "weekdays": agg['weekdays'].astype(int).tolist(),
                        "weekends": agg['weekends'].astype(int).tolist(),
                        "business_hours": agg['business_hours'].astype(int).tolist(),
                        "off_hours": agg['off_hours'].astype(int).tolist(),
                        "details": details
                    }
                    
                    if entity == 'defect':
                        opensearch_part = {
                        "meta": {
                            "start_date": start_date,
                            "end_date": end_date,
                            "total_defects": total_docs
                        },
                        "kpis": {
                            "avg_defects_per_day": avg_per_day,
                            
                          
                            "similar_defects":similar_incidents_data,
                            "avg_mttr": mttr_display
                        },
                        "analytics": {
                            "status": format_buckets(aggs['group_by_status']['buckets']),
                            "priority": format_buckets(aggs['group_by_priority']['buckets']),
                            "severity": format_buckets(aggs['group_by_severity']['buckets']),
                            "category": format_buckets(aggs['group_by_category']['buckets']),
                            "all_records": all_records
                        },
                        "defect_age":chart_json
                        
                        }
                        self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity, start=start, end=end, agent_name="", index_name=index_name, kpis=opensearch_part)
                    
                    
                    elif entity == 'testcase':
                        opensearch_part = {
                        "meta": {
                            "start_date": start_date,
                            "end_date": end_date,
                            "total_testcase": total_docs
                        },
                        "kpis": {
                            "avg_testcase_per_day": avg_per_day,
                            
                            
                            "similar_testcase":similar_incidents_data,
                            
                        },
                        "analytics": {
                            "status": format_buckets(aggs['group_by_status']['buckets']),
                            "priority": format_buckets(aggs['group_by_priority']['buckets']),
                            "severity": format_buckets(aggs['group_by_severity']['buckets']),
                            "category": format_buckets(aggs['group_by_category']['buckets']),
                            "all_records": all_records
                        }
                        
                    }
                        self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity,start=start, end=end, agent_name="", index_name=index_name, kpis=opensearch_part)
                    
                    else:
                        opensearch_part = {
                        "meta": {
                            "start_date": start_date,
                            "end_date": end_date,
                            "total_incidents": total_docs
                        },
                        "kpis": {
                            "avg_incidents_per_day": avg_per_day,
                            "sla_compliance_pct": sla_pct,
                            "recurring_issue_pct": recurring_pct,
                            "similar_incidents":similar_incidents_data,
                            "avg_mttr": mttr_display
                        },
                        "analytics": {
                            "status": format_buckets(aggs['group_by_status']['buckets']),
                            "priority": format_buckets(aggs['group_by_priority']['buckets']),
                            "severity": format_buckets(aggs['group_by_severity']['buckets']),
                            "category": format_buckets(aggs['group_by_category']['buckets']),
                            "all_records": all_records
                        },
                        "trends":{
                            "incident_trends":result
                        
                        }
                        
                    }
                    
                        self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity,start=start, end=end, agent_name="", index_name=index_name, kpis=opensearch_part)

                    


            except Exception as e:
                print(f"OpenSearch failed: {type(e).__name__}: {str(e)} ")

        # ── Final response ───────────────────────────────────────────────────────
        response = {
            **opensearch_part
        }

        return buildResponse("success", response, 200)

    def classify_incident(self,row):
        dt = row['created']
        hour = dt.hour

        is_weekday = dt.weekday() < 5                  # Mon=0 ... Fri=4
        is_business_hour = (9 <= hour <= 16)           # 09:00 – 16:59

        return pd.Series({
            'is_weekday':       bool(is_weekday),
            'is_weekend':       bool(not is_weekday),
            'is_business_hour': bool(is_business_hour),
            'is_off_hour':      bool(not is_business_hour)
        })

    def safe_extract(self,df_subset, mask_col, cols):
        """Safely extract matching rows as list of dicts"""
        if df_subset.empty:
            return []
        mask = df_subset[mask_col].astype(bool)
        return df_subset.loc[mask, cols].to_dict('records')

    def get_insights_for_query(self,query,key,start_date,end_date,agent_id,index_name):
        try:
            # index_name="ind001"
            agent_data = self.agent_collection.find_one({"api_agent_id": agent_id,"isDeleted":{"$ne":True}}) if agent_id else None
            api_key = agent_data.get("agent_api_key") if agent_data else None
            session_id = agent_data.get("agent_session_id") if agent_data else None
            user_id = agent_data.get("user_id") if agent_data else None
            api_url = agent_data.get("agent_api_url") if agent_data else None
            agent_name = agent_data.get("name") if agent_data else None

            base_phrase = f"from {start_date} to {end_date}"
            last_phrase = f'for index "{index_name}"' if index_name else ""
            # if query in ["top resolutions", "inferences from data","most common root causes","automation opportunities"]:
                # final_query = f"{query} {last_phrase}"
                
            # else:
            final_query = f"{query} {base_phrase} {last_phrase}"
                
           
            # api_url,api_key, user_id, agent_id, session_id = config_loader.get_insight_agent_details()
            print("Running agent query:", final_query)
            agent_result = self.get_agent_execution_context(
                query=final_query,
                start_date=start_date,
                end_date=end_date,
                user_id=user_id,
                session_id=session_id,
                agent_id=agent_id,
                api_key=api_key,
                api_url=api_url
            )
            raw = agent_result.get('response', '')
            print("res",raw)
            parsed = self.extract_and_parse_json(raw)
            # if query == "Trend analysis for incidents grouped by application":
                # parsed = [parsed]
            if isinstance(parsed, dict) and "error" in parsed:
                print(f"Error parsing JSON for query '{query}': {parsed['error']}")
                parsed=[]
            print(f"Query completed: {query[:60]}...")

            combined: Dict[str, Any] = {
                "overview": {
                    "title": "Full Incident Overview",
                    "date_range": f"{start_date} – {end_date}",
                    "generated_at": datetime.now().isoformat(timespec='seconds'),
                    "timezone": "Asia/Kolkata"
                },
                key: parsed,
                "errors": []
            }
            if isinstance(parsed, dict) and "error" in parsed:
                combined["errors"].append({
                    "query": query,
                    "error_message": parsed["error"]
                })


            response = {
                "agent_execution":combined
            }
            return response,agent_name
        except Exception as e:
            print(f"Error in get_insights_for_query: {str(e)}")
            return {
                "agent_execution": {
                    "errors": [{
                        "query": query,
                        "error_message": str(e)
                    }],
                    key:[]
                }
            }


     
    @require_session
    @daily_limit(limit_count=insight_limit)
    def call_agent_get_top_applications(self):
        try:
            req_data = request.json
            start_date = req_data.get('start_date')
            end_date   = req_data.get('end_date')
            index_name = req_data.get('index_name')
            agent_id = req_data.get('agent_id')
            entity = req_data.get('entity','')
            run_id = req_data.get('run_id',"")
            page_name= req_data.get('page_name',"")
            print("noo")
            

            if not start_date or not end_date:
                return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

            # Parse dates (assuming ISO format with possible Z)
            try:
                start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
                end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
            except Exception as e:
                return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

            # ── Agent-based queries (always run) ─────────────────────────────────────

            
            query = "Top 10 applications impacted"
            key = "top_10_applications"
                
            response,agent_name = self.get_insights_for_query(query, key, start_date, end_date,agent_id,index_name)
            
            self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity,start=start, end=end, agent_name=agent_name, index_name=index_name, key=response)
                
            

            return buildResponse("success", response, 200)
        except Exception as e:
            return jsonify({"error": f"Exception occurred: {str(e)}"}), 500

    @require_session
    @daily_limit(limit_count=insight_limit)
    def call_agent_get_top_infrastructure_systems(self):
        try:
            req_data = request.json
            start_date = req_data.get('start_date')
            end_date   = req_data.get('end_date')
            index_name = req_data.get('index_name')
            agent_id = req_data.get('agent_id')
            entity = req_data.get('entity')
            run_id = req_data.get('run_id',"")
            page_name= req_data.get('page_name',"")

            if not start_date or not end_date:
                return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

            # Parse dates (assuming ISO format with possible Z)
            try:
                start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
                end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
            except Exception as e:
                return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

            # ── Agent-based queries (always run) ─────────────────────────────────────
            
            
            query = "Top 10 Infrastructure Systems Impacted"
            key = "top_10_infrastructure_systems"
                
            response,agent_name = self.get_insights_for_query(query, key, start_date, end_date,agent_id,index_name)

            self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity,start=start, end=end, agent_name=agent_name, index_name=index_name, key=response)

            return buildResponse("success", response, 200)
        except Exception as e:
            return jsonify({"error": f"Exception occurred: {str(e)}"}), 500

    @require_session
    @daily_limit(limit_count=insight_limit)
    def call_agent_get_top_issues(self):
        try:
            req_data = request.json
            start_date = req_data.get('start_date')
            end_date   = req_data.get('end_date')
            index_name = req_data.get('index_name')
            agent_id = req_data.get('agent_id')
            entity = req_data.get('entity','')
            run_id = req_data.get('run_id',"")
            page_name= req_data.get('page_name',"")

            if not start_date or not end_date:
                return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

            # Parse dates (assuming ISO format with possible Z)
            try:
                start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
                end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
            except Exception as e:
                return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

            # ── Agent-based queries (always run) ─────────────────────────────────────
            
            query = "Top 10 Issues Reported"
            key = "top_10_issues"
                
            response,agent_name = self.get_insights_for_query(query, key, start_date, end_date,agent_id,index_name)

            self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity,start=start, end=end, agent_name=agent_name, index_name=index_name, key=response)

            return buildResponse("success", response, 200)
        except Exception as e:
            return jsonify({"error": f"Exception occurred: {str(e)}"}), 500

    @require_session
    @daily_limit(limit_count=insight_limit)
    def call_agent_get_trend_by_application(self):
        try:
            req_data = request.json
            start_date = req_data.get('start_date')
            end_date   = req_data.get('end_date')
            index_name = req_data.get('index_name')
            agent_id = req_data.get('agent_id')
            entity = req_data.get('entity')
            run_id = req_data.get('run_id',"")
            page_name= req_data.get('page_name',"")

            if not start_date or not end_date:
                return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

            # Parse dates (assuming ISO format with possible Z)
            try:
                start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
                end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
            except Exception as e:
                return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

            # ── Agent-based queries (always run) ─────────────────────────────────────
           
            response,agent_name = self.get_insights_for_query("Trend analysis for incidents grouped by application", "trend_by_application", start_date, end_date,agent_id,index_name)
            
            self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity,start=start, end=end, agent_name=agent_name, index_name=index_name, key=response)

            return buildResponse("success", response, 200)

        except Exception as e:
            return jsonify({"error": f"Exception occurred: {str(e)}"}), 500
            
    @require_session
    @daily_limit(limit_count=insight_limit)
    def call_agent_get_top_resolution_application(self):
        try:
            req_data = request.json
            start_date = req_data.get('start_date')
            end_date   = req_data.get('end_date')
            index_name = req_data.get('index_name')
            agent_id = req_data.get('agent_id')
            entity = req_data.get('entity','')
            run_id = req_data.get('run_id',"")
            page_name= req_data.get('page_name',"")

            if not start_date or not end_date:
                return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

            # Parse dates (assuming ISO format with possible Z)
            try:
                start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
                end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
            except Exception as e:
                return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

            # ── Agent-based queries (always run) ─────────────────────────────────────
            if entity == "defect":
                query = "Top 10 Resolutions"
                key = "Top 10 Resolutions"
                

            elif entity == "testcase":
                query = "Impacted Test Cases"
                key = "Impacted Test Cases"
                
                
            else:
                query = "top resolutions"
                key = "Top 10 Resolutions"
                
            response,agent_name = self.get_insights_for_query(query, key, start_date, end_date,agent_id,index_name)

            self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity,start=start, end=end, agent_name=agent_name, index_name=index_name, key=response)

            return buildResponse("success", response, 200)

        except Exception as e:
            return jsonify({"error": f"Exception occurred: {str(e)}"}), 500
            
            
    @require_session
    @daily_limit(limit_count=insight_limit)
    def call_agent_get_top_rootcause_application(self):
        try:
            req_data = request.json
            start_date = req_data.get('start_date')
            end_date   = req_data.get('end_date')
            index_name = req_data.get('index_name')
            agent_id = req_data.get('agent_id')
            entity = req_data.get('entity','')
            run_id = req_data.get('run_id',"")
            page_name= req_data.get('page_name',"")

            if not start_date or not end_date:
                return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

            # Parse dates (assuming ISO format with possible Z)
            try:
                start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
                end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
            except Exception as e:
                return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

            # ── Agent-based queries (always run) ─────────────────────────────────────
            if entity == "defect":
                query = "Top 10 Root Causes"
                key = "Top 10 Root Causes"
                

            elif entity == "testcase":
                query = "Impacted Test Cases"
                key = "Impacted Test Cases"
                
                
            else:
                query = "most common root causes"
                key = "Top 10 Root Causes"
                
            response,agent_name = self.get_insights_for_query(query, key, start_date, end_date,agent_id,index_name)

            self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity,start=start, end=end, agent_name=agent_name, index_name=index_name, key=response)

            return buildResponse("success", response, 200)

        except Exception as e:
            return jsonify({"error": f"Exception occurred: {str(e)}"}), 500
            
    
    @require_session
    @daily_limit(limit_count=insight_limit)
    def call_agent_get_ai_inference_application(self):
        try:
            req_data = request.json
            start_date = req_data.get('start_date')
            end_date   = req_data.get('end_date')
            index_name = req_data.get('index_name')
            agent_id = req_data.get('agent_id')
            entity = req_data.get('entity','')
            run_id = req_data.get('run_id',"")
            page_name= req_data.get('page_name',"")

            if not start_date or not end_date:
                return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

            # Parse dates (assuming ISO format with possible Z)
            try:
                start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
                end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
            except Exception as e:
                return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

            # ── Agent-based queries (always run) ─────────────────────────────────────
            if entity == "defect":
                query = "AI Inferences"
                key = "AI Inferences"
                

            elif entity == "testcase":
                query = "Impacted Test Cases"
                key = "Impacted Test Cases"
                
                
            else:
                query = "inferences from data"
                key = "AI Inferences"
                
            response,agent_name = self.get_insights_for_query(query, key, start_date, end_date,agent_id,index_name)

            self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity,start=start, end=end, agent_name=agent_name, index_name=index_name, key=response)

            return buildResponse("success", response, 200)

        except Exception as e:
            return jsonify({"error": f"Exception occurred: {str(e)}"}), 500
            
    @require_session
    @daily_limit(limit_count=insight_limit)
    def call_agent_get_potential_automation(self):
        try:
            req_data = request.json
            start_date = req_data.get('start_date')
            end_date   = req_data.get('end_date')
            index_name = req_data.get('index_name')
            agent_id = req_data.get('agent_id')
            entity = req_data.get('entity','')
            run_id = req_data.get('run_id',"")
            page_name= req_data.get('page_name',"")

            if not start_date or not end_date:
                return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

            # Parse dates (assuming ISO format with possible Z)
            try:
                start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
                end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
            except Exception as e:
                return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

            # ── Agent-based queries (always run) ─────────────────────────────────────
            
            if entity == "defect":
                print("yes")
                query = "potential regression scenarios"
                key = "Potential regression scenarios"
                
            elif entity == "testcase":
                print("yes1")
                query = "potential automation use cases"
                key = "Potential automation" 
                
            else:
                print("yes2")
                query = "automation opportunities"
                key = "Potential automation"
                
            response,agent_name = self.get_insights_for_query(query, key, start_date, end_date,agent_id,index_name)

            self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity,start=start, end=end, agent_name=agent_name, index_name=index_name, key=response)

            return buildResponse("success", response, 200)

        except Exception as e:
            return jsonify({"error": f"Exception occurred: {str(e)}"}), 500
            
            
    @require_session
    @daily_limit(limit_count=insight_limit)
    def call_agent_get_potential_testcaseregression(self):
        try:
            req_data = request.json
            start_date = req_data.get('start_date')
            end_date   = req_data.get('end_date')
            index_name = req_data.get('index_name')
            agent_id = req_data.get('agent_id')
            entity = req_data.get('entity','')
            run_id = req_data.get('run_id',"")
            page_name= req_data.get('page_name',"")

            if not start_date or not end_date:
                return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

            # Parse dates (assuming ISO format with possible Z)
            try:
                start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
                end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
            except Exception as e:
                return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

            # ── Agent-based queries (always run) ─────────────────────────────────────
            
            if entity == "testcase":
                query = "potential regression test suite"
                key = "Potential regression testsuite"
                
               
                
            
                
            response,agent_name = self.get_insights_for_query(query, key, start_date, end_date,agent_id,index_name)

            self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity,start=start, end=end, agent_name=agent_name, index_name=index_name, key=response)

            return buildResponse("success", response, 200)

        except Exception as e:
            return jsonify({"error": f"Exception occurred: {str(e)}"}), 500
 
 
 
    @require_session
    @daily_limit(limit_count=insight_limit)
    def call_agent_get_top_defects(self):
        try:
            req_data = request.json
            start_date = req_data.get('start_date')
            end_date   = req_data.get('end_date')
            index_name = req_data.get('index_name')
            agent_id = req_data.get('agent_id')
            entity = req_data.get('entity','')
            run_id = req_data.get('run_id',"")
            page_name= req_data.get('page_name',"")

            if not start_date or not end_date:
                return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

            # Parse dates (assuming ISO format with possible Z)
            try:
                start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
                end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
            except Exception as e:
                return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

            # ── Agent-based queries (always run) ─────────────────────────────────────
            if entity == "defect":
                query = "Top 10 Defect"
                key = "Top 10 Defect"
                
            else:
                query = "test case hotspots"
                key = "Testcase hotspots"
                

            
                
            response,agent_name = self.get_insights_for_query(query, key, start_date, end_date,agent_id,index_name)
            
            self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity,start=start, end=end, agent_name=agent_name, index_name=index_name, key=response)
            
            
            

            return buildResponse("success", response, 200)
        except Exception as e:
            return jsonify({"error": f"Exception occurred: {str(e)}"}), 500
 
 
    @require_session
    @daily_limit(limit_count=insight_limit)
    def call_agent_get_feature_impacted(self):
        try:
            req_data = request.json
            start_date = req_data.get('start_date')
            end_date   = req_data.get('end_date')
            index_name = req_data.get('index_name')
            agent_id = req_data.get('agent_id')
            entity = req_data.get('entity','')
            run_id = req_data.get('run_id',"")
            page_name= req_data.get('page_name',"")

            if not start_date or not end_date:
                return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

            # Parse dates (assuming ISO format with possible Z)
            try:
                start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
                end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
            except Exception as e:
                return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

            # ── Agent-based queries (always run) ─────────────────────────────────────

            query = "Top features and epics impacted"
            key = "Top 10 Features/Epics Impacted"
                
            response,agent_name = self.get_insights_for_query(query, key, start_date, end_date,agent_id,index_name)
            
            self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity,start=start, end=end, agent_name=agent_name, index_name=index_name, key=response)
                
            

            return buildResponse("success", response, 200)
        except Exception as e:
            return jsonify({"error": f"Exception occurred: {str(e)}"}), 500
    
    @require_session
    @daily_limit(limit_count=insight_limit)
    def call_agent_get_epic_impacted(self):
        try:
            req_data = request.json
            start_date = req_data.get('start_date')
            end_date   = req_data.get('end_date')
            index_name = req_data.get('index_name')
            agent_id = req_data.get('agent_id')
            entity = req_data.get('entity','')
            run_id = req_data.get('run_id',"")
            page_name= req_data.get('page_name',"")

            if not start_date or not end_date:
                return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

            # Parse dates (assuming ISO format with possible Z)
            try:
                start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
                end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
            except Exception as e:
                return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

            # ── Agent-based queries (always run) ─────────────────────────────────────

            query = "Top 10 Epics Impacted"
            key = "Top 10 Epics Impacted"
                
            response,agent_name = self.get_insights_for_query(query, key, start_date, end_date,agent_id,index_name)
                
            self.store_kpi_history(run_id=run_id, page_name = page_name,entity=entity,start=start, end=end, agent_name=agent_name, index_name=index_name, key=response)

            return buildResponse("success", response, 200)
        except Exception as e:
            return jsonify({"error": f"Exception occurred: {str(e)}"}), 500

    @require_session
    @daily_limit(limit_count=insight_limit)
    def call_agent_get_testcase_impacted(self):
        try:
            req_data = request.json
            start_date = req_data.get('start_date')
            end_date   = req_data.get('end_date')
            index_name = req_data.get('index_name')
            agent_id = req_data.get('agent_id')
            entity = req_data.get('entity','')
            run_id = req_data.get('run_id',"")
            page_name= req_data.get('page_name',"")

            if not start_date or not end_date:
                return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

            # Parse dates (assuming ISO format with possible Z)
            try:
                start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
                end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
            except Exception as e:
                return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

            # ── Agent-based queries (always run) ─────────────────────────────────────

            query = "impacted test cases"
            key = "Testcase Impacted"
                
            response,agent_name = self.get_insights_for_query(query, key, start_date, end_date,agent_id,index_name)
                
            self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity,start=start, end=end, agent_name=agent_name, index_name=index_name, key=response)

            return buildResponse("success", response, 200)
        except Exception as e:
            return jsonify({"error": f"Exception occurred: {str(e)}"}), 500
            
            
    @require_session
    @daily_limit(limit_count=insight_limit)
    def call_agent_get_testcase_prioritization(self):
        try:
            req_data = request.json
            start_date = req_data.get('start_date')
            end_date   = req_data.get('end_date')
            index_name = req_data.get('index_name')
            agent_id = req_data.get('agent_id')
            entity = req_data.get('entity','')
            run_id = req_data.get('run_id',"")
            page_name= req_data.get('page_name',"")

            if not start_date or not end_date:
                return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

            # Parse dates (assuming ISO format with possible Z)
            try:
                start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
                end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
            except Exception as e:
                return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

            # ── Agent-based queries (always run) ─────────────────────────────────────

            query = "prioritize test cases by frequency"
            key = "Testcase prioritization frequency"
                
            response,agent_name = self.get_insights_for_query(query, key, start_date, end_date,agent_id,index_name)
                
            self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity,start=start, end=end, agent_name=agent_name, index_name=index_name, key=response)

            return buildResponse("success", response, 200)
        except Exception as e:
            return jsonify({"error": f"Exception occurred: {str(e)}"}), 500
            
    @require_session
    @daily_limit(limit_count=insight_limit)
    def call_agent_get_testcase_prioritization_epicfeature(self):
        try:
            req_data = request.json
            start_date = req_data.get('start_date')
            end_date   = req_data.get('end_date')
            index_name = req_data.get('index_name')
            agent_id = req_data.get('agent_id')
            entity = req_data.get('entity','')
            run_id = req_data.get('run_id',"")
            page_name= req_data.get('page_name',"")

            if not start_date or not end_date:
                return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

            # Parse dates (assuming ISO format with possible Z)
            try:
                start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
                end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
            except Exception as e:
                return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

            # ── Agent-based queries (always run) ─────────────────────────────────────

            query = "prioritize test cases by feature/epic/use case"
            key = "Testcase prioritization"
                
            response,agent_name = self.get_insights_for_query(query, key, start_date, end_date,agent_id,index_name)
            self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity,start=start, end=end, agent_name=agent_name, index_name=index_name, key=response)  
            

            return buildResponse("success", response, 200)
        except Exception as e:
            return jsonify({"error": f"Exception occurred: {str(e)}"}), 500


    @require_session
    @daily_limit(limit_count=insight_limit)
    def call_agent_test_coverage(self):
        try:
            req_data = request.json
            start_date = req_data.get('start_date')
            end_date   = req_data.get('end_date')
            index_name = req_data.get('index_name')
            agent_id = req_data.get('agent_id')
            entity = req_data.get('entity','')
            run_id = req_data.get('run_id',"")
            page_name= req_data.get('page_name',"")

            if not start_date or not end_date:
                return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

            # Parse dates (assuming ISO format with possible Z)
            try:
                start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
                end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
            except Exception as e:
                return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

            # ── Agent-based queries (always run) ─────────────────────────────────────

            query = "Test Coverage Metrics"
            key = "Test Coverage Metrics"
                
            response,agent_name = self.get_insights_for_query(query, key, start_date, end_date,agent_id,index_name)
            self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity,start=start, end=end, agent_name=agent_name, index_name=index_name, key=response)  
            

            return buildResponse("success", response, 200)
        except Exception as e:
            return jsonify({"error": f"Exception occurred: {str(e)}"}), 500

    @require_session
    @daily_limit(limit_count=insight_limit)
    def call_agent_test_quality_indicators(self):
        try:
            req_data = request.json
            start_date = req_data.get('start_date')
            end_date   = req_data.get('end_date')
            index_name = req_data.get('index_name')
            agent_id = req_data.get('agent_id')
            entity = req_data.get('entity','')
            run_id = req_data.get('run_id',"")
            page_name= req_data.get('page_name',"")

            if not start_date or not end_date:
                return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

            # Parse dates (assuming ISO format with possible Z)
            try:
                start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
                end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
            except Exception as e:
                return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

            # ── Agent-based queries (always run) ─────────────────────────────────────

            query = "evaluate test case quality"
            key = "evaluate test case quality"
                
            response,agent_name = self.get_insights_for_query(query, key, start_date, end_date,agent_id,index_name)
            self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity,start=start, end=end, agent_name=agent_name, index_name=index_name, key=response)  
            

            return buildResponse("success", response, 200)
        except Exception as e:
            return jsonify({"error": f"Exception occurred: {str(e)}"}), 500



    @require_session
    @daily_limit(limit_count=insight_limit)
    def call_agent_potential_duplication_signals(self):
        try:
            req_data = request.json
            start_date = req_data.get('start_date')
            end_date   = req_data.get('end_date')
            index_name = req_data.get('index_name')
            agent_id = req_data.get('agent_id')
            entity = req_data.get('entity','')
            run_id = req_data.get('run_id',"")
            page_name= req_data.get('page_name',"")

            if not start_date or not end_date:
                return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

            # Parse dates (assuming ISO format with possible Z)
            try:
                start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
                end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
            except Exception as e:
                return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

            # ── Agent-based queries (always run) ─────────────────────────────────────

            query = "duplicate test cases"
            key = "duplicate test cases"
                
            response,agent_name = self.get_insights_for_query(query, key, start_date, end_date,agent_id,index_name)
            self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity,start=start, end=end, agent_name=agent_name, index_name=index_name, key=response)  
            

            return buildResponse("success", response, 200)
        except Exception as e:
            return jsonify({"error": f"Exception occurred: {str(e)}"}), 500

    @require_session
    @daily_limit(limit_count=insight_limit)
    def call_agent_impacted_tests(self):
        try:
            req_data = request.json
            start_date = req_data.get('start_date')
            end_date   = req_data.get('end_date')
            index_name = req_data.get('index_name')
            agent_id = req_data.get('agent_id')
            entity = req_data.get('entity','')
            run_id = req_data.get('run_id',"")
            page_name= req_data.get('page_name',"")
            if not start_date or not end_date:
                return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

            # Parse dates (assuming ISO format with possible Z)
            try:
                start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
                end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
            except Exception as e:
                return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

            # ── Agent-based queries (always run) ─────────────────────────────────────

            query = "Impacted Tests"
            key = "Impacted Tests"
                
            response,agent_name = self.get_insights_for_query(query, key, start_date, end_date,agent_id,index_name)
            self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity,start=start, end=end, agent_name=agent_name, index_name=index_name, key=response)  
            

            return buildResponse("success", response, 200)
        except Exception as e:
            return jsonify({"error": f"Exception occurred: {str(e)}"}), 500


    @require_session
    @daily_limit(limit_count=insight_limit)
    def call_agent_test_gap(self):
        try:
            req_data = request.json
            start_date = req_data.get('start_date')
            end_date   = req_data.get('end_date')
            index_name = req_data.get('index_name')
            agent_id = req_data.get('agent_id')
            entity = req_data.get('entity','')
            run_id = req_data.get('run_id',"")
            page_name= req_data.get('page_name',"")
            if not start_date or not end_date:
                return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

            # Parse dates (assuming ISO format with possible Z)
            try:
                start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
                end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
            except Exception as e:
                return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

            # ── Agent-based queries (always run) ─────────────────────────────────────

            query = "Test Gap"
            key = "Test Gap"
                
            response,agent_name = self.get_insights_for_query(query, key, start_date, end_date,agent_id,index_name)
            self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity,start=start, end=end, agent_name=agent_name, index_name=index_name, key=response)  
            

            return buildResponse("success", response, 200)
        except Exception as e:
            return jsonify({"error": f"Exception occurred: {str(e)}"}), 500

    @require_session
    @daily_limit(limit_count=insight_limit)
    def call_agent_potential_test_automation(self):
        try:
            req_data = request.json
            start_date = req_data.get('start_date')
            end_date   = req_data.get('end_date')
            index_name = req_data.get('index_name')
            agent_id = req_data.get('agent_id')
            entity = req_data.get('entity','')
            run_id = req_data.get('run_id',"")
            page_name= req_data.get('page_name',"")
            if not start_date or not end_date:
                return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

            # Parse dates (assuming ISO format with possible Z)
            try:
                start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
                end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
            except Exception as e:
                return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

            # ── Agent-based queries (always run) ─────────────────────────────────────

            query = "potential automation use cases"
            key = "potential automation use cases"

            response,agent_name = self.get_insights_for_query(query, key, start_date, end_date,agent_id,index_name)
            self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity,start=start, end=end, agent_name=agent_name, index_name=index_name, key=response)  
            

            return buildResponse("success", response, 200)
        except Exception as e:
            return jsonify({"error": f"Exception occurred: {str(e)}"}), 500



    def get_agent_execution_context_incident(self,query,incident_id,user_id,session_id,agent_id,api_key,api_url):
       
        # message = f"""Analyze the following specific IT incident {incident_id} in the filed "record_id" in knowledge base and Give json response for our insight on incident management based on the data ingested into the system in particular date range {start_date} to {end_date}."""
        session_unique_id = str(uuid.uuid4())
        payload = {
            "user_id": user_id or "default_user",
            "agent_id": agent_id,
            "session_id": session_unique_id or "default_session",
            "message": query
        }
        headers = {
                "x-api-key": api_key,
                "Content-Type": "application/json"
            }
            
        try:
            response = requests.post(api_url, json=payload, headers=headers)
            response.raise_for_status()
            return response.json() if response.headers.get('Content-Type') == 'application/json' else response.text

        except Exception as e:
            print(f"Agent Execution Error: {e}")
            return None
   
    @require_session
    def analyze_single_incident(self):
        
        req_data = request.json
        
        index_name = req_data.get('index_name')
        agent_id = req_data.get('agent_id')
        entity = req_data.get('entity')
        if entity == "incident":
            incident_id = req_data.get('incident_id')
            
        else:
            incident_id = req_data.get('defect_id')
        
        agent_data = self.agent_collection.find_one({"api_agent_id": agent_id,"isDeleted":{"$ne":True}}) if agent_id else None
        api_key = agent_data.get("agent_api_key") if agent_data else None
        session_id = agent_data.get("session_id") if agent_data else None
        user_id = agent_data.get("user_id") if agent_data else None
        api_url = agent_data.get("agent_api_url") if agent_data else None
        
        # Use defaults if not provided in payload (matching your analytics function)
        # api_url,api_key, user_id, agent_id, session_id = config_loader.get_insight_agent_details()
        # agent_id = "696dcd85e1e4c42b224b0613"
       
        # session_id = "696dcd85e1e4c42b224b0613-wawdgh44a78"
        # api_key = "sk-default-LoIEgQBmwEvBhhamPjwtHh7yxh4s7fPw"
        # user_id = "romennaveen@gmail.com"

        if not incident_id:
            return jsonify({"error": "Payload must contain 'incident_id'"}), 400

        print(f"Checking OpenSearch for ID: {incident_id}")

        try:
            # 1. Check OpenSearch
            # Since ingestion uses doc['record_id'] as the ES _id, we can use client.get()
            try:
                es_response = self.client.get(index=index_name, id=incident_id)
                incident_data = es_response['_source']
                found = True
            except Exception:
                # If strictly not found by _id, try a term search in case mapping differs
                search_body = {
                    "query": {
                        "term": {
                            "record_id.keyword": incident_id
                        }
                    }
                }
                search_res = self.client.search(index=index_name, body=search_body)
                if search_res['hits']['total']['value'] > 0:
                    incident_data = search_res['hits']['hits'][0]['_source']
                    found = True
                else:
                    found = False

            # 2. Handle Not Found
            if not found:
                return jsonify({
                    "status": "not_found",
                    "message": f"Incident {incident_id} does not exist in the system."
                }), 200
            title = incident_data.get("title", "").strip()  
            similar_incidents_data = []

            if not title:
                print("Warning: Incident has no title → skipping similar incidents search")
            else:
                print(f"Looking for similar incidents with title: {title[:80]}{'...' if len(title)>80 else ''}")
                
                search_body = {
                    "query": {
                        "bool": {
                            "filter": [
                                {"term": {"title.keyword": title}},          # exact match (recommended)
                                # Exclude the current incident itself
                                {"bool": {"must_not": {"term": {"_id": incident_id}}}}
                                # Optional: only look in last X days/months
                                # ,{"range": {"created_at": {"gte": "now-180d/d"}}}
                            ]
                        }
                    },
                    "sort": [
                        {"created_at": {"order": "desc"}}                # ← now using correct field
                    ],
                    "size": 8,                                           # adjust as needed (5–10 is typical)
                    "_source": [
                        "record_id",
                        "title",
                        "created_at",
                        "status",
                        "priority",
                        "severity",
                        "resolved_at",                                   # useful to see if/when resolved
                        "mttr_seconds",                                  # optional — shows duration
                        "category",
                        "subcategory"
                    ]
                }

                similar_res = self.client.search(
                    index=index_name,
                    body=search_body
                )

                hits = similar_res["hits"]["hits"]
                
                if entity == "incident":
                    similar_incidents_data = [
                        {
                            "incident_id": hit["_id"],
                            "title": hit["_source"].get("title", ""),
                            "timestamp": hit["_source"].get("@timestamp") or 
                                        hit["_source"].get("created_at") or 
                                        hit["_source"].get("incident_date"),
                            "severity": hit["_source"].get("severity"),
                            "status": hit["_source"].get("status"),
                            # Add more fields you find useful
                        }
                        for hit in hits
                    ]
                elif entity == "defect":
                    similar_defects_data = [
                        {
                            "defect_id": hit["_id"],
                            "title": hit["_source"].get("title", ""),
                            "timestamp": hit["_source"].get("@timestamp") or 
                                        hit["_source"].get("created_at") or 
                                        hit["_source"].get("incident_date"),
                            "severity": hit["_source"].get("severity"),
                            "status": hit["_source"].get("status"),
                            # Add more fields you find useful
                        }
                        for hit in hits
                    ]
                    
                else:
                    similar_testcase_data = [
                        {
                            "testcase_id": hit["_id"],
                            "title": hit["_source"].get("title", ""),
                            "timestamp": hit["_source"].get("@timestamp") or 
                                        hit["_source"].get("created_at") or 
                                        hit["_source"].get("incident_date"),
                            "severity": hit["_source"].get("severity"),
                            "status": hit["_source"].get("status"),
                            # Add more fields you find useful
                        }
                        for hit in hits
                    ]
                
                
                

            # 3. Pass to Agent
            print(f"Incident found. Sending to Agent...")
            base_phrase = f"{incident_id}"
            last_phrase = f"for index {index_name}" if index_name else ""

            if entity == "incident":
                queries = [
                    f"impacted apps for {base_phrase} {last_phrase}",
                    f"automation opportunities for Incident {base_phrase} {last_phrase}",
                    f"top solutions for {base_phrase} {last_phrase}"
                    
                ]
                
            elif entity == "defect":
                queries = [
                    f"Defect Solution Advisor for {base_phrase} {last_phrase}",
                    f"potential regression scenarios for defect {base_phrase} {last_phrase}"
                    
                    
                ]
            
            else:
                queries = [
                    f"testcase suggestion Advisor for {base_phrase} {last_phrase}",
                    
                    f"potential automation use cases for {base_phrase} {last_phrase}",
                    f"potential regression test suite for {base_phrase} {last_phrase}"
                    
                    
                ]

            def run_single_query(q: str) -> Dict:
                try:
                    print("Running agent query:", q)
                    agent_result = self.get_agent_execution_context_incident(
                        query=q,
                        incident_id=incident_id,
                        user_id=user_id,
                        session_id=session_id,
                        agent_id=agent_id,
                        api_key=api_key,
                        api_url=api_url
                    )
                    raw = agent_result.get('response', '')
                    print("res",raw)
                    parsed = self.extract_and_parse_json(raw)
                    print(f"Query completed: {q[:60]}...")
                    return parsed
                except Exception as exc:
                    return {
                        "error": str(exc),
                        "query": q,
                        "status": "failed"
                    }

            # Run agent queries concurrently
            results: List[Dict] = [None] * len(queries)
            max_workers = min(3, len(queries))

            with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                future_to_idx = {
                    executor.submit(run_single_query, query): i
                    for i, query in enumerate(queries)
                }
                for future in concurrent.futures.as_completed(future_to_idx):
                    idx = future_to_idx[future]
                    results[idx] = future.result()

            # Build agent response structure
            if entity == "incident":
                combined: Dict[str, Any] = {
                    "overview": {
                        "title": "Full Incident Overview",
                        "generated_at": datetime.now().isoformat(timespec='seconds'),
                        "timezone": "Asia/Kolkata"
                    },
                    "Top 10 Applications Impacted":     results[0],
                    "potential automation use cases":           results[1],
                    "top 5 solutions":    results[2],
                    "similar_incident":similar_incidents_data,
                    "title":title,
                    "errors": []
                }
                
            elif entity == "defect":
                combined: Dict[str, Any] = {
                    "overview": {
                        "title": "Full defects Overview",
                        "generated_at": datetime.now().isoformat(timespec='seconds'),
                        "timezone": "Asia/Kolkata"
                    },
                    "Defect solution":     results[0],
                    "potential regression scenarios":           results[1],
                    "similar_defect":similar_defects_data,
                    
                    "title":title,
                    "errors": []
                }
                
            else:
                combined: Dict[str, Any] = {
                    "overview": {
                        "title": "Full defects Overview",
                        "generated_at": datetime.now().isoformat(timespec='seconds'),
                        "timezone": "Asia/Kolkata"
                    },
                    "Testcase solution":     results[0],
                    "potential automation use cases":           results[1],
                    "potential regression scenarios": results[2],
                    "similar_defect":similar_testcase_data,
                    
                    "title":title,
                    "errors": []
                }
            

            # Collect errors
            for i, res in enumerate(results):
                if isinstance(res, dict) and "error" in res:
                    combined["errors"].append({
                        "query": queries[i],
                        "error_message": res["error"]
                    })


            # agent_raw_response = get_incident_agent_context(
            #     incident_data, user_id, session_id, agent_id, api_key
            # )

            # # 4. Parse Agent Response
            # # Depending on if the agent returns a dict directly or a string containing JSON
            # parsed_agent_data = {}
            # if isinstance(agent_raw_response, dict):
            #     # Check if the actual text is nested in 'response' key
            #     raw_text = agent_raw_response.get('response', '')
            #     parsed_agent_data = extract_and_parse_json(raw_text)
            # else:
            #     parsed_agent_data = extract_and_parse_json(str(agent_raw_response))

            # 5. Return Consolidated Response
            return jsonify({
                "ai_analysis": combined,
                # kept for debugging
            }), 200

        except Exception as e:
            print(f"Error analyzing incident: {e}")
            return jsonify({"error": str(e)}), 500
    

    def normalize_row(self,row):
        date_val = row.get('Created')
        
            
        # Fallback: If "Created - Site Local time" is missing, try "Opened - Site Local Time"
        if pd.isnull(date_val):
            date_val = row.get('Opened')
            
        if pd.isnull(date_val):
            return None # Skip rows with no date
        
        resolved_val = row.get('Date Resolved')

        mttr_seconds = 0
        resolved_iso = None
        
        if pd.notna(resolved_val) and str(resolved_val).strip():
            try:
                ts_created = pd.to_datetime(date_val, errors='raise', utc=True)
                ts_resolved = pd.to_datetime(resolved_val, errors='raise', utc=True)
                
                # Only calculate MTTR if both dates are valid and resolved > created
                if pd.notna(ts_resolved) and ts_resolved > ts_created:
                    duration = (ts_resolved - ts_created).total_seconds()
                    mttr_seconds = max(0, int(duration))
                
                resolved_iso = ts_resolved.isoformat()   # only set if parsing succeeded
                
            except Exception as e:
                # Optional: log the bad value so you can find & clean source data
                # print(f"Bad resolved date for {row.get('Number')}: {resolved_raw} → {e}")
                resolved_iso = None   # explicitly keep None → becomes JSON null
                mttr_seconds = 0

        # if not pd.isnull(resolved_val):
            # # Convert to datetime objects
            # try:
                # ts_created = pd.to_datetime(date_val)
                # ts_resolved = pd.to_datetime(resolved_val)
                
                # resolved_iso = ts_resolved.isoformat()
                
                # # Calculate duration in seconds
                # duration = (ts_resolved - ts_created).total_seconds()
                # mttr_seconds = int(duration) if duration > 0 else 0
            # except:
                # pass # Keep 0 if calculation fails
        # 2. Extract Text Fields
        short_desc = str(row.get('Subject', '') or row.get('Subject', '')).strip()
        description = str(row.get('Description', '') or row.get('Subject', '')).strip()
        category = str(row.get('Category', 'Other')).strip()
        
        # 3. Handle Subcategory (Your list has duplicate "Subcategory" headers)
        # We try to get the first valid one
        subcat = str(row.get('Subcategory', ''))
        if subcat == 'nan' or not subcat:
            # Pandas renames duplicates to .1, .2. Let's try those if the first is empty
            subcat = str(row.get('Subcategory.1', '')) 
        
        # 4. Generate Issue Key for Recurring Logic
        issue_key = f"{category} | {subcat} | {short_desc.lower()}"

        # 5. Handle SLA (Converting "TRUE"/"FALSE" strings to Python Boolean)
        raw_sla = str(row.get('Made SLA', 'false')).strip().upper()
        sla_bool = True if raw_sla == 'TRUE' else False

        # 6. Priority & Severity Logic
        priority = str(row.get('Priority', '')).strip()
        if pd.isna(priority) or str(priority).strip().lower() == 'nan':
            
            priority = ""
        
        # Your data has a 'Severity' column, but sometimes it might be empty.
        # Logic: If Severity is missing/nan, use Priority.
        severity = str(row.get('Severity', '')).strip()
        if not severity or severity.lower() == 'nan':
            severity = priority 

        return {
            "record_id": str(row.get('Ticket ID', 'unknown')),
            "source": "ITSM_Export",
            "type": "Incident",
            "created_at": date_val.isoformat(), 
            "title": short_desc,
            "description": description,
            "resolved_at": resolved_iso, 
            "mttr_seconds": mttr_seconds,
            # Exact mapping to your columns
            "status": str(row.get('Status', 'New')), 
            "priority": priority,
            "severity": severity,
            "category": category,
            "subcategory": subcat,
            "issue_key": issue_key,
            "is_sla_met": sla_bool
        }

    @require_session
    def trigger_ingestion(self):
        try:
            
            file_path = self.INCIDENT_FILE_PATH
            print(f"Loading data from {file_path}...")
            
            # 1. Load via Pandas (Efficient for date parsing and initial cleaning)
            # df = pd.read_excel(file_path)
            path = Path(file_path)
            ext = path.suffix.lower()          # .xlsx → '.xlsx', .csv → '.csv'

            if ext in ['.xlsx', '.xls', '.xlsm', '.ods']:
                df = pd.read_excel(file_path)
            elif ext in ['.csv', '.txt']:      # sometimes incident files are .txt but comma-separated
                df = pd.read_csv(file_path)
                print("length",len(df))
            else:
                raise ValueError(
                    f"Unsupported file extension '{ext}' for incident file: {file_path}\n"
                    "Supported: .xlsx, .xls, .csv, .txt"
                )
            
            # date_col = "Created"
            
            # # Clean Dates
            # df[date_col] = pd.to_datetime(df[date_col], errors='coerce')
            # df = df.dropna(subset=[date_col])
            
            if 'Date Created' in df.columns and 'Time Created' in df.columns:
                # Combine date and time strings
                df['Date Created'] = df['Date Created'].astype(str).str.strip()
                df['Time Created'] = df['Time Created'].astype(str).str.strip()

                # Optional but recommended: remove any time part already present in Date Created
                # (your data sometimes has "6/1/2025 12:00:00 AM")
                df['Date Clean'] = df['Date Created'].str.extract(r'^(\d{1,2}/\d{1,2}/\d{4})', expand=False)
                # fallback if extract didn't match
                df['Date Clean'] = df['Date Clean'].fillna(
                    df['Date Created'].str.split(n=1).str[0].str.strip()
                )

                # Now combine clean date string + time string
                combined_str = df['Date Clean'] + ' ' + df['Time Created']

                # Parse once — inference usually works best
                df['Created'] = pd.to_datetime(combined_str, errors='coerce')
                
            else:
                    # Convert timestamp column
                df['Created'] = pd.to_datetime(df['Created'], dayfirst=True, errors='coerce')
            
            df = df.dropna(subset=['Created'])
            
            # Fill NAs to avoid errors during dictionary conversion
            df = df.fillna('')
            
            print(f"Processing {len(df)} rows for indexing...")
            
            # loader = ExcelLoader()
            actions = []
            
            # 2. Iterate and Normalize
            for _, row in df.iterrows():
                doc = self.normalize_row(row)
                print("doc",doc)
                if not doc: continue
                
                # 3. Create Embedding (Title + Description + Category)
                # This enables the "Semantic Search" capability
                text_to_embed = f"{doc['title']} {doc['description']} {doc['category']}"
                # doc["combined_vector"] = self.model.encode(text_to_embed).tolist()
                
                # Prepare for Bulk API
                action = {
                    "_index": self.INDEX_NAME,
                    "_id": doc['record_id'],
                    "_source": doc
                }
                actions.append(action)
                
                # Optional: Batching to save memory
                if len(actions) >= 500:
                    helpers.bulk(self.client, actions)
                    actions = []
                    print(".", end="", flush=True)

            # Flush remaining
            if actions:
                helpers.bulk(self.client, actions)
            
            print(f"\nIngestion Complete for {len(df)} documents.")
                
            return jsonify({
                "status": "success",
                "message": f"Successfully ingested {len(df)} records.",
                "file_processed": file_path
            }), 200

        except Exception as e:
            print(f"Ingestion Error: {e}")
            return jsonify({"error": str(e)}), 500
    
    @require_session
    def create_insight_index(self):
        VECTOR_DIM = 384
        try:
            index_body = {
                "settings": {"index": {"knn": True}},
                "mappings": {
                    "properties": {
                        "combined_vector": {
                            "type": "knn_vector",
                            "dimension": VECTOR_DIM,
                            "method": {"name": "hnsw", "engine": "lucene", "space_type": "l2"}
                        },
                        "created_at": {"type": "date"},
                        "resolved_at": {"type": "date"},  # <--- NEW: Store Resolved Date
                        "mttr_seconds": {"type": "long"},
                        # Keyword fields are essential for Filtering & Aggregations (Pie Charts)
                        "category": {"type": "keyword"},
                        "subcategory": {"type": "keyword"},
                        "priority": {"type": "keyword"},
                        "severity": {"type": "keyword"},  # Added Severity
                        "status": {"type": "keyword"},    # Added Status
                        "issue_key": {"type": "keyword"},
                        "is_sla_met": {"type": "boolean"},
                        "source": {"type": "keyword"}
                    }
                }
            }
            if not self.client.indices.exists(index=self.INDEX_NAME):
                print("Index_1")
                self.client.indices.create(index=self.INDEX_NAME, body=index_body)
                print(f"Index '{self.INDEX_NAME}' created.")
                return jsonify({
                "status": True,
                "message": f"Index '{self.INDEX_NAME}'created Successfully."}), 200
            else:
                print("Index_2")
                return jsonify({
                "status": False,
                "message": f"Failed to create Index"}), 200
                
        except Exception as e:
            print("Index_Error",e)
       
    def safe_extract(self,df_subset, mask_col, cols):
        """Safely extract matching rows as list of dicts"""
        if df_subset.empty:
            return []
        mask = df_subset[mask_col].astype(bool)
        return df_subset.loc[mask, cols].to_dict('records')

    
    @require_session
    def insight_suggestion(self):
        try:
            data = request.get_json(silent=True) or {}
            usecase = data.get("usecase", "general")
            print("usecase",usecase)

            session_unique_id = str(uuid.uuid4())
            api_url = "https://agent-prod.studio.lyzr.ai/v3/inference/chat/"
            # payload = {
            #     "user_id": "meena.rahulmalu@movate.com",
            #     "agent_id": "69d4ae25953ac30a571bc4b4",
            #     "session_id":session_unique_id ,
            #     "message": usecase
            # }
            payload = {
                "user_id": user_id,
                "agent_id": insight_agent_id,
                "session_id":session_unique_id ,
                "message": usecase
            }
            headers = {
                    "x-api-key": "sk-default-k6X5y4G76crcjmc7FzWmyQ3qYkXiB90f",
                    "Content-Type": "application/json"
                }
                
            try:
                response = requests.post(api_url, json=payload, headers=headers)
                response.raise_for_status()
                print("Agent response:", response.text)
                response_data = response.text
               
                cleaned_data = self.clean_brief_json(response_data)
                # structure = self.convert_to_structured_json(cleaned_data)
                print("cleaned_data",cleaned_data)
                # print("structure",structure)
                

                return jsonify({
                    "status": "success",
                    
                    "data": cleaned_data,
                    # "structured_data": structure
                    
                    
                }), 200

            except Exception as e:
                print(f"Agent Execution Error: {e}")
                return None
            
        except Exception as e:
            print(f"Error in insight suggestion: {e}")
            return jsonify({"error": str(e)}), 500

    @require_session
    def trends_usecase(self):
        try:
            data = request.get_json(silent=True) or {}
            usecase = data.get("usecase", "general")
            print("usecase",usecase)
            full_schema = data.get("full_schema", "") # 1. Extract full_schema from payload
        
            print("usecase:", usecase)

            # 2. Format the schema into a string (if it comes in as a dict/list object)
            if isinstance(full_schema, (dict, list)):
                full_schema_str = json.dumps(full_schema, indent=2)
            else:
                full_schema_str = str(full_schema)

            # 3. Combine usecase and schema with a newline
            combined_message = f"{usecase}\nOpensearch available field : {full_schema_str}"

            session_unique_id = str(uuid.uuid4())
            api_url = "https://agent-prod.studio.lyzr.ai/v3/inference/chat/"
            # payload = {
            #     "user_id": "meena.rahulmalu@movate.com",
            #     "agent_id": "69d4ae25953ac30a571bc4b4",
            #     "session_id":session_unique_id ,
            #     "message": usecase
            # }
            payload = {
                "user_id": user_id,
                "agent_id": trend_agent_id,
                "session_id":session_unique_id ,
                "message": combined_message
            }
            headers = {
                    "x-api-key": "sk-default-k6X5y4G76crcjmc7FzWmyQ3qYkXiB90f",
                    "Content-Type": "application/json"
                }
                
            try:
                response = requests.post(api_url, json=payload, headers=headers)
                response.raise_for_status()
                print("Agent response:", response)
                
                # 1. Parse the outer JSON response from the API
                response_dict = response.json()
                inner_response_str = response_dict.get("response", "{}")
                
                # 3. Parse the inner JSON string into a Python dictionary
                try:
                    cleaned_data = json.loads(inner_response_str)
                except Exception as e:
                    # Fallback in case the agent returns plain text instead of JSON
                    cleaned_data = {"text": inner_response_str}
                print("cleaned_data", cleaned_data)

                # Return the successfully extracted opensearch and chart data
                return jsonify({
                    "status": "success",
                    "data": cleaned_data
                }), 200


            except Exception as e:
                print(f"Agent Execution Error: {e}")
                return None
            
        except Exception as e:
            print(f"Error in insight suggestion: {e}")
            return jsonify({"error": str(e)}), 500


    def clean_brief_json(self, raw_data):
        """
        Robustly normalizes any agent response into standard: {"formats": [...]}
        Handles: Stringified JSON, Markdown blocks, nested 'response' keys, 
        and conversational text surrounding the JSON.
        """
        def extract_json_from_string(s):
            # Find the first '{' or '[' and the last '}' or ']'
            # This ignores conversational filler around the JSON
            match = re.search(r'(\{.*\}|\[.*\])', s, re.DOTALL)
            return match.group(0) if match else s

        def unpack(data):
            # Case 1: String - might be encoded JSON or Markdown
            if isinstance(data, str):
                cleaned = data.strip()
                # 1. Remove Markdown code blocks if present
                cleaned = re.sub(r'```json\s*|\s*```', '', cleaned)
                # 2. Extract only the JSON part (handles text before/after JSON)
                cleaned = extract_json_from_string(cleaned)
                
                try:
                    loaded = json.loads(cleaned)
                    return unpack(loaded) # Recursive call for nested strings
                except Exception as e:
                    return cleaned

            # Case 2: Dictionary - Greedy search for the data
            if isinstance(data, dict):
                # Check for common wrapper keys
                for wrapper in ["response", "data", "output", "result"]:
                    if wrapper in data:
                        return unpack(data[wrapper])
                
                # Standardize known key variations to 'formats'
                if "proposed_formats" in data:
                    return {"formats": data["proposed_formats"]}
                
                if "formats" in data:
                    # Ensure formats is a list
                    if not isinstance(data["formats"], list):
                        data["formats"] = [data["formats"]]
                    return data
                
                # If the dict itself looks like a single format object
                if "format_name" in data or "sample_json" in data:
                    return {"formats": [data]}
                
                return data

            # Case 3: List - The agent returned the list of formats directly
            if isinstance(data, list):
                return {"formats": data}

            return data

        try:
            normalized = unpack(raw_data)
            
            # Final Validation & Formatting
            if isinstance(normalized, dict) and "formats" in normalized:
                # Ensure every item in formats is a dict
                if isinstance(normalized["formats"], list):
                    return normalized
            
            # If we reached here, try to wrap whatever we found in a formats key
            if isinstance(normalized, list):
                return {"formats": normalized}
                
            raise ValueError("No valid 'formats' list found in data.")

        except Exception as e:
            raise ValueError(f"Deep Unpack Error: {str(e)}")

    def convert_to_structured_json(self, brief_json):
        """
        Recursively converts sample_json values to their data types, 
        preserving the exact original structure.
        """
        
        def get_type_schema(item):
            """Helper to recursively map values to type strings."""
            if isinstance(item, bool):
                return "boolean"
            elif isinstance(item, int):
                # Check for int before float because isinstance(True, int) is True
                return "integer"
            elif isinstance(item, float):
                return "number"
            elif isinstance(item, str):
                return "string"
            elif isinstance(item, list):
                # If it's a list, we return a list containing the schema of the first element
                if len(item) > 0:
                    return [get_type_schema(item[0])]
                return []
            elif isinstance(item, dict):
                # If it's a dictionary, recursively map all keys
                return {k: get_type_schema(v) for k, v in item.items()}
            return "unknown"

        try:
            # 1. Validation
            if not isinstance(brief_json, dict):
                return {"error": "Invalid input format"}

            formats = brief_json.get("formats", [])
            if not formats:
                return {"error": "No formats available"}
            
            target_format = formats[0]
            
            # 2. Extract and parse sample_json
            sample = target_format.get("sample_json", {})
            if isinstance(sample, str):
                try:
                    sample = json.loads(sample)
                except:
                    pass

            # 3. Generate the recursive schema for the ENTIRE sample_json
            full_schema = get_type_schema(sample)

            # 4. Format the use case name
            fname = target_format.get("format_name", "Analysis")
            fname = re.sub(r'([a-z])([A-Z])', r'\1 \2', fname).lower()

            # 5. Return the full structure
            return {
                "current_use_case": fname,
                "selected_json_structure": {
                    "schema": full_schema,
                    "recommended_charts": target_format.get("recommended_charts", [])
                }
            }
            
        except Exception as e:
            return {"error": f"Structuring Error: {str(e)}"}
        
    @require_session
    def ingest_details_document(self):
        try:
            data = request.get_json(silent=True) or {}
            
            if not data:
                data = {}

            # Merge form data into the same dict
            if request.form:
                data.update(request.form.to_dict())

            tool = data.get("connector_type") or request.form.get("connector_type")
            
            index_name = data.get("index_name") or request.form.get("index_name")
            index_name = index_name.strip().lower()
            # index_id= str(uuid.uuid4())
            usecases_raw = data.get("usecase") or request.form.get("usecase") or {}
            trends_raw = data.get("trend_usecases") or request.form.get("trend_usecases") or {}
            visualization_raw = data.get("visualization") or request.form.get("visualization") or {}
            trends_visualization_raw = data.get("trends_visualization") or request.form.get("trends_visualization") or {} 
            full_schema = data.get("full_schema") or request.form.get("full_schema") or {}
            try:
                # Handle usecases (Now expecting a LIST)
                if isinstance(usecases_raw, str):
                    usecases_list = json.loads(usecases_raw)
                else:
                    usecases_list = usecases_raw or []

                if isinstance(trends_raw, str):
                    trends_list = json.loads(trends_raw)
                elif isinstance(trends_raw, list):
                    trends_list = trends_raw
                else:
                    trends_list = []

                # Handle visualization
                if isinstance(visualization_raw, str):
                    visualization = json.loads(visualization_raw)
                else:
                    visualization = visualization_raw or {}

                if isinstance(trends_visualization_raw, str):
                    trends_visualization = json.loads(trends_visualization_raw)
                else:
                    trends_visualization = trends_visualization_raw or {}

                if isinstance(full_schema, str):
                    full_schema_parsed = json.loads(full_schema)
                else:
                    full_schema_parsed = full_schema or {}

            except Exception as e:
                print(f"JSON parse error for usecase/visualization: {e}")
                usecases_list = []
                trends_list = []
                visualization = {}
                trends_visualization = {}
                full_schema_parsed = {}

            # Get names by iterating through the list
            usecase_names = [uc.get("usecase_name") for uc in usecases_list if isinstance(uc, dict) and uc.get("usecase_name")]
            trends_usecases = [trend.get("usecase_name") for trend in trends_list if isinstance(trend, dict) and trend.get("usecase_name")]
            timestamp = datetime.now(timezone.utc).isoformat() + "Z"
            createdAt = datetime.now(timezone.utc).isoformat() + "Z"

            # --- PART 1: UPSERT EACH USE CASE INTO THE DETAIL COLLECTION ---
            self.mcp_usecase_collection.delete_many({"index_name": index_name})

            # Iterate over the LIST of dictionaries
            for usecase_item in usecases_list:
                # Ensure the item is a dictionary
                if not isinstance(usecase_item, dict):
                    continue

                # Extract data from the list item
                uc_name = usecase_item.get("usecase_name")
                uc_raw_json = usecase_item.get("raw_config", "")
                
                # Skip if there is no usecase_name
                if not uc_name:
                    continue
                    
                
                source = usecase_item.get('source')
                if source == 'static':
                    continue


                # Generate the structured/cleaned version as requested
                parsed_inner_json = uc_raw_json
                
                # Check if raw_config is a string and not empty, then parse it
                if isinstance(uc_raw_json, str) and uc_raw_json.strip():
                    try:
                        parsed_inner_json = json.loads(uc_raw_json)
                    except Exception as e:
                        print(f"Error parsing inner JSON for {uc_name}: {e}")
                        parsed_inner_json = {}

                # Convert to structured json (assuming this method exists in your class)
                usecase_structured_json = self.convert_to_structured_json(parsed_inner_json)
                
                # Database upsert
                self.mcp_usecase_collection.update_one(
                    {
                        "index_name": index_name, 
                        "usecase_name": uc_name
                    }, 
                    {
                        "$set": {
                            "index_name": index_name,   
                            "usecase_name": uc_name,
                            "raw_config": uc_raw_json,
                            "tool": tool, # Ensure 'tool' variable is defined earlier in your script
                            "structured_config": usecase_structured_json,
                            "updated_at": timestamp,
                            "key":"insights"
                        }
                    }, 
                    upsert=True 
                )

            for trends in trends_list:
                if not isinstance(trends, dict):
                    continue
                
                trend_usecase_name = trends.get("usecase_name")
                trends_raw_config = trends.get("raw_config", "")

                if not trend_usecase_name:
                    continue
                    
                source = trends.get('source','')
                if source == 'static':
                    continue

                parsed_trends_json = {}
                
                # Check if raw_config is a string and not empty, then parse it
                if isinstance(trends_raw_config, str) and trends_raw_config.strip():
                    try:
                        parsed_trends_json = json.loads(trends_raw_config)
                    except Exception as e:
                        print(f"Error parsing inner JSON for {trend_usecase_name}: {e}")
                        parsed_trends_json = {}
                elif isinstance(trends_raw_config, dict):
                    parsed_trends_json = trends_raw_config

                self.mcp_usecase_collection.update_one(
                    {
                        "index_name": index_name,   
                        "usecase_name": trend_usecase_name
                    },
                    {
                        "$set": {
                            "index_name": index_name,
                            "usecase_name": trend_usecase_name,
                            "raw_config": trends_raw_config,
                            "parsed_trends_json": parsed_trends_json, # This holds the OpenSearch query!
                            "tool": tool,
                            "updated_at": timestamp,
                            "key":"trends"
                        }
                    },
                    upsert=True
                )
                                
                
                
            

            if tool == 'excel':
                entity_type = data.get("entity_type") or request.form.get("entity_type")
            
                
            
                if entity_type.lower() == 'incident':
                    column_mappings={
                        "id": data.get("id") or request.form.get("id"),
                        "issue_type": data.get("issue_type") or request.form.get("issue_type"),
                        "application": data.get("application") or request.form.get("application"),
                        "created_date": data.get("created_date") or request.form.get("created_date"),
                        "resolved_date": data.get("resolved_date") or request.form.get("resolved_date"),
                        "description": data.get("description") or request.form.get("description"),
                        "resolution": data.get("resolution") or request.form.get("resolution"),
                        "root_cause": data.get("root_cause") or request.form.get("root_cause"),
                        "title": data.get("title") or request.form.get("title"),
                        "status": data.get("status") or request.form.get("status"),
                        "priority": data.get("priority") or request.form.get("priority"),
                        "severity": data.get("severity") or request.form.get("severity"),
                        "category": data.get("category") or request.form.get("category"),
                        "SLA": data.get("SLA", "") or request.form.get("SLA", ""),
                        "infra_system": data.get("infra_system") or request.form.get("infra_system")
                    }


                elif entity_type.lower() == 'defect':
                    column_mappings = {
                        "id": data.get("id") or request.form.get("id"),
                        "issue_type": data.get("issue_type") or request.form.get("issue_type"),
                        "application": data.get("application") or request.form.get("application"),
                        "created_date": data.get("created_date") or request.form.get("created_date"),
                        "resolved_date": data.get("resolved_date") or request.form.get("resolved_date"),
                        "description": data.get("description") or request.form.get("description"),
                        "resolution": data.get("resolution") or request.form.get("resolution"),
                        "root_cause": data.get("root_cause") or request.form.get("root_cause"),
                        "title": data.get("title") or request.form.get("title"),
                        "status": data.get("status") or request.form.get("status"),
                        "priority": data.get("priority") or request.form.get("priority"),
                        "severity": data.get("severity") or request.form.get("severity"),
                        "category" : data.get("category") or request.form.get("category"),
                        "epic": data.get("epic") or request.form.get("epic"),
                        "feature": data.get("feature") or request.form.get("feature"),
                        "expected_result": data.get("expected_result") or request.form.get("expected_result"),
                        "user_story": data.get("user_story") or request.form.get("user_story")
                    }
                    


                elif entity_type.lower() == 'testcase':
                    column_mappings = {
                        "id": data.get("id") or request.form.get("id"),
                        "issue_type": data.get("issue_type") or request.form.get("issue_type"),
                        "created_date": data.get("created_date") or request.form.get("created_date"),
                        "description": data.get("description") or request.form.get("description"),
                        "title": data.get("title") or request.form.get("title"),
                        "status": data.get("status") or request.form.get("status"),
                        "priority": data.get("priority") or request.form.get("priority"),
                        "severity": data.get("severity") or request.form.get("severity"),
                        "category": data.get("category") or request.form.get("category"),
                        "epic": data.get("epic") or request.form.get("epic"),
                        "feature": data.get("feature") or request.form.get("feature"),
                        "expected_result": data.get("expected_result") or request.form.get("expected_result"),
                        "user_story": data.get("user_story") or request.form.get("user_story")
                    }

                sheet_name = request.form.get('sheet_name')
                connector_type = request.form.get('connector_type')
                onboarded_agent = request.form.get('onboarded_agent')
                onboarded_agent_name = request.form.get('onboarded_agent_name')

                
                KNOWN_EXCEL_FIELDS = {
                        "id",
                        "title",
                        "description",
                        "opened",
                        "resolved",
                        "status",
                        "priority",
                        "severity",
                        "category",
                        "SLA"
                    }
                
                
                CORE_FIELDS = {
                        "entity_type",
                        "sheet_name",
                        "index_name",
                        "connector_type",
                        "onboarded_agent",
                        "onboarded_agent_name",
                        "usecase",
                        "visualization",
                        "trends_visualization",
                        "trend_usecases",
                        "full_schema"
                        
                    }

                
                dynamic_fields = {}

                for key, value in data.items():
                    if (
                        not column_mappings.get(key,"")
                        and key not in CORE_FIELDS
                        and value not in (None, "", [])
                    ):
                        dynamic_fields[key] = value



            
                print("file")
                if not index_name:
                    return jsonify({"error": "Missing required field: 'index_name'"}), 400

                find_op ={
                    "type": "find_one",
                    "filter": {
                        "index_name": index_name
                    }

                }

                existing_index = self.chatbot_agent._query_db('mcp_master', find_op)

                if 'file' not in request.files and not existing_index:
                    return jsonify({"error": "No file part in the request"}), 400

                if 'file' not in request.files:
                    file=None 
                else:
                    file = request.files['file']
                file_metadata = {}
                record_count = 0
                columns = []

                if file:
                    if file.filename == '':
                        return jsonify({"error": "No file selected"}), 400

                    allowed_extensions = {'.xlsx', '.xls', '.xlsm', '.csv', '.txt', '.ods'}
                    file_ext = Path(file.filename).suffix.lower()
                    
                    if file_ext not in allowed_extensions:
                        return jsonify({
                            "error": f"Unsupported file type: {file_ext}. Allowed: {', '.join(allowed_extensions)}"
                        }), 400

                    print(f"Received file: {file.filename} ({file_ext})")

                    if file_ext in ['.xlsx', '.xls', '.xlsm', '.ods']:
                        read_kwargs = {}
                        if sheet_name:
                            read_kwargs['sheet_name'] = sheet_name

                        try:
                            df = pd.read_excel(file, **read_kwargs)
                        except ValueError as ve:
                            
                            if "No sheet named" in str(ve) or "is not in" in str(ve):
                                return jsonify({
                                    "error": f"Sheet '{sheet_name}' not found in the file. "
                                            
                                }), 400
                            raise
                    
                    elif file_ext in ['.csv', '.txt']:    
                        df = pd.read_csv(file)
                    else:
                        return jsonify({"error": f"Cannot process extension: {file_ext}"}), 400

                    columns = df.columns.tolist()

                    record_count = len(df)
                    
                    file.seek(0)  # ← Very important! Reset file pointer after pandas read

                    gridfs_id = self.fs.put(                           # or self.chatbot_agent.fs if you stored it there
                        file,
                        filename=file.filename,
                        index_name=index_name,                         # custom metadata
                        content_type=file.content_type or "application/octet-stream",
                        uploaded_at=datetime.utcnow().isoformat() + "Z",
                        # you can add more: original_ext=file_ext, etc.
                    )

                    file_metadata = {
                        "gridfs_id": str(gridfs_id),                   # store as string or ObjectId
                        "size_bytes": file.content_length,
                        "uploaded_at": datetime.utcnow().isoformat() + "Z",
                        "content_type": file.content_type,
                    }
                    
                agent_data={
                    "agent_id": onboarded_agent,
                    "agent_name": onboarded_agent_name
                }

                
                print("yes")
                
                if not existing_index:
                    index_id= str(uuid.uuid4())
                    file_id = str(uuid.uuid4())
                    insert_op = {
                        "type": "insert_one",
                        "document": {
                            "index_id": index_id,
                            "index_name": index_name,
                            "entity_type": entity_type,
                            "connector_type": connector_type,
                            "onboarded_agent": agent_data,
                            "column_mappings":column_mappings,
                            "dynamic_mappings": dynamic_fields,
                            "usecases": usecase_names,
                            "trends_usecases": trends_usecases,
                            "visualization": visualization,
                            "trends_visualization": trends_visualization,
                            "createdAt":createdAt,
                            "full_schema": full_schema_parsed,
                            "file_names": [file.filename],
                            "file_ids": [file_id],
                            "last_synced_at": "",
                            "ingested_at": datetime.utcnow().isoformat() + "Z",
                            "status": "active"
                        }
                    }
                    self.chatbot_agent._query_db('mcp_master', insert_op)

                    file_insert_op = {
                        "type": "insert_one",
                        "document": {
                            "index_id": index_id,
                            "index_name": index_name,
                            "file_name": file.filename,
                            "file_ids": file_id,
                            "sheet_name": sheet_name,
                            "file_data": file_metadata,
                            "record_count": record_count,
                            "all_columns": columns,
                            "column_mappings":column_mappings,
                            "dynamic_mappings": dynamic_fields,
                            "ingested_at": datetime.utcnow().isoformat() + "Z"
                        }
                        
                    }
                    self.chatbot_agent._query_db('mcp_files', file_insert_op)

                    

                else:
                    print("No")
                    new_files = []
                    current_files = existing_index.get('file_names', [])
                    total_records = existing_index.get('record_count', 0)
                    file_ids= existing_index.get('file_ids', [])
                    if file:
                        new_file_id = str(uuid.uuid4())
                        if current_files:
                        
                            file_ids = file_ids + [new_file_id]
                            new_files = current_files + [file.filename] 
                            total_records += record_count
                            
                        else:
                            new_files = [file.filename]  
                            total_records == total_records
                            file_ids = [new_file_id]

                    else:
                        new_files = current_files[0]
                        total_records = existing_index.get('record_count', 0)
                        file_ids == file_ids
                
                    update_op = {
                        "type": "update_one",
                        "filter": {
                            "index_name": index_name
                        },
                        "update": {
                            "$set": {
                                "file_names": current_files,
                                "file_ids": file_ids,
                                "record_count": total_records,
                                "entity_type": entity_type,
                                "connector_type": connector_type,
                                "onboarded_agent": agent_data,
                                "column_mappings":column_mappings,
                                "dynamic_mappings": dynamic_fields,
                                "usecases": usecase_names,
                                "trends_usecases": trends_usecases,
                                "visualization": visualization,
                                "trends_visualization": trends_visualization,
                                "ingested_at": datetime.utcnow().isoformat() + "Z"
                            }
                        }
                    }
                    self.chatbot_agent._query_db('mcp_master', update_op)
                    print("v!")
                    if file:
                        file_update_op = {
                            "type": "insert_one",
                            "document": {
                                "index_id": existing_index.get('index_id'),
                                "index_name": index_name,
                                "file_name": file.filename,
                                "file_ids": new_file_id,
                                "sheet_name": sheet_name,
                                "file_data": file_metadata,
                                "record_count": record_count,
                                "all_columns": columns,
                                "column_mappings":column_mappings,
                                "dynamic_mappings": dynamic_fields,
                                "ingested_at": datetime.utcnow().isoformat() + "Z"
                            }
                        }
                        self.chatbot_agent._query_db('mcp_files', file_update_op)

                    else:
                        file_update_op = {
                            "type": "update_one",
                            "filter": {
                                "index_name": index_name,
                                "file_name": new_files
                            },
                            "update": {
                                "$set": {
                                    "column_mappings":column_mappings,
                                    "dynamic_mappings": dynamic_fields,
                                    "all_columns": columns,
                                    "ingested_at": datetime.utcnow().isoformat() + "Z"
                                }
                            }
                        }
                        self.chatbot_agent._query_db('mcp_files', file_update_op)

            elif tool == 'jira':
                print("yes1")
                entity_type = data.get("entity_type") or request.form.get("entity_type")
                username = data.get("username") or request.form.get("username")
                jira_api_token = data.get("api_token") or request.form.get("api_token")
                connector_url = data.get("url") or request.form.get("url")
                project_key = data.get("project_key") or request.form.get("project_key")
                
                ENCRYPTION_KEY = self.encryption
                cipher_suite = Fernet(ENCRYPTION_KEY)
                find_op ={
                    "type": "find_one",
                    "filter": {
                        "index_name": index_name
                    }

                }
                existing_index = self.chatbot_agent._query_db('mcp_master', find_op)
                encrypted_api_token = jira_api_token
                if not existing_index:
                    encrypted_api_token = cipher_suite.encrypt(jira_api_token.encode('utf-8')).decode('utf-8')
                
            
                if entity_type.lower() == 'incident':
                    column_mappings={
                        "id": data.get("id") or request.form.get("id"),
                        "issue_type": data.get("issue_type") or request.form.get("issue_type"),
                        "application": data.get("application") or request.form.get("application"),
                        "created_date": data.get("created_date") or request.form.get("created_date"),
                        "resolved_date": data.get("resolved_date") or request.form.get("resolved_date"),
                        "description": data.get("description") or request.form.get("description"),
                        "resolution": data.get("resolution") or request.form.get("resolution"),
                        "root_cause": data.get("root_cause") or request.form.get("root_cause"),
                        "title": data.get("title") or request.form.get("title"),
                        "status": data.get("status") or request.form.get("status"),
                        "priority": data.get("priority") or request.form.get("priority"),
                        "severity": data.get("severity") or request.form.get("severity"),
                        "category": data.get("category") or request.form.get("category"),
                        "SLA": data.get("SLA", "") or request.form.get("SLA", ""),
                        "infra_system": data.get("infra_system") or request.form.get("infra_system")
                    }


                elif entity_type.lower() == 'defect':
                    column_mappings = {
                        "id": data.get("id") or request.form.get("id"),
                        "issue_type": data.get("issue_type") or request.form.get("issue_type"),
                        "application": data.get("application") or request.form.get("application"),
                        "created_date": data.get("created_date") or request.form.get("created_date"),
                        "resolved_date": data.get("resolved_date") or request.form.get("resolved_date"),
                        "description": data.get("description") or request.form.get("description"),
                        "resolution": data.get("resolution") or request.form.get("resolution"),
                        "root_cause": data.get("root_cause") or request.form.get("root_cause"),
                        "title": data.get("title") or request.form.get("title"),
                        "status": data.get("status") or request.form.get("status"),
                        "priority": data.get("priority") or request.form.get("priority"),
                        "severity": data.get("severity") or request.form.get("severity"),
                        "category" : data.get("category") or request.form.get("category"),
                        "epic": data.get("epic") or request.form.get("epic"),
                        "feature": data.get("feature") or request.form.get("feature"),
                        "expected_result": data.get("expected_result") or request.form.get("expected_result"),
                        "user_story": data.get("user_story") or request.form.get("user_story")
                    }
                    


                elif entity_type.lower() == 'testcase':
                    column_mappings = {
                        "id": data.get("id") or request.form.get("id"),
                        "issue_type": data.get("issue_type") or request.form.get("issue_type"),
                        "created_date": data.get("created_date") or request.form.get("created_date"),
                        "description": data.get("description") or request.form.get("description"),
                        "title": data.get("title") or request.form.get("title"),
                        "status": data.get("status") or request.form.get("status"),
                        "priority": data.get("priority") or request.form.get("priority"),
                        "severity": data.get("severity") or request.form.get("severity"),
                        "category": data.get("category") or request.form.get("category"),
                        "epic": data.get("epic") or request.form.get("epic"),
                        "feature": data.get("feature") or request.form.get("feature"),
                        "expected_result": data.get("expected_result") or request.form.get("expected_result"),
                        "user_story": data.get("user_story") or request.form.get("user_story")
                    }

              
                connector_type = request.form.get('connector_type') or data.get("connector_type")
                onboarded_agent = request.form.get('onboarded_agent') or data.get("onboarded_agent")
                onboarded_agent_name = request.form.get('onboarded_agent_name') or data.get("onboarded_agent_name")

                
                KNOWN_JIRA_FIELDS = {
                        "Issue Key",
                        "Issue id",
                        "Summary",
                        "Description",
                        "Assignee",
                        "Created",
                        "Resolved",
                        "Status",
                        "Priority",
                        "Severity",
                        "Category",
                        "Project name"
                    }
                
                
                CORE_FIELDS = {
                        "entity_type",
                        "username",
                        "api_token",
                        "url",
                        "project_key",
                        "index_name",
                        "connector_type",
                        "onboarded_agent",
                        "onboarded_agent_name",
                        "usecase",
                        "visualization",
                        "trends_visualization",
                        "trend_usecases",
                        "full_schema"
                    }
                
                
                dynamic_fields = {}

                for key, value in data.items():
                    if (
                        not column_mappings.get(key,"")
                        and key not in CORE_FIELDS
                        and value not in (None, "", [])
                    ):
                        dynamic_fields[key] = value



            

                if not index_name:
                    return jsonify({"error": "Missing required field: 'index_name'"}), 400

                find_op ={
                    "type": "find_one",
                    "filter": {
                        "index_name": index_name
                    }

                }
                existing_index = self.chatbot_agent._query_db('mcp_master', find_op)
                record_count = 0
                agent_data={
                    "agent_id": onboarded_agent,
                    "agent_name": onboarded_agent_name
                }

                # full_schema1 = {
                #     "record_id":"keyword",
                #     "issue_type":"keyword",
                #     "application":"keyword",
                #     "created":"datetime",
                #     "resolved":"datetime",
                #     "description":"keyword",
                #     "title":"keyword",
                #     "status":"keyword",
                #     "priority":"keyword",
                #     "severity":"keyword",
                #     "category":"keyword",
                #     "epic":"keyword",
                #     "feature":"keyword",
                #     "expected_result":"keyword",
                #     "user_story":"keyword",
                #     "expected_result":"keyword"


                # }
                # full_schema.update(full_schema1)
                
                
                if not existing_index:
                    print("yes")
                    index_id= str(uuid.uuid4())
                    file_id = str(uuid.uuid4())
                    insert_op = {
                        "type": "insert_one",
                        "document": {
                            "index_id": index_id,
                            "index_name": index_name,
                            "project_key": project_key,
                            "connector_url": connector_url,
                            "username": username,
                            "jira_api_token": encrypted_api_token,
                            "entity_type": entity_type,
                            "connector_type": connector_type,
                            "onboarded_agent": agent_data,
                            "column_mappings":column_mappings,
                            "dynamic_mappings": dynamic_fields,
                            "usecases": usecase_names,
                            "trends_usecases": trends_usecases,
                            "visualization": visualization,
                            "full_schema": full_schema_parsed,
                            "trends_visualization": trends_visualization,
                            "createdAt":createdAt,
                            "last_synced_at": "",
                            "ingested_at": datetime.utcnow().isoformat() + "Z",
                            "status": "active"
                        }
                    }
                    self.chatbot_agent._query_db('mcp_master', insert_op)

                    

                    

                else:
                    update_op = {
                        "type": "update_one",
                        "filter": {
                            "index_name": index_name
                        },
                        "update": {
                            "$set": {
                               
                                "entity_type": entity_type,
                                "connector_type": connector_type,
                                "onboarded_agent": agent_data,
                                "project_key": project_key,
                                "connector_url": connector_url,
                                "username": username,
                                "jira_api_token": encrypted_api_token,
                                "column_mappings":column_mappings,
                                "dynamic_mappings": dynamic_fields,
                                "usecases": usecase_names,
                                "trends_usecases": trends_usecases,
                                "visualization": visualization,
                                "full_schema": full_schema_parsed,
                                "trends_visualization": trends_visualization,
                                
                                "ingested_at": datetime.utcnow().isoformat() + "Z"
                            }
                        }
                    }
                    self.chatbot_agent._query_db('mcp_master', update_op)  
            

            elif tool == 'team_dynamix':
                entity_type = data.get("entity_type") or request.form.get("entity_type")
                username = data.get("username") or request.form.get("username")
                password = data.get("password") or request.form.get("password")
                connector_url = data.get("url") or request.form.get("url")
                app_id = data.get("app_id") or request.form.get("app_id")
                
                ENCRYPTION_KEY = self.encryption
                cipher_suite = Fernet(ENCRYPTION_KEY)
                find_op ={
                    "type": "find_one",
                    "filter": {
                        "index_name": index_name
                    }

                }
                existing_index = self.chatbot_agent._query_db('mcp_master', find_op)
                encrypted_password = password

                if existing_index:
                    encrypted_password = cipher_suite.encrypt(password.encode('utf-8')).decode('utf-8')
            
                if entity_type.lower() == 'incident':
                    column_mappings={
                        "id": data.get("id") or request.form.get("id"),
                        "issue_type": data.get("issue_type") or request.form.get("issue_type"),
                        "application": data.get("application") or request.form.get("application"),
                        "created_date": data.get("created_date") or request.form.get("created_date"),
                        "resolved_date": data.get("resolved_date") or request.form.get("resolved_date"),
                        "description": data.get("description") or request.form.get("description"),
                        "resolution": data.get("resolution") or request.form.get("resolution"),
                        "root_cause": data.get("root_cause") or request.form.get("root_cause"),
                        "title": data.get("title") or request.form.get("title"),
                        "status": data.get("status") or request.form.get("status"),
                        "priority": data.get("priority") or request.form.get("priority"),
                        "severity": data.get("severity") or request.form.get("severity"),
                        "category": data.get("category") or request.form.get("category"),
                        "SLA": data.get("SLA", "") or request.form.get("SLA", ""),
                        "infra_system": data.get("infra_system") or request.form.get("infra_system")
                    }


                elif entity_type.lower() == 'defect':
                    column_mappings = {
                        "id": data.get("id") or request.form.get("id"),
                        "issue_type": data.get("issue_type") or request.form.get("issue_type"),
                        "application": data.get("application") or request.form.get("application"),
                        "created_date": data.get("created_date") or request.form.get("created_date"),
                        "resolved_date": data.get("resolved_date") or request.form.get("resolved_date"),
                        "description": data.get("description") or request.form.get("description"),
                        "resolution": data.get("resolution") or request.form.get("resolution"),
                        "root_cause": data.get("root_cause") or request.form.get("root_cause"),
                        "title": data.get("title") or request.form.get("title"),
                        "status": data.get("status") or request.form.get("status"),
                        "priority": data.get("priority") or request.form.get("priority"),
                        "severity": data.get("severity") or request.form.get("severity"),
                        "category" : data.get("category") or request.form.get("category"),
                        "epic": data.get("epic") or request.form.get("epic"),
                        "feature": data.get("feature") or request.form.get("feature"),
                        "expected_result": data.get("expected_result") or request.form.get("expected_result"),
                        "user_story": data.get("user_story") or request.form.get("user_story")
                    }
                    


                elif entity_type.lower() == 'testcase':
                    column_mappings = {
                        "id": data.get("id") or request.form.get("id"),
                        "issue_type": data.get("issue_type") or request.form.get("issue_type"),
                        "created_date": data.get("created_date") or request.form.get("created_date"),
                        "description": data.get("description") or request.form.get("description"),
                        "title": data.get("title") or request.form.get("title"),
                        "status": data.get("status") or request.form.get("status"),
                        "priority": data.get("priority") or request.form.get("priority"),
                        "severity": data.get("severity") or request.form.get("severity"),
                        "category": data.get("category") or request.form.get("category"),
                        "epic": data.get("epic") or request.form.get("epic"),
                        "feature": data.get("feature") or request.form.get("feature"),
                        "expected_result": data.get("expected_result") or request.form.get("expected_result"),
                        "user_story": data.get("user_story") or request.form.get("user_story")
                    }
              
                connector_type = request.form.get('connector_type') or data.get("connector_type")
                onboarded_agent = request.form.get('onboarded_agent') or data.get("onboarded_agent")
                onboarded_agent_name = request.form.get('onboarded_agent_name') or data.get("onboarded_agent_name")

                
                KNOWN_TDX_FIELDS = {
                        "Ticket_id",
                        "title",
                        "description",
                        "opened",
                        "resolved",
                        "status",
                        "priority",
                        "severity",
                        "category"
                    }
                
                
                CORE_FIELDS = {
                        "entity_type",
                        "username",
                        "password",
                        "url",
                        "app_id",
                        "index_name",
                        "connector_type",
                        "onboarded_agent",
                        "onboarded_agent_name",
                        "usecase",
                        "visualization",
                        "trends_visualization",
                        "trend_usecases",
                        "full_schema"
                    }
                
                
                dynamic_fields = {}

                for key, value in data.items():
                    if (
                        not column_mappings.get(key,"")
                        and key not in CORE_FIELDS
                        and value not in (None, "", [])
                    ):
                        dynamic_fields[key] = value


            

                if not index_name:
                    return jsonify({"error": "Missing required field: 'index_name'"}), 400

                find_op ={
                    "type": "find_one",
                    "filter": {
                        "index_name": index_name
                    }

                }
                existing_index = self.chatbot_agent._query_db('mcp_master', find_op)
                record_count = 0
                agent_data={
                    "agent_id": onboarded_agent,
                    "agent_name": onboarded_agent_name
                }

                
                
                
                if not existing_index:
                    print("yes")
                    index_id= str(uuid.uuid4())
                    file_id = str(uuid.uuid4())
                    insert_op = {
                        "type": "insert_one",
                        "document": {
                            "index_id": index_id,
                            "index_name": index_name,
                            "app_id": app_id,
                            "connector_url": connector_url,
                            "username": username,
                            "password": encrypted_password,
                            "entity_type": entity_type,
                            "connector_type": connector_type,
                            "onboarded_agent": agent_data,
                            "column_mappings":column_mappings,
                            "dynamic_mappings": dynamic_fields,
                            "usecases": usecase_names,
                            "trends_usecases": trends_usecases,
                            "visualization": visualization,
                            "trends_visualization": trends_visualization,
                            "full_schema": full_schema_parsed,
                            "createdAt":createdAt,
                            "last_synced_at": "",
                            "ingested_at": datetime.utcnow().isoformat() + "Z",
                            "status": "active"
                        }
                    }
                    self.chatbot_agent._query_db('mcp_master', insert_op)

                    

                    

                else:
                    update_op = {
                        "type": "update_one",
                        "filter": {
                            "index_name": index_name
                        },
                        "update": {
                            "$set": {
                               
                                "entity_type": entity_type,
                                "connector_type": connector_type,
                                "onboarded_agent": agent_data,
                                "app_id": app_id,
                                "connector_url": connector_url,
                                "username": username,
                                "password": encrypted_password,
                                "column_mappings":column_mappings,
                                "dynamic_mappings": dynamic_fields,
                                "usecases": usecase_names,
                                "trends_usecases": trends_usecases,
                                "visualization": visualization,
                                "trends_visualization": trends_visualization,
                                "ingested_at": datetime.utcnow().isoformat() + "Z"
                            }
                        }
                    }
                    self.chatbot_agent._query_db('mcp_master', update_op)  
             

                
            return jsonify({
                "status": "success",
                "message": f"Successfully saved details for index '{index_name}'",
               
            }), 200

        except Exception as e:
            print(f"Ingestion Error: {e}")
            return jsonify({"error": str(e)}), 500

    @require_session
    @daily_limit(limit_count=insight_limit)
    def call_agent_insight_new_cases(self):
        
        req_data = request.json
        
        start_date = req_data.get('start_date')
        end_date   = req_data.get('end_date')
        index_name = req_data.get('index_name')
        index_id = req_data.get('index_id')
        agent_id = req_data.get('agent_id')
        entity = req_data.get('entity','')
        run_id = req_data.get('run_id',"")
        page_name= req_data.get('page_name',"")
        usecase = req_data.get("usecases","")
        print("usecase",usecase)
        usecase_name = usecase[0]
        print("usecase_name",usecase_name)
        agent_data = self.agent_collection.find_one({"api_agent_id": agent_id,"isDeleted":{"$ne":True}}) if agent_id else None
        api_key = agent_data.get("agent_api_key") if agent_data else None
        session_id = agent_data.get("agent_session_id") if agent_data else None
        user_id = agent_data.get("user_id") if agent_data else None
        api_url = agent_data.get("agent_api_url") if agent_data else None
        agent_name = agent_data.get("name") if agent_data else None
        

        if not start_date or not end_date:
            return jsonify({"error": "Payload must contain 'start_date' and 'end_date'"}), 400

        
        try:
            start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
            end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
        except Exception as e:
            return jsonify({"error": f"Invalid date format: {str(e)}"}), 400

        
        try:
            # 1. Look up the specific usecase configuration
            result = self.mcp_usecase_collection.find_one({"index_name": index_name, "usecase_name": usecase_name})
            if not result:
                return jsonify({"error": f"Usecase '{usecase_name}' not found for index '{index_name}'"}), 404

            # 2. Extract visualization and schema details
            viz_obj = result.get("visualization", {})
            usecase_viz_settings = viz_obj.get(usecase_name, {})
            dataset_key = usecase_viz_settings.get("dataset")

            structured_config = result.get("structured_config", {})
            selected_structure = structured_config.get("selected_json_structure", {})
            schema = selected_structure.get("schema", {})

            # Filter the schema based on the dataset_key
            final_data = {}
            if dataset_key and dataset_key in schema:
                final_data = {dataset_key: schema[dataset_key]}
            else:
                final_data = schema

            # 3. Construct the Query
            base_phrase = f"from {start_date} to {end_date}"
            last_phrase = f"for index {index_name}" if index_name else ""
            query = f"{usecase_name} {base_phrase} {last_phrase} {final_data}"

            # 4. Execute Agent Query
            print("Running agent query:", query)
            agent_result = self.get_agent_execution_context(
                query=query,
                start_date=start_date,
                end_date=end_date,
                user_id=user_id,
                session_id=session_id,
                agent_id=agent_id,
                api_key=api_key,
                api_url=api_url
            )

            raw = agent_result.get('response', '') if agent_result else ''
            parsed = self.extract_and_parse_json(raw)

            if isinstance(parsed, dict) and "error" in parsed:
                print(f"Error parsing JSON for query: {parsed['error']}")
                parsed = []

            # 5. Build Response Structure
            combined = {
                "overview": {
                    "title": f"Insight: {usecase_name}",
                    "date_range": f"{start_date} – {end_date}",
                    "generated_at": datetime.now().isoformat(timespec='seconds'),
                    "timezone": "Asia/Kolkata"
                },
                usecase_name: parsed,
                "errors": []
            }

            response = {
                "agent_execution": combined
            }
            combined_response = {}
            combined_response[usecase_name] = response.get("agent_execution", {}) if response else {"error": "No response"}

            # 6. Store in KPI History
            self.store_kpi_history(
                run_id=run_id, 
                page_name=page_name, 
                entity=entity, 
                start=start, 
                end=end, 
                agent_name=agent_name, 
                index_name=index_name, 
                key=response
            )

            return jsonify({
                "status": "success",
                "data": combined_response
            }), 200

        except Exception as e:
            print(f"Error analyzing : {e}")
            return jsonify({"error": str(e)}), 500

    @require_session
    def get_trends_usecase(self):
        try:
            req_data = request.json
            start_date = req_data.get('start_date')
            end_date   = req_data.get('end_date')
            run_id = req_data.get('run_id',"")
            index_name = req_data.get('index_name','')
            entity = req_data.get('entity','')
            page_name= req_data.get('page_name',"")
            usecase_name = req_data.get("usecase_name")
            try:
                start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).date().isoformat()
                end   = datetime.fromisoformat(end_date.replace("Z", "+00:00")).date().isoformat()
            except Exception as e:
                return ({"error": f"Invalid date format: {str(e)}"}), 400
            
            response = self.insight_manager.fetch_response_details(req_data)
            combined = {
                usecase_name: response
            }
            # responses = {
            #     "agent_execution": combined
            # }
            self.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity, start=start, end=end, agent_name="", index_name=index_name, key=combined)
            return buildResponse("success", response, 200)
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        

    @require_session
    def delete_usecase(self):
        try:
            data = request.json
            index_id = data.get("index_id","")
            usecase_name = data.get("usecase_name","")
            if usecase_name:
                self.mcp_usecase_collection.delete_one({"index_id": index_id, "usecase_name": usecase_name})

            
                self.mcp_master_collection.update_one(
                            {"index_id": index_id},
                            {"$pull": {"usecases": usecase_name}}
                        )
                
            

            return jsonify({
                "status": "success",
                "message":"Use case deleted successfully from index"
            }), 200



        except Exception as e:
            print(f"Delete Use Case Error: {e}")
            return jsonify({"error": str(e)}), 500
  


    def normalize_rows(self,row,id,opened,resolved,description,title,created,status,priority,severity,category,entity,application,root_cause,resolution,infra_system,**kwargs):
        
        if created == "Date Created":
            
            date_val = row.get("created")
            
        else:
            print("date")
            date_val = row.get(created)
            
        # date_val = row.get("created")
         
        
        resolved_val = row.get(resolved)

        mttr_seconds = 0
        resolved_iso = None
        ts_created = pd.to_datetime(date_val, errors='raise', utc=True)
        if pd.notna(resolved_val) and str(resolved_val).strip():
            try:
                # ts_created = pd.to_datetime(date_val, errors='raise', utc=True)
                ts_resolved = pd.to_datetime(resolved_val, errors='raise', utc=True)
                
                # Only calculate MTTR if both dates are valid and resolved > created
                if pd.notna(ts_resolved) and ts_resolved > ts_created:
                    duration = (ts_resolved - ts_created).total_seconds()
                    mttr_seconds = max(0, int(duration))
                
                resolved_iso = ts_resolved.isoformat()   # only set if parsing succeeded
                
            except Exception as e:
                
                resolved_iso = None  
                mttr_seconds = 0

        
        short_desc = str(row.get(title)).strip()
        description = str(row.get(description))
        category = str(row.get(category)).strip()
        
        
        subcat = str(row.get('Subcategory', ''))
        if subcat == 'nan' or not subcat:
            subcat = str(row.get('Subcategory.1', '')) 
        
       
        issue_key = f"{category} | {subcat} | {short_desc.lower()}"

    
        raw_sla = str(row.get('Made SLA', 'false')).strip().upper()
        sla_bool = True if raw_sla == 'TRUE' else False

     
        priority = str(row.get(priority)).strip()
        
        
        severity = str(row.get(severity)).strip()
        if not severity or severity.lower() == 'nan':
            severity = priority 
        
        epic = kwargs.get("epic","")
        feature = kwargs.get("feature","")
        user_story = kwargs.get("user_story","")
        expected_result = kwargs.get("expected_result","")
        
        if entity == "incident":
        
            result = {
                "record_id": str(row.get(id)),
                "source": "ITSM_Export",
                "issue_type": entity,
                "created_at": ts_created.isoformat(), 
                "created": ts_created.isoformat(),
                "title": short_desc,
                "description": description,
                "resolved_at": resolved_iso, 
                "mttr_seconds": mttr_seconds,
                "status": str(row.get(status, '')).strip(), 
                "priority": priority,
                "severity": severity,
                "category": category,
                "subcategory": subcat,
                "issue_key": issue_key,
                "is_sla_met": sla_bool,
                "application": str(row.get(application)).strip(),
                "root_cause": str(row.get(root_cause)).strip(),
                "resolution": str(row.get(resolution)).strip(),
                "infra_system": str(row.get(infra_system)).strip()
            }

        else:
            result = {
                "record_id": str(row.get(id)),
                "source": "ITSM_Export",
                "type": entity,
                "created_at": ts_created.isoformat(), 
                "created": ts_created.isoformat(),
                "title": short_desc,
                "description": description,
                "resolved_at": resolved_iso, 
                "mttr_seconds": mttr_seconds,
                "status": str(row.get(status, '')).strip(), 
                "priority": priority,
                "severity": severity,
                "category": category,
                "subcategory": subcat,
                "issue_key": issue_key,
                "is_sla_met": sla_bool,
                "application": str(row.get(application)).strip(),
                "root_cause": str(row.get(root_cause)).strip(),
                "resolution": str(row.get(resolution)).strip(),
                "infra_system": str(row.get(infra_system)).strip(),
                "epic": str(row.get(epic)).strip(),
                "feature": str(row.get(feature)).strip(),
                "user_story": str(row.get(user_story)).strip(),
                "expected_result": str(row.get(expected_result)).strip()
            }

        # for col, value in row.items():
            # # Skip if it's None/NaN → or you can keep as None
            # if pd.isna(value):
                # clean_value = None
            # else:
                # clean_value = str(value).strip()
            
            # # Avoid overwriting normalized fields
            # if col in result:
                # result[f"raw_{col}"] = clean_value
            # else:
                # result[col] = clean_value
        
        for col, value in row.items():
            # Skip if it's None/NaN → or you can keep as None
            if pd.isna(value):
                clean_value = None
            else:
                clean_value = str(value).strip()
            
            # Avoid overwriting normalized fields
            if col in result:
                result[f"raw_{col}"] = clean_value
            else:
                result[col] = clean_value
        
        return result

    def jira_normalize(self,row,entity):

        date_val = row.get("Created")
        ts_created = pd.to_datetime(date_val, errors='raise', utc=True)
        resolved_val = row.get("Resolved")
        raw_sla = str(row.get('Made SLA', 'false')).strip().upper()
        sla_bool = True if raw_sla == 'TRUE' else False
        mttr_seconds = 0
        resolved_iso = None
        ts_created = pd.to_datetime(date_val, errors='raise', utc=True)
        if pd.notna(resolved_val) and str(resolved_val).strip():
            try:
                # ts_created = pd.to_datetime(date_val, errors='raise', utc=True)
                ts_resolved = pd.to_datetime(resolved_val, errors='raise', utc=True)
                
                # Only calculate MTTR if both dates are valid and resolved > created
                if pd.notna(ts_resolved) and ts_resolved > ts_created:
                    duration = (ts_resolved - ts_created).total_seconds()
                    mttr_seconds = max(0, int(duration))
                
                resolved_iso = ts_resolved.isoformat()   # only set if parsing succeeded
                
            except Exception as e:
                
                resolved_iso = None  
                mttr_seconds = 0

        result = {
                    "record_id": str(row.get("Issue key")),
                    "source": "ITSM_Export",
                    "issue_type": entity,
                    "created_at": ts_created.isoformat(), 
                    "created": ts_created.isoformat(),
                    "title": row.get("Summary"),
                    "description": row.get("Summary"),
                    "resolved_at": resolved_iso, 
                    "mttr_seconds": mttr_seconds,
                    "status": str(row.get("Status", '')).strip(), 
                    "priority": row.get("Priority"),
                    "severity": row.get("Priority"),
                    "category": row.get("Summary"),
                    
                    "issue_key": row.get("Issue key"),
                    "is_sla_met": sla_bool,
                    "epic": row.get("Related Epics", " ").strip(),
                    "feature": row.get("Related Features", " ").strip(),
                    "user_story": row.get("Related User Stories", " ").strip(),
                    "expected_result": row.get("Description", " ").strip(),
                }

        for col, value in row.items():
            # Skip if it's None/NaN → or you can keep as None
            if pd.isna(value):
                clean_value = None
            else:
                clean_value = str(value).strip()
            
            # Avoid overwriting normalized fields
            if col in result:
                result[f"raw_{col}"] = clean_value
            else:
                result[col] = clean_value

        return result
        
    def extract_issue_keys(self, df):
        """Scans all relation columns to extract Jira keys"""
        keys = set()
        link_cols =[c for c in df.columns if any(keyword in c.lower() for keyword in ['issue link', 'parent', 'epic link'])]
        for col in link_cols:
            for cell in df[col].dropna().astype(str):
                found_keys = re.findall(r'[A-Z][A-Z0-9]+-\d+', cell)
                keys.update(found_keys)
        return keys

    def fetch_specific_issues(self, keys_list, connector_url, api_token, username, prefix):
        df_list = []
        keys_list = list(set(keys_list)) 
        for i in range(0, len(keys_list), 100):
            chunk = keys_list[i:i+100]
            jql = f'issueKey IN ({",".join(chunk)})'
            
            # This might return a dict or None
            result = self.fetch_jira_issues(jql, connector_url, api_token, username, f"{prefix}_{i}")
            
            # VALIDATION: Check if result is a string (path) and not a dict/None
            if isinstance(result, str) and os.path.exists(result):
                df_chunk = pd.read_csv(result, low_memory=False)
                df_list.append(df_chunk)
                os.remove(result)
            elif isinstance(result, dict):
                print(f"Error fetching batch: {result.get('error')}")
                
        return pd.concat(df_list, ignore_index=True) if df_list else pd.DataFrame()
        

    def fetch_jira_issues(self, jql_query, connector_url, api_token, username, filename_prefix="jira"):
        try:
            temp_files = []
            start_at = 0
            PAGE_SIZE = 1000
            
            auth_str = f"{username}:{api_token}"
            auth_b64 = base64.b64encode(auth_str.encode('utf-8')).decode('utf-8')
            headers = {'Authorization': f'Basic {auth_b64}', 'Accept': 'text/csv'}

            while True:
                jql_encoded = requests.utils.quote(jql_query)
                url = (f"{connector_url}/sr/jira.issueviews:searchrequest-csv-all-fields/temp/SearchRequest.csv?"
                       f"jqlQuery={jql_encoded}&tempMax={PAGE_SIZE}&pager/start={start_at}")

                try:
                    response = requests.get(url, headers=headers, timeout=30)
                    
                    if response.status_code != 200:
                        print(f"DEBUG: Jira Error {response.status_code}: {response.text[:200]}")
                        if response.status_code == 400:
                            return jsonify({"error": "Api token expired/Unexpected Jira API error"}),500
                        
                        
                    
                        

                    csv_content = response.text.strip()
                    # Use pandas to check actual row count
                    # Use io.StringIO to treat the string like a file
                    df_check = pd.read_csv(io.StringIO(csv_content), low_memory=False)
                    
                    if df_check.empty:
                        break

                    temp_path = f"temp_{filename_prefix}_{start_at}.csv"
                    df_check.to_csv(temp_path, index=False, encoding='utf-8')
                    temp_files.append(temp_path)

                    # If we fetched fewer issues than the page size, we are finished
                    if len(df_check) < PAGE_SIZE:
                        break

                    start_at += PAGE_SIZE
                    
                except Exception as e:
                    print(f"Error during fetch: {e}")
                    break

            # Combine CSVs (header from first, data from all)
            combined_path = f"temp_{filename_prefix}_combined.csv"
            with open(combined_path, 'w', encoding='utf-8') as outfile:
                with open(temp_files[0], 'r', encoding='utf-8') as first:
                    outfile.write(first.readline())  # header

                for tf in temp_files:
                    with open(tf, 'r', encoding='utf-8') as infile:
                        next(infile)  # skip header
                        outfile.write(infile.read())

            # Cleanup
            for tf in temp_files:
                try:
                    os.remove(tf)
                except:
                    pass

            return combined_path
            
        except Exception as e:
            print(f"Error obtaining TDX token: {e}")

    def summarize_issues(self,df):
        """Create a simple summary dict from a DataFrame of Jira issues"""
        if df.empty:
            return {
                "count": 0,
                "sample": []
            }

        base_cols =[
            'Issue key', 'Issue id', 'Issue Type', 'Project name', 'Summary','Description', 
            'Created', 'Resolved', 'Status', 'Priority', 'Assignee',
            'Parent', 'Parent key', 'Parent summary', 
            'Related User Stories', 'Related Story Summaries', 
            'Related Epics', 'Related Epic Summaries'
        ]

        
        useful_cols = base_cols
        available_cols = [c for c in useful_cols if c in df.columns]

        sample_df = df[available_cols]

        return sample_df
    
    def teamdynamics_normalize(self,row,entity):

        date_val = row.get("Created")
        ts_created = pd.to_datetime(date_val, errors='raise', utc=True)
        resolved_val = row.get("Resolved")
        raw_sla = str(row.get('Made SLA', 'false')).strip().upper()
        sla_bool = True if raw_sla == 'TRUE' else False
        mttr_seconds = 0
        resolved_iso = None
        ts_created = pd.to_datetime(date_val, errors='raise', utc=True)
        if pd.notna(resolved_val) and str(resolved_val).strip():
            try:
                # ts_created = pd.to_datetime(date_val, errors='raise', utc=True)
                ts_resolved = pd.to_datetime(resolved_val, errors='raise', utc=True)
                
                # Only calculate MTTR if both dates are valid and resolved > created
                if pd.notna(ts_resolved) and ts_resolved > ts_created:
                    duration = (ts_resolved - ts_created).total_seconds()
                    mttr_seconds = max(0, int(duration))
                
                resolved_iso = ts_resolved.isoformat()   # only set if parsing succeeded
                
            except Exception as e:
                
                resolved_iso = None  
                mttr_seconds = 0

        result = {
                    "record_id": str(row.get("Ticket_id")),
                    "source": "TeamDynamics_Export",
                    "issue_type": row.get("issue_type"),
                    "created_at": ts_created.isoformat(), 
                    "created": row.get("Created"),
                    "title": row.get("title"),
                    "description": row.get("description"),
                    "resolved_at": resolved_iso, 
                    "mttr_seconds": mttr_seconds,
                    "status": str(row.get("status", '')).strip(), 
                    "priority": row.get("priority"),
                    "severity": row.get("priority"),
                    "category": row.get("category"),
                    "is_sla_met": sla_bool
                }

        # for col, value in row.items():
            # # Skip if it's None/NaN → or you can keep as None
            # if pd.isna(value):
                # clean_value = None
            # else:
                # clean_value = str(value).strip()
            
            # # Avoid overwriting normalized fields
            # if col in result:
                # result[f"raw_{col}"] = clean_value
            # else:
                # result[col] = clean_value

        return result
    
    def get_tdx_token(self,connector_url,username,password):

        service = self.IsServiceMode

        if service:
            auth_url = f"{connector_url}/api/auth/loginadmin"
            payload = {
                "BEID": username,
                "WebServicesKey": password
            }

        else:
            auth_url = f"{connector_url}/api/auth"
            payload = {
                "username": username,
                "password": password
            }


        
        headers = {"Content-Type": "application/json"}
        
        resp = requests.post(auth_url, json=payload, headers=headers)
        if resp.status_code != 200:
            raise Exception(f"TDX auth failed: {resp.status_code} - {resp.text}")
        
        # data = resp.json()
        return resp

    def fetch_tdx_tickets(self, app_id, username, password, connector_url, start_date, end_date, filters=None):
        """
        Pulls historical tickets by dynamically splitting date ranges to bypass 
        TDX limits, with production-grade retry, rate-limit, and token refresh handling.
        
        start_date format: '2020-01-01'
        end_date format: '2024-12-31'
        """
        logger = logging.getLogger(__name__)
        
        if filters is None:
            filters = {}

        requested_app_id = app_id
        if requested_app_id is None:
                app_id = 288
        
        # Initial Authentication
        token = self.get_tdx_token(connector_url, username, password)
        search_url = f"{connector_url}/api/{app_id}/tickets/search"
        
        # Store unique tickets by ID to automatically prevent duplicates
        all_tickets_dict = {}
        
        # Parse inputs to datetime objects
        start_dt = pd.to_datetime(start_date).to_pydatetime()
        end_dt = pd.to_datetime(end_date).to_pydatetime()
        
        # Safely set end_dt to the very end of that day
        end_dt = end_dt.replace(hour=23, minute=59, second=59)
        
        max_limit = 500  # Safe maximum results limit per TDX request

        print(f"Starting historical extraction from {start_date} to {end_date}...")

        def pull_range(t_start, t_end):
            nonlocal token # Allows modifying the token variable in the outer scope on 401
            
            start_str = t_start.strftime("%Y-%m-%dT%H:%M:%SZ")
            end_str = t_end.strftime("%Y-%m-%dT%H:%M:%SZ")
            
            body = {
                **filters,
                "CreatedDateFrom": start_str,
                "CreatedDateTo": end_str,
                "MaxResults": max_limit
            }
            
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
            
            while True:
                try:
                    resp = requests.post(search_url, json=body, headers=headers, timeout=30)
                except requests.exceptions.RequestException as e:
                    print(f"Network error, retrying in 5 seconds... {e}")
                    time.sleep(5)
                    continue

                # Handle Token Expiration mid-pull
                if resp.status_code == 401:
                    print("Token expired! Obtaining a new token...")
                    token = self.get_tdx_token(connector_url, username, password)
                    headers["Authorization"] = f"Bearer {token}"
                    continue
                
                # Handle API rate limits
                if resp.status_code == 429:
                    print("Rate limit reached (429). Pausing for 5 seconds...")
                    time.sleep(5)
                    continue

                if resp.status_code != 200:
                    raise Exception(f"API Failed: {resp.status_code} - {resp.text}")
                
                data = resp.json()
                break  # Exit the retry loop once we have a successful 200 response

            # If we hit the limit, we split the date range in half and try both sides.
            # We stop splitting if the range is already smaller than 1 day.
            if len(data) >= max_limit and (t_end - t_start) > timedelta(days=1):
                mid_point = t_start + (t_end - t_start) / 2
                print(f"Limit of {max_limit} reached for range [{start_str} to {end_str}]. Splitting interval in half...")
                
                # Recursively pull both halves
                pull_range(t_start, mid_point)
                pull_range(mid_point, t_end)
            else:
                # If under the limit, we captured everything in this interval safely
                for ticket in data:
                    all_tickets_dict[ticket.get("ID")] = ticket
                print(f"Collected {len(data)} records for range [{start_str} to {end_str}]. Total so far: {len(all_tickets_dict)}")

        # Start the recursive pull process
        pull_range(start_dt, end_dt)
        
        # Stitch the unique records together
        all_stitched_rows = []
        for ticket in all_tickets_dict.values():
            is_violated = ticket.get("IsSlaViolated")
            all_stitched_rows.append({
                "Ticket_id": ticket.get("ID"),
                "issue_type": ticket.get("ClassificationName") or ticket.get("TypeName"),
                "application": ticket.get("ServiceName"),
                "Created": ticket.get("CreatedDate"),
                "Resolved": ticket.get("CompletedDate"),
                "description": ticket.get("Description", ""),
                "title": ticket.get("Title"),
                "status": ticket.get("StatusName"),
                "priority": ticket.get("PriorityName"),
                "severity": ticket.get("UrgencyName") or ticket.get("ImpactName"),
                "category": ticket.get("ServiceCategoryName") or ticket.get("TypeCategoryName"),
                "Made SLA": not is_violated if is_violated is not None else None,
                "infra_system": None
            })

        print(f"Done! Stitching {len(all_stitched_rows)} total records into a DataFrame.")
        df = pd.DataFrame(all_stitched_rows)
        
        if not df.empty:
            df['Created'] = pd.to_datetime(df['Created'], errors='coerce')
            df['Resolved'] = pd.to_datetime(df['Resolved'], errors='coerce')
            
        return df



    # def fetch_tdx_tickets(self,app_id,username,password,connector_url,filters= None):
        
    #     if filters is None:
    #         filters = {}
    #     requested_app_id = app_id
    #     if requested_app_id is None:
    #          app_id = 288

    #     token = self.get_tdx_token(connector_url,username,password)
    #     search_url = f"{connector_url}/api/{app_id}/tickets/search"
    #     headers = {
    #         "Authorization": f"Bearer {token}",
    #         "Content-Type": "application/json"
    #     }
        
    #     all_tickets = []
    #     page = 1
    #     page_size = 300  # adjust, max often 100-200
        
    #     body = {
    #         **filters,
    #         "Page": page,
    #         "PageSize": page_size
    #     }
        
    #     resp = requests.post(search_url, json=body, headers=headers)
    #     if resp.status_code != 200:
    #         raise Exception(f"TDX search failed: {resp.status_code} - {resp.text}")
        
    #     data = resp.json()
    #     all_tickets.extend(data)
        
    #     # Flatten to DataFrame-friendly dicts
    #     rows = []
    #     for ticket in all_tickets:
    #         rows.append({
    #             "Ticket_id": ticket.get("ID"),
    #             "issue_type": ticket.get("ClassificationName") or ticket.get("TypeName"),
    #             "application": ticket.get("ServiceName"),
    #             "Created": ticket.get("CreatedDate"),
    #             "Resolved": ticket.get("CompletedDate"),
    #             "description": ticket.get("Description", ""),  # often empty here → may need /api/{app}/tickets/{id}/feed
    #             "resolution": None,           # ← usually not here; fetch from ticket feed/replies or custom attr
    #             "root_cause": None,           # ← custom field or note
    #             "title": ticket.get("Title"),
    #             "status": ticket.get("StatusName"),
    #             "priority": ticket.get("PriorityName"),
    #             "severity": ticket.get("UrgencyName") or ticket.get("ImpactName"),
    #             "category": ticket.get("ServiceCategoryName") or ticket.get("TypeCategoryName"),
    #             "Made SLA":ticket.get("IsSlaViolated"),
    #             "infra_system": None   # or custom field if different meaning
    #         })
        
       
    #     df = pd.DataFrame(rows)
    #     if not df.empty:
    #         df['Created'] = pd.to_datetime(df['Created'], errors='coerce')
    #         df['Resolved'] = pd.to_datetime(df['Resolved'], errors='coerce')
        
    #     return df


    # def mask_pii_content(self, text):
        # if not isinstance(text, str):
            # return text

        # # Define PII Patterns
        # patterns = {
            # "EMAIL": r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+',
            # "PHONE": r'(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4,6}', # Handles +91, international, and local
            # "AADHAAR": r'\b\d{4}\s\d{4}\s\d{4}\b|\b\d{12}\b',
            # "PAN": r'\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b',
            # "SSN": r'\b\d{3}-\d{2}-\d{4}\b',
            # "IP_ADDRESS": r'\b(?:\d{1,3}\.){3}\d{1,3}\b',
            # "CREDIT_CARD": r'\b(?:\d[ -]*?){13,16}\b'
        # }

        # masked_text = text
        # for pii_type, pattern in patterns.items():
            # # We replace the found PII with a label like [MASKED_EMAIL]
            # masked_text = re.sub(pattern, f"[{pii_type}_REDACTED]", masked_text)
        
        # return masked_text

    # def apply_pii_masking_to_doc(self, doc):
        # """
        # Iterates through the normalized document and masks string fields.
        # Skips technical fields that shouldn't be touched (IDs, Dates, etc.)
        # """
        # # Fields that should NOT be masked because they are used for indexing/metadata
        # protected_fields = {'record_id', 'created_at', 'resolved_at', 'mttr_seconds', 'is_sla_met', 'combined_vector'}

        # for key, value in doc.items():
            # if key in protected_fields:
                # continue
            
            # if isinstance(value, str):
                # doc[key] = self.mask_pii_content(value)
            # elif isinstance(value, dict):
                # doc[key] = self.apply_pii_masking_to_doc(value)
                
        # return doc
    

    def mask_pii_content(self, text):
        if not isinstance(text, str):
            return text

        # --- EMAIL MASKING ---
        # Result: vinay@gmail.com -> v****@gmail.com
        def mask_email(match):
            user = match.group(1)        # 'vinay'
            domain_name = match.group(2) # 'gmail'
            extension = match.group(3)   # '.com' or '.co.in'
            
            # 1. Mask User: First char + three stars (v***)
            first_char = user[0] if len(user) > 0 else ""
            masked_user = f"{first_char}***"
            
            # 2. Mask Domain: Two stars + the original extension (** + .com)
            # If there is no extension (e.g. vinay@gmail), it just returns **
            ext = extension if extension else ""
            masked_domain = f"**{ext}"
            
            return f"{masked_user}@{masked_domain}"

        # --- PHONE MASKING ---
        # Result: +91 9876543210 -> +91 ******3210
        def mask_phone(match):
            full_phone = match.group(0)
            if len(full_phone) <= 4:
                return "****"
            return f"{'*' * (len(full_phone)-4)}{full_phone[-4:]}"

        # --- GENERIC 4-DIGIT MASK (Aadhaar, SSN, PAN, Card) ---
        def mask_generic(match):
            val = match.group(0).replace(" ", "").replace("-", "")
            return f"{'*' * (len(val)-4)}{val[-4:]}"

        # Define Regex Patterns with Groups
        # Email: Group 1 is username, Group 2 is domain
        # email_pattern = r'([a-zA-Z0-9_.+-]+)@([a-zA-Z0-9-.]+\.?[a-zA-Z0-9-]*)'
        email_pattern = r'([a-zA-Z0-9_.+-]+)@([a-zA-Z0-9-]+)(\.[a-zA-Z0-9-.]*)?'
        
        # Phone: Matches international and local
        phone_pattern = r'(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{4,6}'
        
        # Aadhaar/PAN/SSN/Credit Card
        aadhaar_pattern = r'\b\d{4}\s\d{4}\s\d{4}\b|\b\d{12}\b'
        pan_pattern = r'\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b'
        ssn_pattern = r'\b\d{3}-\d{2}-\d{4}\b'
        card_pattern = r'\b(?:\d[ -]*?){13,16}\b'
        
        # IP Address: 192.168.1.1 -> 192.168.*.*
        ip_pattern = r'\b(\d{1,3}\.\d{1,3}\.)\d{1,3}\.\d{1,3}\b'

        masked_text = text
        
        # Apply Email Mask
        masked_text = re.sub(email_pattern, mask_email, masked_text)
        
        # Apply Phone Mask
        masked_text = re.sub(phone_pattern, mask_phone, masked_text)
        
        # Apply Generic (Last 4) Mask
        masked_text = re.sub(aadhaar_pattern, mask_generic, masked_text)
        masked_text = re.sub(pan_pattern, mask_generic, masked_text)
        masked_text = re.sub(ssn_pattern, mask_generic, masked_text)
        masked_text = re.sub(card_pattern, mask_generic, masked_text)
        
        # Apply IP Mask
        masked_text = re.sub(ip_pattern, r'\1*.*', masked_text)
        
        return masked_text

    def apply_pii_masking_to_doc(self, doc):
        protected_fields = {'record_id', 'created_at', 'resolved_at', 'mttr_seconds', 'is_sla_met', 'combined_vector'}

        if isinstance(doc, dict):
            return {k: (v if k in protected_fields else self.apply_pii_masking_to_doc(v)) for k, v in doc.items()}
        elif isinstance(doc, list):
            return [self.apply_pii_masking_to_doc(item) for item in doc]
        elif isinstance(doc, str):
            return self.mask_pii_content(doc)
        return doc

    @require_session
    def fetch_unique_status_and_priority(self):
        try:
            data = request.json
            project_key = data.get("project_key",'')
            tool = data.get("tool", '')
            
            if tool == "jira":
                connector_url = data.get("connector_url")
                username = data.get("username")
                api_token = data.get("api_token")
                ENCRYPTION_KEY = self.encryption
                cipher_suite = Fernet(ENCRYPTION_KEY)
                try:
                    decrypted_token = cipher_suite.decrypt(api_token.encode('utf-8')).decode('utf-8')
                    
                except Exception as e:
                    decrypted_token = api_token
                jql_query = f'project = {project_key} AND issuetype = Bug ORDER BY created DESC'

                start_at = 0
                PAGE_SIZE = 1000

                # Sets automatically handle uniqueness
                unique_statuses = set()
                unique_priorities = set()
                unique_severities = set()

                auth_str = f"{username}:{decrypted_token}"
                auth_b64 = base64.b64encode(auth_str.encode("utf-8")).decode("utf-8")
                headers = {"Authorization": f"Basic {auth_b64}", "Accept": "text/csv"}

                while True:
                    jql_encoded = requests.utils.quote(jql_query)
                    url = (
                        f"{connector_url}/sr/jira.issueviews:searchrequest-csv-all-fields/temp/SearchRequest.csv?"
                        f"jqlQuery={jql_encoded}&tempMax={PAGE_SIZE}&pager/start={start_at}"
                    )

                    try:
                        response = requests.get(url, headers=headers, timeout=30)

                        if response.status_code != 200:
                            print(
                                f"DEBUG: Jira Error {response.status_code}: {response.text[:200]}"
                            )
                            if response.status_code == 400:
                                return (
                                    jsonify(
                                        {
                                            "error": "Api token expired/Unexpected Jira API error"
                                        }
                                    ),
                                    500,
                                )
                            break

                        csv_content = response.text.strip()
                        df_check = pd.read_csv(
                            io.StringIO(csv_content), low_memory=False
                        )

                        if df_check.empty:
                            break

                        # Extract unique Statuses from this page
                        if "Status" in df_check.columns:
                            # dropna() ignores blank values
                            page_statuses = df_check["Status"].dropna().unique()
                            unique_statuses.update(page_statuses)

                        # Extract unique Priorities from this page
                        if "Priority" in df_check.columns:
                            page_priorities = df_check["Priority"].dropna().unique()
                            unique_priorities.update(page_priorities)
                            unique_severities.update(page_priorities)

                        # Extract unique Severities from this page
                        # if "Severity" in df_check.columns:
                        #     page_severities = df_check["Severity"].dropna().unique()
                        #     unique_severities.update(page_severities)

                        # If we fetched fewer issues than the page size, we are finished
                        if len(df_check) < PAGE_SIZE:
                            break

                        start_at += PAGE_SIZE

                    except Exception as e:
                        print(f"Error during fetch: {e}")
                        break

                # Return the unique values as lists
                full_schema = {
                    "unique_statuses": sorted(list(unique_statuses)),
                    "unique_priorities": sorted(list(unique_priorities)),
                    "unique_severities": sorted(list(unique_severities)),
                    "issue_types": ["defect", "testcase"],
                    "schema": {
                        "record_id": "keyword",
                        "issue_type": "keyword",
                        "application": "keyword",
                        "created": "datetime",
                        "resolved": "datetime",
                        "description": "keyword",
                        "title": "keyword",
                        "status": "keyword",
                        "priority": "keyword",
                        "severity": "keyword",
                        "category": "keyword",
                        "epic": "keyword",
                        "feature": "keyword",
                        "expected_result": "keyword",
                        "user_story": "keyword"
                    }
                }

                return buildResponse("success", full_schema, 200)

            else:
                return buildResponse("failure", {"error": "Unsupported tool"}, 400)

        except Exception as e:
            print(f"Global error: {e}")
            return buildResponse(
                "error", 
                {
                    "unique_statuses": [], 
                    "unique_priorities": [], 
                    "unique_severities": [],
                    "schema": {}
                }, 
                500
            )



    @require_session
    def ingest_document(self):
        try:
            data = request.get_json(silent=True) or {}
            index_name = data.get("index_name") or request.form.get("index_name")
            index_id = data.get("index_id") or request.form.get("index_id")
            
            if not index_name or not index_id:
                    return jsonify({"error": "Missing required field: 'index_name' and 'index_id'"}), 400

            find_op = {
                "type": "find_one",
                "filter": {
                    "index_id": index_id
                }   
            }
            result = self.chatbot_agent._query_db('mcp_master', find_op)
            if not result:
                return jsonify({"error": f"Index with id '{index_id}' not found."}), 404
            
            tool = result.get("connector_type")
            entity= result.get("entity_type")

            if tool == 'excel':
                file_names = result.get("file_names", [])
                print(f"Files to process: {file_names}")

            
                for fname in file_names:
                    print(f"Files in index: {fname}")

                    find_file_op = {
                        "type": "find_one", 
                        "filter": {
                            "file_name": fname,
                            "index_id": index_id
                        }
                    }
                    file_result = self.chatbot_agent._query_db('mcp_files', find_file_op)
                    if not file_result:
                        return jsonify({"error": f"File metadata for '{fname}' not found."}), 404
                    
                    sheet_name = file_result.get('sheet_name', None)
                    data = file_result.get('column_mappings', {})

                    if entity == "incident":
                        
                        id = data.get("id")
                        title = data.get("title")
                        description= data.get("description")
                        
                        created= data.get("created_date")
                        opened= data.get("created_date")
                        resolved= data.get("resolved_date")
                        status = data.get("status")
                        priority = data.get("priority")
                        severity = data.get("severity")
                        category = data.get("category")
                        application = data.get("application")
                        root_cause = data.get("root_cause")
                        resolution = data.get("resolution")
                        infra_system = data.get("infra_system")

                    else:

                        id = data.get("id")
                        title = data.get("title")
                        description= data.get("description")
                        
                        created= data.get("created_date")
                        opened= data.get("created_date")
                        resolved= data.get("resolved_date")
                        status = data.get("status")
                        priority = data.get("priority")
                        severity = data.get("severity")
                        category = data.get("category")
                        application = data.get("application")
                        root_cause = data.get("root_cause")
                        resolution = data.get("resolution")
                        infra_system = data.get("infra_system")
                        epic = data.get("epic")
                        feature = data.get("feature")
                        user_story = data.get("user_story")
                        expected_result = data.get("expected_result")



                    file_data = file_result.get('file_data', {})
                    gridfs_id = file_data.get('gridfs_id')
                    if not gridfs_id:
                        return jsonify({"error": f"GridFS ID for file '{fname}' not found."}), 400

                    file_id = ObjectId(gridfs_id)
                    grid_out = self.fs.get(file_id)

                    # Get original filename & extension
                    original_filename = grid_out.filename
                    file_ext = Path(original_filename).suffix.lower()

                    # Read raw bytes
                    file_bytes = grid_out.read()
                    buffer = BytesIO(file_bytes)

                    # ── Same reading logic as in ingest_details_document ──
                    if file_ext in {'.xlsx', '.xls', '.xlsm', '.ods'}:
                        read_kwargs = {}
                        if sheet_name:
                            read_kwargs['sheet_name'] = sheet_name

                        try:
                            print("xslx")
                            df = pd.read_excel(buffer, **read_kwargs)
                        except ValueError as ve:
                            if "No sheet named" in str(ve) or "is not in" in str(ve):
                                return None, f"Sheet '{sheet_name}' not found in the file."
                            raise
                        except Exception as e:
                            return None, f"Excel reading failed: {str(e)}"

                    elif file_ext in {'.csv', '.txt'}:
                        try:
                            print("csv")
                            df = pd.read_csv(buffer)
                        except Exception as e:
                            return None, f"CSV/TXT reading failed: {str(e)}"

                    else:
                        return None, f"Unsupported file extension for reading: {file_ext}"
                    
                    
                    print("dflenght",len(df))
                    print("lenght",df)
                    if 'Date Created' in df.columns and 'Time Created' in df.columns:
                        # Combine date and time strings
                        df['Date Created'] = df['Date Created'].astype(str).str.strip()
                        df['Time Created'] = df['Time Created'].astype(str).str.strip()

                        # Optional but recommended: remove any time part already present in Date Created
                        # (your data sometimes has "6/1/2025 12:00:00 AM")
                        df['Date Clean'] = df['Date Created'].str.extract(r'^(\d{1,2}/\d{1,2}/\d{4})', expand=False)
                        # fallback if extract didn't match
                        df['Date Clean'] = df['Date Clean'].fillna(
                            df['Date Created'].str.split(n=1).str[0].str.strip()
                        )

                        # Now combine clean date string + time string
                        combined_str = df['Date Clean'] + ' ' + df['Time Created']

                        # Parse once — inference usually works best
                        df['created'] = pd.to_datetime(combined_str, errors='coerce')
                        
                    
                    #want to check "created" and "Created"
                    if 'Created' in df.columns:
                        df['created'] = df['Created']

                    df = df.dropna(subset=[created])
                    print("leeenght",df)
                    
                    # Fill NAs to avoid errors during dictionary conversion
                
                    df = df.fillna('')
                    print(f"Processing {len(df)} rows for indexing...")
                    actions = []
                    print("let",df)
                    
                    # 2. Iterate and Normalize
                    for _, row in df.iterrows():
                        if entity == "incident":
                            doc = self.normalize_rows(row,id,opened,resolved,description,title,created,status,priority,severity,category,entity,application,root_cause,resolution,infra_system)
                        else:
                            doc = self.normalize_rows(row,id,opened,resolved,description,title,created,status,priority,severity,category,entity,application,root_cause,resolution,infra_system,epic=epic,feature=feature,user_story=user_story,expected_result=expected_result)
                        if not doc: continue
    
                        doc = self.apply_pii_masking_to_doc(doc)
                        
                        # Prepare for Bulk API
                        action = {
                            "_index": index_name,
                            "_id": doc['record_id'],
                            "_source": doc
                        }
                        actions.append(action)
                        
                    

                    # Flush remaining
                    # if actions:
                        # try:
                            # index_body = {
                                # "settings": {"index": {"knn": True}},
                                # "mappings": {
                                    # "properties": {
                                        # "combined_vector": {
                                            # "type": "knn_vector",
                                            # "dimension": 384,
                                            # "method": {"name": "hnsw", "engine": "lucene", "space_type": "l2"}
                                        # },
                                        # "created_at": {"type": "date"},
                                        # "resolved_at": {"type": "date"},  
                                        # "mttr_seconds": {"type": "long"},
                                       
                                        # "category": {"type": "keyword"},
                                        # "subcategory": {"type": "keyword"},
                                        # "priority": {"type": "keyword"},
                                        # "severity": {"type": "keyword"}, 
                                        # "status": {"type": "keyword"},    
                                        # "issue_key": {"type": "keyword"},
                                        # "is_sla_met": {"type": "boolean"},
                                        # "source": {"type": "keyword"}
                                    # }
                                # }
                            # }
                            # if not self.client.indices.exists(index=index_name):
                                # self.client.indices.create(index=index_name, body=index_body)
                                # print(f"Index '{index_name}' created.")
                                # index_created = True
                            # else:
                                # print("else")
                                # self.client.delete_by_query(
                                    # index=index_name,
                                    # body={"query": {"match_all": {}}},
                                    # wait_for_completion=True,
                                    # conflicts="proceed",
                                    # request_timeout=120
                                # )
                                # print(f"All documents in '{index_name}' were deleted.")
                                # index_created = True
                                
                                
                        # except Exception as e:
                            # index_created = False
                            # print(f"Error creating index: {e}")
                            # return jsonify({"error": f"Error creating index: {e}"}), 500
                        # self.client.indices.refresh(index=index_name)
                        # if index_created:
                            # helpers.bulk(self.client, actions)
                            # print(f"\nIngestion Complete for {len(df)} documents.")

                    if actions:

                        try:
                            index_body = {
                                "settings": {
                                    "index": {
                                        "knn": True,
                                        "refresh_interval": "30s",    # Faster bulk ingest
                                        "number_of_replicas": 0       # Reduce indexing load
                                    }
                                },
                                "mappings": {
                                    "dynamic": True,
                                    "properties": {
                                        "combined_vector": {
                                            "type": "knn_vector",
                                            "dimension": 384,
                                            "method": {"name": "hnsw", "engine": "lucene", "space_type": "l2"}
                                        },
                                        "YY-MM": {"type": "keyword"},
                                        "Qtr": {"type": "keyword"},
                                        "assignment_group": {"type": "keyword"},
                                        "created_at": {"type": "date"},
                                        "created": {"type": "date"},
                                        "resolved_at": {"type": "date"},
                                        "mttr_seconds": {"type": "long"},
                                        "category": {"type": "keyword"},
                                        "subcategory": {"type": "keyword"},
                                        "priority": {"type": "keyword"},
                                        "title": {"type": "keyword"},
                                        "severity": {"type": "keyword"},
                                        "status": {"type": "keyword"},
                                        "issue_key": {"type": "keyword"},
                                        "is_sla_met": {"type": "boolean"},
                                        "source": {"type": "keyword"},
                                        "title":{"type": "keyword"},
                                        "epic":{"type": "keyword"},
                                        "feature":{"type": "keyword"},
                                        "user_story":{"type": "keyword"},
                                        "issue_type":{"type": "keyword"},
                                        "expected_result":{"type": "keyword"},
                                        "application":{"type": "keyword"},
                                        "root_cause":{"type": "keyword"},
                                        "resolution":{"type": "keyword"},
                                        "expected_result":{"type": "keyword"}

                                    }
                                }
                            }

                            # ⚡ Faster and safer way: Delete the index fully and recreate
                            if self.client.indices.exists(index=index_name):
                                print(f"Index '{index_name}' already exists. Deleting...")
                                self.client.indices.delete(index=index_name, ignore=[404], request_timeout=60)

                            print(f"Creating index '{index_name}'...")
                            self.client.indices.create(index=index_name, body=index_body, request_timeout=60)

                        except Exception as e:
                            # print(f"Error creating index: {e}")
                            return jsonify({"error": f"Error creating index: {e}"}), 500

                        # ⚡ Bulk ingest (fast path)
                        try:
                            helpers.bulk(self.client, actions, request_timeout=120)
                            print(f"Ingestion Complete for {len(df)} documents.")
                        except Exception as e:
                            print(f"Bulk ingest failed: {e}")
                            return jsonify({"error": f"Bulk ingest failed: {e}"}), 500

                        # Final refresh
                        self.client.indices.refresh(index=index_name)


                        added_files = []
                        added_files.append(original_filename)

            elif tool == 'jira':

                connector_url = result.get("connector_url")
                api_token = result.get("jira_api_token")
                username = result.get("username")
                project_key = result.get("project_key")
                entity_type = result.get("entity_type")
                print("all",api_token)
                ENCRYPTION_KEY = self.encryption
                cipher_suite = Fernet(ENCRYPTION_KEY)
                
                # Decrypt the token and decode it back to a normal string
                try:
                    decrypted_token = cipher_suite.decrypt(api_token.encode('utf-8')).decode('utf-8')
                    
                except Exception as e:
                    decrypted_token = api_token


                print("key",decrypted_token)
                if entity_type == "defect":
                    JQL_DEFECTS = f'project = {project_key} AND issuetype = Bug ORDER BY created DESC'

                    csv_def = self.fetch_jira_issues(JQL_DEFECTS,connector_url,decrypted_token,username, "defects")
                    if csv_def:
                        df_def = pd.read_csv(csv_def, low_memory=False)
                        os.remove(csv_def)
                        print("Extracting and fetching related User Stories and Epics...")
                        related_keys = self.extract_issue_keys(df_def)
                        
                        df_related = pd.DataFrame()
                        if related_keys:
                            df_related = self.fetch_specific_issues(related_keys, connector_url, decrypted_token, username, "related")
                        
                        # Check if the related stories have parent epics we haven't fetched yet
                        if not df_related.empty:
                            level2_keys = self.extract_issue_keys(df_related) - related_keys - set(df_def['Issue key'].dropna().unique())
                            if level2_keys:
                                df_level2 = self.fetch_specific_issues(level2_keys, connector_url, decrypted_token, username, "epics")
                                df_related = pd.concat([df_related, df_level2], ignore_index=True)

                        # 3. Create a fast lookup dictionary of the related items
                        lookup = {}
                        if not df_related.empty:
                            for _, row in df_related.iterrows():
                                key = str(row.get('Issue key'))
                                if key and key != 'nan':
                                    # In Jira, epic links can be in 'Parent key' or 'Custom field (Epic Link)'
                                    parent = str(row.get('Parent key', ''))
                                    if not parent or parent == 'nan':
                                        parent = str(row.get('Custom field (Epic Link)', ''))
                                        
                                    lookup[key] = {
                                        'Summary': row.get('Summary', ''),
                                        'Issue Type': str(row.get('Issue Type', '')).lower(),
                                        'Parent': parent
                                    }

                        # 4. Inject related Story/Epic data into the Bug rows
                        def enrich_bug_row(row):
                            stories, story_summaries = [],[]
                            epics, epic_summaries = [],[]
                            
                            # Check all link/parent columns on the Bug
                            link_cols =[c for c in df_def.columns if any(k in c.lower() for k in ['issue link', 'parent'])]
                            for col in link_cols:
                                for k in re.findall(r'[A-Z][A-Z0-9]+-\d+', str(row.get(col, ''))):
                                    if k in lookup:
                                        item = lookup[k]
                                        
                                        # If the linked item is a Story (or Test Case)
                                        if 'story' in item['Issue Type'] or 'test' in item['Issue Type']:
                                            stories.append(k)
                                            story_summaries.append(item['Summary'])
                                            
                                            # Check if this Story has a Parent Epic
                                            if item['Parent'] in lookup:
                                                epics.append(item['Parent'])
                                                epic_summaries.append(lookup[item['Parent']]['Summary'])
                                        
                                        # If the linked item is directly an Epic
                                        elif 'epic' in item['Issue Type']:
                                            epics.append(k)
                                            epic_summaries.append(item['Summary'])
                            
                            # Add the compiled data as new columns to the Bug record
                            row['Related User Stories'] = ', '.join(set(stories))
                            row['Related Story Summaries'] = ' | '.join(set(story_summaries))
                            row['Related Epics'] = ', '.join(set(epics))
                            row['Related Epic Summaries'] = ' | '.join(set(epic_summaries))
                            
                            return row
                        
                        df_enriched = df_def.apply(enrich_bug_row, axis=1)
                        
                        # 5. Summarize and return
                        df = self.summarize_issues(df_enriched)
                        print("Finished processing enriched dataframe.")
                    

                elif entity_type == "testcase":
    
                    JQL_TESTCASES = f'project = {project_key} AND issuetype = "Test Case" ORDER BY created DESC'
                    
                    csv_tc = self.fetch_jira_issues(JQL_TESTCASES, connector_url, decrypted_token, username, "testcases")
                    
                    if csv_tc:
                        df_tc = pd.read_csv(csv_tc, low_memory=False)
                        os.remove(csv_tc)

                        print("Extracting and fetching related User Stories, Features and Epics...")
                        related_keys = self.extract_issue_keys(df_tc)

                        df_related = pd.DataFrame()
                        if related_keys:
                            df_related = self.fetch_specific_issues(
                                related_keys, connector_url, decrypted_token, username, "related"
                            )

                        # Build lookup dictionary from related items
                        lookup = {}
                        if not df_related.empty:
                            for _, row in df_related.iterrows():
                                key = str(row.get('Issue key'))
                                if key and key != "nan":
                                    parent = str(row.get('Parent key', ''))
                                    if not parent or parent == "nan":
                                        parent = str(row.get('Custom field (Epic Link)', ''))

                                    lookup[key] = {
                                        "Summary": row.get("Summary", ""),
                                        "Issue Type": str(row.get("Issue Type", "")).lower(),
                                        "Parent": parent
                                    }

                        # ---------------------------
                        # FIXED: Enrichment for Test Cases
                        # ---------------------------
                        def enrich_testcase_row(row):
                            stories, story_summaries = [], []
                            features, feature_summaries = [], []
                            epics, epic_summaries = [], []

                            # Expanded columns for Test Case linking
                            link_cols = [
                                c for c in df_tc.columns
                                if any(k in c.lower() for k in [
                                    'issue link', 'parent', 'epic link', 'epic', 'feature'
                                ])
                            ]

                            for col in link_cols:
                                keys = re.findall(r'[A-Z][A-Z0-9]+-\d+', str(row.get(col, '')))
                                for k in keys:
                                    if k not in lookup:
                                        continue

                                    item = lookup[k]
                                    issue_type = item["Issue Type"]
                                    summary = item["Summary"]
                                    parent = item["Parent"]

                                    # STORY
                                    if "story" in issue_type:
                                        stories.append(k)
                                        story_summaries.append(summary)

                                        if parent in lookup:
                                            epics.append(parent)
                                            epic_summaries.append(lookup[parent]["Summary"])

                                    # FEATURE
                                    elif "feature" in issue_type:
                                        features.append(k)
                                        feature_summaries.append(summary)

                                        if parent in lookup:
                                            epics.append(parent)
                                            epic_summaries.append(lookup[parent]["Summary"])

                                    # DIRECT EPIC
                                    elif "epic" in issue_type:
                                        epics.append(k)
                                        epic_summaries.append(summary)

                                    # TEST (rare case)
                                    elif "test" in issue_type:
                                        stories.append(k)
                                        story_summaries.append(summary)

                            # Deduplicate and assign
                            row["Related User Stories"] = ", ".join(sorted(set(stories)))
                            row["Related Story Summaries"] = " | ".join(sorted(set(story_summaries)))

                            row["Related Features"] = ", ".join(sorted(set(features)))
                            row["Related Feature Summaries"] = " | ".join(sorted(set(feature_summaries)))

                            row["Related Epics"] = ", ".join(sorted(set(epics)))
                            row["Related Epic Summaries"] = " | ".join(sorted(set(epic_summaries)))

                            return row

                        df_enriched = df_tc.apply(lambda r: enrich_testcase_row(r), axis=1)

                        # Summarize and return
                        df = self.summarize_issues(df_enriched)
                        print("Finished processing enriched Test Case dataframe.")   





                print("dflenght",len(df))
                print("dff",df)
                if 'Date Created' in df.columns and 'Time Created' in df.columns:
                    # Combine date and time strings
                    df['Date Created'] = df['Date Created'].astype(str).str.strip()
                    df['Time Created'] = df['Time Created'].astype(str).str.strip()

                    # Optional but recommended: remove any time part already present in Date Created
                    # (your data sometimes has "6/1/2025 12:00:00 AM")
                    df['Date Clean'] = df['Date Created'].str.extract(r'^(\d{1,2}/\d{1,2}/\d{4})', expand=False)
                    # fallback if extract didn't match
                    df['Date Clean'] = df['Date Clean'].fillna(
                        df['Date Created'].str.split(n=1).str[0].str.strip()
                    )

                    # Now combine clean date string + time string
                    combined_str = df['Date Clean'] + ' ' + df['Time Created']

                    # Parse once — inference usually works best
                    df['Created'] = pd.to_datetime(combined_str, errors='coerce')
                    
                
                
                df = df.dropna(subset=['Created'])
                
                # Fill NAs to avoid errors during dictionary conversion
            
                df = df.fillna('')
                print(f"Processing {len(df)} rows for indexing...")
                actions = []
                
                # 2. Iterate and Normalize
                for _, row in df.iterrows():
                    
                    doc = self.jira_normalize(row,entity)
                    print("ddd",doc)
                    

                    if not doc: continue

                    doc = self.apply_pii_masking_to_doc(doc)
                    
                    # Prepare for Bulk API
                    action = {
                        "_index": index_name,
                        "_id": doc['record_id'],
                        "_source": doc
                    }
                    actions.append(action)
                    
                

                # Flush remaining
                # if actions:
                    # try:
                        # index_body = {
                            # "settings": {"index": {"knn": True}},
                            # "mappings": {
                                # "properties": {
                                    # "combined_vector": {
                                        # "type": "knn_vector",
                                        # "dimension": 384,
                                        # "method": {"name": "hnsw", "engine": "lucene", "space_type": "l2"}
                                    # },
                                    # "created_at": {"type": "date"},
                                    # "resolved_at": {"type": "date"},  
                                    # "mttr_seconds": {"type": "long"},
                                    
                                    # "record_id": {"type": "keyword"},
                                    # "category": {"type": "keyword"},
                                    
                                    # "priority": {"type": "keyword"},
                                    # "severity": {"type": "keyword"}, 
                                    # "status": {"type": "keyword"},    
                                    # "issue_key": {"type": "keyword"},
                                    # "is_sla_met": {"type": "boolean"},
                                    # "source": {"type": "keyword"}
                                # }
                            # }
                        # }
                        # if not self.client.indices.exists(index=index_name):
                            # self.client.indices.create(index=index_name, body=index_body)
                            # print(f"Index '{index_name}' created.")
                            # index_created = True
                        # else:
                            # self.client.delete_by_query(
                                # index=index_name,
                                # body={"query": {"match_all": {}}},
                                # wait_for_completion=True,       # wait until delete is done
                                # conflicts="proceed",             # useful when there are version conflicts
                                # request_timeout=60
                            # )
                            
                            # print(f"All documents in '{index_name}' were deleted.")
                            # index_created = True
                            
                            
                    # except Exception as e:
                        # index_created = False
                        # print(f"Error creating index: {e}")
                        # return jsonify({"error": f"Error creating index: {e}"}), 500
                    # self.client.indices.refresh(index=index_name)
                    # if index_created:
                        # helpers.bulk(self.client, actions)
                        # print(f"\nIngestion Complete for {len(df)} documents.")
                if actions:

                        try:
                            index_body = {
                                "settings": {
                                    "index": {
                                        "knn": True,
                                        "refresh_interval": "30s",    # Faster bulk ingest
                                        "number_of_replicas": 0       # Reduce indexing load
                                    }
                                },
                                "mappings": {
                                    "properties": {
                                        "combined_vector": {
                                            "type": "knn_vector",
                                            "dimension": 384,
                                            "method": {"name": "hnsw", "engine": "lucene", "space_type": "l2"}
                                        },
                                        "created_at": {"type": "date"},
                                        "created": {"type": "date"},
                                        "resolved_at": {"type": "date"},
                                        "mttr_seconds": {"type": "long"},
                                        "category": {"type": "keyword"},
                                        "title": {"type": "keyword"},
                                        "priority": {"type": "keyword"},
                                        "severity": {"type": "keyword"},
                                        "status": {"type": "keyword"},
                                        "issue_key": {"type": "keyword"},
                                        "issue_type":{"type": "keyword"},
                                        "is_sla_met": {"type": "boolean"},
                                        "source": {"type": "keyword"},
                                        
                                        # "Related User Stories": { "type": "keyword" },
                                        # "Related Story Summaries": { "type": "text" },
                                        # "Related Epics": { "type": "keyword" },
                                        # "Related Epic Summaries": { "type": "text" },
                                        "epic": { "type": "keyword" },
                                        "feature": { "type": "keyword" },
                                        "user_story": { "type": "keyword" },
                                        "expected_result": { "type": "text" },


                                        "Parent key": { "type": "keyword" },
                                        "Parent summary": { "type": "text" },

                                        
                                    }
                                }
                            }

                            # ⚡ Faster and safer way: Delete the index fully and recreate
                            if self.client.indices.exists(index=index_name):
                                print(f"Index '{index_name}' already exists. Deleting...")
                                self.client.indices.delete(index=index_name, ignore=[404], request_timeout=60)

                            print(f"Creating index '{index_name}'...")
                            self.client.indices.create(index=index_name, body=index_body, request_timeout=60)

                        except Exception as e:
                            print(f"Error creating index: {e}")
                            return jsonify({"error": f"Error creating index: {e}"}), 500

                        # ⚡ Bulk ingest (fast path)
                        try:
                            helpers.bulk(self.client, actions, request_timeout=120)
                            print(f"Ingestion Complete for {len(df)} documents.")
                        except Exception as e:
                            print(f"Bulk ingest failed: {e}")
                            return jsonify({"error": f"Bulk ingest failed: {e}"}), 500

                        # Final refresh
                        self.client.indices.refresh(index=index_name)
                        added_files = []
                    
                
            elif tool =='team_dynamix':
                connector_url = result.get("connector_url")
                password = result.get("password")
                username = result.get("username")
                app_id = result.get("app_id")
                entity_type = result.get("entity_type")
                ENCRYPTION_KEY = self.encryption
                cipher_suite = Fernet(ENCRYPTION_KEY)
                
                # Decrypt the token and decode it back to a normal string
                decrypted_password = cipher_suite.decrypt(password.encode('utf-8')).decode('utf-8')

                # today = datetime(2026, 3, 3).date()   # or datetime.now().date()
                # last_30_days = today - timedelta(days=5)
                
            
                # filters = {
                #     "CreatedDateFrom": last_30_days.strftime('%Y-%m-%d'),
                #     "CreatedDateTo": today.strftime('%Y-%m-%d'),
                
                # }
                today = datetime.now().date()
                end_date = today.strftime('%Y-%m-%d')
                # Define the start date directly
                start_date = "2020-01-01"
                
                df = self.fetch_tdx_tickets(app_id, username, decrypted_password, connector_url, start_date, end_date)
                
                if df.empty:
                    return jsonify({"status": "success", "data": {"message": "No tickets in last 30 days"}})
                
                if 'Date Created' in df.columns and 'Time Created' in df.columns:
                    # Combine date and time strings
                    df['Date Created'] = df['Date Created'].astype(str).str.strip()
                    df['Time Created'] = df['Time Created'].astype(str).str.strip()

                    # Optional but recommended: remove any time part already present in Date Created
                    # (your data sometimes has "6/1/2025 12:00:00 AM")
                    df['Date Clean'] = df['Date Created'].str.extract(r'^(\d{1,2}/\d{1,2}/\d{4})', expand=False)
                    # fallback if extract didn't match
                    df['Date Clean'] = df['Date Clean'].fillna(
                        df['Date Created'].str.split(n=1).str[0].str.strip()
                    )

                    # Now combine clean date string + time string
                    combined_str = df['Date Clean'] + ' ' + df['Time Created']

                    # Parse once — inference usually works best
                    df['Created'] = pd.to_datetime(combined_str, errors='coerce')
                    
                
                
                df = df.dropna(subset=['Created'])
                
                # Fill NAs to avoid errors during dictionary conversion
            
                df = df.fillna('')
                print(f"Processing {len(df)} rows for indexing...")
                actions = []
                
                # 2. Iterate and Normalize
                for _, row in df.iterrows():
                    
                    doc = self.teamdynamics_normalize(row, entity_type)
                    print("ddd",doc)
                    

                    if not doc: continue

                    doc = self.apply_pii_masking_to_doc(doc)
                    
                    # Prepare for Bulk API
                    action = {
                        "_index": index_name,
                        "_id": doc['record_id'],
                        "_source": doc
                    }
                    actions.append(action)
                    
                

                # Flush remaining
                if actions:

                        try:
                            index_body = {
                                "settings": {
                                    "index": {
                                        "knn": True,
                                        "refresh_interval": "30s",    # Faster bulk ingest
                                        "number_of_replicas": 0       # Reduce indexing load
                                    }
                                },
                                "mappings": {
                                    "properties": {
                                        "combined_vector": {
                                            "type": "knn_vector",
                                            "dimension": 384,
                                            "method": {"name": "hnsw", "engine": "lucene", "space_type": "l2"}
                                        },
                                        "created_at": {"type": "date"},
                                        "resolved_at": {"type": "date"},
                                        "mttr_seconds": {"type": "long"},
                                        "category": {"type": "keyword"},
                                        "title": {"type": "keyword"},
                                        "priority": {"type": "keyword"},
                                        "severity": {"type": "keyword"},
                                        "status": {"type": "keyword"},
                                        "issue_key": {"type": "keyword"},
                                        "is_sla_met": {"type": "boolean"},
                                        "source": {"type": "keyword"}
                                    }
                                }
                            }

                            # ⚡ Faster and safer way: Delete the index fully and recreate
                            if self.client.indices.exists(index=index_name):
                                print(f"Index '{index_name}' already exists. Deleting...")
                                self.client.indices.delete(index=index_name, ignore=[404], request_timeout=60)

                            print(f"Creating index '{index_name}'...")
                            self.client.indices.create(index=index_name, body=index_body, request_timeout=60)

                        except Exception as e:
                            print(f"Error creating index: {e}")
                            return jsonify({"error": f"Error creating index: {e}"}), 500

                        # ⚡ Bulk ingest (fast path)
                        try:
                            helpers.bulk(self.client, actions, request_timeout=120)
                            print(f"Ingestion Complete for {len(df)} documents.")
                        except Exception as e:
                            print(f"Bulk ingest failed: {e}")
                            return jsonify({"error": f"Bulk ingest failed: {e}"}), 500

                        # Final refresh
                        self.client.indices.refresh(index=index_name)

                        added_files = []
                

            update_op={
                "type": "update_one",
                "filter": {
                    "index_id": index_id
                },
                "update": {
                    "$set": {
                        "last_synced_at": datetime.utcnow().isoformat() + "Z"
                    }
                }
            }

            self.chatbot_agent._query_db('mcp_master', update_op)
                    
            return jsonify({
                "status": "success",
                "message": f"Successfully ingested records.",
                "file_processed": added_files
            }), 200



        except Exception as e:
            print(f"Ingestion Error: {e}")
            return jsonify({"error": str(e)}), 500

    @require_session
    def get_projectkeys(self):
        try:
            data = request.get_json()
            username = data.get("username",'')
            api_token = data.get("api_token",'')
            jira_url = data.get("connector_url",'')
          
            ENCRYPTION_KEY = self.encryption
           
            cipher_suite = Fernet(ENCRYPTION_KEY)
  
            
            try:
                decrypted_token = cipher_suite.decrypt(api_token.encode('utf-8')).decode('utf-8')
                
            except Exception as e:
                
                decrypted_token = api_token
            
            print("api",decrypted_token)           
            auth_str = f"{username}:{decrypted_token}"
            auth_b64 = base64.b64encode(auth_str.encode('utf-8')).decode('utf-8')

            headers = {
                "Authorization": f"Basic {auth_b64}",
                "Accept": "application/json"
            }

            # Optional query params (add if needed)
            params = {
                "startAt": 0,
                "maxResults": 50,          # max 50 per page, default 50
                # "orderBy": "key",        # sort by key, name, etc.
                # "query": "AI"            # filter projects containing "AI" in name/key
            }

            response = requests.get(
                f"{jira_url}/rest/api/3/project/search",
                headers=headers,
                params=params
            )
            if response.status_code == 401:
                    return {
                        "success": False,
                        "error": "Jira API authentication failed — API token invalid or expired.",
                        "status_code": 401
                    }
            
            
            if response.status_code == 403:
                    return {
                        "success": False,
                        "error": "Jira access denied — token exhausted, rate‑limited, or permissions missing.",
                        "status_code": 403
                    }
            
            
            if response.status_code != 200:
                        return {
                            "success": False,
                            "error": f"Jira returned error: {response.text[:500]}",
                            "status_code": response.status_code
                        }

            if response.status_code == 200:
                data = response.json()
                print("Total visible projects:", data["total"])
            
            project_keys = []
            for proj in data.get("values", []):
                project_keys.append(proj["key"])
            
            return jsonify({
                "status": "success",        
                
                "project_keys": project_keys
            })
        
        except Exception as e:
            print("ss")
            import traceback
            return jsonify({
                "status": "error",
                "message": str(e),
                "traceback": traceback.format_exc()[:800]  # for debugging – remove in prod
            }), 500
    
    
    @require_session
    def fetch_app_id(self):
        try:
            data = request.get_json()
            username = data.get("username",'')
            password = data.get("password",'')
            connector_url = data.get("connector_url",'')
            ENCRYPTION_KEY = self.encryption
            cipher_suite = Fernet(ENCRYPTION_KEY)
            
            # Decrypt the token and decode it back to a normal string
            try:
                decrypted_password = cipher_suite.decrypt(password.encode('utf-8')).decode('utf-8')
                
            except Exception as e:
                decrypted_password = password
                
            
            
            
            token = self.get_tdx_token(connector_url,username,decrypted_password)
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
            
            
            service = self.IsServiceMode
            if service:
                getuser_url = f"{connector_url}/api/auth/getuser"
                resp = requests.get(getuser_url, headers=headers)

                if resp.status_code != 200:
                    raise Exception(f"Get current user failed: {resp.status_code} - {resp.text}")

                user = resp.json()

                # Extract UID
                uid = user.get("UID")
                if not uid:
                    raise Exception("UID not found in /api/auth/getuser response")

                # Extract Application IDs / Names
                app_ids = []

                # 1. System-defined applications (most common case)
                applications = user.get("Applications", [])
                if isinstance(applications, list):
                    for item in applications:
                        if isinstance(item, str) and item.strip():        # skip empty strings
                            app_ids.append(item)
                        elif isinstance(item, (int, str)) and item:
                            app_ids.append(str(item))

                # 2. (Optional but recommended) Organizationally-defined applications
                # These are usually in "OrgApplications" and come as list of dicts with "ID"
                # org_applications = user.get("OrgApplications", [])
                # if isinstance(org_applications, list):
                    # for item in org_applications:
                        # if isinstance(item, dict):
                            # app_id = item.get("ID") or item.get("id")
                            # if app_id is not None:
                                # app_ids.append(app_id)
                        # elif isinstance(item, (int, str)) and item:
                            # app_ids.append(item)

                print("UID:", uid)
                print("Application IDs/Names:", app_ids)

            else:
                getuid_url = f"{connector_url}/api/people/getuid/{username}"
                resp = requests.get(getuid_url, headers=headers)
                if resp.status_code != 200:
                    raise Exception(f"TDX getuid failed: {resp.status_code} - {resp.text}")

                # getuid may return a JSON string or raw text; handle both
                
                uid = resp.text.strip()

                if not uid:
                    raise Exception("TDX getuid returned empty UID")

                # 3) Fetch full person by UID (GET, not POST)
                person_url = f"{connector_url}/api/people/{uid}"
                resp2 = requests.get(person_url, headers=headers)
                if resp2.status_code != 200:
                    raise Exception(f"TDX get person failed: {resp2.status_code} - {resp2.text}")

                person = resp2.json()

                # 4) Extract application IDs
                # TeamDynamix person resource includes 'Applications' and possibly 'OrganizationalApplications'
                # Normalize into a simple list of AppIDs (integers) if structure contains objects.
                app_ids = []
                apps_field = person.get("Applications", [])  # may be list of IDs or list of objects with 'ID'
                if isinstance(apps_field, list):
                    for item in apps_field:
                        if isinstance(item, dict) and "ID" in item:
                            app_ids.append(item["ID"])
                        elif isinstance(item, int):
                            app_ids.append(item)

            

            return jsonify({
                "status": "success",
                "uid": uid,
                "app_ids": app_ids
            
            }), 200
        
        except Exception as e:
            import traceback
            return jsonify({
                "status": "error",
                "message": str(e),
                "traceback": traceback.format_exc()[:800]
            }), 500

    # @require_session
    # def delete_index(self):
        # try:
            # data = request.get_json(silent=True) or {}
            # index_name = data.get("index_name") or request.form.get("index_name")

            # if not index_name:
                # return jsonify({"error": "Missing required field: 'index_name'"}), 400

            # # Check if index exists in OpenSearch
            # if self.client.indices.exists(index=index_name):
                # self.client.indices.delete(index=index_name)
                # print(f"Index '{index_name}' deleted from OpenSearch.")
            # else:
                # print(f"Index '{index_name}' does not exist in OpenSearch.")

            # # Delete from DB
            # find_op = {
                # "type": "find_one",
                # "filter": {
                    # "index_name": index_name
                # }
            # }
            # data = self.chatbot_agent._query_db('mcp_master', find_op)
            # connector_type = data.get("connector_type")
            
            # delete_op = {
                # "type": "delete_one",
                # "filter": {
                    # "index_name": index_name
                # }
            # }
            # self.chatbot_agent._query_db('mcp_master', delete_op)
            # if connector_type == "Excel":
                # self.chatbot_agent._query_db('mcp_files', delete_op)
            
            # delete_usecase_op = {
                # "type": "delete_many",
                # "filter": {
                    # "index_name": index_name
                # }
            # }
            # self.chatbot_agent._query_db('mcp_usecase', delete_usecase_op)

            # return jsonify({
                # "status": "success",
                # "message": f"Index '{index_name}' and associated DB record deleted."
            # }), 200

        # except Exception as e:
            # print(f"Delete Error: {e}")
            # return jsonify({"error": str(e)}), 500
    
    @require_session
    def delete_index(self):
        try:
            data = request.get_json(silent=True) or {}
            index_name = data.get("index_name") or request.form.get("index_name")

            if not index_name:
                return jsonify({"error": "Missing required field: 'index_name'"}), 400

            find_op = {
                "type": "find_one",
                "filter": {
                    "index_name": index_name
                }
            }
            data = self.chatbot_agent._query_db('mcp_master', find_op)
            entity = data.get("entity_type")

            # Check if index exists in OpenSearch
            if self.client.indices.exists(index=index_name):
                self.client.indices.delete(index=index_name)
                print(f"Index '{index_name}' deleted from OpenSearch.")
            else:
                print(f"Index '{index_name}' does not exist in OpenSearch.")


            if self.Is_UAT:
                history_indices = [
                    f"{entity}_history_insights_prod",
                    f"{entity}_history_trend_prod"
                ]
            else:
                history_indices = [
                    f"{entity}_history_insights",
                    f"{entity}_history_trend"
                ]

            for hist_index in history_indices:
                try:
                    self.client.delete_by_query(
                        index=hist_index,
                        body={
                            "query": {
                            "bool": {
                                "should": [
                                    {"term": {"index_name.keyword": index_name}},   # preferred
                                    {"term": {"index_name": index_name}}            # fallback
                                ],
                                "minimum_should_match": 1
                            }
                        }
                        },
                        ignore_unavailable=True,   # Ignores if the index doesn't exist yet
                        conflicts="proceed",       # Ignores concurrent update conflicts
                        wait_for_completion=False, # Background task so API doesn't hang
                        slices="auto"              # Speeds up deletion
                    )
                    print(f"Triggered background cleanup for '{index_name}' in history index: '{hist_index}'")
                except Exception as e:
                    print(f"Warning: Could not delete history records in '{hist_index}': {e}")

            # Delete from DB
            
            connector_type = data.get("connector_type")
            
            delete_op = {
                "type": "delete_one",
                "filter": {
                    "index_name": index_name
                }
            }
            self.chatbot_agent._query_db('mcp_master', delete_op)
            if connector_type == "Excel":
                self.chatbot_agent._query_db('mcp_files', delete_op)
            
            delete_usecase_op = {
                "type": "delete_many",
                "filter": {
                    "index_name": index_name
                }
            }
            self.chatbot_agent._query_db('mcp_usecase', delete_usecase_op)

            return jsonify({
                "status": "success",
                "message": f"Index '{index_name}' and associated DB record deleted."
            }), 200

        except Exception as e:
            print(f"Delete Error: {e}")
            return jsonify({"error": str(e)}), 500
    
    
    def get_opensearchindexes(self):
        try:
            find_op = {'type': 'find', 'filter': {"status":"active"}}
            res = self.chatbot_agent._query_db('mcp_master', find_op)
            return jsonify({
                "status": "success",    
                "indexes": res
            }), 200
        except Exception as e:
            return jsonify({
                "status": "error",
                "message": str(e)
            }), 500
        
    @require_session
    def get_indexes(self):
        
        result = self.get_opensearchindexes()
        return result

    @require_session
    def get_indexesbyid(self):
        
        data = request.get_json()
        index_id = data.get("index_id")
        find_op = {
            "type": "find_one",
            "filter": {
                "index_id": index_id
            }
        }
        result = self.chatbot_agent._query_db('mcp_master', find_op)
        index_name = result.get("index_name")
        connector_type = result.get("connector_type")
        find_usecase_op = {
            "type": "find",
            "filter": {
                "index_name": index_name
            }
        }
        usecases = self.chatbot_agent._query_db('mcp_usecase', find_usecase_op)
        if usecases:
            # Filter all usecases where key is "trends"
            trends = [uc for uc in usecases if uc.get("key") == "trends"]
            
            # Filter the rest (or specifically where key is "insights")
            insights = [uc for uc in usecases if uc.get("key") == "insights" or "key" not in uc]
            
            # Add to result if data exists
            if trends:
                result['trends_uc'] = trends
            
            if insights:
                result['usecases'] = insights

        else:
            result['trends_uc'] = []
            result['usecases'] = []
        
        if connector_type == "Excel":
            file_name = result.get("file_names", [])[0]

            file_find_op ={
                "type": "find_one",
                "filter": {
                    "file_name": file_name,
                    "index_id": index_id
                }
            }
            file_result = self.chatbot_agent._query_db('mcp_files', file_find_op)

            result['file_details'] = file_result 

        result['file_details'] = {}

        return jsonify({
            "status": "success",    
            "data": result
        }),200
    
    def suggest_standard_field(self,col_name, standard_fields):
        """
        Suggests a standard field based on basic string matching.
        Normalizes names by converting to lowercase and removing spaces/underscores.
        """
        normalized_col = col_name.lower().replace("_", "").replace(" ", "").replace("-", "")
        
        # Direct normalization match
        for field in standard_fields:
            normalized_field = field.lower().replace("_", "").replace(" ", "").replace("-", "")
            if normalized_col == normalized_field:
                return field
                
        # Substring match fallbacks for common variations
        if "id" in normalized_col or "_id" in normalized_col or "record" in normalized_col:
            return "record_id"
        if "date" in normalized_col or "time" in normalized_col:
            if "create" in normalized_col:
                return "created_at"
            if "resolve" in normalized_col or "close" in normalized_col:
                return "resolved_at"
        if "desc" in normalized_col:
            return "description"
        if "sla" in normalized_col:
            return "is_sla_met"
            
        return None

    @require_session
    def extract_column(self):
        try:
            # Standardized schema defined inside the method
            standard_fields = [
                "record_id",
                "source",
                "type",
                "created_at",
                "created",
                "title",
                "description",
                "resolved_at", 
                "mttr_seconds",
                "status",
                "priority",
                "severity",
                "category",
                "subcategory",
                "issue_key",
                "is_sla_met",
                "application",
                "root_cause",
                "resolution",
                "infra_system",
                "epic",
                "feature",
                "user_story",
                "expected_result"
            ]

            if 'file' not in request.files:
                return jsonify({"error": "No file part in the request"}), 400

            file = request.files['file']
            sheet_name = request.form.get('sheet_name')

            allowed_extensions = {'.xlsx', '.xls', '.xlsm', '.csv', '.txt', '.ods'}
            file_ext = Path(file.filename).suffix.lower()
            
            if file_ext not in allowed_extensions:
                return jsonify({
                    "error": f"Unsupported file type: {file_ext}. Allowed: {', '.join(allowed_extensions)}"
                }), 400

            print(f"Received file: {file.filename} ({file_ext})")

            if file_ext in ['.xlsx', '.xls', '.xlsm', '.ods']:
                read_kwargs = {}
                if sheet_name:
                    read_kwargs['sheet_name'] = sheet_name

                try:
                    df = pd.read_excel(file, **read_kwargs)
                except ValueError as ve:
                    if "No sheet named" in str(ve) or "is not in" in str(ve):
                        return jsonify({
                            "error": f"Sheet '{sheet_name}' not found in the file."
                        }), 400
                    raise
            
            elif file_ext in ['.csv', '.txt']:
                df = pd.read_csv(file)
            else:
                return jsonify({"error": f"Cannot process extension: {file_ext}"}), 400
            
            columns = df.columns.tolist()
            schema = []
            agent_context = {} 

            # Keep keywords strictly lowercase
            status_keywords = {'open', 'closed', 'resolved', 'in progress', 'pending', 'new', 'assigned', 'unassigned'}
            priority_keywords = {'high', 'low', 'medium', 'critical', 'p1', 'p2', 'p3', 'p4', 'p5'}

            for col in df.columns:
                dtype = str(df[col].dtype)
                
                # Suggest matching standard field
                suggested_target = self.suggest_standard_field(col, standard_fields)

                col_info = {
                    "column_name": col, 
                    "data_type": dtype,
                    "suggested_standard_field": suggested_target
                }

                if pd.api.types.is_object_dtype(df[col]) or pd.api.types.is_string_dtype(df[col]) or pd.api.types.is_numeric_dtype(df[col]):
                    
                    # Drop NAs to avoid errors
                    valid_data = df[col].dropna()
                    unique_vals = valid_data.unique()
                    
                    # Check cardinality (number of unique values)
                    if 0 < len(unique_vals) <= 20:
                        unique_vals_list = unique_vals.tolist()
                        col_info["unique_values"] = unique_vals_list
                        
                        lower_vals = set(str(v).lower().strip() for v in unique_vals_list)

                        inferred_type = None
                        
                        if lower_vals.intersection(status_keywords):
                            inferred_type = "Status/State"
                        elif lower_vals.intersection(priority_keywords):
                            inferred_type = "Priority/Severity"
                        else:
                            inferred_type = "Categorical"
                            
                        col_info["inferred_type"] = inferred_type
                        
                        agent_context[col] = {
                            "inferred_type": inferred_type,
                            "unique_values": unique_vals_list,
                            "suggested_standard_field": suggested_target
                        }

                schema.append(col_info)

            return jsonify({
                "status": "success",
                "columns": columns,
                "standard_fields": standard_fields,
                "schema_for_agent": {
                    "full_schema": schema,
                    "detected_categorical_fields": agent_context
                }
            }), 200

        except Exception as e:      
            print(f"Column Extraction Error: {e}")
            return jsonify({"error": str(e)}), 500
    
    @require_session
    def extract_sheets(self):
        try:

            if 'file' not in request.files:
                return jsonify({"error": "No file part in the request"}), 400

            file = request.files['file']

            allowed_extensions = {'.xlsx', '.xls', '.xlsm', '.csv', '.txt', '.ods'}
            file_ext = Path(file.filename).suffix.lower()
            
            if file_ext not in allowed_extensions:
                return jsonify({
                    "error": f"Unsupported file type: {file_ext}. Allowed: {', '.join(allowed_extensions)}"
                }), 400

            print(f"Received file: {file.filename} ({file_ext})")

            if file_ext in ['.xlsx', '.xls', '.xlsm', '.ods']:
                excel_file = pd.ExcelFile(file)
                sheet_names = excel_file.sheet_names   # list of strings
                
                return jsonify({ "status": "success", "sheet_names": sheet_names }) # or pd.read_excel(file, sheet_name=sheet_name)
                
            else:
                return jsonify({"error": f"Cannot process extension: {file_ext}"}), 400
            
        except Exception as e:      
            print(f"Column Extraction Error: {e}")
            return jsonify({"error": str(e)}), 500
       
    @require_session      
    def api_limit_count(self):
        try:
            total_count= 5
            
            current_user = get_current_user()
            user_id = current_user.get("user_id") if current_user else "anonymous"
            
            
            api_name = "insights_call_agent"
            
            now = datetime.now(timezone.utc)
            today = now.strftime("%Y-%m-%d")
            record_id = f"{user_id}_{api_name}_{today}"
            
            response = self.rate_limiting_collection.find_one({"_id": record_id,"api_name": "insights_call_agent"})
            if response:
                count = response.get("count", 0)
                
                return jsonify({"status": "success", "count": count,"total_count":total_count}), 200
            
            return jsonify({"status": "success", "count": 0,"total_count":total_count}), 200
        
        except Exception as e:
            print(f"API Limit Count Error: {e}")
            return jsonify({"error": str(e)}), 500
     
    @require_session
    def check_index(self):
        try:
            data = request.get_json()
            index_name = data.get("index_name")
            index_name = index_name.lower()
            if self.client.indices.exists(index=index_name):
                return jsonify({"status": "success", "exists": True}), 200

            else:
                return jsonify({"status": "success", "exists": False}), 200
        
        except Exception as e:
            print(f"Check Index Error: {e}")
            return jsonify({"error": str(e)}), 500
            
    @require_session
    def refreshsubScriptionDetails(self):
        data = request.json
        teams = data.get("teams", [])
        user_type = data.get("user_type","abc")
        #delete old records in all collection
        self.chatbot_agent._query_db('workflow_collection',{'type':'delete_many','filter':{}},user_type)
        self.chatbot_agent._query_db('workflow_agency_mapping_collection',{'type':'delete_many','filter':{}},user_type)
        self.chatbot_agent._query_db('agent_agency_mapping',{'type':'delete_many','filter':{}},user_type)
        self.chatbot_agent._query_db('agent',{'type':'delete_many','filter':{}},user_type)
        self.chatbot_agent._query_db('kb_collection',{'type':'delete_many','filter':{}},user_type)
        self.chatbot_agent._query_db('agency',{'type':'delete_many','filter':{}},user_type)

        for team in teams:
            print(f"Processing team: {team['teamName']}")
            agencies = self.agency_collection.find({'assigned_to':team['teamName'], "is_deleted":{'$ne':True}})
            for agency in agencies:
                agency_name = agency.get("agency_name")
                agency_id = agency.get("agency_id")
                if agency_name:
                    #agency
                    if '_id' in agency:
                        del agency['_id']   
                    
                    insert_agency_op = {
                        "type": "insert_one",
                        "document": agency
                    }
                    self.chatbot_agent._query_db('agency', insert_agency_op, user_type)
                    #workflow
                    workflows = self.workflow_collection.find({"agency_name": agency_name,"is_deleted":{'$ne':True}})

                    for workflow in workflows:
                        # Important: remove the _id so MongoDB generates a new one
                        # (otherwise you'll get duplicate key error)
                        if '_id' in workflow:
                            del workflow['_id']

                        # Prepare the insert operation
                        insert_op = {
                            "type": "insert_one",           # ← fixed: string, not variable
                            "document": workflow            # ← the full original document (minus _id)
                        }

                        # Insert the copy
                        self.chatbot_agent._query_db('workflow_collection', insert_op, user_type)

                    #workflow agency mapping
                    mappings = self.workflow_agency_mapping_collection.find({"agency_name": agency_name, "status":"active"})
                    for mapping in mappings:
                        if '_id' in mapping:
                            del mapping['_id']

                        insert_mapping_op = {
                            "type": "insert_one",
                            "document": mapping
                        }

                        self.chatbot_agent._query_db('workflow_agency_mapping_collection', insert_mapping_op, user_type)

                    print("Inserted agency and workflows for agency:", agency_name)
                    #agency agent mapping
                    agent_mappings = self.agent_agency_mapping_collection.find({"agency_name": agency_name, "status":"active"})
                    all_agents = set()
                    for agent_mapping in agent_mappings:
                        all_agents.add(agent_mapping.get("agent_id"))
                        if '_id' in agent_mapping:
                            del agent_mapping['_id']

                        insert_agent_mapping_op = {
                            "type": "insert_one",
                            "document": agent_mapping
                        }

                        self.chatbot_agent._query_db('agent_agency_mapping', insert_agent_mapping_op, user_type)

                    #agents which are in agency mapping
                    for agent_id in all_agents:
                        agent = self.agent_collection.find_one({"agent_id": agent_id, "$or": [{"isDeleted": {"$ne": True}},{"isDeleted": {"$exists": False}}]})
                        if agent and '_id' in agent:
                            del agent['_id']

                            insert_agent_op = {
                                "type": "insert_one",
                                "document": agent
                            }

                            self.chatbot_agent._query_db('agent', insert_agent_op, user_type)

                    #kb mapping
                    agent_details = self.agent_collection.find({"agent_id": {"$in": list(all_agents)}, "is_deleted":{'$ne':True}})
                    for agent in agent_details:
                        knowledge_bases = agent.get("knowledge_store", [])
                        print("knowledge_bases",knowledge_bases)
                        for kb in knowledge_bases:
                            # Handle both dict and string cases
                            if isinstance(kb, dict):
                                kb_id = kb.get("id")
                            elif isinstance(kb, str):
                                kb_id = kb.strip()           # in case someone added extra spaces
                            else:
                                # log/skip unexpected type
                                print(f"Warning: Unexpected knowledge_base item type {type(kb)} → {kb}")
                                continue

                            if not kb_id:  # skip empty/missing IDs
                                continue

                            kb_doc = self.kb_collection.find_one({"rag_id": kb_id, "is_deleted": {"$ne": True}})
                            find_op = {
                                "type": "find_one",
                                "filter": {
                                    "rag_id": kb_id,
                                }

                            }
                            res = self.chatbot_agent._query_db('kb_collection', find_op, user_type)
                            if not res:
                                if kb_doc and '_id' in kb_doc:
                                  del kb_doc['_id']

                                  insert_kb_op = {
                                     "type": "insert_one",
                                     "document": kb_doc
                                  }

                                  self.chatbot_agent._query_db('kb_collection', insert_kb_op, user_type)
                                
        return buildResponse("Subscription re-synchronized successfully.", True, 200)

    def run(self, debug=True, port=config_loader.FLASK_PORT, host='0.0.0.0'):
        self.app.run(debug=debug, port=port, host=host, threaded=True, use_reloader=False)

    # plugins methods
    @require_session
    def update_plugin(self):
        try:
            plugin_data = self.utils.validate_json_request(request)
            plugin_id = plugin_data.get("PluginId","")
 
            if not plugin_id:
                plugin_data = self.utils.validate_json_request(request)
                print(plugin_data)
                plugin_data["Created_Date"] = datetime.now()
                plugin_data["Created_By"] = "admin"
                plugin_data["IsActive"] = True
                self.plugins_collection.insert_one(plugin_data)
                return buildResponse("Plugin added successfully", None, 200)
            else:
                result = self.plugins_collection.update_one({"_id": ObjectId(plugin_id)}, {"$set": {"AgencyList": plugin_data.get("AgencyList", [])}})
                if result.matched_count == 0:
                    return buildResponse("Plugin not found", None, 404)
                return buildResponse("Plugin updated successfully", None, 200)
        except Exception as e:
            return buildResponse("Error updating plugin", {"error": str(e)}, 500)
 
    @require_session
    def get_plugin_by_id(self, plugin_id):
        plugin = json.loads(json_util.dumps(self.plugins_collection.find_one({"_id": ObjectId(plugin_id)})))
        if not plugin:
            return buildResponse("Plugin not found", None, 404)
        return buildResponse("Plugin fetched successfully", plugin, 200)
   
    @require_session
    def getallplugins(self):
        data = json.loads(json_util.dumps(self.plugins_collection.find({})))
        return buildResponse("Plugins fetched successfully", data, 200)
 
    @require_session
    def delete_plugin(self,plugin_id):
        try:
            result = self.plugins_collection.delete_one({"_id": ObjectId(plugin_id)})
            if result.deleted_count == 0:
                return buildResponse("Plugin not found", None, 404)
            return buildResponse("Plugin deleted successfully", None, 200)
        except Exception as e:
            return buildResponse("Error deleting plugin", {"error": str(e)}, 500)

    #Lyzr API methods
    def lyzr_get_tools(self):
        try:
            tools = self.lyzr_api_manager.get_lyzr_tools()
            return buildResponse(tools, True, 200)
        except Exception as e:
            print(f"Lyzr API Error: {e}")
            return buildResponse(f"Failed to fetch tools from Lyzr API: {e}", False, 500)

    def lyzr_create_tools(self):
        try:
            data = self.utils.validate_json_request(request)
            result = self.lyzr_api_manager.lyzr_create_tool(data)
            return buildResponse(result, True, 200)
        except Exception as e:
            print(f"Lyzr API Error: {e}")

    
    def lyzr_get_providers_model(self):
        try:
            models = self.lyzr_api_manager.get_lyzr_models()
            return buildResponse(models, True, 200)
        except Exception as e:
            print(f"Lyzr API Error: {e}")
            return buildResponse(f"Failed to fetch models from Lyzr API: {e}", False, 500)

    def lyzr_get_knowledge_base(self):
        try:
            kgs = self.lyzr_api_manager.get_lyzr_knowledge_bases()
            return buildResponse(kgs, True, 200)
        except Exception as e:
            print(f"Lyzr API Error: {e}")
            return buildResponse(f"Failed to fetch knowledge bases from Lyzr API: {e}", False, 500)

    def lyzr_get_provider_memory(self):
        try:
            memories = self.lyzr_api_manager.get_lyzr_provider_memory()
            return buildResponse(memories, True, 200)
        except Exception as e:
            print(f"Lyzr API Error: {e}")
            return buildResponse(f"Failed to fetch provider memories from Lyzr API: {e}", False, 500)

    def lyzr_create_agent(self):
        try:
            data = self.utils.validate_json_request(request)
            result = self.lyzr_api_manager.lyzr_create_agent(data)
            return buildResponse(result, True, 200)
        except Exception as e:
            print(f"Lyzr API Error: {e}")
            return buildResponse(f"Failed to create agent in Lyzr API: {e}", False, 500)

    def lyzr_get_mcp_servers(self):
        try:
            servers = self.lyzr_api_manager.get_lyzr_mcp_servers()
            return buildResponse(servers, True, 200)
        except Exception as e:
            print(f"Lyzr API Error: {e}")
            return buildResponse(f"Failed to fetch MCP servers from Lyzr API: {e}", False, 500)
    
    def lyzr_create_mcp_server(self):
        try:
            data = self.utils.validate_json_request(request)
            result = self.lyzr_api_manager.lyzr_create_mcp_server(data)
            return buildResponse(result, True, 200)

        except Exception as e:
            print(f"Lyzr API Error: {e}")
            return buildResponse(f"Failed to create MCP server in Lyzr API: {e}", False, 500)

    def lyzr_generate_with_ai(self):
        try:
            data = self.utils.validate_json_request(request)
            result = self.lyzr_api_manager.lyzr_generate_with_ai(data)
            return buildResponse(result, True, 200)
        except Exception as e:
            print(f"Lyzr API Error: {e}")
            return buildResponse(f"Failed to generate with AI in Lyzr API: {e}", False, 500)

    def lyzr_get_context(self):
        try:
            result = self.lyzr_api_manager.lyzr_get_context(request)
            return buildResponse(result, True, 200)

        except Exception as e:
            print(f"Lyzr API Error: {e}")
            return buildResponse(f"Failed to get context from Lyzr API: {e}", False, 500)
    
    def lyzr_create_context(self):
        try:
            data = self.utils.validate_json_request(request)
            result = self.lyzr_api_manager.lyzr_create_context(data)
            return buildResponse(result, True, 200)
        except Exception as e:
            print(f"Lyzr API Error: {e}")
            return buildResponse(f"Failed to create context in Lyzr API: {e}", False, 500)

    def lyzr_delete_agent(self):
        try:
            data = self.utils.validate_json_request(request)
            result = self.lyzr_api_manager.lyzr_delete_agent(data)
            return buildResponse(result, True, 200)
        except Exception as e:
            print(f"Lyzr API Error: {e}")
            return buildResponse(f"Failed to delete agent in Lyzr API: {e}", False, 500)

    def lyzr_get_semantic_data(self):
        try:
            result = self.lyzr_api_manager.lyzr_get_semantic_data()
            return buildResponse(result, True, 200)
        except Exception as e:
            print(f"Lyzr API Error: {e}")
            return buildResponse(f"Failed to get semantic data from Lyzr API: {e}", False, 500)

    def send_agent_approval_mail(self):
        print("befyuwef")
        try:
            data = self.utils.validate_json_request(request)
            result = self.lyzr_api_manager.send_agent_approval_mail(data)
            return buildResponse(result, True, 200)
        except Exception as e:
            return buildResponse(f"Failed to send agent approval mail in Lyzr API: {e}", False, 500)
    
    def approval_api(self, agent_id, sourceform, status):
        if request.method == 'GET':
            return self.approval_confirm(agent_id, sourceform, status)

        try:
            data = {
                "agent_id": agent_id,
                "status": status,
                "sourcefrom": sourceform
            }
            result = self.lyzr_api_manager.approval_api(data)
            return buildResponse(result, True, 200)
        except Exception as e:
            return buildResponse(f"Failed to process approval API request: {e}", False, 500)

    def approval_confirm(self, agent_id, sourceform, status):
        valid_status = status if status in ["Approved", "Rejected"] else None
        agent_data = self.agent_collection.find_one({"_id": ObjectId(agent_id)})
        Approval_Status = agent_data.get("Approval_Status", "") if agent_data else ""
        if not valid_status:
            html = f"""<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Invalid Approval Request</title></head><body style=\"font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;\"><h2>Invalid approval request</h2><p>The requested action is not valid.</p></body></html>"""
            return Response(html, mimetype='text/html')

        action_label = "Approve" if valid_status == "Approved" else "Decline"
        print("iew",config_loader.URL_CONF)
        site_url = (config_loader.URL_CONF or "https://sdlcai.movatesolutions.com/devapi").rstrip("/")
        action_url = f"{site_url}/approvalAPI/{escape(agent_id)}/{escape(sourceform)}/{escape(valid_status)}"
        
        # Check if agent is already approved or rejected
        is_already_processed = Approval_Status in ["Approved", "Rejected"]
        
        if is_already_processed:
            status_message = f"Agent has been {Approval_Status.lower()}"
            html = f"""<!DOCTYPE html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\">
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">
  <title>Agent {Approval_Status}</title>
  <script>
    window.onload = function() {{
      alert('Agent is {Approval_Status}. The confirm button is disabled.');
    }};
  </script>
</head>
<body style=\"font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;color:#111;\">
  <h1>Agent {action_label} Request</h1>
  <p><strong>Agent ID:</strong> {escape(agent_id)}</p>
  <p><strong>Operation:</strong> {escape(sourceform)}</p>
  <p><strong>Status:</strong> <span style=\"color:#dc3545;font-weight:bold;\">{Approval_Status}</span></p>
  <p style=\"color:#666; background-color:#f0f0f0; padding:10px; border-radius:4px;\">This agent has already been {Approval_Status.lower()}. No further action can be taken.</p>
  <form method=\"post\" action=\"{action_url}\">
    <button type=\"submit\" disabled style=\"padding:12px 24px;background-color:#cccccc;color:#666;border:none;border-radius:4px;font-size:16px;cursor:not-allowed;opacity:0.6;\">Confirm {action_label} (Disabled)</button>
  </form>
  <p style=\"margin-top:20px;color:#555;\">If you have questions, please contact the administrator.</p>
</body>
</html>"""
            return Response(html, mimetype='text/html')
        
        html = f"""<!DOCTYPE html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\">
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">
  <title>{action_label} Agent Request</title>
</head>
<body style=\"font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;color:#111;\">
  <h1>{action_label} Agent Request</h1>
  <p><strong>Agent ID:</strong> {escape(agent_id)}</p>
  <p><strong>Operation:</strong> {escape(sourceform)}</p>
  <p><strong>Action:</strong> {escape(valid_status)}</p>
  <p>This request will only be processed when you confirm below. Email scanners and prefetchers will not execute the approval/rejection.</p>
    <form method=\"post\" action=\"{action_url}\">
    <button type=\"submit\" style=\"padding:12px 24px;background-color:#28a745;color:#fff;border:none;border-radius:4px;font-size:16px;cursor:pointer;\">Confirm {action_label}</button>
  </form>
  <p style=\"margin-top:20px;color:#555;\">If you do not want to process this request, simply close this page.</p>
</body>
</html>"""
        return Response(html, mimetype='text/html')

    @require_session
    def get_query_response(self):
        try:
            data = request.get_json(silent=True) or {}
            
            # Extract optional master_agent_id filter
            master_agent_id = data.get("master_agent_id", "").strip() or None
            
            # Get user_type from current session for multi-tenant support
            current_user = get_current_user()
            user_type = None
            if current_user:
                prj_name = current_user.get('ActiveProject', 'master')
                project_doc = self.project.find_one({'projectName': prj_name})
                if project_doc:
                    user_type = project_doc.get('database_name')
            
            # Fetch top 5 recent queries
            results = self.chatbot_agent.fetch_query_response(
                master_agent_id=master_agent_id,
                user_type=user_type
            )
            
            return buildResponse(
                "Recent data fetched successfully",
                results,
                200
            )
        
        except Exception as e:
            logger.error(f"Error fetching recent data: {str(e)}")
            logger.error(traceback.format_exc())
            return buildResponse(
                f"Error fetching recent data: {str(e)}",
                [],
                500
            )

    def get_approvers_list(self):
        try:
            approvers = config_loader.EMAIL_APPROVAL_MANAGER
            return buildResponse("Approvers list fetched successfully", approvers, 200)
        except Exception as e:
            return buildResponse(f"Failed to fetch approvers list: {e}", None, 500)

    def get_automation_library(self):
        try:
            library = self.automation_library_api_manager.get_automation_library()
            for item in library:
                automation_script_type = item.get("automation_script_type")
                if automation_script_type:
                    script_type_details = self.automation_script_types_collection.find_one({"_id": ObjectId(automation_script_type)})
                    if script_type_details:
                        item["automation_script_type_name"] = script_type_details.get("name")
                file_ids = item.get("script_file_ids", [])
                files = []
                for file_id in file_ids:
                    print(f"Fetching file with ID: {file_id}")
                    grid_out = self.automation_library_api_manager.fs.get(ObjectId(file_id))
                    file_name = grid_out.filename
                    files.append({
                        "file_id": str(file_id),
                        "file_name": file_name
                    })
                item["script_file_ids"] = files

            return buildResponse("Automation library fetched successfully", library, 200)
        except Exception as e:
            print(f"Error fetching automation library: {e}")
            return buildResponse(f"Failed to fetch automation library: {e}", None, 500)
    
    def get_automation_library_by_id(self, library_id):
        try:
            library = self.automation_library_api_manager.get_automation_library_by_id(library_id)
            if library:
                automation_script_type = library.get("automation_script_type")
                if automation_script_type:
                    script_type_details = self.automation_script_types_collection.find_one({"_id": ObjectId(automation_script_type)})
                    if script_type_details:
                        library["automation_script_type_name"] = script_type_details.get("name")
                file_ids = library.get("script_file_ids", [])
                files = []
                for file_id in file_ids:
                    grid_out = self.automation_library_api_manager.fs.get(ObjectId(file_id))
                    file_name = grid_out.filename
                    files.append({
                        "file_id": str(file_id),
                        "file_name": file_name
                    })
                library["script_file_ids"] = files
                return buildResponse("Automation library item fetched successfully", library, 200)
            else:
                return buildResponse("Automation library item not found", None, 404)
        except Exception as e:
            print(f"Error fetching automation library by ID: {e}")
            return buildResponse(f"Failed to fetch automation library item: {e}", None, 500)

    def add_automation_library(self):
        try:
            data = self.utils.validate_json_request(request)
            file = request.files.getlist('files')
            data = {
                "name": request.form.get("name"),
                "description": request.form.get("description"),
                "automation_script_type": request.form.get("automation_script_type")
            }
            result = self.automation_library_api_manager.add_to_automation_library(data,file)
            return buildResponse(result, True, 200)
        except Exception as e:
            return buildResponse(f"Failed to add to automation library: {e}", None, 500)
    
    def update_automation_library(self):
        try:
            file = request.files.getlist('files')
            data = {
                "name": request.form.get("name"),
                "description": request.form.get("description"),
                "automation_script_type": request.form.get("automation_script_type"),
                "script_file_ids": request.form.get("script_file_ids"),
                "library_id": request.form.get("library_id")
            }
            result = self.automation_library_api_manager.update_automation_library(data,file)
            return buildResponse(result, True, 200)
        except Exception as e:
            return buildResponse(f"Failed to update automation library: {e}", None, 500)

    def delete_automation_library(self, library_id):
        try:
            result = self.automation_library_api_manager.delete_from_automation_library(library_id)
            return buildResponse(result, True, 200)
        except Exception as e:
            return buildResponse(f"Failed to delete from automation library: {e}", None, 500)

    def get_automation_script_types(self):
        try:
            script_types = self.automation_library_api_manager.get_automation_script_types()
            return buildResponse("Automation script types fetched successfully", script_types, 200)
        except Exception as e:
            print(f"Error fetching automation script types: {e}")
            return buildResponse(f"Failed to fetch automation script types: {e}", None,500)

    # Prompt Repository
    @require_session
    def get_agency_with_agents_enhanced(self):
        prompt_repo = PromptRepository()
        results = prompt_repo.get_agency_with_agents_promptrepo()
        return buildResponse("Enhanced agency details", results, 200)

    @require_session
    def save_prompt(self):
        """Save a new prompt to prompt_repo and optionally update chatbot_tracking"""
        try:
            data = request.get_json()
            
            # Validate required fields
            required_fields = ["agency_id", "agent_id", "prompt_title", "user_query","map_id"]
            if not all(field in data for field in required_fields):
                return buildResponse("Missing required fields", None, 400)
            
            prompt_repo = PromptRepository()
            event_id = data.get("event_id")  # Optional event_id from feedback
            
            # Update chatbot_tracking if event_id is provided
            if event_id:
                try:
                    # Use minimal reliable filter first
                    update_filter = {'event_id': event_id}

                    # Add more fields only if they exist in payload to avoid mismatch
                    if data.get("agency_id"):
                        update_filter['agency_id'] = data["agency_id"]
                    if data.get("agent_id"):
                        update_filter['agent_id'] = data["agent_id"]

                    update_op = {
                        'type': 'update_one',
                        'filter': update_filter,
                        'update': {
                            "$set": {
                                "prompt_title": data["prompt_title"],
                                "isSavedToRepo": True,
                                "updated_ts": datetime.now(timezone.utc)
                            }
                        }
                    }
                    prompt_repo._query_db('chatbot_tracking', update_op)
                except Exception as e:
                    print(f"Error updating chatbot_tracking: {str(e)}")
            
            # Save to prompt_repo
            result = prompt_repo.save_promptrepo(
                agency_id=data["agency_id"],
                agent_id=data["agent_id"],
                map_id=data["map_id"],
                prompt_title=data["prompt_title"],
                user_query=data["user_query"],
                created_by=data["created_by"]
            )
            
            return buildResponse("Prompt saved successfully", result, 200)
            
        except Exception as e:
            return buildResponse(f"Error saving prompt: {str(e)}", None, 500)

    @require_session
    def update_prompt(self):
        """Update prompt with special logic when user_query changes"""
        try:
            data = request.get_json()
            
            # Validate required fields - event_id is now OPTIONAL
            required_fields = ["agency_id", "agent_id", "prompt_title", "user_query", "map_id"]
            if not all(field in data for field in required_fields):
                return buildResponse("Missing required fields", None, 400)

            prompt_repo = PromptRepository()
            
            agency_id = data["agency_id"]
            agent_id = data["agent_id"]
            prompt_title = data["prompt_title"].strip()
            user_query = data["user_query"].strip()
            map_id = data["map_id"]
            event_id = data.get("event_id")  # Optional - may not exist for non-executed prompts

            # === CASE 1: No event_id provided (prompt only in prompt_repo, not executed yet) ===
            if not event_id:
                # Just update prompt_repo using map_id
                update_op_repo = {
                    'type': 'update_one',
                    'filter': {
                        "agency_id": agency_id,
                        "agent_id": agent_id,
                        "map_id": map_id
                    },
                    'update': {
                        "$set": {
                            "prompt_title": prompt_title,
                            "user_query": user_query,
                            "updated_ts": datetime.now(timezone.utc)
                        },
                        "$unset": {"is_executed": ""}
                    }
                }
                result = prompt_repo._query_db('prompt_repo', update_op_repo)
                
                if result and result.get('matched_count', 0) > 0:
                    return buildResponse("Prompt updated successfully in prompt_repo", None, 200)
                else:
                    return buildResponse("Prompt not found in prompt_repo", None, 404)

            # === CASE 2: event_id provided (prompt may be executed) ===
            # Get original document from chatbot_tracking
            original = prompt_repo._query_db('chatbot_tracking', {
                'type': 'find_one',
                'filter': {'event_id': event_id}
            })

            # If not found in chatbot_tracking, fall back to just updating prompt_repo
            if not original:
                # Prompt not executed yet, just update prompt_repo
                update_op_repo = {
                    'type': 'update_one',
                    'filter': {
                        "agency_id": agency_id,
                        "agent_id": agent_id,
                        "map_id": map_id
                    },
                    'update': {
                        "$set": {
                            "prompt_title": prompt_title,
                            "user_query": user_query,
                            "updated_ts": datetime.now(timezone.utc)
                        },
                        "$unset": {"is_executed": ""}
                    }
                }
                prompt_repo._query_db('prompt_repo', update_op_repo)
                return buildResponse("Prompt updated successfully in prompt_repo", None, 200)

            original_user_query = (original.get("user_query") or "").strip()

            # === 2a. Always update prompt_repo ===
            update_op_repo = {
                'type': 'update_one',
                'filter': {
                    "agency_id": agency_id,
                    "agent_id": agent_id,
                    "map_id": map_id
                },
                'update': {
                    "$set": {
                        "prompt_title": prompt_title,
                        "user_query": user_query,
                        "updated_ts": datetime.now(timezone.utc)
                    },
                    "$unset": {"is_executed": ""}
                }
            }
            prompt_repo._query_db('prompt_repo', update_op_repo)

            # === 2b. Handle chatbot_tracking differently ===
            if user_query == original_user_query:
                # Only title changed → Simple update
                update_op_chatbot = {
                    'type': 'update_one',
                    'filter': {'event_id': event_id},
                    'update': {
                        "$set": {
                            "prompt_title": prompt_title,
                            "updated_ts": datetime.now(timezone.utc),
                            "isSavedToRepo": True
                        }
                    }
                }
                prompt_repo._query_db('chatbot_tracking', update_op_chatbot)
                return buildResponse("Prompt title updated successfully", None, 200)

            else:
                # User Query changed → Mark old record as NOT saved to repo anymore
                prompt_repo._query_db('chatbot_tracking', {
                    'type': 'update_one',
                    'filter': {'event_id': event_id},
                    'update': {
                        "$set": {
                            "isSavedToRepo": False,
                            "updated_ts": datetime.now(timezone.utc)
                        }
                    }
                })

                return buildResponse("New version created successfully (query was updated)", None, 200)

        except Exception as e:
            import traceback
            traceback.print_exc()
            return buildResponse(f"Error updating prompt: {str(e)}", None, 500)

    @require_session
    def delete_prompt(self):
        """Soft delete prompt based on execution status (simplified)"""
        try:
            data = request.get_json()
            
            # Validate required fields
            required_fields = ["agency_id", "agent_id", "prompt_title", "user_query"]
            if not all(field in data for field in required_fields):
                return buildResponse("Missing required fields", None, 400)
            
            prompt_repo = PromptRepository()
            
            # Check if prompt is executed
            is_executed = prompt_repo.is_prompt_executed(
                data["agent_id"],
                data["prompt_title"],
                data["user_query"]
            )
            
            if is_executed:
                # Soft delete both collections
                result = prompt_repo.soft_delete_prompt_in_both_collections(
                    agent_id=data["agent_id"],
                    prompt_title=data["prompt_title"],
                    user_query=data["user_query"]
                )
            else:
                # Soft delete only prompt_repo
                result = prompt_repo.soft_delete_prompt_in_repo(
                    agent_id=data["agent_id"],
                    prompt_title=data["prompt_title"],
                    user_query=data["user_query"]
                )
            
            return buildResponse("Prompt deleted successfully", result, 200)
            
        except Exception as e:
            return buildResponse(f"Error deleting prompt: {str(e)}", None, 500)
        
    @require_session
    def batch_update_prompts(self):
        """Bulk update multiple prompts in both collections (chatbot_tracking + prompt_repo)"""
        try:
            data = request.get_json()
            
            if not data or 'updates' not in data:
                return buildResponse("Missing 'updates' array in request body", None, 400)
            
            updates = data['updates']
            if not isinstance(updates, list) or len(updates) == 0:
                return buildResponse("Updates must be a non-empty array", None, 400)
            
            prompt_repo = PromptRepository()
            success_count = 0
            errors = []
            
            for idx, item in enumerate(updates):
                try:
                    # Validate required fields for each item
                    required_fields = ["agency_id", "agent_id", "prompt_title", "user_query", "event_id", "map_id"]
                    if not all(field in item for field in required_fields):
                        errors.append(f"Item {idx}: Missing required fields")
                        continue
                    
                    map_id = item.get("map_id")
                    event_id = item.get("event_id")
                    
                    # 1. Update chatbot_tracking using event_id
                    update_op_chatbot = {
                        'type': 'update_one',
                        'filter': {
                            'event_id': event_id,
                            'agent_id': item["agent_id"],
                        },
                        'update': {
                            "$set": {
                                "prompt_title": item["prompt_title"],
                                "user_query": item["user_query"],
                                "map_id": map_id,
                                "isSavedtoRepo": True,
                                "updated_ts": datetime.now(timezone.utc)
                            }
                        }
                    }
                    prompt_repo._query_db('chatbot_tracking', update_op_chatbot)
                    
                    # 2. Update prompt_repo (always update, even if executed)
                    update_op_repo = {
                        'type': 'update_one',
                        'filter': {
                            "agency_id": item["agency_id"],
                            "agent_id": item["agent_id"],
                            "map_id": map_id,
                        },
                        'update': {
                            "$set": {
                                "prompt_title": item["prompt_title"],
                                "user_query": item["user_query"],
                                "map_id": item["map_id"],
                                "updated_ts": datetime.now(timezone.utc)
                            },
                            "$unset": {
                                "is_executed": ""
                            }
                        }
                    }
                    prompt_repo._query_db('prompt_repo', update_op_repo)
                    
                    success_count += 1
                    
                except Exception as item_err:
                    errors.append(f"Item {idx}: {str(item_err)}")
                    continue  # Continue with other items even if one fails
            
            response_message = f"Successfully updated {success_count} out of {len(updates)} prompts"
            
            if errors:
                return buildResponse(response_message, {"success_count": success_count, "errors": errors}, 200)
            
            return buildResponse(response_message, {"success_count": success_count}, 200)
            
        except Exception as e:
            return buildResponse(f"Error in batch update: {str(e)}", None, 500)
        
    @require_session
    def deduplicate_prompt_titles(self):
        """Generate unique titles for ALL duplicate records in both
        chatbot_tracking_collection and prompt_repo collection.
        """
        try:
            data = self.utils.validate_json_request(request)
            dry_run = data.get("dry_run", True)

            # ------------------------------------------------------------------
            # fetch records that have a non-empty title + query
            # ------------------------------------------------------------------
            def fetch_records(collection, extra_projection=None):
                query = {
                    "prompt_title": {"$exists": True, "$ne": None, "$ne": ""},
                    "user_query":   {"$exists": True, "$ne": None, "$ne": ""}
                }
                projection = {
                    "event_id": 1,        
                    "_id": 1,             
                    "prompt_title": 1,
                    "user_query": 1,
                    "prompt_output": 1  
                }
                if extra_projection:
                    projection.update(extra_projection)

                return list(collection.find(query, projection).sort("updated_ts", -1))

            # ------------------------------------------------------------------
            # STEP 1 – Load records from both collections
            # ------------------------------------------------------------------
            tracking_records = fetch_records(self.chatbot_tracking_collection)
            repo_records     = fetch_records(self.prompt_repo)   # ← new

            # Tag each record with its source so we know where to write later
            for r in tracking_records:
                r["_source"] = "tracking"
            for r in repo_records:
                r["_source"] = "repo"

            all_records = tracking_records + repo_records

            if not all_records:
                return buildResponse("No records found", {"total_updated": 0}, 200)

            # ------------------------------------------------------------------
            # STEP 2 – Build duplicate maps
            # ------------------------------------------------------------------
            title_count = {}
            title_query_combo_count = {}

            for record in all_records:
                title = (record.get("prompt_title") or "").strip().lower()
                query_text = (record.get("user_query") or "").strip().lower()

                if title:
                    title_count[title] = title_count.get(title, 0) + 1

                combo_key = f"{title}|||{query_text}"
                title_query_combo_count[combo_key] = title_query_combo_count.get(combo_key, 0) + 1

            # ------------------------------------------------------------------
            # STEP 3 – Collect every record that is a duplicate
            # ------------------------------------------------------------------
            records_to_process = []

            for record in all_records:
                original_title = record.get("prompt_title") or ""
                user_query = record.get("user_query", "")

                if not original_title.strip() or not user_query:
                    continue

                title_lower = original_title.strip().lower()
                query_lower = user_query.strip().lower()

                is_duplicate_title = title_count.get(title_lower, 0) > 1
                combo_key = f"{title_lower}|||{query_lower}"
                is_duplicate_combo = title_query_combo_count.get(combo_key, 0) > 1

                if is_duplicate_title or is_duplicate_combo:
                    records_to_process.append(record)

            if not records_to_process:
                return buildResponse("No duplicate titles found", {
                    "total_duplicates_found": 0,
                    "total_updated": 0,
                    "message": "All titles are already unique"
                }, 200)

            # ------------------------------------------------------------------
            # STEP 4 – Shared uniqueness set
            # ------------------------------------------------------------------
            evaluator = AgentEval()
            changes_log = []
            total_updated = 0

            # Load all existing titles from both collections once
            existing_titles = self._get_all_existing_titles()         
            existing_titles |= self._get_all_existing_titles_from_repo() 

            # ------------------------------------------------------------------
            # STEP 5 – Generate unique titles & write back
            # ------------------------------------------------------------------
            for record in records_to_process:
                source = record["_source"]
                original_title = record.get("prompt_title") or ""
                user_query = record.get("user_query", "")
                prompt_output = record.get("prompt_output", "")   

                new_title = self._generate_unique_prompt_title(
                    evaluator=evaluator,
                    original_title=original_title,
                    user_query=user_query,
                    prompt_output=prompt_output,
                    existing_titles=existing_titles
                )

                if not new_title or new_title == original_title:
                    continue

                if not dry_run:
                    if source == "tracking":
                        self.chatbot_tracking_collection.update_one(
                            {"event_id": record["event_id"]},
                            {
                                "$set": {
                                    "prompt_title": new_title,
                                    "isSavedToRepo": True,
                                    "updated_ts": datetime.now(timezone.utc)
                                }
                            }
                        )
                    else:  # prompt_repo
                        self.prompt_repo.update_one(
                            {"_id": record["_id"]},
                            {
                                "$set": {
                                    "prompt_title": new_title,
                                    "updated_ts": datetime.now(timezone.utc)
                                }
                            }
                        )

                # Logging
                title_lower = original_title.strip().lower()
                query_lower = user_query.strip().lower()
                combo_key = f"{title_lower}|||{query_lower}"

                reasons = []
                if title_count.get(title_lower, 0) > 1:
                    reasons.append("duplicate_title")
                if title_query_combo_count.get(combo_key, 0) > 1:
                    reasons.append("duplicate_title+query")

                changes_log.append({
                    "source": source,
                    "id": str(record.get("event_id") or record.get("_id")),
                    "original_title": original_title,
                    "new_title": new_title,
                    "user_query_preview": (user_query[:150] + "...") if len(user_query) > 150 else user_query,
                    "reason": " | ".join(reasons) if reasons else "duplicate"
                })

                total_updated += 1
                existing_titles.add(new_title.lower())   

            return buildResponse(
                f"Successfully processed {total_updated} duplicate titles "
                f"(tracking + prompt_repo).",
                {
                    "total_duplicates_found": len(records_to_process),
                    "total_updated": total_updated,
                    "dry_run": dry_run,
                    "changes": changes_log
                },
                200
            )

        except Exception as e:
            import traceback
            logger.error(traceback.format_exc())
            return buildResponse(f"Error: {str(e)}", None, 500)

    def _generate_unique_prompt_title(self, evaluator, original_title, user_query, prompt_output, existing_titles=None, max_attempts=3):
        """Generate unique title using Judge Agent."""
        if existing_titles is None:
            existing_titles = self._get_all_existing_titles()

        for attempt in range(max_attempts):
            prompt = f"""You are a strict title deduplicator.

    Original Title: {original_title or 'No Title'}
    User Query: {user_query}
    Output Summary: {str(prompt_output)[:650]}

    Generate a **unique, clear, professional, descriptive title** (max 50 characters).
    Make it specific and different from existing ones.
    Return ONLY the title as plain text. No quotes, no explanation."""

            try:
                new_title = evaluator.call_title_recover_agent(prompt)
                if not new_title:
                    continue

                new_title = str(new_title).strip().strip('"').strip("'")

                if len(new_title) >= 5 and new_title.lower() not in existing_titles:
                    return new_title

            except Exception as e:
                logger.warning(f"Judge attempt {attempt+1} failed: {e}")

        return None

    def _get_all_existing_titles_from_repo(self):
        """Get current set of prompt titles from prompt_repo (case-insensitive)."""
        try:
            titles = self.prompt_repo.distinct("prompt_title")
            return {str(t).strip().lower() for t in titles if t and str(t).strip()}
        except Exception as e:
            logger.warning(f"Failed to fetch existing titles from prompt_repo: {e}")
            return set()
    
    def _get_all_existing_titles(self):
        """Get current set of prompt titles for uniqueness (case-insensitive)."""
        try:
            titles = self.chatbot_tracking_collection.distinct("prompt_title")
            return {str(t).strip().lower() for t in titles if t and str(t).strip()}
        except Exception as e:
            logger.warning(f"Failed to fetch existing titles: {e}")
            return set()
    # Agent Evaluation
    @require_session
    def agent_evaluation_handler(self):
        """Handle agent evaluation requests from UI"""
        try:
            data = self.utils.validate_json_request(request)

            # Validate required fields
            evaluation_type = data.get("evaluation_type", "")
            evaluation_method = data.get("evaluation_method", "")

            required_fields = ["agent_id", "evaluation_type"]
            # data_set is NOT required for Simulation-Based or Config + I/O Dataset
            if evaluation_method not in ["Simulation-Based", "Config + I/O Dataset", "I/O Dataset Evaluation", "Config + Trace Data", "Trace-Based Evaluation"]:
                required_fields.append("data_set")

            if not all(field in data for field in required_fields):
                return buildResponse("Missing required fields", None, 400)

            evaluator = AgentEval()
            result = evaluator.evaluate_agent(data)

            return buildResponse("Evaluation completed successfully", result, 200)

        except Exception as e:
            import traceback
            traceback.print_exc()
            return buildResponse(f"Error in agent evaluation: {str(e)}", None, 500)

    @require_session
    def fetch_agent_evaluation_handler(self):
        """Handle fetching agent evaluation data from UI"""
        try:
            agent_id = request.args.get('agent_id')
            evaluation_type = request.args.get('evaluation_type')
            data_set = request.args.get('data_set')

            if not all([agent_id, evaluation_type, data_set]):
                return buildResponse("Missing required parameters: agent_id, evaluation_type, or data_set", None, 400)

            # FIX: Added "I/O Dataset Evaluation" to allowed values
            if data_set not in ["Input/Output Data", "Trace Data", "Simulation Data", "Config + I/O Dataset", "I/O Dataset Evaluation", "Config + Trace Data", "Trace-Based Evaluation"]:
                return buildResponse(
                    "Invalid data_set value.",
                    None, 400
                )

            evaluator = AgentEval()
            result = evaluator.fetch_evaluation_data(agent_id, evaluation_type, data_set)

            return buildResponse("Evaluation data fetched successfully", result, 200)

        except Exception as e:
            import traceback
            traceback.print_exc()
            return buildResponse(f"Error fetching evaluation data: {str(e)}", None, 500)
        

            
    def fetch_agent_version_history(self):
        try:
            data = self.utils.validate_json_request(request)
            agent_id = data.get("agent_id")
            version_history = json.loads(json_util.dumps(self.agent_version_history_collection.find({"agent_id": agent_id})))
            version_list = list(version_history)[::-1]
            return buildResponse("Agent version history fetched successfully", version_list, 200)
        except Exception as e:
            print(f"Error fetching agent version history: {e}")
            return buildResponse(f"Failed to fetch agent version history: {e}", None, 500)

    def fetch_agent_version_details(self):
        try:
            data = self.utils.validate_json_request(request)
            version = data.get("version")
            agent_id = data.get("agent_id")
            version_details = json.loads(json_util.dumps(self.agent_version_history_collection.find_one({"version": version, "agent_id": agent_id})))
            return buildResponse("Agent version details fetched successfully", version_details, 200)
        except Exception as e:
            print(f"Error fetching agent version details: {e}")
            return buildResponse(f"Failed to fetch agent version details: {e}", None, 500)

    @require_session
    def get_all_tools(self):
        try:
            find_op = {'type': 'find','filter': {}}
            tools = self.chatbot_agent._query_db('tool_management_collection', find_op)
            # tools = json.loads(json_util.dumps(self.tool_management_collection.find({})))
            return buildResponse("All tools fetched successfully", tools, 200)
        except Exception as e:
            print(f"Error fetching all tools: {e}")
            return buildResponse(f"Failed to fetch all tools: {e}", None, 500)

    @require_session
    def get_tool_by_id(self, tool_id):
        try:
            tool = json.loads(json_util.dumps(self.tool_management_collection.find_one({"_id": ObjectId(tool_id)})))
            if tool:
                return buildResponse("Tool fetched successfully", tool, 200)
            else:
                return buildResponse("Tool not found", None, 404)
        except Exception as e:
            print(f"Error fetching tool by ID: {e}")
            return buildResponse(f"Failed to fetch tool by ID: {e}", None, 500)

    @require_session
    def save_connections_details(self):
        try:
            data = self.utils.validate_json_request(request)
            connection_name = data.get("connection_name")
            connecter = data.get("connector")
            user_id = data.get("user_id")
            credentials = data.get("credentials", {})
            connector_id = data.get("connector_id")  # Optional: If provided, update existing connector
            auth = data.get("auth")
            custom_tool = data.get("custom_tool", [])
            tools_order = data.get("tools_order", [])

            credentials = encrypt_data(credentials)

            existing_connection = self.connections_collection.find_one({"connector_type": connecter,"connection_name": connection_name})
            if not existing_connection:
                connection_id = str(self.connections_collection.insert_one({
                    
                    "connection_name": connection_name,
                    "connector_type": connecter,
                    "connector_id": connector_id,
                    "user_id": user_id,
                    "credentials": credentials,
                    "auth_type": auth,
                    "tools_order": tools_order,
                    "created_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc)
                }).inserted_id)

                tools = self.tool_management_collection.find_one({"tool_name": connecter})
                tool_actions = tools.get("tool_action", []) if tools else []
                for action in tool_actions:
                    description = action.get("action_desc", "")
                    # connector_id = tools.get("_id", "") 
                    connector_type = tools.get("tool_name")
                    tool_action_name = action.get("action_name", "")

                    self.active_tool_collection.insert_one({
                        "connector_id": connector_id,
                        "connector_type": connector_type,
                        "connection_id": connection_id,
                        "tool_action_name": tool_action_name,
                        "description": description,
                        "created_at": datetime.now(timezone.utc),
                        "type": "default"
                    })

                for actions in custom_tool:
                    self.active_tool_collection.insert_one({
                        "connector_id": connector_id,
                        "connector_type": tools.get("tool_name"),
                        "connection_id": connection_id,
                        "tool_action_name": actions.get("action_name", ""),
                        "description": actions.get("action_desc", ""),
                        "created_at": datetime.now(timezone.utc),
                        "parameter":actions.get("parameters", []),
                        "type": "custom"
                    })
            else:
                connection_id = str(existing_connection.get("_id"))
                # Update existing connector details
                self.connections_collection.update_one(
                    {"_id": ObjectId(connection_id)},
                    {"$set": {
                        "connection_name": connection_name,
                        "connector_type": connecter,
                        "connector_id": connector_id,
                        "user_id": user_id,
                        "credentials": credentials,
                        "auth_type": auth,
                        "tools_order": tools_order,
                        "updated_at": datetime.now(timezone.utc),
                    }}
                )
                for actions in custom_tool:
                    id: str = actions.get("id", '')
                    payload = {
                            "connector_id": connector_id,
                            "connection_id": connection_id,
                            "tool_action_name": actions.get('action_name', ""),
                            "connector_type": connecter,
                            "description": actions.get("action_desc", ""),
                            "created_at": datetime.now(timezone.utc),
                            "parameter":actions.get("parameters", []),
                            "type": "custom"
                    }

                    if id:
                         self.active_tool_collection.update_one(
                            { "_id": ObjectId(id) },
                            { "$set": payload },
                            upsert=True
                        ) 
                    else :
                         self.active_tool_collection.insert_one(payload)               


            return buildResponse("Connection details saved successfully", None, 200)
        
               
        except Exception as e:
            print(f"Error saving connection: {e}")
            return buildResponse(f"Failed to saving connection {e}", None, 500)

    @require_session
    def fetch_connections(self, request=None):
        try:
            pipeline = []

            # Get optional query parameter
            connector_name = request.args.get("connector_name") if request else None

            # Filter by connector_name if provided
            if connector_name:
                pipeline.append({
                    "$match": {
                        "connector_type": connector_name  # Matches exact connector type/name
                    }
                })

            # Add remaining aggregation stages
            pipeline.extend([
                {
                    "$group": {
                        "_id": "$connector_type",
                        "connections": {
                            "$push": {
                                "connection_id": {"$toString": "$_id"},  # Convert ObjectId to string
                                "connection_name": "$connection_name",
                                "connector_id": "$connector_id",
                                "user_id": "$user_id",
                                "auth_type": "$auth_type",
                                "created_at": {"$toString": "$created_at"}  # Convert datetime to string
                            }
                        }
                    }
                },
                {
                    "$project": {
                        "_id": 0,
                        "connector_type": "$_id",
                        "connections": 1
                    }
                }
            ])

            # Execute aggregation pipeline
            grouped_connectors = list(self.connections_collection.aggregate(pipeline))

            return buildResponse("Connectors fetched successfully", grouped_connectors, 200)

        except Exception as e:
            print(f"Error fetching connectors: {e}")
            return buildResponse(f"Failed to fetch connectors: {e}", None, 500)

    @require_session   
    def get_connection_data_by_id(self, connection_id):
        try:
            # 1. Validate connection_id
            try:
                obj_id = ObjectId(connection_id)
            except Exception as e:
                return buildResponse("Invalid connection_id format", None, 400)

            # 2. Fetch connection details
            connection = self.connections_collection.find_one({"_id": obj_id})
            if not connection:
                return buildResponse("Connection not found", None, 404)

            # Format connection details
            connection["_id"] = str(connection["_id"])
            if "created_at" in connection and connection["created_at"]:
                connection["created_at"] = connection["created_at"].isoformat()

            # 3. Fetch active tool actions for this connection
            active_tools_cursor = self.active_tool_collection.find(
                {"connection_id": connection_id}
            )

            active_tools = []
            for tool in active_tools_cursor:
                tool["_id"] = str(tool["_id"])
                if "created_at" in tool and tool["created_at"]:
                    tool["created_at"] = tool["created_at"].isoformat()
                active_tools.append(tool)

            # Combine active tools inside connection object
            connection["active_tools"] = active_tools

            # 4. Map directly as { connection_id : data }
            result = {connection_id: connection}

            return buildResponse("Data fetched successfully", result, 200)

        except Exception as e:
            print(f"Error fetching connection details: {e}")
            return buildResponse(f"Failed to fetch data: {e}", None, 500)

    @require_session
    def delete_connection(self, connection_id):
        try:
            # Extract connection_id from request body or query params
            # data = self.utils.validate_json_request(request) if request else {}
            # connection_id = data.get("connection_id") or (request.args.get("connection_id") if request else None)

            # try:
            #     connection_id = ObjectId(connection_id)
            # except Exception as e:
            #     return buildResponse("Invalid connection_id format", None, 400)

            # 1. Check if the connection exists
            existing_connection = self.connections_collection.find_one({"_id": ObjectId(connection_id)})
            if not existing_connection:
                return buildResponse("Connection not found", None, 404)

            # 2. Delete connection from connections_collection
            self.connections_collection.delete_one({"_id": ObjectId(connection_id)})

            # 3. Delete all matching active tools from active_tool_collection
            # Note: connection_id was stored as a string in active_tool_collection
            delete_tools_result = self.active_tool_collection.delete_many({"connection_id": str(connection_id)})

            return buildResponse(
                f"Connection and {delete_tools_result.deleted_count} associated active tools deleted successfully", 
                None, 
                200
            )

        except Exception as e:
            print(f"Error deleting connection: {e}")
            return buildResponse(f"Failed to delete connection: {str(e)}", None, 500)
    # def run_tool(self):
    #     try:
    #         data = self.utils.validate_json_request(request)
    #         function_name = data.get("function_name")
    #         if not function_name:
    #             return buildResponse("Missing required field: function_name", None, 400)

    #         parameters = data.get("parameters", {})
    #         tool_id = data.get("tool_id")
    #         if not tool_id:
    #             return buildResponse("Missing required field: tool_id", None, 400)
    #         data = json.loads(json_util.dumps(self.connections_collection.find_one({"_id": ObjectId(tool_id)})))
    #         print(data)
    #         credentials = data.get("credentials", {})
    #         tool_payload = dict(parameters or {})
    #         tool_payload["credentials"] = credentials
    #         result = self.tool_manager.execute_function(function_name, tool_payload)
    #         return buildResponse("Tool executed successfully", result, 200)
    #     except Exception as e:
    #         print(f"Error executing tool: {e}")
    #         return buildResponse(f"Failed to execute tool: {e}", None, 500)

    # def agent_tool_call(self):

    #     tools_prompt = "\n\nYou have access to these tools. When you need to use a tool, respond with ONLY with the output format mentioned. Do not add any extra text.\n"
    #     try:
    #         data = self.utils.validate_json_request(request)
    #         agent_id = data.get("agent_id","")
    #         user_id = data.get("user_id","")
    #         user_query = data.get("user_query","")
    #         session_id = data.get("session_id","")
    #         api_key = data.get("api_key","")
    #         tool_id = data.get("tool_id","")

    #         prompt = f"User Query: {user_query}{tools_prompt}"
    #         tool_details = json.loads(json_util.dumps(self.connections_collection.find_one({"_id": ObjectId(tool_id)})))
    #         if tool_details:
    #             credentials = tool_details.get("credentials", {})
    #             connector_type = tool_details.get("connector_type")
    #             tool = json.loads(json_util.dumps(self.tool_management_collection.find_one({"tool_name": connector_type})))
    #             tool_functions = tool.get("tool_action", [])
    #             final_prompt = f"{prompt}\n\nTool Functions: {tool_functions}"

    #             headers = {"x-api-key": api_key, "Content-Type": "application/json"}
    #             agent_api_url = "https://agent-prod.studio.lyzr.ai"
    #             payload = {
    #                 "user_id": user_id,
    #                 "agent_id": agent_id,
    #                 "session_id": session_id,
    #                 "message": final_prompt
    #             }
    #             response = requests.post(f"{agent_api_url}/v3/inference/chat/", headers=headers, json=payload)
                
    #             response_json = response.json()
    #             res = response_json.get("response", "")
    #             if res:
    #                 # Try to parse agent response robustly (handle unescaped control chars)
    #                 try:
    #                     output = json.loads(res)
    #                 except Exception:
    #                     try:
    #                         safe = res.replace('\n', '\\n').replace('\r', '\\r')
    #                         output = json.loads(safe)
    #                     except Exception:
    #                         # Fallback to wrapping raw string so .get() calls remain safe
    #                         output = {"output_message": res, "is_tool_call_req": False}

    #                 is_tool_call_req = output.get("is_tool_call_req", False)
    #                 if is_tool_call_req:
    #                     data_tool = self.tool_calling(output, credentials, agent_id, user_id, session_id, api_key)
    #                     out_msg = None
    #                     if isinstance(data_tool, dict):
    #                         out_msg = data_tool.get("output_message")
    #                     else:
    #                         out_msg = str(data_tool)
    #                     return buildResponse("Agent tool call processed successfully", {"prompt": final_prompt, "response": out_msg}, 200)
    #                 else:
    #                     out_msg = output.get("output_message") if isinstance(output, dict) else str(output)
    #                     return buildResponse("Agent tool call processed successfully", {"prompt": final_prompt, "response": out_msg}, 200)
    #     except Exception as e:
    #         print(f"Error processing agent tool call: {e}")
    #         return buildResponse(f"Failed to process agent tool call: {e}", None, 500)

    # def tool_calling(self,data,credentials,agent_id,user_id,session_id,api_key):
    #     is_call_req = data.get('is_tool_call_req',False)
    #     if not is_call_req:
    #         print("uuriiri")
    #         return data
    #     else:
    #         tool_name = data.get("function_name")
    #         parameters = data.get("parameter", {})
    #         parameters["credentials"] = credentials
    #         result = self.tool_manager.execute_function(tool_name, parameters)
    #         tool_out = result.get("body", {})
    #         headers = {"x-api-key": api_key, "Content-Type": "application/json"}
    #         agent_api_url = "https://agent-prod.studio.lyzr.ai"
    #         tool_retrive_prompt = f"Tool Name: {tool_name}\n\nResult: {tool_out}\n\nPlease continue the conversation with the user based on this result."
    #         payload = {
    #             "user_id": user_id,
    #             "agent_id": agent_id,
    #             "session_id": session_id,
    #             "message": tool_retrive_prompt
    #         }
    #         response = requests.post(f"{agent_api_url}/v3/inference/chat/", headers=headers, json=payload)
    #         response_json = response.json()
    #         print(f"Agent response after tool call: {response_json}")
    #         res = response_json.get("response", "")
    #         # Safely parse response; tolerate unescaped newlines/control chars
    #         parsed_output = None
    #         if res:
    #             try:
    #                 parsed_output = json.loads(res)
    #             except Exception:
    #                 try:
    #                     safe = res.replace('\n', '\\n').replace('\r', '\\r')
    #                     parsed_output = json.loads(safe)
    #                 except Exception:
    #                     parsed_output = {"output_message": res}
    #         else:
    #             parsed_output = {}

    #         return self.tool_calling(parsed_output,credentials,agent_id,user_id,session_id,api_key)

    @require_session
    def authenticate_tool(self):
        try:
            data = self.utils.validate_json_request(request)
            connector_type = data.get("connector_type")
            auth_service = ToolAuthService() 
            if connector_type == "ServiceNow":
                result = auth_service.authenticate_servicenow(data)
                if result and result.get("status")=="success":
                    return buildResponse("ServiceNow authentication successful", result, 200)
                else:
                    return buildResponse("ServiceNow authentication failed", None, 500)
            elif connector_type == "OneDrive":
                result = auth_service.authenticate_onedrive(data)
                if result and result.get("status")=="success":
                    return buildResponse("OneDrive authentication successful", result, 200)
                else:
                    return buildResponse("OneDrive authentication failed", None, 500)
        except Exception as e:
            print(f"Error authenticating tool: {e}")
            return buildResponse(f"Failed to authenticate tool: {e}", None, 500)

    @require_session
    def get_session_list(self):
        try:
            data = json.loads(json_util.dumps(self.chatbot_tracking_collection.find({}, {"_id": 0,"detailed_results":0})))
            res = {}
            for i in data:
                agent_id = i.get("agent_id","")
                agent_data = json.loads(json_util.dumps(self.agent_collection.find_one({"agent_id": agent_id}, {"_id": 0})))
                if agent_data and agent_data.get("agent_type_id") == "CONVERSATIONAL":
                    i["agent_name"] = agent_data.get("name","")
                    res[i.get("session_id")] = {
                        "agent_id": agent_id,
                        "agent_name": agent_data.get("name","") if agent_data else "",
                        "created_ts": i.get("created_ts",""),
                        "status": i.get("status",""),
                        "user_id": i.get("user_id","")
                    }
            result = []
            for i,j in res.items():
                user_query = self.chatbot_tracking_collection.find({"session_id": i}, {"_id": 0,"user_query":1})
                queries = []
                if user_query:
                    for k in user_query:

                        queries.append(k.get("user_query",""))
                initiative_query = find_initiating_query(queries)
                result.append({
                    "session_id": i,
                    "agent_id": j.get("agent_id",""),
                    "agent_name": j.get("agent_name",""),
                    "created_ts": j.get("created_ts",""),
                    "status": "completed",
                    "user_id": j.get("user_id",""),
                    "initiative_query": initiative_query
                })
                    
            # result = sorted(result, key=lambda x: x.get("created_ts",""), reverse=True)
            print(len(result))
            return buildResponse("Session list fetched successfully", result, 200)
        except Exception as e:
            print(f"Error fetching session list: {e}")
            return buildResponse(f"Failed to fetch session list: {e}", None, 500)

    def get_session_details(self, session_id):
        try:
            session_data = json.loads(json_util.dumps(self.chatbot_tracking_collection.find({"session_id": session_id}, {"_id": 0}).sort("created_ts", 1)))
            if not session_data:
                return buildResponse(f"Session with session_id {session_id} not found", [], 404)
            convo = []
            for session in session_data:
                convo.append({
                    "user_query": session.get("user_query", ""),
                    "agent_response": session.get("prompt_output", ""),
                    "created_ts": session.get("created_ts", "")
                })

            return buildResponse("Session details fetched successfully", convo, 200)

        except Exception as e:
            print(f"Error fetching session details for session_id {session_id}: {e}")
            return buildResponse(f"Failed to fetch session details for session_id {session_id}: {e}", None, 500)

    def get_recent_query(self, agent_id):
        try:
            recent_query_data = json.loads(json_util.dumps(self.chatbot_tracking_collection.find({"agent_id": agent_id}, {"_id": 0}).sort("created_ts", -1)))
            if not recent_query_data:
                return buildResponse(f"No recent query found for agent_id {agent_id}", [], 404)
            queries = []
            for i in recent_query_data[:25]:  # Get the last 25 queries
                queries.append(i.get("user_query", ""))
            print(f"Recent queries for agent_id {agent_id}: {queries}")
            suggestions = find_top_initiating_queries(queries, max_results=3)
            return buildResponse("Recent query fetched successfully", {"suggestions": suggestions}, 200)
        except Exception as e:
            print(f"Error fetching recent query for agent_id {agent_id}: {e}")
            return buildResponse(f"Failed to fetch recent query for agent_id {agent_id}: {e}", None, 500)

    def get_custom_action(self, tool_id):
        try:
            custom_action_data = json.loads(json_util.dumps(self.active_tool_collection.find({"_id": ObjectId(tool_id)}, {"_id": 0})))
            if not custom_action_data:
                return buildResponse(f"Custom action with tool_id {tool_id} not found", [], 404)
            return buildResponse("Custom action fetched successfully", custom_action_data, 200)
        except Exception as e:
            print(f"Error fetching custom action for tool_id {tool_id}: {e}")
            return buildResponse(f"Failed to fetch custom action for tool_id {tool_id}: {e}", None, 500)

# Notification Routes
    @require_session
    def get_notifications(self, email_id):
        result = self.user_notification_collection.find({"email": email_id}).sort("timestamp", -1)
        return buildResponse("Notifications fetched successfully", json.loads(json_util.dumps(result)), 200)
    
     # External Applications
    @require_session
    def register_external_application(self):
        try:
            data = self.utils.validate_json_request(request)
            external_app_manager = ExternalApp()
            result = external_app_manager.register_external_application(data)
            return buildResponse("External application registered successfully", result, 201)
        except ValidationError as ve:
            return buildResponse(str(ve), None, 400)
        except Exception as e:
            print(f"Error registering external application: {e}")
            return buildResponse(f"Failed to register external application: {e}", None, 500)

    @require_session
    def update_external_application(self, application_id):
        try:
            data = request.get_json() or {}
            result = self.external_app_manager.update_external_application(application_id, data)
            return buildResponse("External application updated successfully", result, 200)
        except ValidationError as ve:
            return buildResponse(str(ve), None, 400)
        except Exception as e:
            return buildResponse(f"Failed to update external application: {e}", None, 500)
    
    @require_session
    def get_external_applications(self):
        try:
            external_app_manager = ExternalApp()
            apps = external_app_manager.get_external_applications()
            return buildResponse("External applications fetched successfully", apps, 200)
        except Exception as e:
            print(f"Error fetching external applications: {e}")
            return buildResponse(f"Failed to fetch external applications: {e}", None, 500)


    @require_session
    def get_external_application_by_id(self, application_id):
        try:
            external_app_manager = ExternalApp()
            app = external_app_manager.get_external_application_by_id(application_id)
            return buildResponse("External application fetched successfully", app, 200)
        except Exception as e:
            print(f"Error fetching external application: {e}")
            return buildResponse(f"Failed to fetch external application: {e}", None, 500)

    @require_session
    def delete_external_application(self, application_id):
        try:
            external_app_manager = ExternalApp()
            result = external_app_manager.delete_external_application(application_id)
            return buildResponse("External application deleted successfully", result, 200)
        except Exception as e:
            print(f"Error deleting external application: {e}")
            return buildResponse(f"Failed to delete external application: {e}", None, 500)
       
    #Ext App using API only 
    @require_token_or_api_key("agents")
    def get_agents_for_subscription_user(self):
        """
        Fetch agents based on API key, prj_id, and Email for subscription-based users.
        
        Headers (API Key is mandatory):
            X-API-Key: sk-movaio-xxxxx (mandatory)
            
        Query Parameters (GET):
            prj_id: Project ID (required)
            Email: User's email address (required)
            
        JSON Body (POST):
            prj_id: Project ID (required)
            Email: User's email address (required)
        """
        try:
            # 1. Get API key context from the decorator
            ctx = g.api_key_context
            
            if not ctx:
                return buildResponse("API Key validation failed", None, 401)
            
            # 2. Get subscription details from the validated context
            matched_sub = ctx.get("subscription")
            if not matched_sub:
                return buildResponse("API key is not associated with any subscription", None, 403)
            
            subscription_project_id = matched_sub.get("project_id")
            database_name = matched_sub.get("database_name")
            
            if not subscription_project_id:
                return buildResponse("Subscription does not have a project mapped", None, 403)
            
            if not database_name:
                return buildResponse("Subscription does not have a database configured", None, 403)
            
            # 3. Get prj_id and Email from query params (GET) or body (POST)
            requested_prj_id = None
            requested_email = None
            
            # Try query parameters first (for GET requests)
            requested_prj_id = request.args.get('prj_id')
            requested_email = request.args.get('Email')
            
            # If not in query params, try body (for POST requests)
            if not requested_prj_id or not requested_email:
                if request.method == 'POST' and request.is_json:
                    data = request.get_json()
                    if data:
                        if not requested_prj_id:
                            requested_prj_id = data.get('prj_id')
                        if not requested_email:
                            requested_email = data.get('Email')
            
            # Validate that we have both required fields
            if not requested_prj_id:
                return buildResponse(
                    "Missing required field: prj_id (provide in query params for GET or body for POST)", 
                    None, 400
                )
            if not requested_email:
                return buildResponse(
                    "Missing required field: Email (provide in query params for GET or body for POST)", 
                    None, 400
                )
            
            # Convert to appropriate types
            try:
                prj_id_int = int(requested_prj_id)
            except ValueError:
                return buildResponse("prj_id must be a valid integer", None, 400)
            
            email_lower = requested_email.strip().lower()
            
            # 4. Validate that the requested project matches the subscription's project
            if prj_id_int != subscription_project_id:
                return buildResponse(
                    f"Access Denied: This API key is mapped to project ID '{subscription_project_id}', "
                    f"but you requested project ID '{prj_id_int}'",
                    None, 403
                )
            
            # 5. Find the user in the master database
            user_data = self.user_collection.find_one(
                {
                    "Email": re.compile(f"^{re.escape(email_lower)}$", re.IGNORECASE),
                    "IsActive": True,
                    "IsDelete": False
                },
                {"_id": 0, "PrjDetails": 1, "Email": 1, "FirstName": 1, "LastName": 1}
            )
            
            if not user_data:
                return buildResponse(f"User with email '{requested_email}' not found or inactive", None, 404)
            
            # 6. Find the specific project entry in user's PrjDetails
            project_entry = None
            for prj in user_data.get("PrjDetails", []):
                if prj.get("prj_id") == prj_id_int:
                    project_entry = prj
                    break
            
            if not project_entry:
                return buildResponse(
                    f"User '{requested_email}' is not mapped to project ID '{prj_id_int}'",
                    None, 404
                )
            
            # 7. Get the team_name from the project entry
            team_name = project_entry.get("team_name")
            if not team_name:
                return buildResponse(f"Team name not found for project ID '{prj_id_int}'", None, 404)
            
            # 8. Get the user_type (database name) from the project collection
            project_doc = self.project.find_one(
                {"projectId": prj_id_int},
                {"database_name": 1, "_id": 0}
            )
            
            if not project_doc:
                return buildResponse(f"Project with ID '{prj_id_int}' not found", None, 404)
            
            user_type = project_doc.get("database_name")
            if not user_type:
                return buildResponse(f"Database name not configured for project '{prj_id_int}'", None, 404)
            
            # Verify that the project's database name matches the subscription's database name
            if user_type != database_name:
                return buildResponse(
                    f"Database mismatch: Project has '{user_type}' but API key is mapped to '{database_name}'",
                    None, 403
                )
            
            # 9. Find the agency assigned to the team (assigned_to: team_name)
            find_agency_op = {
                'type': 'find',
                'filter': {
                    "assigned_to": team_name,
                    "is_deleted": {"$ne": True}
                },
                'projection': {"agency_id": 1, "agency_name": 1, "_id": 0}
            }
            agency_docs = self._query_db_for_api_fetch('agency', find_agency_op, user_type)
            
            if not agency_docs:
                return buildResponse(f"No active agencies found for team '{team_name}'", None, 404)
            
            # Collect all agency IDs
            agency_ids = [doc.get("agency_id") for doc in agency_docs if doc.get("agency_id")]
            
            if not agency_ids:
                return buildResponse("No valid agency IDs found", None, 404)
            
            # 10. Get all agent IDs from the agent_agency_mapping collection for these agency_ids
            find_mapping_op = {
                'type': 'find',
                'filter': {
                    "agency_id": {"$in": agency_ids},
                    "status": "active"
                },
                'projection': {"agent_id": 1, "agency_id": 1, "_id": 0}
            }
            mapping_docs = self._query_db_for_api_fetch('agent_agency_mapping', find_mapping_op, user_type)
            
            if not mapping_docs:
                return buildResponse(f"No active agent mappings found for agencies: {agency_ids}", None, 404)
            
            # Extract unique agent IDs
            agent_ids = list(set([doc.get("agent_id") for doc in mapping_docs if doc.get("agent_id")]))
            
            if not agent_ids:
                return buildResponse("No valid agent IDs found in mappings", None, 404)
            
            # 11. Fetch agents based on the agent_ids from the agent collection
            agents_found = []
            
            for agent_id in agent_ids:
                find_agent_op = {
                    'type': 'find_one',
                    'filter': {
                        "$or": [
                            {"api_agent_id": agent_id, "isDeleted": {"$ne": True}},
                            {"agent_id": agent_id, "isDeleted": {"$ne": True}}
                        ]
                    },
                    'projection': {"_id": 0}
                }
                agent_doc = self._query_db_for_api_fetch('agent', find_agent_op, user_type)
                
                if agent_doc:
                    agents_found.append(agent_doc)
            
            # 12. Return the list of agents
            if agents_found:
                return buildResponse("Agents fetched successfully", {
                    "total_agents": len(agents_found),
                    "agents": agents_found,
                    "project_id": prj_id_int,
                    "team_name": team_name,
                    "agency_ids": agency_ids,
                    "database_name": database_name
                }, 200)
            else:
                return buildResponse("No agents found for the given criteria", {
                    "total_agents": 0,
                    "agents": [],
                    "project_id": prj_id_int,
                    "team_name": team_name,
                    "database_name": database_name
                }, 200)
                
        except Exception as e:
            import traceback
            traceback.print_exc()
            return buildResponse(f"Error fetching agents: {str(e)}", None, 500)

    def _query_db_for_api_fetch(self, collection_name, operation, user_type):
        """
        Helper method to query a specific database by user_type for API key based requests.
        """
        try:
            from database_manager import select_database_by_user_type
            return config_loader.query_db(
                collection_name,
                operation,
                condition_func=select_database_by_user_type,
                user_type=user_type
            )
        except Exception as e:
            print(f"Error in _query_db_for_api_fetch: {e}")
            return config_loader.query_db(
                collection_name,
                operation,
                condition_func=select_database_by_user_type,
                user_type='master'
            )

    def execute_servicenow_action(self):

        try:

            # Validate API Key
            api_key = request.headers.get("x-api-key")

            if api_key != config_loader.SNOW_API_CALL_KEY:
                return jsonify({
                    "success": False,
                    "message": "Invalid API Key"
                }), 401

            data = request.get_json()

            snow_action = data.get("snow_action")
            user_input = data.get("user_input")
            user_id = data.get("user_id")
            snow_folder_path = data.get("snow_folder_path")

            if not snow_action:
                return jsonify({
                    "success": False,
                    "message": "snow_action is required"
                }), 400

            print(
                f"ServiceNow action detected: {snow_action}"
            )

            backend_dir = os.path.abspath(snow_folder_path)
            folder_path = os.path.join(backend_dir,"ServiceNowstate")
            os.makedirs(folder_path,exist_ok=True)

            file_path = os.path.join(folder_path,"SNow_tool_output.json")

            now = datetime.now()
            request_id = (f"REQ-{now.strftime('%Y-%m-%d')}-001")
            client_ref = (f"{snow_action}-{now.strftime('%Y%m%d%H%M%S')}")

            payload_data = {
                "request_id": request_id,
                "tickets": [
                    {
                        "client_ref": client_ref,
                        "action": snow_action,
                        "ticket_type": "incident",
                        "fields": {
                            "short_description": user_input,
                            "description": (
                                f"User is experiencing a {user_input}"
                            ),
                            "urgency": "3",
                            "impact": "3",
                            "caller_id": user_id
                        }
                    }
                ]
            }

            with open(
                file_path,
                "w",
                encoding="utf-8"
            ) as f:
                json.dump(
                    payload_data,
                    f,
                    indent=4,
                    ensure_ascii=False
                )

            print(
                f"Created ServiceNow file: {file_path}"
            )

            state_dir = (
                Path(snow_folder_path)
                / "ServiceNowstate"
            )

            folders = [
                state_dir / "_processing",
                state_dir / "_processed",
                state_dir / "_failed"
            ]

            result_data = None

            for _ in range(30):

                result_files = []

                for folder in folders:

                    if folder.exists():
                        result_files.extend(
                            folder.glob("*.result.json")
                        )

                if result_files:

                    latest_file = max(
                        result_files,
                        key=lambda f: f.stat().st_mtime
                    )

                    with open(
                        latest_file,
                        "r",
                        encoding="utf-8"
                    ) as f:
                        result_data = json.load(f)

                    break

                time.sleep(1)

            if result_data:

                return jsonify({
                    "success": True,
                    "request_id": request_id,
                    "client_ref": client_ref,
                    "message": (
                        "ServiceNow Tool executed successfully."
                    ),
                    "result": result_data
                })

            return jsonify({
                "success": False,
                "request_id": request_id,
                "client_ref": client_ref,
                "message":
                    "No result file found within 30 seconds."
            })

        except Exception as ex:

            return jsonify({
                "success": False,
                "message": str(ex)
            }), 500

    def execute_servicenow_action_test(self):
        try:
            # Validate API Key
            api_key = request.headers.get("x-api-key")

            if api_key != config_loader.SNOW_API_CALL_KEY:
                return jsonify({
                    "success": False,
                    "message": "Invalid API Key"
                }), 401

            # Get JSON payload
            data = request.get_json(silent=True) or {}

            snow_action = data.get("snow_action", "")
            user_input = data.get("user_input", "")
            user_id = data.get("user_id", "")
            snow_folder_path = data.get("snow_folder_path", "")

            # Generate request identifiers
            now = datetime.now()

            request_id = f"REQ-{now.strftime('%Y-%m-%d')}-001"
            client_ref = f"{snow_action}-{now.strftime('%Y%m%d%H%M%S')}"

            return jsonify({
                "success": True,
                "request_id": request_id,
                "client_ref": client_ref,
                "snow_action": snow_action,
                "user_id": user_id,
                "message": "No result file found within 30 seconds."
            }), 200

        except Exception as ex:
            import traceback
            traceback.print_exc()

            return jsonify({
                "success": False,
                "message": str(ex)
            }), 500

    # Swagger UI
    def serve_openapi_json(self):
        """Serves the raw OpenAPI JSON."""
        try:
            with open('openapi.json', 'r') as f:
                return jsonify(json.load(f))
        except FileNotFoundError:
            return jsonify({"error": "openapi.json file not found"}), 500
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    def serve_swagger_ui(self):
        """Serves the Swagger UI interface."""
        return """
        <!DOCTYPE html>
        <html>
        <head>
            <title>Mova iO Platform API - Swagger UI</title>
            <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@3/swagger-ui.css" />
            <style>
                /* Hide the v1 tag from the tag list */
                .swagger-ui .information-container .info .title small.version-stamp {
                    display: none;
                }
                /* Optional: Hide v1 from the operations block */
                .swagger-ui .opblock-tag[data-tag="v1"] {
                    display: none !important;
                }
            </style>
        </head>
        <body>
            <div id="swagger-ui"></div>
            <script src="https://unpkg.com/swagger-ui-dist@3/swagger-ui-bundle.js"></script>
            <script>
                const ui = SwaggerUIBundle({
                    url: './openapi.json',
                    dom_id: '#swagger-ui',
                    presets: [
                        SwaggerUIBundle.presets.apis
                    ],
                    layout: "BaseLayout",
                    // Filter out the "v1" tag completely
                    tagsSorter: function(a, b) {
                        // Filter out 'v1' tag
                        if (a === 'v1') return 1;
                        if (b === 'v1') return -1;
                        return a.localeCompare(b);
                    },
                    operationsSorter: 'method'
                });
            </script>
        </body>
        </html>
        """    

# Create and run the app
if __name__ == '__main__':
    
    port = config_loader.FLASK_PORT
    if isinstance(port, tuple):
        port = port[0]  # extract first item
    
    threading.Thread(target=poller.main,daemon=True).start()
    
    flask_app = FlaskApp()        
    flask_app.socketio.run(app=flask_app.app,host='0.0.0.0',port=int(port),debug=True,log_output=True, use_reloader=False,allow_unsafe_werkzeug=True)
