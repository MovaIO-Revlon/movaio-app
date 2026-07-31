from datetime import datetime, timezone, timedelta
from flask import json, request, jsonify, send_file
from config_loader import ConfigLoader, config_loader
import logging
import requests
from commonutils import DatabaseCollections, CommonUtils
from session_manager import get_current_user
from config_loader import config_loader
from database_manager import select_database_by_user_type
from utils import ValidationError
from bson.objectid import ObjectId
from UserManagement import UserManager
from lyzr_api_management import LyzrAPIManagement
# DatabaseManager is now replaced by DatabaseCollections in common_utils


class SchedulerValidator:
    @staticmethod
    def process_scheduler(schedule_frequencies, scheduler_time_data):
        try:
            scheduler_output = {}
            
            if isinstance(schedule_frequencies, str):
                schedule_frequencies = [schedule_frequencies]
            
            for freq in schedule_frequencies:
                if freq == "daily":
                    scheduler_output["daily"] = SchedulerValidator.validate_daily(
                        scheduler_time_data.get("daily")
                    )
                elif freq == "weekly":
                    scheduler_output["weekly"] = SchedulerValidator.validate_weekly(
                        scheduler_time_data.get("weekly")
                    )
                elif freq == "monthly":
                    scheduler_output["monthly"] = SchedulerValidator.validate_monthly(
                        scheduler_time_data.get("monthly")
                    )
            
            return scheduler_output
        
        except Exception as e:
            return jsonify({
                "Success": False,
                "Message": f"Invalid scheduler format: {str(e)}"
            }), 200
    
    @staticmethod
    def validate_daily(data):
        if isinstance(data, dict):
            time_str = data.get("time")
        else:
            time_str = data
        datetime.strptime(time_str, "%H:%M")
        return {"time": time_str}
    
    @staticmethod
    def validate_weekly(data):
        if not isinstance(data, dict):
            return jsonify({"Success": False, "Message": "Invalid format for weekly. Expected {days:[...], time:'HH:MM'}"}), 200
        datetime.strptime(data.get("time"), "%H:%M")
        return {"days": data.get("days", []), "time": data["time"]}
    
    @staticmethod
    def validate_monthly(data):
        if isinstance(data, dict) and 'dates' in data:
            validated_dates = []
            for date_str in data['dates']:
                try:
                    dt = datetime.strptime(date_str, "%m/%d/%Y")
                    validated_dates.append(dt.strftime("%Y-%m-%d"))
                except ValueError:
                    try:
                        dt = datetime.fromisoformat(date_str)
                        validated_dates.append(dt.strftime("%Y-%m-%d"))
                    except ValueError:
                        continue
            datetime.strptime(data.get("time", "00:00"), "%H:%M")
            return {"dates": validated_dates, "time": data.get("time", "00:00")}
        else:
            dt = datetime.fromisoformat(data)
            return dt.strftime("%m/%d/%Y %H:%M")


class AgentManager(DatabaseCollections):
    def __init__(self):
        super().__init__()
        self.scheduler_validator = SchedulerValidator()
        self.config = ConfigLoader()        
        self.utils = CommonUtils()
        self.user_manager = UserManager()
        self.lyzr_api_manager= LyzrAPIManagement()
    
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

    def add_update_agent_details(self, request):
        agent_details = request.get_json()
        agent_id = agent_details.get('agent_id', '')
        agent_submit_type = agent_details.get("agent_submit_type", "new")
        if agent_submit_type == "new":
            agent_provider_type = agent_details.get('agent_provider_type','')
            enriched_names = self._get_agent_details(agent_details)
            scheduler_time = self.scheduler_validator.process_scheduler(
                agent_details.get("scheduleFrequency"),
                agent_details.get("schedulerTime")
            )
            version = agent_details.get("version", "1.0.0")
            if isinstance(scheduler_time, tuple):
                return scheduler_time
            
            if agent_provider_type == "new":
                agent_doc_data = self._build_agent_doc_lyzr(agent_details, enriched_names, scheduler_time, version)
            else:
                agent_doc_data = self._build_agent_doc(agent_details, agent_id, enriched_names, scheduler_time)
            agent_doc_data['created_ts'] = datetime.now(timezone.utc)
            # agent_doc_data['agent_doc_data'] = agent_doc_data
            insertd = self.agent_collection.insert_one(agent_doc_data)
            inserted_id = str(insertd.inserted_id)
            mail_data = {
                "agent_id": inserted_id,
                "agent_name": agent_details.get("name", ""),
                "agent_description": agent_details.get("description", ""),
                "agent_role": agent_details.get("agent_role", ""),
                "agent_instruction": agent_details.get("agent_prompt", "")
            }
            to_email = agent_details.get("approverEmail")
            #mail_result = self.user_manager.send_mail_approval(
            #    to_email=to_email,
            #    to_name="Pranav",
             #   data=mail_data,
            #    sourcefrom="Onboarding"
           # )
            data = {
                "agent_id": inserted_id,
                "status": "Approved",
                "sourcefrom": "Onboarding"
            }
            self.lyzr_api_manager.approval_api(data)
            return True
        else:
            agent_id = agent_details.get('agent_id')
            if not agent_id:
                raise ValidationError("Missing agent id")
            agent_provider_type = agent_details.get('agent_provider_type','')
            print("agent_provider_type:", agent_provider_type)
            enriched_names = self._get_agent_details(agent_details)
            scheduler_time = self.scheduler_validator.process_scheduler(
                agent_details.get("scheduleFrequency"),
                agent_details.get("schedulerTime")
            )
            if isinstance(scheduler_time, tuple):
                return scheduler_time
            agent_db_data = json.loads(json.dumps(self.agent_collection.find_one({'agent_id': agent_id}, {'_id': 0})))
            version  = agent_db_data.get("version", "1.0.0")
            agent_doc_data = self._build_agent_doc_lyzr_upd(agent_details, enriched_names, scheduler_time,version) if agent_provider_type == "new" else self._build_agent_doc(agent_details, agent_id, enriched_names, scheduler_time)
            agent_doc_data['updated_ts'] = datetime.utcnow()
            self.agent_collection.update_one({'agent_id': agent_id}, {'$set': {"agent_doc_data": agent_doc_data}} )
            self.agent_collection.update_one({'agent_id': agent_id}, {'$set': {"metadata": agent_details}})
            mail_data = {
                "agent_id": agent_id,
                "agent_name": agent_details.get("name", ""),
                "agent_description": agent_details.get("description", ""),
                "agent_role": agent_details.get("agent_role", ""),
                "agent_instruction": agent_details.get("agent_prompt", "")
            }
            to_email = agent_details.get("approverEmail")
            #mail_result = self.user_manager.send_mail_approval(
             #   to_email=to_email,
             #   to_name="Pranav",
             #   data=mail_data,
             #   sourcefrom="Update"
           # )
            data = {
                "agent_id": agent_id,
                "status": "Approved",
                "sourcefrom": "Update"
            }
            self.lyzr_api_manager.approval_api(data)
            return True
    
    def onboard_agent_details(self, request):
        agent_details = request.get_json()
        agent_id = agent_details.get('agent_id')
        
        if not agent_id:
            raise ValidationError("Missing agent id")
        
        enriched_names = self._get_agent_details(agent_details)
        scheduler_time = self.scheduler_validator.process_scheduler(
            agent_details.get("scheduleFrequency"),
            agent_details.get("schedulerTime")
        )
        if isinstance(scheduler_time, tuple):
            return scheduler_time
        
        
        agent_doc_data = self._build_agent_doc(agent_details, agent_id, enriched_names, scheduler_time)
        agent_doc_data['created_ts'] = datetime.utcnow()
        self.agent_collection.insert_one(agent_doc_data)
        return True
    
    def _get_agent_details(self, agent_details):
        names = {}
        
        if agent_details.get('role_id'):
            names['role_name'] = self.utils.get_name_from_collection(
                self.agent_role_master_collection, "agent_role_id", 
                agent_details['role_id'], "agent_role_name", "active"
            )
        
        if agent_details.get('mcp_connector_id'):
            names['mcp_connector_name'] = self.utils.get_name_from_collection(
                self.mcp_master_collection, "mcp_id", 
                agent_details['mcp_connector_id'], "mcp_name"
            )
        
        if agent_details.get('model'):
            names['model_name'] = self.utils.get_name_from_collection(
                self.llm_master_collection, "llm_id", 
                agent_details['model'], "model_name", "active"
            )
        
        if agent_details.get('agent_type_id'):
            names['agent_type_name'] = self.utils.get_name_from_collection(
                self.agent_type_master_collection, "agent_type_id", 
                agent_details['agent_type_id'], "agent_type_name", "active"
            )
        
        return names
    
    def get_all_dropdown_details(self):
        # MCP Connector (no status filter)
        mcp_connector = self.utils.build_dropdown_options(
            self.mcp_master_collection, "mcp_id", "mcp_name"
        )

        # AI Models (only active ones)
        ai_models = self.utils.build_dropdown_options(
            self.llm_master_collection, "llm_id", "model_name", "active"
        )

        # Agent Roles
        roles = self.utils.build_dropdown_options(
            self.agent_role_master_collection, "agent_role_id", "agent_role_name", "active"
        )

        # Agent Types
        agent_types = self.utils.build_dropdown_options(
            self.agent_type_master_collection, "agent_type_id", "agent_type_name", "active"
        )

        # Agent Providers
        agent_providers = self.utils.build_dropdown_options(
            self.agent_provider_collection, "provider_id", "provider_name", "active"
        )

        knowledge_data = []
        knowledge_cursor = self.knowledgebase_collection.find(
            {}, {"_id": 0, "rag_id": 1, "rag_name": 1, "enabled": 1}
        )
        for item in knowledge_cursor:
            rag_id = item.get("rag_id")
            rag_name = item.get("rag_name")
            enabled = bool(rag_id and rag_name)
            knowledge_data.append({
                "label": rag_name if rag_name else "Unknown",
                "value": rag_id if rag_id else None,
                "enabled": enabled
            })

        # AI Foundations (modules under SRS features)
        ai_foundations = []
        seen_modules = set()
        foundation_cursor = self.ai_foundation_collection.find(
            {"features.type": "SRS"}, {"_id": 0, "features": 1}
        )
        for item in foundation_cursor:
            features = item.get("features", [])
            for feature in features:
                if feature.get("type") == "SRS":
                    modules = feature.get("config", {}).get("modules", {})
                    for module_name, enabled in modules.items():
                        if enabled and module_name not in seen_modules:
                            ai_foundations.append({
                                "label": module_name.capitalize(),
                                "value": module_name
                            })
                            seen_modules.add(module_name)

        return (
            mcp_connector,
            ai_models,
            roles,
            agent_types,
            agent_providers,
            knowledge_data,
            ai_foundations
        )
    
    
    def insert_external_agent(self, request):
        payload = request.get_json()
        
        agent_id = payload.get('agent_id', '').strip()
        if not agent_id:
            raise ValidationError("Missing agent_id")
        
        existing_agent_data = self.agent_collection.find_one({"agent_id": agent_id})
        if existing_agent_data:
            isDeleted = existing_agent_data.get("isDeleted", False)
            if not isDeleted:
                raise ValidationError("Agent with the same Agent ID already exists")
        
        scheduler_time = None
        if payload.get("scheduleFrequency") and payload.get("schedulerTime"):
            scheduler_time = self.scheduler_validator.process_scheduler(
                payload["scheduleFrequency"],
                payload["schedulerTime"]
            )
            if isinstance(scheduler_time, tuple):
                return scheduler_time
        
        role_name, agent_type_name = self._get_metadata(payload)
        agent_data, error_resp = self._fetch_external_agent(agent_id, payload.get("api_key"),agent_type_name,payload.get("agent_api_url", "").strip())
        if error_resp:
            raise ValidationError("Failed to fetch agent details", error_resp)
        
        if agent_type_name == "Voice Agent":
           
            mapped_data = self._get_external_voice_agent_doc(payload, agent_data, role_name, agent_type_name, scheduler_time)

        else:
            mapped_data = self._get_external_agent_doc(payload, agent_data, role_name, agent_type_name, scheduler_time)
            
        
        mapped_data['created_ts'] = datetime.utcnow()
        
        # if self.agent_collection.find_one({"agent_id": agent_id}):
            # return jsonify({"Success": False, "Message": "Agent already exists"}), 200
            
        find_op = {
            'type': 'find_one',
            'filter': {
                "agent_id": agent_id,
                "isDeleted": False                   
            }
        }
        agent = self._query_db('agent', find_op)

        if agent:
            raise ValidationError("Agent already exists")
        
        self.agent_collection.insert_one(mapped_data)
        return True
    
    def _get_metadata(self, payload):
        role_name, agent_type_name = "", ""
        
        if payload.get("role_id"):
            role_name = self.utils.get_name_from_collection(
                self.agent_role_master_collection, "agent_role_id", 
                payload["role_id"], "agent_role_name", "active"
            )
        
        if payload.get("agent_type_id"):
            agent_type_name = self.utils.get_name_from_collection(
                self.agent_type_master_collection, "agent_type_id", 
                payload["agent_type_id"], "agent_type_name", "active"
            )
        
        return role_name, agent_type_name
    
    def _fetch_external_agent(self, agent_id, api_key,agent_type_name,api_url):
        if agent_type_name == "Voice Agent":
            url = api_url+ "/v1/agents/"
        
        else:
            url = config_loader.LYZR_AGENT_URL + "/v3/agents/"

        # url = config_loader.LYZR_AGENT_URL + "/v3/agents/"
        full_url = f"{url.rstrip('/')}/{agent_id}"
        headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        
        response = requests.get(full_url, headers=headers)
        if response.status_code != 200:
            return None, jsonify({
                "Success": False,
                "Message": "Failed to fetch agent data. Please check the API or URL."
            })
        
        try:
            agent_data = response.json()
            return agent_data, None
        except json.JSONDecodeError:
            logging.error("Invalid JSON response from external agent API: %s", response.text)
            return None, jsonify({
                "Success": False,
                "Message": "Invalid response from the external API. Please check the API or URL."
            })
    
    def increment_version(self, version_str: str) -> str:
        """Increments a patch version, bumping minor and major versions at 10."""
        # Split string into integers
        major, minor, patch = map(int, version_str.split('.'))
        
        # Increment patch
        patch += 1
        
        # Check for carry over
        if patch >= 10:
            patch = 0
            minor += 1
            
        if minor >= 10:
            minor = 0
            major += 1
            
        return f"{major}.{minor}.{patch}"

    def _build_agent_doc_lyzr_upd(self, agent_details, names, scheduler_time, version):
        return {
            "name": agent_details.get("name", ""),
            "role_id": agent_details.get("role_id", ""),
            "role_name": names.get("role_name", ""),
            "description": agent_details.get("description", ""),
            "prompt_template": agent_details.get("prompt_template", ""),
            "agent_prompt": agent_details.get("agent_prompt", ""),
            "model": agent_details.get("model", ""),
            "model_name": names.get("model", ""),
            "ref_output": agent_details.get("ref_output", ""),
            "example":agent_details.get("example", ''),
            "mcp_connector_id": agent_details.get("mcp_connector_id"),
            "mcp_connector_name": names.get("mcp_connector_name", ""),
            "mcp_connector_checkbox": agent_details.get("mcp_connector_checkbox", False),
            "mcp_connector_value": agent_details.get("mcp_connector_value", {}),
            "knowledge_store_id": agent_details.get("knowledge_store_id"),
            "knowledge_store_enabled": agent_details.get("knowledge_store_enabled", False),
            "knowledge_store_checkbox": agent_details.get("knowledge_store_checkbox", False),
            "knowledge_store_value": agent_details.get("knowledge_store_value", {}),
            "data_store_checkbox": agent_details.get("data_store_checkbox", False),
            "data_store_value": agent_details.get("data_store_value", {}),
            "memory_checkbox": agent_details.get("memory_checkbox", False),
            "memory_value": agent_details.get("memory_value", {}),
            "context_checkbox": agent_details.get("context_checkbox", False),
            "context_value": agent_details.get("context_value", {}),
            "ai_foundation": agent_details.get("ai_foundation", ""),
            "ai_foundation_enabled": agent_details.get("ai_foundation_enabled", False),
            "agent_role": agent_details.get("agent_role", ""),
            "agent_goal": agent_details.get("agent_goal", ""),
            "foundation_resp_ai": agent_details.get("foundation_resp_ai", False),
            "foundation_ethic_ai": agent_details.get("foundation_ethic_ai", False),
            "foundation_guardrails_ai": agent_details.get("foundation_guardrails_ai", False),
            # "status": agent_details.get("status", "inactive"),
            "agent_owner": agent_details.get("agent_owner", ""),
            "agent_type_id": agent_details.get("agent_type_id", ""),
            "agent_type_name": names.get("agent_type_name", ""),
            "agent_provider_type": agent_details.get("agent_provider_type", ""),
            "scheduleFrequency": agent_details.get("scheduleFrequency"),
            "schedulerTime": scheduler_time,
            "avatar": agent_details.get("avatar", ""),
            "actions": agent_details.get("actions", []),
            "metadata": agent_details,
            "version": version,
            "Approval_Status": agent_details.get("Approval_Status", "Approved"),
            "Approval_Status_Message": agent_details.get("Approval_Status_Message", "Approved"),
            "approverEmail":agent_details.get("approverEmail", ""),
            "save_history": agent_details.get("save_history", False)
        }

    def _build_agent_doc_lyzr(self, agent_details, names, scheduler_time, version):
        return {
            "agent_id": "",
            "agent_api_key": self.config.API_KEY_LYZR,
            "user_id": self.config.USER_ID_LYZR,
            "name": agent_details.get("name", ""),
            "role_id": agent_details.get("role_id", ""),
            "role_name": names.get("role_name", ""),
            "agent_api_url": self.config.LYZR_AGENT_URL + "/v3/inference/chat/",
            "description": agent_details.get("description", ""),
            "prompt_template": agent_details.get("prompt_template", ""),
            "agent_prompt": agent_details.get("agent_prompt", ""),
            "model": agent_details.get("model", ""),
            "model_name": names.get("model", ""),
            "ref_output": agent_details.get("ref_output", ""),
            "example":agent_details.get("example", ''),
            "mcp_connector_id": agent_details.get("mcp_connector_id"),
            "mcp_connector_name": names.get("mcp_connector_name", ""),
            "mcp_connector_checkbox": agent_details.get("mcp_connector_checkbox", False),
            "mcp_connector_value": agent_details.get("mcp_connector_value", {}),
            "knowledge_store_id": agent_details.get("knowledge_store_id"),
            "knowledge_store_enabled": agent_details.get("knowledge_store_enabled", False),
            "knowledge_store_checkbox": agent_details.get("knowledge_store_checkbox", False),
            "knowledge_store_value": agent_details.get("knowledge_store_value", {}),
            "data_store_checkbox": agent_details.get("data_store_checkbox", False),
            "data_store_value": agent_details.get("data_store_value", {}),
            "memory_checkbox": agent_details.get("memory_checkbox", False),
            "memory_value": agent_details.get("memory_value", {}),
            "context_checkbox": agent_details.get("context_checkbox", False),
            "context_value": agent_details.get("context_value", {}),
            "ai_foundation": agent_details.get("ai_foundation", ""),
            "ai_foundation_enabled": agent_details.get("ai_foundation_enabled", False),
            "agent_role": agent_details.get("agent_role", ""),
            "agent_goal": agent_details.get("agent_goal", ""),
            "foundation_resp_ai": agent_details.get("foundation_resp_ai", False),
            "foundation_ethic_ai": agent_details.get("foundation_ethic_ai", False),
            "foundation_guardrails_ai": agent_details.get("foundation_guardrails_ai", False),
            "status": agent_details.get("status", "inactive"),
            "agent_owner": agent_details.get("agent_owner", ""),
            "agent_type_id": agent_details.get("agent_type_id", ""),
            "agent_type_name": names.get("agent_type_name", ""),
            "agent_provider_type": agent_details.get("agent_provider_type", ""),
            "scheduleFrequency": agent_details.get("scheduleFrequency"),
            "schedulerTime": scheduler_time,
            "avatar": agent_details.get("avatar", ""),
            "actions": agent_details.get("actions", []),
            "metadata": agent_details,
            "version": version,
            "Approval_Status": agent_details.get("Approval_Status", "Pending Approval"),
            "Approval_Status_Message": agent_details.get("Approval_Status_Message", "Pending for approval"),
            "approverEmail":agent_details.get("approverEmail", "")
        }

    def _build_agent_doc(self, agent_details, agent_id, names, scheduler_time):
        return {
            'agent_id': agent_id,
            'name': agent_details.get('name', ''),
            'role_id': agent_details.get('role_id', ''),
            'role_name': names.get('role_name', ''),
            'description': agent_details.get('description', ''),
            'prompt_template': agent_details.get('prompt_template', ''),
            'agent_prompt': agent_details.get('agent_prompt', ''),
            'model': agent_details.get('model', ''),
            'model_name': names.get('model_name', ''),
            'ref_output': agent_details.get('response_format', ''),
            'example':agent_details.get('examples', ''),
            'mcp_connector_id': agent_details.get('mcp_connector_id'),
            'mcp_connector_name': names.get('mcp_connector_name', ''),
            'knowledge_store_id': agent_details.get('knowledge_store_id'),
            'knowledge_store_enabled': agent_details.get('knowledge_store_enabled', False),
            'ai_foundation': agent_details.get('ai_foundation', ''),
            'ai_foundation_enabled': agent_details.get('ai_foundation_enabled', False),
            'agent_role': agent_details.get('agent_role', ''),    
            'agent_goal': agent_details.get('agent_goal', ''),
            'foundation_resp_ai': agent_details.get('foundation_resp_ai', False),
            'foundation_ethic_ai': agent_details.get('foundation_ethic_ai', False),
            'foundation_guardrails_ai': agent_details.get('foundation_guardrails_ai', False),
            'status': agent_details.get('status', ''),
            'agent_owner': agent_details.get('agent_owner', ''),
            'agent_type_id': agent_details.get('agent_type_id', ''),
            'agent_type_name': names.get('agent_type_name', ''),
            'scheduleFrequency': agent_details.get('scheduleFrequency'),
            'schedulerTime': scheduler_time,
            'avatar': agent_details.get('avatar', ''),
            'actions': agent_details.get('actions', [])
        }
    
    def _get_external_agent_doc(self, payload, agent_data, role_name, agent_type_name, scheduler_time):
        # Build Knowledge Store dict
        knowledge_store = {"id": None, "name": None, "enabled": False}
        features = agent_data.get("features", [])
        api_kg_id = agent_data.get("api_key","")
        agent_new_id = agent_data.get("_id","")
        
        LYZR_BASE_URL = "https://agent-prod.studio.lyzr.ai/v3"
        headers = {"x-api-key": api_kg_id}

        url = f"{LYZR_BASE_URL}/agent_eval/result/agent"
        resp = requests.get(url, headers=headers, params={"agent_id": agent_new_id}, timeout=120)
        agent_evals = []
        if resp.status_code == 200:
            results = resp.json()  
            if results:
                
                # current_user = get_current_user()
                # fetched_by = current_user.get("user_id") if current_user else "system"

                for run in results:
                    if not isinstance(run, dict):
                        continue

                    run_name = run.get("run_name","")
                    agent_eval_id = run.get("agent_eval_id","")
                    agent_evals.append(agent_eval_id)
                    run.pop("_id", None)
                    if not agent_eval_id:
                        continue
                    

                    
               
                    run["fetched_at"] = self.utils.get_current_timestamp()
                    
                    self.agent_eval_collection.update_one(
                        {"run_name": run_name}, 
                        {"$set": run},
                        upsert=True
                       
                    )
        
        
        # rag_data = {}
        all_knowledege = []
        old_rag_ids = []
        knowledge_store = {"id": None, "name": None, "enabled": False}
        all_knowledege,knowledge_store,old_rag=self.get_features_list(features,headers,api_kg_id,knowledge_store,old_rag_ids)
        # for feature in features:
        #     if feature.get("type") == "KNOWLEDGE_BASE":
        #         rag_config = feature.get("config", {}).get("lyzr_rag", {})
        #         rag_id = rag_config.get("rag_id")
        #         rag_name = rag_config.get("rag_name")
        #         rag_url = f"https://rag-prod.studio.lyzr.ai/v3/rag/user/{api_kg_id}"
        #         try:
        #             response = requests.get(rag_url, headers=headers, timeout=120)
        #             response.raise_for_status()  # raises HTTPError for 4xx/5xx
                    
        #             configs = response.json()
                    
        #             # Most common cases: list of dicts or {"configs": [...]}
        #             if isinstance(configs, dict) and "configs" in configs:
        #                 configs = configs["configs"]
                    
        #             if not isinstance(configs, list):
        #                 print(f"Unexpected response format: {type(configs)}")
        #                 return None
                    
                    
        #             for config in configs:
        #                 # Try different possible field names (your sample doesn't have rag_id)
        #                 candidate_id = config.get("rag_id") or config.get("_id") or config.get("id")
        #                 if candidate_id == rag_id:
        #                     rag_data = config
                    
        #             print(f"No config found with rag_id = {rag_id}")
        #         except:
        #             print("Failed to fetch RAG details")

        #         url = f"https://rag-prod.studio.lyzr.ai/v3/rag/documents/{rag_id}"
                    
        #         try:
        #             response = requests.get(url, headers=headers)
        #             response.raise_for_status()
        #             data = response.json()
        #             # Adjust based on actual response structure; assuming {'documents': [...]}
        #             count = len(data.get('documents', [])) if isinstance(data, dict) else len(data) if isinstance(data, list) else 0
        #             rag_data['document_count'] = count
        #         except (requests.HTTPError, ValueError) as e:
        #             # Skip or log error for this rag_id; continue with others
        #             rag_data['document_count'] = 0  # Default count if error occurs


                
        #         if rag_name and len(rag_name) > 4:
        #             rag_name = rag_name[:-4]
                
        #         enabled = bool(rag_id and rag_name)

                
        #         self.kb_collection.find_one({"_id": rag_id})
        #         if rag_id:
        #             self.kb_collection.update_one(
        #                     {"_id": rag_id},
        #                     {"$set": {
        #                         "_id": rag_id,
        #                         "rag_id": rag_id,
        #                         "collection_name": rag_name,
        #                         "user_id":api_kg_id,
        #                         "config": rag_data
        #                     }},
        #                     upsert=True
        #                 )
                    
                    
        #             knowledge_store = {
        #                 "id": rag_id,
        #                 "name": rag_name,
        #                 "enabled": enabled
        #             }
        #             all_knowledege.append(knowledge_store)
    
        # Extract and save AI foundation modules
        ai_foundation = []
        agent_id = payload.get("agent_id", "").strip()
        for feature in features:
            if feature.get("type") == "SRS":
                modules = feature.get("config", {}).get("modules", {})
                enabled_modules = [
                    {"name": module_name, "enabled": enabled}
                    for module_name, enabled in modules.items()
                    if enabled
                ]
                if enabled_modules:
                    # Save to ai_foundation_collection with agent_id as unique key
                    self.ai_foundation_collection.update_one(
                        {"agent_id": agent_id, "type": "SRS"},
                        {
                            "$set": {
                                "agent_id": agent_id,
                                "features": [{
                                    "type": "SRS",
                                    "config": {"modules": modules}
                                }]
                            }
                        },
                        upsert=True
                    )
                    ai_foundation.append({
                        "type": feature.get("type"),
                        "modules": enabled_modules
                    })
                    
        ai_foundation_enabled = bool(ai_foundation)  
        knowledge_store_enabled = knowledge_store.get("enabled", False)
        mapped_data = {
            "name": payload.get("agent_name", "").strip(),
            "agent_id": payload.get("agent_id", "").strip(),
            "api_agent_id": payload.get("agent_id", "").strip(),
            "user_id": payload.get("user_id", "").strip(),
            "agent_owner": "external",
            "agent_api_key": payload.get("api_key", "").strip(),
            "agent_session_id": payload.get("agent_session_id", "").strip(),
            "agent_type_id": payload.get("agent_type_id"),
            "agent_type_name": agent_type_name,
            "role_id": payload.get("role_id"),
            "role_name": role_name,
            "agent_api_url": payload.get("agent_api_url", "").strip(),
            "foundation_resp_ai": False,
            "foundation_ethic_ai": False,
            "foundation_guardrails_ai": False,
            "description": agent_data.get("description"),
            "agent_role": agent_data.get("agent_role"),   
            "agent_goal": agent_data.get("agent_goal",''), 
            "agent_prompt": agent_data.get("agent_instructions",''),
            "ref_output": agent_data.get('response_format', ''),
            "example":agent_data.get('examples', ''),            
            
            "model": agent_data.get("model"),
            "avatar": payload.get("avatar", ""),
            "actions": payload.get("actions", []),
            "knowledge_store": all_knowledege,
            "agent_evals":agent_evals,
            "ai_foundation": ai_foundation,
            #"knowledge_store_id": knowledge_store["id"],
            "knowledge_store_enabled": knowledge_store_enabled,
            "ai_foundation_enabled": ai_foundation_enabled,
        }
        # if agent_type_name == "Voice Agent":
        #     mapped_data["session_start_url"] = payload.get("start_session_url")
        #     mapped_data["session_end_url"] = payload.get("end_session_url")
        
        if payload.get("scheduleFrequency") and scheduler_time:
            mapped_data["scheduleFrequency"] = payload["scheduleFrequency"]
            mapped_data["schedulerTime"] = scheduler_time
        
        return mapped_data
    
    def _get_external_voice_agent_doc(self, payload, agent_data, role_name, agent_type_name, scheduler_time):
        
       
        agent_info = agent_data.get("agent", {})
        config = agent_info.get("config", {})
        
        # 2. Extract agent_id from the JSON, fallback to payload if missing
        agent_id = agent_info.get("id", payload.get("agent_id", "")).strip()
        
        mapped_data = {
            # Extract from config, fallback to payload
            "name": payload.get("agent_name", "").strip(),
            "agent_id": agent_id,
            "api_agent_id": agent_id,
            "user_id": payload.get("user_id", "").strip(),
            "agent_owner": "external",
            "agent_api_key": config.get("api_key", payload.get("api_key", "")).strip(),
            "agent_session_id": payload.get("agent_session_id", "").strip(),
            "agent_type_id": payload.get("agent_type_id"),
            "agent_type_name": agent_type_name,
            "role_id": payload.get("role_id"),
            "role_name": role_name,
            "agent_api_url": payload.get("agent_api_url", "").strip(),
            "foundation_resp_ai": False,
            "foundation_ethic_ai": False,
            "foundation_guardrails_ai": False,
            
            # CORRECTED EXTRACTIONS: Pointing to the 'config' dict
            "description": config.get("agent_description", ""),       # Fixed: Key is "agent_description"
            "agent_role": config.get("agent_role", ""),               
            "agent_goal": config.get("agent_goal", ""), 
            "agent_prompt": config.get("agent_instructions", ""),
            "ref_output": config.get("response_format", ""),
            "example": config.get("examples", ""),            
            
            # Fixed: Model is nested under config["engine"]["llm"]
            "model": config.get("engine", {}).get("llm", ""),
            
            # Avatar is also inside config
            "avatar": config.get("avatar", payload.get("avatar", "")),
            
            "actions": payload.get("actions", []),
            "tools":[action for tool in config.get("lyzr_tools", []) for action in tool.get("action_names", [])],
            "session_start_url": payload.get("session_start_url"),
            "session_end_url": payload.get("session_end_url")
        }
        
        if payload.get("scheduleFrequency") and scheduler_time:
            mapped_data["scheduleFrequency"] = payload["scheduleFrequency"]
            mapped_data["schedulerTime"] = scheduler_time
        
        return mapped_data
    

    def get_all_agent_details(self):
        operation = {
            'type': 'find',
            'filter': {
                "$or": [
                    {"isDeleted": {"$exists": False}},
                    {"isDeleted": False}
                ]
            }
        }
        agents = self._query_db('agent', operation)
        
        trending_agent_ids = self._get_trending_agent()
        
        for agent in agents:
            agent_id_str = str(agent.get("agent_id", ""))
            self._enrich_agent_document(agent, agent_id_str, trending_agent_ids)
        
        return agents
    
    def get_all_voice_agent_details(self):
        operation = {
            'type': 'find',
            'filter': {
                "agent_type_name":"Voice Agent",
                "$or": [
                    {"isDeleted": {"$exists": False}},
                    {"isDeleted": False}
                ]
            }
        }
        agents = list(self._query_db('agent', operation))
        
        
        if not agents:
            return []

        # 2. Extract all agent_ids
        agent_ids = [agent.get("api_agent_id") for agent in agents if agent.get("api_agent_id")]

        mapping_op = {
            'type': 'find',
            'filter': {
                "agent_id": {"$in": agent_ids},
                "status":"active"
            }
        }
        
        # 3. Get all mappings for these agents in a single database call
        mappings = list(self._query_db('agent_agency_mapping', mapping_op))

        # 4. Group the mappings by agent_id into a dictionary of lists
        mapping_dict = {}
        for m in mappings:
            a_id = m.get("agent_id")
            
            # If the agent_id isn't in the dict yet, add it with an empty list
            if a_id not in mapping_dict:
                mapping_dict[a_id] = []
                
            # Append this agency to the agent's list
            agency_id =  m.get("agency_id")
            find_agency_op = {
                'type':'find_one',
                'filter':{
                    'agency_id':agency_id
                }
            }
            agency_data = self._query_db('agency', find_agency_op)
            if isinstance(agency_data, dict):
                team = agency_data.get("assigned_to", '')
            else:
                # If the database returns None (not found), default to empty string
                team = ''
            mapping_dict[a_id].append({
                "agency_id": m.get("agency_id"),
                "agency_name": m.get("agency_name"),
                "team":team
            })

        # 5. Attach the list of agencies to each agent
        for agent in agents:
            agent.pop("_id", None)
            agent_id = agent.get("api_agent_id")
            
            # Assign the list of agencies (defaults to an empty list [] if none are mapped)
            agent["agencies"] = mapping_dict.get(agent_id, [])
        

        return agents
        
    def _get_trending_agent(self):
        time_threshold = datetime.now(timezone.utc) - timedelta(days=1)
        
        tracking_op = {
            'type': 'find',
            'filter': {"created_ts": {"$gte": time_threshold}},
            'projection': {"agent_id": 1}
        }
        tracking_data = self._query_db('agent_tracking', tracking_op)
        
        chatbot_op = {
            'type': 'find',
            'filter': {"updated_ts": {"$gte": time_threshold}},
            'projection': {"agent_id": 1}
        }
        chatbot_data = self._query_db('chatbot_tracking', chatbot_op)
        
        agent_ids_tracking = {item.get("agent_id") for item in tracking_data if item.get("agent_id")}
        agent_ids_chatbot = {item.get("agent_id") for item in chatbot_data if item.get("agent_id")}
        
        return agent_ids_tracking | agent_ids_chatbot
    
    def _get_all_active_agents(self):
        return list(self.agent_collection.find({
            "$or": [
                {"isDeleted": {"$exists": False}},
                {"isDeleted": False}
            ]
        }))
    
    def _enrich_agent_document(self, agent, agent_id_str, trending_agent_ids):
        self._convert_object_ids(agent)
        
        is_trending = (
            agent.get("status") == "active"
            and agent_id_str in trending_agent_ids
        )
        agent["trending"] = is_trending
        self.agent_collection.update_one(
            {"agent_id": agent_id_str, "status": "active"},
            {"$set": {"trending": is_trending}}
        )
        
        agent["run_count"] = self.utils.get_run_count(
            self.agent_tracking_collection, self.chatbot_tracking_collection, agent_id_str
        )
        
        agent["rating"] = agent.get("rating")

        
    
    def _convert_object_ids(self, agent):
        fields = ["_id", "agent_id", "role_id", "mcp_connector_id", "knowledge_store_id", "agent_type_id"]
        self.utils.convert_object_ids_to_string(agent, fields)
    
    def update_agent_manage_details(self, request, agent_id): 
        update_data = request.get_json()
        agent_type_id = update_data.get("agent_type_id",'')
        update_doc = self._get_allowed_fields(update_data,agent_type_id)
        self._get_update_details(update_data, update_doc)

        # KNOWLEDGE STORE HANDLING
        # if 'knowledge_store_id' in update_data or 'knowledge_store_enabled' in update_data:
            # knowledge_store_enabled = update_data.get('knowledge_store_enabled', False)
            # knowledge_store_id = update_data.get('knowledge_store_id')

            # if not knowledge_store_enabled:
                # update_doc['knowledge_store_id'] = None
                # update_doc['knowledge_store'] = {"id": None, "name": None, "enabled": False}
                # update_doc['knowledge_store_enabled'] = False
            # else:
                # if knowledge_store_id:
                    # knowledge_doc = self.knowledgebase_collection.find_one(
                        # {"rag_id": knowledge_store_id},
                        # {"_id": 0, "rag_name": 1, "enabled": 1}
                    # )
                    # if knowledge_doc:
                        # update_doc['knowledge_store'] = {
                            # "id": knowledge_store_id,
                            # "name": knowledge_doc.get("rag_name", ""),
                            # "enabled": knowledge_doc.get("enabled", True)
                        # }
                        # update_doc['knowledge_store_enabled'] = True
                    # else:
                        # update_doc['knowledge_store_id'] = None
                        # update_doc['knowledge_store'] = {"id": None, "name": None, "enabled": False}
                        # update_doc['knowledge_store_enabled'] = False
                # else:
                    # existing_agent = self.agent_collection.find_one({"agent_id": agent_id})
                    # if existing_agent and existing_agent.get('knowledge_store_enabled'):
                        # pass  # keep existing
                    # else:
                        # update_doc['knowledge_store_id'] = None
                        # update_doc['knowledge_store'] = {"id": None, "name": None, "enabled": False}
                        # update_doc['knowledge_store_enabled'] = False

        # Scheduler logic
        
        schedule_frequency = update_data.get('scheduleFrequency')
        scheduler_time_data = update_data.get('schedulerTime')

        if schedule_frequency and scheduler_time_data:
            scheduler_result = self.scheduler_validator.process_scheduler(schedule_frequency, scheduler_time_data)

            if scheduler_result and not (isinstance(scheduler_result, tuple) or hasattr(scheduler_result, "status_code")):
                if isinstance(schedule_frequency, str):
                    schedule_frequency = [schedule_frequency]

                update_doc['scheduleFrequency'] = schedule_frequency
                update_doc['schedulerTime'] = scheduler_result

        if not update_doc:
            return False

        # Update agent document
        # self.utils.update_document(
            # self.agent_collection,
            # {"agent_id": agent_id},
            # update_doc
        # )
        update_doc['updated_ts'] = datetime.utcnow()
        self.agent_collection.update_one({"agent_id":agent_id,"isDeleted": {"$ne": True}}, {"$set":update_doc})

        return True

    
    def _get_allowed_fields(self, update_data,agent_type_id):
        if agent_type_id == "VOICE_AGENT":
                allowed_fields = {
                'name', 'role_id', 'description', 'prompt_template', 'agent_prompt',
                'model', 'ref_output', 'mcp_connector_id', 'knowledge_store_id',
                'foundation_resp_ai', 'foundation_ethic_ai', 'foundation_guardrails_ai',
                'status', 'agent_owner', 'agent_provider', 'agent_type_id',
                'scheduleFrequency', 'schedulerTime', 'api_agent_id', 'agent_session_id','session_start_url','session_end_url',
                'agent_api_key', 'agent_api_url', 'user_id', 'avatar', 'actions',
                'schedulerFrequency', 'ai_foundation', 'agent_role', 'agent_goal', 'knowledge_store_enabled','mcp_connector_checkbox','mcp_connector_value','knowledge_store_checkbox','knowledge_store_value','data_store_checkbox','data_store_value','memory_checkbox','memory_value','context_checkbox','context_value'
            }
        else:
            allowed_fields = {
            'name', 'role_id', 'description', 'prompt_template', 'agent_prompt',
            'model', 'ref_output', 'mcp_connector_id', 'knowledge_store_id',
            'foundation_resp_ai', 'foundation_ethic_ai', 'foundation_guardrails_ai',
            'status', 'agent_owner', 'agent_provider', 'agent_type_id',
            'scheduleFrequency', 'schedulerTime', 'api_agent_id', 'agent_session_id',
            'agent_api_key', 'agent_api_url', 'user_id', 'avatar', 'actions',
            'schedulerFrequency', 'ai_foundation', 'agent_role', 'agent_goal', 'knowledge_store_enabled','mcp_connector_checkbox','mcp_connector_value','knowledge_store_checkbox','knowledge_store_value','data_store_checkbox','data_store_value','memory_checkbox','memory_value','context_checkbox','context_value'
        }

        
        return self.utils.build_update_doc(update_data, allowed_fields)
    
    def _get_update_details(self, update_data, update_doc):
        if 'role_id' in update_data:
            role_doc = self.agent_role_master_collection.find_one(
                {"agent_role_id": update_data['role_id'], "status": "active"},
                {"_id": 0, "agent_role_name": 1}
            )
            update_doc['role_name'] = role_doc['agent_role_name'] if role_doc else ""

        if 'model' in update_data:
            model_doc = self.llm_master_collection.find_one(
                {"llm_id": update_data['model'], "status": "active"},
                {"_id": 0, "model_name": 1}
            )
            update_doc['model_name'] = model_doc['model_name'] if model_doc else ""

        if 'mcp_connector_id' in update_data:
            mcp_doc = self.mcp_master_collection.find_one(
                {"mcp_id": update_data['mcp_connector_id']},
                {"_id": 0, "mcp_name": 1}
            )
            update_doc['mcp_connector_name'] = mcp_doc['mcp_name'] if mcp_doc else ""

        if 'agent_provider' in update_data:
            provider_doc = self.agent_provider_collection.find_one(
                {"provider_id": update_data['agent_provider'], "status": "active"},
                {"_id": 0, "provider_name": 1}
            )
            update_doc['agent_provider_name'] = provider_doc['provider_name'] if provider_doc else ""

        if 'agent_type_id' in update_data:
            type_doc = self.agent_type_master_collection.find_one(
                {"agent_type_id": update_data['agent_type_id'], "status": "active"},
                {"_id": 0, "agent_type_name": 1}
            )
            update_doc['agent_type_name'] = type_doc['agent_type_name'] if type_doc else ""
            
    
    def get_agent_details_counts(self):
        try:
            # Filter out deleted agents for all counts
            delete_filter = {"$or": [
                {"isDeleted": {"$ne": True}},
                {"isDeleted": {"$exists": False}}
            ]}
            
            total_op = {'type': 'count', 'filter': delete_filter}
            total = self._query_db('agent', total_op)
            
            active_op = {'type': 'count', 'filter': {**delete_filter, "status": "active"}}
            active = self._query_db('agent', active_op)
            
            trending_date = datetime.now() - timedelta(days=7)
            trending_op = {'type': 'count', 'filter': {**delete_filter, "created_ts": {"$gte": trending_date}}}
            trending = self._query_db('agent', trending_op)
            
            return total, active, trending
        
        except Exception as ex:
            logging.error("Error in get_agent_counts", exc_info=True)
            return 0, 0, 0
    
    def get_provider_dtls(self, request):
        payload = request.get_json()
        provider_id = payload.get('provider_id', '').strip()
        
        if not provider_id:
            raise ValidationError("Missing provider_id")
        
        provider = self.agent_provider_collection.find_one({"provider_id": provider_id})
        
        if not provider:
                raise ValidationError("Provider not found")
        
        result = {
            "provider_url": provider.get("provider_url", None),
            "provider_key": provider.get("provider_key", None)
        }
        
        return result
            
    def fetch_data(self, request):
        payload = request.get_json()

        agent_id = payload.get('agent_id', '').strip()
        api_key = payload.get('api_key', '').strip()   # fixed: was using 'agent_id' twice
        find_op = {
            'type': 'find_one',
            'filter': {
                "agent_id": agent_id,
                "$or": [
                        {"isDeleted": {"$exists": False}},
                        {"isDeleted": False}
                    ]                   
            }
        }
        agent_details = self._query_db('agent', find_op)
        agent_type_name = agent_details.get("agent_type_name","")
        api_url = agent_details.get("agent_api_url","")

        # Fetch external agent data
        agent_data, error_response = self._fetch_external_agent_data(agent_id, api_key,agent_type_name,api_url)
        
        if error_response:
            raise ValidationError("Failed to fetch agent details",error_response)

        # Map external data
        if agent_type_name == "Voice Agent":
            mapped_data = self._get_external_voice_agent_data(agent_data)

        else:
            mapped_data = self._get_external_agent_data(agent_data)
        

        # self.utils.update_document(
            # self.agent_collection,
            # {"agent_id": agent_id},
            # mapped_data
        # )
        self.agent_collection.update_one(
            {"api_agent_id": agent_id,"$or": [
                    {"isDeleted": {"$exists": False}},
                    {"isDeleted": False}
                ]},
            {"$set": mapped_data}
        )

        return True

    def _fetch_external_agent_data(self, agent_id, api_key,agent_type_name,api_url):

        if agent_type_name == "Voice Agent":
            url = api_url+ "/v1/agents/"
        else:
            url = "https://agent-prod.studio.lyzr.ai/v3/agents/"
       
        full_url = f"{url.rstrip('/')}/{agent_id}"
        headers = {
            "x-api-key": api_key,
            "Content-Type": "application/json"
        }

        response = requests.get(full_url, headers=headers)
        if response.status_code != 200:
            return None, jsonify({
                "Success": False,
                "Message": "Failed to fetch agent data. Please check the API or URL."
            })

        try:
            agent_data = response.json()
            print("agent_details",agent_data)
            return agent_data, None
        except json.JSONDecodeError:
            logging.error("Invalid JSON response from external agent API: %s", response.text)
            return None, jsonify({
                "Success": False,
                "Message": "Invalid response from the external API. Please check the API or URL."
            })
            
    def _get_external_agent_data_old(self, agent_data):
        
        # if agent_data is None:
            # return None
        
        # if isinstance(agent_data, list):
            # if len(agent_data) == 0:
                # return None
            # agent_data = agent_data[0]  # assume single agent was returned as list
        # if not isinstance(agent_data, dict):
            # raise TypeError(f"agent_data must be dict or list containing dict, got {type(agent_data)}")
        
        if isinstance(agent_data, list):
            if not agent_data:
                return  # or handle empty list
            agent_data = agent_data[0]

        print("agent",agent_data)
        knowledge_store = {"id": None, "name": None, "enabled": False}
        features = agent_data.get("features", [])
        api_kg_id = agent_data.get("api_key","")
        agent_new_id = agent_data.get("_id","")
        user_id = agent_data.get("user_id","")
        
        LYZR_BASE_URL = "https://agent-prod.studio.lyzr.ai/v3"
        headers = {"x-api-key": api_kg_id, "Content-Type": "application/json"}

        url = f"{LYZR_BASE_URL}/agent_eval/result/agent"
        resp = requests.get(url, headers=headers, params={"agent_id": agent_new_id}, timeout=120)
        agent_evals=[]
        if resp.status_code == 200:
            results = resp.json()  
            if results:
                
                # current_user = get_current_user()
                # fetched_by = current_user.get("user_id") if current_user else "system"

                for run in results:
                    if not isinstance(run, dict):
                        continue

                    run_name = run.get("run_name","")
                    agent_eval_id = run.get("agent_eval_id","")
                    agent_evals.append(agent_eval_id)
                    run.pop("_id", None)
                    if not agent_eval_id:
                        continue

                    
               
                    run["fetched_at"] = self.utils.get_current_timestamp()
                    
                    self.agent_eval_collection.update_one(
                        {"run_name": run_name}, 
                        {"$set": run},
                        upsert=True
                       
                    )
            

        
        if agent_new_id:
            agent_data_id= self.agent_collection.find_one({"api_agent_id":agent_new_id},{"_id":0,"agent_id":1})
            agent_id= agent_data_id.get("agent_id","")
        old_rag_ids = self.kb_collection.distinct("rag_id",{"agent_id":agent_new_id})  
        old_rag =[]
        all_knowledege = []
        if features:
            for feature in features:
              
                if feature.get("type") == "KNOWLEDGE_BASE":
                    rag_config = feature.get("config", {}).get("lyzr_rag", {})
                    rag_id = rag_config.get("rag_id")
                    if rag_id in old_rag_ids:
                        old_rag.append(rag_id) 
                    
                    rag_name = rag_config.get("rag_name")
                    rag_url = f"https://rag-prod.studio.lyzr.ai/v3/rag/user/{api_kg_id}"
                    try:
                        response = requests.get(rag_url, headers=headers, timeout=120)
                        response.raise_for_status()  # raises HTTPError for 4xx/5xx
                        
                        configs = response.json()
                        
                        # Most common cases: list of dicts or {"configs": [...]}
                        if isinstance(configs, dict) and "configs" in configs:
                            configs = configs["configs"]
                        
                        if not isinstance(configs, list):
                            print(f"Unexpected response format: {type(configs)}")
                            return None
                        
                        for config in configs:
                            # Try different possible field names (your sample doesn't have rag_id)
                            candidate_id = config.get("rag_id") or config.get("_id") or config.get("id")
                            if candidate_id == rag_id:
                                rag_data = config
                                print("Ff")
                        
                        print(f"No config found with rag_id = {rag_id}")
                    except:
                        print("Failed to fetch RAG details")

                    
                    url = f"https://rag-prod.studio.lyzr.ai/v3/rag/documents/{rag_id}"
                    
                    try:
                        response = requests.get(url, headers=headers)
                        response.raise_for_status()
                        data = response.json()
                        # Adjust based on actual response structure; assuming {'documents': [...]}
                        count = len(data.get('documents', [])) if isinstance(data, dict) else len(data) if isinstance(data, list) else 0
                        rag_data['document_count'] = count
                    except (requests.HTTPError, ValueError) as e:
                        # Skip or log error for this rag_id; continue with others
                        rag_data['document_count'] = 0  # Default count if error occurs

                   
                    
                    # if rag_name and len(rag_name) > 4:
                        # rag_name = rag_name[:-4]
                    
                    enabled = bool(rag_id and rag_name)

                    
                    self.kb_collection.find_one({"_id": rag_id})
                    if rag_id:
                        self.kb_collection.update_one(
                                {"_id": rag_id},
                                {"$set": {
                                    "_id": rag_id,
                                    "rag_id": rag_id,
                                    "collection_name": rag_name,
                                    "user_id":api_kg_id,
                                    "config": rag_data
                                }},
                                upsert=True
                            )
                        
                        
                        knowledge_store = {
                            "id": rag_id,
                            "name": rag_name,
                            "enabled": enabled
                        }
                        all_knowledege.append(knowledge_store)

            for rg in old_rag_ids:
                if rg not in old_rag:
                    self.kb_collection.delete_one({"rag_id":rg})


            
            mapped_data = {
            "description": agent_data.get("description"),
            "agent_prompt": agent_data.get("agent_instructions"),
            "agent_role": agent_data.get("agent_role"),   
            "agent_goal": agent_data.get("agent_goal"),
            "ref_output": agent_data.get('response_format', ''),
            "example":agent_data.get('examples', ''),             
            "model": agent_data.get("model"),
            "knowledge_store_id": knowledge_store["id"],
            "knowledge_store": all_knowledege,
            "agent_evals":agent_evals,
        
        }

        
        
        else:
         
            mapped_data = {
            "description": agent_data.get("description"),
            "agent_prompt": agent_data.get("agent_instructions"),
            "agent_role": agent_data.get("agent_role"),   
            "agent_goal": agent_data.get("agent_goal"), 
            "ref_output": agent_data.get('response_format', ''),
            "example":agent_data.get('examples', ''), 
            "model": agent_data.get("model"),
            "agent_evals":agent_evals,
            "knowledge_store": [],
            
        
        }
       
      
        result = self.agent_agency_mapping_collection.find({"agent_id":agent_id,"status":"active"},{"_id":0,"agency_id":1})
      
        # teams = []
        # if result:
        #     for res in result:
        #         team = self.agency_collection.find_one({"agency_id":res.get("agency_id")},{"_id":0,"assigned_to":1})
        #         teams.append(team)

        teams = set()  # Use a set to ensure uniqueness
        if result:
            for res in result:
                agency_id = res.get("agency_id")
                agency = self.agency_collection.find_one(
                    {"agency_id": agency_id},
                    {"_id": 0, "assigned_to": 1}
                )
                if agency and "assigned_to" in agency:
                    assigned_to = agency["assigned_to"]
                    print("ass",assigned_to)
                    # Handle both single value or list
                    if isinstance(assigned_to, list):
                        teams.update(assigned_to)
                    else:
                        teams.add(assigned_to)

        # Convert back to list if needed
        teams = list(teams)
       
                

        team_projects_map = {}
        seen_projects = set()  # Track projects already assigned to avoid duplicates

        if teams:
            for team in teams:
                # print("te",team.get("assigned_to"))
                # team_name = team.get("assigned_to") if isinstance(team, dict) else team
                # if not team_name:
                    # continue
                    
                # team_name = (team or "").strip()
                # if not team_name:
                    # continue
                # print(team_name.title())

                # Get all projects for this team
                cursor = self.project.find(
                    {"teams.teamName": team},
                    {"_id": 0, "projectName": 1}
                )

                # Collect project names not yet seen
                project_names = []
                for proj in cursor:
                    pname = proj.get("projectName")
                   
                    if pname and pname not in seen_projects:
                        project_names.append(pname)
                        seen_projects.add(pname)

                if project_names:
                    team_projects_map[team] = project_names

        for seen_project in seen_projects:
            user_type = self.project.find_one(
                {"projectName": seen_project}, {"_id": 0, "database_name": 1})
            
            if user_type:
                user_db = user_type.get("database_name")
                
                # Get current knowledge_store entries linked to this agent
                all_ids = self.agent_collection.find(
                    {"agent_id": agent_id},
                    {"_id": 0, "knowledge_store": 1}
                )
                rag_ids = all_ids.distinct("knowledge_store.id")   # list of current rag_ids

                processed_rag_ids = set()   # we'll track which ones we actually handled

                if rag_ids:
                    for rag_id in rag_ids:
                        rag_data = self.kb_collection.find_one({"_id": rag_id})
                        if rag_data:
                            rag_data.pop("_id", None)
                        rag_name = rag_data.get("collection_name") if rag_data else None
                      
                        
                        # Option A: You already have rag_data somewhere in scope
                        #           (most common case in agent-update flows)
                        # If you don't — you'll need to fetch it like in your second example
                        
                        # Assuming rag_data, rag_name, api_kg_id are already available here
                        # (adjust variable names according to your real context)
                        
                        find_op = {
                            'type': 'find_one',
                            'filter': {"_id": rag_id}
                        }
                        existing = self._query_db('kb_collection', find_op, user_type=user_db)

                        # Prepare the document we want to upsert
                        kb_doc = {
                            "_id": rag_id,
                            "rag_id": rag_id,
                            "collection_name": rag_name,
                            "user_id": api_kg_id,
                            "description": "KG",           # or make dynamic if needed
                            "config": rag_data,
                            # you can add more fields like: "document_count", "enabled", "updated_at", etc.
                        }

                        # Upsert (insert if not exists, update if exists)
                        update_op = {
                            'type': 'update_one',
                            'filter': {"_id": rag_id},
                            'update': {"$set": kb_doc},
                            'upsert': True
                        }
                        self._query_db('kb_collection', update_op, user_type=user_db)

                        processed_rag_ids.add(rag_id)

                # Optional: Clean up orphaned knowledge base entries
                # (ones that were previously linked to this agent but no longer are)
                if rag_ids:  # only run cleanup if there were any before
                    for old_rag_id in rag_ids:
                        if old_rag_id not in processed_rag_ids:
                            delete_op = {
                                'type': 'delete_one',
                                'filter': {"rag_id": old_rag_id}   # or {"_id": old_rag_id}
                            }
                            self._query_db('kb_collection', delete_op, user_type=user_db)
                        
                    
                
                

                update_op ={
                    'type': 'update_one',
                    'filter': {"agent_id": agent_id},
                    'update': {"$set": mapped_data}
                }

                self._query_db('agent', update_op,user_db)

       
        return mapped_data
         
    def _get_external_agent_data(self, agent_data):
        
        if isinstance(agent_data, list):
            if not agent_data:
                return  # or handle empty list
            agent_data = agent_data[0]

        
        knowledge_store = {"id": None, "name": None, "enabled": False}
        features = agent_data.get("features", [])
        api_kg_id = agent_data.get("api_key","")
        agent_new_id = agent_data.get("_id","")
        user_id = agent_data.get("user_id","")
        
        LYZR_BASE_URL = "https://agent-prod.studio.lyzr.ai/v3"
        headers = {"x-api-key": api_kg_id, "Content-Type": "application/json"}

        url = f"{LYZR_BASE_URL}/agent_eval/result/agent"
        resp = requests.get(url, headers=headers, params={"agent_id": agent_new_id}, timeout=120)
        agent_evals=[]
        if resp.status_code == 200:
            results = resp.json()  
            if results:
                for run in results:
                    if not isinstance(run, dict):
                        continue

                    run_name = run.get("run_name","")
                    agent_eval_id = run.get("agent_eval_id","")
                    agent_evals.append(agent_eval_id)
                    run.pop("_id", None)
                    if not agent_eval_id:
                        continue

                    run["fetched_at"] = self.utils.get_current_timestamp()
                    
                    self.agent_eval_collection.update_one(
                        {"run_name": run_name}, 
                        {"$set": run},
                        upsert=True
                       
                    )
        
        if agent_new_id:
            print("agent_new_id",agent_new_id)
            all_kg_ids = []
            agents_data= self.agent_collection.find_one({"api_agent_id":agent_new_id})
            if agents_data is None:
                agents_data = self.agent_collection.find_one({"agent_id": agent_new_id})
            print("agent_data",agents_data)
            kg_store= agents_data.get("knowledge_store","")
            agent_id= agents_data.get("agent_id","")
            if kg_store in (None, "", [], False):  # treat all these as "no stores"
                print("knowledge_store is empty/missing/null → skipping deletion")
            elif isinstance(kg_store, str):
                print(f"knowledge_store is a STRING (probably stringified dict): {kg_store!r}")
                # Optional: try to recover it
                try:
                    import ast
                    recovered = ast.literal_eval(kg_store)  # safe alternative to eval
                    if isinstance(recovered, dict):
                        if recovered.get("id") is not None:
                            all_kg_ids = [recovered["id"]]
                        print("Recovered single dict → using its id")
                    elif isinstance(recovered, list):
                        print("Recovered list from string → using it")
                        all_kg_ids = [d["id"] for d in recovered if isinstance(d, dict) and "id" in d]
                except (ValueError, SyntaxError):
                    print("Could not parse the stringified knowledge_store")
            elif isinstance(kg_store, dict):
                # ← this is your current case: single dict instead of list
                print("knowledge_store is a single dict instead of list → treating as one entry")
                if kg_store.get("id") is not None:
                    all_kg_ids = [kg_store["id"]]
            elif isinstance(kg_store, list):
                # normal happy path
                all_kg_ids = [
                    item["id"]
                    for item in kg_store
                    if isinstance(item, dict) and item.get("id") is not None
                ]
            else:
                print(f"Unexpected type for knowledge_store: {type(kg_store)!r}")

            print("Final kg ids to delete:", all_kg_ids)

            for kg_id in all_kg_ids:
                if kg_id:  # skip None, "", etc.
                    result = self.kb_collection.delete_one({"rag_id": kg_id})
                    print(f"Deleted knowledge base: {result.deleted_count}")
                
           
        all_knowledege = []
        if features:
            for feature in features:
                 
                if feature.get("type") == "KNOWLEDGE_BASE":
                    # 1. Fetch rag_config from either source
                    rag_config = feature.get("config", {}).get("lyzr_rag", {})
                    if not rag_config:
                        rag_config = feature.get("config", {}).get("agentic_rag", {})
                    
                    # 2. Normalize to list for uniform iteration
                    if isinstance(rag_config, dict):
                        rag_items = [rag_config] if rag_config else []
                    elif isinstance(rag_config, list):
                        rag_items = rag_config
                    else:
                        rag_items = []
                    
                    # Extract unique rag_ids to process (avoids duplicates)
                    rag_entries = []
                    seen_ids = set()
                    for item in rag_items:
                        if not isinstance(item, dict):
                            continue
                        rid = item.get("rag_id")
                        if rid and rid not in seen_ids:
                            seen_ids.add(rid)
                            rag_entries.append(item)
                    
                    if not rag_entries:
                        print("⚠️ No valid RAG configs to process")
                    else:
                        print(f"🔍 Processing {len(rag_entries)} unique RAG config(s)")
                        
                        # 3. 🎯 SINGLE API CALL: Fetch all user RAG configs once
                        rag_url = f"https://rag-prod.studio.lyzr.ai/v3/rag/user/{api_kg_id}"
                        user_configs_lookup = {}  # {rag_id: config_dict}
                        
                        try:
                            response = requests.get(rag_url, headers=headers, timeout=120)
                            response.raise_for_status()
                            configs = response.json()
                            
                            if isinstance(configs, dict) and "configs" in configs:
                                configs = configs["configs"]
                            
                            if isinstance(configs, list):
                                for cfg in configs:
                                    cid = cfg.get("rag_id") or cfg.get("_id") or cfg.get("id")
                                    if cid:
                                        user_configs_lookup[cid] = cfg
                            print(f"✅ Fetched {len(user_configs_lookup)} RAG configs from API")
                        except Exception as e:
                            print(f"❌ Failed to fetch user RAG configs: {e}")
                            user_configs_lookup = {}  # Fallback to config-only data
                        
                        # 4. Prepare for parallel document count fetches (optional optimization)
                        from concurrent.futures import ThreadPoolExecutor, as_completed
                        
                        def fetch_doc_count(rid):
                            """Helper to fetch document count for a single rag_id"""
                            doc_url = f"https://rag-prod.studio.lyzr.ai/v3/rag/documents/{rid}"
                            try:
                                resp = requests.get(doc_url, headers=headers, timeout=60)
                                resp.raise_for_status()
                                data = resp.json()
                                if isinstance(data, dict):
                                    return len(data.get('documents', []))
                                elif isinstance(data, list):
                                    return len(data)
                            except Exception:
                                pass
                            return 0  # Default on error
                        
                        # 5. Process each RAG config
                        for item in rag_entries:
                            rag_id = item.get("rag_id")
                            rag_name = item.get("rag_name")
                            
                            # Enrich from API lookup if available
                            if rag_id in user_configs_lookup:
                                api_cfg = user_configs_lookup[rag_id]
                                # Prefer API name if present
                                api_name = api_cfg.get("rag_name") or api_cfg.get("name")
                                if api_name:
                                    rag_name = api_name
                                # Merge API config data (config takes precedence for conflicts)
                                rag_data = {**api_cfg, **item}
                            else:
                                rag_data = item.copy()
                            
                            # Apply truncation logic consistently
                            # if rag_name and isinstance(rag_name, str) and len(rag_name) > 4:
                                # rag_name = rag_name[:-4]
                            
                            if not rag_id:
                                continue
                            
                            print(f"🔄 Processing rag_id: {rag_id}, rag_name: {rag_name}")
                            
                            # 6. Fetch document count (parallelized)
                            doc_count = fetch_doc_count(rag_id)
                            rag_data['document_count'] = doc_count
                            
                            # 7. Determine enabled status
                            enabled = bool(rag_id and rag_name)
                            
                            # 8. Upsert to MongoDB
                            self.kb_collection.update_one(
                                {"rag_id": rag_id},
                                {"$set": {
                                    "rag_id": rag_id,
                                    "collection_name": rag_name,
                                    "user_id": api_kg_id,
                                    "config": rag_data,
                                    "enabled": enabled,
                                    "last_updated": datetime.utcnow()
                                }},
                                upsert=True
                            )
                            
                            # 9. Append to knowledge_store list
                            knowledge_store = {
                                "id": rag_id,
                                "name": rag_name,
                                "enabled": enabled,
                                "document_count": doc_count
                            }
                            all_knowledege.append(knowledge_store)
                        
                        print(f"✅ Successfully processed {len(all_knowledege)} RAG(s)")
  
            mapped_data = {
            "description": agent_data.get("description"),
            "agent_prompt": agent_data.get("agent_instructions"),
            "agent_role": agent_data.get("agent_role"),   
            "agent_goal": agent_data.get("agent_goal"),
            "ref_output": agent_data.get('response_format', ''),
            "example":agent_data.get('examples', ''),             
            "model": agent_data.get("model"),
          
            "knowledge_store": all_knowledege,
            "knowledge_store_id":  all_knowledege[-1]["id"] if all_knowledege else None,
            "agent_evals":agent_evals,
        
        }

        else:
         
            mapped_data = {
            "description": agent_data.get("description"),
            "agent_prompt": agent_data.get("agent_instructions"),
            "agent_role": agent_data.get("agent_role"),   
            "agent_goal": agent_data.get("agent_goal"), 
            "ref_output": agent_data.get('response_format', ''),
            "example":agent_data.get('examples', ''), 
            "model": agent_data.get("model"),
            "agent_evals":agent_evals,
            "knowledge_store": [],
            "knowledge_store_id":""
            
        }
        
        result = self.agent_agency_mapping_collection.find({"agent_id":agent_id,"status":"active"},{"_id":0,"agency_id":1})

        teams = set()  # Use a set to ensure uniqueness
        if result:
            for res in result:
                agency_id = res.get("agency_id")
                agency = self.agency_collection.find_one(
                    {"agency_id": agency_id},
                    {"_id": 0, "assigned_to": 1}
                )
                if agency and "assigned_to" in agency:
                    assigned_to = agency["assigned_to"]
                    print("ass",assigned_to)
                    # Handle both single value or list
                    if isinstance(assigned_to, list):
                        teams.update(assigned_to)
                    else:
                        teams.add(assigned_to)

        # Convert back to list if needed
        teams = list(teams)
       
        team_projects_map = {}
        seen_projects = set()  # Track projects already assigned to avoid duplicates

        if teams:
            for team in teams:
                # Get all projects for this team
                cursor = self.project.find(
                    {"teams.teamName": team},
                    {"_id": 0, "projectName": 1}
                )

                # Collect project names not yet seen
                project_names = []
                for proj in cursor:
                    pname = proj.get("projectName")
                   
                    if pname and pname not in seen_projects:
                        project_names.append(pname)
                        seen_projects.add(pname)

                if project_names:
                    team_projects_map[team] = project_names

        for seen_project in seen_projects:
            user_type = self.project.find_one(
                {"projectName": seen_project}, {"_id": 0, "database_name": 1})
            
            if user_type:
                user_db = user_type.get("database_name")
                find_op={
                    'type': 'find_one',
                    'filter': {"_id": agent_new_id},
                    'projection': {"_id": 0, "knowledge_store": 1}
                }
                existing = self._query_db('agent', find_op, user_type=user_db)

                all_kg_ids = [d["id"] for d in existing.get("knowledge_store", [])] if existing else []
                for kg_id in all_kg_ids:
                    delete_op = {
                                'type': 'delete_one',
                                'filter': {"rag_id": kg_id}   # or {"_id": old_rag_id}
                            }
                    self._query_db('kb_collection', delete_op, user_type=user_db)
                
                # Get current knowledge_store entries linked to this agent
                all_ids = self.agent_collection.find(
                    {"agent_id": agent_new_id},
                    {"_id": 0, "knowledge_store": 1}
                )
                rag_ids = all_ids.distinct("knowledge_store.id") 

                

                processed_rag_ids = set()   # we'll track which ones we actually handled

                if rag_ids:

                    for rag_id in set(rag_ids):  # at least remove input duplicates
                        rag_data = self.kb_collection.find_one({"rag_id": rag_id})
                        if not rag_data:
                            continue

                        rag_data.pop("_id", None)           # almost always do this

                        # Optional: prevent duplicate by business key
                        existing = self._query_db('kb_collection', {
                            'type': 'find_one',
                            'filter': {'collection_name': rag_data['collection_name']}
                        }, user_type=user_db)

                        if existing:
                            print(f"Skipping duplicate collection_name: {rag_data['collection_name']}")
                            continue

                        insert_op = {'type': 'insert_one', 'document': rag_data}
                    
                        self._query_db('kb_collection', insert_op, user_type=user_db)

                        processed_rag_ids.add(rag_id)

                #
                    # Optional: Clean up orphaned knowledge base entries

                update_op ={
                    'type': 'update_one',
                    'filter': {"agent_id": agent_new_id},
                    'update': {"$set": mapped_data}
                }

                self._query_db('agent', update_op,user_db)

       
        return mapped_data

    def _get_external_voice_agent_data(self, agent_data):
        
        if isinstance(agent_data, list):
            if not agent_data:
                return  # or handle empty list
            agent_data = agent_data[0]

        
        # knowledge_store = {"id": None, "name": None, "enabled": False}
        # features = agent_data.get("features", [])
        # api_kg_id = agent_data.get("api_key","")
        # agent_new_id = agent_data.get("_id","")
        # user_id = agent_data.get("user_id","")
        
        # LYZR_BASE_URL = "https://agent-prod.studio.lyzr.ai/v3"
        # headers = {"x-api-key": api_kg_id, "Content-Type": "application/json"}

        # url = f"{LYZR_BASE_URL}/agent_eval/result/agent"
        # resp = requests.get(url, headers=headers, params={"agent_id": agent_new_id}, timeout=120)
        # agent_evals=[]
        # if resp.status_code == 200:
        #     results = resp.json()  
        #     if results:
        #         for run in results:
        #             if not isinstance(run, dict):
        #                 continue

        #             run_name = run.get("run_name","")
        #             agent_eval_id = run.get("agent_eval_id","")
        #             agent_evals.append(agent_eval_id)
        #             run.pop("_id", None)
        #             if not agent_eval_id:
        #                 continue

        #             run["fetched_at"] = self.utils.get_current_timestamp()
                    
        #             self.agent_eval_collection.update_one(
        #                 {"run_name": run_name}, 
        #                 {"$set": run},
        #                 upsert=True
                       
        #             )
        
        # if agent_new_id:
        #     print("agent_new_id",agent_new_id)
        #     all_kg_ids = []
        #     agents_data= self.agent_collection.find_one({"api_agent_id":agent_new_id})
        #     if agents_data is None:
        #         agents_data = self.agent_collection.find_one({"agent_id": agent_new_id})
        #     print("agent_data",agents_data)
        #     kg_store= agents_data.get("knowledge_store","")
        #     agent_id= agents_data.get("agent_id","")
        #     if kg_store in (None, "", [], False):  # treat all these as "no stores"
        #         print("knowledge_store is empty/missing/null → skipping deletion")
        #     elif isinstance(kg_store, str):
        #         print(f"knowledge_store is a STRING (probably stringified dict): {kg_store!r}")
        #         # Optional: try to recover it
        #         try:
        #             import ast
        #             recovered = ast.literal_eval(kg_store)  # safe alternative to eval
        #             if isinstance(recovered, dict):
        #                 if recovered.get("id") is not None:
        #                     all_kg_ids = [recovered["id"]]
        #                 print("Recovered single dict → using its id")
        #             elif isinstance(recovered, list):
        #                 print("Recovered list from string → using it")
        #                 all_kg_ids = [d["id"] for d in recovered if isinstance(d, dict) and "id" in d]
        #         except (ValueError, SyntaxError):
        #             print("Could not parse the stringified knowledge_store")
        #     elif isinstance(kg_store, dict):
        #         # ← this is your current case: single dict instead of list
        #         print("knowledge_store is a single dict instead of list → treating as one entry")
        #         if kg_store.get("id") is not None:
        #             all_kg_ids = [kg_store["id"]]
        #     elif isinstance(kg_store, list):
        #         # normal happy path
        #         all_kg_ids = [
        #             item["id"]
        #             for item in kg_store
        #             if isinstance(item, dict) and item.get("id") is not None
        #         ]
        #     else:
        #         print(f"Unexpected type for knowledge_store: {type(kg_store)!r}")

        #     print("Final kg ids to delete:", all_kg_ids)

        #     for kg_id in all_kg_ids:
        #         if kg_id:  # skip None, "", etc.
        #             result = self.kb_collection.delete_one({"rag_id": kg_id})
        #             print(f"Deleted knowledge base: {result.deleted_count}")
                
           
        # all_knowledege = []
        # if features:
        #     for feature in features:
                 
        #         if feature.get("type") == "KNOWLEDGE_BASE":
        #             # 1. Fetch rag_config from either source
        #             rag_config = feature.get("config", {}).get("lyzr_rag", {})
        #             if not rag_config:
        #                 rag_config = feature.get("config", {}).get("agentic_rag", {})
                    
        #             # 2. Normalize to list for uniform iteration
        #             if isinstance(rag_config, dict):
        #                 rag_items = [rag_config] if rag_config else []
        #             elif isinstance(rag_config, list):
        #                 rag_items = rag_config
        #             else:
        #                 rag_items = []
                    
        #             # Extract unique rag_ids to process (avoids duplicates)
        #             rag_entries = []
        #             seen_ids = set()
        #             for item in rag_items:
        #                 if not isinstance(item, dict):
        #                     continue
        #                 rid = item.get("rag_id")
        #                 if rid and rid not in seen_ids:
        #                     seen_ids.add(rid)
        #                     rag_entries.append(item)
                    
        #             if not rag_entries:
        #                 print("⚠️ No valid RAG configs to process")
        #             else:
        #                 print(f"🔍 Processing {len(rag_entries)} unique RAG config(s)")
                        
        #                 # 3. 🎯 SINGLE API CALL: Fetch all user RAG configs once
        #                 rag_url = f"https://rag-prod.studio.lyzr.ai/v3/rag/user/{api_kg_id}"
        #                 user_configs_lookup = {}  # {rag_id: config_dict}
                        
        #                 try:
        #                     response = requests.get(rag_url, headers=headers, timeout=120)
        #                     response.raise_for_status()
        #                     configs = response.json()
                            
        #                     if isinstance(configs, dict) and "configs" in configs:
        #                         configs = configs["configs"]
                            
        #                     if isinstance(configs, list):
        #                         for cfg in configs:
        #                             cid = cfg.get("rag_id") or cfg.get("_id") or cfg.get("id")
        #                             if cid:
        #                                 user_configs_lookup[cid] = cfg
        #                     print(f"✅ Fetched {len(user_configs_lookup)} RAG configs from API")
        #                 except Exception as e:
        #                     print(f"❌ Failed to fetch user RAG configs: {e}")
        #                     user_configs_lookup = {}  # Fallback to config-only data
                        
        #                 # 4. Prepare for parallel document count fetches (optional optimization)
        #                 from concurrent.futures import ThreadPoolExecutor, as_completed
                        
        #                 def fetch_doc_count(rid):
        #                     """Helper to fetch document count for a single rag_id"""
        #                     doc_url = f"https://rag-prod.studio.lyzr.ai/v3/rag/documents/{rid}"
        #                     try:
        #                         resp = requests.get(doc_url, headers=headers, timeout=60)
        #                         resp.raise_for_status()
        #                         data = resp.json()
        #                         if isinstance(data, dict):
        #                             return len(data.get('documents', []))
        #                         elif isinstance(data, list):
        #                             return len(data)
        #                     except Exception:
        #                         pass
        #                     return 0  # Default on error
                        
        #                 # 5. Process each RAG config
        #                 for item in rag_entries:
        #                     rag_id = item.get("rag_id")
        #                     rag_name = item.get("rag_name")
                            
        #                     # Enrich from API lookup if available
        #                     if rag_id in user_configs_lookup:
        #                         api_cfg = user_configs_lookup[rag_id]
        #                         # Prefer API name if present
        #                         api_name = api_cfg.get("rag_name") or api_cfg.get("name")
        #                         if api_name:
        #                             rag_name = api_name
        #                         # Merge API config data (config takes precedence for conflicts)
        #                         rag_data = {**api_cfg, **item}
        #                     else:
        #                         rag_data = item.copy()
                            
        #                     # Apply truncation logic consistently
        #                     # if rag_name and isinstance(rag_name, str) and len(rag_name) > 4:
        #                         # rag_name = rag_name[:-4]
                            
        #                     if not rag_id:
        #                         continue
                            
        #                     print(f"🔄 Processing rag_id: {rag_id}, rag_name: {rag_name}")
                            
        #                     # 6. Fetch document count (parallelized)
        #                     doc_count = fetch_doc_count(rag_id)
        #                     rag_data['document_count'] = doc_count
                            
        #                     # 7. Determine enabled status
        #                     enabled = bool(rag_id and rag_name)
                            
        #                     # 8. Upsert to MongoDB
        #                     self.kb_collection.update_one(
        #                         {"rag_id": rag_id},
        #                         {"$set": {
        #                             "rag_id": rag_id,
        #                             "collection_name": rag_name,
        #                             "user_id": api_kg_id,
        #                             "config": rag_data,
        #                             "enabled": enabled,
        #                             "last_updated": datetime.utcnow()
        #                         }},
        #                         upsert=True
        #                     )
                            
        #                     # 9. Append to knowledge_store list
        #                     knowledge_store = {
        #                         "id": rag_id,
        #                         "name": rag_name,
        #                         "enabled": enabled,
        #                         "document_count": doc_count
        #                     }
        #                     all_knowledege.append(knowledge_store)
                        
        #                 print(f"✅ Successfully processed {len(all_knowledege)} RAG(s)")
  
        #     mapped_data = {
        #     "description": agent_data.get("description"),
        #     "agent_prompt": agent_data.get("agent_instructions"),
        #     "agent_role": agent_data.get("agent_role"),   
        #     "agent_goal": agent_data.get("agent_goal"),
        #     "ref_output": agent_data.get('response_format', ''),
        #     "example":agent_data.get('examples', ''),             
        #     "model": agent_data.get("model"),
          
        #     "knowledge_store": all_knowledege,
        #     "knowledge_store_id":  all_knowledege[-1]["id"] if all_knowledege else None,
        #     "agent_evals":agent_evals,
        
        # }

        # else:
         
        agent_info = agent_data.get("agent", {})
        config = agent_info.get("config", {})
        
        # 2. Extract agent_id from the JSON, fallback to payload if missing
        agent_new_id = agent_info.get("id",'').strip()
        
        mapped_data = {
            
            
           
            "description": config.get("agent_description", ""),       # Fixed: Key is "agent_description"
            "agent_role": config.get("agent_role", ""),               
            "agent_goal": config.get("agent_goal", ""), 
            "agent_prompt": config.get("agent_instructions", ""),
            "ref_output": config.get("response_format", ""),
            "example": config.get("examples", ""),            
            
            # Fixed: Model is nested under config["engine"]["llm"]
            "model": config.get("engine", {}).get("llm", ""),

            "tools":[action for tool in config.get("lyzr_tools", []) for action in tool.get("action_names", [])]
           
        }
        
        result = self.agent_agency_mapping_collection.find({"agent_id":agent_new_id,"status":"active"},{"_id":0,"agency_id":1})

        teams = set()  # Use a set to ensure uniqueness
        if result:
            for res in result:
                agency_id = res.get("agency_id")
                agency = self.agency_collection.find_one(
                    {"agency_id": agency_id},
                    {"_id": 0, "assigned_to": 1}
                )
                if agency and "assigned_to" in agency:
                    assigned_to = agency["assigned_to"]
                    print("ass",assigned_to)
                    # Handle both single value or list
                    if isinstance(assigned_to, list):
                        teams.update(assigned_to)
                    else:
                        teams.add(assigned_to)

        # Convert back to list if needed
        teams = list(teams)
       
        team_projects_map = {}
        seen_projects = set()  # Track projects already assigned to avoid duplicates

        if teams:
            for team in teams:
                # Get all projects for this team
                cursor = self.project.find(
                    {"teams.teamName": team},
                    {"_id": 0, "projectName": 1}
                )

                # Collect project names not yet seen
                project_names = []
                for proj in cursor:
                    pname = proj.get("projectName")
                   
                    if pname and pname not in seen_projects:
                        project_names.append(pname)
                        seen_projects.add(pname)

                if project_names:
                    team_projects_map[team] = project_names

        for seen_project in seen_projects:
            user_type = self.project.find_one(
                {"projectName": seen_project}, {"_id": 0, "database_name": 1})
            
            if user_type:
                user_db = user_type.get("database_name")
                find_op={
                    'type': 'find_one',
                    'filter': {"_id": agent_new_id},
                    'projection': {"_id": 0, "knowledge_store": 1}
                }
                existing = self._query_db('agent', find_op, user_type=user_db)

                all_kg_ids = [d["id"] for d in existing.get("knowledge_store", [])] if existing else []
                for kg_id in all_kg_ids:
                    delete_op = {
                                'type': 'delete_one',
                                'filter': {"rag_id": kg_id}   # or {"_id": old_rag_id}
                            }
                    self._query_db('kb_collection', delete_op, user_type=user_db)
                
                # Get current knowledge_store entries linked to this agent
                all_ids = self.agent_collection.find(
                    {"agent_id": agent_new_id},
                    {"_id": 0, "knowledge_store": 1}
                )
                rag_ids = all_ids.distinct("knowledge_store.id") 

                

                processed_rag_ids = set()   # we'll track which ones we actually handled

                if rag_ids:

                    for rag_id in set(rag_ids):  # at least remove input duplicates
                        rag_data = self.kb_collection.find_one({"rag_id": rag_id})
                        if not rag_data:
                            continue

                        rag_data.pop("_id", None)           # almost always do this

                        # Optional: prevent duplicate by business key
                        existing = self._query_db('kb_collection', {
                            'type': 'find_one',
                            'filter': {'collection_name': rag_data['collection_name']}
                        }, user_type=user_db)

                        if existing:
                            print(f"Skipping duplicate collection_name: {rag_data['collection_name']}")
                            continue

                        insert_op = {'type': 'insert_one', 'document': rag_data}
                    
                        self._query_db('kb_collection', insert_op, user_type=user_db)

                        processed_rag_ids.add(rag_id)

                #
                    # Optional: Clean up orphaned knowledge base entries

                update_op ={
                    'type': 'update_one',
                    'filter': {"agent_id": agent_new_id},
                    'update': {"$set": mapped_data}
                }

                self._query_db('agent', update_op,user_db)

       
        return mapped_data


    def delete_agent_details(self, agent_id):
        find_op = {
            'type': 'find_one',
            'filter': {"_id": ObjectId(agent_id), "$or": [
                {"isDeleted": {"$ne": True}},
                {"isDeleted": {"$exists": False}}
            ]}
       }
        agent = self._query_db('agent', find_op)
        print("agent",agent)
        if not agent:
            return jsonify({"success": False, "message": "Agent not found or already deleted"}), 404
        approved_status = agent.get("Approval_Status","")
        # if agent_provider_type == "new" and approved_status == "Approved":
        mail_data = {
            "agent_id": agent_id,
            "agent_name": agent.get("name", ""),
            "agent_description": agent.get("description", ""),
            "agent_role": agent.get("agent_role", ""),
            "agent_instruction": agent.get("agent_prompt", ""),
            "deletion_description": data.get("reason","")
        }
        to_email = data.get("approver_email","")
        #mail_result = self.user_manager.send_mail_approval(
            #to_email=to_email,
           # to_name="Super Admin",
          #  data=mail_data,
         #   sourcefrom="Delete"
        #)

        
        data = {
            "agent_id": agent_id,
            "status": "Approved",
            "sourcefrom": "Delete"
            }
        self.lyzr_api_manager.approval_api(data)
        # else:
        #     knowledge_store= agent.get("knowledge_store", {})
        #     update_op = {
        #         'type': 'update_one',
        #         'filter': {"_id": ObjectId(agent_id), "$or": [
        #             {"isDeleted": {"$ne": True}},
        #             {"isDeleted": {"$exists": False}}
        #         ]},
        #     'update': {"$set": {"isDeleted": True}}
        #     }
        #     self._query_db('agent', update_op)

        #     for ks in knowledge_store:
        #         rag_id = ks.get("id")
        #         if rag_id:
        #             self._query_db('kb_collection', {
        #                 'type': 'delete_one',
        #                 'filter': {"rag_id": rag_id}
                        
        #             })
  
        return agent
    
    def delete_agent_with_approval_details(self, data):
        print("data",data)
        agent_id = data.get("agent_id","")
        print("agent_id",agent_id)
        find_op = {
            'type': 'find_one',
            'filter': {"_id": ObjectId(agent_id), "$or": [
                {"isDeleted": {"$ne": True}},
                {"isDeleted": {"$exists": False}}
            ]}
       }
        agent = self._query_db('agent', find_op)
        agent_provider_type = agent.get("agent_provider_type","")
        
        if not agent:
            return jsonify({"success": False, "message": "Agent not found or already deleted"}), 404
        approved_status = agent.get("Approval_Status","Approved")
        if approved_status == "Approved" or approved_status == "Rejected":
            mail_data = {
                "agent_id": agent_id,
                "agent_name": agent.get("name", ""),
                "agent_description": agent.get("description", ""),
                "agent_role": agent.get("agent_role", ""),
                "agent_instruction": agent.get("agent_prompt", ""),
                "deletion_description": data.get("reason","")
            }
            to_email = data.get("approver_email","")
            print("to_email",to_email)
            mail_result = self.user_manager.send_mail_approval(
                to_email=to_email,
                to_name="Super Admin",
                data=mail_data,
                sourcefrom="Delete"
            )
            #update_op = {
             #   'type': 'update_one',
              #  'filter': {"_id": ObjectId(agent_id)},
               # 'update': {"$set": {"Approval_Status_Message": "Pending approval for deletion", "Approval_Status": "Pending Approval","deleted_request_email":to_email}}
            #}
            #self._query_db('agent', update_op)
                
            data = {
                "agent_id": agent_id,
                "status": "Approved",
                "sourcefrom": "Delete"
                }
            self.lyzr_api_manager.approval_api(data)
            return "Agent deletion requested successfully"


    def get_features_list_old(self,features,headers,api_kg_id,knowledge_store,old_rag_ids):
        
        rag_data = {}
        all_knowledege = []
        old_rag =[]
        for feature in features:

            if feature.get("type") == "KNOWLEDGE_BASE":

                ragconfig = feature.get("config", {}).get("lyzr_rag", {})
                rag_id = ragconfig.get("rag_id")
                if rag_id in old_rag_ids:
                   old_rag.append(rag_id) 

                rag_name = ragconfig.get("rag_name")
                rag_url = f"https://rag-prod.studio.lyzr.ai/v3/rag/user/{api_kg_id}"
                try:
                    response = requests.get(rag_url, headers=headers, timeout=120)
                    response.raise_for_status()  # raises HTTPError for 4xx/5xx
                    
                    configs = response.json()
                    
                    # Most common cases: list of dicts or {"configs": [...]}
                    if isinstance(configs, dict) and "configs" in configs:
                        configs = configs["configs"]
                    
                    if not isinstance(configs, list):
                        print(f"Unexpected response format: {type(configs)}")
                        return None
                    
                    
                    for config in configs:
                        # Try different possible field names (your sample doesn't have rag_id)
                        candidate_id = config.get("rag_id") or config.get("_id") or config.get("id")
                        if candidate_id == rag_id:
                            rag_data = config
                    
                    print(f"No config found with rag_id = {rag_id}")
                except:
                    print("Failed to fetch RAG details")

                
                url = f"https://rag-prod.studio.lyzr.ai/v3/rag/documents/{rag_id}"
                
                try:
                    response = requests.get(url, headers=headers)
                    response.raise_for_status()
                    data = response.json()
                    # Adjust based on actual response structure; assuming {'documents': [...]}
                    count = len(data.get('documents', [])) if isinstance(data, dict) else len(data) if isinstance(data, list) else 0
                    rag_data['document_count'] = count
                except (requests.HTTPError, ValueError) as e:
                    # Skip or log error for this rag_id; continue with others
                    rag_data['document_count'] = 0  # Default count if error occurs

                
                
                # if rag_name and len(rag_name) > 4:
                    # rag_name = rag_name[:-4]
                
                enabled = bool(rag_id and rag_name)

                
                self.kb_collection.find_one({"_id": rag_id})
                if rag_id:
                    self.kb_collection.update_one(
                            {"_id": rag_id},
                            {"$set": {
                                "_id": rag_id,
                                "rag_id": rag_id,
                                "collection_name": rag_name,
                                "user_id":api_kg_id,
                                "config": rag_data
                            }},
                            upsert=True
                        )
                    
                    
                    knowledge_store = {
                        "id": rag_id,
                        "name": rag_name,
                        "enabled": enabled
                    }
                    all_knowledege.append(knowledge_store)

        return all_knowledege, knowledge_store,old_rag
            
    def get_features_list(self,features,headers,api_kg_id,knowledge_store,old_rag_ids):
        
        rag_data = {}
        all_knowledege = []
        old_rag =[]
                
        for feature in features:

            if feature.get("type") == "KNOWLEDGE_BASE":
                    # 1. Fetch rag_config from either source
                    rag_config = feature.get("config", {}).get("lyzr_rag", {})
                    if not rag_config:
                        rag_config = feature.get("config", {}).get("agentic_rag", {})
                    
                    # 2. Normalize to list for uniform iteration
                    if isinstance(rag_config, dict):
                        rag_items = [rag_config] if rag_config else []
                    elif isinstance(rag_config, list):
                        rag_items = rag_config
                    else:
                        rag_items = []
                    
                    # Extract unique rag_ids to process (avoids duplicates)
                    rag_entries = []
                    seen_ids = set()
                    for item in rag_items:
                        if not isinstance(item, dict):
                            continue
                        rid = item.get("rag_id")
                        if rid and rid not in seen_ids:
                            seen_ids.add(rid)
                            rag_entries.append(item)
                            if item.get("rag_id") in old_rag_ids:
                                old_rag.append(item.get("rag_id"))
                    
                    if not rag_entries:
                        print("⚠️ No valid RAG configs to process")
                    else:
                        print(f"🔍 Processing {len(rag_entries)} unique RAG config(s)")
                        
                        # 3. 🎯 SINGLE API CALL: Fetch all user RAG configs once
                        rag_url = f"https://rag-prod.studio.lyzr.ai/v3/rag/user/{api_kg_id}"
                        user_configs_lookup = {}  # {rag_id: config_dict}
                        
                        try:
                            response = requests.get(rag_url, headers=headers, timeout=120)
                            response.raise_for_status()
                            configs = response.json()
                            
                            if isinstance(configs, dict) and "configs" in configs:
                                configs = configs["configs"]
                            
                            if isinstance(configs, list):
                                for cfg in configs:
                                    cid = cfg.get("rag_id") or cfg.get("_id") or cfg.get("id")
                                    if cid:
                                        user_configs_lookup[cid] = cfg
                            print(f"✅ Fetched {len(user_configs_lookup)} RAG configs from API")
                        except Exception as e:
                            print(f"❌ Failed to fetch user RAG configs: {e}")
                            user_configs_lookup = {}  # Fallback to config-only data
                        
                        # 4. Prepare for parallel document count fetches (optional optimization)
                        from concurrent.futures import ThreadPoolExecutor, as_completed
                        
                        def fetch_doc_count(rid):
                            """Helper to fetch document count for a single rag_id"""
                            doc_url = f"https://rag-prod.studio.lyzr.ai/v3/rag/documents/{rid}"
                            try:
                                resp = requests.get(doc_url, headers=headers, timeout=60)
                                resp.raise_for_status()
                                data = resp.json()
                                if isinstance(data, dict):
                                    return len(data.get('documents', []))
                                elif isinstance(data, list):
                                    return len(data)
                            except Exception:
                                pass
                            return 0  # Default on error
                        
                        # 5. Process each RAG config
                        for item in rag_entries:
                            rag_id = item.get("rag_id")
                            rag_name = item.get("rag_name")
                            
                            # Enrich from API lookup if available
                            if rag_id in user_configs_lookup:
                                api_cfg = user_configs_lookup[rag_id]
                                # Prefer API name if present
                                api_name = api_cfg.get("rag_name") or api_cfg.get("name")
                                if api_name:
                                    rag_name = api_name
                                # Merge API config data (config takes precedence for conflicts)
                                rag_data = {**api_cfg, **item}
                            else:
                                rag_data = item.copy()
                            
                            # Apply truncation logic consistently
                            # if rag_name and isinstance(rag_name, str) and len(rag_name) > 4:
                                # rag_name = rag_name[:-4]
                            
                            if not rag_id:
                                continue
                            
                            print(f"🔄 Processing rag_id: {rag_id}, rag_name: {rag_name}")
                            
                            # 6. Fetch document count (parallelized)
                            doc_count = fetch_doc_count(rag_id)
                            rag_data['document_count'] = doc_count
                            
                            # 7. Determine enabled status
                            enabled = bool(rag_id and rag_name)
                            
                            # 8. Upsert to MongoDB
                            self.kb_collection.update_one(
                                {"rag_id": rag_id},
                                {"$set": {
                                    "rag_id": rag_id,
                                    "collection_name": rag_name,
                                    "user_id": api_kg_id,
                                    "config": rag_data,
                                    "enabled": enabled,
                                    "last_updated": datetime.utcnow()
                                }},
                                upsert=True
                            )
                            
                            # 9. Append to knowledge_store list
                            knowledge_store = {
                                "id": rag_id,
                                "name": rag_name,
                                "enabled": enabled,
                                "document_count": doc_count
                            }
                            all_knowledege.append(knowledge_store)
                        
                        print(f"✅ Successfully processed {len(all_knowledege)} RAG(s)")
                
        return all_knowledege, knowledge_store,old_rag


# Global instance for backward compatibility
agent_manager = AgentManager()

# Function wrappers for backward compatibility
def onboard_agent_details(request):
    return agent_manager.onboard_agent_details(request)

def get_all_dropdown_details():
    return agent_manager.get_all_dropdown_details()

def insert_external_agent(request):
    return agent_manager.insert_external_agent(request)

def get_all_agent_details():
    return agent_manager.get_all_agent_details()

def update_agent_manage_details(request, agent_id):
    return agent_manager.update_agent_manage_details(request, agent_id)

def get_agent_details_counts():
    return agent_manager.get_agent_details_counts()

def get_provider_dtls(request):
    return agent_manager.get_provider_dtls(request)

def delete_agent_details(agent_id):
    return agent_manager.delete_agent_details(agent_id)
