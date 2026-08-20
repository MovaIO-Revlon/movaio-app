from datetime import datetime, timezone
from config_loader import ConfigLoader
import logging
import secrets


class DatabaseCollections:
    """Centralized database collections access"""
    def __init__(self):
        self.configloader = ConfigLoader()
        self.user_collection = self.configloader.MONGO_COLLECTIONS["user"]
        self.role_collection = self.configloader.MONGO_COLLECTIONS["role"]
        self.page_configuration_collection = self.configloader.MONGO_COLLECTIONS["page_configuration_collection"]
        self.team_collection = self.configloader.MONGO_COLLECTIONS["team"]
        self.agent_collection = self.configloader.MONGO_COLLECTIONS["agent"]
        self.agency_collection = self.configloader.MONGO_COLLECTIONS["agency"]
        self.agent_agency_mapping_collection = self.configloader.MONGO_COLLECTIONS["agent_agency_mapping"]
        self.event_agency_tracking_collection = self.configloader.MONGO_COLLECTIONS["event_agency_tracking"]
        self.chatbot_tracking_collection = self.configloader.MONGO_COLLECTIONS["chatbot_tracking"]
        self.agency_type_collection = self.configloader.MONGO_COLLECTIONS["agency_type"]
        self.agent_tracking_collection = self.configloader.MONGO_COLLECTIONS["agent_tracking"]
        self.mcp_master_collection = self.configloader.MONGO_COLLECTIONS["mcp_master"]
        self.mcp_files_collection = self.configloader.MONGO_COLLECTIONS["mcp_files"]
        self.mcp_usecase_collection = self.configloader.MONGO_COLLECTIONS["mcp_usecase"]
        self.role_permissions_collection = self.configloader.MONGO_COLLECTIONS["role_permissions"]
        self.plugins_collection = self.configloader.MONGO_COLLECTIONS["plugins_collection"]
        self.agent_provider_collection = self.configloader.MONGO_COLLECTIONS["agent_provider"]
        self.agent_role_master_collection = self.configloader.MONGO_COLLECTIONS["agent_role_master"]
        self.llm_master_collection = self.configloader.MONGO_COLLECTIONS["llm_master"]
        self.agent_type_master_collection = self.configloader.MONGO_COLLECTIONS["agent_type_master"]
        self.knowledgebase_collection = self.configloader.MONGO_COLLECTIONS["knowledgebase_collection"]
        self.automation_library_collection = self.configloader.MONGO_COLLECTIONS["automation_library_collection"]
        self.automation_script_types_collection = self.configloader.MONGO_COLLECTIONS["automation_script_types_collection"]
        self.agent_version_history_collection = self.configloader.MONGO_COLLECTIONS["agent_version_history_collection"]
        self.ai_foundation_collection = self.configloader.MONGO_COLLECTIONS["ai_foundation_collection"]
        self.event_steps_tracking_collection = self.configloader.MONGO_COLLECTIONS["event_steps_tracking"]
        self.project_team_mapping_collection = self.configloader.MONGO_COLLECTIONS["project_team_mapping_collection"]
        self.project = self.configloader.MONGO_COLLECTIONS["project"]
        self.team_role_mapping_collection = self.configloader.MONGO_COLLECTIONS["team_role_mapping_collection"]
        self.kb_collection = self.configloader.MONGO_COLLECTIONS["kb_collection"]
        self.appconfig = self.configloader.MONGO_COLLECTIONS["appconfig"]
        self.workflow_collection = self.configloader.MONGO_COLLECTIONS["workflow_collection"]
        self.workflow_tracking_collection = self.configloader.MONGO_COLLECTIONS["workflow_tracking_collection"]
        self.workflow_response_collection = self.configloader.MONGO_COLLECTIONS["workflow_response_collection"]
        self.workflow_agency_mapping_collection = self.configloader.MONGO_COLLECTIONS["workflow_agency_mapping_collection"]
        self.workflow_agent_tracking = self.configloader.MONGO_COLLECTIONS["workflow_agent_tracking"]
        self.agent_eval_collection = self.configloader.MONGO_COLLECTIONS["agent_eval_collection"]
        self.otp_collection = self.configloader.MONGO_COLLECTIONS["otp_collection"]
        self.rate_limiting_collection = self.configloader.MONGO_COLLECTIONS["rate_limiting_collection"]
        self.prompt_repo = self.configloader.MONGO_COLLECTIONS["prompt_repo"]
        self.tool_management_collection = self.configloader.MONGO_COLLECTIONS["tool_management_collection"]
        self.connections_collection = self.configloader.MONGO_COLLECTIONS["connections_collection"]
        self.active_tool_collection =  self.configloader.MONGO_COLLECTIONS["active_tool_collection"]
        self.user_notification_collection = self.configloader.MONGO_COLLECTIONS["user_notification_collection"]
        self.agent_approval_request_collection = self.configloader.MONGO_COLLECTIONS["agent_approval_request_collection"]
        self.external_applications_collection = self.configloader.MONGO_COLLECTIONS["external_applications_collection"]
    

class CommonUtils:
    """Common utilities for both AgencyManager and AgentManager"""
    
    @staticmethod
    def get_current_timestamp():
        """Get current UTC timestamp"""
        return datetime.now(timezone.utc)
    
    @staticmethod
    def generate_random_rating():
        """Generate random rating between 3.0 and 5.0"""
        possible_ratings = [round(3.0 + 0.1 * i, 1) for i in range(21)]
        return secrets.choice(possible_ratings)
    
    @staticmethod
    def convert_object_ids_to_string(doc, fields):
        """Convert specified fields to string in document"""
        for field in fields:
            if field in doc:
                doc[field] = str(doc.get(field, ""))
    
    @staticmethod
    def get_name_from_collection(collection, id_field, id_value, name_field, status_filter=None):
        """Generic method to get name from any collection"""
        try:
            query = {id_field: id_value}
            if status_filter:
                query["status"] = status_filter
            
            doc = collection.find_one(query, {"_id": 0, name_field: 1})
            return doc[name_field] if doc else ""
        except Exception:
            return ""
    
    @staticmethod
    def build_update_doc(data, allowed_fields):
        """Build update document from data with allowed fields"""
        update_doc = {}
        for field in allowed_fields:
            if field in data:
                if field == 'avatar' and not data[field]:
                    continue
                update_doc[field] = data[field]
        return update_doc
    
    @staticmethod
    def log_error(message, exc_info=True):
        """Standardized error logging"""
        logging.error(message, exc_info=exc_info)
    
    @staticmethod
    def clean_document(doc):
        """Clean document by converting _id to string"""
        if not doc:
            return {}
        doc = dict(doc)
        if "_id" in doc:
            doc["_id"] = str(doc["_id"])
        return doc
    
    @staticmethod
    def build_dropdown_options(collection, value_field, label_field, status_filter=None):
        """Build dropdown options from collection"""
        query = {"_id": 0, value_field: 1, label_field: 1}
        filter_condition = {}

        # Apply status filter only if explicitly provided
        if status_filter:
            filter_condition["status"] = status_filter

        cursor = collection.find(filter_condition, query)
        return [
            {"label": item.get(label_field, "Unknown"), "value": item.get(value_field)}
            for item in cursor
            if item.get(value_field)  # skip if value is None
        ]
    
    @staticmethod
    def get_counts(collection, base_filter):
        """Get total, active, and trending counts"""
        total = collection.count_documents(base_filter)
        active = collection.count_documents({**base_filter, "status": "active"})
        trending = collection.count_documents({**base_filter, "trending": True})
        return {"total": total, "active": active, "trending": trending}
    
    @staticmethod
    def update_document(collection, filter_query, update_data):
        """Generic document update with timestamp"""
        update_data["updated_ts"] = CommonUtils.get_current_timestamp()
        return collection.update_one(filter_query, {"$set": update_data})
    
    @staticmethod
    def get_run_count(agent_tracking_collection, chatbot_tracking_collection, agent_id):
        """Get total run count for an agent"""
        return (agent_tracking_collection.count_documents({"agent_id": agent_id}) + 
                chatbot_tracking_collection.count_documents({"agent_id": agent_id}))
    
    @staticmethod
    def add_names_to_documents(documents, name_mappings):
        """Add name fields to documents based on mappings"""
        for doc in documents:
            for id_field, (collection, name_field, status_filter) in name_mappings.items():
                if doc.get(id_field):
                    doc[f"{name_field}"] = CommonUtils.get_name_from_collection(
                        collection, id_field, doc[id_field], name_field, status_filter
                    )
    
    @staticmethod
    def generate_uuid():
        """Generate UUID string"""
        import uuid
        return str(uuid.uuid4())
    
    @staticmethod
    def create_response(success, message, data=None, status_code=200):
        """Create standardized response"""
        response = {"Success": success, "Message": message}
        if data is not None:
            response.update(data)
        return response, status_code
    
    @staticmethod
    def validate_json_request(request_obj):
        """Validate and get JSON from request"""
        try:
            return request_obj.get_json() or {}
        except Exception:
            return {}
    
    @staticmethod
    def _is_sensitive_key(key):
        """Detect sensitive field names by keyword patterns."""
        if not isinstance(key, str):
            return False

        lowered = key.strip().lower()
        exact_sensitive = {
            "email",
            "userid",
            "user_id",
            "username",
            "firstname",
            "first_name",
            "lastname",
            "last_name",
            "password",
            "passwd",
            "pass",
            "secret",
            "secrets",
            "token",
            "api_key",
            "apikey",
            "api-token",
            "credential",
            "credentials",
            "auth",
            "ssn",
            "dob",
            "card_number",
            "cvv",
            "pin",
        }

        if lowered in exact_sensitive:
            return True

        sensitive_substrings = [
            "password",
            "secret",
            "token",
            "api_key",
            "apikey",
            "credential",
            "auth",
            "ssn",
            "dob",
            "card",
            "pin",
            "email",
        ]

        return any(substring in lowered for substring in sensitive_substrings)

    @staticmethod
    def _get_cipher():
        """Create a Fernet cipher using the configured encryption key."""
        return Fernet(config_loader.encryption_key)

    @staticmethod
    def _encrypt_value(value):
        """Encrypt a scalar or serializable value."""
        if value is None:
            return None

        if isinstance(value, (dict, list)):
            value = json.dumps(value)

        if not isinstance(value, str):
            value = str(value)

        return CommonUtils._get_cipher().encrypt(value.encode("utf-8")).decode("utf-8")

    @staticmethod
    def _decrypt_value(value):
        """Decrypt a value encrypted with Fernet."""
        if not isinstance(value, str):
            return value

        try:
            decrypted = CommonUtils._get_cipher().decrypt(value.encode("utf-8"))
            decoded = decrypted.decode("utf-8")
            try:
                return json.loads(decoded)
            except json.JSONDecodeError:
                return decoded
        except Exception:
            return value

    @staticmethod
    def _process_sensitive_data(data, action):
        """Recursive helper to encrypt or decrypt sensitive JSON fields."""
        if isinstance(data, dict):
            processed = {}
            for key, value in data.items():
                if CommonUtils._is_sensitive_key(key):
                    if action == "encrypt":
                        processed[key] = CommonUtils._encrypt_value(value)
                    elif action == "decrypt":
                        processed[key] = CommonUtils._decrypt_value(value)
                    else:
                        raise ValueError("Action must be 'encrypt' or 'decrypt'.")
                else:
                    processed[key] = CommonUtils._process_sensitive_data(value, action)
            return processed

        if isinstance(data, list):
            return [CommonUtils._process_sensitive_data(item, action) for item in data]

        return data

    @staticmethod
    def process_sensitive_fields(data, action):
        """Encrypt or decrypt sensitive fields inside JSON-like data."""
        if action not in {"encrypt", "decrypt"}:
            raise ValueError("Action must be 'encrypt' or 'decrypt'.")
        return CommonUtils._process_sensitive_data(data, action)

    @staticmethod
    # Helper: Serialize MongoDB documents
    def serialize_doc(doc):
        doc["_id"] = str(doc["_id"])
        for k, v in doc.items():
            if isinstance(v, datetime):
                doc[k] = v.isoformat()
        return doc