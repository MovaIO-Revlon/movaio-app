from datetime import date, datetime, timezone, timedelta
from email import parser
from email.message import EmailMessage
import secrets,re
from venv import logger
from flask import Flask, json, request, jsonify,send_file
from flask_cors import CORS
import httpx
from natsort import natsorted
from pydantic import ValidationError
from pymongo import MongoClient
from hashlib import pbkdf2_hmac
import logging
from config_loader import ConfigLoader, config_loader
from agent import run_test_workflow
from commonutils import DatabaseCollections, CommonUtils
from session_manager import get_current_user
from config_loader import config_loader
from database_manager import select_database_by_user_type
from database_manager import DatabaseManager
from database_manager import DatabaseType
from utils import NotFoundError

class AgencyManager(DatabaseCollections):
    def __init__(self):
        super().__init__()
        self.utils = CommonUtils()
        self.config = ConfigLoader()
        self.db = DatabaseManager()
        self._databases = {}
    
    def _query_db(self, collection_name, operation, user_type=None):
        """Helper method to query database with user type"""
        if user_type is None:
            current_user = get_current_user()
            prj_name = current_user.get('ActiveProject', 'master') if current_user else 'master'
            
            project_doc = self.project.find_one({'projectName': prj_name})
            if not project_doc:
                user_type = 'master'  # fallback
                
            else:
                user_type = project_doc['database_name']
                
                
        
        return config_loader.query_db(
            collection_name,
            operation,
            condition_func=select_database_by_user_type,
            user_type=user_type
        )

    def get_agency_statistics(self, user_type=None):
        total_agencies = self._query_db('agency', {'type': 'find', 'filter': {"is_deleted": False}}, user_type)
        mapping_op = {'type': 'find', 'filter': {"status":"active"}}
        mappings = self._query_db('agent_agency_mapping', mapping_op, user_type)
        result = {}
        agent_mapping = {}
        agent_count = 0
        for agency in total_agencies:
            if 'agency_id' in agency:
                agency_id = agency['agency_id']
                agency_name = agency.get('agency_name')
                mapping_op = {'type': 'find', 'filter': {"status":"active","agency_id": agency_id}}
                agents = self._query_db('agent_agency_mapping', mapping_op, user_type)
                
                # Filter out deleted agents
                active_agent_count = 0
                for agent_mapping_item in agents:
                    agent_id = agent_mapping_item.get('agent_id')
                    agent_op = {'type': 'find_one', 'filter': {"agent_id": agent_id, "$or": [
                        {"isDeleted": {"$ne": True}},
                        {"isDeleted": {"$exists": False}}
                    ]}}
                    agent_doc = self._query_db('agent', agent_op, user_type)
                    if agent_doc:
                        active_agent_count += 1
                
                agent_count = active_agent_count + agent_count
                agent_mapping[agency_name] = agent_mapping.get(agency_name, 0) + active_agent_count

            if 'assigned_to' in agency:
                if agency['assigned_to'] in result:
                    result[agency['assigned_to']] += 1
                else:
                    result[agency['assigned_to']] = 1
 
       
        return {
            "total_agencies": len(total_agencies),
            "agencies_by_team": result,
            "agent_mapping": agent_mapping,
            "total_agents_mapped": agent_count
        }

    def get_agency_with_agents_details(self, user_type=None):
        time_threshold = datetime.now(timezone.utc) - timedelta(days=1)

        # Get agencies using database manager
        agency_op = {'type': 'find', 'filter': {"is_deleted": False}}
        agencies = self._query_db('agency', agency_op, user_type)
        if not agencies:
            raise NotFoundError("No agencies found")

        # Get mappings using database manager
        mapping_op = {'type': 'find', 'filter': {"status":"active"}}
        mappings = self._query_db('agent_agency_mapping', mapping_op, user_type)
       

        results = []
        for agency in agencies:
            agency_id = agency.get("agency_id")

            trending_flag = self.compute_trending_flag(agency_id, time_threshold, user_type)
            agency_run_count = self.compute_run_count(agency_id, user_type)
            agents = self.get_agents_for_agency(agency_id, mappings, user_type)
           
            rating = self.get_agency_rating(agency, agency_id, user_type)
            self.update_agency_db_flags(agency_id, trending_flag, user_type)

            results.append(self.get_agency_result(
                agency, agents, rating, agency_run_count, trending_flag
            ))
            
        results.sort(key=lambda x: x["usage_count"], reverse=True)
        
        return results

    def compute_trending_flag(self, agency_id, time_threshold, user_type=None):
        event_op = {
            'type': 'find_one',
            'filter': {"agency_id": agency_id}
        }
        latest_event = self._query_db('event_agency_tracking', event_op, user_type)
        if not latest_event:
            return False

        created_ts = latest_event.get("created_ts")

        if isinstance(created_ts, str):
            try:
                created_ts = datetime.strptime(created_ts, "%a, %d %b %Y %H:%M:%S GMT")
                created_ts = created_ts.replace(tzinfo=timezone.utc)
            except Exception:
                created_ts = None

        if isinstance(created_ts, datetime) and created_ts.tzinfo is None:
            created_ts = created_ts.replace(tzinfo=timezone.utc)

        return isinstance(created_ts, datetime) and created_ts >= time_threshold

    def compute_run_count(self, agency_id, user_type=None):
        # Get events using database manager
        event_op = {'type': 'find', 'filter': {"agency_id": agency_id}}
        events = self._query_db('event_agency_tracking', event_op, user_type)
        unique_ids = {e.get("eventTracking_UniqueId") for e in events if e.get("eventTracking_UniqueId")}
        event_count = len(unique_ids)

        # Get active agent mappings
        mapping_op = {
            'type': 'find',
            'filter': {"agency_id": agency_id, "status": "active"},
            'projection': {"agent_id": 1, "_id": 0}
        }
        mappings = self._query_db('agent_agency_mapping', mapping_op, user_type)
        active_agent_ids = [mapping["agent_id"] for mapping in mappings]

        # Get chatbot count
        chatbot_op = {'type': 'count', 'filter': {"agent_id": {"$in": active_agent_ids}, "status": "completed"}}
        chatbot_count = self._query_db('chatbot_tracking', chatbot_op, user_type)

        total_count = event_count + chatbot_count
        return total_count

    def get_agents_for_agency(self, agency_id, mappings, user_type=None):
        agents = []
        agency_mappings = [m for m in mappings if m.get("agency_id") == agency_id and m.get("status") == "active"]

 
        for mapping in agency_mappings:
            agent_op = {'type': 'find_one', 'filter': {"agent_id": mapping.get("agent_id"),"$or": [
                {"isDeleted": {"$ne": True}},
                {"isDeleted": {"$exists": False}}
            ]}}
            agent_doc = self._query_db('agent', agent_op, user_type)
            if agent_doc:
                agents.append({
                    "agent_id": agent_doc.get("agent_id"),
                    "name": agent_doc.get("name"),
                    "description": agent_doc.get("description"),
                    "agent_prompt": agent_doc.get("agent_prompt"),
                    "ref_output": agent_doc.get("ref_output"),
                    "mcp_connector_id": agent_doc.get("mcp_connector_id"),
                    "knowledge_store_id": agent_doc.get("knowledge_store_id"),
                    "model": agent_doc.get("model"),
                    "foundation_resp_ai": agent_doc.get("foundation_resp_ai"),
                    "foundation_ethic_ai": agent_doc.get("foundation_ethic_ai"),
                    "foundation_guardrails_ai": agent_doc.get("foundation_guardrails_ai"),
                    "role_id": agent_doc.get("role_id"),
                    "role_name": agent_doc.get("role_name"),
                    "agent_type_id": agent_doc.get("agent_type_id"),
                    "agent_type_name": agent_doc.get("agent_type_name"),
                    "agent_provider": agent_doc.get("agent_provider"),
                    "order_number": mapping.get("order_number"),
                    "status": mapping.get("status"),
                    "recent_query": agent_doc.get("recent_query","")
                })
        return agents

    def get_agency_rating(self, agency, agency_id, user_type=None):
        existing_rating = agency.get("rating", "").strip() if agency.get("rating") else ""
        rating = None

        if existing_rating:
            try:
                rating = float(existing_rating)
                if rating < 3.0 or rating > 5.0 or round(rating * 10) % 1 != 0:
                    rating = None
            except (ValueError, TypeError):
                rating = None

        if rating is None:
            rating = self.utils.generate_random_rating()
            update_op = {
                'type': 'update_one',
                'filter': {"agency_id": agency_id},
                'update': {"$set": {"rating": str(rating), "updated_ts": self.utils.get_current_timestamp()}}
            }
            self._query_db('agency', update_op, user_type)
            # if not update_result.modified_count:
                # logging.warning(f"Rating update failed for agency {agency_id}")

        return rating

    def update_agency_db_flags(self, agency_id, trending_flag, user_type=None):
        update_op = {
            'type': 'update_one',
            'filter': {"agency_id": agency_id},
            'update': {"$set": {"trending_agency": trending_flag, "updated_ts": self.utils.get_current_timestamp()}}
        }
        self._query_db('agency', update_op, user_type)

    def get_agency_result(self, agency, agents, rating, run_count, trending_flag):
        return {
            "agency_id": agency.get("agency_id"),
            "agency_name": agency.get("agency_name"),
            "agency_desc": agency.get("agency_desc"),
            "agency_type": agency.get("agency_type"),
            "avatar": agency.get("avatar"),
            "provider_id": agency.get("provider_id"),
            "provider_name": agency.get("provider_name"),
            "last_run_ts": agency.get("last_run_ts"),
            "agent_type_counts": agency.get("agent_type_counts", {}),
            "created_ts": agency.get("created_ts"),
            "updated_ts": agency.get("updated_ts"),
            "created_by": agency.get("created_by"),
            "assigned_to": agency.get("assigned_to"),
            "agents": agents,
            "usage_count": run_count,
            "rating": rating,
            "agency_run_count": run_count,
            "trending_agency": trending_flag
        }

    def get_agency_types_details(self):
        agency_types = list(self.agency_type_collection.find({}, {'_id': 0}))
        return agency_types

    def onboard_and_update_agency_with_agents_details(self, request):
        try:
            payload = request.get_json()
            
            agency_name, agency_type, agency_desc, avatar, provider_id, provider_name, agents, team_name = self._extract_payload(payload)
            print('1',agency_name,'2',agents)
            if not agency_name or not agents:
                return jsonify({"Success": False, "Message": "agency_name and agents are required"}), 200
            
            projects_with_team = list(
                self.project.find(
                    {"teams.teamName": team_name},
                    {"projectName": 1, "_id": 0}
                )
            )
            print('3',projects_with_team)
            project_names = []
            if projects_with_team:
                project_names = [p["projectName"] for p in projects_with_team]
                # return jsonify({"status": "error", "message": f"No projects found with team {team_name}"}), 400

            agency_id, is_update = self._get_or_create_agency_id(agency_name)
            type_counts, agent_ids_in_payload = self._process_agents(agents, agency_id, agency_name,project_names,is_update)

            self._deactivate_absent_agents(agency_id, agent_ids_in_payload,project_names)
           
            agency_doc = self._build_agency_doc(
                agency_name, agency_type, agency_desc, avatar,
                provider_id, provider_name, team_name, type_counts
            )
            self._upsert_agency(agency_id, agency_doc, is_update,project_names)

           
            return is_update, agency_id, type_counts

        except Exception as ex:
            import traceback
            traceback.print_exc()
            logging.error("Error in onboard_and_update_agency_with_agents_details:", exc_info=True)
            return jsonify({"Success": False, "Message": str(ex)}), 500

    def _extract_payload(self, payload):
        return (
            payload.get("agency_name", "").strip(),
            payload.get("agency_type", "").strip(),
            payload.get("agency_desc", "").strip(),
            payload.get("avatar", "").strip(),
            payload.get("provider_id", "").strip(),
            payload.get("provider_name", "").strip(),
            payload.get("agents", []),
            payload.get("team", "").strip(),
        )

    def _get_or_create_agency_id(self, agency_name):
        existing_agency = self.agency_collection.find_one({"agency_name": agency_name})
        if existing_agency:
            return existing_agency["agency_id"], True
        return self.generate_agency_id(), False

    def _process_agents(self, agents, agency_id, agency_name, project_names, is_update):
        if is_update:
            type_counts = {"Task Agent": 0, "Insight Agent": 0, "Master Agent": 0}
        else:
            type_counts = {"Task Agent": 0, "Insight Agent": 0, "Master Agent": 0, "Workflow Agent": 0}
        
        agent_ids = []

        for agent in agents:
            agent_id = agent.get("agent_id", "").strip()
            agent_name = agent.get("agent_name", "").strip()
            order_number = agent.get("order_number")

            if not agent_id or not agent_name or order_number is None:
                continue

            # Get master agent data
            # agent_data = self.agent_collection.find_one({"name": agent_name}, {"_id": 0})
            # if not agent_data:
                # continue

            # for project in project_names:
                # result = self.project.find_one(
                    # {"projectName": project},
                    # {"database_name": 1, "_id": 0}
                # )
                # user_type = result.get("database_name") if result else "master"

                # # ✅ Check if agent already exists in project DB
                # existing = self._query_db(
                    # 'agent',
                    # {'type': 'find_one', 'filter': {'name': agent_name}, 'projection': {'_id': 1}},
                    # user_type
                # )

                # if existing is None:
                    # # Agent does not exist → insert
                    # insert_op = {'type': 'insert_one', 'document': agent_data}
                    # self._query_db('agent', insert_op, user_type)


            agent_ids.append(agent_id)
            self._activate_agent(agent_name, project_names)
            self._update_type_counts(agent_id, type_counts)
            self._upsert_mapping(agency_id, agency_name, agent_id, agent_name, order_number, project_names)
            type_counts["Workflow Agent"] = self.workflow_agency_mapping_collection.count_documents({
                "agency_id": agency_id,
                "status": "active"
            })

        return type_counts, agent_ids


    def _activate_agent(self, agent_name, project_names):
    # ✅ Activate in master DB
        self.agent_collection.update_one(
            {"name": agent_name,"$or": [
            {"isDeleted": {"$ne": True}},
            {"isDeleted": {"$exists": False}}
        ]},
            {"$set": {"status": "active", "updated_ts": datetime.now(timezone.utc)}}
        )

        # ✅ Prepare update operation for project DBs
        update_op = {
            'type': 'update_one',
            'filter': {"name": agent_name,"$or": [
            {"isDeleted": {"$ne": True}},
            {"isDeleted": {"$exists": False}}
        ]},
            'update': {"$set": {"status": "active", "updated_ts": datetime.now(timezone.utc)}}
        }
        if project_names:
            for project in project_names:
                result = self.project.find_one(
                    {"projectName": project},
                    {"database_name": 1, "_id": 0}
                )
                user_type = result.get("database_name") if result else "master"

                # ✅ Check if agent exists in the project DB before activating
                existing_agent = self._query_db(
                    'agent',
                    {'type': 'find_one', 'filter': {"name": agent_name,"$or": [{"isDeleted": {"$ne": True}},{"isDeleted": {"$exists": False}}]}, 'projection': {"_id": 1}},
                    user_type
                )
                agent_data = self.agent_collection.find_one({"name": agent_name,"$or": [{"isDeleted": {"$ne": True}},{"isDeleted": {"$exists": False}}]}, {"_id": 0})

                if existing_agent:
                    # Update status to active
                    self._query_db('agent', update_op, user_type)
                else:
                    # Optional: Insert from master if agent missing in project DB
                    
                    if agent_data:
                        insert_op = {'type': 'insert_one', 'document': agent_data}
                        self._query_db('agent', insert_op, user_type)
                        
                if agent_data and agent_data.get("knowledge_store"):
                    knowledge_stores = agent_data["knowledge_store"]
                    
                    # Ensure it's always a list (handles both single item and array)
                    if not isinstance(knowledge_stores, list):
                        knowledge_stores = [knowledge_stores]

                    for ks in knowledge_stores:
                        # Handle both cases: object with _id or just the ID string
                        if isinstance(ks, dict):
                            knowledge_id = ks.get("id")
                        else:
                            knowledge_id = ks

                        if not knowledge_id:
                            continue  # skip invalid entries

                        # Fetch from master KB (knowledge_graph_db)
                        kb_record = self.kb_collection.find_one({"rag_id": knowledge_id})
                        if not kb_record:
                            # Optional: log warning
                            continue

                        # Check if it already exists in project DB
                        existing_kb = self._query_db(
                            "kb_collection",
                            {"type": "find_one", "filter": {"rag_id": knowledge_id}},
                            user_type,
                        )

                        if not existing_kb:
                            # Clean and insert
                            kb_record_clean = {
                                k: v for k, v in kb_record.items() if k != "_id"
                            }
                            kb_record_clean["_id"] = knowledge_id

                            self._query_db(
                                "kb_collection",
                                {"type": "insert_one", "document": kb_record_clean},
                                user_type,
                            )

    def _update_type_counts(self, agent_id, type_counts):
        agent_doc = self.agent_collection.find_one({"agent_id": agent_id})
        if not agent_doc:
            return
        agent_type = agent_doc.get("agent_type_name", "").strip().lower()
        normalized_map = {k.lower(): k for k in type_counts}
        if agent_type in normalized_map:
            type_counts[normalized_map[agent_type]] += 1

    def _upsert_mapping(self, agency_id, agency_name, agent_id, agent_name, order_number, project_names):
        mapping_data = {
            "agency_id": agency_id,
            "agency_name": agency_name,
            "agent_id": agent_id,
            "agent_name": agent_name,
            "order_number": order_number,
            "updated_ts": datetime.now(timezone.utc),
            "status": "active",
        }

        existing_mapping = self.agent_agency_mapping_collection.find_one(
            {"agency_id": agency_id,"agent_id": agent_id}
        )
        if existing_mapping:
            self.agent_agency_mapping_collection.update_one(
                {"_id": existing_mapping["_id"]}, {"$set": mapping_data}
            )
            
        else:
            mapping_data.update({
                    "mapping_id": self.generate_mapping_id(),
                    "created_ts": datetime.now(timezone.utc)
                })
            self.agent_agency_mapping_collection.insert_one(mapping_data) 
            
        for project in project_names:
            result = self.project.find_one(
                {"projectName": project},
                {"database_name": 1, "_id": 0}
            )
            user_type = result.get("database_name") if result else "master"
            
            find_op = {'type': 'find_one', 'filter': {"agency_id": agency_id, "agent_name": agent_name}}
            print("data",agency_id)
            print("data",agent_name)
            exist_mapping = self._query_db('agent_agency_mapping', find_op,user_type)
            


            if exist_mapping:
                update_op = {
                    'type': 'update_one',
                    'filter': {"agency_id": agency_id, "agent_name": agent_name},
                    'update': {"$set": mapping_data}
                }
                self._query_db('agent_agency_mapping', update_op, user_type)
            
            else:
                agency_agent_onboard_op = {
                    'type': 'insert_one',
                    'document': mapping_data
                }
                self._query_db('agent_agency_mapping', agency_agent_onboard_op, user_type)
                
                       
                
 

    def _deactivate_absent_agents(self, agency_id, active_agent_ids, project_names):
        # Step 1: Find agent_ids that are absent in the current payload for this agency
        agents_to_deactivate = self.agent_agency_mapping_collection.find(
            {
                "agency_id": agency_id,
                "agent_id": {"$nin": active_agent_ids},
                "status": "active",
            },
            {"agent_id": 1, "_id": 0}
        )
        candidate_agent_ids = [doc["agent_id"] for doc in agents_to_deactivate]
        if not candidate_agent_ids:
            return

        now = datetime.now(timezone.utc)
        
        # Handle master agent clearing (original logic - unchanged)
        master = self.agent_agency_mapping_collection.find_one(
            {"agency_id": agency_id, "order_number": 1},
            {"_id": 0}
        )
        master_agent = master.get("agent_id", "") if master else ""
        if master_agent:
            update_op = {
                "type": "update_many",
                'filter': {
                    "master_agent_id": master_agent,
                    "agent_id": {"$in": candidate_agent_ids}
                },
                'update': {"$set": {"master_agent_id": ""}}
            }
            self._query_db('chatbot_tracking', update_op)

        current_active_mappings = self.agent_agency_mapping_collection.find(
            {
                "agent_id": {"$in": candidate_agent_ids},
                "status": "active",
            },
            {"agent_id": 1, "agency_id": 1, "_id": 0}
        )

        from collections import defaultdict
        agent_to_agencies = defaultdict(set)
        for doc in current_active_mappings:
            agent_to_agencies[doc["agent_id"]].add(doc["agency_id"])

        # Simulate removal of THIS agency's mapping
        truly_inactive_agent_ids = []
        for agent_id in candidate_agent_ids:
            remaining = agent_to_agencies[agent_id] - {agency_id}
            if not remaining:
                truly_inactive_agent_ids.append(agent_id)

        deactivated_agents_master = []
        if truly_inactive_agent_ids:
            # Step 2: Deactivate in master agent collection
            self.agent_collection.update_many(
                {"agent_id": {"$in": truly_inactive_agent_ids}, "status": "active"},
                {"$set": {"status": "inactive", "trending": False, "updated_ts": now}},
            )
            
            deactivated_agents_master = list(self.agent_collection.find(
                {"agent_id": {"$in": truly_inactive_agent_ids}},
                {"_id": 0}
            ))

            # Step 3: Deactivate in project DB agent collections + KB handling
            update_agents_op = {
                'type': 'update_many',
                'filter': {"agent_id": {"$in": truly_inactive_agent_ids}, "status": "active"},
                'update': {"$set": {"status": "inactive", "trending": False, "updated_ts": now}}
            }

            if project_names:
                for project in project_names:
                    result = self.project.find_one(
                        {"projectName": project},
                        {"database_name": 1, "_id": 0}
                    )
                    user_type = result.get("database_name") if result else "master"
                    
                    self._query_db('agent', update_agents_op, user_type)
                    
                    # KB sync (original logic preserved)
                    for agent in deactivated_agents_master:
                        knowledge_id = agent.get("knowledge_store_id", "")
                        if knowledge_id:
                            kb_record = self.kb_collection.find_one({"_id": knowledge_id})
                            if kb_record:
                                existing_kb = self._query_db(
                                    'kb_collection',
                                    {'type': 'find_one', 'filter': {"_id": knowledge_id}},
                                    user_type
                                )
                                if not existing_kb:
                                    kb_record_clean = {k: v for k, v in kb_record.items() if k != "_id"}
                                    kb_record_clean["_id"] = knowledge_id
                                    self._query_db(
                                        'kb_collection',
                                        {'type': 'insert_one', 'document': kb_record_clean},
                                        user_type
                                    )

        # Step 4: ALWAYS deactivate the mapping in master DB for this agency
        # (even if the agent is still active elsewhere)
        self.agent_agency_mapping_collection.update_many(
            {
                "agency_id": agency_id,
                "agent_id": {"$in": candidate_agent_ids},
                "status": "active",
            },
            {"$set": {"status": "inactive", "updated_ts": now}},
        )

        # Step 5: Deactivate mappings in project DBs (for this agency)
        update_mapping_op = {
            'type': 'update_many',
            'filter': {
                "agency_id": agency_id,
                "agent_id": {"$in": candidate_agent_ids},
                "status": "active",
            },
            'update': {"$set": {"status": "inactive", "updated_ts": now}}
        }

        if project_names:
            for project in project_names:
                result = self.project.find_one(
                    {"projectName": project},
                    {"database_name": 1, "_id": 0}
                )
                user_type = result.get("database_name") if result else "master"
                self._query_db('agent_agency_mapping', update_mapping_op, user_type)
 
        



    def _build_agency_doc(self, agency_name, agency_type, agency_desc, avatar,
                          provider_id, provider_name, team_name, type_counts):
        return {
            "agency_name": agency_name,
            "agency_type": agency_type,
            "agency_desc": agency_desc,
            "avatar": avatar,
            "provider_id": provider_id,
            "provider_name": provider_name,
            "last_run_ts": None,
            "agent_type_counts": type_counts,
            "assigned_to": team_name,
            "is_deleted": False,
            "updated_ts":datetime.now(timezone.utc),
        }

    def _upsert_agency(self, agency_id, agency_doc, is_update, project_names):
        if is_update:
            self.agency_collection.update_one({"agency_id": agency_id}, {"$set": agency_doc})
            update_op = {
                'type': 'update_one',
                'filter': {"agency_id": agency_id},
                'update': {"$set": agency_doc}
            }
            if project_names:
                for project in project_names:
                    result = self.project.find_one(
                        {"projectName": project},
                        {"database_name": 1, "_id": 0}
                    )
                    user_type = result.get("database_name") if result else "master"
                    self._query_db('agency', update_op, user_type)

            

        else:
            agency_doc.update({
                "agency_id": agency_id,
                "created_ts": datetime.now(timezone.utc),
            })
            self.agency_collection.insert_one(agency_doc)

            if project_names:
                for project in project_names:
                    result = self.project.find_one(
                        {"projectName": project},
                        {"database_name": 1, "_id": 0}
                    )
                    user_type = result.get("database_name") if result else "master"

                    existing_agency = self._query_db(
                        'agency',
                        {'type': 'find_one', 'filter': {'agency_id': agency_id}, 'projection': {'_id': 1}},
                        user_type
                    )
                    if existing_agency is None:
                        agency_onboard_op = {
                            'type': 'insert_one',
                            'document': agency_doc
                        }
                        self._query_db('agency', agency_onboard_op, user_type)
        



    def generate_agency_id(self):
        latest_agency = self.agency_collection.find_one(
            {"agency_id": {"$regex": "^AGENCY\\d+$"}},
            sort=[("created_ts", -1)]
        )
        if latest_agency and 'agency_id' in latest_agency:
            last_number = int(latest_agency['agency_id'].replace('AGENCY', ''))
            new_number = last_number + 1
        else:
            new_number = 1

        return f"AGENCY{str(new_number).zfill(3)}"

    def generate_mapping_id(self):
        count = self.agent_agency_mapping_collection.count_documents({})
        return f"MAP{str(count + 1).zfill(3)}"

    def get_trending_agency_stats_dtls(self):
        total_count = self.agency_collection.count_documents({})
        trending_count = self.agency_collection.count_documents({"status": "trending"})
        
        trending_agencies_cursor = self.agency_collection.find(
            {"status": "trending"},
            {
                "_id": 0,
                "agency_id": 1,
                "agency_name": 1,
                "agency_desc": 1,
                "avatar": 1,
                "status": 1,
                "rating": 1,
                "agent_type_counts": 1,
                "created_ts": 1,
                "updated_ts": 1,
                "created_by": 1
            }
        )
        
        trending_agencies = list(trending_agencies_cursor)

        event_agency_data = list(self.event_agency_tracking_collection.find({}))
        agency_usage_map = {}
        for event in event_agency_data:
            agency_id = event.get("agency_id")
            usagecount = int(event.get("usagecount", "0"))
            if agency_id:
                agency_usage_map[agency_id] = agency_usage_map.get(agency_id, 0) + usagecount

        for agency in trending_agencies:
            agency_id = agency.get("agency_id")
            agency["usage_count"] = agency_usage_map.get(agency_id, 0)
        
        return total_count,trending_count,trending_agencies

    def delete_agency_details(self, agency_id):
        try:
            # Step 1: Find the agency
            agency = self.agency_collection.find_one({"agency_id": agency_id})
            if not agency:
                return {"success": False, "message": "Agency not found"}
 
            if agency.get("is_deleted"):
                return {"success": False, "message": "Agency already deleted"}
            
            agency_name = agency.get("agency_name")  
            if not agency_name:
                pass  

            active_workflow_using_agency = self.workflow_collection.find_one(
                {
                    "agency_name": agency_name,    
                    "active": True
                }
            )

            if active_workflow_using_agency:
                return {
                    "success": False,
                    "message": (
                        f"Cannot delete agency '{agency_name}' (ID: {agency_id}). "
                        "It is still referenced by one or more active workflows."
                    )
                }
 
            team_name = agency.get("assigned_to")
            projects_with_team = list(
                self.project.find(
                    {"teams.teamName": team_name},
                    {"projectName": 1, "_id": 0}
                )
            )
            if projects_with_team:
                project_names = [p["projectName"] for p in projects_with_team]
 
            
            now = datetime.now(timezone.utc)
 
            # Step 2: Soft-delete agency in master DB
            self.agency_collection.update_one(
                {"agency_id": agency_id, "is_deleted": False},
                {"$set": {
                    "status": "inactive",
                    "is_deleted": True,
                    "updated_ts": now
                }}
            )
 
            # Step 3: Soft-delete agency in project DBs
            agency_update_op = {
                'type': 'update_many',
                'filter': {"agency_id": agency_id},
                'update': {"$set": {
                    "status": "inactive",
                    "is_deleted": True,
                    "updated_ts": now
                }}
            }
            project_names={}
            if project_names:
                for project in project_names:
                    result = self.project.find_one(
                        {"projectName": project},
                        {"database_name": 1, "_id": 0}
                    )
                    user_type = result.get("database_name") if result else "master"
                    self._query_db('agency', agency_update_op, user_type)
 
            # Step 4: Deactivate agent-agency mappings
            candidate_agent_ids = self.agent_agency_mapping_collection.distinct(
                "agent_id",
                {"agency_id": agency_id, "status": "active"}
            )
 
            self.agent_agency_mapping_collection.update_many(
                {"agency_id": agency_id, "status": "active"},
                {"$set": {"status": "inactive", "updated_ts": now}}
            )
 
            mapping_update_op = {
                'type': 'update_many',
                'filter': {"agency_id": agency_id, "status": "active"},
                'update': {"$set": {"status": "inactive", "updated_ts": now}}
            }
 
            if project_names:
                for project in project_names:
                    result = self.project.find_one(
                        {"projectName": project},
                        {"database_name": 1, "_id": 0}
                    )
                    user_type = result.get("database_name") if result else "master"
                    self._query_db('agent_agency_mapping', mapping_update_op, user_type)
 
            current_active_mappings = self.agent_agency_mapping_collection.find(
                {
                    "agent_id": {"$in": candidate_agent_ids},
                    "status": "active",
                },
                {"agent_id": 1, "agency_id": 1, "_id": 0}
            )
 
            from collections import defaultdict
            agent_to_agencies = defaultdict(set)
            for doc in current_active_mappings:
                agent_to_agencies[doc["agent_id"]].add(doc["agency_id"])
 
            # Simulate removal of THIS agency's mapping
            truly_inactive_agent_ids = []
            for agent_id in candidate_agent_ids:
                remaining = agent_to_agencies[agent_id] - {agency_id}
                if not remaining:
                    truly_inactive_agent_ids.append(agent_id)
 
            # Step 5: Deactivate related agents (in both master & project DBs) only if truly inactive
            if truly_inactive_agent_ids:
                self.agent_collection.update_many(
                    {"agent_id": {"$in": truly_inactive_agent_ids}},
                    {"$set": {
                        "status": "inactive",
                        "trending": False,
                        "updated_ts": now
                    }}
                )
 
                agent_update_op = {
                    'type': 'update_many',
                    'filter': {"agent_id": {"$in": truly_inactive_agent_ids}},
                    'update': {"$set": {
                        "status": "inactive",
                        "trending": False,
                        "updated_ts": now
                    }}
                }
 
                if project_names:
                    for project in project_names:
                        result = self.project.find_one(
                            {"projectName": project},
                            {"database_name": 1, "_id": 0}
                        )
                        user_type = result.get("database_name") if result else "master"
                        self._query_db('agent', agent_update_op, user_type)
 
            return {"success": True, "message": f"Agency {agency_name} and its agents set to inactive"}
 
        except Exception as ex:
            logging.error("Error in delete_agency_details:", exc_info=True)
            return {"success": False, "message": str(ex)}
    
    

    def get_agent_and_order2_agents_details(self, request):
        data = request.get_json()
        agent_id = data.get("agent_id")

        if not agent_id:
            raise ValidationError("agent_id is required")

        main_agent = self.agent_collection.find_one({"agent_id": agent_id})

        if not main_agent:
            raise NotFoundError("Agent not found")

        main_agent_info = {
            "agent_id": main_agent.get("agent_id"),
            "agent_name": main_agent.get("name"),
            "role_id": main_agent.get("role_id"),
            "role_name": main_agent.get("role_name"),
            "description": main_agent.get("description"),
            "model": main_agent.get("model"),
            "agent_prompt": main_agent.get("agent_prompt"),
            "ref_output": main_agent.get("ref_output"),
            "mcp_connector_id": main_agent.get("mcp_connector_id"),
            "knowledge_store_id": main_agent.get("knowledge_store_id"),
            "agent_typename": main_agent.get("agent_type_name"),
            "agent_typeid": main_agent.get("agent_type_id"),
            "agent_provider": main_agent.get("agent_provider"),
            "foundation_resp_ai": main_agent.get("foundation_resp_ai"),
            "foundation_ethic_ai": main_agent.get("foundation_ethic_ai"),
            "foundation_guardrails_ai": main_agent.get("foundation_guardrails_ai")
        }

        mapping = self.agent_agency_mapping_collection.find_one({
            "agent_id": agent_id,
            "status": "active"
        })

        if not mapping:
            raise NotFoundError("No mapped agency found for this agent")

        agency_id = mapping.get("agency_id")
            
        order_2_mappings_og = list(
            self.agent_agency_mapping_collection.find({
                "agency_id": agency_id,
                "order_number": 2,
                "status": "active"
            })
        )

        # Regex: Matches "MAP###" followed by 3 or more digits.
        pattern = re.compile(r"^MAP(\d{3,})$")

        filtered_data = [
            item for item in order_2_mappings_og 
            if pattern.match(item.get("mapping_id", ""))
        ]

        #Sort numerically based on the captured digits
        def get_numeric_value(item):
            match = pattern.match(item.get("mapping_id", ""))
            if match:
                # Convert the captured string of digits into an integer for true numerical sorting
                return int(match.group(1))
            return 0 # Fallback (shouldn't be reached due to filtering)

        #Apply the sorting
        order_2_mappings = sorted(filtered_data, key=get_numeric_value)
        
        order_2_agents = []

        for mapping in order_2_mappings:
            order_agent_id = mapping.get("agent_id")
            agent_data = self.agent_collection.find_one({"agent_id": order_agent_id,"$or": [
            {"isDeleted": {"$ne": True}},
            {"isDeleted": {"$exists": False}}
        ]})

            if agent_data:
                order_2_agents.append({
                    "agent_id": agent_data.get("agent_id"),
                    "agent_name": agent_data.get("name"),
                    "role_id": agent_data.get("role_id"),
                    "role_name": agent_data.get("role_name"),
                    "description": agent_data.get("description"),
                    "model": agent_data.get("model"),
                    "agent_prompt": agent_data.get("agent_prompt"),
                    "ref_output": agent_data.get("ref_output"),
                    "mcp_connector_id": agent_data.get("mcp_connector_id"),
                    "knowledge_store_id": agent_data.get("knowledge_store_id"),
                    "agent_typename": agent_data.get("agent_type_name"),
                    "agent_typeid": agent_data.get("agent_type_id"),
                    "agent_provider": agent_data.get("agent_provider"),
                    "foundation_resp_ai": agent_data.get("foundation_resp_ai"),
                    "foundation_ethic_ai": agent_data.get("foundation_ethic_ai"),
                    "foundation_guardrails_ai": agent_data.get("foundation_guardrails_ai")
                })

        return main_agent_info,order_2_agents
            
    # def get_task_agents_with_agencies_details(self):
        # try:
            # # Step 1: Fetch only "Task Agent" type agents
            # # task_agents = list(self.agent_collection.find({
                # # "agent_type_name": "Task Agent",
                # # "status": "active"
            # # }))
            # operation = {
                # 'type': 'find',
                # 'filter': {"agent_type_name": "Task Agent",
                # "status": "active"
                    
                # }
            # }
            # task_agents = self._query_db('agent', operation)

            # if not task_agents:
                # return []

            # final_agents = []

            # for agent in task_agents:
                # agent_id = agent.get("agent_id")
                # run_status = agent.get("run_status", "").lower().strip()
                # last_completed_ts = None

                # # Reset defaults at the start of every loop
                # confidence = 0
                # confidence_status = "yet to start"
                # review_status = "Take Action"

                # if run_status == "completed":
                    # confidence = 80 + secrets.choice([2, 4, 8, 10, 14, 16, 18])
                    # confidence_status = "In Progress"
                    # review_status = ""

                # agent_info = {
                    # "agent_id": agent_id,
                    # "agent_name": agent.get("name"),
                    # "role_id": agent.get("role_id"),
                    # "role_name": agent.get("role_name"),
                    # "description": agent.get("description"),
                    # "model": agent.get("model"),
                    # "agent_type_name": agent.get("agent_type_name"),
                    # "agent_provider": agent.get("agent_provider"),
                    # "created_ts": agent.get("created_ts"),
                    # "updated_ts": agent.get("updated_ts"),
                    # "last_completed_ts": last_completed_ts,
                    # "confidence_perc": confidence,
                    # "confidence_status": confidence_status,
                    # "review_status": review_status,
                    # "rating": agent.get("rating", 0),
                    # "feedback": agent.get("feedback", ""),
                    # "run_status": agent.get("run_status", ""),
                # }

                # # Step 2: Find all mapped agency IDs for this agent
                # mappings = list(self.agent_agency_mapping_collection.find({
                    # "agent_id": agent_id,
                    # "status": "active"  # only active mappings
                # }))

                # agencies = []
                # for mapping in mappings:
                    # agency_id = mapping.get("agency_id")
                    # agency = self.agency_collection.find_one({"agency_id": agency_id})
                    # if agency:
                        # agency_info = {
                            # "agency_id": agency.get("agency_id"),
                            # "agency_name": agency.get("agency_name"),
                            # "agency_desc": agency.get("agency_desc"),
                            # "provider_id": agency.get("provider_id"),
                            # "provider_name": agency.get("provider_name"),
                            # "last_run_ts": agency.get("last_run_ts"),
                            # "created_ts": agency.get("created_ts"),
                            # "updated_ts": agency.get("updated_ts"),
                            # "agency_task": agency.get("agency_task"),
                            # "agency_team": agency.get("agency_team"),
                            # "assigned_to": agency.get("assigned_to")
                        # }
                        # agencies.append(agency_info)

                # agent_info["agencies"] = agencies

                # # Add this agent + agencies to the result
                # final_agents.append(agent_info)

            # # Sort agents by last_completed_ts (nulls go last)
            # sorted_agents = sorted(
                # final_agents,
                # key=lambda x: datetime.fromisoformat(str(x['last_completed_ts']))
                # if x['last_completed_ts'] else datetime.min,
                # reverse=True
            # )

            # return sorted_agents

        # except Exception as ex:
            # logging.error("Error in GetTaskAgentsWithAgenciesDetails:", exc_info=True)
            # return jsonify({"Success": False, "Message": str(ex)}), 500
            
    def get_task_agents_with_agencies_details(self):
        # Step 1: Fetch only "Task Agent" type agents
        # task_agents = list(self.agent_collection.find({
            # "agent_type_name": "Task Agent",
            # "status": "active"
        # }))
        operation = {
            'type': 'find',
            'filter': {"agent_type_name": "Task Agent",
            "status": "active"
                
            }
        }
        task_agents = self._query_db('agent', operation)

        if not task_agents:
            return []

        
        final_agents = []
        


        for agent in task_agents:
            confidence = 0
            confidence_status = "yet to start"
            review_status = "Take Action"
            agent_id = agent.get("agent_id")
            run_status = agent.get("run_status", "").lower().strip()
            last_completed_ts = None

            # Reset defaults at the start of every loop
            # confidence = 0
            # confidence_status = "yet to start"
            # review_status = "Take Action"

            # if run_status == "completed":
            #     confidence = 80 + secrets.choice([2, 4, 8, 10, 14, 16, 18])
            #     confidence_status = "In Progress"
            #     review_status = ""

            if run_status == "completed":
                print("xyz",agent_id)
            
                # last_agent_run = self.agent_tracking_collection.find_one(
                #     {"agent_id": agent_id, "agent_status": "completed"},
                #     sort=[("created_ts", -1)]
                # )
                find_op = {
                    'type': 'find_one',
                    'filter': {
                        'agent_id': agent_id,
                        'agent_status': 'completed'
                    },
                    'sort': [('created_ts', -1)]
                }
                last_agent_run = self._query_db('agent_tracking', find_op)
                print("last",last_agent_run)

                
                if last_agent_run:
                    last_completed_ts = last_agent_run.get("created_ts","")
                    print("yES",last_completed_ts)
                    first_false_action = None
                    for action in last_agent_run.get("action", []):
                        
                        if action.get("flag") == False:
                            print("flag")
                            first_false_action = action
                            break
                        # else:
                        #     review_status = "Completed"
                        #     confidence = 100
                        #     confidence_status = "Completed"
                        #     first_false_action = None
                        #     break

                    if first_false_action:
                        
                        confidence = first_false_action.get("percentage", 0)
                        confidence_status = "In Progress"
                        review_status = first_false_action.get("name", "yet to start")
                


            agent_info = {
                "agent_id": agent_id,
                "agent_name": agent.get("name"),
                "role_id": agent.get("role_id"),
                "role_name": agent.get("role_name"),
                "description": agent.get("description"),
                "model": agent.get("model"),
                "agent_type_name": agent.get("agent_type_name"),
                "agent_provider": agent.get("agent_provider"),
                "created_ts": agent.get("created_ts"),
                "updated_ts": agent.get("updated_ts"),
                "last_completed_ts": last_completed_ts,
                "confidence_perc": confidence,
                "confidence_status": confidence_status,
                "review_status": review_status,
                "rating": agent.get("rating", 0),
                "feedback": agent.get("feedback", ""),
                "run_status": agent.get("run_status", ""),
            }

            # Step 2: Find all mapped agency IDs for this agent
            mappings = list(self.agent_agency_mapping_collection.find({
                "agent_id": agent_id,
                "status": "active"  # only active mappings
            }))

            agencies = []
            for mapping in mappings:
                agency_id = mapping.get("agency_id")
                agency = self.agency_collection.find_one({"agency_id": agency_id})
                if agency:
                    agency_info = {
                        "agency_id": agency.get("agency_id"),
                        "agency_name": agency.get("agency_name"),
                        "agency_desc": agency.get("agency_desc"),
                        "provider_id": agency.get("provider_id"),
                        "provider_name": agency.get("provider_name"),
                        "last_run_ts": agency.get("last_run_ts"),
                        "created_ts": agency.get("created_ts"),
                        "updated_ts": agency.get("updated_ts"),
                        "agency_task": agency.get("agency_task"),
                        "agency_team": agency.get("agency_team"),
                        "assigned_to": agency.get("assigned_to")
                    }
                    agencies.append(agency_info)

            agent_info["agencies"] = agencies

            # Add this agent + agencies to the result
            final_agents.append(agent_info)

        # Sort agents by last_completed_ts (nulls go last)
        sorted_agents = sorted(
            final_agents,
            key=lambda x: datetime.fromisoformat(str(x['last_completed_ts']))
            if x['last_completed_ts'] else datetime.min,
            reverse=True
        )

        return sorted_agents



    def update_agency_mappings(self, request):
        data = request.get_json()
        agency_id = data.get('agency_id')
    
        if not agency_id:
            raise ValidationError("Missing required field: agency_id")
        
        mappings_cursor = self.agent_agency_mapping_collection.find({"agency_id": agency_id})
        mappings = list(mappings_cursor)
        
        agent_ids = [mapping.get('agent_id') for mapping in mappings if mapping.get('agent_id')]
        
        agents_cursor = self.agent_collection.find({ "agent_id": { "$in": agent_ids } })
        agents = list(agents_cursor)
        
        for doc in mappings:
            doc['_id'] = str(doc['_id'])
        
        for doc in agents:
            doc['_id'] = str(doc['_id'])
        
        return mappings,agents