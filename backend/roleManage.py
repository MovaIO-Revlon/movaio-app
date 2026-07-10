from datetime import datetime, timezone

from commonutils import CommonUtils, DatabaseCollections
from config_loader import config_loader
from database_manager import select_database_by_user_type
from session_manager import get_current_user
from utils import NotFoundError, ValidationError
from flask import json
from bson import json_util


class RoleManager(DatabaseCollections):
    def __init__(self):
        super().__init__()
        self.utils = CommonUtils()

    def _query_db(self, collection_name, operation, user_type=None):
        """Helper method to query database with user type"""
        if user_type is None:
            current_user = get_current_user()
            prj_name = (
                current_user.get("ActiveProject", "master")
                if current_user
                else "master"
            )

            project_doc = self.project.find_one({"projectName": prj_name})
            if not project_doc:
                user_type = "master"  # fallback
            else:
                user_type = project_doc["database_name"]

        return config_loader.query_db(
            collection_name,
            operation,
            condition_func=select_database_by_user_type,
            user_type=user_type,
        )

    def create_role(self, request) -> str:
        payload = request.get_json()
        role_name = payload.get("RoleName", "").strip()
        is_active = payload.get("IsActive", True)
        created_by = payload.get("Created_By", "").strip()

        if not role_name:
            raise ValidationError("Role name is required")

        # Check if role already exists
        existing_role = self.role_collection.find_one({"RoleName": role_name})
        if existing_role:
            raise ValidationError("Role already exists")

        # Generate new RoleId
        latest_role = self.role_collection.find_one(
            {"RoleId": {"$exists": True}}, sort=[("RoleId", -1)]
        )
        new_role_id = (latest_role.get("RoleId", 0) + 1) if latest_role else 1

        role_doc = {
            "RoleName": role_name,
            "IsActive": is_active,
            "Created_Date": datetime.now(timezone.utc),
            "Created_By": created_by,
            "RoleId": new_role_id,
        }

        # Insert in master DB
        # self.role_collection.insert_one(role_doc)

        # Insert in project DBs
        insert_op = {"type": "insert_one", "document": role_doc}
        self._query_db("role", insert_op)

        return str(new_role_id)

    def get_all_roles(self, user_type=None):
        all_roles: list[dict] = []

        # 1. Fetch from master DB (recent creates)
        master_roles = list(self.role_collection.find({}).sort("RoleId", 1))
        for role in master_roles:
            role_copy = role.copy()
            if "_id" in role_copy:
                role_copy["_id"] = str(role_copy["_id"])
            if "Created_Date" in role_copy and isinstance(
                role_copy["Created_Date"], datetime
            ):
                role_copy["Created_Date"] = role_copy["Created_Date"].isoformat()
            all_roles.append(role_copy)

        # 2. Always fetch from project DBs (old + synced recent; dedupe)
        seen_ids = {role.get("RoleId") for role in all_roles}
        role_op = {"type": "find", "filter": {}}
        project_roles_raw = self._query_db(
            "role", role_op, user_type
        )  # user_type=None for all projects
        project_roles_added = 0
        for role in project_roles_raw:
            role_copy = role.copy()
            role_id = role_copy.get("RoleId")
            if role_id and role_id not in seen_ids:
                if "_id" in role_copy:
                    role_copy["_id"] = str(role_copy["_id"])
                if "Created_Date" in role_copy and isinstance(
                    role_copy["Created_Date"], datetime
                ):
                    role_copy["Created_Date"] = role_copy["Created_Date"].isoformat()
                all_roles.append(role_copy)
                seen_ids.add(role_id)
                project_roles_added += 1

        # 3. Sort by RoleId (old first, assuming lower IDs are older)
        all_roles.sort(key=lambda r: r.get("RoleId", 0))

        # print(f"DEBUG: Fetched {len(all_roles)} total roles (master: {len(master_roles)}, unique projects added: {project_roles_added})")
        return all_roles if all_roles else []

    def get_role_by_id(self, role_id: str):
        # Convert to int if possible, but handle as flexible
        try:
            role_id_int = int(role_id)
            role_id_str = str(role_id_int)
        except ValueError:
            role_id_int = None
            role_id_str = str(role_id)

        role = None

        # 1. Master query: Try int first, then str
        if role_id_int is not None:
            # print(f"DEBUG: Master query with int filter: {{'RoleId': {role_id_int}}}")
            role = self.role_collection.find_one({"RoleId": role_id_int})
        if not role and role_id_str:
            # print(f"DEBUG: Master query with str filter: {{'RoleId': '{role_id_str}'}}")
            role = self.role_collection.find_one({"RoleId": role_id_str})

        # else:
        # print(f"DEBUG: Not in master - sample doc: {list(self.role_collection.find().limit(1))}")

        # 2. Fallback to projects: Same type tries, use correct collection name
        if not role:
            role_op_int = (
                {"type": "find_one", "filter": {"RoleId": role_id_int}}
                if role_id_int
                else None
            )
            role_op_str = (
                {"type": "find_one", "filter": {"RoleId": role_id_str}}
                if role_id_str
                else None
            )

            if role_id_int is not None:
                # print(f"DEBUG: Projects query with int filter")
                role = self._query_db(
                    "RoleManagement", role_op_int, None
                )  # Fixed collection name
            if not role and role_id_str:
                # print(f"DEBUG: Projects query with str filter")
                role = self._query_db("RoleManagement", role_op_str, None)

        if role:
            # Serialize
            if "_id" in role:
                role["_id"] = str(role["_id"])
            if "Created_Date" in role and isinstance(role["Created_Date"], datetime):
                role["Created_Date"] = role["Created_Date"].isoformat()
            # print(f"DEBUG: Found in {source} - Name: {role.get('RoleName')}")
            return role

        # print(f"DEBUG: Truly not found - master count: {self.role_collection.count_documents({})}")
        raise NotFoundError("Role not found")

    def update_role(self, role_id, request) -> str:
        payload = request.get_json()
        role_name = payload.get("RoleName", "").strip()
        is_active = payload.get("IsActive")

        if not role_name:
            raise ValidationError("Role name is required")

        role_id_int = int(role_id)  # Flask gives string → convert

        # 1. Master
        existing = self.role_collection.find_one({"RoleId": role_id_int})
        source = "master"

        # 2. Projects fallback
        if not existing:
            op = {"type": "find_one", "filter": {"RoleId": role_id_int}}
            existing = self._query_db("role", op, None)
            source = "projects"

        if not existing:
            raise NotFoundError("Role not found")

        # Duplicate check
        if self.role_collection.find_one(
            {"RoleName": role_name, "RoleId": {"$ne": role_id_int}}
        ):
            raise ValidationError("Role name already exists")

        update_data = {
            "RoleName": role_name,
            "IsActive": is_active,
            "Updated_Date": datetime.now(timezone.utc),
        }

        # Update master if exists there
        if source == "master":
            self.role_collection.update_one(
                {"RoleId": role_id_int}, {"$set": update_data}
            )

        # Sync to ALL projects
        sync_op = {
            "type": "update_one",
            "filter": {"RoleId": role_id_int},
            "update": {"$set": update_data},
        }
        self._query_db("role", sync_op)  # ← correct name

        return role_id

    def delete_role(self, role_id):
        # Convert to int (Flask route gives string)
        try:
            role_id_int = int(role_id)
        except (ValueError, TypeError):
            raise ValidationError("Invalid RoleId")

        # 1. Check master first
        existing_role = self.role_collection.find_one({"RoleId": role_id_int})
        source = "master"

        # 2. If not in master → check ALL project DBs (old roles)
        if not existing_role:
            op = {"type": "find_one", "filter": {"RoleId": role_id_int}}
            existing_role = self._query_db(
                "role", op, None
            )  # ← correct collection name
            source = "projects"

        if not existing_role:
            # print(f"DEBUG: Delete failed - RoleId {role_id_int} not found anywhere")
            raise NotFoundError("Role not found")

        # print(f"DEBUG: Soft-deleting RoleId {role_id_int} (found in {source})")

        # Soft delete: set IsActive = False + Updated_Date
        update_data = {"IsActive": False, "Updated_Date": datetime.now(timezone.utc)}

        # Update master if it was there
        if source == "master":
            self.role_collection.update_one(
                {"RoleId": role_id_int}, {"$set": update_data}
            )

        # Always sync soft-delete to ALL project DBs
        delete_op = {
            "type": "update_one",
            "filter": {"RoleId": role_id_int},
            "update": {"$set": update_data},
        }
        self._query_db("role", delete_op)  # ← correct name, no user_type = all projects

        return role_id

    def get_active_roles(self, user_type=None):
        role_op = {"type": "find", "filter": {"IsActive": True}}
        roles = self._query_db("role", role_op, user_type)

        if not roles:
            return []

        # Convert ObjectId and datetime to serializable format
        for role in roles:
            if "_id" in role:
                role["_id"] = str(role["_id"])
            if "Created_Date" in role and isinstance(role["Created_Date"], datetime):
                role["Created_Date"] = role["Created_Date"].isoformat()

        return roles

    def create_multiple_roles(self, request) -> list:
        # Expecting a JSON array of role objects
        roles_data = request.get_json()

        if not isinstance(roles_data, list):
            raise ValidationError("Request body must be a JSON array of roles")

        if not roles_data:
            raise ValidationError("No roles provided")

        created_roles = []
        errors = []

        for idx, payload in enumerate(roles_data):
            role_name = payload.get("RoleName", "").strip()
            is_active = payload.get("IsActive", True)
            created_by = payload.get("Created_By", "").strip()

            if not role_name:
                errors.append(f"Role {idx + 1}: RoleName is required")
                continue

            # Check duplicate name
            if self.role_collection.find_one({"RoleName": role_name}):
                errors.append(f"Role '{role_name}' already exists")
                continue

            # Generate next RoleId
            latest = self.role_collection.find_one(sort=[("RoleId", -1)])
            new_id = (latest["RoleId"] + 1) if latest else 1

            role_doc = {
                "RoleId": new_id,
                "RoleName": role_name,
                "IsActive": is_active,
                "Created_By": created_by,
                "Created_Date": datetime.now(timezone.utc),
            }

            # Insert into master DB
            self.role_collection.insert_one(role_doc)

            # Sync to ALL project DBs
            insert_op = {"type": "insert_one", "document": role_doc}
            self._query_db("role", insert_op)  # Correct collection name

            created_roles.append({"RoleName": role_name, "RoleId": new_id})

        if errors:
            raise ValidationError("Some roles failed to create", errors)

        return created_roles
    
    def get_all_role_permissions(self):
        role_permissions = json.loads(json_util.dumps(self.role_permissions_collection.find({})))
        return role_permissions
