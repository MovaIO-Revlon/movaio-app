import urllib.parse
import os2
from pymongo import MongoClient
from bson import ObjectId
from enum import Enum

class DatabaseType(Enum):
    MASTER = "dev_qa"

class DatabaseManager:
    _instance = None
    _clients = {}
    
    def __new__(cls, config=None):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self, config=None):
        if hasattr(self, '_initialized'):
            return
        if config is None:
            config = self._load_default_config()
        self.config = config
        self._databases = {}
        self._collections = {}
        self._setup_databases()
        self._initialized = True
        
    def _load_default_config(self):
        # You can adapt this to your existing config loader
        from config_loader import ConfigLoader  # or the actual module you're using
        return ConfigLoader().config
    
    def _setup_databases(self):
        # Setup MASTER database only - reuse existing connection if available
        if DatabaseType.MASTER not in self._clients:
        # 1. Get credentials (ideally from environment variables or secure config)
            username = self.config["MONGODB_USER"]
            password = self.config["MONGODB_PASSWORD"]
            host = self.config["MONGODB_HOST"]
            port = self.config["MONGODB_PORT"]
            auth_db = self.config["MONGODB_AUTH_DB"] # Database where the user is created
            
            # 2. URL-encode credentials to handle special characters safely
            #safe_username = urllib.parse.quote_plus(username)
            #safe_password = urllib.parse.quote_plus(password)

            print(f"UserName:{username}")
            print(f"Password:{password}")
            print("MONGODB_USER =", repr(self.config["MONGODB_USER"]))
            print("MONGODB_PASSWORD =", repr(self.config["MONGODB_PASSWORD"]))
            print("ENV USER:", os.getenv("MONGO_USERNAME"))
            print("ENV PASS EXISTS:", os.getenv("MONGO_PASSWORD") is not None)

            # 3. Construct the connection string
            default_uri = f"mongodb://{username}:{password}@{host}:{port}/?authSource={auth_db}"
            
            # 4. Connect (uses config value if provided, otherwise falls back to default_uri)
            print(f"Connecting to MongoDB with URI: {default_uri}")  # Debugging line
            self._clients[DatabaseType.MASTER] = MongoClient(default_uri)
        master_client = self._clients[DatabaseType.MASTER]
        self._databases[DatabaseType.MASTER] = master_client[self.config["MONGODB_COLLECTION_NAME_MASTER"]]
        
        # Setup collections for master database
        self._collections[DatabaseType.MASTER] = self._create_collections(self._databases[DatabaseType.MASTER])

    
    def _create_collections(self, database):
        return {
            "user": database[self.config["MONGODB_USER_COLLECTION"]],
            "role": database[self.config["MONGODB_ROLE_COLLECTION"]],
            "page_configuration_collection": database[self.config["MONGODB_PAGE_CONFIGURATION_COLLECTION"]],
            "role_permissions": database[self.config["MONGODB_ROLE_PERMISSION_COLLECTION"]],
            "agent_tracking": database[self.config["MONGODB_AGENT_TRACKING_COLLECTION"]],
            "event_agency_tracking": database[self.config["MONGODB_EVENT_AGENCY_TRACKING_COLLECTION"]],
            "team": database[self.config["MONGODB_TEAM_COLLECTION"]],
            "agent": database[self.config["MONGODB_AGENT_COLLECTION"]],
            "agent_agency_mapping": database[self.config["MONGODB_AGENT_AGENCY_TRACKING_COLLECTION"]],
            "agent_provider": database[self.config["MONGODB_AGENT_PROVIDER_COLLECTION"]],
            "agent_role_master": database[self.config["MONGODB_ROLE_MASTER_COLLECTION"]],
            "llm_master": database[self.config["LLM_MASTER_COLLECTION"]],
            "mcp_master": database[self.config["MCP_MASTER_COLLECTION"]],
            "mcp_files": database[self.config["MCP_FILES_COLLECTION"]],
            "mcp_usecase": database[self.config["MCP_USECASE_COLLECTION"]],
            "plugins_collection": database[self.config["MONGODB_PLUGINS_COLLECTION"]],
            "agent_type_master": database[self.config["AGENT_TYPE_MASTER_COLLECTION"]],
            "agency": database[self.config["MONGODB_AGENCY_COLLECTION"]],
            "agency_type": database[self.config["MONGODB_AGENCY_TYPE_COLLECTION"]],
            "event_steps_tracking": database[self.config["MONGODB_EVENT_STEPS_TRACKING_COLLECTION"]],
            "chatbot_tracking": database[self.config["CHATBOT_TRACKING_COLLECTION"]],
            "knowledgebase_collection":  database[self.config["MONGODB_KNOWLEDGEBASE_COLLECTION"]],
            "automation_library_collection": database[self.config["AUTOMATION_LIBRARY_COLLECTION"]],
            "automation_script_types_collection": database[self.config["AUTOMATION_SCRIPT_TYPES_COLLECTION"]],
            "agent_version_history_collection": database[self.config["AGENT_VERSION_HISTORY_COLLECTION"]],
            "ai_foundation_collection":   database[self.config["MONGODB_AI_FOUNDATION_COLLECTION"]],
            "team_role_mapping_collection": database[self.config["MONGODB_TEAMROLE_MAPPING_COLLECTION"]],
            "project_team_mapping_collection": database[self.config["MONGODB_PROJECTTEAM_MAPPING_COLLECTION"]],
            "project": database[self.config["MONGODB_PROJECT_COLLECTION"]],
            "kb_collection": database[self.config["MONGODB_KB_COLLECTION"]],
            "appconfig": database[self.config["MONGODB_APPCONFIG_COLLECTION"]],
            "workflow_collection": database[self.config["MONGODB_WORKFLOW_COLLECTION"]],
            "workflow_tracking_collection": database[self.config["MONGODB_WORKFLOW_TRACKING_COLLECTION"]],
            "workflow_response_collection": database[self.config["MONGODB_WORKFLOW_RESPONSE_COLLECTION"]],
            "workflow_agency_mapping_collection": database[self.config["MONGODB_WORKFLOW_AGENCY_MAPPING_COLLECTION"]],
            "workflow_agent_tracking": database[self.config["MONGODB_WORKFLOW_AGENT_TRACKING_COLLECTION"]],
            "agent_eval_collection": database[self.config["MONGODB_AGENT_EVAL_COLLECTION"]],
            "otp_collection": database[self.config["MONGODB_OTP_COLLECTION"]],
            "mcp_files_collection": database[self.config["MCP_FILES_COLLECTION"]],
            "rate_limiting_collection": database[self.config["Rate_Limiting_COLLECTION"]],
            "prompt_repo": database[self.config["MONGODB_PROMPT_REPO_COLLECTION"]] 

        }
    
    def _get_or_create_dynamic_database(self, db_name):
        """Create dynamic database with its own connection if it doesn't exist"""
        if db_name not in self._databases:
            if db_name not in self._clients:
                # 1. Get credentials (ideally from environment variables or secure config)
                username = self.config["MONGODB_USER"]
                password = self.config["MONGODB_PASSWORD"]
                host = self.config["MONGODB_HOST"]
                port = self.config["MONGODB_PORT"]
                auth_db = self.config["MONGODB_AUTH_DB"] # Database where the user is created
                
                # 2. URL-encode credentials to handle special characters safely
                #safe_username = urllib.parse.quote_plus(username)
                #safe_password = urllib.parse.quote_plus(password)

                print(f"UserName:{username}")
                print(f"Password:{password}")
                    
                print("MONGODB_USER =", repr(self.config["MONGODB_USER"]))
                print("MONGODB_PASSWORD =", repr(self.config["MONGODB_PASSWORD"]))
                print("ENV USER:", os.getenv("MONGO_USERNAME"))
                print("ENV PASS EXISTS:", os.getenv("MONGO_PASSWORD") is not None)
                
                # 3. Construct the connection string
                default_uri = f"mongodb://{username}:{password}@{host}:{port}/?authSource={auth_db}"
                
                # 4. Connect (uses config value if provided, otherwise falls back to default_uri)
                print(f"Connecting to MongoDB with URI: {default_uri}")  # Debugging line
                self.mongo_client = MongoClient(default_uri)
                self._clients[db_name] = MongoClient(default_uri)
            client = self._clients[db_name]
            self._databases[db_name] = client[db_name]
            self._collections[db_name] = self._create_collections(self._databases[db_name])
        return self._databases[db_name]
    
    def get_collections(self, condition_func=None, db_name=None, **kwargs):
        """
        Get collections based on condition or database name
        Args:
            condition_func: Function that returns database name based on condition
            db_name: Direct database name for dynamic databases
            **kwargs: Additional parameters for condition function
        """
        if db_name:
            # Handle dynamic database
            if db_name == self.config["MONGODB_COLLECTION_NAME_MASTER"]:
                return self._collections[DatabaseType.MASTER]
            else:
                self._get_or_create_dynamic_database(db_name)
                return self._collections[db_name]
        elif condition_func:
            result = condition_func(**kwargs)
            if isinstance(result, DatabaseType):
                return self._collections[result]
            else:
                # Assume it's a dynamic database name
                self._get_or_create_dynamic_database(result)
                return self._collections[result]
        else:
            return self._collections[DatabaseType.MASTER]  # Default
    
    def get_database(self, db_identifier):
        """Get database by DatabaseType or dynamic name"""
        if isinstance(db_identifier, DatabaseType):
            return self._databases[db_identifier]
        else:
            # Dynamic database
            self._get_or_create_dynamic_database(db_identifier)
            return self._databases[db_identifier]
    
    def execute_query(self, collection_name, operation, condition_func=None, db_name=None, **kwargs):
        """
        Execute query on selected database at runtime
        Args:
            collection_name: Name of collection
            operation: Dict with operation type and parameters
            condition_func: Function to select database
            db_name: Direct database name for dynamic databases
            **kwargs: Parameters for condition function
        """
        collections = self.get_collections(condition_func, db_name, **kwargs)
        collection = collections[collection_name]
        
        op_type = operation.get('type')
        if op_type == 'find':
            
            results = list(collection.find(operation.get('filter', {}), operation.get('projection')))
            return convert_objectid(results)
        elif op_type == 'find_all':
            kwargs = {}
            if operation.get('sort') and operation.get('sort') != "":
                kwargs['sort'] = operation.get('sort')
                kwargs['limit'] = operation.get('limit')
            
            results = collection.find(operation.get('filter', {}), operation.get('projection'),**kwargs)
            return convert_objectid(results)
        elif op_type == 'find_one':
            kwargs = {}
            if operation.get('sort') and operation.get('sort') != "":
                kwargs['sort'] = operation.get('sort')
            result = collection.find_one(operation.get('filter', {}), operation.get('projection'),**kwargs)
            return convert_objectid(result)
        elif op_type == 'insert_one':
            result = collection.insert_one(operation['document'])
            return {'inserted_id': str(result.inserted_id), 'acknowledged': result.acknowledged}
        elif op_type == 'insert_many':
            result = collection.insert_many(operation['documents'])
            return {'inserted_ids': [str(id) for id in result.inserted_ids], 'acknowledged': result.acknowledged}
        elif op_type == 'update_one':
            result = collection.update_one(operation['filter'], operation['update'])
            return {'matched_count': result.matched_count, 'modified_count': result.modified_count, 'acknowledged': result.acknowledged}
        elif op_type == 'update_many':
            result = collection.update_many(operation['filter'], operation['update'])
            return {'matched_count': result.matched_count, 'modified_count': result.modified_count, 'acknowledged': result.acknowledged}
        elif op_type == 'delete_one':
            result = collection.delete_one(operation['filter'])
            return {'deleted_count': result.deleted_count, 'acknowledged': result.acknowledged}
        elif op_type == 'delete_many':
            result = collection.delete_many(operation['filter'])
            return {'deleted_count': result.deleted_count, 'acknowledged': result.acknowledged}
        elif op_type == 'count':
            return collection.count_documents(operation.get('filter', {}))
        elif op_type == 'aggregate':
            # pipeline = operation.get('pipeline', [])
            return list(collection.aggregate(operation.get('pipeline', [])))
        else:
            raise ValueError(f"Unsupported operation type: {op_type}")
    
    def close_connections(self):
        for client in self._clients.values():
            client.close()

# Condition functions
def select_database_by_user_type(user_type=None, **kwargs):
    """Example: Switch database based on user type"""
    ##print('user_type', user_type)
    if user_type == None:
        return DatabaseType.MASTER  # Return master database name
    else:
        return user_type  # Return dynamic database name

def convert_objectid(obj):
    """Convert ObjectId to string for JSON serialization"""
    if isinstance(obj, ObjectId):
        return str(obj)
    elif isinstance(obj, dict):
        return {key: convert_objectid(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_objectid(item) for item in obj]
    return obj
