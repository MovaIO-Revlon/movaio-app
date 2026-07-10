from pydantic import ValidationError
from config_loader import ConfigLoader, config_loader
import requests
from commonutils import DatabaseCollections, CommonUtils
from session_manager import get_current_user
from config_loader import config_loader
from database_manager import select_database_by_user_type
import json
import re
from bson.objectid import ObjectId
import gridfs

class AutomationLibraryAPI(DatabaseCollections):
    def __init__(self):
        super().__init__()
        self.config = ConfigLoader()
        self.utils = CommonUtils()
        self.db =config_loader.main_db
        self.fs = gridfs.GridFS(self.db)

    def get_automation_library(self):
        try:
            cursor = self.automation_library_collection.find({})
            libraries = [self.utils.clean_document(doc) for doc in cursor]
            return libraries
        except Exception as e:
            raise Exception(f"Error fetching automation library: {e}")

    def get_automation_library_by_id(self, library_id):
        try:
            if not ObjectId.is_valid(library_id):
                raise ValueError("Invalid library ID format")
            library = self.automation_library_collection.find_one({"_id": ObjectId(library_id)})
            if not library:
                raise ValueError("Library not found")
            return self.utils.clean_document(library)
        except Exception as e:
            raise Exception(f"Error fetching automation library by ID: {e}")

    def add_to_automation_library(self, data, files):
        try:
            # Validate input data
            file_ids = []
            print(files)
            if files:
                
                for file in files:
                    file_id = self.fs.put(file, filename=file.filename, content_type=file.content_type, uploaded_at=self.utils.get_current_timestamp())
                    print(file_id)
                    file_ids.append(str(file_id))
                data['script_file_ids'] = file_ids

            insert_data = {
                "name": data.get("name"),
                "description": data.get("description"),
                "automation_script_type": data.get("automation_script_type"),
                "script_file_ids": file_ids,
                "script_count": len(file_ids),
                "created_ts": self.utils.get_current_timestamp()
            }

            # Insert into database
            result = self.automation_library_collection.insert_one(insert_data)
            return f"Added to automation library with ID: {result.inserted_id}"
        except Exception as e:

            raise Exception(f"Error adding to automation library: {e}")

    def get_automation_script_types(self):
        try:
            cursor = self.automation_script_types_collection.find({})
            script_types = [self.utils.clean_document(doc) for doc in cursor]
            return script_types
        except Exception as e:
            raise Exception(f"Error fetching automation script types: {e}")
    
    def update_automation_library(self, data, files):
        try:
            library_id = data.get("library_id")
            if not library_id:
                raise ValueError("Invalid or missing library ID")

            update_data = {}
            if "name" in data:
                update_data["name"] = data["name"]
            if "description" in data:
                update_data["description"] = data["description"]
            if "automation_script_type" in data:
                update_data["automation_script_type"] = data["automation_script_type"]
            if "script_file_ids" in data:
                update_data["script_file_ids"] = json.loads(data["script_file_ids"])

            if files:
                for file in files:
                    file_id = self.fs.put(file, filename=file.filename, content_type=file.content_type, uploaded_at=self.utils.get_current_timestamp())
                    update_data.setdefault("script_file_ids", []).append(str(file_id))
                
            update_data['script_count'] = len(update_data['script_file_ids'])

            if not update_data:
                raise ValueError("No valid fields to update")

            result = self.automation_library_collection.update_one(
                {"_id": ObjectId(library_id)},
                {"$set": {**update_data, "updated_ts": self.utils.get_current_timestamp()}}
            )

            if result.matched_count == 0:
                raise ValueError("Library not found")
            return f"Updated automation library with ID: {library_id}"
        except Exception as e:
            raise Exception(f"Error updating automation library: {e}")

    def delete_from_automation_library(self, library_id):
        try:
            if not ObjectId.is_valid(library_id):
                raise ValueError("Invalid library ID format")
            result = self.automation_library_collection.delete_one({"_id": ObjectId(library_id)})
            if result.deleted_count == 0:
                raise ValueError("Library not found")
            return f"Deleted automation library with ID: {library_id}"
        except Exception as e:
            raise Exception(f"Error deleting from automation library: {e}")