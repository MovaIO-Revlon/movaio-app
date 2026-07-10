# workflow.py
import re
import requests
import json
import logging

import asyncio
import websocket
import websockets
import uuid
from bson.objectid import ObjectId
from datetime import datetime, timezone
from jira import JIRA
from utils import log_data
from config_loader import ConfigLoader
from commonutils import DatabaseCollections, CommonUtils
from database_manager import select_database_by_user_type
from config_loader import config_loader
from session_manager import get_current_user
from flask import request,g
import threading
import time
from utils import NotFoundError
import contextvars
from queue import Queue
import traceback

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
            
            project_doc =  self.project.find_one({'projectName': prj_name})
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
        find_op = {'type': 'find', 'filter': {}}
        docs = self._query_db('workflow_collection', find_op)
        return [WorkflowModel.format_response(doc) for doc in docs if doc]

    def get_by_id(self, flow_id):
        query = {"flow_id": flow_id}
        find_one_op = {'type': 'find_one', 'filter':query}
        doc =self._query_db('workflow_collection', find_one_op)
        workflow = WorkflowModel.format_response(doc) if doc else None

        if not workflow:
            raise NotFoundError("No workflow found")
        
        return workflow
     
    def _update_workflow_agent_count(self, agency_id):
        """
        Update the workflow agent count for a given agency
        """
        result = self.agency_collection.find_one({"agency_id": agency_id}, {"_id": 0, "agent_type_counts": 1})
        type_counts = result.get("agent_type_counts", {})
        
        # Count active workflows for this agency
        count = self.workflow_agency_mapping_collection.count_documents({
            "agency_id": agency_id,
            "status": "active"
        })
        
        # Update the count
        type_counts["Workflow Agent"] = count
        self.agency_collection.update_one(
            {"agency_id": agency_id},
            {"$set": {"agent_type_counts": type_counts}}
        )

    def create(self, data):
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
        
        # Update workflow agent count using the new method
        self._update_workflow_agent_count(agency_id)
        
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

    def update_old(self, flow_id, data):
        existing = self.get_by_id(flow_id)
        existing_agency_name = existing.get("agency_name","")
        if not existing:
            raise NotFoundError("No data found for the given flow_id")

        data["updated_at"] = datetime.utcnow()
        data["flow_id"] = flow_id
        
        agency_id = data.get("agency_name","")
        flow_description=data.get("flow_description","")
        agency = self.agency_collection.find_one({"agency_id":agency_id},{"_id":0,"agency_name":1,"assigned_to":1})
        
        if agency:
            agency_name = agency.get("agency_name","")
            team=agency.get("assigned_to","")
            print("agg",agency_name)
        data["agency_name"] = agency_name
        data["team"]=team
        data["flow_description"]=flow_description
            
        is_external = existing.get("IsExternal", False)
        if is_external is False:  # Strict check for False (not just falsy values)
            self.workflow_collection.update_one({"flow_id": flow_id}, {"$set": data})
        else:
            self.workflow_collection.update_one({"flow_id": flow_id},{"$set": {"agency_name": agency_name,"team": team,"flow_description":flow_description}})

            
        mapping_doc = {
            "agency_id": agency_id,
            "agency_name": agency_name,
            
            "flow_id": flow_id,
            "flow_name": data.get("flow_name", data.get("name", "")),
            "status": "active",
            "created_ts": datetime.utcnow(),
            "updated_ts": datetime.utcnow()
        }
        
        self.workflow_agency_mapping_collection.update_one({"flow_id": flow_id},{"$set":mapping_doc},upsert=True)
        
        # Update workflow agent count for the new agency
        self._update_workflow_agent_count(agency_id)
        
        # If agency has changed, update the count for the previous agency as well
        if existing_agency_name != agency_name:
            res = self.agency_collection.find_one(
                {"agency_name": existing_agency_name},
                {"_id": 0, "agency_id": 1}          # we only need agency_id
            )
            
            if res is not None:
                existing_id = res["agency_id"]
                self._update_workflow_agent_count(existing_id)
        
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
                    find_op = {'type': 'find_one', 'filter': {'flow_id': flow_id}}
                    existing = self._query_db('workflow_collection', find_op,user_type= user_type.get("database_name"))
                    existing_agency_mapping = self._query_db('workflow_agency_mapping_collection', find_op,user_type= user_type.get("database_name"))
                    if existing :
                        print("yes")
                        data.pop("_id", None)
                        if is_external is False:
                            update_op = {'type': 'update_one', 'filter' : {'flow_id': flow_id}, 'update' : {'$set': data}}
                            self._query_db('workflow_collection', update_op,user_type= user_type.get("database_name"))

                        else:
                            update_op = {'type': 'update_one', 'filter' : {'flow_id': flow_id}, 'update' : {'$set': {"agency_name": agency_name,"team": team}}}
                            self._query_db('workflow_collection', update_op,user_type= user_type.get("database_name"))

                        
                    else:
                            full_data = self.workflow_collection.find_one({"flow_id": flow_id})
                            insert_op= {'type': 'insert_one', 'document': full_data}
                            self._query_db('workflow_collection', insert_op,user_type= user_type.get("database_name"))

                    if existing_agency_mapping:
                        mapping_doc.pop("_id", None)
                        
                        update_mapping_op = {'type': 'update_one', 'filter' : {'flow_id': flow_id}, 'update' : {'$set': mapping_doc}}
                        self._query_db('workflow_agency_mapping_collection', update_mapping_op,user_type= user_type.get("database_name"))
                    else:
                        insert_mapping_op = {'type': 'insert_one', 'document': mapping_doc}
                        self._query_db('workflow_agency_mapping_collection', insert_mapping_op,user_type= user_type.get("database_name"))

        return self.get_by_id(flow_id)

    def update(self, flow_id, data):
        existing = self.get_by_id(flow_id)
        existing_agency_name = existing.get("agency_name","")
        if not existing:
            raise NotFoundError("No data found for the given flow_id")

        data["updated_at"] = datetime.utcnow()
        data["flow_id"] = flow_id
        
        agency_id = data.get("agency_name","")
        flow_description=data.get("flow_description","")
        agency = self.agency_collection.find_one({"agency_id":agency_id},{"_id":0,"agency_name":1,"assigned_to":1})
        
        if agency:
            agency_name = agency.get("agency_name","")
            team=agency.get("assigned_to","")
            print("agg",agency_name)
        data["agency_name"] = agency_name
        data["team"]=team
        data["flow_description"]=flow_description
            
        is_external = existing.get("IsExternal", False)
        
        # === NEW: Handle external workflow agent name updates ===
        if is_external and "flow_data" in data and "tasks" in data["flow_data"]:
            # Update only agent_name and tag in tasks
            updated_tasks = []
            for task in data["flow_data"]["tasks"]:
                if task.get("function") == "call_lyzr_agent" and "params" in task and "config" in task["params"]:
                    # Update agent_name in config
                    if "agent_name" in task["params"]["config"]:
                        # Keep the updated agent_name
                        updated_agent_name = task["params"]["config"]["agent_name"]
                    else:
                        # Use existing agent_name if not provided in update
                        updated_agent_name = task["params"]["config"].get("agent_name", "")
                    
                    # Update tag to match agent_name (optional - remove if not needed)
                    if "tag" in task:
                        task["tag"] = updated_agent_name
                    
                    # Update the config with the agent_name
                    task["params"]["config"]["agent_name"] = updated_agent_name
                
                updated_tasks.append(task)
            
            # Update only the tasks in flow_data
            self.workflow_collection.update_one(
                {"flow_id": flow_id}, 
                {"$set": {"flow_data.tasks": updated_tasks, "updated_at": data["updated_at"],
                          "agency_name": agency_name,"team": team,"flow_description":flow_description}}
            )
        else:
            # For internal workflows or non-external, use existing logic
            if is_external is False:
                self.workflow_collection.update_one({"flow_id": flow_id}, {"$set": data})
            else:
                self.workflow_collection.update_one({"flow_id": flow_id},{"$set": {"agency_name": agency_name,"team": team,"flow_description":flow_description}})

        # === REST OF THE CODE REMAINS UNCHANGED ===
        mapping_doc = {
            "agency_id": agency_id,
            "agency_name": agency_name,
            
            "flow_id": flow_id,
            "flow_name": data.get("flow_name", data.get("name", "")),
            "status": "active",
            "created_ts": datetime.utcnow(),
            "updated_ts": datetime.utcnow()
        }
        
        self.workflow_agency_mapping_collection.update_one({"flow_id": flow_id},{"$set":mapping_doc},upsert=True)
        
        # Update workflow agent count for the new agency
        self._update_workflow_agent_count(agency_id)
        
        # If agency has changed, update the count for the previous agency as well
        if existing_agency_name != agency_name:
            res = self.agency_collection.find_one(
                {"agency_name": existing_agency_name},
                {"_id": 0, "agency_id": 1}
            )
            
            if res is not None:
                existing_id = res["agency_id"]
                self._update_workflow_agent_count(existing_id)
        
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
                    find_op = {'type': 'find_one', 'filter': {'flow_id': flow_id}}
                    existing = self._query_db('workflow_collection', find_op,user_type= user_type.get("database_name"))
                    existing_agency_mapping = self._query_db('workflow_agency_mapping_collection', find_op,user_type= user_type.get("database_name"))
                    if existing :
                        print("yes")
                        data.pop("_id", None)
                        if is_external is False:
                            update_op = {'type': 'update_one', 'filter' : {'flow_id': flow_id}, 'update' : {'$set': data}}
                            self._query_db('workflow_collection', update_op,user_type= user_type.get("database_name"))

                        else:
                            # === NEW: For external workflows in projects, update only tasks ===
                            if "flow_data" in data and "tasks" in data["flow_data"]:
                                updated_tasks = []
                                for task in data["flow_data"]["tasks"]:
                                    if task.get("function") == "call_lyzr_agent" and "params" in task and "config" in task["params"]:
                                        # Update agent_name in config
                                        if "agent_name" in task["params"]["config"]:
                                            # Keep the updated agent_name
                                            updated_agent_name = task["params"]["config"]["agent_name"]
                                        else:
                                            # Use existing agent_name if not provided in update
                                            updated_agent_name = task["params"]["config"].get("agent_name", "")
                                        
                                        # Update tag to match agent_name (optional - remove if not needed)
                                        if "tag" in task:
                                            task["tag"] = updated_agent_name
                                        
                                        # Update the config with the agent_name
                                        task["params"]["config"]["agent_name"] = updated_agent_name
                                    
                                    updated_tasks.append(task)
                                
                                update_op = {
                                    'type': 'update_one', 
                                    'filter': {'flow_id': flow_id}, 
                                    'update': {
                                        '$set': {
                                            "flow_data.tasks": updated_tasks, 
                                            "updated_at": data["updated_at"]
                                        }
                                    }
                                }
                                self._query_db('workflow_collection', update_op, user_type=user_type.get("database_name"))
                            else:
                                update_op = {'type': 'update_one', 'filter' : {'flow_id': flow_id}, 'update' : {'$set': {"agency_name": agency_name,"team": team}}}
                                self._query_db('workflow_collection', update_op,user_type= user_type.get("database_name"))

                            
                    else:
                            full_data = self.workflow_collection.find_one({"flow_id": flow_id})
                            insert_op= {'type': 'insert_one', 'document': full_data}
                            self._query_db('workflow_collection', insert_op,user_type= user_type.get("database_name"))

                    if existing_agency_mapping:
                        mapping_doc.pop("_id", None)
                        
                        update_mapping_op = {'type': 'update_one', 'filter' : {'flow_id': flow_id}, 'update' : {'$set': mapping_doc}}
                        self._query_db('workflow_agency_mapping_collection', update_mapping_op,user_type= user_type.get("database_name"))
                    else:
                        insert_mapping_op = {'type': 'insert_one', 'document': mapping_doc}
                        self._query_db('workflow_agency_mapping_collection', insert_mapping_op,user_type= user_type.get("database_name"))

        return self.get_by_id(flow_id)


    def get_workflow_statistics(self, user_type=None):
        total_workflows = self._query_db('workflow_collection', {'type': 'find', 'filter': {}}, user_type)

        external_wf_count = 0
        custom_wf_count = 0
        workflow_per_agency = {}

        for i in total_workflows:
            
            if "IsExternal" in i and i["IsExternal"]:
                external_wf_count += 1
            else:
                custom_wf_count += 1

            agency_name = i.get("agency_name","")
            if agency_name:
                workflow_per_agency[agency_name] = workflow_per_agency.get(agency_name, 0) + 1

        return {
            "total_workflows": len(total_workflows),
            "workflow_type_count": {
                "External": external_wf_count,
                "Custom": custom_wf_count
            },
            "workflows_per_agency": workflow_per_agency
        }

    def delete(self, flow_id) -> str:
        existing = self.get_by_id(flow_id)
        if not existing:
            raise NotFoundError("No data found for the given flow_id")

        
        data = self.workflow_collection.find_one({"flow_id": flow_id})
        result = self.workflow_collection.delete_one({"flow_id": flow_id})
        self.workflow_agency_mapping_collection.update_one({"flow_id": flow_id},{"$set": {"status": "inactive"}})
        agency_name = data.get("agency_name","")
        team =self.agency_collection.find_one({"agency_name" :agency_name,"is_deleted": False},{"_id":0,"assigned_to":1})
        
        res = self.agency_collection.find_one(
            {"agency_name": agency_name},
            {"_id": 0, "agency_id": 1,"agent_type_counts":1}          # we only need agency_id
        )

        if res is not None: 
            existing_id = res["agency_id"]
            type_counts = res.get("agent_type_counts", {})
            current_wf = type_counts.get("Workflow Agent", 0)
            type_counts["Workflow Agent"] = max(0, current_wf - 1)
            
            result = self.agency_collection.update_one(
                {"agency_id": existing_id,"is_deleted": False},
                {"$set": {"agent_type_counts": type_counts}}
            )
        
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
                    
                    
        return flow_id



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

    def _extract_iterable_items_old(self, response):
        """Extract individual items from any agent response format for iteration"""
        try:
            # Handle string responses
            if isinstance(response, str):
                # Try JSON first
                try:
                    if response.strip().startswith('['):
                        items = json.loads(response)
                        return items if isinstance(items, list) else [response]
                    elif response.strip().startswith('{'):
                        data = json.loads(response)
                        # Look for common array fields
                        for field in ['items', 'epics', 'stories', 'issues', 'results', 'data']:
                            if field in data and isinstance(data[field], list):
                                return data[field]
                        # If no array field found, return as single item
                        return [response]
                except json.JSONDecodeError:
                    pass  # Not valid JSON, continue with other parsing methods
                
                # Try to split by common section headers
                items = self._split_by_section_headers(response)
                if items and len(items) > 1:
                    return items
                
                # Try to split by numbered/bulleted lists
                items = self._split_by_lists(response)
                if items and len(items) > 1:
                    return items
                
                # Try to split by double newlines (paragraphs)
                items = self._split_by_paragraphs(response)
                if items and len(items) > 1:
                    return items
            
            # If it's already a list
            if isinstance(response, list):
                return response
            
            # If it's a dict, try to extract items
            if isinstance(response, dict):
                for field in ['items', 'epics', 'stories', 'issues', 'results', 'data']:
                    if field in response and isinstance(response[field], list):
                        return response[field]
            
            # Default: treat as single item
            return [response]
            
        except Exception as e:
            print(f"Error extracting iterable items: {e}")
            return [response]

    def _extract_iterable_items(self, response):
        """Extract individual items from any agent response format for iteration"""
        try:
            # Handle string responses
            if isinstance(response, str):
                # >>> NEW: Prioritize numbered titles (e.g., "User Story 1", "Test Case 2") <<<
                items = self._split_by_numbered_titles(response)
                if items and len(items) > 1:
                    print(f"DEBUG: Split by numbered titles, found {len(items)} items.")
                    return items

                # Fallback to JSON parsing
                try:
                    if response.strip().startswith('['):
                        items = json.loads(response)
                        return items if isinstance(items, list) else [response]
                    elif response.strip().startswith('{'):
                        data = json.loads(response)
                        # Look for common array fields
                        for field in ['items', 'epics', 'stories', 'issues', 'results', 'data']:
                            if field in data and isinstance(data[field], list):
                                return data[field]
                        # If no array field found, return as single item
                        return [response]
                except json.JSONDecodeError:
                    pass  # Not valid JSON, continue with other parsing methods
                
                # Fallback to other parsing methods
                # Try to split by common section headers
                items = self._split_by_section_headers(response)
                if items and len(items) > 1:
                    return items
                
                # Try to split by numbered/bulleted lists
                items = self._split_by_lists(response)
                if items and len(items) > 1:
                    return items
                
                # Try to split by double newlines (paragraphs)
                items = self._split_by_paragraphs(response)
                if items and len(items) > 1:
                    return items
            
            # If it's already a list
            if isinstance(response, list):
                return response
            
            # If it's a dict, try to extract items
            if isinstance(response, dict):
                for field in ['items', 'epics', 'stories', 'issues', 'results', 'data']:
                    if field in response and isinstance(response[field], list):
                        return response[field]
            
            # Default: treat as single item
            return [response]
            
        except Exception as e:
            print(f"Error extracting iterable items: {e}")
            return [response]

    def _split_by_numbered_titles(self, text):
        """
        Splits text by numbered titles like "Epic 1:", "User Story 2", "Test Case 3."
        Ensures content has substantial text between splits.
        """
        lines = text.split('\n')
        split_points = []
        
        # Look for numbered titles (e.g., "Epic 1:", "User Story 2", "Test Case 3.")
        numbered_pattern = re.compile(r'^(.+\s+\d+\s*[\.:]?\s*).+$', re.MULTILINE | re.IGNORECASE)
        for i, line in enumerate(lines):
            if numbered_pattern.match(line.strip()):
                split_points.append(i)
        
        # If we found fewer than 2 split points, return None
        if len(split_points) < 2:
            return None
        
        # Reconstruct the items based on split points
        items = []
        for i in range(len(split_points)):
            start_index = split_points[i]
            # The end is the next split point, or the end of the text
            end_index = split_points[i + 1] if i + 1 < len(split_points) else len(lines)
            
            # Get the lines for this item
            item_lines = lines[start_index:end_index]
            
            # Skip if this is just a title line with no substantial content
            if len(item_lines) <= 1:
                continue
            
            # Check if there's substantial content (more than just headers)
            has_content = False
            for line in item_lines[1:]:  # Skip the title line
                if line.strip() and len(line.strip()) > 10:  # More than 10 characters
                    has_content = True
                    break
            
            if not has_content:
                continue
            
            # Join the lines and add to items
            item_text = '\n'.join(item_lines).strip()
            if item_text:
                items.append(item_text)
        
        # Only return if we found multiple substantial items
        return items if len(items) > 1 else None

    # def _split_by_numbered_titles(self, text):
    #     """
    #     Splits text by numbered titles like "User Story 1:", "Test Case 2", "Epic 3."
    #     This is more robust for structured documentation.
    #     """
    #     # This regex looks for a pattern like:
    #     # (any text) (optional number) (optional dot/colon) (number) (optional dot/colon) (any text)
    #     # e.g., "User Story 1", "Test Case 2:", "Epic 3. Description"
    #     # It captures the full title and uses it as a split point.
    #     pattern = re.compile(r'^(.+?)\s*(\d+)\s*[\.:]?\s*$', re.MULTILINE | re.IGNORECASE)
        
    #     split_points = []
    #     lines = text.split('\n')
        
    #     # Find all lines that match the numbered title pattern
    #     for i, line in enumerate(lines):
    #         if pattern.match(line.strip()):
    #             split_points.append(i)
        
    #     # If we found fewer than 2 split points, this method isn't applicable
    #     if len(split_points) < 2:
    #         return None
        
    #     # Reconstruct the items based on split points
    #     items = []
    #     for i in range(len(split_points)):
    #         start_index = split_points[i]
    #         # The end is the next split point, or the end of the text
    #         end_index = split_points[i + 1] if i + 1 < len(split_points) else len(lines)
            
    #         # The item includes the title line and everything after it,
    #         # up to the next title.
    #         item_lines = lines[start_index:end_index]
    #         item_text = '\n'.join(item_lines).strip()
            
    #         if item_text:  # Ensure we don't add empty items
    #             items.append(item_text)
        
    #     return items if len(items) > 1 else None
    
    # def _split_by_section_headers(self, text):
    #     """Split text by common section header patterns"""
    #     # Common section header patterns
    #     section_patterns = [
    #         r'(?m)^#{1,6}\s+',  # Markdown headers
    #         r'(?m)^[A-Z][A-Z\s]+:$',  # ALL CAPS followed by colon
    #         r'(?m)^\d+\.\s+',  # Numbered sections
    #         r'(?m)^[A-Z]\.\s+',  # Letter sections
    #     ]
        
    #     for pattern in section_patterns:
    #         # Split by the pattern, but keep the delimiter
    #         parts = re.split(f'({pattern})', text)
            
    #         # Reconstruct with delimiters
    #         if len(parts) > 2:  # Found multiple sections
    #             items = []
    #             current_item = ""
                
    #             for i in range(0, len(parts), 2):
    #                 if i+1 < len(parts):
    #                     # Add the delimiter and content
    #                     current_item = parts[i] + parts[i+1]
                        
    #                     # Look ahead to see if there's more content before the next delimiter
    #                     if i+2 < len(parts):
    #                         # Add content up to the next delimiter
    #                         current_item += parts[i+2]
                        
    #                     items.append(current_item.strip())
                
    #             if len(items) > 1:
    #                 return items
        
    #     return None


    def _split_by_section_headers(self, text):
        """Split text by common section header patterns"""
        lines = text.split('\n')
        split_points = []
        
        # Common section header patterns
        section_patterns = [
            r'(?m)^#{1,6}\s+',  # Markdown headers
            r'(?m)^[A-Z][A-Z\s]+:$',  # ALL CAPS followed by colon
            r'(?m)^\d+\.\s+',  # Numbered sections
            r'(?m)^[A-Z]\.\s+',  # Letter sections
        ]
        
        # Find all header lines
        for i, line in enumerate(lines):
            for pattern in section_patterns:
                if re.match(pattern, line.strip()):
                    split_points.append(i)
                    break  # Found a match, move to next line
        
        # If we found fewer than 2 split points, return None
        if len(split_points) < 2:
            return None
        
        # Reconstruct the items based on split points
        items = []
        for i in range(len(split_points)):
            start_index = split_points[i]
            # The end is the next split point, or the end of the text
            end_index = split_points[i + 1] if i + 1 < len(split_points) else len(lines)
            
            # Get the lines for this item
            item_lines = lines[start_index:end_index]
            
            # Skip if this is just a header line with no substantial content
            if len(item_lines) <= 1:
                continue
            
            # Check if there's substantial content
            has_content = False
            for line in item_lines[1:]:  # Skip the header line
                if line.strip() and len(line.strip()) > 10:  # More than 10 characters
                    has_content = True
                    break
            
            if not has_content:
                continue
            
            # Join the lines and add to items
            item_text = '\n'.join(item_lines).strip()
            if item_text:
                items.append(item_text)
        
        # Only return if we found multiple substantial items
        return items if len(items) > 1 else None

    def _split_by_lists(self, text):
        """Split text by numbered or bulleted list patterns"""
        # Common list patterns
        list_patterns = [
            r'(?m)^\d+\.\s+',  # 1. Item
            r'(?m)^[a-zA-Z]\.\s+',  # a. Item
            r'(?m)^-\s+',  # - Item
            r'(?m)^\*\s+',  # * Item
            r'(?m)^\+\s+',  # + Item
        ]
        
        for pattern in list_patterns:
            # Find all list items
            matches = list(re.finditer(pattern, text))
            if len(matches) > 1:  # Found a list
                items = []
                
                for i, match in enumerate(matches):
                    start = match.start()
                    end = matches[i+1].start() if i+1 < len(matches) else len(text)
                    
                    # Extract the list item (including the marker)
                    item = text[start:end].strip()
                    items.append(item)
                
                return items
        
        return None

    def _split_by_paragraphs(self, text):
        """Split text by double newlines (paragraphs)"""
        paragraphs = text.split('\n\n')
        
        # Filter out empty paragraphs
        paragraphs = [p.strip() for p in paragraphs if p.strip()]
        
        # Only return if we have multiple substantial paragraphs
        if len(paragraphs) > 1:
            # Check if paragraphs are substantial (more than just a few words)
            substantial_paragraphs = [p for p in paragraphs if len(p.split()) > 5]
            
            if len(substantial_paragraphs) > 1:
                return substantial_paragraphs
        
        return None

    def _combine_iteration_results(self, iteration_results):
        """Combine results from all iterations into a single response"""
        if not iteration_results:
            return "No results from iterations"
        
        combined = []
        
        for result in iteration_results:
            item = result["item"]
            item_results = result["results"]
            
            # Format each item's results
            if isinstance(item, dict):
                # Structured item (like our epic format)
                item_title = item.get("epic_name") or item.get("name") or item.get("title") or f"Item {result['item_index'] + 1}"
                item_output = f"## {item_title}\n\n"
                
                # Include the original item content
                if "content" in item:
                    item_output += f"{item['content']}\n\n"
                elif "description" in item:
                    item_output += f"{item['description']}\n\n"
                else:
                    # Include the whole item as text
                    item_output += f"{str(item)}\n\n"
            else:
                # Text-based item
                # Extract a title from the first line if possible
                lines = str(item).split('\n')
                if lines and lines[0].strip():
                    title = lines[0].strip()
                    # If the title is short, use it as is
                    if len(title) < 100:
                        item_output = f"## {title}\n\n"
                        # Include the rest of the content
                        if len(lines) > 1:
                            item_output += '\n'.join(lines[1:]).strip()
                    else:
                        # Title is too long, just use the whole content
                        item_output = f"## Item {result['item_index'] + 1}\n\n{str(item)}"
                else:
                    item_output = f"## Item {result['item_index'] + 1}\n\n{str(item)}"
            
            # Add results from each agent that processed this item
            for agent_name, agent_response in item_results.items():
                item_output += f"\n### {agent_name} Result:\n{str(agent_response)}"
            
            combined.append(item_output)
        
        return "\n\n".join(combined)

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
        candidates.sort(key=lambda x: (-x[0], -x[2]))  # FIXED LINE

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

    def call_lyzr_agent_old(self, params, session_id=None, user_id=None):
        """Call Lyzr agent and capture WebSocket metrics"""
        config = params['config']
        api_key = config.get('api_key')
        effective_session_id = session_id if session_id is not None else config.get('session_id')
        effective_user_id = user_id
        
        print("effective_session_id", effective_session_id)
        print("inputprompt", params['user_message']['value'])
        
        payload = {
            "user_id": effective_user_id,
            "agent_id": config['api_agent_id'],
            "session_id": effective_session_id,
            "message": params['user_message']['value']
        }
        if params.get('assets'):
            payload['assets'] = params['assets']
        
        headers = {"Content-Type": "application/json", "x-api-key": api_key}
        
        # WebSocket connection for metrics
        ws_url = f"wss://metrics.studio.lyzr.ai/ws/{effective_session_id}?x-api-key={api_key}"
        log_queue = Queue()
        ws_thread = None
        collected_logs = []  # Store all logs here
        
        # WebSocket event handlers
        def on_message(ws, message):
            """Handle incoming WebSocket messages"""
            try:
                log_data_obj = json.loads(message)
                # DEBUG: Print to terminal
                print("\n=== WEBSOCKET LOG RECEIVED ===")
                print(json.dumps(log_data_obj, indent=2))
                print("==============================\n")
                
                # Add to queue and store in collected_logs
                log_entry = {
                    "type": "log",
                    "data": log_data_obj,
                    "timestamp": datetime.now().isoformat()
                }
                log_queue.put(log_entry)
                collected_logs.append(log_data_obj)  # Store the raw log data
            except Exception as e:
                print(f"Error parsing WebSocket message: {e}")
                print(f"Raw message: {message}")
        
        def on_error(ws, error):
            """Handle WebSocket errors"""
            print(f" WebSocket error: {error}")
            print(f"Websocket Error due to connection closed--4")
            log_queue.put({
                "type": "error",
                "message": str(error),
                "timestamp": datetime.now().isoformat()
            })
        
        def on_close(ws, close_status_code, close_msg):
            """Handle WebSocket connection close"""
            print(f"WebSocket connection closed. Code: {close_status_code}, Message: {close_msg}")
            log_queue.put({
                "type": "control",
                "message": "ws_closed",
                "timestamp": datetime.now().isoformat()
            })
        
        def on_open(ws):
            """Handle WebSocket connection open"""
            print("WebSocket connection opened")
            log_queue.put({
                "type": "control",
                "message": "ws_opened",
                "timestamp": datetime.now().isoformat()
            })
        
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
            
            # Make the actual API call
            print("Calling Lyzr Agent API")
            response = requests.post(config['api_url'], headers=headers, json=payload, timeout=300)
            
            # Wait a bit more for any remaining logs
            time.sleep(2)
            
            # Close WebSocket connection
            if ws_thread and ws_thread.is_alive():
                ws.close()
                ws_thread.join(timeout=5)
            
            # Extract response
            if response.status_code == 200:
                agent_response = response.json().get('response', '')
            else:
                agent_response = f"Error {response.status_code}: {response.text}"
            
            # Return response with collected logs
            return {
                'response': agent_response,
                'logs': collected_logs,
                'status_code': response.status_code
            }
            
        except Exception as e:
            print(f"Error in call_lyzr_agent: {str(e)}")
            # Close WebSocket on error
            if ws_thread and ws_thread.is_alive():
                try:
                    ws.close()
                    ws_thread.join(timeout=5)
                except:
                    pass
            
            return {
                'response': f"Request failed: {str(e)}",
                'logs': collected_logs,
                'status_code': 500
            }
        
    def call_lyzr_agent(self, params, session_id=None, user_id=None):
        """Call Lyzr agent and capture WebSocket metrics"""
        config = params['config']
        api_key = config.get('api_key')
        effective_session_id = session_id if session_id is not None else config.get('session_id')
        effective_user_id = user_id
        
        print("effective_session_id", effective_session_id)
        print("inputprompt", params['user_message']['value'])
        
        payload = {
            "user_id": effective_user_id,
            "agent_id": config['api_agent_id'],
            "session_id": effective_session_id,
            "message": params['user_message']['value']
        }
        if params.get('assets'):
            payload['assets'] = params['assets']
        
        headers = {"Content-Type": "application/json", "x-api-key": api_key}
        
        # WebSocket connection for metrics
        ws_url = f"wss://metrics.studio.lyzr.ai/ws/{effective_session_id}?x-api-key={api_key}"
        log_queue = Queue()
        ws_thread = None
        collected_logs = []  # Store all logs here
        
        # Get workflow context from the params
        workflow_id = params.get('workflow_id')
        event_id = params.get('event_id')
        agent_name = params.get('agent_name')
        agent_id = params.get('agent_id')
        user_id = params.get('user_id')
        username = params.get('username')
        
        # Check if this is an internal workflow
        is_internal = False
        if workflow_id:
            workflow = self.workflow_collection.find_one({"flow_id": workflow_id})
            is_internal = not workflow.get("IsExternal", False) if workflow else False
        
        # Initialize partial responses tracking
        partial_responses = {}
        
        # WebSocket event handlers
        def on_message(ws, message):
            """Handle incoming WebSocket messages"""
            try:
                log_data_obj = json.loads(message)
                # DEBUG: Print to terminal
                print("\n=== WEBSOCKET LOG RECEIVED ===")
                print(json.dumps(log_data_obj, indent=2))
                print("==============================\n")
                
                # Add to queue and store in collected_logs
                log_entry = {
                    "type": "log",
                    "data": log_data_obj,
                    "timestamp": datetime.now().isoformat()
                }
                log_queue.put(log_entry)
                collected_logs.append(log_data_obj)  # Store the raw log data
                
                # === ALWAYS EMIT FOR INTERNAL WORKFLOWS (REAL-TIME) ===
                if is_internal and workflow_id and event_id and agent_name:
                    stream_channel = f"workflow*{workflow_id}_{event_id}"
                    
                    # Emit the log immediately as it's received
                    payload = {
                        "workflow_id": workflow_id,
                        "event_id": event_id,
                        "agent_name": agent_name,
                        "agent_id": agent_id,
                        "user_id": user_id,
                        "username": username,
                        "status": "streaming",
                        "type": "log",
                        "log": log_data_obj,
                        "timestamp": datetime.now().isoformat()
                    }
                    self.socketio.emit(stream_channel, payload)
                    print(f"📋 Streamed log for {agent_name}: {log_data_obj.get('feature', log_data_obj.get('event_type', 'unknown'))}")
                    
                    # Also check for output content and stream as chunk
                    output_content = None
                    if "output" in log_data_obj:
                        output_content = log_data_obj["output"]
                    elif "content" in log_data_obj:
                        output_content = log_data_obj["content"]
                    elif "message" in log_data_obj:
                        output_content = log_data_obj["message"]
                    elif "response" in log_data_obj:
                        output_content = log_data_obj["response"]
                    
                    # If we found output content, stream it as a chunk
                    if output_content:
                        # Initialize partial_responses tracking if not exists
                        if agent_name not in partial_responses:
                            partial_responses[agent_name] = ""
                        
                        partial_responses[agent_name] += str(output_content)
                        
                        chunk_payload = {
                            "workflow_id": workflow_id,
                            "event_id": event_id,
                            "agent_name": agent_name,
                            "agent_id": agent_id,
                            "user_id": user_id,
                            "username": username,
                            "status": "streaming",
                            "type": "agent_response_chunk",
                            "chunk": str(output_content),
                            "partial_response": partial_responses[agent_name],
                            "timestamp": datetime.now().isoformat()
                        }
                        self.socketio.emit(stream_channel, chunk_payload)
                        print(f"🔄 Streamed content for {agent_name}: {str(output_content)[:50]}...")
                    
            except Exception as e:
                print(f"Error parsing WebSocket message: {e}")
                print(f"Raw message: {message}")
        
        def on_error(ws, error):
            """Handle WebSocket errors"""
            print(f" WebSocket error: {error}")
            print(f"Websocket Error due to connection closed--5")
            log_queue.put({
                "type": "error",
                "message": str(error),
                "timestamp": datetime.now().isoformat()
            })
        
        def on_close(ws, close_status_code, close_msg):
            """Handle WebSocket connection close"""
            print(f"WebSocket connection closed. Code: {close_status_code}, Message: {close_msg}")
            log_queue.put({
                "type": "control",
                "message": "ws_closed",
                "timestamp": datetime.now().isoformat()
            })
        
        def on_open(ws):
            """Handle WebSocket connection open"""
            print("WebSocket connection opened")
            log_queue.put({
                "type": "control",
                "message": "ws_opened",
                "timestamp": datetime.now().isoformat()
            })
        
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
            
            # Make the actual API call
            print("Calling Lyzr Agent API")
            response = requests.post(config['api_url'], headers=headers, json=payload, timeout=300)
            
            # Wait a bit more for any remaining logs
            time.sleep(2)
            
            # Close WebSocket connection
            if ws_thread and ws_thread.is_alive():
                ws.close()
                ws_thread.join(timeout=5)
            
            # Extract response
            if response.status_code == 200:
                agent_response = response.json().get('response', '')
            else:
                agent_response = f"Error {response.status_code}: {response.text}"
            
            # Return response with collected logs
            return {
                'response': agent_response,
                'logs': collected_logs,
                'status_code': response.status_code
            }
            
        except Exception as e:
            print(f"Error in call_lyzr_agent: {str(e)}")
            # Close WebSocket on error
            if ws_thread and ws_thread.is_alive():
                try:
                    ws.close()
                    ws_thread.join(timeout=5)
                except:
                    pass
            
            return {
                'response': f"Request failed: {str(e)}",
                'logs': collected_logs,
                'status_code': 500
            }
        
    # def _save_agent_response(self, workflow_id, event_id, task_idx, agent_id, agent_name, prompt, response, session_id=None, user_id=None, username=None, next_call=None, logs=None, master_agent_id=None):
    #     # Debug: Log received parameters
    #     if logs:
    #         for i, log in enumerate(logs[:3]):  # Show first 3 logs
    #             print(f"      Log {i}: {log.get('event_type', 'unknown') if isinstance(log, dict) else type(log)}")
    #     print(f"{'='*60}\n")
        
    #     # Process and structure logs if provided
    #     processed_logs = []
    #     log_summary = {
    #         "total_logs": 0,
    #         "log_types": {},
    #         "features": set(),
    #         "status_values": set(),
    #         "event_types": set(),
    #         "first_log_timestamp": None,
    #         "last_log_timestamp": None
    #     }
        
    #     if logs and isinstance(logs, list):
    #         try:
    #             for log_entry in logs:
    #                 if isinstance(log_entry, dict):
    #                     # Use log entry as-is for real_time_logs
    #                     processed_logs.append(log_entry)
                        
    #                     # Update summary statistics
    #                     log_type = log_entry.get("event_type", "unknown")
    #                     log_summary["log_types"][log_type] = log_summary["log_types"].get(log_type, 0) + 1
                        
    #                     if "feature" in log_entry:
    #                         log_summary["features"].add(log_entry.get("feature"))
    #                     if "status" in log_entry:
    #                         log_summary["status_values"].add(log_entry.get("status"))
    #                     if "event_type" in log_entry:
    #                         log_summary["event_types"].add(log_entry.get("event_type"))
                        
    #                     # Track first and last timestamp
    #                     if "timestamp" in log_entry:
    #                         if not log_summary["first_log_timestamp"]:
    #                             log_summary["first_log_timestamp"] = log_entry.get("timestamp")
    #                         log_summary["last_log_timestamp"] = log_entry.get("timestamp")
    #                 else:
    #                     # If log_entry is a string, wrap it
    #                     enriched_log = {
    #                         "raw_message": str(log_entry),
    #                         "timestamp": datetime.now(timezone.utc).isoformat()
    #                     }
    #                     processed_logs.append(enriched_log)
                
    #             # Convert sets to lists for MongoDB serialization
    #             log_summary["features"] = list(log_summary["features"])
    #             log_summary["status_values"] = list(log_summary["status_values"])
    #             log_summary["event_types"] = list(log_summary["event_types"])
    #             log_summary["total_logs"] = len(processed_logs)
                
    #         except Exception as log_process_error:
    #             print(f" Error processing logs: {log_process_error}")
    #             log_summary["processing_error"] = str(log_process_error)
        
    #     # Get current timestamp in MongoDB format
    #     current_timestamp = datetime.now(timezone.utc)
        
    #     # Build the database document in MongoDB format
    #     doc = {
    #         "_id": ObjectId(),
    #         "event_id": event_id,
    #         "user_query": prompt,
    #         "prompt_output": str(response),
    #         "agent_id": agent_id,
    #         "agent_name": agent_name,
    #         "status": "completed",
    #         "session_id": session_id or str(uuid.uuid4()),
    #         "feedback_rating": None,
    #         "feedback_comments": "",
    #         "created_ts": current_timestamp,
    #         "updated_ts": current_timestamp,
    #         "user_id": user_id,
    #         "master_agent_id": master_agent_id,
    #         "workflow_id": workflow_id,
    #         "task_index": task_idx,
    #         "username": username,
    #         "real_time_logs": processed_logs if processed_logs else []
    #     }
        
    #     # Add real_time_logs if available
    #     if processed_logs:
    #         doc["real_time_logs"] = processed_logs

    #     request_id = request.headers.get("X-Request-Id", "-")
        
    #     try:
            
    #         current_user = get_current_user()
    #         prj_name = current_user.get('ActiveProject', self.config.config.get("MONGODB_COLLECTION_NAME_MASTER", "App Engineering")) if current_user else "App Engineering"
                
    #         project_doc = self.project.find_one({'projectName': prj_name})
    #         user_type = project_doc['database_name'] if project_doc else self.config.config["MONGODB_COLLECTION_NAME_MASTER"]
            
    #         # Insert the complete document
    #         insert_op = {'type': 'insert_one', 'document': doc}
    #         self._query_db('workflow_response_collection', insert_op, user_type=user_type)
    #         print(f" Saved agent response: {agent_name} (idx={task_idx}) with {len(processed_logs)} logs")
            
    #         # -------------------------
    #         # REAL-TIME UPDATE VIA SOCKET.IO
    #         # -------------------------
    #         stream_channel = f"workflow*{workflow_id}_{event_id}"
    #         log_data(request_id, f"stream channel workflow*{workflow_id}_{event_id}")
    #         print(f"   Channel: {stream_channel}")
            
    #         payload = {
    #             "workflow_id": workflow_id,
    #             "event_id": event_id,
    #             "task_index": task_idx,
    #             "agent_name": agent_name,
    #             "agent_id": agent_id,
    #             "prompt_output": str(response),
    #             "user_query": prompt,
    #             "user_id": user_id,
    #             "username": username,
    #             "call_next": next_call,
    #             "status": "completed",
    #             "created_ts": current_timestamp.isoformat(),
    #             "updated_ts": current_timestamp.isoformat()
    #         }
            
    #         # Add real-time logs to the Socket.IO payload
    #         if processed_logs:
    #             payload["real_time_logs"] = processed_logs
    #             payload["log_count"] = len(processed_logs)
            
    #         log_data(request_id, "agent response sent with logs", {
    #             **payload,
    #             "prompt_output": "[TRUNCATED]",
    #             "real_time_logs": f"[{len(processed_logs)} entries]"
    #         })
            
    #         print(f"   Payload: {len(processed_logs)} logs included")
            
    #         # Emit via Socket.IO
    #         self.socketio.emit(stream_channel, payload)
    #         print(f" Real-time update emitted")
            
    #     except Exception as e:
    #         print(f" Failed to save agent response: {e}")
    #         traceback.print_exc()
 
    def _save_agent_response_old(self, workflow_id, event_id, task_idx, agent_id, agent_name, prompt, response, session_id=None, user_id=None, username=None, next_call=None, logs=None, master_agent_id=None):
        # Debug: Log received parameters
        if logs:
            for i, log in enumerate(logs[:3]):  # Show first 3 logs
                print(f"      Log {i}: {log.get('event_type', 'unknown') if isinstance(log, dict) else type(log)}")
        print(f"{'='*60}\n")

        # Check if this is an internal workflow
        workflow = self.workflow_collection.find_one({"flow_id": workflow_id})
        is_external = workflow.get("IsExternal", False) if workflow else False

        # Process and structure logs if provided
        processed_logs = []
        log_summary = {
            "total_logs": 0,
            "log_types": {},
            "features": set(),
            "status_values": set(),
            "event_types": set(),
            "first_log_timestamp": None,
            "last_log_timestamp": None
        }

        if logs and isinstance(logs, list):
            try:
                for log_entry in logs:
                    if isinstance(log_entry, dict):
                        # Use log entry as-is for real_time_logs
                        processed_logs.append(log_entry)
                        
                        # Update summary statistics
                        log_type = log_entry.get("event_type", "unknown")
                        log_summary["log_types"][log_type] = log_summary["log_types"].get(log_type, 0) + 1
                        
                        if "feature" in log_entry:
                            log_summary["features"].add(log_entry.get("feature"))
                        if "status" in log_entry:
                            log_summary["status_values"].add(log_entry.get("status"))
                        if "event_type" in log_entry:
                            log_summary["event_types"].add(log_entry.get("event_type"))
                        
                        # Track first and last timestamp
                        if "timestamp" in log_entry:
                            if not log_summary["first_log_timestamp"]:
                                log_summary["first_log_timestamp"] = log_entry.get("timestamp")
                            log_summary["last_log_timestamp"] = log_entry.get("timestamp")
                    else:
                        # If log_entry is a string, wrap it
                        enriched_log = {
                            "raw_message": str(log_entry),
                            "timestamp": datetime.now(timezone.utc).isoformat()
                        }
                        processed_logs.append(enriched_log)
                
                # Convert sets to lists for MongoDB serialization
                log_summary["features"] = list(log_summary["features"])
                log_summary["status_values"] = list(log_summary["status_values"])
                log_summary["event_types"] = list(log_summary["event_types"])
                log_summary["total_logs"] = len(processed_logs)
                
            except Exception as log_process_error:
                print(f" Error processing logs: {log_process_error}")
                log_summary["processing_error"] = str(log_process_error)

        # Get current timestamp in MongoDB format
        current_timestamp = datetime.now(timezone.utc)

        # Build the database document in MongoDB format
        doc = {
            "_id": ObjectId(),
            "event_id": event_id,
            "user_query": prompt,
            "prompt_output": str(response),
            "agent_id": agent_id,
            "agent_name": agent_name,
            "status": "completed",
            "session_id": session_id or str(uuid.uuid4()),
            "feedback_rating": None,
            "feedback_comments": "",
            "created_ts": current_timestamp,
            "updated_ts": current_timestamp,
            "user_id": user_id,
            "master_agent_id": master_agent_id,
            "workflow_id": workflow_id,
            "task_index": task_idx,
            "username": username,
            "real_time_logs": processed_logs if processed_logs else []
        }

        # Add real_time_logs if available
        if processed_logs:
            doc["real_time_logs"] = processed_logs

        request_id = request.headers.get("X-Request-Id", "-")

        try:
            current_user = get_current_user()
            prj_name = current_user.get('ActiveProject', self.config.config.get("MONGODB_COLLECTION_NAME_MASTER", "App Engineering")) if current_user else "App Engineering"
                
            project_doc = self.project.find_one({'projectName': prj_name})
            user_type = project_doc['database_name'] if project_doc else self.config.config["MONGODB_COLLECTION_NAME_MASTER"]
            
            # Insert the complete document
            insert_op = {'type': 'insert_one', 'document': doc}
            self._query_db('workflow_response_collection', insert_op, user_type=user_type)
            print(f" Saved agent response: {agent_name} (idx={task_idx}) with {len(processed_logs)} logs")
            
            # -------------------------
            # REAL-TIME UPDATE VIA SOCKET.IO
            # -------------------------
            stream_channel = f"workflow*{workflow_id}_{event_id}"
            log_data(request_id, f"stream channel workflow*{workflow_id}_{event_id}")
            print(f"   Channel: {stream_channel}")
            
            payload = {
                "workflow_id": workflow_id,
                "event_id": event_id,
                "task_index": task_idx,
                "agent_name": agent_name,
                "agent_id": agent_id,
                "prompt_output": str(response),
                "user_query": prompt,
                "user_id": user_id,
                "username": username,
                "call_next": next_call,
                "status": "completed",
                "created_ts": current_timestamp.isoformat(),
                "updated_ts": current_timestamp.isoformat()
            }
            
            # Add real-time logs to the Socket.IO payload
            if processed_logs:
                payload["real_time_logs"] = processed_logs
                payload["log_count"] = len(processed_logs)
            
            log_data(request_id, "agent response sent with logs", {
                **payload,
                "prompt_output": "[TRUNCATED]",
                "real_time_logs": f"[{len(processed_logs)} entries]"
            })
            
            print(f"   Payload: {len(processed_logs)} logs included")
            
            # Emit via Socket.IO
            self.socketio.emit(stream_channel, payload)
            print(f" Real-time update emitted")
            
        except Exception as e:
            print(f" Failed to save agent response: {e}")
            traceback.print_exc()      
            
    def _save_agent_response_old(self, workflow_id, event_id, task_idx, agent_id, agent_name, prompt, response, session_id=None, user_id=None, username=None, next_call=None, logs=None, master_agent_id=None):
        # Debug: Log received parameters
        if logs:
            for i, log in enumerate(logs[:3]):  # Show first 3 logs
                print(f"      Log {i}: {log.get('event_type', 'unknown') if isinstance(log, dict) else type(log)}")
        print(f"{'='*60}\n")

        # Check if this is an internal workflow
        workflow = self.workflow_collection.find_one({"flow_id": workflow_id})
        is_external = workflow.get("IsExternal", False) if workflow else False

        # Process and structure logs if provided
        processed_logs = []
        log_summary = {
            "total_logs": 0,
            "log_types": {},
            "features": set(),
            "status_values": set(),
            "event_types": set(),
            "first_log_timestamp": None,
            "last_log_timestamp": None
        }

        if logs and isinstance(logs, list):
            try:
                for log_entry in logs:
                    if isinstance(log_entry, dict):
                        # Use log entry as-is for real_time_logs
                        processed_logs.append(log_entry)
                        
                        # Update summary statistics
                        log_type = log_entry.get("event_type", "unknown")
                        log_summary["log_types"][log_type] = log_summary["log_types"].get(log_type, 0) + 1
                        
                        if "feature" in log_entry:
                            log_summary["features"].add(log_entry.get("feature"))
                        if "status" in log_entry:
                            log_summary["status_values"].add(log_entry.get("status"))
                        if "event_type" in log_entry:
                            log_summary["event_types"].add(log_entry.get("event_type"))
                        
                        # Track first and last timestamp
                        if "timestamp" in log_entry:
                            if not log_summary["first_log_timestamp"]:
                                log_summary["first_log_timestamp"] = log_entry.get("timestamp")
                            log_summary["last_log_timestamp"] = log_entry.get("timestamp")
                    else:
                        # If log_entry is a string, wrap it
                        enriched_log = {
                            "raw_message": str(log_entry),
                            "timestamp": datetime.now(timezone.utc).isoformat()
                        }
                        processed_logs.append(enriched_log)
                
                # Convert sets to lists for MongoDB serialization
                log_summary["features"] = list(log_summary["features"])
                log_summary["status_values"] = list(log_summary["status_values"])
                log_summary["event_types"] = list(log_summary["event_types"])
                log_summary["total_logs"] = len(processed_logs)
                
            except Exception as log_process_error:
                print(f" Error processing logs: {log_process_error}")
                log_summary["processing_error"] = str(log_process_error)

        # Get current timestamp in MongoDB format
        current_timestamp = datetime.now(timezone.utc)

        # Build the database document in MongoDB format
        doc = {
            "_id": ObjectId(),
            "event_id": event_id,
            "user_query": prompt,
            "prompt_output": str(response),
            "agent_id": agent_id,
            "agent_name": agent_name,
            "status": "completed",
            "session_id": session_id or str(uuid.uuid4()),
            "feedback_rating": None,
            "feedback_comments": "",
            "created_ts": current_timestamp,
            "updated_ts": current_timestamp,
            "user_id": user_id,
            "master_agent_id": master_agent_id,
            "workflow_id": workflow_id,
            "task_index": task_idx,
            "username": username,
            "real_time_logs": processed_logs if processed_logs else []
        }

        # Add real_time_logs if available
        if processed_logs:
            doc["real_time_logs"] = processed_logs

        request_id = request.headers.get("X-Request-Id", "-")

        try:
            current_user = get_current_user()
            prj_name = current_user.get('ActiveProject', self.config.config.get("MONGODB_COLLECTION_NAME_MASTER", "App Engineering")) if current_user else "App Engineering"
                
            project_doc = self.project.find_one({'projectName': prj_name})
            user_type = project_doc['database_name'] if project_doc else self.config.config["MONGODB_COLLECTION_NAME_MASTER"]
            
            # Insert the complete document
            insert_op = {'type': 'insert_one', 'document': doc}
            self._query_db('workflow_response_collection', insert_op, user_type=user_type)
            print(f" Saved agent response: {agent_name} (idx={task_idx}) with {len(processed_logs)} logs")
            
            # -------------------------
            # REAL-TIME UPDATE VIA SOCKET.IO
            # -------------------------
            stream_channel = f"workflow*{workflow_id}_{event_id}"
            log_data(request_id, f"stream channel workflow*{workflow_id}_{event_id}")
            print(f"   Channel: {stream_channel}")
            
            # For external workflows, emit logs all at once (existing behavior)
            if is_external and processed_logs:
                payload = {
                    "workflow_id": workflow_id,
                    "event_id": event_id,
                    "agent_name": agent_name,
                    "agent_id": agent_id,
                    "user_id": user_id,
                    "username": username,
                    "status": "streaming",
                    "type": "log",
                    "log": processed_logs,  # Send all logs at once for external workflows
                    "timestamp": datetime.now().isoformat()
                }
                self.socketio.emit(stream_channel, payload)
                print(f"📋 Streamed all logs for external workflow agent: {agent_name}")
            
            # Emit the final completion status (without logs for internal workflows)
            payload = {
                "workflow_id": workflow_id,
                "event_id": event_id,
                "task_index": task_idx,
                "agent_name": agent_name,
                "agent_id": agent_id,
                "prompt_output": str(response),
                "user_query": prompt,
                "user_id": user_id,
                "username": username,
                "call_next": next_call,
                "status": "completed",
                "created_ts": current_timestamp.isoformat(),
                "updated_ts": current_timestamp.isoformat()
            }
            
            # Only include logs in the payload for external workflows
            if is_external and processed_logs:
                payload["real_time_logs"] = processed_logs
                payload["log_count"] = len(processed_logs)
            
            log_data(request_id, "agent response sent", {
                **payload,
                "prompt_output": "[TRUNCATED]",
                "real_time_logs": f"[{len(processed_logs)} entries]" if is_external else "[emitted individually]"
            })
            
            print(f"   Payload: {len(processed_logs)} logs included")
            
            # Emit via Socket.IO
            self.socketio.emit(stream_channel, payload)
            print(f" Real-time update emitted")
            
        except Exception as e:
            print(f" Failed to save agent response: {e}")
            traceback.print_exc()     

    def _save_agent_response_o(self, workflow_id, event_id, task_idx, agent_id, agent_name, prompt, response, session_id=None, user_id=None, username=None, next_call=None, logs=None, master_agent_id=None):
        # Debug: Log received parameters
        if logs:
            for i, log in enumerate(logs[:3]):  # Show first 3 logs
                print(f"      Log {i}: {log.get('event_type', 'unknown') if isinstance(log, dict) else type(log)}")
        print(f"{'='*60}\n")

        # Check if this is an internal workflow
        workflow = self.workflow_collection.find_one({"flow_id": workflow_id})
        is_external = workflow.get("IsExternal", False) if workflow else False
        
        api_agent_id_to_save = agent_id
        if workflow:
            tasks = workflow.get('flow_data', {}).get('tasks', [])
            # Find the task that matches the current agent
            for task in tasks:
                if task.get('function') == 'call_lyzr_agent' and task.get('params', {}).get('config', {}).get('agent_name') == agent_name:
                    # Found the task, get its api_agent_id
                    api_agent_id_to_save = task.get('params', {}).get('config', {}).get('api_agent_id') or agent_id
                    print(f"Found api_agent_id for '{agent_name}': {api_agent_id_to_save}")
                    break
                
        # Process and structure logs if provided
        processed_logs = []
        log_summary = {
            "total_logs": 0,
            "log_types": {},
            "features": set(),
            "status_values": set(),
            "event_types": set(),
            "first_log_timestamp": None,
            "last_log_timestamp": None
        }

        if logs and isinstance(logs, list):
            try:
                for log_entry in logs:
                    if isinstance(log_entry, dict):
                        # Use log entry as-is for real_time_logs
                        processed_logs.append(log_entry)
                        
                        # Update summary statistics
                        log_type = log_entry.get("event_type", "unknown")
                        log_summary["log_types"][log_type] = log_summary["log_types"].get(log_type, 0) + 1
                        
                        if "feature" in log_entry:
                            log_summary["features"].add(log_entry.get("feature"))
                        if "status" in log_entry:
                            log_summary["status_values"].add(log_entry.get("status"))
                        if "event_type" in log_entry:
                            log_summary["event_types"].add(log_entry.get("event_type"))
                        
                        # Track first and last timestamp
                        if "timestamp" in log_entry:
                            if not log_summary["first_log_timestamp"]:
                                log_summary["first_log_timestamp"] = log_entry.get("timestamp")
                            log_summary["last_log_timestamp"] = log_entry.get("timestamp")
                    else:
                        # If log_entry is a string, wrap it
                        enriched_log = {
                            "raw_message": str(log_entry),
                            "timestamp": datetime.now(timezone.utc).isoformat()
                        }
                        processed_logs.append(enriched_log)
                
                # Convert sets to lists for MongoDB serialization
                log_summary["features"] = list(log_summary["features"])
                log_summary["status_values"] = list(log_summary["status_values"])
                log_summary["event_types"] = list(log_summary["event_types"])
                log_summary["total_logs"] = len(processed_logs)
                
            except Exception as log_process_error:
                print(f" Error processing logs: {log_process_error}")
                log_summary["processing_error"] = str(log_process_error)

        # Get current timestamp in MongoDB format
        current_timestamp = datetime.now(timezone.utc)

        # Build the database document in MongoDB format
        doc = {
            "_id": ObjectId(),
            "event_id": event_id,
            "user_query": prompt,
            "prompt_output": str(response),
            "agent_id": api_agent_id_to_save,
            "agent_name": agent_name,
            "status": "completed",
            "session_id": session_id or str(uuid.uuid4()),
            "feedback_rating": None,
            "feedback_comments": "",
            "created_ts": current_timestamp,
            "updated_ts": current_timestamp,
            "user_id": user_id,
            "master_agent_id": master_agent_id,
            "workflow_id": workflow_id,
            "task_index": task_idx,
            "username": username,
            "real_time_logs": processed_logs if processed_logs else []
        }

        # Add real_time_logs if available
        if processed_logs:
            doc["real_time_logs"] = processed_logs

        request_id = request.headers.get("X-Request-Id", "-")

        try:
            current_user = get_current_user()
            prj_name = current_user.get('ActiveProject', self.config.config.get("MONGODB_COLLECTION_NAME_MASTER", "App Engineering")) if current_user else "App Engineering"
                
            project_doc = self.project.find_one({'projectName': prj_name})
            user_type = project_doc['database_name'] if project_doc else self.config.config["MONGODB_COLLECTION_NAME_MASTER"]
            
            # Insert the complete document
            insert_op = {'type': 'insert_one', 'document': doc}
            self._query_db('workflow_response_collection', insert_op, user_type=user_type)
            print(f" Saved agent response: {agent_name} (idx={task_idx}) with {len(processed_logs)} logs")
            
            # -------------------------
            # REAL-TIME UPDATE VIA SOCKET.IO
            # -------------------------
            stream_channel = f"workflow*{workflow_id}_{event_id}"
            log_data(request_id, f"stream channel workflow*{workflow_id}_{event_id}")
            print(f"   Channel: {stream_channel}")
            
            # For external workflows, emit logs all at once (existing behavior)
            if is_external and processed_logs:
                payload = {
                    "workflow_id": workflow_id,
                    "event_id": event_id,
                    "agent_name": agent_name,
                    "agent_id": agent_id,
                    "user_id": user_id,
                    "username": username,
                    "status": "streaming",
                    "type": "log",
                    "log": processed_logs,  # Send all logs at once for external workflows
                    "timestamp": datetime.now().isoformat()
                }
                self.socketio.emit(stream_channel, payload)
                print(f"📋 Streamed all logs for external workflow agent: {agent_name}")
            
            # Emit the final completion status (without logs for internal workflows)
            payload = {
                "workflow_id": workflow_id,
                "event_id": event_id,
                "task_index": task_idx,
                "agent_name": agent_name,
                "agent_id": agent_id,
                "prompt_output": str(response),
                "user_query": prompt,
                "user_id": user_id,
                "username": username,
                "call_next": next_call,
                "status": "completed",
                "created_ts": current_timestamp.isoformat(),
                "updated_ts": current_timestamp.isoformat()
            }
            
            # Only include logs in the payload for external workflows
            if is_external and processed_logs:
                payload["real_time_logs"] = processed_logs
                payload["log_count"] = len(processed_logs)
            
            log_data(request_id, "agent response sent", {
                **payload,
                "prompt_output": "[TRUNCATED]",
                "real_time_logs": f"[{len(processed_logs)} entries]" if is_external else "[emitted individually]"
            })
            
            print(f"   Payload: {len(processed_logs)} logs included")
            
            # Emit via Socket.IO
            self.socketio.emit(stream_channel, payload)
            print(f" Real-time update emitted")
            
        except Exception as e:
            print(f" Failed to save agent response: {e}")
            traceback.print_exc()     

    def _save_agent_response(self, workflow_id, event_id, task_idx, agent_id, agent_name, prompt, response, 
                            session_id=None, user_id=None, username=None, next_call=None, logs=None, 
                            master_agent_id=None, suppress_emit=False):   
        # Debug: Log received parameters
        if logs:
            for i, log in enumerate(logs[:3]): # Show first 3 logs
                print(f" Log {i}: {log.get('event_type', 'unknown') if isinstance(log, dict) else type(log)}")
        print(f"{'='*60}\n")

        # Check if this is an internal workflow
        workflow = self.workflow_collection.find_one({"flow_id": workflow_id})
        is_external = workflow.get("IsExternal", False) if workflow else False
       
        api_agent_id_to_save = agent_id
        if workflow:
            tasks = workflow.get('flow_data', {}).get('tasks', [])
            # Find the task that matches the current agent
            for task in tasks:
                if task.get('function') == 'call_lyzr_agent' and task.get('params', {}).get('config', {}).get('agent_name') == agent_name:
                    api_agent_id_to_save = task.get('params', {}).get('config', {}).get('api_agent_id') or agent_id
                    print(f"Found api_agent_id for '{agent_name}': {api_agent_id_to_save}")
                    break
               
        # Process and structure logs if provided
        processed_logs = []
        log_summary = {
            "total_logs": 0,
            "log_types": {},
            "features": set(),
            "status_values": set(),
            "event_types": set(),
            "first_log_timestamp": None,
            "last_log_timestamp": None
        }
        if logs and isinstance(logs, list):
            try:
                for log_entry in logs:
                    if isinstance(log_entry, dict):
                        processed_logs.append(log_entry)
                       
                        log_type = log_entry.get("event_type", "unknown")
                        log_summary["log_types"][log_type] = log_summary["log_types"].get(log_type, 0) + 1
                       
                        if "feature" in log_entry:
                            log_summary["features"].add(log_entry.get("feature"))
                        if "status" in log_entry:
                            log_summary["status_values"].add(log_entry.get("status"))
                        if "event_type" in log_entry:
                            log_summary["event_types"].add(log_entry.get("event_type"))
                       
                        if "timestamp" in log_entry:
                            if not log_summary["first_log_timestamp"]:
                                log_summary["first_log_timestamp"] = log_entry.get("timestamp")
                            log_summary["last_log_timestamp"] = log_entry.get("timestamp")
                    else:
                        enriched_log = {
                            "raw_message": str(log_entry),
                            "timestamp": datetime.now(timezone.utc).isoformat()
                        }
                        processed_logs.append(enriched_log)
               
                log_summary["features"] = list(log_summary["features"])
                log_summary["status_values"] = list(log_summary["status_values"])
                log_summary["event_types"] = list(log_summary["event_types"])
                log_summary["total_logs"] = len(processed_logs)
               
            except Exception as log_process_error:
                print(f" Error processing logs: {log_process_error}")
                log_summary["processing_error"] = str(log_process_error)

        # Get current timestamp in MongoDB format
        current_timestamp = datetime.now(timezone.utc)

        # Build the database document in MongoDB format
        doc = {
            "_id": ObjectId(),
            "event_id": event_id,
            "user_query": prompt,
            "prompt_output": str(response),
            "agent_id": api_agent_id_to_save,
            "agent_name": agent_name,
            "status": "completed",
            "session_id": session_id or str(uuid.uuid4()),
            "feedback_rating": None,
            "feedback_comments": "",
            "created_ts": current_timestamp,
            "updated_ts": current_timestamp,
            "user_id": user_id,
            "master_agent_id": master_agent_id,
            "workflow_id": workflow_id,
            "task_index": task_idx,
            "username": username,
            "real_time_logs": processed_logs if processed_logs else []
        }

        if processed_logs:
            doc["real_time_logs"] = processed_logs

        request_id = request.headers.get("X-Request-Id", "-")

        try:
            current_user = get_current_user()
            prj_name = current_user.get('ActiveProject', self.config.config.get("MONGODB_COLLECTION_NAME_MASTER", "App Engineering")) if current_user else "App Engineering"
               
            project_doc = self.project.find_one({'projectName': prj_name})
            user_type = project_doc['database_name'] if project_doc else self.config.config["MONGODB_COLLECTION_NAME_MASTER"]
           
            # Insert the complete document
            insert_op = {'type': 'insert_one', 'document': doc}
            self._query_db('workflow_response_collection', insert_op, user_type=user_type)
            print(f" Saved agent response: {agent_name} (idx={task_idx}) with {len(processed_logs)} logs")
           
            # -------------------------
            # REAL-TIME UPDATE VIA SOCKET.IO   ← MODIFIED PART
            # -------------------------
            stream_channel = f"workflow*{workflow_id}_{event_id}"
            log_data(request_id, f"stream channel workflow*{workflow_id}_{event_id}")
            print(f" Channel: {stream_channel}")
           
            # For external workflows, emit logs all at once
            if is_external and processed_logs:
                payload = {
                    "workflow_id": workflow_id,
                    "event_id": event_id,
                    "agent_name": agent_name,
                    "agent_id": agent_id,
                    "user_id": user_id,
                    "username": username,
                    "status": "streaming",
                    "type": "log",
                    "log": processed_logs,
                    "timestamp": datetime.now().isoformat()
                }
                self.socketio.emit(stream_channel, payload)
                print(f"📋 Streamed all logs for external workflow agent: {agent_name}")
           
            # === MODIFIED: Emit completed only if not suppressed ===
            if not suppress_emit:
                payload = {
                    "workflow_id": workflow_id,
                    "event_id": event_id,
                    "task_index": task_idx,
                    "agent_name": agent_name,
                    "agent_id": agent_id,
                    "prompt_output": str(response),
                    "user_query": prompt,
                    "user_id": user_id,
                    "username": username,
                    "call_next": next_call,
                    "status": "completed",
                    "created_ts": current_timestamp.isoformat(),
                    "updated_ts": current_timestamp.isoformat()
                }
               
                if is_external and processed_logs:
                    payload["real_time_logs"] = processed_logs
                    payload["log_count"] = len(processed_logs)
               
                log_data(request_id, "agent response sent", {
                    **payload,
                    "prompt_output": "[TRUNCATED]",
                    "real_time_logs": f"[{len(processed_logs)} entries]" if is_external else "[emitted individually]"
                })
               
                print(f" Payload: {len(processed_logs)} logs included")
               
                # Emit via Socket.IO
                self.socketio.emit(stream_channel, payload)
                print(f" Real-time update emitted")
            else:
                print(f" Emit suppressed for {agent_name} (during iteration)")

        except Exception as e:
            print(f" Failed to save agent response: {e}")
            traceback.print_exc()

    
    
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
                summary = re.sub(r'^(#+|\*+)', '', summary).strip()  # Fixed: Added parentheses to group
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
                    'user_message': {'value': json.dumps(single_payload)}  # Critical: single object, no "issueUpdates"
                }
                next_call = task['call_next']
                if task['params'].get('assets'):
                    lyzr_params['assets'] = task['params']['assets']

                push_session_id = str(uuid.uuid4())
                result = self.call_lyzr_agent(lyzr_params, session_id=push_session_id, user_id=user_id)

                # Handle the new dictionary response format
                if isinstance(result, dict):
                    resp = result.get('response', '')
                    collected_logs = result.get('logs', [])
                else:
                    resp = result or ""
                    collected_logs = []


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
                    session_id=push_session_id, user_id=user_id, username=username, next_call = next_call,logs=collected_logs
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
    
    
    def _emit_agent_status(self, workflow_id, event_id, agent_name, agent_id, user_id, username, status="Started"):
        """Helper to emit agent status via socketio"""
        stream_channel = f"workflow*{workflow_id}_{event_id}"
        print("eee", stream_channel)
        payload = {
            "workflow_id": workflow_id,
            "event_id": event_id,
            "agent_name": agent_name,
            "agent_id": agent_id,
            "user_id": user_id,
            "username": username,
            "status": status
        }
        self.socketio.emit(stream_channel, payload)
        print(f" Saved emitted")

    # def _run_conditional_from_task(self, start_task_name, initial_input, tasks, **kwargs):
    #     """Generic conditional runner – no hard-coded agent names!"""
    #     event_id = kwargs.get("event_id")
    #     workflow_id = kwargs.get("workflow_id")
    #     session_id = kwargs.get("session_id")
    #     user_id = kwargs.get("user_id")
    #     username = kwargs.get("username")
 
    #     name_to_task = {t.get("name"): t for t in tasks if t.get("name")}
    #     current_task_name = start_task_name
    #     current_input = initial_input
    #     extracted_issue_key = None
    #     visited = set()

    #     while current_task_name and current_task_name not in visited:
    #         visited.add(current_task_name)
    #         task = name_to_task.get(current_task_name)
    #         if not task:
    #             break
 
    #         agent_name = task["params"]["config"].get("agent_name", "Unknown").lower()
 
    #         # =========================================================
    #         # 1. Normal agent execution
    #         # =========================================================
    #         if task.get("function") == "call_lyzr_agent":
    #             next_call = task["call_next"]
    #             prompt = task.get("user_input", "").strip()
    #             message = f"{prompt}\n\n{current_input}" if prompt else current_input
 
    #             response, agent_session_id, task_logs = self._execute_single_agent_task(task, message, session_id=session_id, user_id=user_id)
    #             self._save_agent_response(
    #                 workflow_id=workflow_id,
    #                 event_id=event_id,
    #                 task_idx=None,
    #                 agent_id=task["params"]["config"].get("agent_id"),
    #                 agent_name=agent_name,
    #                 prompt=message,
    #                 response=response,
    #                 session_id=agent_session_id,
    #                 user_id=user_id,
    #                 username=username,
    #                 next_call=next_call,
    #                 logs=task_logs
    #             )
 
    #             # Jira Connector → extract description
    #             if "jira connector" in agent_name:
    #                 try:
    #                     latest_issues = self.filter_latest_by_updated(response)
    #                     field = task.get("user_input", "description").strip() or "description"
    #                     extracted = self.extract_descriptions(latest_issues, field)
    #                     if extracted:
    #                         extracted_issue_key = extracted[0]["key"]
    #                         current_input = extracted[0]["description"]
    #                 except Exception as e:
    #                     print(f"Jira extract failed: {e}")
    #                     current_input = response
 
    #             # Push to Jira → final step
    #             elif "push to jira" in agent_name:
    #                 new_cur, keys, _, primary = self._bulk_push_to_jira(
    #                     task, current_input, workflow_id, event_id, None,
    #                     task["params"]["config"].get("api_agent_id"),
    #                     agent_name, save_response=True,
    #                     session_id=session_id, user_id=user_id, username=username
    #                 )
    #                 current_input = primary
    #                 if keys:
    #                     extracted_issue_key = keys[0]
    #                 break  # end after push
 
    #             else:
    #                 current_input = response
 
    #         # =========================================================
    #         # 2. CONDITION NODE – fully generic matching
    #         # =========================================================
    #         elif task.get("function") == "condition":
    #             condition_text = task.get("user_input", "").lower().strip()
    #             candidates = task.get("call_next") or task.get("nextcall") or []
    #             candidates = candidates if isinstance(candidates, list) else [candidates]
                
    #             chosen_next = None
    #             condition_words = [w for w in condition_text.split() if len(w.strip(".,!?")) >= 2]
 
    #             for candidate_name in candidates:
    #                 candidate_task = name_to_task.get(candidate_name)
    #                 if not candidate_task:
    #                     continue
 
    #                 target_agent_name = candidate_task["params"]["config"].get("agent_name", "").lower()
    #                 target_agent_id = candidate_task["params"]["config"].get("agent_id", "").lower()
 
    #                 # Match if ANY meaningful word from condition appears in target agent name
    #                 if any(word in target_agent_name for word in condition_words):
    #                     chosen_next = candidate_name
    #                     print(f"CONDITION MATCH → '{condition_text}' → choosing '{target_agent_name}'")
    #                     self._emit_agent_status(workflow_id, event_id, target_agent_name, target_agent_id, user_id, username)
    #                     break
 
    #             # Fallback to first candidate if no match
    #             if not chosen_next and candidates:
    #                 chosen_next = candidates[0]
    #                 fallback_agent = name_to_task[chosen_next]["params"]["config"].get("agent_name", "Unknown")
    #                 fallback_agent_id = name_to_task[chosen_next]["params"]["config"].get("agent_id", "Unknown")
    #                 print(f"No condition match → defaulting to '{fallback_agent}'")
    #                 self._emit_agent_status(workflow_id, event_id, fallback_agent, fallback_agent_id, user_id, username)
 
    #             current_task_name = chosen_next
    #             continue  # skip normal nextcall logic
 
    #         # =========================================================
    #         # 3. Normal nextcall (non-condition nodes)
    #         # =========================================================
    #         nextcall = task.get("call_next") or task.get("nextcall")
    #         if isinstance(nextcall, list):
    #             current_task_name = nextcall[0] if nextcall else None
    #         else:
    #             current_task_name = nextcall
 
    #     return self._wrap_result(extracted_issue_key, current_input)
    
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
        agent_responses = {}  # Track agent responses for this conditional flow

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
                next_call = task["call_next"]
                prompt = task.get("user_input", "").strip()
                message = f"{prompt}\n\n{current_input}" if prompt else current_input
    
                response, agent_session_id, task_logs = self._execute_single_agent_task(task, message, session_id=session_id, user_id=user_id)
                
                # Store agent response for internal workflow
                agent_responses[task["params"]["config"].get("agent_name")] = response
                
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
                    username=username,
                    next_call=next_call,
                    logs=task_logs
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
                condition_words = [w for w in condition_text.split() if len(w.strip(".,!?")) >= 2]
    
                for candidate_name in candidates:
                    candidate_task = name_to_task.get(candidate_name)
                    if not candidate_task:
                        continue
    
                    target_agent_name = candidate_task["params"]["config"].get("agent_name", "").lower()
                    target_agent_id = candidate_task["params"]["config"].get("agent_id", "").lower()
    
                    # Match if ANY meaningful word from condition appears in target agent name
                    if any(word in target_agent_name for word in condition_words):
                        chosen_next = candidate_name
                        print(f"CONDITION MATCH → '{condition_text}' → choosing '{target_agent_name}'")
                        self._emit_agent_status(workflow_id, event_id, target_agent_name, target_agent_id, user_id, username)
                        break
    
                # Fallback to first candidate if no match
                if not chosen_next and candidates:
                    chosen_next = candidates[0]
                    fallback_agent = name_to_task[chosen_next]["params"]["config"].get("agent_name", "Unknown")
                    fallback_agent_id = name_to_task[chosen_next]["params"]["config"].get("agent_id", "Unknown")
                    print(f"No condition match → defaulting to '{fallback_agent}'")
                    self._emit_agent_status(workflow_id, event_id, fallback_agent, fallback_agent_id, user_id, username)
    
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
    
        result = self._wrap_result(extracted_issue_key, current_input)
        
        # Add agent responses to the result
        if isinstance(result, dict):
            result["agent_responses"] = agent_responses
        
        return result

    def workflow_run_agent_details_old(self, data):
        # run the heavy work in a real thread
        threading.Thread(
            target=self._run_workflow,
            args=(data,),
            daemon=True
        ).start()
        
    def workflow_run_agent_details(self, data):
        """
        Starts the workflow in a background thread and returns immediately.
        The client should listen for results via Socket.IO.
        """
        try:
            # Extract IDs needed for the client to listen on the right channel
            workflow_id = data.get('workflow_id', '').strip()
            event_id = data.get('event_id', '').strip()
           
            # Validate that necessary IDs are present
            if not workflow_id or not event_id:
                raise ValueError("workflow_id and event_id are required to start the workflow.")
 
            # Run the heavy work in a real background thread
            # This line is non-blocking and returns immediately
            
            ctx = contextvars.copy_context()
           
            threading.Thread(
                target=ctx.run,
                args=(self._run_workflow, data),
                daemon=True 
            ).start()
 
            # Return an immediate success response with the IDs
            # The client will use these IDs to listen on the correct socket channel
            return {
                "success": True,
                "message": "Workflow started successfully.",
                "workflow_id": workflow_id,
                "event_id": event_id
            }
 
        except Exception as e:
            # Log the exception for server-side debugging
            print(f"Error starting workflow: {e}")
            # Return an error response to the client
            return {
                "success": False,
                "message": f"Failed to start workflow: {str(e)}"
            }
    
    def get_workflow_from_api(self, flow_id):
        """Fetch workflow structure from the Lyzr API"""
        url = f"https://agent-prod.studio.lyzr.ai/v3/workflows/{flow_id}"
        
        # Get the workflow from our database to get the API key
        workflow = self.workflow_collection.find_one({"flow_id": flow_id})
        if not workflow:
            print(f"Workflow not found for ID: {flow_id}")
            return None
        
        api_key = workflow.get("api_key")
        if not api_key:
            print(f"No API key found for workflow: {flow_id}")
            return None
        
        headers = {
            "accept": "application/json",
            "x-api-key": api_key
        }
        
        try:
            response = requests.get(url, headers=headers)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"Error fetching workflow from API: {e}")
            if hasattr(e, 'response') and e.response is not None:
                print(f"Response Status: {e.response.status_code}")
                print(f"Response Body: {e.response.text}")
            return None

    def run_dag(self, workflow_data, flow_name, run_name):
        """Call the Lyzr AI run-dag API with the workflow data"""
        url = "https://lao.studio.lyzr.ai/run-dag/"

        # Extract the flow_data which contains the actual workflow structure
        flow_data = workflow_data.get("flow_data", {})

        # Ensure session_ids are preserved in tasks
        tasks = flow_data.get("tasks", [])
        for task in tasks:
            if task.get("function") == "call_lyzr_agent":
                # Make sure session_id is in the right place for DAG
                task_session_id = task.get("params", {}).get("session_id")
                if task_session_id:
                    # Also put it in config for redundancy
                    if "config" not in task["params"]:
                        task["params"]["config"] = {}
                    task["params"]["config"]["session_id"] = task_session_id
                    print(f"Preserved session_id {task_session_id} for task {task.get('name')}")
                else:
                    print(f"No session_id found in task params for {task.get('name')}")

        # Create the payload with the required fields at the root level
        payload = {
            "flow_id": workflow_data.get("flow_id"),
            "flow_name": workflow_data.get("flow_name"),
            "api_key": workflow_data.get("api_key"),
            "run_name": run_name,
            # Extract these from flow_data and put them at the root level
            "tasks": tasks, 
            "edges": flow_data.get("edges", []),
            "default_inputs": flow_data.get("default_inputs", {}),
            "user_query": flow_data.get("user_query", "")
        }

        headers = {
            "accept": "application/json",
            "Content-Type": "application/json"
        }

        try:
            ##print(f"Sending DAG request for workflow {workflow_data.get('flow_id')}")
            ##print(f"Payload keys: {list(payload.keys())}")
            
            # Debug: Print the payload structure (without sensitive data)
            debug_payload = payload.copy()
            debug_payload["api_key"] = "***REDACTED***"
            ##print(f"Payload structure: {json.dumps(debug_payload, indent=2)}")
            
            # Print session IDs in tasks before sending
            print(f"\n=== DAG PAYLOAD SESSION IDs ===")
            for i, task in enumerate(payload.get("tasks", [])):
                if task.get("function") == "call_lyzr_agent":
                    task_name = task.get("name", "Unknown")
                    task_session = task.get("params", {}).get("session_id", "NOT SET")
                    config_session = task.get("params", {}).get("config", {}).get("session_id", "NOT SET")
                    print(f"Task {i} ({task_name}): params.session_id={task_session}, config.session_id={config_session}")
            
            response = requests.post(url, headers=headers, json=payload)
            
            # Debug response
            print(f"DAG Response Status: {response.status_code}")
            if response.status_code != 200:
                print(f"DAG Response Body: {response.text}")
            
            response.raise_for_status()
            return response.json()
            
        except requests.exceptions.RequestException as e:
            print(f"Error calling run-dag API: {e}")
            # Print more details about the error
            if hasattr(e, 'response') and e.response is not None:
                print(f"Response Status: {e.response.status_code}")
                print(f"Response Body: {e.response.text}")
            return None


    def get_task_status(self, task_id):
        """Get the status of a DAG task from Lyzr AI"""
        url = f"https://lao.studio.lyzr.ai/task-status/{task_id}"
        headers = {
            "accept": "application/json"
        }
        
        try:
            response = requests.get(url, headers=headers)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"Error getting task status: {e}")
            return None

    async def monitor_workflow_via_websocket(
    self,
    ws_url: str,
    workflow_id: str,
    event_id: str,
    session_id: str,
    user_id: str,
    username: str,
    request_id: str = "-",
    prj_name: str = "App Engineering",
    workflow_tasks: list = None,
    agent_configs: dict = None,
    agent_logs: dict = None,
    agent_websockets: dict = None,
    agent_threads: dict = None,
    open_agent_websocket=None,
    close_agent_websocket=None
) -> tuple[str | None, dict]:
        """
        Connect to WebSocket and collect real-time updates until workflow completes or fails.
        Returns final result string and agent_inputs dictionary.
        """
        partials = {}           # agent_name -> current partial text
        final_outputs = {}      # agent_name -> final complete output
        workflow_status = "running"
        final_result = None
        agent_inputs = {}       # agent_name -> combined input given to the agent
        
        # Create task name to agent mapping
        task_name_to_agent = {}
        if workflow_tasks:
            for task in workflow_tasks:
                task_name = task.get("name", "")
                if task_name:
                    config = task.get("params", {}).get("config", {})
                    task_name_to_agent[task_name] = {
                        "agent_id": config.get("agent_id") or config.get("api_agent_id", ""),
                        "agent_name": config.get("agent_name", task_name)
                    }
            print(f"Task name to agent mapping: {task_name_to_agent}")

        def emit_ws_event(agent_name, status, **extra):
            """Helper to emit websocket events with common fields"""
            payload = {
                "workflow_id": workflow_id,
                "event_id": event_id,
                "agent_name": agent_name,
                "user_id": user_id,
                "username": username,
                "status": status,
                **extra
            }
            self.socketio.emit(f"workflow*{workflow_id}_{event_id}", payload)

        def log_agent_response(task_name, agent_id_from_ws, response, task_index=None):
            """Helper to log each agent's response"""
            try:
                agent_info = task_name_to_agent.get(task_name, {})
                final_agent_id = agent_info.get("agent_id") or agent_id_from_ws or ""
                final_agent_name = agent_info.get("agent_name") or task_name or "Unknown"
                
                log_data(request_id, f"stream channel workflow*{workflow_id}_{event_id}")
                log_data(
                    request_id, 
                    "agent response sent", 
                    {
                        "workflow_id": workflow_id, 
                        "event_id": event_id,
                        "agent_id": final_agent_id,
                        "agent_name": final_agent_name,
                        "task_id": agent_id_from_ws,
                        "task_index": task_index,
                        "status": "completed",
                        "response": str(response)[:500] if response else "",
                        "user_id": user_id,
                        "username": username
                    }
                )
            except Exception as e:
                print(f"Failed to log agent response: {e}")

        try:
            async with websockets.connect(
                ws_url,
                ping_interval=20,
                ping_timeout=25,
                max_size=2**20
            ) as websocket:
                print(f"Main WebSocket connected: {ws_url}")

                while workflow_status == "running":
                    try:
                        message = await asyncio.wait_for(websocket.recv(), timeout=60.0)
                    except asyncio.TimeoutError:
                        continue

                    try:
                        data = json.loads(message)
                    except json.JSONDecodeError:
                        print("Invalid JSON received:", message[:120])
                        continue

                    event_type = data.get("event_type", "").lower()
                    task_name = data.get("task_name", "Unknown")
                    task_id = data.get("task_id", "")

                    print("ws_status------", event_type)
                    print("task_name---", task_name)

                    if event_type == "task_started":
                        # === CAPTURE AGENT INPUT ===
                        task = next((t for t in workflow_tasks if t.get("name") == task_name), None)
                        if task:
                            # Initialize input components
                            previous_output = ""
                            agent_own_query = ""
                            
                            # Check if agent has dependencies
                            params = task.get("params", {})
                            has_dependency = False
                            
                            # Find which agent this task depends on
                            for param_key, param_value in params.items():
                                if isinstance(param_value, dict) and "depends" in param_value:
                                    depends_on = param_value["depends"]
                                    print(f"Found dependency: {task_name} depends on {depends_on}")
                                    
                                    # Get the output from the previous agent
                                    if depends_on in final_outputs:
                                        previous_output = final_outputs[depends_on]
                                        print(f"Using output from {depends_on} for {task_name}")
                                        has_dependency = True
                                    else:
                                        print(f"No output found for {depends_on}, using empty string")
                                    break
                            
                            # Get the agent's own query if it has one
                            if "user_message" in params:
                                agent_own_query = params["user_message"].get("value", "")
                                if agent_own_query:
                                    print(f"Agent {task_name} has its own query: {agent_own_query[:50]}...")
                            
                            # Combine the inputs according to the rules
                            if has_dependency:
                                if previous_output and agent_own_query:
                                    # Both previous output and agent's own query
                                    agent_input = f"{previous_output}\n\n{agent_own_query}"
                                    print(f"Combined both for {task_name}")
                                elif previous_output:
                                    # Only previous output
                                    agent_input = previous_output
                                    print(f"Using only previous output for {task_name}")
                                else:
                                    # No previous output, use agent's own query
                                    agent_input = agent_own_query
                                    print(f"Using only agent's own query for {task_name}")
                            else:
                                # No dependency - this is the first agent
                                agent_input = agent_own_query or params.get("user_message", {}).get("value", "")
                                print(f"Using initial query for {task_name}")
                            
                            # Store the combined input
                            agent_inputs[task_name] = agent_input
                            print(f"Final input for {task_name}: {agent_input[:100]}...")
                        
                        # Open WebSocket for this agent if needed
                        if task_name in agent_configs and open_agent_websocket:
                            print(f"Opening WebSocket for started agent: {task_name}")
                            open_agent_websocket(task_name)
                        
                        emit_ws_event(task_name, "started")
                        print("task_started---", task_name)

                    elif event_type in ("task_stream", "stream", "chunk", "delta", "token"):
                        chunk = (
                            data.get("chunk") or
                            data.get("delta") or
                            data.get("token") or
                            data.get("content", "")
                        )
                        if chunk and task_name:
                            partials.setdefault(task_name, "")
                            partials[task_name] += chunk
                            emit_ws_event(task_name, "streaming", agent_response=partials[task_name], is_partial=True)

                    elif event_type in ("task_completed", "agent_completed"):
                        output = (
                            data.get("output") or
                            data.get("result") or
                            data.get("final_output") or
                            partials.get(task_name, "")
                        )
                        if output and task_name:
                            final_outputs[task_name] = output
                            partials.pop(task_name, None)
                            
                            log_agent_response(
                                task_name=task_name,
                                agent_id_from_ws=task_id,
                                response=output,
                                task_index=None
                            )
                            
                            emit_ws_event(task_name, "completed", agent_response=output, agent_inputs=agent_inputs)

                            print("task_completed---", task_name)
                            #print(f"Stored output for {task_name}: {output[:100]}...")
                            
                            # Close WebSocket for this agent if needed
                            if task_name in agent_websockets and close_agent_websocket:
                                print(f"Closing WebSocket for completed agent: {task_name}")
                                close_agent_websocket(task_name)

                    elif event_type in ("flow_completed", "execution_completed", "done"):
                        workflow_status = "completed"
                        final_result = (
                            data.get("output") or
                            data.get("result") or
                            data.get("final_result") or
                            "\n\n".join(f"## {k}\n\n{v}" for k, v in final_outputs.items())
                        )
                        print("flow_completed---", workflow_status)
                        break

                    elif event_type in ("flow_failed", "execution_failed", "failed"):
                        workflow_status = "failed"
                        error = data.get("error", "Workflow execution failed")
                        final_result = f"Workflow failed: {error}"
                        if final_outputs:
                            final_result += "\n\nPartial results:\n" + "\n\n".join(
                                f"## {k}\n\n{v}" for k, v in final_outputs.items()
                            )
                        break

                    elif event_type in ("task_failed", "agent_failed"):
                        error = data.get("error", "Task failed")
                        
                        log_agent_response(
                            task_name=task_name,
                            agent_id_from_ws=task_id,
                            response=f"Failed: {error}",
                            task_index=None
                        )
                        
                        emit_ws_event(task_name, "failed", agent_response=f"Failed: {error}")
                        
                        # Close WebSocket for this agent if needed
                        if task_name in agent_websockets and close_agent_websocket:
                            print(f"Closing WebSocket for failed agent: {task_name}")
                            close_agent_websocket(task_name)

            # Final timeout / fallback
            if workflow_status == "running":
                final_result = "Workflow timeout (no completion message received)"
                if final_outputs:
                    final_result += "\n\nPartial results:\n" + "\n\n".join(
                        f"## {k}\n\n{v}" for k, v in final_outputs.items()
                    )

            # Emit final message
            emit_ws_event("Workflow", workflow_status, response=final_result or "No result received")

            return final_result, agent_inputs

        except websockets.exceptions.ConnectionClosedOK:
            return final_result, agent_inputs
        except Exception as e:
            print(f"WebSocket error: {type(e).__name__}: {e}")
            print(f"Websocket Error due to connection closed--1")
            final_result = f"Monitoring failed: {str(e)}"
            return final_result, agent_inputs

    def execute_dag_workflow_old(self, query, workflow_id, event_id, session_id, user_id, username, request_id="-", prj_name="App Engineering"):
        """Start workflow → monitor via WebSocket → save result with trace information"""
        
        # 1. Fetch workflow definition
        project_doc = self.project.find_one({'projectName': prj_name})
        user_type = project_doc['database_name'] if project_doc else self.config.config["MONGODB_COLLECTION_NAME_MASTER"]
        workflow_data = self.get_workflow_from_api(workflow_id)
        if not workflow_data:
            print(f"Failed to load workflow {workflow_id}")
            log_data(
                request_id, 
                "Workflow failed: could not fetch workflow definition", 
                {
                    "workflow_id": workflow_id, 
                    "event_id": event_id
                },
                type='error'
            )
            return None

        # Get the tasks from workflow_data
        tasks = workflow_data.get("flow_data", {}).get("tasks", [])
        agent_configs = {}
        
        # 2. Replace user_message of the first agent with the user_query
        if tasks and query:
            for task in tasks:
                if "input_1" in task.get("name", ""):
                    if task.get("function") == "call_lyzr_agent" and "params" in task and "user_message" in task["params"]:
                        task["params"]["user_message"]["value"] = query
                        print(f"Replaced user_message for agent '{task.get('name', 'Unknown')}' with user query: {query[:50]}...")
                        break
                        
        for task in tasks:
            if task.get("function") == "call_lyzr_agent":
                agent_name = task.get("name", "Unknown")
                config = task.get("params", {}).get("config", {})
                
                agent_id = config.get("agent_id") or config.get("api_agent_id")
                if not agent_id:
                    print(f"WARNING: No agent_id found for {agent_name}")
                    continue
                    
                agent_session_id = str(uuid.uuid4())
                
                agent_configs[agent_name] = {
                    "agent_id": agent_id,
                    "api_key": config.get("api_key"),
                    "session_id": agent_session_id,
                    "executed": False  # Track if this agent was executed
                }
                
                # Update task parameters
                if "params" not in task:
                    task["params"] = {}
                task["params"]["session_id"] = agent_session_id
                task["params"]["config"]["agent_id"] = agent_id
                
                if "api_agent_id" not in task["params"]["config"]:
                    task["params"]["config"]["api_agent_id"] = agent_id
                
                if query and "user_message" in task["params"]:
                    task["params"]["user_message"]["value"] = query

        # 3. Attach user query to workflow data
        workflow_data.setdefault("flow_data", {})["user_query"] = query

        flow_name = f"Workflow_{workflow_id}"
        run_name = f"Run_{event_id}_{session_id}"

        # 4. Store agent configurations and tracking data
        agent_logs = {}  # agent_name -> list of logs
        agent_name_to_id = {}
        agent_websockets = {}  # agent_name -> websocket connection
        agent_threads = {}  # agent_name -> thread
        
        # Properly capture agent_name in closures
        print(f"\n=== OPENING ALL WEBSOCKET CONNECTIONS AT START ===")
        for agent_name, config in agent_configs.items():
            agent_id = config["agent_id"]
            metrics_ws_url = f"wss://metrics.studio.lyzr.ai/ws/{config['session_id']}?x-api-key={config['api_key']}"
            
            print(f"Opening WebSocket for {agent_name} (ID: {agent_id})")
            
            # Initialize logs list for this agent
            agent_logs[agent_name] = []
            agent_name_to_id[agent_name] = agent_id
            
            # Add connection state tracking
            connection_ready = threading.Event()
            
            # Create a factory function to properly capture agent_name
            def create_message_handler(current_agent_name, current_agent_id, current_config):
                def on_message(ws, message):
                    """Handle incoming WebSocket messages for specific agent"""
                    try:
                        log_data_obj = json.loads(message)
                        print(f"\n=== WEBSOCKET LOG for {current_agent_name} (ID: {current_agent_id}, Session: {current_config['session_id']}) ===")
                        print(json.dumps(log_data_obj, indent=2))
                        print("===============================\n")
                        
                        # Store logs for this specific agent using the captured name
                        agent_logs[current_agent_name].append(log_data_obj)
                        print(f"Stored log for {current_agent_name} (total: {len(agent_logs[current_agent_name])})")
                        
                    except Exception as e:
                        print(f"Error parsing WebSocket message for {current_agent_name}: {e}")
                        print(f"Raw message: {message}")
                
                return on_message
            
            def create_error_handler(current_agent_name):
                def on_error(ws, error):
                    print(f"WebSocket error for {current_agent_name}: {error}")
                    print(f"Websocket Error due to connection closed--2")
                return on_error
            
            def create_close_handler(current_agent_name):
                def on_close(ws, close_status_code, close_msg):
                    print(f"WebSocket connection closed for {current_agent_name}. Code: {close_status_code}, Message: {close_msg}")
                return on_close
            
            def create_open_handler(current_agent_name, current_agent_id, current_config, ready_event):
                def on_open(ws):
                    # Signal that the connection is ready
                    ready_event.set()
                    
                return on_open
                
            # Create handlers with properly captured agent_name
            on_message = create_message_handler(agent_name, agent_id, config)
            on_error = create_error_handler(agent_name)
            on_close = create_close_handler(agent_name)
            on_open = create_open_handler(agent_name, agent_id, config, connection_ready)
                    
            # Create WebSocket for this agent
            agent_ws = websocket.WebSocketApp(
                metrics_ws_url,
                on_message=on_message,
                on_error=on_error,
                on_close=on_close,
                on_open=on_open
            )
            
            # Start WebSocket in a separate thread
            agent_thread = threading.Thread(target=agent_ws.run_forever)
            agent_thread.daemon = True
            agent_thread.start()
            
            # Store references
            agent_websockets[agent_name] = agent_ws
            agent_threads[agent_name] = agent_thread
            
            # Wait for connection to be established
            if not connection_ready.wait(timeout=3.0):
                print(f" WARNING: WebSocket connection for {agent_name} may not be fully established")
            
            # Small delay between connections
            time.sleep(0.2)
        
        print(f"All WebSocket connections opened. Total: {len(agent_websockets)}")
        
        # 6. Track which agents are executed
        executed_agents = set()
        
        def open_agent_websocket(agent_name):
            """WebSocket is already open - just emit status and mark as executed"""
            if agent_name in agent_configs:
                # Mark this agent as executed
                executed_agents.add(agent_name)
                agent_configs[agent_name]["executed"] = True
                
                config = agent_configs[agent_name]
                agent_id = config["agent_id"]
                agent_name_from_config = config.get("agent_name", agent_name)
                
                # Emit agent started status
                ch = f"workflow*{workflow_id}_{event_id}"
                self.socketio.emit(ch, {
                    "workflow_id": workflow_id,
                    "event_id": event_id,
                    "agent_name": agent_name_from_config,
                    "agent_id": agent_id,
                    "user_id": user_id,
                    "username": username,
                    "status": "Started"
                })
                print(f"Emitted 'Started' for agent: {agent_name_from_config}")
                return True
            return False

        def close_agent_websocket(agent_name):
            """Don't close individual sockets - they'll be closed together at the end"""
            print(f"Keeping WebSocket open for {agent_name} - will close all at the end")
            return True

        # 7. Print the final workflow data before sending
        print(f"\n=== FINAL WORKFLOW DATA BEFORE SENDING ===")
        for i, task in enumerate(tasks):
            if task.get("function") == "call_lyzr_agent":
                print(f"Task {i}: {task.get('name')}")
                print(f"  session_id: {task.get('params', {}).get('session_id', 'NOT SET')}")
                print(f"  agent_id: {task.get('params', {}).get('config', {}).get('agent_id', 'NOT SET')}")
                print(f"  api_agent_id: {task.get('params', {}).get('config', {}).get('api_agent_id', 'NOT SET')}")
                print("---")

        # 8. Start the workflow with updated session_ids
        dag_start = self.run_dag(workflow_data, flow_name, run_name)
        if not dag_start or "task_id" not in dag_start:
            print("Failed to start workflow")
            log_data(
                request_id, 
                "Workflow failed: could not start workflow", 
                {
                    "workflow_id": workflow_id, 
                    "event_id": event_id,
                    "dag_response": dag_start
                },
                type='error'
            )
            return None

        task_id = dag_start["task_id"]
        print(f"\n=== WORKFLOW STARTED ===")
        print(f"Task ID: {task_id}")
        print(f"Session IDs configured:")
        for agent_name, config in agent_configs.items():
            print(f"  {agent_name} (ID: {config['agent_id']}): {config['session_id']}")

        # 9. Monitor workflow via WebSocket
        ws_url = f"wss://lao-socket.studio.lyzr.ai/ws/{workflow_data.get('flow_name')}/{run_name}"
        
        try:
            final_result = asyncio.run(
                self.monitor_workflow_via_websocket(
                    ws_url,
                    workflow_id,
                    event_id,
                    session_id,
                    user_id,
                    username,
                    request_id,  
                    prj_name,
                    workflow_tasks=tasks,
                    agent_configs=agent_configs,
                    # Pass the tracking dictionaries and functions
                    agent_logs=agent_logs,
                    agent_websockets=agent_websockets,
                    agent_threads=agent_threads,
                    open_agent_websocket=open_agent_websocket,
                    close_agent_websocket=close_agent_websocket
                )
            )
        except Exception as e:
            print(f"WebSocket monitoring crashed: {e}")
            final_result = f"Execution monitoring failed: {str(e)}"
            log_data(
                request_id, 
                "Workflow monitoring failed", 
                {
                    "workflow_id": workflow_id, 
                    "event_id": event_id,
                    "error": str(e)
                },
                type='error'
            )

        #  Close ALL WebSocket connections at the end
        print(f"\n=== CLOSING ALL WEBSOCKET CONNECTIONS ===")
        for agent_name in list(agent_websockets.keys()):
            try:
                agent_websockets[agent_name].close()
                if agent_name in agent_threads and agent_threads[agent_name].is_alive():
                    agent_threads[agent_name].join(timeout=5)
                
                print(f"Closed WebSocket for {agent_name} (ID: {agent_name_to_id.get(agent_name, 'Unknown')})")
            except Exception as e:
                print(f"Error closing WebSocket for {agent_name}: {e}")
        
        # Clear the dictionaries
        agent_websockets.clear()
        agent_threads.clear()
        print(f"All WebSocket connections closed")

        # 10. Fetch trace information for each agent
        trace_info = {}  # This will store trace info for all agents
        for agent_name, config in agent_configs.items():
            if config.get("executed", False):  # Only fetch for executed agents
                agent_id = config["agent_id"]
                agent_session_id = config["session_id"]
                api_key = config["api_key"]
                
                try:
                    # Get the latest trace for this agent
                    trace_url = f"https://agent-prod.studio.lyzr.ai/v3/traces"
                    trace_headers = {"x-api-key": api_key, "Content-Type": "application/json"}
                    
                    # Add a delay to ensure the trace has been recorded
                    time.sleep(2)
                    
                    # Try multiple times with increasing delays to get the most recent trace
                    max_retries = 3
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
                                    trace_detail_url = f"https://agent-prod.studio.lyzr.ai/v3/traces/{trace_id}"
                                    detail_response = requests.get(trace_detail_url, headers=trace_headers)
                                    detail_response.raise_for_status()
                                    
                                    # Safe handling (Lyzr returns dict, not list)
                                    trace_details = detail_response.json()
                                    if isinstance(trace_details, list):
                                        trace_details = trace_details[0] if trace_details else {}
                                    
                                    # Print trace details to terminal
                                    print(f"\n=== TRACE DETAILS for {agent_name} ===")
                                    print(f"Trace ID: {trace_id}")
                                    print(f"Trace Details: {json.dumps(trace_details, indent=2)}")
                                    print("=====================================\n")
                                    
                                    # Verify this trace belongs to our session
                                    spans = trace_details.get("spans", [])
                                    our_session = False
                                    
                                    for span in spans:
                                        span_attrs = span.get("SpanAttributes", {})
                                        if (span_attrs.get("session_id") == agent_session_id or 
                                            (span_attrs.get("input") and query in span_attrs.get("input", ""))):
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
                                        
                                        # Store trace information for this agent in the main trace_info dict
                                        trace_info[agent_name] = {
                                            "agent_id": agent_id,
                                            "trace_id": trace_id,
                                            "spans": trace_details.get("spans", []),
                                            "chat_messages": chat_messages
                                        }
                                        
                                        print(f"Stored trace for {agent_name}: {trace_id}")
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
                            print(f"Error fetching trace information for {agent_name} (attempt {retry + 1}): {e}")
                            if retry < max_retries - 1:
                                time.sleep(retry_delay * (retry + 1))
                                continue
                            else:
                                # Last attempt failed, continue to next agent
                                break
                    
                    if agent_name not in trace_info:
                        print(f"Could not find trace for {agent_name}")
                        
                except Exception as e:
                    print(f"Error fetching trace information for {agent_name}: {e}")

        # Only save logs for executed agents
        try:
            status = "completed" if "failed" not in str(final_result).lower() else "failed"
            
            # Create a new structure for logs that includes agent_id as a property
            agent_logs_with_id = {}
            
            # Only include agents that were actually executed
            for agent_name in executed_agents:
                if agent_name in agent_logs and agent_name in agent_name_to_id:
                    agent_id = agent_name_to_id[agent_name]
                    logs = agent_logs[agent_name]
                    
                    # Only include agents that have logs
                    if logs:  # Only include if there are logs
                        agent_logs_with_id[agent_name] = {
                            "agent_id": agent_id,
                            "logs": logs
                        }
                        print(f"Including logs for executed agent: {agent_name} ({len(logs)} logs)")
                    else:
                        print(f"Excluding agent {agent_name} - no logs collected")
                else:
                    print(f"Excluding agent {agent_name} - not executed or no logs")
            
            # Store the workflow result with the new structure
            doc = {
                "workflow_id": workflow_id,
                "event_id": event_id,
                "dag_task_id": task_id,
                "response": final_result,
                "session_id": session_id,
                "user_id": user_id,
                "username": username,
                "timestamp": CommonUtils.get_current_timestamp(),
                "saved_at": datetime.utcnow(),
                "status": status,
                "real_time_logs": agent_logs_with_id,
		"trace_info": trace_info 
            }
            insert_op = {'type': 'insert_one', 'document': doc}
            self._query_db('workflow_response_collection', insert_op, user_type=user_type)
            
            # DEBUG: Print summary of logs collected
            print(f"\n=== LOGS COLLECTED ===")
            for agent_name, data in agent_logs_with_id.items():
                agent_id = data["agent_id"]
                log_count = len(data["logs"])
                print(f"{agent_name} (ID: {agent_id}): {log_count} logs")
            
            # DEBUG: Print summary of trace info collected
            print(f"\n=== TRACE INFO COLLECTED ===")
            for agent_name, data in trace_info.items():
                agent_id = data["agent_id"]
                trace_id = data["trace_id"]
                spans_count = len(data.get("spans", []))
                print(f"{agent_name} (ID: {agent_id}): Trace ID: {trace_id}, Spans: {spans_count}")
            
        except Exception as e:
            print(f"Failed to save workflow result: {e}")
            log_data(
                request_id, 
                "Workflow failed: could not save result", 
                {
                    "workflow_id": workflow_id, 
                    "event_id": event_id,
                    "error": str(e)
                },
                type='error'
            )
        return final_result

    def execute_dag_workflow(self, query, workflow_id, event_id, session_id, user_id, username, request_id="-", prj_name="App Engineering"):
        """Start workflow → monitor via WebSocket → save result with trace information"""
        
        # 1. Fetch workflow definition
        project_doc = self.project.find_one({'projectName': prj_name})
        user_type = project_doc['database_name'] if project_doc else self.config.config["MONGODB_COLLECTION_NAME_MASTER"]
        workflow_data = self.get_workflow_from_api(workflow_id)
        if not workflow_data:
            print(f"Failed to load workflow {workflow_id}")
            log_data(
                request_id, 
                "Workflow failed: could not fetch workflow definition", 
                {
                    "workflow_id": workflow_id, 
                    "event_id": event_id
                },
                type='error'
            )
            return None

        # Get the tasks from workflow_data
        tasks = workflow_data.get("flow_data", {}).get("tasks", [])
        agent_configs = {}
        
        # 2. Replace user_message of the first agent with the user_query
        if tasks and query:
            for task in tasks:
                if "input_1" in task.get("name", ""):
                    if task.get("function") == "call_lyzr_agent" and "params" in task and "user_message" in task["params"]:
                        task["params"]["user_message"]["value"] = query
                        print(f"Replaced user_message for agent '{task.get('name', 'Unknown')}' with user query: {query[:50]}...")
                        break
                        
        for task in tasks:
            if task.get("function") == "call_lyzr_agent":
                agent_name = task.get("name", "Unknown")
                config = task.get("params", {}).get("config", {})
                
                agent_id = config.get("agent_id") or config.get("api_agent_id")
                if not agent_id:
                    print(f"WARNING: No agent_id found for {agent_name}")
                    continue
                    
                agent_session_id = str(uuid.uuid4())
                
                agent_configs[agent_name] = {
                    "agent_id": agent_id,
                    "api_key": config.get("api_key"),
                    "session_id": agent_session_id,
                    "executed": False  # Track if this agent was executed
                }
                
                # Update task parameters
                if "params" not in task:
                    task["params"] = {}
                task["params"]["session_id"] = agent_session_id
                task["params"]["config"]["agent_id"] = agent_id
                
                if "api_agent_id" not in task["params"]["config"]:
                    task["params"]["config"]["api_agent_id"] = agent_id
                
                if query and "user_message" in task["params"]:
                    task["params"]["user_message"]["value"] = query

        # 3. Attach user query to workflow data
        workflow_data.setdefault("flow_data", {})["user_query"] = query

        flow_name = f"Workflow_{workflow_id}"
        run_name = f"Run_{event_id}_{session_id}"

        # 4. Store agent configurations and tracking data
        agent_logs = {}  # agent_name -> list of logs
        agent_name_to_id = {}
        agent_websockets = {}  # agent_name -> websocket connection
        agent_threads = {}  # agent_name -> thread
        
        # Properly capture agent_name in closures
        print(f"\n=== OPENING ALL WEBSOCKET CONNECTIONS AT START ===")
        for agent_name, config in agent_configs.items():
            agent_id = config["agent_id"]
            metrics_ws_url = f"wss://metrics.studio.lyzr.ai/ws/{config['session_id']}?x-api-key={config['api_key']}"
            
            print(f"Opening WebSocket for {agent_name} (ID: {agent_id})")
            
            # Initialize logs list for this agent
            agent_logs[agent_name] = []
            agent_name_to_id[agent_name] = agent_id
            
            # Add connection state tracking
            connection_ready = threading.Event()
            
            # Create a factory function to properly capture agent_name
            def create_message_handler(current_agent_name, current_agent_id, current_config):
                def on_message(ws, message):
                    """Handle incoming WebSocket messages for specific agent"""
                    try:
                        log_data_obj = json.loads(message)
                        print(f"\n=== WEBSOCKET LOG for {current_agent_name} (ID: {current_agent_id}, Session: {current_config['session_id']}) ===")
                        print(json.dumps(log_data_obj, indent=2))
                        print("===============================\n")
                        
                        # Store logs for this specific agent
                        agent_logs[current_agent_name].append(log_data_obj)
                        print(f"Stored log for {current_agent_name} (total: {len(agent_logs[current_agent_name])})")
                        
                        # Stream the entire log object without trying to extract specific fields
                        stream_channel = f"workflow*{workflow_id}_{event_id}"
                        
                        payload = {
                            "workflow_id": workflow_id,
                            "event_id": event_id,
                            "agent_name": current_agent_name,
                            "agent_id": current_agent_id,
                            "user_id": user_id,
                            "username": username,
                            "status": "streaming",
                            "type": "log",
                            "log": log_data_obj,
                            "timestamp": datetime.now().isoformat()
                        }
                        self.socketio.emit(stream_channel, payload)
                        print(f"📋 Streamed log for {current_agent_name}")
                        
                    except Exception as e:
                        print(f"Error parsing WebSocket message for {current_agent_name}: {e}")
                        print(f"Raw message: {message}")
                
                return on_message
            
            def create_error_handler(current_agent_name):
                def on_error(ws, error):
                    print(f"WebSocket error for {current_agent_name}: {error}")
                    print(f"Websocket Error due to connection closed--3")
                return on_error
            
            def create_close_handler(current_agent_name):
                def on_close(ws, close_status_code, close_msg):
                    print(f"WebSocket connection closed for {current_agent_name}. Code: {close_status_code}, Message: {close_msg}")
                return on_close
            
            def create_open_handler(current_agent_name, current_agent_id, current_config, ready_event):
                def on_open(ws):
                    # Signal that the connection is ready
                    ready_event.set()
                    
                return on_open
                    
            # Create handlers with properly captured agent_name
            on_message = create_message_handler(agent_name, agent_id, config)
            on_error = create_error_handler(agent_name)
            on_close = create_close_handler(agent_name)
            on_open = create_open_handler(agent_name, agent_id, config, connection_ready)
                        
            # Create WebSocket for this agent
            agent_ws = websocket.WebSocketApp(
                metrics_ws_url,
                on_message=on_message,
                on_error=on_error,
                on_close=on_close,
                on_open=on_open
            )
            
            # Start WebSocket in a separate thread
            agent_thread = threading.Thread(target=agent_ws.run_forever)
            agent_thread.daemon = True
            agent_thread.start()
            
            # Store references
            agent_websockets[agent_name] = agent_ws
            agent_threads[agent_name] = agent_thread
            
            # Wait for connection to be established
            if not connection_ready.wait(timeout=3.0):
                print(f" WARNING: WebSocket connection for {agent_name} may not be fully established")
            
            # Small delay between connections
            time.sleep(0.2)
        
        print(f"All WebSocket connections opened. Total: {len(agent_websockets)}")
        
        # 6. Track which agents are executed
        executed_agents = set()
        
        def open_agent_websocket(agent_name):
            """WebSocket is already open - just emit status and mark as executed"""
            if agent_name in agent_configs:
                # Mark this agent as executed
                executed_agents.add(agent_name)
                agent_configs[agent_name]["executed"] = True
                
                config = agent_configs[agent_name]
                agent_id = config["agent_id"]
                agent_name_from_config = config.get("agent_name", agent_name)
                
                # Emit agent started status
                ch = f"workflow*{workflow_id}_{event_id}"
                self.socketio.emit(ch, {
                    "workflow_id": workflow_id,
                    "event_id": event_id,
                    "agent_name": agent_name_from_config,
                    "agent_id": agent_id,
                    "user_id": user_id,
                    "username": username,
                    "status": "Started"
                })
                print(f"Emitted 'Started' for agent: {agent_name_from_config}")
                return True
            return False

        def close_agent_websocket(agent_name):
            """Don't close individual sockets - they'll be closed together at the end"""
            print(f"Keeping WebSocket open for {agent_name} - will close all at the end")
            return True

        # 7. Print the final workflow data before sending
        print(f"\n=== FINAL WORKFLOW DATA BEFORE SENDING ===")
        for i, task in enumerate(tasks):
            if task.get("function") == "call_lyzr_agent":
                print(f"Task {i}: {task.get('name')}")
                print(f"  session_id: {task.get('params', {}).get('session_id', 'NOT SET')}")
                print(f"  agent_id: {task.get('params', {}).get('config', {}).get('agent_id', 'NOT SET')}")
                print(f"  api_agent_id: {task.get('params', {}).get('config', {}).get('api_agent_id', 'NOT SET')}")
                print("---")

        # 8. Start the workflow with updated session_ids
        dag_start = self.run_dag(workflow_data, flow_name, run_name)
        if not dag_start or "task_id" not in dag_start:
            print("Failed to start workflow")
            log_data(
                request_id, 
                "Workflow failed: could not start workflow", 
                {
                    "workflow_id": workflow_id, 
                    "event_id": event_id,
                    "dag_response": dag_start
                },
                type='error'
            )
            return None

        task_id = dag_start["task_id"]
        print(f"\n=== WORKFLOW STARTED ===")
        print(f"Task ID: {task_id}")
        print(f"Session IDs configured:")
        for agent_name, config in agent_configs.items():
            print(f"  {agent_name} (ID: {config['agent_id']}): {config['session_id']}")

        # 9. Monitor workflow via WebSocket
        ws_url = f"wss://lao-socket.studio.lyzr.ai/ws/{workflow_data.get('flow_name')}/{run_name}"
        
        try:
            # Capture both final_result and agent_inputs
            final_result, agent_inputs = asyncio.run(
                self.monitor_workflow_via_websocket(
                    ws_url,
                    workflow_id,
                    event_id,
                    session_id,
                    user_id,
                    username,
                    request_id,  
                    prj_name,
                    workflow_tasks=tasks,
                    agent_configs=agent_configs,
                    # Pass the tracking dictionaries and functions
                    agent_logs=agent_logs,
                    agent_websockets=agent_websockets,
                    agent_threads=agent_threads,
                    open_agent_websocket=open_agent_websocket,
                    close_agent_websocket=close_agent_websocket
                )
            )
        except Exception as e:
            print(f"WebSocket monitoring crashed: {e}")
            final_result = f"Execution monitoring failed: {str(e)}"
            agent_inputs = {}  # Initialize empty on failure
            log_data(
                request_id, 
                "Workflow monitoring failed", 
                {
                    "workflow_id": workflow_id, 
                    "event_id": event_id,
                    "error": str(e)
                },
                type='error'
            )

        #  Close ALL WebSocket connections at the end
        print(f"\n=== CLOSING ALL WEBSOCKET CONNECTIONS ===")
        for agent_name in list(agent_websockets.keys()):
            try:
                agent_websockets[agent_name].close()
                if agent_name in agent_threads and agent_threads[agent_name].is_alive():
                    agent_threads[agent_name].join(timeout=5)
                
                print(f"Closed WebSocket for {agent_name} (ID: {agent_name_to_id.get(agent_name, 'Unknown')})")
            except Exception as e:
                print(f"Error closing WebSocket for {agent_name}: {e}")
        
        # Clear the dictionaries
        agent_websockets.clear()
        agent_threads.clear()
        print(f"All WebSocket connections closed")

        # 10. Fetch trace information for each agent
        trace_info = {}  # This will store trace info for all agents
        for agent_name, config in agent_configs.items():
            if config.get("executed", False):  # Only fetch for executed agents
                agent_id = config["agent_id"]
                agent_session_id = config["session_id"]
                api_key = config["api_key"]
                
                try:
                    # Get the latest trace for this agent
                    trace_url = f"https://agent-prod.studio.lyzr.ai/v3/traces"
                    trace_headers = {"x-api-key": api_key, "Content-Type": "application/json"}
                    
                    # Add a delay to ensure the trace has been recorded
                    time.sleep(2)
                    
                    # Try multiple times with increasing delays to get the most recent trace
                    max_retries = 3
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
                                    trace_detail_url = f"https://agent-prod.studio.lyzr.ai/v3/traces/{trace_id}"
                                    detail_response = requests.get(trace_detail_url, headers=trace_headers)
                                    detail_response.raise_for_status()
                                    
                                    # Safe handling (Lyzr returns dict, not list)
                                    trace_details = detail_response.json()
                                    if isinstance(trace_details, list):
                                        trace_details = trace_details[0] if trace_details else {}
                                    
                                    # Print trace details to terminal
                                    print(f"\n=== TRACE DETAILS for {agent_name} ===")
                                    print(f"Trace ID: {trace_id}")
                                    print(f"Trace Details: {json.dumps(trace_details, indent=2)}")
                                    print("=====================================\n")
                                    
                                    # Verify this trace belongs to our session
                                    spans = trace_details.get("spans", [])
                                    our_session = False
                                    
                                    for span in spans:
                                        span_attrs = span.get("SpanAttributes", {})
                                        if (span_attrs.get("session_id") == agent_session_id or 
                                            (span_attrs.get("input") and query in span_attrs.get("input", ""))):
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
                                        
                                        # Store trace information for this agent in the main trace_info dict
                                        trace_info[agent_name] = {
                                            "agent_id": agent_id,
                                            "trace_id": trace_id,
                                            "spans": trace_details.get("spans", []),
                                            "chat_messages": chat_messages
                                        }
                                        
                                        print(f"Stored trace for {agent_name}: {trace_id}")
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
                            print(f"Error fetching trace information for {agent_name} (attempt {retry + 1}): {e}")
                            if retry < max_retries - 1:
                                time.sleep(retry_delay * (retry + 1))
                                continue
                            else:
                                # Last attempt failed, continue to next agent
                                break
                        
                        if agent_name not in trace_info:
                            print(f"Could not find trace for {agent_name}")
                            
                except Exception as e:
                    print(f"Error fetching trace information for {agent_name}: {e}")

        # 11. Save workflow result with agent_inputs
        try:
            status = "completed" if "failed" not in str(final_result).lower() else "failed"
            
            # Only save logs for executed agents
            agent_logs_with_id = {}
            
            # Only include agents that were actually executed
            for agent_name in executed_agents:
                if agent_name in agent_logs and agent_name in agent_name_to_id:
                    agent_id = agent_name_to_id[agent_name]
                    logs = agent_logs[agent_name]
                    
                    # Only include agents that have logs
                    if logs:  # Only include if there are logs
                        agent_logs_with_id[agent_name] = {
                            "agent_id": agent_id,
                            "logs": logs
                        }
                        print(f"Including logs for executed agent: {agent_name} ({len(logs)} logs)")
                    else:
                        print(f"Excluding agent {agent_name} - no logs collected")
                else:
                    print(f"Excluding agent {agent_name} - not executed or no logs")
            
            # Create the comprehensive response document
            doc = {
                "workflow_id": workflow_id,
                "event_id": event_id,
                "dag_task_id": task_id,
                "response": final_result,
                "session_id": session_id,
                "user_id": user_id,
                "username": username,
                "timestamp": CommonUtils.get_current_timestamp(),
                "saved_at": datetime.utcnow(),
                "status": status,
                "real_time_logs": agent_logs_with_id,
                "trace_info": trace_info,
                "user_query": agent_inputs  # === ADD AGENT INPUTS HERE ===
            }
            
            # Use _query_db to save with correct user_type
            insert_op = {'type': 'insert_one', 'document': doc}
            self._query_db('workflow_response_collection', insert_op, user_type=user_type)
            
            # DEBUG: Print summary of logs collected
            print(f"\n=== LOGS COLLECTED ===")
            for agent_name, data in agent_logs_with_id.items():
                agent_id = data["agent_id"]
                log_count = len(data["logs"])
                print(f"{agent_name} (ID: {agent_id}): {log_count} logs")
            
            # DEBUG: Print summary of trace info collected
            print(f"\n=== TRACE INFO COLLECTED ===")
            for agent_name, data in trace_info.items():
                agent_id = data["agent_id"]
                trace_id = data["trace_id"]
                spans_count = len(data.get("spans", []))
                print(f"{agent_name} (ID: {agent_id}): Trace ID: {trace_id}, Spans: {spans_count}")
            
            # DEBUG: Print summary of user_query collected
            print(f"\n=== USER QUERY COLLECTED ===")
            for agent_name, input_text in agent_inputs.items():
                print(f"{agent_name}: {input_text[:100]}...")
            
        except Exception as e:
            print(f"Failed to save workflow result: {e}")
            log_data(
                request_id, 
                "Workflow failed: could not save result", 
                {
                    "workflow_id": workflow_id, 
                    "event_id": event_id,
                    "error": str(e)
                },
                type='error'
            )
        return final_result

    def get_workflow_logs_and_traces(self, workflow_id, event_id, user_type=None):
        try:
            find_op = {
                'type': 'find',  
                'filter': {
                    "workflow_id": workflow_id,
                    "event_id": event_id
                }
            }
            # Query the workflow response collection
            workflow_docs = self._query_db(
                'workflow_response_collection', 
                find_op, 
                user_type=user_type
            )
            
            if not workflow_docs:
                return {
                    "success": False,
                    "message": "Workflow execution not found",
                    "real_time_logs": {},
                    "trace_info": {},
                    "response": {},
                    "user_query": {}
                }
            
            latest_doc = None
            latest_time = None
            
            for doc in workflow_docs:
                doc_time = doc.get("timestamp") or doc.get("saved_at")
                
                if doc_time:
                    if isinstance(doc_time, str):
                        try:
                            doc_time = datetime.fromisoformat(doc_time.replace('Z', '+00:00'))
                        except:
                            continue
                    
                    if latest_time is None or doc_time > latest_time:
                        latest_time = doc_time
                        latest_doc = doc
            
            if not latest_doc:
                latest_doc = workflow_docs[0]
            
            real_time_logs = latest_doc.get("real_time_logs", {})
            trace_info = latest_doc.get("trace_info", {})
            response = latest_doc.get("response", {})
            user_query = latest_doc.get("user_query", {})
            
            # Add debug print to verify the data structure
            print(f"DEBUG - Response field structure: {type(response)}")
            if isinstance(response, dict):
                print(f"DEBUG - Response keys: {list(response.keys())}")
            print(f"DEBUG - User query field structure: {type(user_query)}")
            if isinstance(user_query, dict):
                print(f"DEBUG - User query keys: {list(user_query.keys())}")
            
            return {
                "success": True,
                "message": "Logs and traces retrieved successfully",
                "real_time_logs": real_time_logs,
                "trace_info": trace_info,
                "response": response,
                "user_query": user_query,
                "workflow_details": {
                    "workflow_id": latest_doc.get("workflow_id"),
                    "event_id": latest_doc.get("event_id"),
                    "status": latest_doc.get("status"),
                    "timestamp": latest_doc.get("timestamp"),
                    "user_id": latest_doc.get("user_id"),
                    "username": latest_doc.get("username"),
                    "saved_at": latest_doc.get("saved_at")
                }
            }
        except Exception as e:
            print(f"Error fetching workflow logs and traces: {e}")
            traceback.print_exc()
            return {
                "success": False,
                "message": f"Error retrieving data: {str(e)}",
                "real_time_logs": {},
                "trace_info": {},
                "response": {},
                "user_query": {}
            }

    def _run_workflow_old(self, data):
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
                raise NotFoundError("Workflow not found")

            # Check IsExternal flag AT THE BEGINNING
            is_external = workflow.get("IsExternal", False)
            print(f"Workflow IsExternal flag: {is_external}")

            # Initialize agent_responses dictionary for internal workflows
            agent_responses = {} if not is_external else None

            # Get request_id and prj_name for logging
            request_id = request.headers.get("X-Request-Id", "-") if request else "-"
            current_user = get_current_user()
            prj_name = current_user.get('ActiveProject', self.config.config.get("MONGODB_COLLECTION_NAME_MASTER", "App Engineering")) if current_user else "App Engineering"
                
            project_doc = self.project.find_one({'projectName': prj_name})
            user_type = project_doc['database_name'] if project_doc else self.config.config["MONGODB_COLLECTION_NAME_MASTER"]

            if is_external:
                print(f"IsExternal is True. Skipping normal workflow and executing DAG workflow directly.")
                
                # Create a simple workflow result to return immediately
                workflow_result = {
                    "results": [
                        {
                            "issue_key": "External Workflow",
                            "result": f"External workflow started for query: {query}"
                        }
                    ]
                }
                
                # Run DAG in a separate thread
                ctx = contextvars.copy_context()
               
                threading.Thread(
                    target=ctx.run,
                    args=(self.execute_dag_workflow, query, workflow_id, event, session_id, user_id, username, request_id, prj_name),
                    daemon=True
                ).start()
                
                # === NEW: Wait for completion and fetch logs/traces ===
                max_wait_time = 60  # Maximum wait time in seconds
                wait_interval = 2   # Check interval in seconds
                elapsed_time = 0
                
                # Wait for DAG workflow to complete
                while elapsed_time < max_wait_time:
                    time.sleep(wait_interval)
                    elapsed_time += wait_interval
                    
                    # Check if workflow data is saved in database
                    workflow_doc = self.workflow_response_collection.find_one({
                        "workflow_id": workflow_id,
                        "event_id": event,
                        "dag_task_id": {"$exists": True}
                    })
                    
                    if workflow_doc and workflow_doc.get("status") in ["completed", "failed"]:
                        break
                
                # Fetch logs and traces using our method
                logs_and_traces = self.get_workflow_logs_and_traces(workflow_id, event)
                
                # Add logs and traces to the result if successful
                if logs_and_traces.get("success"):
                    workflow_result["real_time_logs"] = logs_and_traces["real_time_logs"]
                    workflow_result["trace_info"] = logs_and_traces["trace_info"]
                    workflow_result["workflow_details"] = logs_and_traces["workflow_details"]
                    
                    print(f"Successfully fetched logs for {len(logs_and_traces['real_time_logs'])} agents")
                    print(f"Successfully fetched traces for {len(logs_and_traces['trace_info'])} agents")
                else:
                    print(f"Could not fetch logs/traces: {logs_and_traces.get('message', 'Unknown error')}")
                    workflow_result["logs_error"] = logs_and_traces.get("message", "Unknown error")
                
                return workflow_result
            
            # === NORMAL WORKFLOW EXECUTION (when IsExternal is False) ===
            flow_data = workflow['flow_data']
            tasks = flow_data.get('tasks', [])
            if not tasks:
                raise NotFoundError("No tasks in workflow")

            # Add workflow context to each task
            for task in tasks:
                task['workflow_id'] = workflow_id
                task['event_id'] = event
                task['user_id'] = user_id
                task['username'] = username

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

            # === RUN NORMAL WORKFLOW ===
            workflow_result = None
            final_key = None
            final_content = None

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
                    
                    # Store agent responses for internal workflow
                    if not is_external and "agent_responses" in res:
                        agent_responses.update(res["agent_responses"])
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
                    
                    # Store agent responses from iterative part
                    if not is_external and "agent_responses" in iterative_result:
                        agent_responses.update(iterative_result["agent_responses"])

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

                    # Store agent responses for internal workflow
                    if not is_external and isinstance(conditional_result, dict) and "agent_responses" in conditional_result:
                        agent_responses.update(conditional_result["agent_responses"])

                workflow_result = self._wrap_result(final_key, final_content)

            # === Pure Iterative ===
            elif has_iterative:
                print("Running PURE ITERATIVE workflow")
                res = self._run_iterative_workflow(tasks, query, event, workflow_id, session_id, user_id, username)
                summary = res.get("summary", {})
                final_key = summary.get("final_key")
                final_content = summary.get("final_content", "Done")
                
                # Store agent responses for internal workflow
                if not is_external and "agent_responses" in res:
                    agent_responses.update(res["agent_responses"])
                
                workflow_result = self._wrap_result(final_key, final_content)

            # === Pure Conditional ===
            elif has_conditional:
                print("Running PURE CONDITIONAL workflow")
                conditional_result = self._run_conditional_workflow(
                    tasks=tasks,
                    initial_input=query,
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
                    final_key = None
                    final_content = str(conditional_result)
                
                # Store agent responses for internal workflow
                if not is_external and isinstance(conditional_result, dict) and "agent_responses" in conditional_result:
                    agent_responses.update(conditional_result["agent_responses"])
                
                workflow_result = self._wrap_result(final_key, final_content)

            # === Fallback: Sequential Agent Chain ===
            else:
                print("Running SEQUENTIAL agent chain")
                current_input = query
                extracted_issue_key = None
                
                # === ADD STATUS EMISSION FOR SEQUENTIAL WORKFLOW START ===
                # self.socketio.emit(f"workflow*{workflow_id}_{event}", {
                    # "workflow_id": workflow_id,
                    # "event_id": event,
                    # "agent_name": "CustomWorkflow",
                    # "agent_id": "",
                    # "user_id": user_id,
                    # "username": username,
                    # "status": "Started"
                # })
                print(f"Emitted 'Started' for sequential workflow")
    
                for idx, task in enumerate(tasks):
                    if task.get('function') != 'call_lyzr_agent':
                        continue
                    prompt = task.get('user_input', '').strip()
                    next_call = task['call_next']
                    config = task['params']['config']
                    agent_name = config.get('agent_name', 'Unknown Agent').strip()
                    agent_id = config.get('agent_id', '')
                    message = f"{prompt}\n\n{current_input}" if prompt else current_input
                    
                    # === ADD STATUS EMISSION FOR AGENT START ===
                    ch = f"workflow*{workflow_id}_{event}"
                    self.socketio.emit(ch, {
                        "workflow_id": workflow_id,
                        "event_id": event,
                        "agent_name": agent_name,
                        "agent_id": agent_id,
                        "user_id": user_id,
                        "username": username,
                        "status": "Started"
                    })
                    print(f"Emitted 'Started' for sequential agent: {agent_name}")

                    response, agent_session_id, task_logs = self._execute_single_agent_task(task, message, session_id=session_id, user_id=user_id)

                    # Store agent response for internal workflow
                    if not is_external:
                        agent_responses[agent_name] = response
                        
                    # === ADD STATUS EMISSION FOR AGENT COMPLETION ===
                    self.socketio.emit(ch, {
                        "workflow_id": workflow_id,
                        "event_id": event,
                        "agent_name": agent_name,
                        "agent_id": agent_id,
                        "user_id": user_id,
                        "username": username,
                        "status": "completed",
                        "agent_response": response
                    })
                    print(f"Emitted 'completed' for sequential agent: {agent_name}")

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
                        username=username,
                        next_call=next_call,
                        logs=task_logs
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
                            
                        # === ADD STATUS EMISSION FOR PUSH TO JIRA COMPLETION ===
                        self.socketio.emit(ch, {
                            "workflow_id": workflow_id,
                            "event_id": event,
                            "agent_name": agent_name,
                            "agent_id": agent_id,
                            "user_id": user_id,
                            "username": username,
                            "status": "completed",
                            "agent_response": primary_result,
                            "created_keys": created_keys
                        })
                        print(f"Emitted 'completed' for Push to Jira agent: {agent_name}")
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
                
                workflow_result = self._wrap_result(extracted_issue_key, current_input)
                final_key = extracted_issue_key
                final_content = current_input
                
                 # === ADD FINAL COMPLETION STATUS FOR SEQUENTIAL WORKFLOW ===
                self.socketio.emit(f"workflow*{workflow_id}_{event}", {
                    "workflow_id": workflow_id,
                    "event_id": event,
                    "agent_name": "CustomWorkflow",
                    "agent_id": "",
                    "user_id": user_id,
                    "username": username,
                    "status": "completed",
                    "response": final_content,
                    "agent_response": final_content
                })
                print(f"Emitted final sequential workflow completion status")

            # === SAVE FINAL RESPONSE (NEW VERSION) ===
            try:
                # Get user_type for database operation
                current_user = get_current_user()
                prj_name = current_user.get('ActiveProject', self.config.config.get("MONGODB_COLLECTION_NAME_MASTER", "App Engineering")) if current_user else "App Engineering"
                project_doc = self.project.find_one({'projectName': prj_name})
                user_type = project_doc['database_name'] if project_doc else self.config.config["MONGODB_COLLECTION_NAME_MASTER"]
                
                # Create the comprehensive response document
                doc = {
                    "workflow_id": workflow_id,
                    "event_id": event,
                    "response": agent_responses if not is_external else final_content,  # Store all agent responses for internal workflows
                    "session_id": session_id,
                    "user_id": user_id,
                    "username": username,
                    "timestamp": CommonUtils.get_current_timestamp(),
                    "saved_at": datetime.utcnow(),
                    "status": "completed",
                    "is_external": is_external  # Flag to distinguish between internal and external workflows
                }
                
                # For internal workflows, add a simplified final_content field for backward compatibility
                if not is_external:
                    doc["final_content"] = final_content
                    doc["key"] = final_key
                    
                    # ✅ FIX: For internal workflows, collect logs and trace information using _query_db
                    # Wait a moment to ensure all agent responses are saved
                    time.sleep(3)  # Increased wait time to ensure all responses are saved
                    
                    # Query all agent responses for this workflow execution using _query_db
                    find_op = {
                        'type': 'find',
                        'filter': {
                            "workflow_id": workflow_id,
                            "event_id": event,
                            "real_time_logs": {"$exists": True, "$ne": []}  # Only get documents with non-empty logs
                        }
                    }
                    agent_responses_docs = self._query_db(
                        'workflow_response_collection',
                        find_op,
                        user_type=user_type  # ✅ Use the correct user_type
                    )
                    
                    # Organize logs and traces by agent name
                    real_time_logs = {}
                    trace_info = {}
                    
                    print(f"Found {len(agent_responses_docs)} agent response documents with logs")
                    
                    for agent_doc in agent_responses_docs:
                        agent_name = agent_doc.get("agent_name", "Unknown")
                        agent_id = agent_doc.get("agent_id", "")
                        
                        # Get logs for this agent
                        if "real_time_logs" in agent_doc and agent_doc["real_time_logs"]:
                            real_time_logs[agent_name] = {
                                "agent_id": agent_id,
                                "logs": agent_doc["real_time_logs"]
                            }
                            print(f"Added logs for agent: {agent_name} (ID: {agent_id})")
                        
                        # Get trace information for this agent
                        if "trace_info" in agent_doc and agent_doc["trace_info"]:
                            trace_info[agent_name] = agent_doc["trace_info"]
                            print(f"Added trace info for agent: {agent_name}")
                    
                    # Add logs and trace information to the document
                    doc["real_time_logs"] = real_time_logs
                    doc["trace_info"] = trace_info
                    
                    print(f"Final real_time_logs keys: {list(real_time_logs.keys())}")
                    print(f"Final trace_info keys: {list(trace_info.keys())}")
                
                # ✅ FIX: Use _query_db to save with correct user_type
                insert_op = {'type': 'insert_one', 'document': doc}
                self._query_db('workflow_response_collection', insert_op, user_type=user_type)
                print(f"Saved FINAL workflow response → Key: {final_key} | Session: {session_id[-8:]}")
            except Exception as e:
                print(f"Failed to save final response: {e}")
                import traceback
                traceback.print_exc()

            print(f"IsExternal is False. Normal workflow completed.")
            
            return workflow_result

        except Exception as e:
            logging.error("Error in workflow_run_agent_details:", exc_info=True)
            return {"error": str(e)}
    
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
                raise NotFoundError("Workflow not found")

            # Check IsExternal flag AT THE BEGINNING
            is_external = workflow.get("IsExternal", False)
            print(f"Workflow IsExternal flag: {is_external}")

            # Initialize agent_responses and user_queries dictionaries for internal workflows
            agent_responses = {} if not is_external else None
            user_queries = {} if not is_external else None

            # Get request_id and prj_name for logging
            request_id = request.headers.get("X-Request-Id", "-") if request else "-"
            current_user = get_current_user()
            prj_name = current_user.get('ActiveProject', self.config.config.get("MONGODB_COLLECTION_NAME_MASTER", "App Engineering")) if current_user else "App Engineering"
                
            project_doc = self.project.find_one({'projectName': prj_name})
            user_type = project_doc['database_name'] if project_doc else self.config.config["MONGODB_COLLECTION_NAME_MASTER"]

            if is_external:
                print(f"IsExternal is True. Skipping normal workflow and executing DAG workflow directly.")
                
                # Create a simple workflow result to return immediately
                workflow_result = {
                    "results": [
                        {
                            "issue_key": "External Workflow",
                            "result": f"External workflow started for query: {query}"
                        }
                    ]
                }
                
                # Run DAG in a separate thread
                ctx = contextvars.copy_context()
                threading.Thread(
                    target=ctx.run,
                    args=(self.execute_dag_workflow, query, workflow_id, event, session_id, user_id, username, request_id, prj_name),
                    daemon=True
                ).start()
                
                # === NEW: Wait for completion and fetch logs/traces ===
                max_wait_time = 60  # Maximum wait time in seconds
                wait_interval = 2   # Check interval in seconds
                elapsed_time = 0
                
                # Wait for DAG workflow to complete
                while elapsed_time < max_wait_time:
                    time.sleep(wait_interval)
                    elapsed_time += wait_interval
                    
                    # Check if workflow data is saved in database
                    workflow_doc = self.workflow_response_collection.find_one({
                        "workflow_id": workflow_id,
                        "event_id": event,
                        "dag_task_id": {"$exists": True}
                    })
                    
                    if workflow_doc and workflow_doc.get("status") in ["completed", "failed"]:
                        break
                
                # Fetch logs and traces using our method
                logs_and_traces = self.get_workflow_logs_and_traces(workflow_id, event)
                
                # Add logs and traces to the result if successful
                if logs_and_traces.get("success"):
                    workflow_result["real_time_logs"] = logs_and_traces["real_time_logs"]
                    workflow_result["trace_info"] = logs_and_traces["trace_info"]
                    workflow_result["workflow_details"] = logs_and_traces["workflow_details"]
                    
                    print(f"Successfully fetched logs for {len(logs_and_traces['real_time_logs'])} agents")
                    print(f"Successfully fetched traces for {len(logs_and_traces['trace_info'])} agents")
                else:
                    print(f"Could not fetch logs/traces: {logs_and_traces.get('message', 'Unknown error')}")
                    workflow_result["logs_error"] = logs_and_traces.get("message", "Unknown error")
                
                return workflow_result
            
            # === NORMAL WORKFLOW EXECUTION (when IsExternal is False) ===
            flow_data = workflow['flow_data']
            tasks = flow_data.get('tasks', [])
            if not tasks:
                raise NotFoundError("No tasks in workflow")

            # Add workflow context to each task
            for task in tasks:
                task['workflow_id'] = workflow_id
                task['event_id'] = event
                task['user_id'] = user_id
                task['username'] = username

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

            # === DETECT WORKFLOW TYPE AND BLOCK ORDER ===
            has_iterative = any(
                "iterative" in task.get("name", "").lower()
                for task in tasks
            )
            has_conditional = any(
                "condition" in task.get("name", "").lower()
                for task in tasks
            )

            print(f"Workflow Type → Iterative: {has_iterative} | Conditional: {has_conditional}")

            # === RUN NORMAL WORKFLOW ===
            workflow_result = None
            final_key = None
            final_content = None

            # === COMBINATION FLOW: Both Iterative & Conditional ===
            if has_iterative and has_conditional:
                print("Running COMBINATION WORKFLOW: Detecting block order...")

                first_condition_idx = None
                first_iterative_idx = None
                for idx, task in enumerate(tasks):
                    if task.get("function") == "condition" and first_condition_idx is None:
                        first_condition_idx = idx
                    if "iterative" in task.get("name", "").lower() and first_iterative_idx is None:
                        first_iterative_idx = idx

                if first_condition_idx is None or first_iterative_idx is None:
                    print("Could not detect blocks, falling back...")
                    workflow_result = self._wrap_result(None, "Combination fallback")
                else:
                    # === FIX: DEFINE is_part_of_combination AT THE RIGHT SCOPE ===
                    is_part_of_combination = True  # This is a combination flow
                    
                    if first_iterative_idx < first_condition_idx:
                        # ITERATIVE → CONDITIONAL (unchanged)
                        print("Running ITERATIVE → CONDITIONAL workflow")
                        iterative_tasks = tasks[:first_condition_idx]
                        conditional_tasks = tasks[first_condition_idx:]
                        iterative_result = self._run_iterative_workflow(
                            tasks=iterative_tasks, initial_input=query, event_id=event,
                            workflow_id=workflow_id, session_id=session_id, user_id=user_id,
                            username=username, is_part_of_combination=is_part_of_combination,
                            user_queries=user_queries
                        )
                        intermediate_output = iterative_result.get("summary", {}).get("final_content", query)
                        if not is_external and "agent_responses" in iterative_result:
                            agent_responses.update(iterative_result.get("agent_responses", {}))
                        if not is_external and "user_queries" in iterative_result:
                            user_queries.update(iterative_result.get("user_queries", {}))
                        
                        conditional_result = self._run_conditional_workflow(
                            tasks=conditional_tasks, initial_input=intermediate_output,
                            event_id=event, workflow_id=workflow_id, session_id=session_id,
                            user_id=user_id, username=username,
                            user_queries=user_queries
                        )
                        workflow_result = conditional_result
                        # === FIX: Merge agent_responses from conditional result ===
                        if not is_external and isinstance(conditional_result, dict) and "agent_responses" in conditional_result:
                            agent_responses.update(conditional_result["agent_responses"])
                        if not is_external and isinstance(conditional_result, dict) and "user_queries" in conditional_result:
                            user_queries.update(conditional_result["user_queries"])
                    else:
                        # CONDITIONAL → ITERATIVE (CLEAN FIXED VERSION)
                        print("Running CONDITIONAL → ITERATIVE workflow")
                        conditional_tasks = tasks[:first_iterative_idx]   # up to User Story Generator
                        print(f"Conditional tasks: {[t.get('name', '') for t in conditional_tasks]}")

                        # === FIX: Pass a flag to prevent individual block completions ===
                        conditional_result = self._run_conditional_workflow(
                            tasks=conditional_tasks, initial_input=query,
                            event_id=event, workflow_id=workflow_id, session_id=session_id,
                            user_id=user_id, username=username,
                            skip_final_emit=True,  # IMPORTANT: Skip the final emit in conditional block
                            user_queries=user_queries
                        )

                        # Extract User Stories output
                        if isinstance(conditional_result, dict):
                            if conditional_result.get("results"):
                                intermediate_output = conditional_result["results"][0].get("result", query)
                            else:
                                intermediate_output = conditional_result.get("response", query)
                        else:
                            intermediate_output = str(conditional_result)

                        # === FIX: Merge agent_responses from conditional result ===
                        if not is_external and isinstance(conditional_result, dict) and "agent_responses" in conditional_result:
                            agent_responses.update(conditional_result["agent_responses"])
                        if not is_external and isinstance(conditional_result, dict) and "user_queries" in conditional_result:
                            user_queries.update(conditional_result["user_queries"])

                        # ONLY iterative part
                        iterative_tasks = tasks[first_iterative_idx:]
                        print(f"Iterative tasks: {[t.get('name', '') for t in iterative_tasks]}")

                        # === FIX: Pass a flag to prevent individual block completions ===
                        iterative_result = self._run_iterative_workflow(
                            tasks=iterative_tasks,
                            initial_input=intermediate_output,
                            event_id=event,
                            workflow_id=workflow_id,
                            session_id=session_id,
                            user_id=user_id,
                            username=username,
                            is_part_of_combination=is_part_of_combination,
                            skip_final_emit=True,  # IMPORTANT: Skip the final emit in iterative block
                            user_queries=user_queries
                        )

                        # === FIX: Merge agent_responses from iterative result ===
                        if not is_external and "agent_responses" in iterative_result:
                            agent_responses.update(iterative_result.get("agent_responses", {}))
                        if not is_external and "user_queries" in iterative_result:
                            user_queries.update(iterative_result.get("user_queries", {}))

                        summary = iterative_result.get("summary", {})
                        final_key = summary.get("final_key")
                        final_content = summary.get("final_content", intermediate_output)

                        workflow_result = self._wrap_result(final_key, final_content)
                        
                        # === IMPORTANT: Emit final completion ONLY ONCE for the entire combination flow ===
                        self.socketio.emit(f"workflow*{workflow_id}_{event}", {
                            "workflow_id": workflow_id,
                            "event_id": event,
                            "agent_name": "CustomWorkflow",
                            "agent_id": "",
                            "user_id": user_id,
                            "username": username,
                            "status": "completed",
                            "response": final_content,
                            "agent_response": final_content
                        })
                        print(f"Emitted final COMBINATION workflow completion status")
            
            # === Pure Iterative ===
            elif has_iterative:
                print("Running PURE ITERATIVE workflow")
                res = self._run_iterative_workflow(tasks, query, event, workflow_id, session_id, user_id, username, user_queries=user_queries)
                summary = res.get("summary", {})
                final_key = summary.get("final_key")
                final_content = summary.get("final_content", "Done")
                
                # Store agent responses and user queries for internal workflow
                if not is_external and "agent_responses" in res:
                    agent_responses.update(res["agent_responses"])
                if not is_external and "user_queries" in res:
                    user_queries.update(res["user_queries"])
                
                workflow_result = self._wrap_result(final_key, final_content)

            # === Pure Conditional ===
            elif has_conditional:
                print("Running PURE CONDITIONAL workflow")
                conditional_result = self._run_conditional_workflow(
                    tasks=tasks,
                    initial_input=query,
                    event_id=event,
                    workflow_id=workflow_id,
                    session_id=session_id,
                    user_id=user_id,
                    username=username,
                    user_queries=user_queries
                )
                
                # Extract final key & content from conditional result
                if isinstance(conditional_result, dict) and "results" in conditional_result and conditional_result["results"]:
                    result_item = conditional_result["results"][0]
                    final_key = result_item.get("issue_key")
                    final_content = result_item.get("result")
                else:
                    final_key = None
                    final_content = str(conditional_result)
                
                # Store agent responses and user queries for internal workflow
                if not is_external and isinstance(conditional_result, dict) and "agent_responses" in conditional_result:
                    agent_responses.update(conditional_result["agent_responses"])
                if not is_external and isinstance(conditional_result, dict) and "user_queries" in conditional_result:
                    user_queries.update(conditional_result["user_queries"])
                
                workflow_result = self._wrap_result(final_key, final_content)

            # === Fallback: Sequential Agent Chain ===
            else:
                print("Running SEQUENTIAL agent chain")
                current_input = query
                extracted_issue_key = None
                user_queries = {}  # Initialize for sequential workflow
                
                # Track started agents to avoid duplicate emissions
                started_agents = set()

                for idx, task in enumerate(tasks):
                    if task.get('function') != 'call_lyzr_agent':
                        continue
                        
                    prompt = task.get('user_input', '').strip()
                    next_call = task.get('call_next') or task.get('nextcall')
                    config = task['params']['config']
                    agent_name = config.get('agent_name', 'Unknown Agent').strip()
                    agent_id = config.get('agent_id', '')
                    message = f"{prompt}\n\n{current_input}" if prompt else current_input
                    
                    ch = f"workflow*{workflow_id}_{event}"
                    
                    # Emit Started for current agent (if not already emitted)
                    if agent_name not in started_agents:
                        self.socketio.emit(ch, {
                            "workflow_id": workflow_id,
                            "event_id": event,
                            "agent_name": agent_name,
                            "agent_id": agent_id,
                            "user_id": user_id,
                            "username": username,
                            "status": "Started"
                        })
                        started_agents.add(agent_name)
                        print(f"Emitted 'Started' for sequential agent: {agent_name}")

                    # === Execute the agent ===
                    response, agent_session_id, task_logs, user_query = self._execute_single_agent_task(
                        task, message, session_id=session_id, user_id=user_id
                    )

                    # Store responses
                    if not is_external:
                        agent_responses[agent_name] = response
                        user_queries[agent_name] = user_query

                    # Emit completion for current agent
                    self.socketio.emit(ch, {
                        "workflow_id": workflow_id,
                        "event_id": event,
                        "agent_name": agent_name,
                        "agent_id": agent_id,
                        "user_id": user_id,
                        "username": username,
                        "status": "completed",
                        "agent_response": response
                    })
                    print(f"Emitted 'completed' for sequential agent: {agent_name}")

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
                        username=username,
                        next_call=next_call,
                        logs=task_logs
                    )

                    # Update current_input for next iteration
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
                            
                        self.socketio.emit(ch, {
                            "workflow_id": workflow_id,
                            "event_id": event,
                            "agent_name": agent_name,
                            "agent_id": agent_id,
                            "user_id": user_id,
                            "username": username,
                            "status": "completed",
                            "agent_response": primary_result,
                            "created_keys": created_keys
                        })
                    else:
                        current_input = response

                    # === NEW: Handle branching - Emit "Started" for ALL next agents together ===
                    if next_call:
                        next_agents = next_call if isinstance(next_call, list) else [next_call]
                        if len(next_agents) > 1:
                            print(f"Agent {agent_name} branches to {len(next_agents)} agents. Emitting Started together.")
                            
                            for next_name in next_agents:
                                # Find the corresponding task
                                next_task = next((t for t in tasks if t.get("name") == next_name), None)
                                if next_task and next_task.get('function') == 'call_lyzr_agent':
                                    next_config = next_task['params']['config']
                                    next_agent_name = next_config.get('agent_name', 'Unknown Agent').strip()
                                    
                                    if next_agent_name not in started_agents:
                                        next_agent_id = next_config.get('agent_id', '')
                                        self.socketio.emit(ch, {
                                            "workflow_id": workflow_id,
                                            "event_id": event,
                                            "agent_name": next_agent_name,
                                            "agent_id": next_agent_id,
                                            "user_id": user_id,
                                            "username": username,
                                            "status": "Started"
                                        })
                                        started_agents.add(next_agent_name)
                                        print(f"Emitted 'Started' for branched agent: {next_agent_name}")

                # === Final result wrapping ===
                if not extracted_issue_key and current_input:
                    lines = current_input.split('\n')
                    for line in lines:
                        line = line.strip()
                        if line.startswith('# ') or line.startswith('## ') or line.startswith('### '):
                            extracted_issue_key = line.lstrip('#').strip()
                            break
                    if not extracted_issue_key and lines:
                        for line in lines:
                            if line.strip():
                                extracted_issue_key = line.strip()[:50]
                                break
                    if not extracted_issue_key:
                        extracted_issue_key = "Response"

                final_key = extracted_issue_key
                final_content = current_input
                workflow_result = self._wrap_result(final_key, final_content)

                # Final workflow completion emit
                self.socketio.emit(f"workflow*{workflow_id}_{event}", {
                    "workflow_id": workflow_id,
                    "event_id": event,
                    "agent_name": "CustomWorkflow",
                    "agent_id": "",
                    "user_id": user_id,
                    "username": username,
                    "status": "completed",
                    "response": final_content,
                    "agent_response": final_content
                })
                print(f"Emitted final sequential workflow completion status")

            # === SAVE FINAL RESPONSE (NEW VERSION) ===
            try:
                # Get user_type for database operation
                current_user = get_current_user()
                prj_name = current_user.get('ActiveProject', self.config.config.get("MONGODB_COLLECTION_NAME_MASTER", "App Engineering")) if current_user else "App Engineering"
                project_doc = self.project.find_one({'projectName': prj_name})
                user_type = project_doc['database_name'] if project_doc else self.config.config["MONGODB_COLLECTION_NAME_MASTER"]
                
                # Create the comprehensive response document
                doc = {
                    "workflow_id": workflow_id,
                    "event_id": event,
                    "response": agent_responses if not is_external else final_content,  # Store all agent responses for internal workflows
                    "user_query": user_queries if not is_external else None,  # Store user queries for internal workflows
                    "session_id": session_id,
                    "user_id": user_id,
                    "username": username,
                    "timestamp": CommonUtils.get_current_timestamp(),
                    "saved_at": datetime.utcnow(),
                    "status": "completed",
                    "is_external": is_external  # Flag to distinguish between internal and external workflows
                }
                
                
                
                # For internal workflows, add a simplified final_content field for backward compatibility
                if not is_external:
                    doc["final_content"] = final_content
                    doc["key"] = final_key
                    
                    # === NEW: Fetch trace information for internal workflows ===
                    print("\n=== FETCHING TRACE INFO FOR INTERNAL WORKFLOW ===")
                    
                    # Wait a moment to ensure all agent responses are saved
                    time.sleep(3)  # Increased wait time to ensure all responses are saved
                    
                    # Collect trace information for each agent
                    trace_info = {}
                    
                    # Get all agent responses for this workflow execution
                    find_op = {
                        'type': 'find',
                        'filter': {
                            "workflow_id": workflow_id,
                            "event_id": event,
                            "real_time_logs": {"$exists": True, "$ne": []}  # Only get documents with non-empty logs
                        }
                    }
                    agent_responses_docs = self._query_db(
                        'workflow_response_collection',
                        find_op,
                        user_type=user_type
                    )
                    
                    print(f"Found {len(agent_responses_docs)} agent response documents with logs")
                    
                    # For each agent response, fetch trace information
                    for agent_doc in agent_responses_docs:
                        agent_name = agent_doc.get("agent_name", "Unknown")
                        agent_id = agent_doc.get("agent_id", "")
                        agent_session_id = agent_doc.get("session_id", "")
                        
                        # Skip if we don't have the necessary information
                        if not agent_id or not agent_session_id:
                            print(f"Skipping trace fetch for {agent_name} - missing agent_id or session_id")
                            continue
                        
                        # Get the API key for this agent
                        api_key = None
                        for task in tasks:
                            if (task.get("function") == "call_lyzr_agent" and 
                                task.get("params", {}).get("config", {}).get("agent_name") == agent_name):
                                api_key = task.get("params", {}).get("config", {}).get("api_key")
                                break
                        
                        if not api_key:
                            print(f"Skipping trace fetch for {agent_name} - missing API key")
                            continue
                        
                        # Fetch trace information for this agent
                        print(f"Fetching trace for {agent_name} (ID: {agent_id}, Session: {agent_session_id})")
                        agent_trace_info = self._fetch_agent_trace_info(
                            agent_name=agent_name,
                            agent_id=agent_id,
                            agent_session_id=agent_session_id,
                            api_key=api_key,
                            query=query
                        )
                        
                        if agent_trace_info:
                            trace_info[agent_name] = agent_trace_info
                            print(f"Successfully fetched trace for {agent_name}: {agent_trace_info['trace_id']}")
                        else:
                            print(f"Could not fetch trace for {agent_name}")
                        
                        # Add trace information to the document
                        doc["trace_info"] = trace_info
                        
                        print(f"\n=== TRACE INFO COLLECTION COMPLETE ===")
                        print(f"Collected trace info for {len(trace_info)} agents")
                        
                        # Also collect real_time_logs as before
                        real_time_logs = {}
                        
                        for agent_doc in agent_responses_docs:
                            agent_name = agent_doc.get("agent_name", "Unknown")
                            agent_id = agent_doc.get("agent_id", "")
                            
                            # Get logs for this agent
                            if "real_time_logs" in agent_doc and agent_doc["real_time_logs"]:
                                real_time_logs[agent_name] = {
                                    "agent_id": agent_id,
                                    "logs": agent_doc["real_time_logs"]
                                }
                                print(f"Added logs for agent: {agent_name} (ID: {agent_id})")
                        
                        # Add logs to the document
                        doc["real_time_logs"] = real_time_logs
                        
                        print(f"Final real_time_logs keys: {list(real_time_logs.keys())}")
                        print(f"Final trace_info keys: {list(trace_info.keys())}")
                
                # Use _query_db to save with correct user_type
                insert_op = {'type': 'insert_one', 'document': doc}
                self._query_db('workflow_response_collection', insert_op, user_type=user_type)
                print(f"Saved FINAL workflow response → Key: {final_key} | Session: {session_id[-8:]}")
            except Exception as e:
                print(f"Failed to save final response: {e}")
                import traceback
                traceback.print_exc()

            print(f"IsExternal is {is_external}. Workflow completed.")
            
            return workflow_result

        except Exception as e:
            logging.error("Error in workflow_run_agent_details:", exc_info=True)
            return {"error": str(e)}

    def _run_conditional_workflow_old(self, tasks, initial_input, event_id, workflow_id, session_id=None,
                          user_id=None, username=None, skip_final_emit=False, user_queries=None):
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
        agent_responses = {}  # Track agent responses for conditional workflow
        all_user_queries = {} if user_queries is None else user_queries  # Initialize or use passed dictionary
       
        has_push_to_jira = any(
            task.get('function') == 'call_lyzr_agent' and
            'push to jira' in task['params']['config'].get('agent_name', '').lower()
            for task in tasks
        )
        print(f"Workflow has Push to Jira tasks: {has_push_to_jira}")
       
        # Remember the input just before condition for the next agent
        pre_condition_input = None
       
        # Get the condition agent configuration
        condition_agent_config = self.config.config.get("conditionAgent", {})
        print(f"Using condition agent configuration: {condition_agent_config}")
       
        # Helper function to handle workflow errors
        def handle_workflow_error(error_msg, status_code=None, error_type="workflow_error"):
            error_payload = {
                "workflow_id": workflow_id,
                "event_id": event_id,
                "error": True,
                "error_message": error_msg,
                "status_code": status_code,
                "error_type": error_type,
                "status": "failed"
            }
            # Emit error status via socket
            self.socketio.emit(
                f"workflow*{workflow_id}_{event_id}",
                error_payload
            )
            # Save error to database
            try:
                self.workflow_response_collection.insert_one({
                    "workflow_id": workflow_id,
                    "event_id": event_id,
                    "error": True,
                    "error_message": error_msg,
                    "status_code": status_code,
                    "error_type": error_type,
                    "session_id": session_id,
                    "user_id": user_id,
                    "username": username,
                    "timestamp": CommonUtils.get_current_timestamp(),
                    "saved_at": datetime.utcnow(),
                    "status": "failed"
                })
            except Exception as db_error:
                print(f"Failed to save error to database: {db_error}")
            # Return error response
            return self._wrap_result("ERROR", error_msg)
       
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
               
                # Emit "Started" status for this agent execution
                ch = f"workflow*{workflow_id}_{event_id}"
                self.socketio.emit(ch, {
                    "workflow_id": workflow_id,
                    "event_id": event_id,
                    "agent_name": agent_name,
                    "agent_id": agent_id,
                    "user_id": user_id,
                    "username": username,
                    "status": "Started"
                })
                print(f"Emitted 'Started' for agent: {agent_name}")
               
                try:
                    # === CHANGE: Get the full input from _execute_single_agent_task ===
                    response, agent_session_id, task_logs, user_query = self._execute_single_agent_task(
                        task, message, session_id=session_id, user_id=user_id
                    )
                    # Store agent response and user query
                    agent_responses[agent_name] = response
                    all_user_queries[agent_name] = user_query  # Store the full input
                   
                    # Check if response contains an error - this is the key fix
                    if isinstance(response, str) and response.startswith("Request failed:"):
                        # Extract the error message
                        error_msg = response
                        status_code = None
                        error_type = "agent_execution_error"
                        if "429" in response:
                            error_msg = "Agent credits exhausted."
                            status_code = 429
                            error_type = "credits_exhausted"
                        elif "422" in response:
                            error_msg = "Invalid request format. Please check your input and try again."
                            status_code = 422
                            error_type = "invalid_request"
                        elif "Invalid URL" in response:
                            error_msg = "Agent configuration error: Invalid URL. Please check agent configuration."
                            error_type = "agent_config_error"
                        return handle_workflow_error(error_msg, status_code, error_type)
                except Exception as e:
                    # Handle specific error types
                    error_msg = str(e)
                    status_code = None
                    error_type = "agent_execution_error"
                    if "429" in error_msg:
                        error_msg = "Agent credits exhausted."
                        status_code = 429
                        error_type = "credits_exhausted"
                    elif "422" in error_msg:
                        error_msg = "Invalid request format. Please check your input and try again."
                        status_code = 422
                        error_type = "invalid_request"
                    return handle_workflow_error(error_msg, status_code, error_type)
               
                try:
                    self._save_agent_response(workflow_id, event_id, None, agent_id, agent_name, message, response,
                                            session_id=agent_session_id,
                                            user_id=user_id,
                                            username=username,logs=task_logs)
                except Exception as e:
                    return handle_workflow_error(f"Failed to save agent response: {str(e)}", None, "database_error")
               
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
                        return handle_workflow_error(f"Jira connector failed: {str(e)}", None, "jira_error")
                elif "push to jira" in agent_name.lower():
                    print("FINAL STEP → Pushing to Jira...")
                    try:
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
                    except Exception as e:
                        return handle_workflow_error(f"Failed to push to Jira: {str(e)}", None, "jira_error")
                else:
                    current_input = response
               
                # Save the output as pre_condition_input for the next condition
                pre_condition_input = current_input
           
            # === 2. CONDITION — USING CONFIGURED CONDITION AGENT ===
            elif task.get("function") == "condition":
                condition_input = task.get("user_input", "").strip()
                print(f"Evaluating condition with input: '{condition_input}'")
               
                # If we have a condition agent configuration, use it to evaluate
                if condition_agent_config:
                    # Prepare the input for the Condition Agent
                    condition_prompt = f"""Below given is the previous agent response:
        '''
        {pre_condition_input or current_input}
        '''
        Below given is the condition to evaluate:
        '''
        {condition_input}
        '''
       
        Please evaluate if the previous agent's response meets the condition and respond with only 'True' or 'False'."""
                   
                    print(f"Calling Condition Agent with prompt: {condition_prompt[:100]}...")
                   
                    # Call the Condition Agent using the configuration
                    try:
                        headers = {
                            "Content-Type": "application/json",
                            "x-api-key": condition_agent_config.get("x_api_key")
                        }
                        payload = {
                            "user_id": condition_agent_config.get("user_id"),
                            "agent_id": condition_agent_config.get("agent_id"),
                            "session_id": condition_agent_config.get("session_id"),
                            "message": condition_prompt
                        }
                        response = requests.post(
                            condition_agent_config.get("Agent_api_url"),
                            headers=headers,
                            json=payload,
                            timeout=60
                        )
                       
                        # Handle specific HTTP errors
                        if response.status_code == 429:
                            return handle_workflow_error(
                                "Agent credits exhausted.",
                                429,
                                "credits_exhausted"
                            )
                        elif response.status_code == 422:
                            error_detail = "Invalid request format"
                            try:
                                error_data = response.json()
                                if "detail" in error_data:
                                    if isinstance(error_data["detail"], list) and len(error_data["detail"]) > 0:
                                        error_detail = error_data["detail"][0].get("msg", "Invalid request format")
                                    else:
                                        error_detail = str(error_data["detail"])
                            except:
                                pass
                            return handle_workflow_error(
                                f"Validation error: {error_detail}",
                                422,
                                "validation_error"
                            )
                        elif response.status_code != 200:
                            return handle_workflow_error(
                                f"Condition Agent API error: {response.status_code} - {response.text}",
                                response.status_code,
                                "api_error"
                            )
                       
                        condition_response = response.json().get('response', '')
                       
                        # Save the Condition Agent response
                        try:
                            self._save_agent_response(
                                workflow_id=workflow_id,
                                event_id=event_id,
                                task_idx=None,
                                agent_id=condition_agent_config.get("agent_id"),
                                agent_name="Condition Agent",
                                prompt=condition_prompt,
                                response=condition_response,
                                session_id=condition_agent_config.get("session_id"),
                                user_id=user_id,
                                username=username
                            )
                        except Exception as e:
                            return handle_workflow_error(f"Failed to save condition agent response: {str(e)}", None, "database_error")
                       
                        # Store condition agent response and user query
                        agent_responses["Condition Agent"] = condition_response
                        all_user_queries["Condition Agent"] = condition_prompt  # Store the full input
                       
                        print("lyzr response", condition_response)
                       
                        # Parse the response to get True/False
                        condition_result = None
                        if isinstance(condition_response, str):
                            response_lower = condition_response.lower().strip()
                            if "true" in response_lower:
                                condition_result = True
                            elif "false" in response_lower:
                                condition_result = False
                       
                        print(f"Condition Agent evaluation result: {condition_result}")
                       
                        # Get the next tasks based on the condition result
                        config = task["params"]["config"]
                        true_cond_ids = config.get("true_cond_ids", [])
                        false_cond_ids = config.get("false_cond_ids", [])
                        call_next = task.get("call_next") or task.get("nextcall", [])
                       
                        if isinstance(call_next, str):
                            call_next = [call_next]
                       
                        if not call_next:
                            break
                       
                        def get_uuid(name):
                            return name.split('-', 1)[-1] if '-' in name else name
                       
                        uuid_to_name = {get_uuid(n): n for n in call_next if n in name_to_task}
                       
                        # Select the appropriate path based on the condition result
                        selected_primaries = []
                        if condition_result is True:
                            # Use true_cond_ids
                            for uuid in true_cond_ids:
                                name = uuid_to_name.get(uuid)
                                if name:
                                    selected_primaries.append(name)
                            print(f"Condition is True → Following true_cond_ids path: {selected_primaries}")
                        elif condition_result is False:
                            # Use false_cond_ids
                            for uuid in false_cond_ids:
                                name = uuid_to_name.get(uuid)
                                if name:
                                    selected_primaries.append(name)
                            print(f"Condition is False → Following false_cond_ids path: {selected_primaries}")
                        else:
                            # Fallback to first task if condition result is unclear
                            if call_next:
                                selected_primaries = [call_next[0]]
                                print(f"Condition result unclear → Using fallback path: {selected_primaries}")
                       
                        # Emit Started for selected agents
                        for name in selected_primaries:
                            t = name_to_task.get(name)
                            if t:
                                a_name = t["params"]["config"].get("agent_name", "Unknown")
                                a_id = t["params"]["config"].get("agent_id", "")
                                ch = f"workflow*{workflow_id}_{event_id}"
                                self.socketio.emit(ch, {
                                    "workflow_id": workflow_id,
                                    "event_id": event_id,
                                    "agent_name": a_name,
                                    "agent_id": a_id,
                                    "user_id": user_id,
                                    "username": username,
                                    "status": "Started"
                                })
                                print(f"Emitted 'Started' for {a_name}")
                       
                        # Run ALL agents in selected path
                        if selected_primaries:
                            # Link all agents sequentially so they all execute
                            for i in range(len(selected_primaries) - 1):
                                curr_name = selected_primaries[i]
                                next_name = selected_primaries[i + 1]
                                if curr_name in name_to_task:
                                    name_to_task[curr_name]["call_next"] = [next_name]
                                    name_to_task[curr_name]["nextcall"] = [next_name]
                           
                            current_task_name = selected_primaries[0]
                            continue
                       
                        else:
                            return handle_workflow_error("No valid path found after condition evaluation", None, "workflow_error")
                    except requests.exceptions.RequestException as e:
                        # Handle network errors
                        error_msg = f"Network error when calling Condition Agent: {str(e)}"
                        if "429" in str(e):
                            error_msg = "Agent credits exhausted."
                            return handle_workflow_error(error_msg, 429, "credits_exhausted")
                        return handle_workflow_error(error_msg, None, "network_error")
                    except Exception as e:
                        return handle_workflow_error(f"Unexpected error when calling Condition Agent: {str(e)}", None, "condition_agent_error")
                else:
                    # Fallback to original logic if no Condition Agent configuration is found
                    print("No Condition Agent configuration found, using fallback logic")
                    condition_words = {w.strip(".,!?") for w in condition_input.lower().split() if len(w.strip(".,!?")) >= 2}
                    config = task["params"]["config"]
                    true_cond_ids = config.get("true_cond_ids", [])
                    false_cond_ids = config.get("false_cond_ids", [])
                    call_next = task.get("call_next") or task.get("nextcall", [])
                   
                    if isinstance(call_next, str):
                        call_next = [call_next]
                   
                    if not call_next:
                        break
                   
                    def get_uuid(name):
                        return name.split('-', 1)[-1] if '-' in name else name
                   
                    uuid_to_name = {get_uuid(n): n for n in call_next if n in name_to_task}
                    selected_primaries = []
                   
                    for uuid in true_cond_ids:
                        name = uuid_to_name.get(uuid)
                        if not name:
                            continue
                        t = name_to_task.get(name)
                        if not t:
                            continue
                        agent_lower = t["params"]["config"].get("agent_name", "").lower()
                        agent_words = {w.strip(".,!?") for w in agent_lower.split() if len(w.strip(".,!?")) >= 2}
                        intersection = agent_words & condition_words
                        if intersection:
                            selected_primaries.append(name)
                            print(f"CONDITION MATCH → '{t['params']['config'].get('agent_name')}' (matched: {intersection})")
                   
                    to_run = []
                    if selected_primaries:
                        to_run = selected_primaries
                        print(f"Running {len(to_run)} matching true branches in true_cond_ids order")
                    elif true_cond_ids:
                        to_run = [uuid_to_name.get(u) for u in true_cond_ids if uuid_to_name.get(u)]
                        print(f"No keyword match → Running ALL {len(to_run)} true branches")
                   
                    if not to_run:
                        fallbacks = []
                        if false_cond_ids:
                            fallbacks = [uuid_to_name.get(u) for u in false_cond_ids if uuid_to_name.get(u)]
                        if not fallbacks:
                            fallbacks = call_next[:1]
                        if fallbacks:
                            to_run = [fallbacks[0]]
                            fb_name = name_to_task.get(to_run[0], {}).get("params", {}).get("config", {}).get("agent_name", "Unknown")
                            reason = "false_cond_ids" if false_cond_ids else "call_next"
                            print(f"No true path → Fallback to {reason}: {fb_name}")
                   
                    # Emit Started for primaries
                    for name in to_run:
                        t = name_to_task.get(name)
                        if t:
                            a_name = t["params"]["config"].get("agent_name", "Unknown")
                            a_id = t["params"]["config"].get("agent_id", "")
                            ch = f"workflow*{workflow_id}_{event_id}"
                            self.socketio.emit(ch, {
                                "workflow_id": workflow_id,
                                "event_id": event_id,
                                "agent_name": a_name,
                                "agent_id": a_id,
                                "user_id": user_id,
                                "username": username,
                                "status": "Started"
                            })
                            print(f"Emitted 'Started' for {a_name}")
                   
                    # Start first branch with pre-condition input
                    if to_run:
                        current_task_name = to_run[0]
                        # Keep current_input as is (it's already the output from the previous agent)
                        continue
                    else:
                        return handle_workflow_error("No valid path found in fallback logic", None, "workflow_error")
           
            # === 3. NORMAL FLOW ===
            call_next = task.get("call_next") or task.get("nextcall")
            if not call_next:
                print(f"Task {current_task_name} has no call_next → workflow end")
                break
           
            if isinstance(call_next, list):
                if not call_next:
                    print(f"Empty call_next list → workflow end")
                    break
                current_task_name = call_next[0]
            else:
                stripped = call_next.strip()
                if not stripped:
                    break
                current_task_name = stripped
       
        # Final handling (unchanged)
        if not extracted_issue_key and current_input:
            lines = current_input.split('\n')
            for line in lines:
                line = line.strip()
                if line.startswith('# ') or line.startswith('## ') or line.startswith('### '):
                    extracted_issue_key = line.lstrip('#').strip()
                    break
            if not extracted_issue_key and lines:
                for line in lines:
                    if line.strip():
                        extracted_issue_key = line.strip()[:50]
                        break
            if not extracted_issue_key:
                extracted_issue_key = "Response"
       
        # === SEND COMPLETION STATUS IMMEDIATELY ===
        if not skip_final_emit:
            completion_payload = {
                "workflow_id": workflow_id,
                "event_id": event_id,
                "agent_name": "CustomWorkflow",
                "agent_response": current_input,
                "response": current_input,
                "user_id": user_id,
                "username": username,
                "status": "completed"
            }
           
            self.socketio.emit(
                f"workflow*{workflow_id}_{event_id}",
                completion_payload
            )
            print(f"Emitted final conditional workflow completion status immediately")
       
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
       
        # Return the result with agent responses and user queries
        result = self._wrap_result(extracted_issue_key, current_input)
        if isinstance(result, dict):
            result["agent_responses"] = agent_responses
            result["user_queries"] = all_user_queries  # Add user_queries to return
        return result
        
    def _run_conditional_workflow_o(self, tasks, initial_input, event_id, workflow_id, session_id=None,
                          user_id=None, username=None, skip_final_emit=False, user_queries=None):
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
        agent_responses = {}
        all_user_queries = {} if user_queries is None else user_queries
      
        has_push_to_jira = any(
            task.get('function') == 'call_lyzr_agent' and
            'push to jira' in task['params']['config'].get('agent_name', '').lower()
            for task in tasks
        )
        print(f"Workflow has Push to Jira tasks: {has_push_to_jira}")
      
        pre_condition_input = None
        condition_agent_config = self.config.config.get("conditionAgent", {})
        print(f"Using condition agent configuration: {condition_agent_config}")
        
        # ====================== HELPER: Execute Full Chain ======================
        def execute_agent_chain(start_name, branch_input=None):
            nonlocal current_input, pre_condition_input, extracted_issue_key
            if branch_input is not None:
                current_input = branch_input
            current = start_name
            while current and current not in visited:
                visited.add(current)
                task = name_to_task.get(current)
                if not task:
                    break
                   
                agent_name = task["params"]["config"].get("agent_name", "Unknown Agent")
                print(f"Executing (chain) → {current} | {agent_name}")
               
                if task.get("function") == "call_lyzr_agent":
                    config = task["params"]["config"]
                    agent_id = config.get("agent_id", "")
                    prompt = task.get("user_input", "").strip()
                    message = f"{prompt}\n\n{current_input}" if prompt else current_input
                  
                    # Emit Started when chained agent actually starts
                    ch = f"workflow*{workflow_id}_{event_id}"
                    self.socketio.emit(ch, {
                        "workflow_id": workflow_id,
                        "event_id": event_id,
                        "agent_name": agent_name,
                        "agent_id": agent_id,
                        "user_id": user_id,
                        "username": username,
                        "status": "Started"
                    })
                  
                    try:
                        response, agent_session_id, task_logs, user_query = self._execute_single_agent_task(
                            task, message, session_id=session_id, user_id=user_id
                        )
                        agent_responses[agent_name] = response
                        all_user_queries[agent_name] = user_query
                      
                        if isinstance(response, str) and response.startswith("Request failed:"):
                            return handle_workflow_error(response)
                    except Exception as e:
                        return handle_workflow_error(str(e))
                  
                    try:
                        self._save_agent_response(workflow_id, event_id, None, agent_id, agent_name, message, response,
                                                session_id=agent_session_id, user_id=user_id,
                                                username=username, logs=task_logs)
                    except Exception as e:
                        return handle_workflow_error(f"Failed to save agent response: {str(e)}", None, "database_error")
                  
                    if "jira" in agent_name.lower() and "connector" in agent_name.lower():
                        try:
                            latest_issues = self.filter_latest_by_updated(response)
                            field = task.get("user_input", "description").strip() or "description"
                            clean = self._clean_objectids(latest_issues)
                            extracted = self.extract_descriptions(clean, field)
                            if extracted:
                                extracted_issue_key = extracted[0]["key"]
                                current_input = extracted[0]["description"]
                            else:
                                current_input = response
                        except Exception as e:
                            return handle_workflow_error(f"Jira connector failed: {str(e)}", None, "jira_error")
                    elif "push to jira" in agent_name.lower():
                        print("FINAL STEP → Pushing to Jira...")
                        try:
                            new_cur, keys, _, primary = self._bulk_push_to_jira(
                                task, current_input, workflow_id, event_id, None,
                                agent_id, agent_name, save_response=True,
                                session_id=session_id, user_id=user_id, username=username
                            )
                            extracted_issue_key = keys[0] if keys else extracted_issue_key
                            current_input = primary or new_cur
                        except Exception as e:
                            return handle_workflow_error(f"Failed to push to Jira: {str(e)}", None, "jira_error")
                    else:
                        current_input = response
                  
                    pre_condition_input = current_input
               
                elif task.get("function") == "condition":
                    current_input = _handle_condition(task)
               
                call_next = task.get("call_next") or task.get("nextcall")
                if isinstance(call_next, list) and call_next:
                    current = call_next[0]
                elif isinstance(call_next, str):
                    current = call_next.strip()
                else:
                    current = None

        # ====================== CONDITION HANDLER ======================
        def _handle_condition(condition_task):
            nonlocal current_input, pre_condition_input
            condition_input = condition_task.get("user_input", "").strip()
            print(f"Evaluating condition with input: '{condition_input}'")
            if not condition_agent_config:
                print("No Condition Agent configuration found")
                return current_input
            condition_prompt = f"""Below given is the previous agent response:
'''
{current_input}
'''
Below given is the condition to evaluate:
'''
{condition_input}
'''
Please evaluate if the previous agent's response meets the condition and respond with only 'True' or 'False'."""
            try:
                headers = {
                    "Content-Type": "application/json",
                    "x-api-key": condition_agent_config.get("x_api_key")
                }
                payload = {
                    "user_id": condition_agent_config.get("user_id"),
                    "agent_id": condition_agent_config.get("agent_id"),
                    "session_id": condition_agent_config.get("session_id"),
                    "message": condition_prompt
                }
                response = requests.post(
                    condition_agent_config.get("Agent_api_url"),
                    headers=headers,
                    json=payload,
                    timeout=60
                )
                if response.status_code == 429:
                    return handle_workflow_error("Agent credits exhausted.", 429, "credits_exhausted")
                elif response.status_code != 200:
                    return current_input
                condition_response = response.json().get('response', '')
               
                try:
                    self._save_agent_response(
                        workflow_id=workflow_id,
                        event_id=event_id,
                        task_idx=None,
                        agent_id=condition_agent_config.get("agent_id"),
                        agent_name="Condition Agent",
                        prompt=condition_prompt,
                        response=condition_response,
                        session_id=condition_agent_config.get("session_id"),
                        user_id=user_id,
                        username=username
                    )
                except Exception as e:
                    print(f"Save condition failed: {e}")
                agent_responses["Condition Agent"] = condition_response
                all_user_queries["Condition Agent"] = condition_prompt
                condition_result = None
                if isinstance(condition_response, str):
                    response_lower = condition_response.lower().strip()
                    if "true" in response_lower:
                        condition_result = True
                    elif "false" in response_lower:
                        condition_result = False
                print(f"Condition Agent evaluation result: {condition_result}")
                config = condition_task["params"]["config"]
                true_cond_ids = config.get("true_cond_ids", [])
                false_cond_ids = config.get("false_cond_ids", [])
                def get_uuid(name):
                    return name.split('-', 1)[-1] if '-' in name else name
                uuid_to_name = {get_uuid(n): n for n in name_to_task}
                selected_primaries = []
                if condition_result is True:
                    for uuid in true_cond_ids:
                        name = uuid_to_name.get(uuid)
                        if name:
                            selected_primaries.append(name)
                elif condition_result is False:
                    for uuid in false_cond_ids:
                        name = uuid_to_name.get(uuid)
                        if name:
                            selected_primaries.append(name)

                # === EMIT STARTED FOR ALL DIRECT AGENTS AFTER CONDITION ===
                branch_input = pre_condition_input or current_input
                for name in selected_primaries:
                    if name:
                        t = name_to_task.get(name)
                        if t:
                            a_name = t["params"]["config"].get("agent_name", "Unknown")
                            a_id = t["params"]["config"].get("agent_id", "")
                            self.socketio.emit(f"workflow*{workflow_id}_{event_id}", {
                                "workflow_id": workflow_id,
                                "event_id": event_id,
                                "agent_name": a_name,
                                "agent_id": a_id,
                                "user_id": user_id,
                                "username": username,
                                "status": "Started"
                            })
                            print(f"Emitted 'Started' for {a_name} after condition")

                # Execute chains
                for name in selected_primaries:
                    if name:
                        execute_agent_chain(name, branch_input=branch_input)
                return current_input
            except Exception as e:
                print(f"Condition Agent error: {e}")
                return current_input

        # ====================== ERROR HANDLER ======================
        def handle_workflow_error(error_msg, status_code=None, error_type="workflow_error"):
            error_payload = {
                "workflow_id": workflow_id,
                "event_id": event_id,
                "error": True,
                "error_message": error_msg,
                "status_code": status_code,
                "error_type": error_type,
                "status": "failed"
            }
            self.socketio.emit(f"workflow*{workflow_id}_{event_id}", error_payload)
            try:
                self.workflow_response_collection.insert_one({
                    "workflow_id": workflow_id,
                    "event_id": event_id,
                    "error": True,
                    "error_message": error_msg,
                    "status_code": status_code,
                    "error_type": error_type,
                    "session_id": session_id,
                    "user_id": user_id,
                    "username": username,
                    "timestamp": CommonUtils.get_current_timestamp(),
                    "saved_at": datetime.utcnow(),
                    "status": "failed"
                })
            except Exception as db_error:
                print(f"Failed to save error to database: {db_error}")
            return self._wrap_result("ERROR", error_msg)

        # ====================== MAIN LOOP ======================
        while current_task_name and current_task_name not in visited:
            visited.add(current_task_name)
            task = name_to_task.get(current_task_name)
            if not task:
                break
            agent_name = task["params"]["config"].get("agent_name", "Unknown Agent")
            print(f"Executing → {current_task_name} | {agent_name}")
          
            if task.get("function") == "call_lyzr_agent":
                config = task["params"]["config"]
                agent_id = config.get("agent_id", "")
                prompt = task.get("user_input", "").strip()
                message = f"{prompt}\n\n{current_input}" if prompt else current_input
              
                ch = f"workflow*{workflow_id}_{event_id}"
                self.socketio.emit(ch, {
                    "workflow_id": workflow_id,
                    "event_id": event_id,
                    "agent_name": agent_name,
                    "agent_id": agent_id,
                    "user_id": user_id,
                    "username": username,
                    "status": "Started"
                })
              
                try:
                    response, agent_session_id, task_logs, user_query = self._execute_single_agent_task(
                        task, message, session_id=session_id, user_id=user_id
                    )
                    agent_responses[agent_name] = response
                    all_user_queries[agent_name] = user_query
                  
                    if isinstance(response, str) and response.startswith("Request failed:"):
                        return handle_workflow_error(response)
                except Exception as e:
                    return handle_workflow_error(str(e))
              
                try:
                    self._save_agent_response(workflow_id, event_id, None, agent_id, agent_name, message, response,
                                            session_id=agent_session_id, user_id=user_id,
                                            username=username, logs=task_logs)
                except Exception as e:
                    return handle_workflow_error(f"Failed to save agent response: {str(e)}", None, "database_error")
              
                if "jira" in agent_name.lower() and "connector" in agent_name.lower():
                    try:
                        latest_issues = self.filter_latest_by_updated(response)
                        field = task.get("user_input", "description").strip() or "description"
                        clean = self._clean_objectids(latest_issues)
                        extracted = self.extract_descriptions(clean, field)
                        if extracted:
                            extracted_issue_key = extracted[0]["key"]
                            current_input = extracted[0]["description"]
                        else:
                            current_input = response
                    except Exception as e:
                        return handle_workflow_error(f"Jira connector failed: {str(e)}", None, "jira_error")
                elif "push to jira" in agent_name.lower():
                    print("FINAL STEP → Pushing to Jira...")
                    try:
                        new_cur, keys, _, primary = self._bulk_push_to_jira(
                            task, current_input, workflow_id, event_id, None,
                            agent_id, agent_name, save_response=True,
                            session_id=session_id, user_id=user_id, username=username
                        )
                        extracted_issue_key = keys[0] if keys else extracted_issue_key
                        current_input = primary or new_cur
                    except Exception as e:
                        return handle_workflow_error(f"Failed to push to Jira: {str(e)}", None, "jira_error")
                else:
                    current_input = response
              
                pre_condition_input = current_input
          
            elif task.get("function") == "condition":
                _handle_condition(task)
          
            # === NORMAL FLOW ===
            call_next = task.get("call_next") or task.get("nextcall")
            if not call_next:
                print(f"Task {current_task_name} has no call_next → workflow end")
                break
          
            if isinstance(call_next, list):
                current_task_name = call_next[0] if call_next else None
            else:
                current_task_name = call_next.strip() if call_next else None
      
        # Final handling (unchanged)
        if not extracted_issue_key and current_input:
            lines = current_input.split('\n')
            for line in lines:
                line = line.strip()
                if line.startswith('# ') or line.startswith('## ') or line.startswith('### '):
                    extracted_issue_key = line.lstrip('#').strip()
                    break
            if not extracted_issue_key and lines:
                for line in lines:
                    if line.strip():
                        extracted_issue_key = line.strip()[:50]
                        break
            if not extracted_issue_key:
                extracted_issue_key = "Response"
      
        if not skip_final_emit:
            completion_payload = {
                "workflow_id": workflow_id,
                "event_id": event_id,
                "agent_name": "CustomWorkflow",
                "agent_response": current_input,
                "response": current_input,
                "user_id": user_id,
                "username": username,
                "status": "completed"
            }
            self.socketio.emit(f"workflow*{workflow_id}_{event_id}", completion_payload)
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
            except Exception as e:
                print(f"Failed to save final response: {e}")
      
        result = self._wrap_result(extracted_issue_key, current_input)
        if isinstance(result, dict):
            result["agent_responses"] = agent_responses
            result["user_queries"] = all_user_queries
        return result
  
    def _run_conditional_workflow(self, tasks, initial_input, event_id, workflow_id, session_id=None,
                          user_id=None, username=None, skip_final_emit=False, user_queries=None):
        """
        Generic conditional workflow executor that handles:
        - Multiple condition nodes (1 to n)
        - Multiple Yes/No path agents (1 to n per condition)
        - Chained agents within branches
        - Sequential execution of branches
        - Proper input propagation
        """
        if not tasks:
            return self._wrap_result(None, initial_input)

        # Initialize workflow state
        workflow_state = self._initialize_workflow(tasks, initial_input, user_queries)
        
        # Execute workflow
        result = self._execute_workflow(workflow_state, event_id, workflow_id, 
                                    session_id, user_id, username, skip_final_emit)
        
        return result

    def _initialize_workflow(self, tasks, initial_input, user_queries):
        """Initialize workflow state and task mapping"""
        name_to_task = {task.get("name"): task for task in tasks if task.get("name")}
        
        # Build task graph
        task_graph = {}
        for task in tasks:
            name = task.get("name")
            if not name:
                continue
                
            next_tasks = []
            call_next = task.get("call_next") or task.get("nextcall")
            if call_next:
                if isinstance(call_next, list):
                    next_tasks.extend(call_next)
                else:
                    next_tasks.append(call_next.strip())
            task_graph[name] = next_tasks
        
        # Find start task
        pointed_to = set()
        for next_tasks in task_graph.values():
            pointed_to.update(next_tasks)
            
        start_task = next((t for t in tasks if t.get("name") and t.get("name") not in pointed_to), tasks[0])
        
        return {
            "tasks": tasks,
            "name_to_task": name_to_task,
            "task_graph": task_graph,
            "current_task_name": start_task.get("name"),
            "visited": set(),
            "agent_responses": {},
            "all_user_queries": {} if user_queries is None else user_queries,
            "current_input": initial_input,
            "extracted_issue_key": None,
            "pre_condition_input": None,
            "condition_agent_config": self.config.config.get("conditionAgent", {})
        }

    def _execute_workflow(self, workflow_state, event_id, workflow_id, session_id, 
                        user_id, username, skip_final_emit):
        """Main workflow execution loop"""
        while workflow_state["current_task_name"] and workflow_state["current_task_name"] not in workflow_state["visited"]:
            task_name = workflow_state["current_task_name"]
            task = workflow_state["name_to_task"].get(task_name)
            
            if not task:
                break
                
            workflow_state["visited"].add(task_name)
            
            # Execute based on task type
            if task.get("function") == "call_lyzr_agent":
                result = self._execute_agent_task(task, workflow_state, event_id, workflow_id, 
                                                session_id, user_id, username)
                if result.get("error"):
                    return result
                    
            elif task.get("function") == "condition":
                result = self._execute_condition_task(task, workflow_state, event_id, workflow_id, 
                                                    user_id, username, session_id)
                if result.get("error"):
                    return result
                break  # Stop main flow after condition handling
            
            # Move to next task
            workflow_state["current_task_name"] = self._get_next_task(task, workflow_state["task_graph"])
        
        # Final emit and result
        if not skip_final_emit:
            self._emit_final_completion(workflow_state, event_id, workflow_id, user_id, username)
        
        return self._prepare_final_result(workflow_state)

    def _execute_agent_task(self, task, workflow_state, event_id, workflow_id, session_id, user_id, username):
        """Execute a single agent task"""
        agent_name = task["params"]["config"].get("agent_name", "Unknown Agent")
        agent_id = task["params"]["config"].get("agent_id", "")
        prompt = task.get("user_input", "").strip()
        message = f"{prompt}\n\n{workflow_state['current_input']}" if prompt else workflow_state["current_input"]
        
        # Emit start event
        self._emit_agent_start(event_id, workflow_id, agent_name, agent_id, user_id, username)
        
        try:
            response, agent_session_id, task_logs, user_query = self._execute_single_agent_task(
                task, message, session_id=session_id, user_id=user_id
            )
            
            # Store responses
            workflow_state["agent_responses"][agent_name] = response
            workflow_state["all_user_queries"][agent_name] = user_query
            
            # Save response
            self._save_agent_response(workflow_id, event_id, None, agent_id, agent_name, 
                                    message, response, session_id=agent_session_id,
                                    user_id=user_id, username=username, logs=task_logs)
            
            # Process response
            workflow_state["current_input"], workflow_state["extracted_issue_key"] = self._process_agent_response(
                agent_name, response, task, workflow_state["current_input"], workflow_state["extracted_issue_key"]
            )
            
            workflow_state["pre_condition_input"] = workflow_state["current_input"]
            
        except Exception as e:
            return self._handle_workflow_error(str(e), None, "agent_error", event_id, workflow_id, session_id, user_id, username)
       
        return {"error": False}

    def _execute_condition_task(self, condition_task, workflow_state, event_id, workflow_id, user_id, username, session_id):
        """
        Execute a condition task and its selected branches based on condition result.
        - Each condition stores its own previous agent response
        - All branches within a condition start with the condition's input
        - Branches execute independently (no output passing between branches)
        - Each branch can have its own chain of agents or nested conditions
        """
        condition_input = condition_task.get("user_input", "").strip()
        
        if not workflow_state["condition_agent_config"]:
            return {"error": False}
        
        # Evaluate condition
        condition_result = self._evaluate_condition(
            condition_input, 
            workflow_state["pre_condition_input"] or workflow_state["current_input"],
            workflow_state["condition_agent_config"],
            event_id, workflow_id, user_id, username, session_id
        )
        
        # Check if condition evaluation failed
        if condition_result.get("error"):
            return condition_result
        
        # Get selected branch tasks based on condition result
        selected_branch_tasks = self._get_selected_branches(
            condition_task, 
            condition_result["result"],  # This should be safe now
            workflow_state["name_to_task"]
        )
        
        # Store the condition's input (previous agent response for this condition)
        condition_input_value = workflow_state["pre_condition_input"] or workflow_state["current_input"]
        
        # Execute all branches independently (no output passing between branches)
        for branch_task_name in selected_branch_tasks:
            # Each branch starts with the condition's input
            result = self._execute_branch(
                branch_task_name,
                condition_input_value,  # All branches start with condition's input
                workflow_state,
                event_id, workflow_id, user_id, username, session_id
            )
            
            if result.get("error"):
                return result
        
        return {"error": False}
    
    def _get_selected_branches(self, condition_task, condition_result, name_to_task):
        """
        Get only the selected branches based on condition result:
        - If True: return only Yes path agents
        - If False: return only No path agents
        """
        config = condition_task["params"]["config"]
        
        # Get the appropriate branch IDs based on condition result
        if condition_result:
            branch_ids = config.get("true_cond_ids", [])
        else:
            branch_ids = config.get("false_cond_ids", [])
        
        # Convert IDs to task names
        def get_uuid(name):
            return name.split('-', 1)[-1] if '-' in name else name
        
        uuid_to_name = {get_uuid(n): n for n in name_to_task}
        selected_branches = []
        
        for uuid in branch_ids:
            name = uuid_to_name.get(uuid)
            if name:
                selected_branches.append(name)
        
        return selected_branches

    def _execute_branch(self, start_task_name, branch_input, workflow_state, event_id, workflow_id, user_id, username, session_id):
        """
        Execute a branch (single Yes or No path) with its chained agents.
        Executes the complete chain of agents in this branch.
        """
        # Create a copy of visited tasks to isolate branch execution
        original_visited = workflow_state["visited"].copy()
        
        # Set branch input
        original_input = workflow_state["current_input"]
        workflow_state["current_input"] = branch_input
        
        # Execute branch chain
        current = start_task_name
        while current and current not in workflow_state["visited"]:
            workflow_state["visited"].add(current)
            task = workflow_state["name_to_task"].get(current)
            
            if not task:
                break
                
            if task.get("function") == "call_lyzr_agent":
                result = self._execute_agent_task(task, workflow_state, event_id, workflow_id, 
                                                session_id, user_id, username)
                if result.get("error"):
                    # Restore original state
                    workflow_state["visited"] = original_visited
                    workflow_state["current_input"] = original_input
                    return result
                    
            elif task.get("function") == "condition":
                # Nested condition handling - execute its selected branches
                result = self._execute_condition_task(task, workflow_state, event_id, workflow_id, 
                                                    user_id, username, session_id)
                if result.get("error"):
                    workflow_state["visited"] = original_visited
                    workflow_state["current_input"] = original_input
                    return result
                break  # Stop after condition in branch
            
            # Move to next task in branch
            current = self._get_next_task(task, workflow_state["task_graph"])
        
        # Restore original visited set
        workflow_state["visited"] = original_visited
        
        return {"error": False}

    def _evaluate_condition(self, condition_input, input_data, config, event_id, workflow_id, user_id, username, session_id):
        """Evaluate a condition using the condition agent"""
        condition_prompt = f"""Previous agent response:
    '''
    {input_data}
    '''
    Condition to evaluate:
    '''
    {condition_input}
    '''
    Respond with only 'True' or 'False'."""
        
        try:
            headers = {"Content-Type": "application/json", "x-api-key": config.get("x_api_key")}
            payload = {
                "user_id": config.get("user_id"),
                "agent_id": config.get("agent_id"),
                "session_id": config.get("session_id"),
                "message": condition_prompt
            }
            response = requests.post(config.get("Agent_api_url"), headers=headers, json=payload, timeout=60)
            
            if response.status_code == 429:
                return self._handle_workflow_error("Agent credits exhausted.", 429, "credits_exhausted", 
                                                event_id, workflow_id, session_id, user_id, username)
            elif response.status_code != 200:
                return self._handle_workflow_error(f"Condition Agent failed: {response.status_code}", 
                                                response.status_code, "condition_error",
                                                event_id, workflow_id, session_id, user_id, username)
            
            condition_response = response.json().get('response', '')
            
            # Save condition response
            self._save_agent_response(
                workflow_id=workflow_id, event_id=event_id, task_idx=None,
                agent_id=config.get("agent_id"), agent_name="Condition Agent",
                prompt=condition_prompt, response=condition_response,
                session_id=config.get("session_id"), user_id=user_id, username=username
            )
            
            # Parse condition result
            if isinstance(condition_response, str):
                response_lower = condition_response.lower().strip()
                result = "true" in response_lower
            else:
                result = False
            
            return {"error": False, "result": result}
            
        except Exception as e:
            return self._handle_workflow_error(f"Condition Agent error: {str(e)}", 
                                            None, "condition_error",
                                            event_id, workflow_id, session_id, user_id, username)

    def _process_agent_response(self, agent_name, response, task, current_input, extracted_issue_key):
        """Process agent response and update workflow state"""
        if "jira" in agent_name.lower() and "connector" in agent_name.lower():
            try:
                latest_issues = self.filter_latest_by_updated(response)
                field = task.get("user_input", "description").strip() or "description"
                clean = self._clean_objectids(latest_issues)
                extracted = self.extract_descriptions(clean, field)
                if extracted:
                    extracted_issue_key = extracted[0]["key"]
                    current_input = extracted[0]["description"]
                else:
                    current_input = response
            except Exception as e:
                self._handle_workflow_error(f"Jira connector failed: {str(e)}", None, "jira_error", None, None, None, None, None)
        elif "push to jira" in agent_name.lower():
            try:
                new_cur, keys, _, primary = self._bulk_push_to_jira(
                    task, current_input, None, None, None,
                    task["params"]["config"].get("agent_id"), agent_name, 
                    save_response=True, session_id=None, 
                    user_id=None, username=None
                )
                extracted_issue_key = keys[0] if keys else extracted_issue_key
                current_input = primary or new_cur
            except Exception as e:
                self._handle_workflow_error(f"Failed to push to Jira: {str(e)}", None, "jira_error", None, None, None, None, None)
        else:
            current_input = response
        
        return current_input, extracted_issue_key

    def _get_next_task(self, task, task_graph):
        """Get the next task in the workflow"""
        call_next = task.get("call_next") or task.get("nextcall")
        if isinstance(call_next, list) and call_next:
            return call_next[0]
        elif isinstance(call_next, str):
            return call_next.strip()
        return None

    def _emit_agent_start(self, event_id, workflow_id, agent_name, agent_id, user_id, username):
        """Emit agent start event"""
        ch = f"workflow*{workflow_id}_{event_id}"
        self.socketio.emit(ch, {
            "workflow_id": workflow_id, "event_id": event_id,
            "agent_name": agent_name, "agent_id": agent_id,
            "user_id": user_id, "username": username, "status": "Started"
        })

    def _emit_final_completion(self, workflow_state, event_id, workflow_id, user_id, username):
        """Emit final completion event"""
        self.socketio.emit(f"workflow*{workflow_id}_{event_id}", {
            "workflow_id": workflow_id,
            "event_id": event_id,
            "agent_name": "CustomWorkflow",
            "agent_id": "",
            "user_id": user_id,
            "username": username,
            "status": "completed",
            "response": workflow_state["current_input"],
            "agent_response": workflow_state["current_input"]
        })

    def _prepare_final_result(self, workflow_state):
        """Prepare the final result with all responses"""
        result = self._wrap_result(workflow_state["extracted_issue_key"], workflow_state["current_input"])
        if isinstance(result, dict):
            result["agent_responses"] = workflow_state["agent_responses"]
            result["user_queries"] = workflow_state["all_user_queries"]
        return result

    def _handle_workflow_error(self, error_msg, status_code, error_type, event_id, workflow_id, 
                            session_id, user_id, username):
        """Handle workflow errors"""
        error_payload = {
            "workflow_id": workflow_id,
            "event_id": event_id,
            "error": True,
            "error_message": error_msg,
            "status_code": status_code,
            "error_type": error_type,
            "status": "failed"
        }
        self.socketio.emit(f"workflow*{workflow_id}_{event_id}", error_payload)
        try:
            self.workflow_response_collection.insert_one({
                "workflow_id": workflow_id,
                "event_id": event_id,
                "error": True,
                "error_message": error_msg,
                "status_code": status_code,
                "error_type": error_type,
                "session_id": session_id,
                "user_id": user_id,
                "username": username,
                "timestamp": CommonUtils.get_current_timestamp(),
                "saved_at": datetime.utcnow(),
                "status": "failed"
            })
        except Exception as db_error:
            print(f"Failed to save error: {db_error}")
        return self._wrap_result("ERROR", error_msg)




    
    def _run_iterative_workflow_old(self, tasks, initial_input, event_id, workflow_id, session_id=None, user_id=None, username=None, is_part_of_combination=False, skip_final_emit=False, user_queries=None):
        print("=== SIMPLE ITERATIVE WORKFLOW STARTED ===")
        
        current = initial_input
        all_agent_responses = {}
        all_user_queries = {} if user_queries is None else user_queries
        
        # Build a mapping of task names to tasks for quick lookup
        name_to_task = {task.get("name"): task for task in tasks if task.get("name")}
        
        # Find the iterative marker and the agent after it
        iterating_agent = None
        iterative_marker_index = None
        iterating_agent_task = None
        
        for i, task in enumerate(tasks):
            if "iterative" in task.get("name", "").lower():
                iterative_marker_index = i
                for j in range(i + 1, len(tasks)):
                    if tasks[j].get('function') == 'call_lyzr_agent':
                        iterating_agent = tasks[j]
                        iterating_agent_task = tasks[j]
                        print(f"Found iterating agent: {iterating_agent['params']['config'].get('agent_name')}")
                        break
                break
        
        for task_idx, task in enumerate(tasks):
            if task.get('function') != 'call_lyzr_agent':
                continue
                
            agent_name = task['params']['config'].get('agent_name', '').strip()
            agent_id = task['params']['config'].get('agent_id', '')
            
            # Check if this is the iterating agent
            is_iterating_this_agent = (iterating_agent and task.get("name") == iterating_agent.get("name"))
            
            if is_iterating_this_agent:
                # Extract items from current context
                items = self._extract_iterable_items(current)
                print(f"Checking for iteration - Agent: {agent_name}, Items found: {len(items)}")
                
                if len(items) > 1:
                    print(f"ITERATING AGENT DETECTED: {agent_name} with {len(items)} items")
                    
                    # Store the combined input that will be sent to the agent
                    agent_prompt = task.get('user_input', '').strip()
                    combined_input = f"{agent_prompt}\n\n{current}" if agent_prompt else current
                    all_user_queries[agent_name] = combined_input
                    
                    # Emit "Started" status
                    ch = f"workflow*{workflow_id}_{event_id}"
                    self.socketio.emit(ch, {
                        "workflow_id": workflow_id,
                        "event_id": event_id,
                        "agent_name": agent_name,
                        "agent_id": agent_id,
                        "user_id": user_id,
                        "username": username,
                        "status": "Started"
                    })
                    print(f"Emitted 'Started' for iterating agent: {agent_name}")
                    
                    iteration_results = []
                    for item_idx, item in enumerate(items, 1):
                        print(f"--- Running {agent_name} for item {item_idx}/{len(items)} ---")
                        message = f"{agent_prompt}\n\n{item}"
                        
                        response, sess, logs, user_query = self._execute_single_agent_task(
                            task, message, session_id=session_id, user_id=user_id
                        )
                        iteration_results.append(str(response))
                    
                    current = "\n\n---\n\n".join(iteration_results)
                    all_agent_responses[agent_name] = current
                    
                    # Emit completion
                    self.socketio.emit(ch, {
                        "workflow_id": workflow_id,
                        "event_id": event_id,
                        "agent_name": agent_name,
                        "agent_id": agent_id,
                        "user_id": user_id,
                        "username": username,
                        "status": "completed",
                        "agent_response": current,
                        "prompt_output": current
                    })
                    
                    # Save the final combined response
                    self._save_agent_response(
                        workflow_id=workflow_id,
                        event_id=event_id,
                        task_idx=task_idx,
                        agent_id=agent_id,
                        agent_name=agent_name,
                        prompt=f"Processed {len(items)} items: {agent_prompt}",
                        response=current,
                        session_id=session_id,
                        user_id=user_id,
                        username=username,
                        next_call=task.get('call_next'),
                        logs=logs
                    )
                    print(f"Saved final combined response for iterated agent: {agent_name}")
                    
                    # For combination workflows, break after the last agent
                    if is_part_of_combination:
                        print("=== ITERATIVE BLOCK COMPLETED IN COMBINATION WORKFLOW - ENDING ===")
                        break
                else:
                    # Single item case - store the combined input
                    print(f"Not iterating {agent_name} - only {len(items)} item found, executing normally")
                    
                    agent_prompt = task.get('user_input', '').strip()
                    combined_input = f"{agent_prompt}\n\n{current}" if agent_prompt else current
                    all_user_queries[agent_name] = combined_input
                    
                    # Emit "Started" status
                    ch = f"workflow*{workflow_id}_{event_id}"
                    self.socketio.emit(ch, {
                        "workflow_id": workflow_id,
                        "event_id": event_id,
                        "agent_name": agent_name,
                        "agent_id": agent_id,
                        "user_id": user_id,
                        "username": username,
                        "status": "Started"
                    })
                    print(f"Emitted 'Started' for agent: {agent_name}")
                    
                    response, agent_session_id, task_logs, user_query = self._execute_single_agent_task(
                        task, combined_input, session_id=session_id, user_id=user_id
                    )
                    
                    current = response
                    all_agent_responses[agent_name] = response
                    
                    # Emit completion
                    self.socketio.emit(ch, {
                        "workflow_id": workflow_id,
                        "event_id": event_id,
                        "agent_name": agent_name,
                        "agent_id": agent_id,
                        "user_id": user_id,
                        "username": username,
                        "status": "completed",
                        "agent_response": response,
                        "prompt_output": response
                    })
                    
                    # Save the response
                    self._save_agent_response(
                        workflow_id=workflow_id,
                        event_id=event_id,
                        task_idx=task_idx,
                        agent_id=agent_id,
                        agent_name=agent_name,
                        prompt=combined_input,
                        response=response,
                        session_id=agent_session_id,
                        user_id=user_id,
                        username=username,
                        next_call=task.get('call_next'),
                        logs=task_logs
                    )
            else:
                # Normal single execution for non-iterating agents
                prompt = task.get('user_input', '').strip()
                message = f"{prompt}\n\n{current}" if prompt else current
                
                # Emit "Started" status
                ch = f"workflow*{workflow_id}_{event_id}"
                self.socketio.emit(ch, {
                    "workflow_id": workflow_id,
                    "event_id": event_id,
                    "agent_name": agent_name,
                    "agent_id": agent_id,
                    "user_id": user_id,
                    "username": username,
                    "status": "Started"
                })
                print(f"Emitted 'Started' for agent: {agent_name}")
                
                response, agent_session_id, task_logs, user_query = self._execute_single_agent_task(
                    task, message, session_id=session_id, user_id=user_id
                )
                
                current = response
                all_agent_responses[agent_name] = response
                all_user_queries[agent_name] = user_query  # Store the full input
                
                # Emit completion
                self.socketio.emit(ch, {
                    "workflow_id": workflow_id,
                    "event_id": event_id,
                    "agent_name": agent_name,
                    "agent_id": agent_id,
                    "user_id": user_id,
                    "username": username,
                    "status": "completed",
                    "agent_response": response,
                    "prompt_output": response
                })
                
                # Save the response
                self._save_agent_response(
                    workflow_id=workflow_id,
                    event_id=event_id,
                    task_idx=task_idx,
                    agent_id=agent_id,
                    agent_name=agent_name,
                    prompt=message,
                    response=response,
                    session_id=agent_session_id,
                    user_id=user_id,
                    username=username,
                    next_call=task.get('call_next'),
                    logs=task_logs
                )
                
                # Check if this task has no call_next
                if not task.get('call_next'):
                    print(f"Task {agent_name} has no call_next, ending workflow")
                    break
        
        # Emit final completion status if needed
        if not is_part_of_combination and not skip_final_emit:
            self.socketio.emit(f"workflow*{workflow_id}_{event_id}", {
                "workflow_id": workflow_id,
                "event_id": event_id,
                "agent_name": "CustomWorkflow",
                "agent_id": "",
                "user_id": user_id,
                "username": username,
                "status": "completed",
                "response": current,
                "agent_response": current,
                "prompt_output": current
            })
            print(f"Emitted final iterative workflow completion status")
        
        return {
            "agent_responses": all_agent_responses,
            "user_queries": all_user_queries,
            "summary": {
                "final_content": current,
                "final_key": None
            }
        }

    def _run_iterative_workflow_o(self, tasks, initial_input, event_id, workflow_id, session_id=None,
                            user_id=None, username=None, is_part_of_combination=False,
                            skip_final_emit=False, user_queries=None):
        """
        Handles Iterative workflows (Pure Iterative + Combination with Conditional).
        Ensures full combined output is passed forward for condition checks.
        """
        print("=== SIMPLE ITERATIVE WORKFLOW STARTED ===")
    
        current = initial_input
        all_agent_responses = {}
        all_user_queries = {} if user_queries is None else user_queries
    
        # Build name to task mapping
        name_to_task = {task.get("name"): task for task in tasks if task.get("name")}
    
        # Find iterative marker and agents after it
        iterating_agents = []
        iterative_marker_index = None
    
        for i, task in enumerate(tasks):
            if "iterative" in task.get("name", "").lower():
                iterative_marker_index = i
                # Collect all agents in the iterative branch
                for j in range(i + 1, len(tasks)):
                    if tasks[j].get('function') == 'call_lyzr_agent':
                        iterating_agents.append(tasks[j])
                    else:
                        break
                break
    
        print(f"Found {len(iterating_agents)} iterating agent(s): {[t.get('name') for t in iterating_agents]}")

        # ====================== 1. PRE-ITERATIVE AGENTS ======================
        for task_idx, task in enumerate(tasks):
            if task.get('function') != 'call_lyzr_agent':
                continue
            
            # Stop when we reach the iterative block
            if task in iterating_agents:
                break
            
            agent_name = task['params']['config'].get('agent_name', '').strip()
            agent_id = task['params']['config'].get('agent_id', '')
        
            prompt = task.get('user_input', '').strip()
            message = f"{prompt}\n\n{current}" if prompt else current
        
            ch = f"workflow*{workflow_id}_{event_id}"
            self.socketio.emit(ch, {
                "workflow_id": workflow_id,
                "event_id": event_id,
                "agent_name": agent_name,
                "agent_id": agent_id,
                "user_id": user_id,
                "username": username,
                "status": "Started"
            })
        
            response, agent_session_id, task_logs, user_query = self._execute_single_agent_task(
                task, message, session_id=session_id, user_id=user_id
            )
        
            current = response
            all_agent_responses[agent_name] = response
            all_user_queries[agent_name] = user_query
        
            # Emit completed
            self.socketio.emit(ch, {
                "workflow_id": workflow_id,
                "event_id": event_id,
                "agent_name": agent_name,
                "agent_id": agent_id,
                "user_id": user_id,
                "username": username,
                "status": "completed",
                "agent_response": response,
                "prompt_output": response
            })
        
            self._save_agent_response(
                workflow_id=workflow_id,
                event_id=event_id,
                task_idx=task_idx,
                agent_id=agent_id,
                agent_name=agent_name,
                prompt=message,
                response=response,
                session_id=agent_session_id,
                user_id=user_id,
                username=username,
                next_call=task.get('call_next'),
                logs=task_logs
            )

        # ====================== 2. ITERATIVE BLOCK ======================
        if iterating_agents and iterative_marker_index is not None:
            pre_iterative_output = current
            items = self._extract_iterable_items(pre_iterative_output)
            print(f"Starting iteration over {len(items)} items")

            iterative_marker = tasks[iterative_marker_index]

            # Emit "Started" for all iterative branches
            for branch_name in iterative_marker.get('call_next', []):
                branch_task = name_to_task.get(branch_name)
                if branch_task:
                    b_name = branch_task['params']['config'].get('agent_name', '').strip()
                    b_id = branch_task['params']['config'].get('agent_id', '')
                    self.socketio.emit(f"workflow*{workflow_id}_{event_id}", {
                        "workflow_id": workflow_id,
                        "event_id": event_id,
                        "agent_name": b_name,
                        "agent_id": b_id,
                        "user_id": user_id,
                        "username": username,
                        "status": "Started"
                    })

            # Process each branch
            for branch_name in iterative_marker.get('call_next', []):
                branch_task = name_to_task.get(branch_name)
                if not branch_task:
                    continue

                # Build chain for this branch
                chain = [branch_task]
                curr = branch_task
                while curr.get('call_next'):
                    next_name = curr['call_next'][0]
                    next_task = name_to_task.get(next_name)
                    if next_task and next_task.get('function') == 'call_lyzr_agent':
                        chain.append(next_task)
                        curr = next_task
                    else:
                        break

                iterative_task = chain[0]
                chained_agents = chain[1:]

                iterative_name = iterative_task['params']['config'].get('agent_name', '').strip()
                iterative_id = iterative_task['params']['config'].get('agent_id', '')
                iterative_prompt = iterative_task.get('user_input', '').strip()

                # Process all items
                iterative_results = []
                for item_idx, item in enumerate(items, 1):
                    message = f"{iterative_prompt}\n\n{item}" if iterative_prompt else str(item)
                
                    response, agent_session_id, task_logs, user_query = self._execute_single_agent_task(
                        iterative_task, message, session_id=session_id, user_id=user_id
                    )
                
                    iterative_results.append(str(response))
                
                    self._save_agent_response(
                        workflow_id=workflow_id,
                        event_id=event_id,
                        task_idx=tasks.index(iterative_task),
                        agent_id=iterative_id,
                        agent_name=iterative_name,
                        prompt=message,
                        response=response,
                        session_id=agent_session_id,
                        user_id=user_id,
                        username=username,
                        next_call=iterative_task.get('call_next'),
                        logs=task_logs
                    )

                combined_output = "\n\n---\n\n".join(iterative_results)

                # Emit completed for iterative agent
                self.socketio.emit(f"workflow*{workflow_id}_{event_id}", {
                    "workflow_id": workflow_id,
                    "event_id": event_id,
                    "agent_name": iterative_name,
                    "agent_id": iterative_id,
                    "user_id": user_id,
                    "username": username,
                    "status": "completed",
                    "agent_response": combined_output,
                    "prompt_output": combined_output
                })

                # Process chained agents (if any) with combined output
                current_chain_output = combined_output
                for chained_task in chained_agents:
                    chained_name = chained_task['params']['config'].get('agent_name', '').strip()
                    chained_id = chained_task['params']['config'].get('agent_id', '')
                    chained_prompt = chained_task.get('user_input', '').strip()

                    self.socketio.emit(f"workflow*{workflow_id}_{event_id}", {
                        "workflow_id": workflow_id,
                        "event_id": event_id,
                        "agent_name": chained_name,
                        "agent_id": chained_id,
                        "user_id": user_id,
                        "username": username,
                        "status": "Started"
                    })

                    message = f"{chained_prompt}\n\n{current_chain_output}" if chained_prompt else current_chain_output
                    
                    response, agent_session_id, task_logs, user_query = self._execute_single_agent_task(
                        chained_task, message, session_id=session_id, user_id=user_id
                    )

                    self._save_agent_response(
                        workflow_id=workflow_id,
                        event_id=event_id,
                        task_idx=tasks.index(chained_task),
                        agent_id=chained_id,
                        agent_name=chained_name,
                        prompt=message,
                        response=response,
                        session_id=agent_session_id,
                        user_id=user_id,
                        username=username,
                        next_call=chained_task.get('call_next'),
                        logs=task_logs
                    )

                    self.socketio.emit(f"workflow*{workflow_id}_{event_id}", {
                        "workflow_id": workflow_id,
                        "event_id": event_id,
                        "agent_name": chained_name,
                        "agent_id": chained_id,
                        "user_id": user_id,
                        "username": username,
                        "status": "completed",
                        "agent_response": response,
                        "prompt_output": response
                    })

                    current_chain_output = response

                # Final output of the iterative block
                current = current_chain_output

        # ====================== FINAL EMIT & RETURN ======================
        if not is_part_of_combination and not skip_final_emit:
            self.socketio.emit(f"workflow*{workflow_id}_{event_id}", {
                "workflow_id": workflow_id,
                "event_id": event_id,
                "agent_name": "CustomWorkflow",
                "agent_id": "",
                "user_id": user_id,
                "username": username,
                "status": "completed",
                "response": current,
                "agent_response": current
            })
            print(f"Emitted final iterative workflow completion status")

        return {
            "agent_responses": all_agent_responses,
            "user_queries": all_user_queries,
            "summary": {
                "final_content": current,
                "final_key": None
            }
        }


    def _run_iterative_workflow_latest_old(self, tasks, initial_input, event_id, workflow_id, session_id=None,
                            user_id=None, username=None, is_part_of_combination=False,
                            skip_final_emit=False, user_queries=None):
        """
        Handles Iterative workflows (Pure Iterative + Combination with Conditional).
        Ensures full combined output is passed forward for condition checks.
        """
        print("=== SIMPLE ITERATIVE WORKFLOW STARTED ===")
    
        current = initial_input
        all_agent_responses = {}
        all_user_queries = {} if user_queries is None else user_queries
    
        # Build name to task mapping
        name_to_task = {task.get("name"): task for task in tasks if task.get("name")}
    
        # Find iterative marker and agents after it
        iterating_agents = []
        iterative_marker_index = None
    
        for i, task in enumerate(tasks):
            if "iterative" in task.get("name", "").lower():
                iterative_marker_index = i
                # Collect all agents in the iterative branch
                for j in range(i + 1, len(tasks)):
                    if tasks[j].get('function') == 'call_lyzr_agent':
                        iterating_agents.append(tasks[j])
                    else:
                        break
                break
    
        print(f"Found {len(iterating_agents)} iterating agent(s): {[t.get('name') for t in iterating_agents]}")

        # ====================== 1. PRE-ITERATIVE AGENTS ======================
        for task_idx, task in enumerate(tasks):
            if task.get('function') != 'call_lyzr_agent':
                continue
            
            # Stop when we reach the iterative block
            if task in iterating_agents:
                break
            
            agent_name = task['params']['config'].get('agent_name', '').strip()
            agent_id = task['params']['config'].get('agent_id', '')
        
            prompt = task.get('user_input', '').strip()
            message = f"{prompt}\n\n{current}" if prompt else current
        
            ch = f"workflow*{workflow_id}_{event_id}"
            self.socketio.emit(ch, {
                "workflow_id": workflow_id,
                "event_id": event_id,
                "agent_name": agent_name,
                "agent_id": agent_id,
                "user_id": user_id,
                "username": username,
                "status": "Started"
            })
        
            response, agent_session_id, task_logs, user_query = self._execute_single_agent_task(
                task, message, session_id=session_id, user_id=user_id
            )
        
            current = response
            all_agent_responses[agent_name] = response
            all_user_queries[agent_name] = user_query
        
            # Emit completed
            self.socketio.emit(ch, {
                "workflow_id": workflow_id,
                "event_id": event_id,
                "agent_name": agent_name,
                "agent_id": agent_id,
                "user_id": user_id,
                "username": username,
                "status": "completed",
                "agent_response": response,
                "prompt_output": response
            })
        
            self._save_agent_response(
                workflow_id=workflow_id,
                event_id=event_id,
                task_idx=task_idx,
                agent_id=agent_id,
                agent_name=agent_name,
                prompt=message,
                response=response,
                session_id=agent_session_id,
                user_id=user_id,
                username=username,
                next_call=task.get('call_next'),
                logs=task_logs
            )

        # ====================== 2. ITERATIVE BLOCK ======================
        if iterating_agents and iterative_marker_index is not None:
            pre_iterative_output = current
            items = self._extract_iterable_items(pre_iterative_output)
            print(f"Starting iteration over {len(items)} items")

            iterative_marker = tasks[iterative_marker_index]

            # Emit "Started" for all iterative branches
            for branch_name in iterative_marker.get('call_next', []):
                branch_task = name_to_task.get(branch_name)
                if branch_task:
                    b_name = branch_task['params']['config'].get('agent_name', '').strip()
                    b_id = branch_task['params']['config'].get('agent_id', '')
                    self.socketio.emit(f"workflow*{workflow_id}_{event_id}", {
                        "workflow_id": workflow_id,
                        "event_id": event_id,
                        "agent_name": b_name,
                        "agent_id": b_id,
                        "user_id": user_id,
                        "username": username,
                        "status": "Started"
                    })

            # Process each branch
            for branch_name in iterative_marker.get('call_next', []):
                branch_task = name_to_task.get(branch_name)
                if not branch_task:
                    continue

                # Build chain for this branch
                chain = [branch_task]
                curr = branch_task
                while curr.get('call_next'):
                    next_name = curr['call_next'][0]
                    next_task = name_to_task.get(next_name)
                    if next_task and next_task.get('function') == 'call_lyzr_agent':
                        chain.append(next_task)
                        curr = next_task
                    else:
                        break

                iterative_task = chain[0]
                chained_agents = chain[1:]

                iterative_name = iterative_task['params']['config'].get('agent_name', '').strip()
                iterative_id = iterative_task['params']['config'].get('agent_id', '')
                iterative_prompt = iterative_task.get('user_input', '').strip()

                # PROCESS ALL ITEMS
                iterative_results = []
                for item_idx, item in enumerate(items, 1):
                    message = f"{iterative_prompt}\n\n{item}" if iterative_prompt else str(item)
                
                    response, agent_session_id, task_logs, user_query = self._execute_single_agent_task(
                        iterative_task, message, session_id=session_id, user_id=user_id
                    )
                
                    iterative_results.append(str(response))
                
                    # Save to DB but suppress per-item "completed" emit
                    self._save_agent_response(
                        workflow_id=workflow_id,
                        event_id=event_id,
                        task_idx=tasks.index(iterative_task),
                        agent_id=iterative_id,
                        agent_name=iterative_name,
                        prompt=message,
                        response=response,
                        session_id=agent_session_id,
                        user_id=user_id,
                        username=username,
                        next_call=iterative_task.get('call_next'),
                        logs=task_logs,
                        suppress_emit=True          
                    )

                combined_output = "\n\n---\n\n".join(iterative_results)

                # EMIT COMPLETED ONLY AFTER FULL ITERATION

                self.socketio.emit(f"workflow*{workflow_id}_{event_id}", {
                    "workflow_id": workflow_id,
                    "event_id": event_id,
                    "agent_name": iterative_name,
                    "agent_id": iterative_id,
                    "user_id": user_id,
                    "username": username,
                    "status": "completed",
                    "agent_response": combined_output,
                    "prompt_output": combined_output,
                    "is_final": True
                })

                # Process chained agents (if any) with combined output
                current_chain_output = combined_output
                for chained_task in chained_agents:
                    chained_name = chained_task['params']['config'].get('agent_name', '').strip()
                    chained_id = chained_task['params']['config'].get('agent_id', '')
                    chained_prompt = chained_task.get('user_input', '').strip()

                    self.socketio.emit(f"workflow*{workflow_id}_{event_id}", {
                        "workflow_id": workflow_id,
                        "event_id": event_id,
                        "agent_name": chained_name,
                        "agent_id": chained_id,
                        "user_id": user_id,
                        "username": username,
                        "status": "Started"
                    })

                    message = f"{chained_prompt}\n\n{current_chain_output}" if chained_prompt else current_chain_output
                    
                    response, agent_session_id, task_logs, user_query = self._execute_single_agent_task(
                        chained_task, message, session_id=session_id, user_id=user_id
                    )

                    self._save_agent_response(
                        workflow_id=workflow_id,
                        event_id=event_id,
                        task_idx=tasks.index(chained_task),
                        agent_id=chained_id,
                        agent_name=chained_name,
                        prompt=message,
                        response=response,
                        session_id=agent_session_id,
                        user_id=user_id,
                        username=username,
                        next_call=chained_task.get('call_next'),
                        logs=task_logs
                    )

                    self.socketio.emit(f"workflow*{workflow_id}_{event_id}", {
                        "workflow_id": workflow_id,
                        "event_id": event_id,
                        "agent_name": chained_name,
                        "agent_id": chained_id,
                        "user_id": user_id,
                        "username": username,
                        "status": "completed",
                        "agent_response": response,
                        "prompt_output": response
                    })

                    current_chain_output = response

                # Final output of the iterative block
                current = current_chain_output

        # ====================== FINAL EMIT & RETURN ======================
        if not is_part_of_combination and not skip_final_emit:
            self.socketio.emit(f"workflow*{workflow_id}_{event_id}", {
                "workflow_id": workflow_id,
                "event_id": event_id,
                "agent_name": "CustomWorkflow",
                "agent_id": "",
                "user_id": user_id,
                "username": username,
                "status": "completed",
                "response": current,
                "agent_response": current
            })
            print(f"Emitted final iterative workflow completion status")

        return {
            "agent_responses": all_agent_responses,
            "user_queries": all_user_queries,
            "summary": {
                "final_content": current,
                "final_key": None
            }
        }
 
    def _run_iterative_workflow_new(self, tasks, initial_input, event_id, workflow_id, session_id=None,
                            user_id=None, username=None, is_part_of_combination=False,
                            skip_final_emit=False, user_queries=None):
        """
        Handles Iterative workflows (Pure Iterative + Combination with Conditional).
        Now properly supports multiple branches after the iterative marker.
        """
        print("=== SIMPLE ITERATIVE WORKFLOW STARTED ===")
 
        current = initial_input
        all_agent_responses = {}
        all_user_queries = {} if user_queries is None else user_queries
 
        # Build name to task mapping
        name_to_task = {task.get("name"): task for task in tasks if task.get("name")}
 
        # ====================== 1. PRE-ITERATIVE AGENTS ======================
        iterative_marker_index = None
        iterating_agents = []
 
        for i, task in enumerate(tasks):
            if "iterative" in task.get("name", "").lower():
                iterative_marker_index = i
                # Collect iterative agents
                for j in range(i + 1, len(tasks)):
                    if tasks[j].get('function') == 'call_lyzr_agent':
                        iterating_agents.append(tasks[j])
                    else:
                        break
                break
 
        print(f"Found {len(iterating_agents)} iterating agent(s)")
 
        # Execute pre-iterative agents
        for task_idx, task in enumerate(tasks):
            if task.get('function') != 'call_lyzr_agent':
                continue
            if task in iterating_agents or (iterative_marker_index is not None and task_idx >= iterative_marker_index):
                break
 
            agent_name = task['params']['config'].get('agent_name', '').strip()
            agent_id = task['params']['config'].get('agent_id', '')
            prompt = task.get('user_input', '').strip()
            message = f"{prompt}\n\n{current}" if prompt else current
 
            ch = f"workflow*{workflow_id}_{event_id}"
            self.socketio.emit(ch, {
                "workflow_id": workflow_id, "event_id": event_id,
                "agent_name": agent_name, "agent_id": agent_id,
                "user_id": user_id, "username": username, "status": "Started"
            })
 
            response, agent_session_id, task_logs, user_query = self._execute_single_agent_task(
                task, message, session_id=session_id, user_id=user_id
            )
 
            current = response
            all_agent_responses[agent_name] = response
            all_user_queries[agent_name] = user_query
 
            self.socketio.emit(ch, {
                "workflow_id": workflow_id, "event_id": event_id,
                "agent_name": agent_name, "agent_id": agent_id,
                "user_id": user_id, "username": username,
                "status": "completed", "agent_response": response, "prompt_output": response
            })
 
            self._save_agent_response(
                workflow_id=workflow_id, event_id=event_id, task_idx=task_idx,
                agent_id=agent_id, agent_name=agent_name, prompt=message,
                response=response, session_id=agent_session_id,
                user_id=user_id, username=username,
                next_call=task.get('call_next'), logs=task_logs
            )
 
        # ====================== 2. ITERATIVE BLOCK ======================
        if iterating_agents and iterative_marker_index is not None:
            pre_iterative_output = current
            items = self._extract_iterable_items(pre_iterative_output)
            print(f"Starting iteration over {len(items)} items")
 
            iterative_marker = tasks[iterative_marker_index]
            branch_names = iterative_marker.get('call_next', [])
 
            # Emit Started for all branches
            for branch_name in branch_names:
                branch_task = name_to_task.get(branch_name)
                if branch_task:
                    b_name = branch_task['params']['config'].get('agent_name', '').strip()
                    b_id = branch_task['params']['config'].get('agent_id', '')
                    self.socketio.emit(f"workflow*{workflow_id}_{event_id}", {
                        "workflow_id": workflow_id, "event_id": event_id,
                        "agent_name": b_name, "agent_id": b_id,
                        "user_id": user_id, "username": username, "status": "Started"
                    })
 
            branch_final_outputs = {}
 
            for branch_name in branch_names:
                branch_task = name_to_task.get(branch_name)
                if not branch_task:
                    continue
 
                # Build full chain for this branch
                chain = [branch_task]
                curr = branch_task
                while curr.get('call_next'):
                    next_name = curr['call_next'][0] if isinstance(curr['call_next'], list) else curr['call_next']
                    next_task = name_to_task.get(next_name)
                    if next_task and next_task.get('function') == 'call_lyzr_agent':
                        chain.append(next_task)
                        curr = next_task
                    else:
                        break
 
                iterative_task = chain[0]
                chained_agents = chain[1:]
 
                iterative_name = iterative_task['params']['config'].get('agent_name', '').strip()
                iterative_id = iterative_task['params']['config'].get('agent_id', '')
                iterative_prompt = iterative_task.get('user_input', '').strip()
 
                # === Process all items for this branch ===
                iterative_results = []
                for item_idx, item in enumerate(items, 1):
                    message = f"{iterative_prompt}\n\n{item}" if iterative_prompt else str(item)
 
                    response, agent_session_id, task_logs, user_query = self._execute_single_agent_task(
                        iterative_task, message, session_id=session_id, user_id=user_id
                    )
 
                    iterative_results.append(str(response))
 
                    self._save_agent_response(
                        workflow_id=workflow_id, event_id=event_id,
                        task_idx=tasks.index(iterative_task),
                        agent_id=iterative_id, agent_name=iterative_name,
                        prompt=message, response=response,
                        session_id=agent_session_id, user_id=user_id,
                        username=username, next_call=iterative_task.get('call_next'),
                        logs=task_logs, suppress_emit=True
                    )
 
                combined_output = "\n\n---\n\n".join(iterative_results)
 
                # Emit completed for iterative agent (once per branch)
                self.socketio.emit(f"workflow*{workflow_id}_{event_id}", {
                    "workflow_id": workflow_id, "event_id": event_id,
                    "agent_name": iterative_name, "agent_id": iterative_id,
                    "user_id": user_id, "username": username,
                    "status": "completed", "agent_response": combined_output,
                    "prompt_output": combined_output, "is_final": True
                })
 
                # Process chained agents after iteration
                current_chain_output = combined_output
                for chained_task in chained_agents:
                    chained_name = chained_task['params']['config'].get('agent_name', '').strip()
                    chained_id = chained_task['params']['config'].get('agent_id', '')
                    chained_prompt = chained_task.get('user_input', '').strip()
 
                    self.socketio.emit(f"workflow*{workflow_id}_{event_id}", {
                        "workflow_id": workflow_id, "event_id": event_id,
                        "agent_name": chained_name, "agent_id": chained_id,
                        "user_id": user_id, "username": username, "status": "Started"
                    })
 
                    message = f"{chained_prompt}\n\n{current_chain_output}" if chained_prompt else current_chain_output
 
                    response, agent_session_id, task_logs, user_query = self._execute_single_agent_task(
                        chained_task, message, session_id=session_id, user_id=user_id
                    )
 
                    self._save_agent_response(
                        workflow_id=workflow_id, event_id=event_id,
                        task_idx=tasks.index(chained_task),
                        agent_id=chained_id, agent_name=chained_name,
                        prompt=message, response=response,
                        session_id=agent_session_id, user_id=user_id,
                        username=username, next_call=chained_task.get('call_next'),
                        logs=task_logs
                    )
 
                    self.socketio.emit(f"workflow*{workflow_id}_{event_id}", {
                        "workflow_id": workflow_id, "event_id": event_id,
                        "agent_name": chained_name, "agent_id": chained_id,
                        "user_id": user_id, "username": username,
                        "status": "completed", "agent_response": response,
                        "prompt_output": response
                    })
 
                    current_chain_output = response
 
                branch_final_outputs[branch_name] = current_chain_output
 
            # Merge outputs from all branches
            if branch_final_outputs:
                if len(branch_final_outputs) == 1:
                    current = list(branch_final_outputs.values())[0]
                else:
                    current = "\n\n=== BRANCH SEPARATOR ===\n\n".join(
                        f"Branch {name}:\n{output}"
                        for name, output in branch_final_outputs.items()
                    )
 
        # ====================== 3. REMAINING TASKS AFTER ITERATIVE BLOCK ======================
        # This is the KEY FIX
        if iterative_marker_index is not None:
            print("Executing remaining tasks after iterative block...")
            executed_names = set()
 
            # Mark already executed tasks
            for task in tasks[:iterative_marker_index]:
                if task.get("name"):
                    executed_names.add(task.get("name"))
            for branch_name in iterative_marker.get('call_next', []):
                curr_name = branch_name
                while curr_name:
                    executed_names.add(curr_name)
                    curr_task = name_to_task.get(curr_name)
                    if not curr_task or not curr_task.get('call_next'):
                        break
                    next_name = curr_task['call_next'][0] if isinstance(curr_task['call_next'], list) else curr_task['call_next']
                    curr_name = next_name
 
            # Execute remaining unexecuted agents
            for task in tasks[iterative_marker_index + 1:]:
                if task.get('function') != 'call_lyzr_agent':
                    continue
                name = task.get("name")
                if name in executed_names:
                    continue
 
                agent_name = task['params']['config'].get('agent_name', '').strip()
                agent_id = task['params']['config'].get('agent_id', '')
                prompt = task.get('user_input', '').strip()
 
                self.socketio.emit(f"workflow*{workflow_id}_{event_id}", {
                    "workflow_id": workflow_id, "event_id": event_id,
                    "agent_name": agent_name, "agent_id": agent_id,
                    "user_id": user_id, "username": username, "status": "Started"
                })
 
                message = f"{prompt}\n\n{current}" if prompt else current
 
                response, agent_session_id, task_logs, user_query = self._execute_single_agent_task(
                    task, message, session_id=session_id, user_id=user_id
                )
 
                current = response
                all_agent_responses[agent_name] = response
                all_user_queries[agent_name] = user_query
 
                self.socketio.emit(f"workflow*{workflow_id}_{event_id}", {
                    "workflow_id": workflow_id, "event_id": event_id,
                    "agent_name": agent_name, "agent_id": agent_id,
                    "user_id": user_id, "username": username,
                    "status": "completed", "agent_response": response,
                    "prompt_output": response
                })
 
                self._save_agent_response(
                    workflow_id=workflow_id, event_id=event_id,
                    task_idx=tasks.index(task), agent_id=agent_id,
                    agent_name=agent_name, prompt=message, response=response,
                    session_id=agent_session_id, user_id=user_id,
                    username=username, next_call=task.get('call_next'),
                    logs=task_logs
                )
 
                executed_names.add(name)
 
        # ====================== FINAL EMIT & RETURN ======================
        if not is_part_of_combination and not skip_final_emit:
            self.socketio.emit(f"workflow*{workflow_id}_{event_id}", {
                "workflow_id": workflow_id, "event_id": event_id,
                "agent_name": "CustomWorkflow", "agent_id": "",
                "user_id": user_id, "username": username,
                "status": "completed", "response": current, "agent_response": current
            })
            print(f"Emitted final iterative workflow completion status")
 
        return {
            "agent_responses": all_agent_responses,
            "user_queries": all_user_queries,
            "summary": {
                "final_content": current,
                "final_key": None
            }
        }
    
    def _run_iterative_workflow(self, tasks, initial_input, event_id, workflow_id, session_id=None, user_id=None, username=None, is_part_of_combination=False, skip_final_emit=False, user_queries=None):
        print("=== SIMPLE ITERATIVE WORKFLOW STARTED ===")
        
        current = initial_input
        all_agent_responses = {}
        all_user_queries = {} if user_queries is None else user_queries
        
        # Build a mapping of task names to tasks for quick lookup
        name_to_task = {task.get("name"): task for task in tasks if task.get("name")}
        
        # Identify all iterative agents
        iterating_agent_indices = set()
        for i, task in enumerate(tasks):
            if "iterative" in task.get("name", "").lower():
                # Find the next agent task after this iterative marker
                for j in range(i + 1, len(tasks)):
                    if tasks[j].get('function') == 'call_lyzr_agent':
                        iterating_agent_indices.add(j)
                        break
        
        # Process each task
        for task_idx, task in enumerate(tasks):
            if task.get('function') != 'call_lyzr_agent':
                continue
                
            agent_name = task['params']['config'].get('agent_name', '').strip()
            agent_id = task['params']['config'].get('agent_id', '')
            
            # Check if this task is an iterative agent
            is_iterating = task_idx in iterating_agent_indices
            
            if is_iterating:
                # Extract items from current context
                items = self._extract_iterable_items(current)
                print(f"ITERATING AGENT DETECTED: {agent_name} with {len(items)} items")
                
                # Store the combined input
                agent_prompt = task.get('user_input', '').strip()
                combined_input = f"{agent_prompt}\n\n{current}" if agent_prompt else current
                all_user_queries[agent_name] = combined_input
                
                # Emit "Started" status
                ch = f"workflow*{workflow_id}_{event_id}"
                self.socketio.emit(ch, {
                    "workflow_id": workflow_id,
                    "event_id": event_id,
                    "agent_name": agent_name,
                    "agent_id": agent_id,
                    "user_id": user_id,
                    "username": username,
                    "status": "Started"
                })
                print(f"Emitted 'Started' for iterating agent: {agent_name}")
                
                # Process each item
                iteration_results = []
                for item_idx, item in enumerate(items, 1):
                    print(f"--- Running {agent_name} for item {item_idx}/{len(items)} ---")
                    message = f"{agent_prompt}\n\n{item}"
                    
                    response, sess, logs, user_query = self._execute_single_agent_task(
                        task, message, session_id=session_id, user_id=user_id
                    )
                    iteration_results.append(str(response))
                
                # Combine results
                current = "\n\n---\n\n".join(iteration_results)
                all_agent_responses[agent_name] = current
                
                # Emit completion
                self.socketio.emit(ch, {
                    "workflow_id": workflow_id,
                    "event_id": event_id,
                    "agent_name": agent_name,
                    "agent_id": agent_id,
                    "user_id": user_id,
                    "username": username,
                    "status": "completed",
                    "agent_response": current,
                    "prompt_output": current
                })
                
                # Save response
                self._save_agent_response(
                    workflow_id=workflow_id,
                    event_id=event_id,
                    task_idx=task_idx,
                    agent_id=agent_id,
                    agent_name=agent_name,
                    prompt=f"Processed {len(items)} items: {agent_prompt}",
                    response=current,
                    session_id=session_id,
                    user_id=user_id,
                    username=username,
                    next_call=task.get('call_next'),
                    logs=logs
                )
                
                # Break if part of combination workflow
                if is_part_of_combination:
                    print("=== ITERATIVE BLOCK COMPLETED IN COMBINATION WORKFLOW - ENDING ===")
                    break
                    
            else:
                # Normal execution for non-iterating agents
                prompt = task.get('user_input', '').strip()
                message = f"{prompt}\n\n{current}" if prompt else current
                
                # Emit "Started" status
                ch = f"workflow*{workflow_id}_{event_id}"
                self.socketio.emit(ch, {
                    "workflow_id": workflow_id,
                    "event_id": event_id,
                    "agent_name": agent_name,
                    "agent_id": agent_id,
                    "user_id": user_id,
                    "username": username,
                    "status": "Started"
                })
                print(f"Emitted 'Started' for agent: {agent_name}")
                
                response, agent_session_id, task_logs, user_query = self._execute_single_agent_task(
                    task, message, session_id=session_id, user_id=user_id
                )
                
                current = response
                all_agent_responses[agent_name] = response
                all_user_queries[agent_name] = user_query
                
                # Emit completion
                self.socketio.emit(ch, {
                    "workflow_id": workflow_id,
                    "event_id": event_id,
                    "agent_name": agent_name,
                    "agent_id": agent_id,
                    "user_id": user_id,
                    "username": username,
                    "status": "completed",
                    "agent_response": response,
                    "prompt_output": response
                })
                
                # Save response
                self._save_agent_response(
                    workflow_id=workflow_id,
                    event_id=event_id,
                    task_idx=task_idx,
                    agent_id=agent_id,
                    agent_name=agent_name,
                    prompt=message,
                    response=response,
                    session_id=agent_session_id,
                    user_id=user_id,
                    username=username,
                    next_call=task.get('call_next'),
                    logs=task_logs
                )
                
                # Check if this task has no call_next
                if not task.get('call_next'):
                    print(f"Task {agent_name} has no call_next, ending workflow")
                    break
        
        # Emit final completion status if needed
        if not is_part_of_combination and not skip_final_emit:
            self.socketio.emit(f"workflow*{workflow_id}_{event_id}", {
                "workflow_id": workflow_id,
                "event_id": event_id,
                "agent_name": "CustomWorkflow",
                "agent_id": "",
                "user_id": user_id,
                "username": username,
                "status": "completed",
                "response": current,
                "agent_response": current,
                "prompt_output": current
            })
            print(f"Emitted final iterative workflow completion status")
        
        return {
            "agent_responses": all_agent_responses,
            "user_queries": all_user_queries,
            "summary": {
                "final_content": current,
                "final_key": None
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
        
    def _execute_single_agent_task(self, task, input_text, session_id=None, user_id=None):
    # Use the session_id from task params, don't generate new one
        agent_session_id = task.get('params', {}).get('session_id')
        
        # Only generate new one if not found (fallback)
        if not agent_session_id:
            agent_session_id = str(uuid.uuid4())
            print(f"WARNING: No session_id found in task params for {task.get('name')}, generating new one: {agent_session_id}")
        else:
            print(f"Using session_id from task params for {task.get('name')}: {agent_session_id}")
        
        params = task['params'].copy()
        if 'user_message' not in params:
            params['user_message'] = {}
        params['user_message']['value'] = str(input_text)  # This is the full input
        
        # Get workflow context from the task
        workflow_id = task.get('workflow_id')
        event_id = task.get('event_id')
        agent_name = task.get('agent_name') or task['params']['config'].get('agent_name')
        agent_id = task.get('agent_id') or task['params']['config'].get('agent_id')
        username = task.get('username')
        
        # Add workflow context to params for call_lyzr_agent
        params['workflow_id'] = workflow_id
        params['event_id'] = event_id
        params['agent_name'] = agent_name
        params['agent_id'] = agent_id
        params['username'] = username
        params['user_id'] = user_id
        
        # Call agent with WebSocket metrics capture
        result = self.call_lyzr_agent(params, session_id=agent_session_id, user_id=user_id)
        
        # Handle the new dictionary response format
        if isinstance(result, dict):
            response = result.get('response', '')
            collected_logs = result.get('logs', [])
            # Log the captured metrics
            if collected_logs:
                print(f"Captured {len(collected_logs)} log entries for task")
        else:
            # Fallback for backward compatibility
            response = result or ""
            collected_logs = []
        
        # Return response, session ID, logs, AND THE FULL INPUT
        return response, agent_session_id, collected_logs, input_text

    def _fetch_agent_trace_info(self, agent_name, agent_id, agent_session_id, api_key, query=None):

        try:
            # Get the latest trace for this agent
            trace_url = f"https://agent-prod.studio.lyzr.ai/v3/traces"
            trace_headers = {"x-api-key": api_key, "Content-Type": "application/json"}
            
            # Add a delay to ensure the trace has been recorded
            time.sleep(2)
            
            # Try multiple times with increasing delays to get the most recent trace
            max_retries = 3
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
                            trace_detail_url = f"https://agent-prod.studio.lyzr.ai/v3/traces/{trace_id}"
                            detail_response = requests.get(trace_detail_url, headers=trace_headers)
                            detail_response.raise_for_status()
                            
                            # Safe handling (Lyzr returns dict, not list)
                            trace_details = detail_response.json()
                            if isinstance(trace_details, list):
                                trace_details = trace_details[0] if trace_details else {}
                            
                            # Print trace details to terminal
                            print(f"\n=== TRACE DETAILS for {agent_name} ===")
                            print(f"Trace ID: {trace_id}")
                            print(f"Trace Details: {json.dumps(trace_details, indent=2)}")
                            print("=====================================\n")
                            
                            # Verify this trace belongs to our session
                            spans = trace_details.get("spans", [])
                            our_session = False
                            
                            for span in spans:
                                span_attrs = span.get("SpanAttributes", {})
                                if (span_attrs.get("session_id") == agent_session_id or 
                                    (span_attrs.get("input") and query in span_attrs.get("input", ""))):
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
                                
                                # Return trace information for this agent
                                return {
                                    "agent_id": agent_id,
                                    "trace_id": trace_id,
                                    "spans": trace_details.get("spans", []),
                                    "chat_messages": chat_messages
                                }
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
                    print(f"Error fetching trace information for {agent_name} (attempt {retry + 1}): {e}")
                    if retry < max_retries - 1:
                        time.sleep(retry_delay * (retry + 1))
                        continue
                    else:
                        # Last attempt failed, return None
                        return None
            
            print(f"Could not find trace for {agent_name}")
            return None
                
        except Exception as e:
            print(f"Error fetching trace information for {agent_name}: {e}")
            return None


