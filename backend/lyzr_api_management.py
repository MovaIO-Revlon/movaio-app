from pydantic import ValidationError
from config_loader import ConfigLoader, config_loader
import requests
from commonutils import DatabaseCollections, CommonUtils
from datetime import datetime, timezone, timedelta
from session_manager import get_current_user
from config_loader import config_loader
from database_manager import select_database_by_user_type
import json
from bson import json_util
import re
from bson.objectid import ObjectId
from UserManagement import UserManager

LYZR_API_ENDPOINT = "https://agent-prod.studio.lyzr.ai/v3"
RAGENT_API_ENDPOINT = "https://rag-prod.studio.lyzr.ai/v3"
user_id = config_loader.USER_ID_LYZR
api_key = config_loader.API_KEY_LYZR

class LyzrAPIManagement(DatabaseCollections):
    def __init__(self):
        super().__init__()
        self.config = ConfigLoader()        
        self.utils = CommonUtils()
        self.user_manager = UserManager()

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

    def get_lyzr_tools(self, user_type=None):
        headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        response = requests.get(f"{LYZR_API_ENDPOINT}/tools/all/user", headers=headers)
        if response.status_code == 200:
            return response.json()
        else:
            raise Exception(f"Failed to fetch tools from Lyzr API: {response.detail}")

    def get_lyzr_models(self, user_type=None):
        headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        response = requests.get(f"{LYZR_API_ENDPOINT}/providers/type?provider_type=lyzr-llm", headers=headers)
        # #print(f"Fetching Lyzr models with response status: {response.status_code}")
        if response.status_code == 200:
            # #print(f"Response: {response.json()}")
            return response.json()
        else:
            raise Exception(f"Failed to fetch models from Lyzr API: {response.detail}")
    
    def lyzr_create_tool(self, data,  user_type=None):
        headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        default_body_params = data.get("body_params", {})
        default_headers = data.get("headers", {})
        default_query_params = data.get("query_params", {})
        endpoint_defaults = data.get("endpoint_data", {})
        enhance_descriptions = data.get("enhance_descriptions", False)
        openapi_schema = data.get("openapi_schema", None)
        tool_set_name = data.get("tool_name", "")

        payload = {
            "tool_set_name": tool_set_name,
            "endpoint_defaults": endpoint_defaults,
            "default_body_params": default_body_params,
            "default_headers": default_headers,
            "default_query_params": default_query_params,
            "enhance_descriptions": enhance_descriptions,
            "openapi_schema": openapi_schema,
            "user_id": user_id
        }

        response = requests.post(f"{LYZR_API_ENDPOINT}/tools/", json=payload, headers=headers)
        if response.status_code != 200:
            raise Exception(f"Failed to create tool in Lyzr API: {response.detail}")
        # #print(f"Creating Lyzr tool with response status: {response.json()}")
        return True

    def get_lyzr_knowledge_bases(self, user_type=None):
        headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        response = requests.get(f"{RAGENT_API_ENDPOINT}/rag/user/{api_key}", headers=headers)
        #print(f"Fetching Lyzr knowledge bases with response status: {response.status_code}")
        if response.status_code == 200:
            #print(f"Response: {response.json()}")
            return response.json()
        else:
            raise Exception(f"Failed to fetch knowledge bases from Lyzr API: {response.text}")

    def get_lyzr_provider_memory(self, user_type=None):
        headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        response = requests.get(f"{LYZR_API_ENDPOINT}/providers/type?provider_type=memory", headers=headers)
        #print(f"Fetching Lyzr provider memory with response status: {response.status_code}")
        if response.status_code == 200:
            #print(f"Response: {response.json()}")
            return response.json()
        else:
            raise Exception(f"Failed to fetch provider memory from Lyzr API: {response.text}")
    
    def lyzr_create_agent(self, data, user_type=None):
        headers = {"x-api-key": api_key, "Content-Type": "application/json"}

        response = requests.post(f"{LYZR_API_ENDPOINT}/agents/", json=data, headers=headers)
        if response.status_code == 200:
            #print(f"Creating Lyzr agent with response: {response.json()}")
            return response.json()
        else:
            raise Exception(f"Failed to create Lyzr agent: {response.json()}")

    def lyzr_update_agent(self, agent_id, data, user_type=None):
        headers = {"x-api-key": api_key, "Content-Type": "application/json"}

        response = requests.put(f"{LYZR_API_ENDPOINT}/agents/{agent_id}", json=data, headers=headers)
        if response.status_code == 200:
            #print(f"Updating Lyzr agent with response: {response.json()}")
            return response.json()
        else:
            raise Exception(f"Failed to update Lyzr agent: {response.json()}")


    def get_lyzr_mcp_servers(self, user_type=None):
        headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        response = requests.get(f"{LYZR_API_ENDPOINT}/tools/mcp/servers", headers=headers)
        #print(f"Fetching Lyzr MCP servers with response status: {response.status_code}")
        if response.status_code == 200:
            #print(f"Response: {response.json()}")
            return response.json()
        else:
            raise Exception(f"Failed to fetch MCP servers from Lyzr API: {response.text}")

    def lyzr_create_mcp_server(self, data, user_type=None):
        headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        auth_type = data.get("auth_type", "")
        server_url = data.get("server_url", "")
        name = data.get("name", "")
        description = data.get("description", "")

        payload = {
            "config":{
                "auth_type": auth_type,
                "server_url": server_url
            },
            "name": name,
            "description": description
        }

        response = requests.post(f"{LYZR_API_ENDPOINT}/tools/mcp/servers", json=payload, headers=headers)
        if response.status_code == 200:
            #print(f"Creating Lyzr MCP server with response: {response.json()}")
            return True
        else:
            raise Exception(f"Failed to create MCP server in Lyzr API: {response.text}")

    def lyzr_generate_with_ai(self, data, user_type=None):
        headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        prompt = data.get("prompt", "")
        session_id = data.get("session_id", "")

        payload = {
            "agent_id": "6888b55622df0ab09cfa2cab",
            "message": prompt,
            "session_id": session_id,
            "user_id": user_id
        }

        response = requests.post(f"{LYZR_API_ENDPOINT}/inference/chat/", json=payload, headers=headers)
        if response.status_code == 200:
            # #print(f"Generating with AI in Lyzr API with response: {response.json()}")
            res = response.json()
            result = res.get("response")
            #print(f"Raw result from Lyzr API: {result}")
            if result.startswith("{"):
                #print("Result is JSON, parsing agent instructions...")
                marker = '"agent_instructions": "'
                split_index = result.find(marker)

                prefix_block = result[:split_index].strip().rstrip(',') + '\n}'
                parsed_json_dict = json.loads(prefix_block)

                content_start = split_index + len(marker)
                content_end = result.rfind('"')
                raw_instructions = result[content_start:content_end]

                clean_instructions = raw_instructions.replace('\\\n', '\n')
                parsed_json_dict["agent_instructions"] = clean_instructions

                res["json_response"] = parsed_json_dict
            return res
        else:
            raise Exception(f"Failed to generate with AI in Lyzr API: {response.text}")

    def lyzr_get_context(self, data, user_type=None):
        headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        response = requests.get(f"{LYZR_API_ENDPOINT}/contexts/", headers=headers)
        if response.status_code == 200:
            #print(f"Getting context from Lyzr API with response: {response.json()}")
            return response.json()
        else:
            raise Exception(f"Failed to get context from Lyzr API: {response.text}")

    def lyzr_create_context(self, data, user_type=None):
        headers = {"x-api-key": api_key, "Content-Type": "application/json"}

        response = requests.post(f"{LYZR_API_ENDPOINT}/contexts", json=data, headers=headers)
        if response.status_code == 200:
            #print(f"Creating context in Lyzr API with response: {response.json()}")
            return True
        else:
            raise Exception(f"Failed to create context in Lyzr API: {response.text}")

    def lyzr_delete_agent(self, data, user_type=None):
        headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        agent_id = data.get("agent_id")
        response = requests.delete(f"{LYZR_API_ENDPOINT}/agents/{agent_id}", headers=headers)
        if response.status_code == 200:
            #print(f"Deleting agent in Lyzr API with response: {response.json()}")
            return True
        else:
            raise Exception(f"Failed to delete agent in Lyzr API: {response.text}")

    def lyzr_get_semantic_data(self, user_type=None):
        headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        response = requests.get(f"{RAGENT_API_ENDPOINT}/rag/user/{api_key}/?semantic_data_models=true", headers=headers)
        if response.status_code == 200:
            #print(f"Getting semantic data from Lyzr API with response: {response.json()}")
            return response.json()
        else:
            raise Exception(f"Failed to get semantic data from Lyzr API: {response.text}")

    def send_agent_approval_mail(self, data):
        try:

            # Assuming you have a method to send email using a template
            result = self.user_manager.send_mail_approval(
                to_email="MiteshwariRamlal.Pardeshi@movate.com",
                to_name="Pranav",
                data=data,
                sourcefrom="Onboarding"
            )
            #print(f"Email sending result: {result}")
            return result
        except Exception as ex:
            #print(f"Error in send_agent_approval_mail: {ex}")
            return False

    def approval_api(self, data):
        #print(f"Received approval API call with data: {data}")
        status = data.get("status")
        print(f"Approval status: {status}", f"Source: {data.get('sourcefrom')}", f"Agent ID: {data.get('agent_id')}")
        if status == "Approved":
        
            if data.get("sourcefrom") == "Onboarding":
                agent_id = data.get("agent_id")
                agent_details = self.agent_collection.find_one({"_id": ObjectId(agent_id)})
                metadata = agent_details.get("metadata", {})
                approval_status = agent_details.get("Approval_Status", "Pending")
                if not metadata:
                    return "Agent details not found"
                if approval_status == "Approved":
                    return "Agent is already approved"
                features = []
                model_details = metadata.get("model_data", {})
                #print(model_details)
                llm_credential_id = model_details.get("credential_id", None)
                provider_id = model_details.get("provider_id", "")
                model_name_data = model_details.get("model", {})
                model_name = model_name_data.get("name", "")
                tool_config = metadata.get("mcp_connector_value", None)
                tools = ""
                tool_config_detail = {}

                if tool_config:
                    tools = tool_config.get("name", "")
                    features.append({
                        "type":"TOOL_CALLING",
                        "priority":0,
                        "config":{
                            "max_tries":3
                        }
                    })
                    tool_config_detail = {
                        "action_names":[tool_config.get("description", "")],
                        "credential_id":tool_config.get("credential_id", ""),
                        "persist_auth":tool_config.get("persist_auth", True),
                        "provider_uuid":tool_config.get("provider_uuid", ""),
                        "server_id":tool_config.get("server_id", ""),
                        "tool_name":tool_config.get("name", ""),
                        "tool_source":tool_config.get("data","").get("tool_source", ""),
                    }
                if metadata.get("knowledge_store_checkbox") == True:
                    kb_details = metadata.get("knowledge_store_value", {})
                    features.append({
                        "type":"KNOWLEDGE_BASE",
                        "priority":0,
                        "config":{
                            "agentic_rag":[],
                            "lyzr_rag":{
                                "base_url": "https://rag-prod.studio.lyzr.ai",
                                "rag_id": kb_details.get("data", {}).get("_id", ""),
                                "rag_name": kb_details.get("data", {}).get("collection_name",""),
                                "params": {
                                    "retrieval_type": kb_details.get("type", ""),
                                    "score_threshold": kb_details.get("score_threshold", 0),
                                    "top_k": kb_details.get("chunks", 0)
                                }
                            }
                        }
                    })

                # if metadata.get("data_store_checkbox") == True:
                #     data_store_value = metadata.get("data_store_value", {})
                #     features.append({
                #         "type":"DATA_QUERY",
                #         "priority":0,
                #         "config":{
                #             "auto_train":data_store_value.get("auto_train", False),
                #             "docs_rag_id": data_store_value.get("data", {}).get("_id", ""),
                #             "max_tries":data_store_value.get("max_tries", 3),
                #             "rag_url": "https://rag-prod.studio.lyzr.ai",
                #             "time_limit":data_store_value.get("time_limit", 60)
                #         }
                #     })

                if metadata.get("memory_checkbox") == True:
                    memory_value= metadata.get("memory_value", {})
                    features.append({
                        "type":"MEMORY",
                        "priority":0,
                        "config":{
                            "provider":memory_value.get("provider", ""),
                            "lyzr_memory":{
                                "provider":memory_value.get("data", {}).get("provider_id", ""),
                                "param":{
                                    "cross_session":memory_value.get("cross_session", False)
                                }
                            }
                        }
                    })
                
                if metadata.get("context_checkbox") == True:
                    context_value = metadata.get("context_value", {})
                    features.append({
                        "type":"CONTEXT",
                        "priority":10,
                        "config":{
                            "context_id": context_value.get("id", ""),
                            "context_name": context_value.get("name", "")
                        }
                    })

                # tool_config_detail = {
                #     "action_names":[tool_config.get("description", "")],
                #     "credential_id":tool_config.get("credential_id", ""),
                #     "persist_auth":tool_config.get("persist_auth", True),
                #     "provider_uuid":tool_config.get("provider_uuid", ""),
                #     "server_id":tool_config.get("server_id", ""),
                #     "tool_name":tool_config.get("name", ""),
                #     "tool_source":tool_config.get("data","").get("tool_source", ""),
                # }
                agent_data = {
                    "a2a_tools": metadata.get("a2a_tools", []),
                    "additional_model_params": metadata.get("additional_model_params", None),
                    "agent_goal": metadata.get("agent_goal", ""),
                    "agent_instructions": metadata.get("agent_prompt", ""),
                    "agent_role": metadata.get("agent_role", ""),
                    "description": metadata.get("description", ""),
                    "disable_artifacts": metadata.get("disable_artifacts", False),
                    "examples": metadata.get("example", None),
                    "features": features,
                    "file_output": metadata.get("file_output", False), 
                    "image_output_config": metadata.get("image_output_config", None),
                    "llm_credential_id": llm_credential_id,
                    "managed_agents": metadata.get("managed_agents", []),
                    "max_iterations": metadata.get("max_iterations", 15),
                    "mcp_prompts": metadata.get("mcp_prompts", []),
                    "mcp_resources": metadata.get("mcp_resources", []),
                    "model": model_name,
                    "name": metadata.get("name", ""),
                    "provider_id": provider_id,
                    "response_format": metadata.get("response_format", {"type": "text"}),
                    "skills_catalog": metadata.get("skills_catalog", []),
                    "store_messages": metadata.get("store_messages", False),
                    "temperature": metadata.get("temperature", 0.7),
                    "tool_configs": [tool_config_detail] if tool_config else [],
                    "tool_usage_description": metadata.get("tool_usage_description", ""),
                    "tools": [tools],
                    "top_p": metadata.get("top_p", 0.9)
                }
                #print(agent_data)
                result = self.lyzr_create_agent(agent_data)
                
                if result:
                    self.agent_collection.update_one(
                        {"_id": ObjectId(agent_id)},
                        {"$set": {"Approval_Status": "Approved", "agent_id": result.get("agent_id"), "api_agent_id": result.get("agent_id"),"Approval_Status_Message": "Approved"}}
                    )
                    agent_details["Approval_Status"] = "Approved"
                    agent_details["Approval_Status_Message"] = "Approved"
                    agent_details["version"] = "1.0.0"
                    self.agent_version_history_collection.insert_one({
                        "agent_id": agent_id,
                        "version": "1.0.0",
                        "agent_doc_data": agent_details,
                        "updated_ts": agent_details.get("created_ts", datetime.now(timezone.utc)),
                        "updated_by": agent_details.get("approverEmail", ""),
                        "execution_count":0
                    })
                return "Agent approved and created successfully in Lyzr"
            elif data.get("sourcefrom") == "Update":
                agent_id = data.get("agent_id")
                agent_details = json.loads(json_util.dumps(self.agent_collection.find_one({"agent_id": agent_id})))
                print("Type",type(agent_details))
                _id = agent_details.get("_id")["$oid"]

                
                agent_doc_data = agent_details.get("agent_doc_data", {})
                agent_doc_data["Approval_Status"] = "Approved"
                agent_doc_data["Approval_Status_Message"] = "Approved"
                if "save_history" in agent_doc_data and agent_doc_data["save_history"]:
                    version = agent_doc_data.get("version")
                    print(f"Current agent version: {version} {type(version)}")
                    version = self.increment_version(version)
                    print(f"New agent version: {version}")
                    updated_ts = agent_doc_data.get("updated_ts", datetime.now(timezone.utc))
                    agent_doc_data["version"] = version
                    agent_doc_data["agent_id"] = agent_id
                    self.agent_version_history_collection.insert_one({
                        "agent_id": _id,
                        "version": version,
                        "agent_doc_data": agent_doc_data,
                        "updated_ts": updated_ts,
                        "updated_by": agent_details.get("approverEmail", ""),
                        "execution_count":0
                    })
                self.agent_collection.update_one({'agent_id': agent_id}, {'$set':agent_doc_data}, upsert=True)
                self.agent_collection.update_one({"agent_id": agent_id}, {"$set": {"agent_doc_data.version": agent_doc_data["version"]}})
                metadata = agent_details.get("metadata", {})
                if not metadata:
                    return "Agent details not found"

                features = []
                model_details = metadata.get("model_data", {})
                #print(model_details)
                llm_credential_id = model_details.get("credential_id", None)
                provider_id = model_details.get("provider_id", "")
                model_name = model_details.get("model", "")
                tool_config = metadata.get("mcp_connector_value", None)
                tools = ""
                tool_config_detail = {}

                if tool_config:
                    tools = tool_config.get("name", "")
                    features.append({
                        "type":"TOOL_CALLING",
                        "priority":0,
                        "config":{
                            "max_tries":3
                        }
                    })
                    tool_config_detail = {
                        "action_names":[tool_config.get("description", "")],
                        "credential_id":tool_config.get("credential_id", ""),
                        "persist_auth":tool_config.get("persist_auth", True),
                        "provider_uuid":tool_config.get("provider_uuid", ""),
                        "server_id":tool_config.get("server_id", ""),
                        "tool_name":tool_config.get("name", ""),
                        "tool_source":tool_config.get("data","").get("tool_source", ""),
                    }
                if metadata.get("knowledge_store_checkbox") == True:
                    kb_details = metadata.get("knowledge_store_value", {})
                    features.append({
                        "type":"KNOWLEDGE_BASE",
                        "priority":0,
                        "config":{
                            "agentic_rag":[],
                            "lyzr_rag":{
                                "base_url": "https://rag-prod.studio.lyzr.ai",
                                "rag_id": kb_details.get("data", {}).get("_id", ""),
                                "rag_name": kb_details.get("data", {}).get("collection_name",""),
                                "params": {
                                    "retrieval_type": kb_details.get("type", ""),
                                    "score_threshold": kb_details.get("score_threshold", 0),
                                    "top_k": kb_details.get("chunks", 0)
                                }
                            }
                        }
                    })

                # if metadata.get("data_store_checkbox") == True:
                #     data_store_value = metadata.get("data_store_value", {})
                #     features.append({
                #         "type":"DATA_QUERY",
                #         "priority":0,
                #         "config":{
                #             "auto_train":data_store_value.get("auto_train", False),
                #             "docs_rag_id": data_store_value.get("data", {}).get("_id", ""),
                #             "max_tries":data_store_value.get("max_tries", 3),
                #             "rag_url": "https://rag-prod.studio.lyzr.ai",
                #             "time_limit":data_store_value.get("time_limit", 60)
                #         }
                #     })

                if metadata.get("memory_checkbox") == True:
                    memory_value= metadata.get("memory_value", {})
                    features.append({
                        "type":"MEMORY",
                        "priority":0,
                        "config":{
                            "provider":memory_value.get("provider", ""),
                            "lyzr_memory":{
                                "provider":memory_value.get("data", {}).get("provider_id", ""),
                                "param":{
                                    "cross_session":memory_value.get("cross_session", False)
                                }
                            }
                        }
                    })
                
                if metadata.get("context_checkbox") == True:
                    context_value = metadata.get("context_value", {})
                    features.append({
                        "type":"CONTEXT",
                        "priority":10,
                        "config":{
                            "context_id": context_value.get("id", ""),
                            "context_name": context_value.get("name", "")
                        }
                    })
                agent_data = {
                    "a2a_tools": metadata.get("a2a_tools", []),
                    "additional_model_params": metadata.get("additional_model_params", None),
                    "agent_goal": metadata.get("agent_goal", ""),
                    "agent_instructions": metadata.get("agent_prompt", ""),
                    "agent_role": metadata.get("agent_role", ""),
                    "description": metadata.get("description", ""),
                    "disable_artifacts": metadata.get("disable_artifacts", False),
                    "examples": metadata.get("example", None),
                    "features": features,
                    "file_output": metadata.get("file_output", False), 
                    "image_output_config": metadata.get("image_output_config", None),
                    "llm_credential_id": metadata.get("llm_credential_id", ""),
                    "managed_agents": metadata.get("managed_agents", []),
                    "max_iterations": metadata.get("max_iterations", 15),
                    "mcp_prompts": metadata.get("mcp_prompts", []),
                    "mcp_resources": metadata.get("mcp_resources", []),
                    "model": model_name,
                    "name": metadata.get("name", ""),
                    "provider_id": provider_id,
                    "response_format": metadata.get("response_format", {"type": "text"}),
                    "skills_catalog": metadata.get("skills_catalog", []),
                    "store_messages": metadata.get("store_messages", False),
                    "temperature": metadata.get("temperature", 0.7),
                    "tool_configs": [tool_config_detail] if tool_config else [],
                    "tool_usage_description": metadata.get("tool_usage_description", ""),
                    "tools": [tools],
                    "top_p": metadata.get("top_p", 0.9)
                }
                resp = self.lyzr_update_agent(agent_id, agent_data)
                print(f"Lyzr update agent response: {resp}")

                return "Agent updated successfully in Lyzr"

            elif data.get("sourcefrom") == "Delete":
                agent_id = data.get("agent_id")
                agent_details = self.agent_collection.find_one({
                    "_id": ObjectId(agent_id),
                    "$or": [
                        {"isDeleted": {"$ne": True}},
                        {"isDeleted": {"$exists": False}}
                    ]
                })
                lyzr_agent_id = agent_details.get("agent_id", "")
                agent_provider_type = agent_details.get("agent_provider_type", "")
                if not agent_details:
                    return "Agent not found or already deleted", 404
                knowledge_store= agent_details.get("knowledge_store", {})
                self.agent_collection.update_one(
                    {"_id": ObjectId(agent_id)},
                    {"$set": {"isDeleted": True}}
                )
            

                for ks in knowledge_store:
                    rag_id = ks.get("id")
                    if rag_id:
                        self.kb_collection.delete_one({"rag_id": rag_id})
                if agent_provider_type == "new":
                    headers = {"x-api-key": api_key, "Content-Type": "application/json"}
                    response = requests.delete(f"{LYZR_API_ENDPOINT}/agents/{lyzr_agent_id}", headers=headers)
                return "Agent deleted successfully"

        else:
            if data.get("sourcefrom") == "Onboarding":
                self.agent_collection.update_one(
                    {"_id": ObjectId(data.get("agent_id"))},
                    {"$set": {"Approval_Status": "Rejected","Approval_Status_Message": "Rejected"}}
                )
                return "Agent approval rejected"

            if data.get("sourcefrom") == "Delete":
                self.agent_collection.update_one(
                    {"_id": ObjectId(data.get("agent_id"))},
                    {"$set": {"Approval_Status": "Approved","Approval_Status_Message": "Approved"}}
                )
                return "Agent deletion rejected"

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
                    
