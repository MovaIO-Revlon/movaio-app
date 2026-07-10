import os
import pathlib
import requests
from flask import Blueprint, request, jsonify

# Required imports from your architecture
from session_manager import get_current_user
from utils import ValidationError
from commonutils import DatabaseCollections, CommonUtils
from config_loader import config_loader
from database_manager import select_database_by_user_type

# HERE = pathlib.Path(__file__).resolve().parent

# http_client = requests.Session()

# voice_bp = Blueprint("voice", __name__, static_folder="static")

def _query_db(collection_name, operation, user_type=None):
    """Helper method to query database with user type for functional routes"""
    if user_type is None:
        current_user = get_current_user()
        prj_name = current_user.get('ActiveProject', 'master') if current_user else 'master'
        
        # Instantiate DatabaseCollections to access the project collection
        db_collections = DatabaseCollections()
        project_doc = db_collections.project.find_one({'projectName': prj_name})
        
        if not project_doc:
            user_type = 'master'  # fallback
        else:
            user_type = project_doc['database_name']

    # Execute query using config_loader
    return config_loader.query_db(
        collection_name,
        operation,
        condition_func=select_database_by_user_type,
        user_type=user_type
    )

def _forward(path: str, payload: dict, api_key: str, base_url: str):
    # url = f"{base_url}{path}"
    url = path
    print("re",url)
    print("key",api_key)
    print("payload",payload)
    header = {"Content-Type": "application/json", "x-api-key": api_key}
    try:
        r = requests.post(
            url, json=payload, headers=header, timeout=(10.0, 30.0)
        )
    except requests.RequestException as exc:
        return jsonify({"error": f"upstream request failed: {exc}"}), 502

    if not r.content:
        status = 200 if r.ok else r.status_code
        return jsonify({"ok": r.ok}), status

    try:
        body = r.json()
    except ValueError:
        body = (
            {"ok": True}
            if r.ok
            else {"error": "non-JSON response from Lyzr", "raw": r.text[:500]}
        )
    print("res",body)

    return jsonify(body), r.status_code

# @voice_bp.route("/sessions/start", methods=["POST"])
def start_session():
    body = request.get_json(silent=True) or {}
    agent_id = body.get("agentId", '')
    
    if not agent_id:
        raise ValidationError("agent_id is required")
        
    user_identity = str(body.get("userIdentity") or "web-user").strip()
    
    find_op = {
        'type': 'find_one',
        'filter': {
            "agent_id": agent_id,
            "$or": [
                    {"isDeleted": {"$exists": False}},
                    {"isDeleted": False}
                ]                  
        }
    }
    
    # Removed 'self.' since this is a functional scope
    agent_details = _query_db('agent', find_op)
    
    if not agent_details:
        raise ValidationError("Agent not found")

    base_url = agent_details.get("agent_api_url", '')
    path_url = agent_details.get("session_start_url", '')
    api_key = agent_details.get("agent_api_key", '')

    payload = {"agentId": agent_id, "userIdentity": user_identity}
    if body.get("roomName"):
        payload["roomName"] = body["roomName"]

    return _forward(path_url, payload, api_key, base_url)

# @voice_bp.route("/sessions/end", methods=["POST"])
def end_session():
    body = request.get_json(silent=True) or {}
    room_name = str(body.get("roomName") or "").strip()
    agent_id = body.get("agentId", '')

    if not room_name:
        raise ValidationError("roomName is required")
    if not agent_id:
        raise ValidationError("agent_id is required")
    
    find_op = {
        'type': 'find_one',
        'filter': {
            "agent_id": agent_id,
            "$or": [
                    {"isDeleted": {"$exists": False}},
                    {"isDeleted": False}
                ]                   
        }
    }
    
    # Removed 'self.' since this is a functional scope
    agent_details = _query_db('agent', find_op)
    
    if not agent_details:
        raise ValidationError("Agent not found")

    base_url = agent_details.get("agent_api_url", '')
    path_url = agent_details.get("session_end_url", '')
    api_key = agent_details.get("agent_api_key", '')
    
    payload = {"roomName": room_name}

    return _forward(path_url, payload, api_key, base_url)