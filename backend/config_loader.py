import json
import os
from pymongo import MongoClient
from database_manager import DatabaseManager, select_database_by_user_type

class ConfigLoader:
    def __init__(self, config_file='config.json'):
        with open(config_file) as f:
            raw_config = f.read()
        ##print("config",raw_config)
        resolved_config = os.path.expandvars(raw_config)
        self.config = json.loads(resolved_config)
        self._setup_paths()
        self._setup_mongo()
        self._setup_config_vars()

        # 1. Get credentials (ideally from environment variables or secure config)
        username = self.config.get("MONGODB_USER", "your_username")
        password = self.config.get("MONGODB_PASSWORD", "your_password")
        host = self.config.get("MONGODB_HOST", "localhost")
        port = self.config.get("MONGODB_PORT", "27017")
        auth_db = self.config.get("MONGODB_AUTH_DB", "admin") # Database where the user is created
        
        # 2. URL-encode credentials to handle special characters safely
        safe_username = urllib.parse.quote_plus(username)
        safe_password = urllib.parse.quote_plus(password)
        
        # 3. Construct the connection string
        default_uri = f"mongodb://{safe_username}:{safe_password}@{host}:{port}/?authSource={auth_db}"
        
        # 4. Connect (uses config value if provided, otherwise falls back to default_uri)
        self.mongo_client = MongoClient(self.config.get("MONGODB_CONNECTION", default_uri))

        #self.mongo_client = MongoClient(self.config.get("MONGODB_CONNECTION", "mongodb://localhost:27017/"))
        self.main_db = self.mongo_client[self.config.get("MONGODB_COLLECTION_NAME_MASTER", "dev_qa")]
        self.encryption_key = self.config["Encryption_key"]
        self.IsServiceMode = self.config.get("IsServiceMode", False)
        self.Isprod = self.config.get("IS_PROD")
        self.Is_UAT = self.config.get("Is_UAT", False)
    
    def _setup_paths(self):
        if self.config["IS_PROD"] is False:
            self.USER_STORY_FOLDER = r"D:\lap-04-7702\KKR\userstory"
            self.UserImage_folder = r"D:\lap-04-7702\Chatbot&Git_2025\AI-Infused-QE\kkr_ai_infusion_web\frontend\src\assets\userprofile"
            self.Origin_url = "http://localhost:5000"
            self.pandac_path = r"D:\lap-04-7702\KKR\pandac_files"
        else:
            self.UserImage_folder = r"C:\Application\AI-Infused_QE\Frontend\browser\assets\userprofile"
            self.USER_STORY_FOLDER = r"C:\Users\Administrator\Documents\userstory"
            self.temp_dir = r"C:\Users\Administrator\Documents\temp_dir"
            self.incident_file_path = r"C:\Users\Administrator\Documents\incident_files\Incident_Data.xlsx"
            self.index_name = "incident_dev002"
            self.Origin_url = "https://sdlcai.movatesolutions.com/"
            self.pandac_path = r"C:\Users\Administrator\Documents\pandoc\pandoc.exe"
        os.makedirs(self.UserImage_folder, exist_ok=True)
    
    def _setup_mongo(self):
        self.db_manager = DatabaseManager(self.config)
        # Keep backward compatibility
        self.MONGO_COLLECTIONS = self.db_manager.get_collections()
    
    def query_db(self, collection_name, operation, condition_func=None, **condition_kwargs):
        """Execute query with runtime database selection"""
        return self.db_manager.execute_query(collection_name, operation, condition_func, **condition_kwargs)
    
    def _setup_config_vars(self):
        self.SECRET_KEY = self.config["SECRET_KEY"]
        
        
        self.OTP_RECAPTCHA = self.config["OTP_RECAPTCHA"]
        self.OTP_EXTERNAL_SERVICE = self.config["OTP_EXTERNAL_SERVICE"]
        self.AZ_MAIL_PWD = self.config["AZ_MAIL_PWD"]
        self.SMTP_USER = self.config["SMTP_USERNAME"]
        self.SMTP_PASS = self.config["SMTP_PASSWORD"]
        self.SMTP_HOST = self.config["SMTP_HOST"]
        self.SMTP_PORT = self.config["SMTP_PORT"]
        self.EMAIL_FROM = self.config["EMAIL_FROM"]
        self.EMAIL_FROM_NAME = self.config["EMAIL_FROM_NAME"]
        self.EMAIL_SUBJECT = self.config["EMAIL_SUBJECT"]
        self.RECAPTCHA_SITE_KEY = self.config["reCAPTCHA"]["SiteKey"]
        self.RECAPTCHA_SECRET_KEY = self.config["reCAPTCHA"]["SecretKey"]
        self.RECAPTCHA_API_KEY = self.config["reCAPTCHA"]["ApiKey"]
        self.OTP_URL = self.config["OTPURL"]
        self.VALIDATE_OTP_URL = self.config["ValidateOTP"]
        self.CLIENT_NAME = self.config["ClientName"]
        self.LYZR_AGENT_URL = self.config["LYZR_AGENT_URL"]
        self.LYZR_RAG_URL = self.config["LYZR_RAG_URL"]     
        self.TITLE = self.config.get("Title", "AI Infused SE Portal")
        self.MASTER_DB = self.config.get("MONGODB_COLLECTION_NAME_MASTERDB_NAME")
        self.MCP_FILES_COLLECTION = self.config.get("MCP_FILES_COLLECTION")
        self.MASTER_DB_NAME = self.config.get("MONGODB_COLLECTION_NAME_MASTER")
        self.FLASK_PORT = self.config.get("Flask_Port", 5001)
        self.EMAIL_SUBJECT_APPROVAL_ONBOARDING = self.config.get("EMAIL_SUBJECT_APPROVAL_ONBOARDING", "Approval Required for Agent Onboarding")
        self.EMAIL_SUBJECT_APPROVAL_UPDATE = self.config.get("EMAIL_SUBJECT_APPROVAL_UPDATE", "Approval Required for Agent Update")
        self.EMAIL_SUBJECT_APPROVAL_DELETE = self.config.get("EMAIL_SUBJECT_APPROVAL_DELETE", "Approval Required for Agent Delete")
        self.APPROVAL_TEMPLATE_NAME = self.config.get("APPROVAL_TEMPLATE_NAME", "agent_approval_template.html")
        self.EMAIL_APPROVAL_MANAGER = self.config.get("EMAIL_APPROVAL_MANAGER", [])
        self.SITE_URL = self.config.get("Site_Url")
        self.URL_CONF = self.config.get("URL_CONF")
        self.AUTOMATION_LIBRARY_COLLECTION = self.config.get("AUTOMATION_LIBRARY_COLLECTION")
        self.AUTOMATION_SCRIPT_TYPES_COLLECTION = self.config.get("AUTOMATION_SCRIPT_TYPES_COLLECTION")
        self.AGENT_VERSION_HISTORY_COLLECTION = self.config.get("AGENT_VERSION_HISTORY_COLLECTION")
        self.ISNEWPORT = self.config.get("IsNewPort")
        self.OTP_TEMPLATE_NAME = self.config.get("OTP_TEMPLATE_NAME")
        self.WELCOME_TEMPLATE_NAME = self.config.get("WELCOME_TEMPLATE_NAME")
        self.RESET_PASSWORD_TEMPLATE_NAME = self.config.get("RESET_PASSWORD_TEMPLATE_NAME")
        self.CONFIG = self.config
        self.API_KEY_LYZR = self.config.get("API_KEY_LYZR", "")
        self.USER_ID_LYZR = self.config.get("USER_ID_LYZR", "")
        self.TREND_AGENT_ID_LYZR = self.config.get("TREND_AGENT_ID_LYZR", "")
        self.INSIGHT_AGENT_ID_LYZR = self.config.get("INSIGHT_AGENT_ID_LYZR", "")
        self.INSIGHT_LIMIT = self.config.get("INSIGHT_LIMIT", 5)

        # Azure Communication Services credentials
        self.AZURE_TENANT_ID = self.config.get("AZURE_TENANT_ID", "")
        self.AZURE_CLIENT_ID = self.config.get("AZURE_CLIENT_ID", "")
        self.AZURE_CLIENT_SECRET = self.config.get("AZURE_CLIENT_SECRET", "")
        self.AZURE_ACS_ENDPOINT = self.config.get("AZURE_ACS_ENDPOINT", "")
        self.AZURE_SENDER_ADDRESS = self.config.get("AZURE_SENDER_ADDRESS", "")
    
        # lyzr details
        self.LYZR_STREAMING_AGENT_URL = self.config.get("lyzrStreamin_api_url", "")
        self.LYZR_RAG_API_KEY = self.config.get("LYZR_RAG_API_KEY", "")
        
        return self
    
    def get_lyzr_internal_agent_details(self):
            lyzr = self.config.get("lyzrInternal", {})
            return (
                lyzr.get("Agent_api_url", ""),
                lyzr.get("x_api_key", ""),
                lyzr.get("user_id", ""),
                lyzr.get("agent_id", ""),
                lyzr.get("session_id", ""),
            )
        
    def get_lyzr_external_agent_details(self):
            lyzr = self.config.get("lyzrExternal", {})
            return (
                lyzr.get("Agent_api_url", ""),
                lyzr.get("x_api_key", ""),
                lyzr.get("user_id", ""),
                lyzr.get("agent_id", ""),
                lyzr.get("session_id", ""),
            )
            
    def get_insight_agent_details(self):
            lyzr = self.config.get("InsightAgentConfig", {})
            return (
                lyzr.get("Agent_api_url", ""),
                lyzr.get("x_api_key", ""),
                lyzr.get("user_id", ""),
                lyzr.get("agent_id", ""),
                lyzr.get("session_id", ""),
            )

    def get_jira_details(self):
            jira = self.config.get("JiraExternal", {})
            return {
                "JIRA_URL": jira.get("JIRA_URL", ""),
                "JIRA_USER": jira.get("JIRA_USER", ""),
                "JIRA_API_TOKEN": jira.get("JIRA_API_TOKEN", ""),
                "JIRA_PROJECT_KEY": jira.get("JIRA_PROJECT_KEY", ""),
            }
            
    def get_opensearch_details(self):
        opensearch = self.config.get("opensearch", {})
        return {
            "host": opensearch.get("host", ""),
            "port": opensearch.get("port", 9200),
            "username": opensearch.get("username", ""),
            "password": opensearch.get("password", ""),
        }

config_loader = ConfigLoader()
