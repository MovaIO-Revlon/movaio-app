from datetime import datetime, timezone
from bson.objectid import ObjectId
from utils import NotFoundError, ValidationError, buildResponse
from commonutils import DatabaseCollections, CommonUtils
from database_manager import DatabaseManager
from session_manager import get_current_user
from config_loader import ConfigLoader, config_loader
from database_manager import select_database_by_user_type


class ExternalApp(DatabaseCollections):
    def __init__(self):
        super().__init__()
        self.config = ConfigLoader()
        self.utils = CommonUtils()
        self.db = config_loader.main_db

    def _query_db(self, collection_name, operation, user_type=None):
        if user_type is None:
            try:
                current_user = get_current_user()
                prj_name = current_user.get(
                    'ActiveProject',
                    self.config.config["MONGODB_COLLECTION_NAME_MASTER"]
                )
                user_type = self.project.find_one({'projectName': prj_name})['database_name']
            except:
                user_type = self.config.config["MONGODB_COLLECTION_NAME_MASTER"]

        if user_type == 'master':
            user_type = self.config.config["MONGODB_COLLECTION_NAME_MASTER"]

        return self.db.execute_query(
            collection_name,
            operation,
            condition_func=select_database_by_user_type,
            user_type=user_type
        )

    def _select_database_by_user_type(self, user_type):
        return user_type

    # ------------------------------------------------------------------
    # Register External Application
    # ------------------------------------------------------------------
    def register_external_application(self, data):
        try:
            required_fields = ["name", "application_type", "allowed_apis", "auth_method"]
            for field in required_fields:
                if not data.get(field):
                    raise ValidationError(f"Missing required field: {field}")

            name = data["name"].strip()
            application_type = data["application_type"].strip().lower()
            application_url = data.get("application_url", "").strip()
            description = data.get("description", "").strip()
            allowed_apis = data.get("allowed_apis", [])
            auth_method = data.get("auth_method", "api_key").lower()
            status = data.get("status", "active").lower()

            valid_types = ["web", "mobile", "teams", "vscode", "servicenow"]
            if application_type not in valid_types:
                raise ValidationError(f"Invalid application_type. Allowed: {valid_types}")

            if auth_method != "api_key":
                raise ValidationError("Currently only 'api_key' authentication method is supported")

            valid_apis = ["agents", "workflows", "voice_agents", "tools", "knowledge_base", "insights"]
            for api in allowed_apis:
                if api not in valid_apis:
                    raise ValidationError(f"Invalid allowed API: {api}")

            if not allowed_apis:
                raise ValidationError("At least one Allowed API must be selected")

            # Check duplicate name
            existing = self.external_applications_collection.find_one({
                "name": {"$regex": f"^{name}$", "$options": "i"},
                "is_deleted": {"$ne": True}
            })
            if existing:
                raise ValidationError(f"Application with name '{name}' already exists")

            current_user = get_current_user() or {}
            created_by = current_user.get("email") or current_user.get("user_id") or "system"

            app_doc = {
                "name": name,
                "application_type": application_type,
                "application_url": application_url,
                "description": description,
                "allowed_apis": allowed_apis,
                "auth_method": auth_method,
                "status": status,
                "created_by": created_by,
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
                "last_used_at": None,
                "usage_count": 0,
                "is_deleted": False
            }

            result = self.external_applications_collection.insert_one(app_doc)

            return {
                "application_id": str(result.inserted_id),
                "name": name,
                "application_type": application_type,
                "application_url": application_url,
                "description": description,
                "allowed_apis": allowed_apis,
                "auth_method": auth_method,
                "status": status,
                "created_at": app_doc["created_at"].isoformat(),
                "message": "External application registered successfully"
            }

        except ValidationError as ve:
            raise ve
        except Exception as e:
            raise Exception(f"Error registering external application: {e}")

    def update_external_application(self, application_id, data):
        try:
            if not ObjectId.is_valid(application_id):
                raise ValueError("Invalid application ID format")

            app = self.external_applications_collection.find_one({
                "_id": ObjectId(application_id),
                "is_deleted": {"$ne": True}
            })
            if not app:
                raise ValueError("External application not found")

            name = data.get("name", app.get("name", "")).strip()
            application_type = data.get("application_type", app.get("application_type", "")).strip().lower()
            application_url = data.get("application_url", app.get("application_url", "")).strip()
            description = data.get("description", app.get("description", "")).strip()
            allowed_apis = data.get("allowed_apis", app.get("allowed_apis", []))
            status = data.get("status", app.get("status", "active")).lower()

            valid_types = ["web", "mobile", "teams", "vscode", "servicenow"]
            if application_type not in valid_types:
                raise ValidationError(f"Invalid application_type. Allowed: {valid_types}")

            valid_apis = ["agents", "workflows", "voice_agents", "tools", "knowledge_base", "insights"]
            for api in allowed_apis:
                if api not in valid_apis:
                    raise ValidationError(f"Invalid allowed API: {api}")

            if not allowed_apis:
                raise ValidationError("At least one Allowed API must be selected")

            # Duplicate name check — exclude current record
            existing = self.external_applications_collection.find_one({
                "name": name,
                "is_deleted": {"$ne": True},
                "_id": {"$ne": ObjectId(application_id)}
            })
            if existing:
                raise ValidationError(f"Application with name '{name}' already exists")

            update_doc = {
                "name": name,
                "application_type": application_type,
                "application_url": application_url,
                "description": description,
                "allowed_apis": allowed_apis,
                "status": status,
                "updated_at": datetime.now(timezone.utc)
            }

            self.external_applications_collection.update_one(
                {"_id": ObjectId(application_id)},
                {"$set": update_doc}
            )

            return {
                "application_id": application_id,
                "name": name,
                "application_type": application_type,
                "application_url": application_url,
                "description": description,
                "allowed_apis": allowed_apis,
                "auth_method": app.get("auth_method"),
                "status": status,
                "updated_at": update_doc["updated_at"].isoformat(),
                "message": "External application updated successfully"
            }
        except ValidationError as ve:
            raise ve
        except Exception as e:
            raise Exception(f"Error updating external application: {e}")
    
    # ------------------------------------------------------------------
    # List External Applications
    # ------------------------------------------------------------------
    def get_external_applications(self):
        try:
            cursor = self.external_applications_collection.find(
                {"is_deleted": {"$ne": True}}
            ).sort("created_at", -1)

            apps = []
            for app in cursor:
                apps.append({
                    "application_id": str(app.get("_id")),
                    "name": app.get("name"),
                    "application_type": app.get("application_type"),
                    "application_url": app.get("application_url"),
                    "description": app.get("description"),
                    "allowed_apis": app.get("allowed_apis", []),
                    "auth_method": app.get("auth_method"),
                    "status": app.get("status"),
                    "created_by": app.get("created_by"),
                    "created_at": app.get("created_at").isoformat() if app.get("created_at") else None,
                    "last_used_at": app.get("last_used_at").isoformat() if app.get("last_used_at") else None,
                    "usage_count": app.get("usage_count", 0)
                })
            return apps
        except Exception as e:
            raise Exception(f"Error fetching external applications: {e}")

    # ------------------------------------------------------------------
    # Get Single External Application
    # ------------------------------------------------------------------
    def get_external_application_by_id(self, application_id):
        try:
            if not ObjectId.is_valid(application_id):
                raise ValueError("Invalid application ID format")

            app = self.external_applications_collection.find_one({
                "_id": ObjectId(application_id),
                "is_deleted": {"$ne": True}
            })
            if not app:
                raise ValueError("External application not found")

            return {
                "application_id": str(app.get("_id")),
                "name": app.get("name"),
                "application_type": app.get("application_type"),
                "application_url": app.get("application_url"),
                "description": app.get("description"),
                "allowed_apis": app.get("allowed_apis", []),
                "auth_method": app.get("auth_method"),
                "status": app.get("status"),
                "created_by": app.get("created_by"),
                "created_at": app.get("created_at").isoformat() if app.get("created_at") else None,
                "updated_at": app.get("updated_at").isoformat() if app.get("updated_at") else None,
                "last_used_at": app.get("last_used_at").isoformat() if app.get("last_used_at") else None,
                "usage_count": app.get("usage_count", 0)
            }
        except Exception as e:
            raise Exception(f"Error fetching external application: {e}")

    # ------------------------------------------------------------------
    # Delete External Application (Soft Delete)
    # ------------------------------------------------------------------
    def delete_external_application(self, application_id):
        try:
            if not ObjectId.is_valid(application_id):
                raise ValueError("Invalid application ID format")

            app = self.external_applications_collection.find_one({
                "_id": ObjectId(application_id),
                "is_deleted": {"$ne": True}
            })
            if not app:
                raise ValueError("External application not found")

            self.external_applications_collection.update_one(
                {"_id": ObjectId(application_id)},
                {"$set": {
                    "is_deleted": True,
                    "updated_at": datetime.now(timezone.utc)
                }}
            )

            return {
                "application_id": application_id,
                "message": "External application deleted successfully"
            }
        except Exception as e:
            raise Exception(f"Error deleting external application: {e}")