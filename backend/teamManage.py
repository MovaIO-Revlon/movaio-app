from datetime import datetime, timezone
import logging
from commonutils import DatabaseCollections, CommonUtils
from session_manager import get_current_user
from config_loader import config_loader
from database_manager import select_database_by_user_type
from utils import ValidationError, NotFoundError

class TeamManager(DatabaseCollections):
    def __init__(self):
        super().__init__()
        self.utils = CommonUtils()
    
    def _query_db(self, collection_name, operation, user_type=None):
        """Helper method to query database with user type"""
        try:
            if user_type is None:
                current_user = get_current_user()
                prj_name = current_user.get('ActiveProject', 'master') if current_user else 'master'
                
                project_doc = self.project.find_one({'projectName': prj_name})
                if not project_doc:
                    user_type = 'master'
                else:
                    user_type = project_doc['database_name']
            
            return config_loader.query_db(
                collection_name,
                operation,
                condition_func=select_database_by_user_type,
                user_type=user_type
            )
        except Exception as ex:
            logging.error(f"Error in _query_db: {str(ex)}", exc_info=True)
            return None

    def create_team(self, request) -> str:
        payload = request.get_json()
        team_name = payload.get("TeamName", "").strip()
        is_active = payload.get("IsActive", True)
        created_by = payload.get("Created_By", "").strip()

        if not team_name:
            raise ValidationError("TeamName is required")

        # Check if team already exists
        existing_team = self.team_collection.find_one({"TeamName": team_name})
        if existing_team:
            raise ValidationError("Team already exists")

        # Generate new TeamId
        latest_team = self.team_collection.find_one(
            {"TeamId": {"$exists": True}},
            sort=[("TeamId", -1)]
        )
        new_team_id = (latest_team.get("TeamId", 0) + 1) if latest_team else 1

        team_doc = {
            "TeamName": team_name,
            "TeamId": new_team_id,
            "IsActive": is_active,
            "Created_Date": datetime.now(timezone.utc),
            "Created_By": created_by
        }

        # Insert in master DB
        # self.team_collection.insert_one(team_doc)

        # Insert in project DBs
        insert_op = {'type': 'insert_one', 'document': team_doc}
        self._query_db('team', insert_op)

        return new_team_id


    def get_all_teams_manage(self) -> list[dict]:
        all_teams: list[dict] = []

        # 1. Fetch from master DB (recent creates)
        master_teams = list(self.team_collection.find({}).sort("TeamId", 1))
        for team in master_teams:
            team_copy = team.copy()
            if '_id' in team_copy:
                team_copy['_id'] = str(team_copy['_id'])
            if 'Created_Date' in team_copy and isinstance(team_copy['Created_Date'], datetime):
                team_copy['Created_Date'] = team_copy['Created_Date'].isoformat()
            all_teams.append(team_copy)

        # 2. Always fetch from project DBs (old + synced recent; dedupe)
        seen_ids = {team.get('TeamId') for team in all_teams}
        team_op = {'type': 'find', 'filter': {}}
        project_teams_raw = self._query_db('team', team_op)  # user_type=None queries all projects
        project_teams_added = 0
        for team in project_teams_raw:
            team_copy = team.copy()
            team_id = team_copy.get('TeamId')
            if team_id and team_id not in seen_ids:
                if '_id' in team_copy:
                    team_copy['_id'] = str(team_copy['_id'])
                if 'Created_Date' in team_copy and isinstance(team_copy['Created_Date'], datetime):
                    team_copy['Created_Date'] = team_copy['Created_Date'].isoformat()
                all_teams.append(team_copy)
                seen_ids.add(team_id)
                project_teams_added += 1

        # 3. Sort by TeamId (old first, assuming lower IDs are older)
        all_teams.sort(key=lambda t: t.get('TeamId', 0))

        #print(f"DEBUG: Fetched {len(all_teams)} total teams (master: {len(master_teams)}, unique projects added: {project_teams_added})")
        return all_teams if all_teams else []

    def get_team_by_id(self, team_id) -> dict:
        # Convert to int if possible, but handle as flexible
        try:
            team_id_int = int(team_id)
            team_id_str = str(team_id_int)
        except ValueError:
            team_id_int = None
            team_id_str = str(team_id)

        #print(f"DEBUG: Searching for TeamId: {team_id} (int: {team_id_int}, str: {team_id_str})")

        team = None
        source = None

        # 1. Master query: Try int first, then str
        if team_id_int is not None:
            #print(f"DEBUG: Master query with int filter: {{'TeamId': {team_id_int}}}")
            team = self.team_collection.find_one({"TeamId": team_id_int})
        if not team and team_id_str:
            #print(f"DEBUG: Master query with str filter: {{'TeamId': '{team_id_str}'}}")
            team = self.team_collection.find_one({"TeamId": team_id_str})
        if team:
            source = "master"
        else:
           print(f"DEBUG: Not in master - sample doc: {list(self.team_collection.find().limit(1))}")

        # 2. Fallback to projects: Same type tries, use correct collection name
        if not team:
            team_op_int = {'type': 'find_one', 'filter': {"TeamId": team_id_int}} if team_id_int else None
            team_op_str = {'type': 'find_one', 'filter': {"TeamId": team_id_str}} if team_id_str else None

            if team_id_int is not None:
                #print(f"DEBUG: Projects query with int filter")
                team = self._query_db('TeamManagement', team_op_int, None)  # Fixed collection name
            if not team and team_id_str:
                #print(f"DEBUG: Projects query with str filter")
                team = self._query_db('TeamManagement', team_op_str, None)

        if team:
            # Serialize
            if '_id' in team:
                team['_id'] = str(team['_id'])
            if 'Created_Date' in team and isinstance(team['Created_Date'], datetime):
                team['Created_Date'] = team['Created_Date'].isoformat()
            #print(f"DEBUG: Found in {source} - Name: {team.get('TeamName')}")
            return team

        #print(f"DEBUG: Truly not found - master count: {self.team_collection.count_documents({})}")
        raise NotFoundError("Team not found")
    
    def update_team(self, team_id, request) -> str:
      try:
        payload = request.get_json()
        team_name = payload.get("TeamName", "").strip()
        is_active = payload.get("IsActive")

        if not team_name:
           raise ValidationError("TeamName is required")

        # Convert team_id to int (Flask gives string from URL)
        try:
            team_id_int = int(team_id)
        except (ValueError, TypeError):
           raise ValidationError("Invalid TeamId")

        # 1. Try to find in master (recent teams)
        existing_team = self.team_collection.find_one({"TeamId": team_id_int})
        source = "master"

        # 2. If not in master → check projects (old teams)
        if not existing_team:
            op = {'type': 'find_one', 'filter': {"TeamId": team_id_int}}
            existing_team = self._query_db('TeamManagement', op, None)  # Use correct collection name
            source = "projects"

        if not existing_team:
            print(f"DEBUG: Update failed - TeamId {team_id_int} not found anywhere")
            return NotFoundError("Team not found")

        #print(f"DEBUG: Found team {team_id_int} in {source} - updating...")

        # Check duplicate name (excluding current team)
        duplicate = self.team_collection.find_one({
            "TeamName": team_name,
            "TeamId": {"$ne": team_id_int}
        })
        if duplicate:
            return ValidationError("Team name already exists")

        # Prepare update
        update_data = {
            "TeamName": team_name,
            "IsActive": is_active,
            "Updated_Date": datetime.now(timezone.utc)
        }

        # Update master (if it was in master)
        if source == "master":
            self.team_collection.update_one(
                {"TeamId": team_id_int},
                {"$set": update_data}
            )

        # Always sync to all project DBs
        update_op = {
            'type': 'update_one',
            'filter': {"TeamId": team_id_int},
            'update': {"$set": update_data}
        }
        self._query_db('TeamManagement', update_op)  # No user_type = sync to all

        return team_id

      except Exception as ex:
        logging.error("Error in update_team:", exc_info=True)
        return {"Success": False, "Message": str(ex)}

    def delete_team(self, team_id) -> str:
        team_id_int = int(team_id)

        existing = self.team_collection.find_one({"TeamId": team_id_int})
        if not existing:
            op = {'type': 'find_one', 'filter': {"TeamId": team_id_int}}
            existing = self._query_db('team', op, None)

        if not existing:
            raise NotFoundError("Team not found")

        update_data = {
            "IsActive": False,
            "Updated_Date": datetime.now(timezone.utc)
        }

        # Update master if exists
        self.team_collection.update_one({"TeamId": team_id_int}, {"$set": update_data})

        # Sync to all projects
        sync_op = {
            'type': 'update_one',
            'filter': {"TeamId": team_id_int},
            'update': {"$set": update_data}
        }
        self._query_db('team', sync_op)

        return team_id

    def get_active_teams(self, user_type=None) -> list[dict]:
            team_op = {'type': 'find', 'filter': {"IsActive": True}}
            teams = self._query_db('team', team_op, user_type)
            
            if not teams:
                return []

            # Convert cursor to list if necessary
            if not isinstance(teams, list):
                teams = list(teams)

            for team in teams:
                if '_id' in team:
                    team['_id'] = str(team['_id'])
                if 'Created_Date' in team and isinstance(team['Created_Date'], datetime):
                    team['Created_Date'] = team['Created_Date'].isoformat()

            return teams

    def create_multiple_teams(self, request) -> list[dict]:
        # Expecting a LIST of team objects
        teams_data = request.get_json()
        
        if not isinstance(teams_data, list):
            raise ValidationError("Request body must be a JSON array of teams")

        if not teams_data:
            raise ValidationError("No teams provided")

        created_teams = []
        errors = []

        for idx, payload in enumerate(teams_data):
            team_name = payload.get("TeamName", "").strip()
            is_active = payload.get("IsActive", True)
            created_by = payload.get("Created_By", "").strip()

            if not team_name:
                errors.append(f"Team {idx+1}: TeamName is required")
                continue

            # Check duplicate name
            if self.team_collection.find_one({"TeamName": team_name}):
                errors.append(f"Team '{team_name}' already exists")
                continue

            # Generate next TeamId
            latest = self.team_collection.find_one(sort=[("TeamId", -1)])
            new_id = (latest["TeamId"] + 1) if latest else 1

            team_doc = {
                "TeamId": new_id,
                "TeamName": team_name,
                "IsActive": is_active,
                "Created_By": created_by,
                "Created_Date": datetime.now(timezone.utc)
            }

            # Insert into master
            self.team_collection.insert_one(team_doc)

            # Sync to all projects
            insert_op = {'type': 'insert_one', 'document': team_doc}
            self._query_db('TeamManagement', insert_op)

            created_teams.append({"TeamName": team_name, "TeamId": new_id})

        if errors:
            raise ValidationError("Some teams failed to create", errors)
        
        return created_teams