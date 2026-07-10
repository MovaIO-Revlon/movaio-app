# workflow.py
import re
import requests
import json
import logging

import uuid
from bson.objectid import ObjectId
import logging
from datetime import datetime,timedelta, timezone
from jira import JIRA
from config_loader import ConfigLoader
from commonutils import DatabaseCollections, CommonUtils
from database_manager import select_database_by_user_type
from config_loader import config_loader
from session_manager import session_manager, require_session, get_current_user
from commonutils import DatabaseCollections, CommonUtils
from flask import session, request, jsonify
import threading
import time

class WorkflowModel:
    @staticmethod
    def iso_format(dt):
        """Convert datetime to ISO status_set string."""
        if not dt:
            return None
        if isinstance(dt, str):
            return dt
        return dt.isoformat()

    @staticmethod
    def format_response(doc):
        """Format MongoDB document into structured JSON."""
        if not doc:
            return None

        flow_id = str(doc.get("flow_id") or doc.get("_id"))
        flow_name = doc.get("flow_name", "Unnamed Workflow")
        flow_description = doc.get("flow_description", "")
        agency_name = doc.get("agency_name", "")
        team = doc.get("team","")
        Isactive = doc.get("active","")
        IsExternal = doc.get("IsExternal","")
        flow_data = doc.get("flow_data", {})
        tasks = flow_data.get("tasks", [])
        created_at = doc.get("created_at","")
        updated_at = doc.get("updated_at","")
        default_inputs = flow_data.get("default_inputs", {})
        edges = doc.get("edges", [])
        node_positions = flow_data.get("flow_data", {}).get("node_positions", {})

        return {
            "flow_id": flow_id,
            "flow_name": flow_name,
            "flow_description": flow_description,
            "agency_name": agency_name,
            "team":team,
            "IsExternal":IsExternal,
            "Isactive":Isactive,
            "created_at":created_at,
            "updated_at": updated_at,
            "flow_data": {
                "tasks": tasks,
                "default_inputs": default_inputs,
                "edges": edges,
                "flow_data": {
                    "node_positions": node_positions
                }
            },
            "api_key": doc.get("api_key"),
            
        }

class WorkflowManager(DatabaseCollections):
    def __init__(self,socketio):
        super().__init__()  # Initialize parent class (DatabaseCollections)
        self.socketio = socketio
        self.config = ConfigLoader()        
        self.utils = CommonUtils()
        jira_config = ConfigLoader().get_jira_details()
        self.jira_url = jira_config["JIRA_URL"]
        self.jira_user = jira_config["JIRA_USER"]
        self.jira_api_token = jira_config["JIRA_API_TOKEN"]
        self.jira_project_key = jira_config["JIRA_PROJECT_KEY"]
        self.jira_client = None
      
    def _query_db(self, collection_name, operation,user_type=None):
        """Helper method to query database with user type"""
        if user_type is None:
            current_user = get_current_user()
            prj_name = current_user.get('ActiveProject', self.config.config["MONGODB_COLLECTION_NAME_MASTER"]) 
            
            project_doc = self.project.find_one({'projectName': prj_name})
            if not project_doc:
                user_type = self.config.config["MONGODB_COLLECTION_NAME_MASTER"]
            else:
                user_type = project_doc['database_name']
        
        
        return config_loader.query_db(
            collection_name,
            operation,
            condition_func=select_database_by_user_type,
            user_type=user_type
        )
        
    def connect_to_jira(self):
        """Establishes and returns a JIRA client connection."""
        if not all([self.jira_url, self.jira_user, self.jira_api_token]):
            print("ERROR: JIRA_URL, JIRA_USER, and JIRA_API_TOKEN must be configured.")
            return False
        try:
            self.jira_client = JIRA(server=self.jira_url, basic_auth=(self.jira_user, self.jira_api_token))
            print("Successfully connected to Jira.")
            return True
        except Exception as e:
            print(f"ERROR: Failed to connect to Jira. {e}")
            return False
  
    def format_response(self, doc):
        """Format MongoDB document into structured JSON."""
        return WorkflowModel.format_response(doc)

    def get_all(self):
        try:
            # docs = self.workflow_collection.find()
            find_op = {'type': 'find', 'filter': {}}
            docs = self._query_db('workflow_collection', find_op)
            return [WorkflowModel.format_response(doc) for doc in docs if doc]
        except Exception as e:
            logging.error(f"Error getting all workflows: {str(e)}")
            return []

    def get_by_id(self, flow_id):
        try:
            print("ff",flow_id)
            query = {"flow_id": flow_id}
            # doc = self.workflow_collection.find_one(query) or (
                # self.workflow_collection.find_one({"_id": ObjectId(flow_id)}) if ObjectId.is_valid(flow_id) else None
            # )
            find_one_op = {'type': 'find_one', 'filter':query}
            doc =self._query_db('workflow_collection', find_one_op)
            return WorkflowModel.format_response(doc) if doc else None
        except Exception as e:
            logging.error(f"Error getting workflow by id {flow_id}: {str(e)}")
            return None
            
    def create(self, data):
        try:
            data["flow_id"] = data.get("flow_id", str(uuid.uuid4()))
            data["created_at"] = datetime.utcnow()
            data["updated_at"] = datetime.utcnow()
            
            agency_id = data.get("agency_name","")
            agency = self.agency_collection.find_one({"agency_id":agency_id},{"_id":0,"agency_name":1,"assigned_to":1})
            if agency:
                agency_name = agency.get("agency_name","")
                team = agency.get("assigned_to","")
            data["agency_name"] = agency_name
            data["team"] = team
            data["IsExternal"] = False
            data["active"] = True
            
            result = self.workflow_collection.insert_one(data)
            mapping_doc = {
                "agency_id": agency_id,
                "agency_name": agency_name,
               
                "flow_id": data["flow_id"],
                "flow_name": data.get("flow_name", data.get("name", "")),
                "status": "active",
                "created_ts": datetime.utcnow(),
                "updated_ts": datetime.utcnow()
            }
            
            self.workflow_agency_mapping_collection.insert_one(mapping_doc)
            team =self.agency_collection.find_one({"agency_name" :agency_name,"is_deleted": False},{"_id":0,"assigned_to":1})
            seen_projects = set()
            assigned_team = team.get("assigned_to","")
            print("assign",assigned_team)
            if team and "assigned_to" in team:
                cursor = self.project.find(
                    {"teams.teamName": assigned_team, "active" : True},
                    {"_id": 0, "projectName": 1}
                )
                project_names = []
                print("a1",cursor)
                for proj in cursor:
                    pname = proj.get("projectName")
                    print("a2",pname)
                    if pname and pname not in seen_projects:
                        project_names.append(pname)
                        seen_projects.add(pname)
            print("a2",seen_projects)
            for seen_project in seen_projects:
                    user_type = self.project.find_one(
                        {"projectName": seen_project}, {"_id": 0, "database_name": 1})
                    
                    if user_type:
                        print("a3",user_type)
                        find_op = {'type': 'find_one', 'filter': {'flow_id': data["flow_id"]}}
                        existing = self._query_db('workflow_collection', find_op,user_type= user_type.get("database_name"))
                        existing_agency_mapping = self._query_db('workflow_agency_mapping_collection', find_op,user_type= user_type.get("database_name"))
                        if not existing:
                            data["flow_id"] = data.get("flow_id", str(uuid.uuid4()))
                            insert_op = {'type': 'insert_one', 'document': data}   
                            self._query_db('workflow_collection', insert_op,user_type= user_type.get("database_name"))
                        if not existing_agency_mapping:
                            insert_mapping_op = {'type': 'insert_one', 'document': mapping_doc}
                            self._query_db('workflow_agency_mapping_collection', insert_mapping_op,user_type= user_type.get("database_name"))
                            



            return self.get_by_id(data["flow_id"])
        except Exception as e:
            logging.error(f"Error creating workflow: {str(e)}")
            raise e

    def update(self, flow_id, data):
        try:
            existing = self.get_by_id(flow_id)
            if not existing:
                return None
            data["updated_at"] = datetime.utcnow()
            data["flow_id"] = flow_id
            
         
            agency_id = data.get("agency_name","")
            print("agency",agency_id)
            agency = self.agency_collection.find_one({"agency_id":agency_id},{"_id":0,"agency_name":1,"assigned_to":1})
            
            if agency:
                agency_name = agency.get("agency_name","")
                team=agency.get("assigned_to","")
                print("agg",agency_name)
            data["agency_name"] = agency_name
            data["team"]=team
           
            result = self.workflow_collection.update_one({"flow_id": flow_id}, {"$set": data})
            mapping_doc = {
                "agency_id": agency_id,
                "agency_name": agency_name,
               
                "flow_id": flow_id,
                "flow_name": data.get("flow_name", data.get("name", "")),
                "status": "inactive",
                "created_ts": datetime.utcnow(),
                "updated_ts": datetime.utcnow()
            }
            self.workflow_agency_mapping_collection.update_one({"flow_id": flow_id},{"$set":mapping_doc},upsert=True)
            
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
                    if pname and pname not in seen_projects:
                        project_names.append(pname)
                        seen_projects.add(pname)
            print("sss",seen_projects)           
            for seen_project in seen_projects:
                    user_type = self.project.find_one(
                        {"projectName": seen_project}, {"_id": 0, "database_name": 1})
                    
                    
                    if user_type:
                        find_op = {'type': 'find_one', 'filter': {'flow_id': flow_id}}
                        existing = self._query_db('workflow_collection', find_op,user_type= user_type.get("database_name"))
                        existing_agency_mapping = self._query_db('workflow_agency_mapping_collection', find_op,user_type= user_type.get("database_name"))
                        if existing:
                            data.pop("_id", None)
                            update_op = {'type': 'update_one', 'filter' : {'flow_id': flow_id}, 'update' : {'$set': data}}
                            self._query_db('workflow_collection', update_op,user_type= user_type.get("database_name"))
                        else:
                            insert_op = {'type': 'insert_one', 'document': data}
                            self._query_db('workflow_collection', insert_op,user_type= user_type.get("database_name"))
                            
                        if existing_agency_mapping:
                            mapping_doc.pop("_id", None)
                            print("data",mapping_doc)
                            
                            update_mapping_op = {'type': 'update_one', 'filter' : {'flow_id': flow_id}, 'update' : {'$set': mapping_doc}}
                            self._query_db('workflow_agency_mapping_collection', update_mapping_op,user_type= user_type.get("database_name"))
                        else:
                            
                            insert_mapping_op = {'type': 'insert_one', 'document': mapping_doc}
                            self._query_db('workflow_agency_mapping_collection', insert_mapping_op,user_type= user_type.get("database_name"))


                    # update_op_inactive = {
                        # 'type': 'update_many',
                        # 'filter': {'flow_id': flow_id},
                        # 'update': {'$set': {'status': 'inactive'}}
                    # }
                    # self._query_db('workflow_collection', update_op_inactive,user_type= user_type.get("database_name"))


            return self.get_by_id(flow_id)
        
        except Exception as e:
            logging.error(f"Error updating workflow {flow_id}: {str(e)}")
            return None


    def delete(self, flow_id):
        try:
            existing = self.get_by_id(flow_id)
            if not existing:
                return None
            
            data = self.workflow_collection.find_one({"flow_id": flow_id})
            result = self.workflow_collection.delete_one({"flow_id": flow_id})
            self.workflow_agency_mapping_collection.delete_one({"flow_id": flow_id})
            agency_name = data.get("agency_name","")
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
                    if pname and pname not in seen_projects:
                        project_names.append(pname)
                        seen_projects.add(pname)
            print("sss",seen_projects)           
            for seen_project in seen_projects:
                    user_type = self.project.find_one(
                        {"projectName": seen_project}, {"_id": 0, "database_name": 1})
                    
                    
                    if user_type:
                        find_op = {'type': 'find_one', 'filter': {'flow_id': flow_id}}
                        existing = self._query_db('workflow_collection', find_op,user_type= user_type.get("database_name"))
                        
                        if existing:
                            # update_op = {'type': 'update_one', 'filter' : {'flow_id': flow_id}, 'update' : {'status': 'inactive'}}
                            
                            delete_op = {'type': 'delete_one', 'filter' : {'flow_id': flow_id}}
                            
                            self._query_db('workflow_collection', delete_op,user_type= user_type.get("database_name"))
                            self._query_db('workflow_agency_mapping_collection', delete_op,user_type= user_type.get("database_name"))
                        
                        
            return {"message": f"Workflow '{flow_id}' deleted successfully"}
        except Exception as e:
            logging.error(f"Error deleting workflow {flow_id}: {str(e)}")
            return None


    # def create(self, data):
        # try:
            # data["flow_id"] = data.get("flow_id", str(uuid.uuid4()))
            # data["created_at"] = datetime.utcnow()
            # data["updated_at"] = datetime.utcnow()
            # result = self.workflow_collection.insert_one(data)
            # return self.get_by_id(data["flow_id"])
        # except Exception as e:
            # logging.error(f"Error creating workflow: {str(e)}")
            # raise e

    # def update(self, flow_id, data):
        # try:
            # existing = self.get_by_id(flow_id)
            # if not existing:
                # return None
            # data["updated_at"] = datetime.utcnow()
            # result = self.workflow_collection.update_one({"flow_id": flow_id}, {"$set": data})
            # return self.get_by_id(flow_id)
        # except Exception as e:
            # logging.error(f"Error updating workflow {flow_id}: {str(e)}")
            # return None

    # def delete(self, flow_id):
        # try:
            # existing = self.get_by_id(flow_id)
            # if not existing:
                # return None
            # result = self.workflow_collection.delete_one({"flow_id": flow_id})
            # return {"message": f"Workflow '{flow_id}' deleted successfully"}
        # except Exception as e:
            # logging.error(f"Error deleting workflow {flow_id}: {str(e)}")
            # return None


    def _get_client(self):
        if self.jira_client is None:
            if not all([self.jira_url, self.jira_user, self.jira_api_token]):
                raise ValueError("JIRA_URL, JIRA_USER and JIRA_API_TOKEN must be set in config.")
            try:
                self.jira_client = JIRA(
                    server=self.jira_url,
                    basic_auth=(self.jira_user, self.jira_api_token)
                )
                logging.info("Jira client created.")
            except Exception as e:
                logging.error(f"Jira connection failed: {e}")
                raise
        return self.jira_client

    # --------------------------------------------------------------------- #
    # PUBLIC – the only method you need
    # --------------------------------------------------------------------- #
    def extract_descriptions(self, response, field):
        try:
            if isinstance(response, str):
                clean_response = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', response)
                data = json.loads(clean_response)
            else:
                data = response
            data = self._clean_objectids(data)
            latest_issues = self.filter_latest_by_updated(json.dumps(data)) if isinstance(data, (list, dict)) else []
            issue_data = []
            for issue in latest_issues:
                desc = issue.get(field) or issue.get('summary')
                key = issue.get('key', '')
                updated = issue.get('updated', '')
                if desc and key or updated:
                    entry = {"key": key, "description": desc, "updated": updated}
                    clean_entry = self._clean_objectids(entry)
                    self.workflow_tracking_collection.insert_one(clean_entry)
                    issue_data.append(entry)
            print(f"extract_descriptions → returning {len(issue_data)} latest issue(s)")
            return issue_data
        except Exception as e:
            print(f"[ERROR] extract_descriptions: {e}")
            return []

    def _extract_robust_json_array(self, text):
        if not text or not isinstance(text, str):
            return []

        # Clean invisible chars
        text = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', text.strip())

        # === STRATEGY 1: Find largest valid JSON array blocks ===
        arrays = re.finditer(r'\[[\s\S]*?\]', text)
        candidates = []
        for m in arrays:
            candidates.append((m.end() - m.start(), m.group(0), m.start()))  # (length, content, position)

        # CRITICAL FIX: Sort by length desc, then position desc (not string!)
        candidates.sort(key=lambda x: (-x[0], -x[2]))  # ← FIXED LINE

        for size, candidate, pos in candidates:
            c = candidate

            # Fix common JSON issues
            c = re.sub(r',\s*]', ']', c)
            c = re.sub(r',\s*}', '}', c)
            c = re.sub(r'}\s*{', '},{', c)
            c = re.sub(r'"\s+"', '","', c)

            # Escape unescaped newlines inside strings
            escaped = []
            in_string = False
            i = 0
            while i < len(c):
                char = c[i]
                if char == '"' and (i == 0 or c[i-1] != '\\'):
                    in_string = not in_string
                if char in '\n\r' and in_string:
                    escaped.append('\\n')
                    i += 1
                    continue
                escaped.append(char)
                i += 1
            c = ''.join(escaped)

            # Balance brackets
            open_b = c.count('{')
            close_b = c.count('}')
            if open_b > close_b:
                c += '}' * (open_b - close_b)
            if c.count('[') > c.count(']'):
                c += ']' * (c.count('[') - c.count(']'))

            try:
                parsed = json.loads(c)
                if isinstance(parsed, list) and parsed:
                    print(f"SUCCESS: Extracted {len(parsed)} issue(s) via robust parser")
                    return parsed
            except Exception:
                continue

        # === NUCLEAR RECONSTRUCTION (if all else fails) ===
        print("Trying nuclear JSON reconstruction...")
        keys = re.findall(r'"key"\s*:\s*"([A-Z]{1,20}-\d+)"', text, re.IGNORECASE)
        if keys:
            rebuilt = []
            seen = set()
            for key in keys[:10]:
                if key in seen:
                    continue
                seen.add(key)
                summary = re.search(rf'"{key}".*?"summary"\s*:\s*"([^"]+)"', text, re.IGNORECASE | re.DOTALL)
                summary = summary.group(1) if summary else key
                desc_match = re.search(rf'"{key}"[\s\S]*?"description"\s*:\s*"([^"]*(?:\\.[^"]*)*)"', text, re.IGNORECASE)
                description = desc_match.group(1).replace('\\"', '"') if desc_match else "No description"
                rebuilt.append({"key": key, "summary": summary, "description": description})
            if rebuilt:
                print(f"NUCLEAR SUCCESS: Reconstructed {len(rebuilt)} issue(s)")
                return rebuilt

        print("ALL JSON EXTRACTION FAILED — returning empty list")
        return []

    def filter_latest_by_updated(self, response):
        if not response or not isinstance(response, str):
            return []
        try:
            clean = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', response.strip())
            issues = self._extract_robust_json_array(clean)
            if not issues:
                return []

            parsed = []
            for issue in issues:
                ts = (
                    issue.get("updated") or
                    issue.get("fields", {}).get("updated") or
                    issue.get("created") or
                    issue.get("fields", {}).get("created") or
                    ""
                )
                if not ts:
                    continue
                try:
                    ts_clean = re.sub(r'\.\d{3}\d*', '.000', ts)
                    ts_clean = ts_clean.replace('Z', '+00:00')
                    dt = datetime.fromisoformat(ts_clean)
                except:
                    try:
                        ts_clean = re.sub(r'\..*', '', ts)
                        ts_clean = re.sub(r'[+-]\d{4}$', '', ts_clean)
                        dt = datetime.fromisoformat(ts_clean + "+00:00")
                    except:
                        continue
                parsed.append((issue, dt))

            if not parsed:
                return [issues[0]] if issues else []

            max_dt = max(dt for _, dt in parsed)
            latest = [issue for issue, dt in parsed if dt == max_dt]
            print(f"Found {len(latest)} latest issue(s) at {max_dt.isoformat()}")
            return latest
        except Exception as e:
            print(f"[ERROR] filter_latest_by_updated: {e}")
            return []

    def call_lyzr_agent(self, params, session_id=None,user_id=None):
        config = params['config']
        headers = {"Content-Type": "application/json", "x-api-key": config['api_key']}
        effective_session_id = session_id if session_id is not None else config.get('session_id')
        effective_user_id = user_id
        print("effective_session_id",effective_session_id)
        payload = {
            "user_id": effective_user_id,
            "agent_id": config['api_agent_id'],
            "session_id": effective_session_id,
            "message": params['user_message']['value']
        }
        if params.get('assets'):
            payload['assets'] = params['assets']
        try:
            response = requests.post(config['api_url'], headers=headers, json=payload, timeout=300)
            if response.status_code == 200:
                return response.json().get('response', '')
            return f"Error {response.status_code}: {response.text}"
        except Exception as e:
            return f"Request failed: {str(e)}"
        
    def _save_agent_response(self, workflow_id, event_id, task_idx, agent_id, agent_name, prompt, response,session_id=None,user_id=None,username=None):
        doc = {
            "workflow_id": workflow_id,
            "event_id": event_id,
            "task_index": task_idx,
            "agent_id": agent_id,
            "agent_name": agent_name,
            "prompt": prompt,
            "status": "completed",
            "response": str(response),
            "session_id": session_id or str(uuid.uuid4()),  
            "user_id": user_id,
            "username": username,
            "timestamp": CommonUtils.get_current_timestamp(),
            "saved_at": datetime.now(timezone.utc)
        }
        try:
            self.workflow_response_collection.insert_one(doc)
            print(f" Saved agent response: {agent_name} (idx={task_idx})")
            # -------------------------
            # 🔥 REAL-TIME UPDATE
            # -------------------------
            stream_channel = f"workflow*{workflow_id}_{event_id}"
            print("eee",stream_channel)
            self.socketio.emit(
                stream_channel,
                {
                    "workflow_id": workflow_id,
                    "event_id": event_id,
                    "task_index": task_idx,
                    "agent_name": agent_name,
                    "response": str(response),
                    "agent_id":agent_id,
                    "user_id": user_id,
                    "username": username,
                  
                    "status": "completed"
                }
            )
            print(f" Saved emitted")
        except Exception as e:
            print(f" Failed to save agent response: {e}")
            

    def _markdown_to_adf(self, markdown_text):
        if not markdown_text:
            return {"version": 1, "type": "doc", "content": []}
        lines = [line.strip() for line in markdown_text.split('\n') if line.strip()]
        content = []
        for line in lines:
            if line.startswith('### '):
                content.append({"type": "heading", "attrs": {"level": 3}, "content": [{"type": "text", "text": line[4:]}]})
            elif line.startswith('## '):
                content.append({"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": line[3:]}]})
            elif line.startswith('# '):
                content.append({"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": line[2:]}]})
            elif '**' in line:
                parts = re.split(r'\*\*(.*?)\*\*', line)
                nodes = []
                for i, p in enumerate(parts):
                    if i % 2 == 1:
                        nodes.append({"type": "text", "text": p, "marks": [{"type": "strong"}]})
                    elif p:
                        nodes.append({"type": "text", "text": p})
                if nodes:
                    content.append({"type": "paragraph", "content": nodes})
            elif line.startswith(('- ', '* ')):
                if not content or content[-1]["type"] != "bulletList":
                    content.append({"type": "bulletList", "content": []})
                content[-1]["content"].append({
                    "type": "listItem",
                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": line[2:].strip()}]}]
                })
            else:
                content.append({"type": "paragraph", "content": [{"type": "text", "text": line}]})
        return {"version": 1, "type": "doc", "content": content}

    def _clean_objectids(self, data):
        if isinstance(data, list):
            return [self._clean_objectids(item) for item in data]
        elif isinstance(data, dict):
            return {k: str(v) if isinstance(v, ObjectId) else self._clean_objectids(v) if isinstance(v, (dict, list)) else v for k, v in data.items()}
        else:
            return data

    def _keep_original_markdown(self, items):
        originals = []
        for itm in items:
            if isinstance(itm, str):
                originals.append(itm)
            else:
                originals.append(itm.get("description", "").strip())
        return [o for o in originals if o]

    def _bulk_push_to_jira(
        self, task, current_input, workflow_id, event_id, idx,
        agent_id, agent_name, save_response=False,
        session_id=None, user_id=None, username=None
    ):
        try:
            raw = str(current_input).strip()
            project_key = self.jira_project_key
            created_keys = []
            original_markdowns = []

            # ================================
            # 1. Parse input into list of issues
            # ================================
            items = []
            if raw.startswith('['):
                try:
                    items = json.loads(raw)
                except:
                    pass
            elif raw.startswith('{'):
                try:
                    obj = json.loads(raw)
                    items = obj.get("items", []) or obj.get("issues", [])
                except:
                    pass
            if not items:
                items = [{"description": raw}]

            original_markdowns = self._keep_original_markdown(items)
            issues_to_create = []

            for itm in items:
                if isinstance(itm, str):
                    itm = {"description": itm}
                description = itm.get("description", "").strip()
                if not description:
                    continue

                summary = (itm.get("name") or itm.get("summary") or itm.get("title"))
                if not summary:
                    first_line = description.split("\n", 1)[0]
                    summary = first_line.strip()[:255]
                summary = re.sub(r'^#+|\*+', '', summary).strip()
                summary = re.sub(r'^(EPIC|STORY|BUG)[:\s]*', '', summary, flags=re.I).strip()
                if not summary:
                    summary = "Untitled Issue"

                text = (summary + " " + description).lower()
                if any(k in text for k in ["test case", "testcase", "test-case", "test:"]):
                    issuetype = "Test Case"
                elif any(k in text for k in ["bug", "defect", "fix"]):
                    issuetype = "Bug"
                elif any(k in text for k in ["story", "as a ", "i want", "so that"]):
                    issuetype = "Story"
                elif any(k in text for k in ["epic", "epic:"]):
                    issuetype = "Epic"
                else:
                    issuetype = "Task"

                payload = {
                    "fields": {
                        "project": {"key": project_key},
                        "summary": summary,
                        "issuetype": {"name": issuetype},
                    }
                }
                if description:
                    payload["fields"]["description"] = self._markdown_to_adf(description)

                # Clean empty fields
                fields = {k: v for k, v in payload["fields"].items() if v not in ["", None, {}, [], "null", "{}", "[]"]}
                payload["fields"] = fields

                issues_to_create.append(payload)

            if not issues_to_create:
                return "No valid issues to push.", [], original_markdowns, original_markdowns[0] if original_markdowns else ""

            print(f"Pushing {len(issues_to_create)} issue(s) one by one ...")

            # ================================
            # 2. SEND ONE BY ONE (Fix for Lyzr bug)
            # ================================
            for seq_idx, single_payload in enumerate(issues_to_create):
                print(f"  → Pushing issue {seq_idx + 1}/{len(issues_to_create)}: {single_payload['fields'].get('summary', '')[:80]}")

                lyzr_params = {
                    'config': task['params']['config'].copy(),
                    'user_message': {'value': json.dumps(single_payload)}  # ← Critical: single object, no "issueUpdates"
                }
                if task['params'].get('assets'):
                    lyzr_params['assets'] = task['params']['assets']

                push_session_id = str(uuid.uuid4())
                resp = self.call_lyzr_agent(lyzr_params, session_id=push_session_id,user_id=user_id)

                print(f"\n{'='*60}")
                print(f"SINGLE PUSH RESPONSE {seq_idx + 1}")
                print(f"Summary: {single_payload['fields'].get('summary', 'N/A')[:100]}")
                print(f"Response: {repr(resp)[:3000]}")
                if len(str(resp)) > 3000:
                    print("... [truncated]")
                print(f"{'='*60}\n")

                # Save each push attempt
                self._save_agent_response(
                    workflow_id, event_id, seq_idx, agent_id, agent_name,
                    json.dumps(single_payload), resp,
                    session_id=push_session_id, user_id=user_id, username=username
                )

                # Extract created key
                resp_text = str(resp)
                keys = re.findall(r'\b([A-Z]{1,20}-\d+)\b', resp_text)
                if keys:
                    key = keys[0]
                    created_keys.append(key)
                    print(f"   SUCCESS: Created {key}")
                else:
                    print(f"   WARNING: No key found in response")

            # ================================
            # 3. Build final output
            # ================================
            if created_keys:
                main_key = created_keys[0]
                new_current = f"Created {len(created_keys)} issue(s): {', '.join(created_keys[:5])}{'...' if len(created_keys)>5 else ''}\n\nMain: https://csscorp.atlassian.net/browse/{main_key}"
                primary_result = original_markdowns[0] if original_markdowns else new_current
                print(f"FINAL: Created {len(created_keys)} issues → Showing original content in UI")
            else:
                new_current = "Push completed, but no keys were detected."
                primary_result = original_markdowns[0] if original_markdowns else new_current
                print("FINAL: No keys extracted → falling back")

            # ================================
            # 4. Save final result (only if requested)
            # ================================
            if save_response and created_keys:
                save_key = created_keys[0]
                try:
                    self.workflow_response_collection.insert_one({
                        "workflow_id": workflow_id,
                        "event_id": event_id,
                        "key": save_key,
                        "response": primary_result,
                        "session_id": session_id,
                        "user_id": user_id,
                        "username": username,
                        "timestamp": CommonUtils.get_current_timestamp(),
                        "saved_at": datetime.utcnow(),
                        "status": "completed"
                    })
                    print(f"Saved final workflow response → Key: {save_key} | Session: {session_id[-8:] if session_id else 'N/A'}")
                except Exception as e:
                    print(f"Failed to save final response: {e}")

            return new_current, created_keys, original_markdowns, primary_result

        except Exception as e:
            err = f"Push to Jira failed: {e}"
            print(err)
            import traceback
            traceback.print_exc()
            self._save_agent_response(workflow_id, event_id, idx, agent_id, agent_name, "Failed", err)
            return err, [], [], ""
        
    def _wrap_result(self, issue_key: str, result: str):
        if not issue_key:
            # Try to extract a title from the first line of the result
            lines = result.split('\n')
            title = "Untitled"
            
            # Look for markdown headings first
            for line in lines:
                line = line.strip()
                if line.startswith('# '):
                    title = line[2:].strip()
                    break
                elif line.startswith('## '):
                    title = line[3:].strip()
                    break
                elif line.startswith('### '):
                    title = line[4:].strip()
                    break
            
            # If no markdown heading found, use the first non-empty line
            if title == "Untitled" and lines:
                for line in lines:
                    if line.strip():
                        title = line.strip()[:50]  # Limit to 50 characters
                        break
            
            # If still no title, use a default
            if title == "Untitled":
                title = "Workflow Result"
                
            issue_key = title
        
        return {"results": [{"issue_key": issue_key, "result": str(result)}]}
    
    def _extract_text_from_adf(self, adf):
        if not adf or not isinstance(adf, dict):
            return ""
        texts = []
        def extract(node):
            if node.get("type") == "text":
                texts.append(node.get("text", ""))
            elif node.get("content"):
                for child in node.get("content", []):
                    extract(child)
        extract(adf)
        return " ".join(texts).strip()
    
    def _run_conditional_from_task(self, start_task_name, initial_input, tasks, **kwargs):
        """Generic conditional runner – no hard-coded agent names!"""
        event_id = kwargs.get("event_id")
        workflow_id = kwargs.get("workflow_id")
        session_id = kwargs.get("session_id")
        user_id = kwargs.get("user_id")
        username = kwargs.get("username")

        name_to_task = {t.get("name"): t for t in tasks if t.get("name")}
        current_task_name = start_task_name
        current_input = initial_input
        extracted_issue_key = None
        visited = set()

        while current_task_name and current_task_name not in visited:
            visited.add(current_task_name)
            task = name_to_task.get(current_task_name)
            if not task:
                break

            agent_name = task["params"]["config"].get("agent_name", "Unknown").lower()

            # =========================================================
            # 1. Normal agent execution
            # =========================================================
            if task.get("function") == "call_lyzr_agent":
                prompt = task.get("user_input", "").strip()
                message = f"{prompt}\n\n{current_input}" if prompt else current_input

                response,agent_session_id = self._execute_single_agent_task(task, message, session_id=session_id,user_id=user_id)
                self._save_agent_response(
                    workflow_id=workflow_id,
                    event_id=event_id,
                    task_idx=None,
                    agent_id=task["params"]["config"].get("agent_id"),
                    agent_name=agent_name,
                    prompt=message,
                    response=response,
                    session_id=agent_session_id,
                    user_id=user_id,
                    username=username
                )

                # Jira Connector → extract description
                if "jira connector" in agent_name:
                    try:
                        latest_issues = self.filter_latest_by_updated(response)
                        field = task.get("user_input", "description").strip() or "description"
                        extracted = self.extract_descriptions(latest_issues, field)
                        if extracted:
                            extracted_issue_key = extracted[0]["key"]
                            current_input = extracted[0]["description"]
                    except Exception as e:
                        print(f"Jira extract failed: {e}")
                        current_input = response

                # Push to Jira → final step
                elif "push to jira" in agent_name:
                    new_cur, keys, _, primary = self._bulk_push_to_jira(
                        task, current_input, workflow_id, event_id, None,
                        task["params"]["config"].get("api_agent_id"),
                        agent_name, save_response=True,
                        session_id=session_id, user_id=user_id, username=username
                    )
                    current_input = primary
                    if keys:
                        extracted_issue_key = keys[0]
                    break  # end after push

                else:
                    current_input = response

            # =========================================================
            # 2. CONDITION NODE – fully generic matching
            # =========================================================
            elif task.get("function") == "condition":
                condition_text = task.get("user_input", "").lower().strip()
                candidates = task.get("call_next") or task.get("nextcall") or []
                candidates = candidates if isinstance(candidates, list) else [candidates]

                chosen_next = None

                # Extract meaningful words from condition (ignore very short/common words)
                condition_words = [w for w in condition_text.split() if len(w) > 3]

                for candidate_name in candidates:
                    candidate_task = name_to_task.get(candidate_name)
                    if not candidate_task:
                        continue

                    target_agent_name = candidate_task["params"]["config"].get("agent_name", "").lower()

                    # Match if ANY meaningful word from condition appears in target agent name
                    if any(word in target_agent_name for word in condition_words):
                        chosen_next = candidate_name
                        print(f"CONDITION MATCH → '{condition_text}' → choosing '{target_agent_name}'")
                        break
                    

                # Fallback to first candidate if no match
                if not chosen_next and candidates:
                    chosen_next = candidates[0]
                    fallback_agent = name_to_task[chosen_next]["params"]["config"].get("agent_name", "Unknown")
                    print(f"No condition match → defaulting to '{fallback_agent}'")

                current_task_name = chosen_next
                continue  # skip normal nextcall logic

            # =========================================================
            # 3. Normal nextcall (non-condition nodes)
            # =========================================================
            nextcall = task.get("call_next") or task.get("nextcall")
            if isinstance(nextcall, list):
                current_task_name = nextcall[0] if nextcall else None
            else:
                current_task_name = nextcall

        return self._wrap_result(extracted_issue_key, current_input)
    
    def workflow_run_agent_details(self, data):
        # run the heavy work in a real thread
        threading.Thread(
            target=self._run_workflow,
            args=(data,),
            daemon=True
        ).start()
    
    def _run_workflow(self, data):
        try:
            workflow_id = data.get('workflow_id', '').strip()
            query = data.get('query', '').strip()
            event = data.get('event_id', '').strip()
            user_payload = data.get('user') or data.get('current_user') or {}
            

            # === USER IDENTIFICATION (unchanged) ===
            if user_payload:
                user_id = user_payload.get('email') or user_payload.get('Email')
                username = user_payload.get('username') or user_payload.get('UserName')
            else:
                user_id = request.headers.get('X-User-ID')
                username = request.headers.get('X-Username')
                if not user_id:
                    current_user = get_current_user()
                    if current_user:
                        user_id = current_user.get('user_id') or current_user.get('id')
                        username = current_user.get('username') or current_user.get('email') or current_user.get('name') or "Unknown User"
                    else:
                        user_id = None
                        username = "Anonymous User"
            if not username or username == "Unknown User":
                username = "Anonymous User"

            session_id = str(uuid.uuid4())
            print(f"Workflow Run | Session: {session_id[-8:]} | User: {username} ({user_id}) | Flow: {workflow_id}")

            workflow = self.workflow_collection.find_one({"flow_id": workflow_id})
            if not workflow:
                return {"error": "Workflow not found"}

            flow_data = workflow['flow_data']
            tasks = flow_data.get('tasks', [])
            if not tasks:
                return {"error": "No tasks in workflow"}

            # === BUILD GRAPH HELPERS ===
            name_to_task = {}
            outgoing = {}
            incoming_count = {}

            for task in tasks:
                time.sleep(1)
                name = task.get("name")
                if not name:
                    continue
                name_to_task[name] = task
                outgoing[name] = []
                incoming_count[name] = 0

                nextcall = task.get("call_next") or task.get("nextcall")
                if isinstance(nextcall, (str, list)):
                    targets = nextcall if isinstance(nextcall, list) else [nextcall]
                    for t in targets:
                        if t and t in name_to_task:
                            outgoing[name].append(t)
                            incoming_count[t] = incoming_count.get(t, 0) + 1

            # Find root nodes (no incoming edges)
            roots = [name for name, count in incoming_count.items() if count == 0]
            if not roots:
                roots = list(name_to_task.keys())[:1]  # fallback

            # === DETECT WORKFLOW TYPE ===
            has_iterative = any(
                "iterative" in task.get("name", "").lower()
                for task in tasks
            )
            has_conditional = any(
                "condition" in task.get("name", "").lower()
                for task in tasks
            )

            print(f"Workflow Type → Iterative: {has_iterative} | Conditional: {has_conditional}")

            # === HYBRID: Both Iterative & Conditional ===
            if has_iterative and has_conditional:
                print("Running HYBRID WORKFLOW: Iterative → Conditional")
                
                # Find the first condition task
                first_condition_task = None
                for idx, task in enumerate(tasks):
                    if task.get("function") == "condition":
                        first_condition_task = task
                        first_condition_index = idx
                        break

                if not first_condition_task:
                    # Fallback to pure iterative (shouldn't happen)
                    res = self._run_iterative_workflow(tasks, query, event, workflow_id, session_id, user_id, username)
                    summary = res.get("summary", {})
                    final_key = summary.get("final_key")
                    final_content = summary.get("final_content", "Done")
                else:
                    # Split: Run iterative part
                    iterative_tasks = tasks[:first_condition_index]
                    iterative_result = self._run_iterative_workflow(
                        tasks=iterative_tasks,
                        initial_input=query,
                        event_id=event,
                        workflow_id=workflow_id,
                        session_id=session_id,
                        user_id=user_id,
                        username=username
                    )
                    summary = iterative_result.get("summary", {})
                    intermediate_output = summary.get("final_content", query)

                    # Now run conditional part
                    start_task_name = first_condition_task.get("name")
                    conditional_result = self._run_conditional_from_task(
                        start_task_name=start_task_name,
                        initial_input=intermediate_output,
                        tasks=tasks,
                        event_id=event,
                        workflow_id=workflow_id,
                        session_id=session_id,
                        user_id=user_id,
                        username=username
                    )

                    # Extract final key & content from conditional result
                    if isinstance(conditional_result, dict) and "results" in conditional_result and conditional_result["results"]:
                        result_item = conditional_result["results"][0]
                        final_key = result_item.get("issue_key")
                        final_content = result_item.get("result")
                    else:
                        final_key = summary.get("final_key")
                        final_content = str(conditional_result)

                # === ONLY SAVE ONCE — FINAL RESULT ONLY ===
                try:
                    self.workflow_response_collection.insert_one({
                        "workflow_id": workflow_id,
                        "event_id": event,
                        "key": final_key,
                        "response": final_content,
                        "session_id": session_id,
                        "user_id": user_id,
                        "username": username,
                        "timestamp": CommonUtils.get_current_timestamp(),
                        "saved_at": datetime.utcnow(),
                        "status": "completed"
                    })
                    print(f"Saved FINAL workflow response (hybrid) → Key: {final_key} | Session: {session_id[-8:]}")
                except Exception as e:
                    print(f"Failed to save final hybrid response: {e}")

                return self._wrap_result(final_key, final_content)

            # === Pure Iterative ===
            elif has_iterative:
                print("Running PURE ITERATIVE workflow")
                res = self._run_iterative_workflow(tasks, query, event, workflow_id, session_id, user_id, username)
                summary = res.get("summary", {})
                final_key = summary.get("final_key")
                final_content = summary.get("final_content", "Done")

                # === SAVE FINAL RESPONSE ONLY HERE (ONCE) ===
                try:
                    self.workflow_response_collection.insert_one({
                        "workflow_id": workflow_id,
                        "event_id": event,
                        "key": final_key,
                        "response": final_content,
                        "session_id": session_id,
                        "user_id": user_id,
                        "username": username,
                        "timestamp": CommonUtils.get_current_timestamp(),
                        "saved_at": datetime.utcnow(),
                        "status": "completed"
                    })
                    print(f"Saved FINAL workflow response (pure iterative) → Key: {final_key} | Session: {session_id[-8:]}")
                except Exception as e:
                    print(f"Failed to save final iterative response: {e}")

                return self._wrap_result(final_key, final_content)

            # === Pure Conditional ===
            elif has_conditional:
                print("Running PURE CONDITIONAL workflow")
                return self._run_conditional_workflow(
                    tasks=tasks,
                    initial_input=query,
                    event_id=event,
                    workflow_id=workflow_id,
                    session_id=session_id,
                    user_id=user_id,
                    username=username
                )

            # === Fallback: Sequential Agent Chain ===
            else:
                print("Running SEQUENTIAL agent chain")
                current_input = query
                extracted_issue_key = None
                for idx, task in enumerate(tasks):
                    if task.get('function') != 'call_lyzr_agent':
                        continue
                    prompt = task.get('user_input', '').strip()
                    config = task['params']['config']
                    agent_name = config.get('agent_name', 'Unknown Agent').strip()
                    agent_id = config.get('api_agent_id', '')
                    message = f"{prompt}\n\n{current_input}" if prompt else current_input

                    response,agent_session_id = self._execute_single_agent_task(task, message,session_id=session_id,user_id=user_id)

                    self._save_agent_response(
                        workflow_id=workflow_id,
                        event_id=event,
                        task_idx=idx,
                        agent_id=agent_id,
                        agent_name=agent_name,
                        prompt=message,
                        response=response,
                        session_id=agent_session_id,
                        user_id=user_id,
                        username=username
                    )

                    if "jira" in agent_name.lower() and "connector" in agent_name.lower():
                        try:
                            latest_issues = self.filter_latest_by_updated(response)
                            field_to_extract = task.get('user_input', 'description').strip() or 'description'
                            clean_issues = self._clean_objectids(latest_issues)
                            extracted_issues = self.extract_descriptions(clean_issues, field_to_extract)
                            if extracted_issues:
                                extracted_issue_key = extracted_issues[0]['key']
                                current_input = extracted_issues[0]['description'] or "No description found."
                        except Exception as e:
                            print(f"Jira extract failed: {e}")
                            current_input = response
                    elif "push to jira" in agent_name.lower():
                        new_current, created_keys, _, primary_result = self._bulk_push_to_jira(
                            task, current_input, workflow_id, event, idx,
                            agent_id, agent_name, save_response=True,
                            session_id=session_id, user_id=user_id, username=username
                        )
                        current_input = primary_result
                        if created_keys:
                            extracted_issue_key = created_keys[0]
                    else:
                        current_input = response
                        
                # Extract a title from the final response if no Jira key is available
                if not extracted_issue_key and current_input:
                    # Try to extract a title from the first line of the response
                    lines = current_input.split('\n')
                    for line in lines:
                        line = line.strip()
                        if line.startswith('# ') or line.startswith('## ') or line.startswith('### '):
                            extracted_issue_key = line.lstrip('#').strip()
                            break
                    
                    # If no markdown heading found, use the first non-empty line
                    if not extracted_issue_key and lines:
                        for line in lines:
                            if line.strip():
                                extracted_issue_key = line.strip()[:50]  # Limit to 50 characters
                                break
                
                # If still no title, use a default
                if not extracted_issue_key:
                    extracted_issue_key = "Response"
                
                # === SAVE FINAL RESPONSE FOR SEQUENTIAL WORKFLOW ===
                try:
                    self.workflow_response_collection.insert_one({
                        "workflow_id": workflow_id,
                        "event_id": event,
                        "key": extracted_issue_key,
                        "response": current_input,
                        "session_id": session_id,
                        "user_id": user_id,
                        "username": username,
                        "timestamp": CommonUtils.get_current_timestamp(),
                        "saved_at": datetime.utcnow(),
                        "status": "completed"
                    })
                    print(f"Saved final workflow response for sequential workflow | Session: {session_id[-8:] if session_id else 'N/A'}")
                except Exception as e:
                    print(f"Failed to save final response for sequential workflow: {e}")

                return self._wrap_result(extracted_issue_key, current_input)

        except Exception as e:
            logging.error("Error in workflow_run_agent_details:", exc_info=True)
            return {"error": str(e)}
        
    def _run_conditional_workflow_old(self, tasks, initial_input, event_id, workflow_id, session_id=None,
                            user_id=None, username=None):
        if not tasks:
            return self._wrap_result(None, initial_input)

        current_input = initial_input
        extracted_issue_key = None

        name_to_task = {task.get("name"): task for task in tasks if task.get("name")}

        # Find start task
        pointed_to = set()
        for task in tasks:
            cn = task.get("call_next") or task.get("nextcall")
            if cn:
                if isinstance(cn, list):
                    pointed_to.update(cn)
                elif isinstance(cn, str):
                    pointed_to.add(cn.strip())

        start_task = next((t for t in tasks if t.get("name") and t.get("name") not in pointed_to), tasks[0])
        current_task_name = start_task.get("name")
        print(f"Workflow START → {current_task_name} | {start_task['params']['config'].get('agent_name', 'Unknown')}")

        visited = set()

        # === CHECK IF WORKFLOW HAS PUSH TO JIRA TASKS ===
        has_push_to_jira = any(
            task.get('function') == 'call_lyzr_agent' and 
            'push to jira' in task['params']['config'].get('agent_name', '').lower()
            for task in tasks
        )
        print(f"Workflow has Push to Jira tasks: {has_push_to_jira}")

        while current_task_name and current_task_name not in visited:
            visited.add(current_task_name)
            task = name_to_task.get(current_task_name)
            if not task:
                break

            agent_name = task["params"]["config"].get("agent_name", "Unknown Agent")
            print(f"Executing → {current_task_name} | {agent_name}")

            # === 1. AGENT EXECUTION ===
            if task.get("function") == "call_lyzr_agent":
                config = task["params"]["config"]
                agent_id = config.get("agent_id", "")
                prompt = task.get("user_input", "").strip()
                message = f"{prompt}\n\n{current_input}" if prompt else current_input

                response,agent_session_id = self._execute_single_agent_task(task, message,session_id=session_id,user_id=user_id)
                self._save_agent_response(workflow_id, event_id, None, agent_id, agent_name, message, response,
                                        session_id=agent_session_id ,
                                        user_id=user_id,
                                        username=username)

                if "jira" in agent_name.lower() and "connector" in agent_name.lower():
                    try:
                        latest_issues = self.filter_latest_by_updated(response)
                        field = task.get("user_input", "description").strip() or "description"
                        clean = self._clean_objectids(latest_issues)
                        extracted = self.extract_descriptions(clean, field)
                        if extracted:
                            extracted_issue_key = extracted[0]["key"]
                            current_input = extracted[0]["description"]
                            print(f"Jira Connector → Extracted: {extracted_issue_key}")
                        else:
                            current_input = response
                    except Exception as e:
                        print(f"Jira extract failed: {e}")
                        current_input = response

                elif "push to jira" in agent_name.lower():
                    print("FINAL STEP → Pushing to Jira...")
                    new_cur, keys, _, primary = self._bulk_push_to_jira(
                        task, current_input, workflow_id, event_id, None,
                        agent_id, agent_name, save_response=True,
                        session_id=session_id,
                        user_id=user_id,
                        username=username
                    )
                    extracted_issue_key = keys[0] if keys else extracted_issue_key
                    current_input = primary or new_cur
                    print(f"Workflow COMPLETED → Issue Created: {extracted_issue_key or 'None'}")
                    break

                else:
                    current_input = response

            # === 2. CONDITION — PERFECT KEYWORD MATCHING ===
            elif task.get("function") == "condition":
                query = task.get("user_input", "").lower().strip()
                query_words = {w.strip(".,!?") for w in query.split() if len(w.strip(".,!?")) >= 2}

                call_next = task.get("call_next") or task.get("nextcall", [])
                if isinstance(call_next, str):
                    call_next = [call_next]
                if not call_next:
                    break

                chosen_task_name = None

                for target_name in call_next:
                    target_task = name_to_task.get(target_name)
                    if not target_task:
                        continue
                    agent_name_full = target_task["params"]["config"].get("agent_name", "")
                    agent_words = {w.strip(".,!?") for w in agent_name_full.lower().split() if len(w.strip(".,!?")) >= 2}

                    if agent_words & query_words:
                        chosen_task_name = target_name
                        print(f"CONDITION MATCH → '{agent_name_full}' (matched: {agent_words & query_words})")
                        break

                if not chosen_task_name:
                    # NEW: Enhanced fallback logic for conditional workflows
                    # If no direct match, try to find a task with similar functionality
                    for target_name in call_next:
                        target_task = name_to_task.get(target_name)
                        if not target_task:
                            continue
                        target_agent_name = target_task["params"]["config"].get("agent_name", "").lower()
                        
                        # Check if any word from the condition is in the target agent name
                        for word in query_words:
                            if word in target_agent_name:
                                chosen_task_name = target_name
                                print(f"PARTIAL CONDITION MATCH → '{target_agent_name}' (matched word: {word})")
                                break
                        
                        if chosen_task_name:
                            break
                    
                    # If still no match, use the first candidate
                    if not chosen_task_name:
                        chosen_task_name = call_next[0]
                        fb_name = name_to_task.get(chosen_task_name, {}).get("params", {}).get("config", {}).get("agent_name", "Unknown")
                        print(f"No condition match → Fallback to: {fb_name}")

                current_task_name = chosen_task_name
                continue

            # === 3. NORMAL FLOW — FIXED, NO MORE SYNTAX ERROR ===
            call_next = task.get("call_next") or task.get("nextcall")

            if not call_next:
                print(f"Task {current_task_name} has no call_next → ending flow")
                break

            if isinstance(call_next, list):
                if not call_next:
                    print(f"Task {current_task_name} has empty call_next list → ending")
                    break
                current_task_name = call_next[0]
            else:
                stripped = call_next.strip()
                if not stripped:
                    break
                current_task_name = stripped
                
        # Extract a title from the final response if no Jira key is available
        if not extracted_issue_key and current_input:
            # Try to extract a title from the first line of the response
            lines = current_input.split('\n')
            for line in lines:
                line = line.strip()
                if line.startswith('# ') or line.startswith('## ') or line.startswith('### '):
                    extracted_issue_key = line.lstrip('#').strip()
                    break
            
            # If no markdown heading found, use the first non-empty line
            if not extracted_issue_key and lines:
                for line in lines:
                    if line.strip():
                        extracted_issue_key = line.strip()[:50]  # Limit to 50 characters
                        break
        
        # If still no title, use a default
        if not extracted_issue_key:
            extracted_issue_key = "Response"

        # === SAVE FINAL RESPONSE FOR NON-PUSH WORKFLOWS ===
        if not has_push_to_jira:
            try:
                self.workflow_response_collection.insert_one({
                    "workflow_id": workflow_id,
                    "event_id": event_id,
                    "key": extracted_issue_key,
                    "response": current_input,
                    "session_id": session_id,
                    "user_id": user_id,
                    "username": username,
                    "timestamp": CommonUtils.get_current_timestamp(),
                    "saved_at": datetime.utcnow(),
                    "status": "completed"
                })
                print(f"Saved final workflow response for non-Push conditional workflow | Session: {session_id[-8:] if session_id else 'N/A'}")
            except Exception as e:
                print(f"Failed to save final response for non-Push conditional workflow: {e}")

        return self._wrap_result(extracted_issue_key, current_input)

    def _run_conditional_workflow(self, tasks, initial_input, event_id, workflow_id, session_id=None,
                            user_id=None, username=None):
        if not tasks:
            return self._wrap_result(None, initial_input)
 
        current_input = initial_input
        extracted_issue_key = None
 
        name_to_task = {task.get("name"): task for task in tasks if task.get("name")}
 
        # Find start task
        pointed_to = set()
        for task in tasks:
            cn = task.get("call_next") or task.get("nextcall")
            if cn:
                if isinstance(cn, list):
                    pointed_to.update(cn)
                elif isinstance(cn, str):
                    pointed_to.add(cn.strip())
 
        start_task = next((t for t in tasks if t.get("name") and t.get("name") not in pointed_to), tasks[0])
        current_task_name = start_task.get("name")
        print(f"Workflow START → {current_task_name} | {start_task['params']['config'].get('agent_name', 'Unknown')}")
 
        visited = set()
 
        # === CHECK IF WORKFLOW HAS PUSH TO JIRA TASKS ===
        has_push_to_jira = any(
            task.get('function') == 'call_lyzr_agent' and
            'push to jira' in task['params']['config'].get('agent_name', '').lower()
            for task in tasks
        )
        print(f"Workflow has Push to Jira tasks: {has_push_to_jira}")
 
        while current_task_name and current_task_name not in visited:
            visited.add(current_task_name)
            task = name_to_task.get(current_task_name)
            if not task:
                break
 
            agent_name = task["params"]["config"].get("agent_name", "Unknown Agent")
            print(f"Executing → {current_task_name} | {agent_name}")
 
            # === 1. AGENT EXECUTION ===
            if task.get("function") == "call_lyzr_agent":
                config = task["params"]["config"]
                agent_id = config.get("agent_id", "")
                prompt = task.get("user_input", "").strip()
                message = f"{prompt}\n\n{current_input}" if prompt else current_input
 
                response,agent_session_id = self._execute_single_agent_task(task, message,session_id=session_id,user_id=user_id)
                self._save_agent_response(workflow_id, event_id, None, agent_id, agent_name, message, response,
                                        session_id=agent_session_id ,
                                        user_id=user_id,
                                        username=username)
 
                if "jira" in agent_name.lower() and "connector" in agent_name.lower():
                    try:
                        latest_issues = self.filter_latest_by_updated(response)
                        field = task.get("user_input", "description").strip() or "description"
                        clean = self._clean_objectids(latest_issues)
                        extracted = self.extract_descriptions(clean, field)
                        if extracted:
                            extracted_issue_key = extracted[0]["key"]
                            current_input = extracted[0]["description"]
                            print(f"Jira Connector → Extracted: {extracted_issue_key}")
                        else:
                            current_input = response
                    except Exception as e:
                        print(f"Jira extract failed: {e}")
                        current_input = response
 
                elif "push to jira" in agent_name.lower():
                    print("FINAL STEP → Pushing to Jira...")
                    new_cur, keys, _, primary = self._bulk_push_to_jira(
                        task, current_input, workflow_id, event_id, None,
                        agent_id, agent_name, save_response=True,
                        session_id=session_id,
                        user_id=user_id,
                        username=username
                    )
                    extracted_issue_key = keys[0] if keys else extracted_issue_key
                    current_input = primary or new_cur
                    print(f"Workflow COMPLETED → Issue Created: {extracted_issue_key or 'None'}")
                    break
 
                else:
                    current_input = response
 
            # === 2. CONDITION — PERFECT KEYWORD MATCHING ===
            elif task.get("function") == "condition":
                query = task.get("user_input", "").lower().strip()
                query_words = {w.strip(".,!?") for w in query.split() if len(w.strip(".,!?")) >= 2}
 
                call_next = task.get("call_next") or task.get("nextcall", [])
                if isinstance(call_next, str):
                    call_next = [call_next]
                if not call_next:
                    break
 
                chosen_task_name = None
 
                for target_name in call_next:
                    target_task = name_to_task.get(target_name)
                    if not target_task:
                        continue
                    agent_name_full = target_task["params"]["config"].get("agent_name", "")
                    agent_name_id = target_task["params"]["config"].get("agent_id", "")
                    agent_words = {w.strip(".,!?") for w in agent_name_full.lower().split() if len(w.strip(".,!?")) >= 2}
 
                    if agent_words & query_words:
                        chosen_task_name = target_name
                        print(f"CONDITION MATCH → '{agent_name_full}' (matched: {agent_words & query_words})")
                        stream_channel = f"workflow*{workflow_id}_{event_id}"
                        print("eee",stream_channel)
                        self.socketio.emit(
                            stream_channel,
                            {
                                "workflow_id": workflow_id,
                                "event_id": event_id,
                                "agent_name": agent_name_full,
                                "agent_id":agent_name_id,
                                "user_id": user_id,
                                "username": username,
                                "status": "Running"
                            }
                        )
                        print(f" Saved emitted")
                        break
 
                if not chosen_task_name:
                    # NEW: Enhanced fallback logic for conditional workflows
                    # If no direct match, try to find a task with similar functionality
                    for target_name in call_next:
                        target_task = name_to_task.get(target_name)
                        if not target_task:
                            continue
                        target_agent_name = target_task["params"]["config"].get("agent_name", "").lower()
                        target_agent_id = target_task["params"]["config"].get("agent_id", "").lower()
                       
                        # Check if any word from the condition is in the target agent name
                        for word in query_words:
                            if word in target_agent_name:
                                chosen_task_name = target_name
                                print(f"PARTIAL CONDITION MATCH → '{target_agent_name}' (matched word: {word})")
                                stream_channel = f"workflow*{workflow_id}_{event_id}"
                                print("eee",stream_channel)
                                self.socketio.emit(
                                    stream_channel,
                                    {
                                        "workflow_id": workflow_id,
                                        "event_id": event_id,
                                        "agent_name": target_agent_name,
                                        "agent_id":target_agent_id,
                                        "user_id": user_id,
                                        "username": username,
                                        "status": "Running"
                                    }
                                )
                                print(f" Saved emitted")
                                break
                       
                        if chosen_task_name:
                            break
                   
                    # If still no match, use the first candidate
                    if not chosen_task_name:
                        chosen_task_name = call_next[0]
                        fb_name = name_to_task.get(chosen_task_name, {}).get("params", {}).get("config", {}).get("agent_name", "Unknown")
                        print(f"No condition match → Fallback to: {fb_name}")
 
                current_task_name = chosen_task_name
                continue
 
            # === 3. NORMAL FLOW — FIXED, NO MORE SYNTAX ERROR ===
            call_next = task.get("call_next") or task.get("nextcall")
 
            if not call_next:
                print(f"Task {current_task_name} has no call_next → ending flow")
                break
 
            if isinstance(call_next, list):
                if not call_next:
                    print(f"Task {current_task_name} has empty call_next list → ending")
                    break
                current_task_name = call_next[0]
            else:
                stripped = call_next.strip()
                if not stripped:
                    break
                current_task_name = stripped
               
        # Extract a title from the final response if no Jira key is available
        if not extracted_issue_key and current_input:
            # Try to extract a title from the first line of the response
            lines = current_input.split('\n')
            for line in lines:
                line = line.strip()
                if line.startswith('# ') or line.startswith('## ') or line.startswith('### '):
                    extracted_issue_key = line.lstrip('#').strip()
                    break
           
            # If no markdown heading found, use the first non-empty line
            if not extracted_issue_key and lines:
                for line in lines:
                    if line.strip():
                        extracted_issue_key = line.strip()[:50]  # Limit to 50 characters
                        break
       
        # If still no title, use a default
        if not extracted_issue_key:
            extracted_issue_key = "Response"
 
        # === SAVE FINAL RESPONSE FOR NON-PUSH WORKFLOWS ===
        if not has_push_to_jira:
            try:
                self.workflow_response_collection.insert_one({
                    "workflow_id": workflow_id,
                    "event_id": event_id,
                    "key": extracted_issue_key,
                    "response": current_input,
                    "session_id": session_id,
                    "user_id": user_id,
                    "username": username,
                    "timestamp": CommonUtils.get_current_timestamp(),
                    "saved_at": datetime.utcnow(),
                    "status": "completed"
                })
                print(f"Saved final workflow response for non-Push conditional workflow | Session: {session_id[-8:] if session_id else 'N/A'}")
            except Exception as e:
                print(f"Failed to save final response for non-Push conditional workflow: {e}")
 
        return self._wrap_result(extracted_issue_key, current_input)

    # ======================================================================== #
    # ITERATIVE WORKFLOW 
    # ======================================================================== #
    def _run_iterative_workflow(self, tasks, initial_input, event_id, workflow_id, session_id=None, user_id=None, username=None):
        def run_phase(phase_start_idx, phase_end_idx, input_data, context, current_issue_key=None, save_response=False):
            current = input_data
            for idx in range(phase_start_idx, phase_end_idx + 1):
                if idx >= len(tasks):
                    break
                task = tasks[idx]
                if task.get('function') != 'call_lyzr_agent':
                    continue

                config = task['params']['config']
                agent_name = config.get('agent_name', '').strip()
                agent_id = config.get('api_agent_id', '')
                prompt = task.get('user_input', '').strip()
                message = f"{prompt}\n\n{current}" if prompt else current
                print(f"PHASE [{agent_name}] → {message[:100]}...")

                response,agent_session_id = self._execute_single_agent_task(task, message,session_id=session_id,user_id=user_id)

                # === JIRA CONNECTOR handling ===
                if "jira" in agent_name.lower() and "connector" in agent_name.lower():
                    if phase_start_idx == 0:
                        print(" Phase-0 connector → treating as plain text")
                        current = str(response)
                        self._save_agent_response(
                            workflow_id=workflow_id,
                            event_id=event_id,
                            task_idx=idx,
                            agent_id=agent_id,
                            agent_name=agent_name,
                            prompt=message,
                            response=response,
                            session_id=agent_session_id,
                            user_id=user_id,
                            username=username
                        )
                        continue

                    # Extract issues robustly
                    issues = self._extract_robust_json_array(str(response))
                    if not issues:
                        print(" Jira connector returned no valid issues → using fallback text")
                        current = str(response)
                    else:
                        latest_issues = self.filter_latest_by_updated(json.dumps(issues)) or issues[:1]
                        field = task.get('user_input', 'description').strip() or 'description'
                        extracted = self.extract_descriptions(latest_issues, field)
                        if extracted:
                            current = "\n\n".join(item["description"] for item in extracted)
                            print(f" Extracted {len(extracted)} issue(s): {[item['key'] for item in extracted]}")
                        else:
                            current = str(response)
                    # Save connector response
                    self._save_agent_response(
                        workflow_id=workflow_id,
                        event_id=event_id,
                        task_idx=idx,
                        agent_id=agent_id,
                        agent_name=agent_name,
                        prompt=message,
                        response=response,
                        session_id=agent_session_id,
                        user_id=user_id,
                        username=username
                    )
                    continue

                # === PUSH TO JIRA handling ===
                if "push to jira" in agent_name.lower():
                    print(" Detected Push to Jira → bulk push...")
                    new_current, created_keys, original_markdowns, primary_result = self._bulk_push_to_jira(
                        task, current, workflow_id, event_id, idx,
                        agent_id, agent_name, save_response=save_response,
                        session_id=agent_session_id,
                        user_id=user_id,
                        username=username
                    )
                    current = new_current
                    # FIXED: Always return the rich primary_result as the main content
                    if created_keys:
                        # primary_result = original_markdowns[0] → this is the full user stories!
                        rich_content = primary_result or new_current
                    else:
                        rich_content = new_current

                    # Always return rich content + key
                    return rich_content, (created_keys[0] if created_keys else None)
                # === NORMAL AGENT (not connector, not push) ===
                else:
                    self._save_agent_response(
                        workflow_id=workflow_id,
                        event_id=event_id,
                        task_idx=idx,
                        agent_id=agent_id,
                        agent_name=agent_name,
                        prompt=message,
                        response=response,
                        session_id=agent_session_id,
                        user_id=user_id,
                        username=username
                    )
                    current = response

            # If no Push to Jira in this phase, just return current content
            return current, None

        # === Find Push to Jira indices (phase boundaries) ===
        push_indices = [
            i for i, t in enumerate(tasks)
            if t.get('function') == 'call_lyzr_agent'
            and 'push to jira' in t['params']['config'].get('agent_name', '').lower()
        ]
        
        # === NEW: Find iterative phases based on workflow structure ===
        iterative_phase_indices = []
        for idx, task in enumerate(tasks):
            # Look for tasks that indicate the end of an iterative phase
            if (task.get('function') == 'call_lyzr_agent' and 
                any(keyword in task.get('name', '').lower() for keyword in 
                    ['complete', 'finish', 'end', 'result', 'output'])):
                iterative_phase_indices.append(idx)
        
        # If no explicit phase markers found, use Push to Jira tasks as phase boundaries
        if not iterative_phase_indices:
            iterative_phase_indices = push_indices
        
        # If no phase boundaries at all, create a single phase with all tasks
        if not iterative_phase_indices:
            iterative_phase_indices = [len(tasks) - 1]
        
        # === Build phase bounds ===
        phase_bounds = []
        start_idx = 0
        
        for end_idx in iterative_phase_indices:
            # Skip if end_idx is before start_idx
            if end_idx < start_idx:
                continue
                
            phase_bounds.append((start_idx, end_idx))
            start_idx = end_idx + 1
        
        # If there are tasks after the last phase boundary, add them as a final phase
        if start_idx < len(tasks):
            phase_bounds.append((start_idx, len(tasks) - 1))
        
        all_phase_results = []
        final_key = None
        final_content = "Iterative workflow completed."
        
        # === Run each phase ===
        for phase_idx, (start_idx, end_idx) in enumerate(phase_bounds):
            print(f"\n=== PHASE {phase_idx} ===")
            is_final = (phase_idx == len(phase_bounds) - 1)
            
            # For the first phase, use the initial input
            if phase_idx == 0:
                phase_input = initial_input
            else:
                # For subsequent phases, use the output of the previous phase
                phase_input = all_phase_results[-1]
            
            # Run the phase
            phase_result, phase_key = run_phase(
                start_idx, end_idx, phase_input, [], 
                current_issue_key=None, save_response=is_final
            )
            
            all_phase_results.append(phase_result)
            
            # If this is the final phase, update the final result
            if is_final:
                final_key = phase_key
                final_content = phase_result if phase_result else "Workflow completed."
        
        # === Extract a title from the final response if no Jira key is available ===
        if not final_key and final_content:
            # Try to extract a title from the first line of the response
            lines = final_content.split('\n')
            for line in lines:
                line = line.strip()
                if line.startswith('# ') or line.startswith('## ') or line.startswith('### '):
                    final_key = line.lstrip('#').strip()
                    break
            
            # If no markdown heading found, use the first non-empty line
            if not final_key and lines:
                for line in lines:
                    if line.strip():
                        final_key = line.strip()[:50]  # Limit to 50 characters
                        break
        
        # If still no title, use a default
        if not final_key:
            final_key = "Response"
        
        # === SAVE FINAL RESPONSE ===
        # try:
        #     self.workflow_response_collection.insert_one({
        #         "workflow_id": workflow_id,
        #         "event_id": event_id,
        #         "key": final_key,
        #         "response": final_content,
        #         "session_id": session_id,
        #         "user_id": user_id,
        #         "username": username,
        #         "timestamp": CommonUtils.get_current_timestamp(),
        #         "saved_at": datetime.utcnow(),
        #         "status": "completed"
        #     })
        #     print(f"Saved final workflow response for iterative workflow | Session: {session_id[-8:] if session_id else 'N/A'}")
        # except Exception as e:
        #     print(f"Failed to save final response for iterative workflow: {e}")
        
        return {
            "phase_results": all_phase_results,
            "summary": {
                "total_phases": len(phase_bounds),
                "final_key": final_key,
                "final_content": final_content.strip() or "Workflow completed successfully.",
            }
        }
    def _extract_issue_keys_from_result(self, result):
        """Helper method to extract issue keys from a phase result"""
        issue_keys = []
        
        if isinstance(result, dict) and 'issue_key' in result:
            issue_keys.append(result['issue_key'])
        elif isinstance(result, list):
            for item in result:
                if isinstance(item, dict) and 'issue_key' in item:
                    issue_keys.append(item['issue_key'])
        elif isinstance(result, str):
            # Try to parse as JSON and extract issue key
            try:
                data = json.loads(result)
                if isinstance(data, dict) and 'issue_key' in data:
                    issue_keys.append(data['issue_key'])
            except json.JSONDecodeError:
                # Fall back to regex
                keys = re.findall(r'[A-Z]+-\d+', result)
                issue_keys.extend(keys)
        
        return issue_keys

    # JSON extractor — handles ANY response
    def _extract_any_json_array(self, text):
        if not text or not isinstance(text, str):
            return []
        try:
            # Case 1: Direct JSON array
            if text.strip().startswith('['):
                return json.loads(text)
            # Case 2: Wrapped in {"response": "..."}
            data = json.loads(text)
            if isinstance(data, dict):
                raw = data.get("response", "")
                if raw.startswith('['):
                    return json.loads(raw)
                # Case 3: response contains JSON string
                if '{' in raw and '}' in raw:
                    start = raw.find('[')
                    end = raw.rfind(']') + 1
                    if start != -1 and end > start:
                        return json.loads(raw[start:end])
            return []
        except:
            return []
        
    def _execute_single_agent_task(self, task, input_text, session_id=None,user_id=None):
        
        agent_session_id = str(uuid.uuid4())
        params = task['params'].copy()
        if 'user_message' not in params:
            params['user_message'] = {}
        params['user_message']['value'] = str(input_text)
        
        response = self.call_lyzr_agent(params, session_id=agent_session_id,user_id=user_id) or ""
    
        # Return both the response and the agent session ID
        return response, agent_session_id
        
  