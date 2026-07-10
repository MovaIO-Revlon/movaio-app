from datetime import date, datetime, timezone
from email import parser
from email.message import EmailMessage
import hashlib
import os
import random
import secrets
import shutil
import smtplib
import string
import uuid
from venv import logger
from flask import Flask, json, request, jsonify,send_file
from flask_cors import CORS
import httpx
from natsort import natsorted
from pydantic import ValidationError
from pymongo import MongoClient
from hashlib import pbkdf2_hmac
import base64
import logging
import re
import uuid
import wordninja
import requests
from agent import run_test_workflow
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.cluster import AgglomerativeClustering
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS
from config_loader import ConfigLoader, config_loader
from commonutils import DatabaseCollections, CommonUtils
from session_manager import session_manager, require_session, get_current_user
from database_manager import select_database_by_user_type
from nltk.stem import PorterStemmer
from json.decoder import JSONDecodeError
from utils import NotFoundError

import numpy as np
from collections import Counter
from difflib import SequenceMatcher

stemmer = PorterStemmer()

class TestCaseManager(DatabaseCollections):
    def __init__(self):
        super().__init__()
        self.utils = CommonUtils()
        self.configloader = ConfigLoader()
    
    def _query_db(self, collection_name, operation, user_type=None):
        """Helper method to query database with user type"""
        if user_type is None:
            current_user = get_current_user()
            prj_name=current_user.get('ActiveProject', self.configloader.config["MONGODB_COLLECTION_NAME_MASTER"]) if current_user else self.configloader.config["MONGODB_COLLECTION_NAME_MASTER"]
            user_type = self.project.find_one({'projectName': prj_name})['database_name']
        
        return config_loader.query_db(
            collection_name,
            operation,
            condition_func=select_database_by_user_type,
            user_type=user_type
        )

    def run_workflow_endpoint_details(self, user_story_folder, request):
        print("enter")
        
        agent_dtls = request.get_json()
        agent_id = agent_dtls.get("agent_id", "")
        ischat = agent_dtls.get("ischat", False)

     
        agent_data = self.agent_collection.find_one({"agent_id": agent_id})
       
        if not agent_data:
            return jsonify({"error": "Agent not found"}), 400

        api_key = agent_data.get('agent_api_key', '')
        if not api_key:
            return jsonify({"error": "Missing API key for agent"}), 400
            
        current_time = datetime.utcnow()
        response_text = None
        has_failed = False 
        event_id = self.generate_event_id()
        print("user story folder",user_story_folder)
        
        for filename in natsorted(os.listdir(user_story_folder)):
            if filename.endswith(".txt"):
                unique_id = str(uuid.uuid4())
                event_doc = {
                    "event_id": event_id,
                    "event_unique_id":unique_id,
                    "event_name": self.configloader.TITLE,
                    "events_desc": "",
                    "events_output": "",
                    "agent_id": agent_id,
                    "agent_name": agent_data.get("name", ""),
                    "event_status": "in_progress",
                    "is_human_verified": False,
                    "agent_status": agent_data.get("status", ""),
                    "filename": filename,
                    "explanation":"",
                    "created_ts": datetime.utcnow(),
                    "current_ts": current_time
                }
                self.event_agency_tracking_collection.insert_one(event_doc)

                try:
                    print("test")
                    result = run_test_workflow(event_id, filename, agent_data,agent_id)
                    response_text = result.get("response", result)
                    event_description = result.get("desc", result)

                    print("response_text",response_text)
                    ##print("event_description",event_description)

                    explanation = self.get_explanation(agent_id,api_key)
                    
                    ##print("explanation",explanation)
                    
                    parsed_response= self.clean_text(response_text)

                    if ischat:
                        
                        # self.event_agency_tracking_collection.update_one(
                        # {"event_id": event_id,"event_unique_id":unique_id},
                        # {"$set": {
                            # "event_name": parsed_response.get("test_case_title", self.configloader.TITLE) if isinstance(parsed_response, dict) else self.configloader.TITLE,
                            # "events_output": response_text,
                            # "explanation":explanation,
                            # "events_desc": event_description,
                            # "event_status": "inprogress"
                        # }}
                    # )
                        update_event_agency_op = {
                            'type': 'update_one',
                            'filter': {
                                "event_id": event_id,
                                "event_unique_id": unique_id
                            },
                            'update': {
                                "$set": {
                                    "event_name": parsed_response.get("test_case_title", self.configloader.TITLE)
                                    if isinstance(parsed_response, dict) else self.configloader.TITLE,
                                    "events_output": response_text,
                                    "explanation": explanation,
                                    "events_desc": event_description,
                                    "event_status": "inprogress"
                                }
                            }
                        }

                        self._query_db('event_agency_tracking', update_event_agency_op)
                    else:
                       
                        # self.event_agency_tracking_collection.update_one(
                        # {"event_id": event_id,"event_unique_id":unique_id},
                        # {"$set": {
                            # "event_name": parsed_response.get("test_case_title", self.configloader.TITLE) if isinstance(parsed_response, dict) else self.configloader.TITLE,
                            # "events_output": response_text,
                            # "explanation":explanation,
                            # "events_desc": event_description,
                            # "event_status": "completed"
                        # }}
                    # )
                        update_event_agency_op = {
                            'type': 'update_one',
                            'filter': {
                                "event_id": event_id,
                                "event_unique_id": unique_id
                            },
                            'update': {
                                "$set": {
                                    "event_name": parsed_response.get("test_case_title", self.configloader.TITLE)
                                    if isinstance(parsed_response, dict) else self.configloader.TITLE,
                                    "events_output": response_text,
                                    "explanation": explanation,
                                    "events_desc": event_description,
                                    "event_status": "completed"
                                }
                            }
                        }

                        self._query_db('event_agency_tracking', update_event_agency_op)


                except Exception as e:
                    has_failed = True
                    ##print(f"[ERROR] Failed to process {filename}: {e}")
                    self.event_agency_tracking_collection.update_one(
                        {"event_id": event_id},
                        {"$set": {
                            "event_status": "Failed",
                            "events_output": str(e)
                        }}
                    )
        
        if not ischat:
            self.agent_collection.update_one(
            {"agent_id": agent_id},
            {"$set": {
                "run_status": "completed",
                "last_run_ts": self.utils.get_current_timestamp()
            }}
        )
            update_agent_run_status_op = {
                'type': 'update_one',
                'filter': {"agent_id": agent_id},
                'update': {
                    "$set": {
                        "run_status": "completed",
                        "last_run_ts": self.utils.get_current_timestamp()
                    }
                }
            }

            self._query_db('agent', update_agent_run_status_op)

            agent_doc=self.agent_collection.find_one({"agent_id": agent_id})
            actions = agent_doc["actions"]
            for action in actions:
                action["flag"] = False
            
            # self.agent_tracking_collection.insert_one({
                    # "id": str(uuid.uuid4()),
                    # "agent_id": agent_id,
                    # "event_id": event_id,
                    # "agent_status": "completed",
                    # "action": actions,
                    # "created_ts": datetime.utcnow()
                # })
            insert_agent_tracking_op = {
                'type': 'insert_one',
                'document': {
                    "id": str(uuid.uuid4()),
                    "agent_id": agent_id,
                    "event_id": event_id,
                    "agent_status": "completed",
                    "action": actions,
                    "created_ts": datetime.utcnow()
                }
            }

            self._query_db('agent_tracking', insert_agent_tracking_op)
        return response_text


    def get_explanation(self, agent_id, api_key):
        trace_url = config_loader.LYZR_AGENT_URL + "/v3/ops/traces"
        headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        params = {"agent_id": agent_id, "limit": 1}

        try:
            trace_response = requests.get(trace_url, headers=headers, params=params)
            trace_response.raise_for_status()
            trace = trace_response.json()
        except requests.exceptions.RequestException as e:
            return jsonify({"error": f"Error calling trace endpoint: {str(e)}"}), 500

        ##print("Traces",trace["traces"])

        if trace["traces"]:
            trace_id = trace["traces"][0]["trace_id"]
            trace_detail_url = f"{config_loader.LYZR_AGENT_URL}/v3/ops/trace/{trace_id}"
            try:
                detail_response = requests.get(trace_detail_url, headers=headers)
                detail_response.raise_for_status()
                detail_data = detail_response.json()
                
            except requests.exceptions.RequestException as e:
                return jsonify({"error": f"Failed to fetch trace data: {str(e)}"}), 500
            except JSONDecodeError:
                return jsonify({"error": "Invalid JSON response from API"}), 500
            
            improvement_contents = []
            for item in detail_data:
                input_messages = item.get("input_messages", [])
                for msg in input_messages:
                    if (isinstance(msg, dict) and 
                        msg.get("role") == "user" and 
                        "You are an AI assistant tasked" in msg.get("content", "")):
                        improvement_contents.append(msg.get("content", ""))

            if not improvement_contents:
                explanation="No relevant user message found in trace data."
            else:
                explanation = improvement_contents[0]
        else:
            explanation="Explanation is not available."

        return explanation

    def clean_text(self, response_text):
        try:
            cleaned = response_text.replace('```json', '').replace('```', '').strip()
            if '\\n' not in cleaned:
                cleaned = cleaned.replace('\n', '')
            parsed_response = json.loads(cleaned)
            return parsed_response
        except Exception:
            parsed_response = response_text
            return parsed_response

    def get_agency_result(self):
        try:
            documents = self.event_agency_tracking_collection.find({})
            result = []
            for doc in documents:
                doc['_id'] = str(doc['_id'])
                result.append(doc)
            return result
        except (SystemExit, KeyboardInterrupt):  
            raise
        except Exception as e:  
            logging.error("Error in get_agency_result:", exc_info=True)
            logging.exception(e)
            return []
    
    def preprocess_query(self,user_query: str, max_tokens: int = 30):
        words = user_query.split()
        return " ".join(words[:max_tokens])
    
    def normalize_route_query(self,text: str) -> str:
        text = text.lower()
        tokens = re.findall(r"\w+", text)

        split_tokens = []
        for t in tokens:
            # Dynamically split if wordninja produces >1 token
            parts = wordninja.split(t)
            if len(parts) > 1:
                split_tokens.extend(parts)
            else:
                split_tokens.append(t)

        return " ".join(stemmer.stem(tok) for tok in split_tokens)


    def route_query(self, user_query: str, teams: str) -> dict:
        # Fetch Task Agents (excluding deleted ones)
        task_agents = self.fetch_task_agents()
        if not task_agents:
            raise NotFoundError("No task agents found")

        if teams is not None:
            filtered_task_agents = []
            for agent in task_agents:
                agent_id = agent.get("agent_id")
                if agent_id:
                    # Skip if agent is deleted
                    if agent.get("isDeleted") is True:
                        continue

                    # Check all mappings in agent_agency collection for the agent_id
                    agent_agencies = self._query_db(
                        'agent_agency_mapping',
                        {
                            'type': 'find',
                            'filter': {
                                "agent_id": agent_id,
                                "status": "active"
                            },
                            'projection': {"agency_id": 1, "_id": 0}
                        }
                    )
                    # Iterate through all mapped agency_ids
                    for agent_agency in agent_agencies:
                        agency_id = agent_agency.get("agency_id")
                        if agency_id:
                            # Check agency collection (no team filter)
                            agency = self._query_db(
                                'agency',
                                {
                                    'type': 'find_one',
                                    'filter': {"agency_id": agency_id},
                                    'projection': {"assigned_to": 1, "_id": 0}
                                }
                            )
                            # If agency exists, include the agent (no team check)
                            if agency:
                                filtered_task_agents.append(agent)
                                break  # No need to check further agencies for this agent
            if not filtered_task_agents:
                raise NotFoundError("No task agents found for the specified team")
            # Normalize + compute similarity
            matched_agent, score = self.find_best_match(user_query, filtered_task_agents)
        else:
            matched_agent, score = self.find_best_match(user_query, task_agents)

        threshold = 0.25
        if len(user_query.split()) > 50:
            threshold = 0.15

        if not matched_agent or score < threshold:
            return {
                "success": False,
                "message": "Please refine your query.",
                "data": {"default_agent": "default_agent"},
                "similarity_score": float(score) if score else 0.0
            }

        # Get master agent mapping
        response_payload = self.build_agent_response(matched_agent)
        return {
            "agent": response_payload,
            "similarity_score": float(score)
        }


    def fetch_task_agents(self, user_type=None):
        try:
            operation = {
                'type': 'find',
                'filter': {
                    "agent_type_name": "Task Agent",
                    "status": "active",
                    "isDeleted": {"$ne": True}  # Exclude deleted agents
                },
                'projection': {"_id": 0}
            }
            return self._query_db('agent', operation, user_type)
        except Exception as ex:
            logging.error("Error in fetch_task_agents:", exc_info=True)
            return []
        
    def find_best_match(self,user_query: str, task_agents: list):
        user_query = self.preprocess_query(user_query, max_tokens=30)
        agent_names = [agent.get("name", "") for agent in task_agents]
        norm_agents = [self.normalize_route_query(name) for name in agent_names]
        norm_query = self.normalize_route_query(user_query)

        corpus = norm_agents + [norm_query]
        vectorizer = TfidfVectorizer(stop_words="english").fit(corpus)
        vectors = vectorizer.transform(corpus)

        query_vec = vectors[-1]
        agent_vecs = vectors[:-1]

        scores = cosine_similarity(query_vec, agent_vecs).flatten()
        best_index = scores.argmax()
        return task_agents[best_index], scores[best_index]


    def build_agent_response(self,matched_agent: dict):
        mapping_doc = self.agent_agency_mapping_collection.find_one(
            {"agent_id": matched_agent["agent_id"], "status": "active"},
            {"agency_id": 1, "_id": 0}
        )

        if not mapping_doc:
            return matched_agent  

        agency_id = mapping_doc.get("agency_id")
        master_mapping = self.agent_agency_mapping_collection.find_one(
            {"agency_id": agency_id, "order_number": 1, "status": "active"}
        )

        if not master_mapping:
            return matched_agent 

        master_agent_id = master_mapping.get("agent_id")
        master_agent = self.agent_collection.find_one({"agent_id": master_agent_id}, {"_id": 0})

        if master_agent:
            master_agent["subagent"] = matched_agent
            return master_agent

        return matched_agent



    def generate_event_id(self):
        total_events = self.event_agency_tracking_collection.count_documents({})
        round_number = total_events // 16
        round_start = round_number * 20
        position_in_round = total_events % 16 + 1
        event_number = round_start + position_in_round
        return f"UC-{str(event_number).zfill(3)}"

    # def get_event_workflow_details(self, request, user_type=None):
        # try:
            # user_dtls = request.get_json()
            # agent_id = user_dtls.get("agent_id", "")
            # ischat = user_dtls.get("ischat", False)

            # if not agent_id:
                # return jsonify({"Success": False, "Message": "agent_id is required"}), 200

            # if ischat:
                # operation = {
                    # 'type': 'find_one',
                    # 'filter': {"agent_id": agent_id, "event_status": "inprogress"},
                    # 'sort': [("current_ts", -1)]
                # }
            # else:
                # operation = {
                    # 'type': 'find_one',
                    # 'filter': {"agent_id": agent_id, "event_status": "completed"},
                    # 'sort': [("current_ts", -1)]
                # }
            
            # latest_event = self._query_db('event_agency_tracking', operation, user_type)

            # if not latest_event:
                # return jsonify({"Success": False, "Message": "No events found for this agent"}), 200

            # event_id = latest_event.get("event_id")
            # ##print("event_id",event_id)
            # if not event_id:
                # return jsonify({"Success": False, "Message": "Event ID not found in latest event"}), 200

            # event_operation = {
                # 'type': 'find',
                # 'filter': {"event_id": event_id},
                # 'sort': [("created_ts", 1)]
            # }
            # event_docs = self._query_db('event_agency_tracking', event_operation, user_type)

            # for doc in event_docs:
                # doc["_id"] = str(doc["_id"])

            # status_result = []
            

            # return event_docs, status_result

        # except Exception as ex:
            # logging.error("Error in Get_event_workflow_details:", exc_info=True)
            # return None, None, str(ex)
            
    def get_event_workflow_details(self, request, user_type=None):
        try:
            user_dtls = request.get_json()
            agent_id = user_dtls.get("agent_id", "")
            ischat = user_dtls.get("ischat", False)

            if not agent_id:
                return jsonify({"Success": False, "Message": "agent_id is required"}), 200

            if ischat:
                operation = {
                    'type': 'find_one',
                    'filter': {"agent_id": agent_id, "event_status": "inprogress"},
                    'sort': [("current_ts", -1)]
                }
            else:
                operation = {
                    'type': 'find_one',
                    'filter': {"agent_id": agent_id, "event_status": "completed"},
                    'sort': [("current_ts", -1)]
                }
            
            latest_event = self._query_db('event_agency_tracking', operation, user_type)

            if not latest_event:
                return jsonify({"Success": False, "Message": "No events found for this agent"}), 200

            event_id = latest_event.get("event_id")
            ##print("event_id",event_id)
            if not event_id:
                return jsonify({"Success": False, "Message": "Event ID not found in latest event"}), 200

            event_operation = {
                'type': 'find',
                'filter': {"event_id": event_id},
                'sort': [("created_ts", 1)]
            }
            event_docs = self._query_db('event_agency_tracking', event_operation, user_type)

            for doc in event_docs:
                doc["_id"] = str(doc["_id"])

            status_result = []

            self.agent_tracking_collection.update_one(
            {
                "agent_id": agent_id,
                "event_id": event_id,
                "agent_status": "completed"
                  # match at least one false flag
            },
            {
                "$set": { "action.0.flag": True }
            }
        )
            updates_op = {
            'type': 'update_one',
            'filter': {
                "agent_id": agent_id,
                "event_id": event_id,
                "agent_status": "completed"
                
            },
            "update": {
                "$set": { "action.0.flag": True }
            }
        }

            self._query_db('agent_tracking', updates_op)
            

            return event_docs, status_result

        except Exception as ex:
            logging.error("Error in Get_event_workflow_details:", exc_info=True)
            return None, None, str(ex)


    def get_user_events_details(self, request, user_type=None):
        try:
            data = request.get_json()
            email = data.get('UserMail',)
            agencyid= data.get('agencyId')

            if not email:
                return jsonify({"Success": False, "Message": "Email ID is required"}), 200

            last_operation = {
                'type': 'find',
                'filter': {
                    'event_status': 'completed',
                    'createdBy_ts': email,
                    'agency_id': agencyid,
                    'current_ts': {'$exists': True}
                },
                'sort': [('current_ts', -1)],
                'limit': 1
            }
            last_doc = self._query_db('event_agency_tracking', last_operation, user_type)

            last_doc = list(last_doc) if last_doc else []

            if not last_doc:
                return jsonify({
                    "Success": True,
                    "Message": "No completed events found for this email",
                    "data": []
                }), 200

            latest_current_ts = last_doc[0]['current_ts']
            
            if latest_current_ts is None:
                return jsonify({
                    "Success": False,
                    "Message": "No valid current_ts found to filter events",
                    "data": []
                }), 200

            documents_operation = {
                'type': 'find',
                'filter': {
                    'event_status': 'completed',
                    'current_ts': latest_current_ts,
                    'createdBy_ts': email,
                    'agency_id': agencyid
                },
                'sort': [('current_ts', 1)]
            }
            documents = self._query_db('event_agency_tracking', documents_operation, user_type)

            count_operation = {'type': 'count', 'filter': {}}
            total_count = self._query_db('event_agency_tracking', count_operation, user_type)
            ##print("Event Collection total document count:", total_count)

            result = []
            for doc in documents:
                doc['_id'] = str(doc['_id'])
                result.append(doc)

            return result

        except Exception as ex:
            logging.error("Error in GetuserEventsDetails:", exc_info=True)
            return jsonify({"Success": False, "Message": str(ex)}), 500
            
    def fetch_graph_data(self):
        # docs_cursor = self.kb_collection.find()
        docs = {'type': 'find', 'filter': {}}
        docs_cursor = self._query_db('kb_collection', docs)
        
        # docs = docs_cursor.to_list(length=None)    
        serialized_docs=[]
        
        if not docs_cursor:
            serialized_docs = []
        
        else:
            serialized_docs = [self.utils.serialize_doc(doc) for doc in docs_cursor]
            
        return serialized_docs
            
            
            

    def get_insight_agent_details(self, user_type=None):
        try:
            # Use find operation instead of distinct
            find_operation = {
                'type': 'find',
                'filter': {"agent_type_name": "Insight Agent"},
                'projection': {"agent_id": 1, "_id": 0}
            }
            insight_agents = self._query_db('agent', find_operation, user_type)
            insight_agent_ids = [agent.get("agent_id") for agent in insight_agents if agent.get("agent_id")]

            if not insight_agent_ids:
                return []

            insights = []

            for agent_id in insight_agent_ids:
                event_operation = {
                    'type': 'find_one',
                    'filter': {"agent_id": agent_id},
                    'sort': [("current_ts", -1)]
                }
                latest_event = self._query_db('event_agency_tracking', event_operation, user_type)

                if latest_event:
                    agent_operation = {
                        'type': 'find_one',
                        'filter': {"agent_id": agent_id},
                        'projection': {"name": 1}
                    }
                    agent_doc = self._query_db('agent', agent_operation, user_type)
                    agent_name = agent_doc.get("name") if agent_doc else ""

                    latest_event["_id"] = str(latest_event["_id"])
                    for ts_field in ["created_ts", "current_ts"]:
                        if latest_event.get(ts_field):
                            latest_event[ts_field] = latest_event[ts_field].isoformat()

                    latest_event["agent_name"] = agent_name
                    ##print(f"Latest event for agent {agent_id}: {latest_event}")
                    insights.append(latest_event)
                    
            return insights
                    
        except Exception as ex:
            logging.error("Error in GetInsightAgentDetails:", exc_info=True)
            return []

    def fetch_recent_data_old(self, master_agent_id: str = None, user_type=None):
        # Step 1: Fetch ALL records matching master_agent_id
        query = {}
        if master_agent_id:
            query["master_agent_id"] = master_agent_id
        operation = {
            'type': 'find_all',
            'filter': query
        }
        all_records = self._query_db('chatbot_tracking', operation, user_type)
        if not all_records:
            return []
        filtered_records = []
        if not master_agent_id:
            for all_record in all_records:
                
                master_id = all_record.get("master_agent_id")
                agent_id = all_record.get("agent_id")
                if master_id:
                    master_agent_doc = self.agent_collection.find_one({"agent_id": master_id,"status": "active"})
                    if master_agent_doc:
                        res = self.agent_agency_mapping_collection.find_one({"agent_id":master_id, "status":"active"})
                        agency_id = res.get("agency_id") if res else None
                        if agency_id:
                            task = self.agent_agency_mapping_collection.find({"agency_id": agency_id, "status": "active","order_number": 2})
                            for t in task:
                                sub_agent_id = t.get("agent_id")
                                if sub_agent_id == agent_id:
                                        filtered_records.append(all_record)
                                        break

            all_records = filtered_records
        processed_records = []
        for r in all_records:
            r["_id"] = str(r["_id"])
            # === 1. Safe Rating Extraction ===
            raw_rating = r.get("feedback_rating")
            rating_val = 0.0
            try:
                if raw_rating is not None:
                    rating_val = float(raw_rating)
            except (ValueError, TypeError):
                rating_val = 0.0
            # === 2. Validate Response ===
            prompt_output = r.get("prompt_output")
            response_text = ""
            if not prompt_output:
                continue
               
                    
            else:
                if isinstance(prompt_output, dict):
                    if prompt_output.get("detail") == "Credits exhausted":
                        continue
                    if "error" in prompt_output or "exhausted" in str(prompt_output).lower():
                        continue
                    if not prompt_output.get("response") and not prompt_output.get("module_outputs"):
                        if rating_val > 0:
                            response_text = "[No Response Logged]"
                        else:
                            continue
                    else:
                        response_text = prompt_output.get("response", "")
                elif isinstance(prompt_output, str):
                    response_text = prompt_output.strip()
                    if not response_text:
                        if rating_val > 0:
                            response_text = "[No Response Logged]"
                        else:
                            continue
                else:
                    continue # unknown format
            # === 3. Validate Query ===
            raw_query = r.get("user_query", "").strip()
            if not raw_query:
                continue
            cleaned_query = ' '.join(re.sub(r'[^a-z0-9\s]', '', raw_query.lower()).split())
            # === 4. Safe Timestamp Extraction ===
            ts = r.get("updated_ts")
            timestamp = 0.0
            if isinstance(ts, datetime):
                timestamp = ts.timestamp()
            elif isinstance(ts, (int, float)):
                timestamp = float(ts)
            processed_records.append({
                "record": r,
                "query_text": cleaned_query,
                "timestamp": timestamp,
                "rating": rating_val
            })
        if not processed_records:
            return []
        # === Step 5: Sort by Rating (desc), then Timestamp (desc) ===
        processed_records.sort(
            key=lambda x: (x["rating"], x["timestamp"]),
            reverse=True
        )
                # === Step 6: TF-IDF Vectorization ===
        all_words = set()
        for pr in processed_records:
            all_words.update(pr["query_text"].split())
        word_list = sorted(all_words)
        word_to_index = {word: i for i, word in enumerate(word_list)}
        vocab_size = len(word_list)
        doc_freq = Counter()
        for pr in processed_records:
            doc_freq.update(set(pr["query_text"].split()))
        N = len(processed_records)
        vectors = []
        for pr in processed_records:
            vec = np.zeros(vocab_size)
            words = pr["query_text"].split()
            term_freq = Counter(words)
            for word, tf in term_freq.items():
                if word in word_to_index:
                    idx = word_to_index[word]
                    df = doc_freq[word]
                    idf = np.log((N + 1) / (df + 1)) + 1  # Standard smoothed IDF
                    vec[idx] = tf * idf
            norm = np.linalg.norm(vec)
            if norm > 0:
                vec /= norm
            vectors.append(vec)
        vectors = np.array(vectors)
        if len(processed_records) <= 1:
            final_candidates = processed_records
        else:
            # === Step 7: Simple Pairwise Deduplication with Low Threshold ===
            similarity_threshold = 0.4 # Merge if cosine similarity > 0.15
            # Compute full cosine similarity matrix
            sim_matrix = cosine_similarity(vectors)
            kept_indices = []
            for i in range(len(processed_records)):
                # Always keep the first (best) one
                if not kept_indices:
                    kept_indices.append(i)
                    continue
                # Check if current is too similar to any already kept
                is_duplicate = False
                for k in kept_indices:
                    if sim_matrix[i][k] > similarity_threshold:
                        is_duplicate = True
                        break
                if not is_duplicate:
                    kept_indices.append(i)
            final_candidates = [processed_records[i] for i in kept_indices]
            print(f"[DEBUG] Deduplication complete → kept {len(final_candidates)} / {len(processed_records)}")
        # === Step 8: Limit to 15 unique groups ===
        limited_candidates = final_candidates[:15]
        # === Step 9: Enrich with Agent Name ===
        results = []
        for item in limited_candidates:
            r = item["record"]
            agent_id = r.get("agent_id")
            r["name"] = ""
            if agent_id:
                agent_operation = {
                    'type': 'find_one',
                    'filter': {"agent_id": agent_id},
                    'projection': {"name": 1, "_id": 0}
                }
                agent_doc = self._query_db('agent', agent_operation, user_type)
                if agent_doc:
                    r["name"] = agent_doc.get("name", "")
            results.append(r)
        return results

    def normalize_query_old(self, text: str) -> str:
        STOPWORDS = set(ENGLISH_STOP_WORDS)
        if not text:
            return ""
        text = text.lower()
        text = re.sub(rf"[{re.escape(string.punctuation)}]", " ", text)
        tokens = []
        for word in text.split():
            if word in STOPWORDS:
                continue
            if word.endswith("s"):
                word = word[:-1]
            tokens.append(word)
        return " ".join(tokens)

    #region fetch_recent_data
 
    def fetch_recent_data(self, master_agent_id: str = None, user_type=None):
        """Main entry point: orchestrates the data fetching, filtering, processing, and clustering."""
        all_records = self._fetch_all_records(master_agent_id, user_type)
        if not all_records:
            return []

        filtered_records = self._filter_records(all_records, master_agent_id)
        processed_records = self._process_records(filtered_records)
        
        if not processed_records:
            return []

        final_candidates = self._cluster_and_select_best(processed_records)
        return self._enrich_agent_names(final_candidates, user_type)

    def _fetch_all_records(self, master_agent_id: str, user_type):
        query = {"master_agent_id": master_agent_id} if master_agent_id else {}
        operation = {'type': 'find_all', 'filter': query}
        return self._query_db('chatbot_tracking', operation, user_type) or []

    def _filter_records(self, all_records: list, master_agent_id: str) -> list:
        if master_agent_id:
            return all_records

        filtered_records = []
        for rec in all_records:
            master_id = rec.get("master_agent_id")
            if not master_id:
                continue
                
            master_agent_doc = self.agent_collection.find_one(
                {"agent_id": master_id, "status": "active"}
            )
            if not master_agent_doc:
                continue

            res = self.agent_agency_mapping_collection.find_one(
                {"agent_id": master_id, "status": "active"}
            )
            agency_id = res.get("agency_id") if res else None
            if not agency_id:
                continue

            task_cursor = self.agent_agency_mapping_collection.find(
                {"agency_id": agency_id, "status": "active", "order_number": 2}
            )
            
            agent_id = rec.get("agent_id")
            if any(t.get("agent_id") == agent_id for t in task_cursor):
                filtered_records.append(rec)

        return filtered_records

    def _process_records(self, all_records: list) -> list:
        processed_records = []
        for r in all_records:
            processed = self._process_single_record(r)
            if processed:
                processed_records.append(processed)
        return processed_records

    def _process_single_record(self, r: dict) -> dict | None:
        r["_id"] = str(r["_id"])

        try:
            rating_val = float(r.get("feedback_rating") or 0)
        except (ValueError, TypeError):
            rating_val = 0.0

        prompt_output = r.get("prompt_output")
        if not prompt_output:
            return None

        response_text = self._extract_response_text(prompt_output, rating_val)
        if response_text is None:
            return None

        raw_query = r.get("user_query", "").strip()
        if not raw_query:
            return None

        cleaned_query = self.normalize_query(raw_query)

        ts = r.get("updated_ts")
        if isinstance(ts, datetime):
            timestamp = ts.timestamp()
        elif isinstance(ts, (int, float)):
            timestamp = float(ts)
        else:
            timestamp = 0.0

        return {
            "record": r,
            "query_text": cleaned_query,
            "timestamp": timestamp,
            "rating": rating_val
        }

    def _extract_response_text(self, prompt_output, rating_val: float) -> str | None:
        if not isinstance(prompt_output, (dict, str)):
            return None

        if isinstance(prompt_output, dict):
            if prompt_output.get("detail") == "Credits exhausted":
                return None
            if "error" in prompt_output or "exhausted" in str(prompt_output).lower():
                return None
            
            response = prompt_output.get("response")
            if response:
                return response
            if not prompt_output.get("module_outputs"):
                return "[No Response Logged]" if rating_val > 0 else None
            return ""

        response = prompt_output.strip()
        if not response:
            return "[No Response Logged]" if rating_val > 0 else None
            
        return response

    def _cluster_and_select_best(self, processed_records: list) -> list:
        # Sort deterministically before clustering
        processed_records.sort(
            key=lambda x: (x["rating"], x["timestamp"], x["query_text"]),
            reverse=True
        )

        queries = [p["query_text"] for p in processed_records]
        vectorizer = TfidfVectorizer(ngram_range=(1, 2), min_df=1)
        tfidf_matrix = vectorizer.fit_transform(queries)
        sim_matrix = cosine_similarity(tfidf_matrix)

        clusters = self._build_clusters(sim_matrix, len(processed_records))

        # Pick best per cluster (already sorted, so min index is best)
        final_candidates = [processed_records[min(cluster)] for cluster in clusters]

        final_candidates.sort(
            key=lambda x: (x["rating"], x["timestamp"]),
            reverse=True
        )

        return final_candidates[:15]

    def _build_clusters(self, sim_matrix, n: int, threshold: float = 0.65) -> list:
        visited = set()
        clusters = []

        for i in range(n):
            if i in visited:
                continue

            stack = [i]
            cluster = set()

            while stack:
                idx = stack.pop()
                if idx in cluster:
                    continue

                cluster.add(idx)
                visited.add(idx)

                for j in range(n):
                    if j != idx and sim_matrix[idx][j] >= threshold:
                        stack.append(j)

            clusters.append(cluster)

        return clusters

    def _enrich_agent_names(self, final_candidates: list, user_type) -> list:
        results = []
        for item in final_candidates:
            r = item["record"]
            agent_id = r.get("agent_id")
            r["name"] = ""

            if agent_id:
                agent_operation = {
                    'type': 'find_one',
                    'filter': {"agent_id": agent_id},
                    'projection': {"name": 1, "_id": 0}
                }
                agent_doc = self._query_db('agent', agent_operation, user_type)
                if agent_doc:
                    r["name"] = agent_doc.get("name", "")

            results.append(r)
        return results   
          
    def normalize_query(self, text: str) -> str:
        text = text.lower().strip()
        text = re.sub(r'[^a-z0-9\s]', ' ', text)
        return ' '.join(text.split())

    #endregion

    # def fetch_popular_queries(self):
        # pipeline = [
            # {"$match": {"user_query": {"$nin": [None, ""]}}},
            # {"$sort": {"updated_ts": -1}}
        # ]

        # raw_queries = list(self.chatbot_tracking_collection.aggregate(pipeline))
        # if not raw_queries:
            # return []

        # queries = [self.normalize_query(q["user_query"]) for q in raw_queries]
        # original_map = [q["user_query"] for q in raw_queries]

        # if len(queries) <= 2:
            # result = []
            # for q in raw_queries:
                # doc = self.chatbot_tracking_collection.find_one(
                    # {"user_query": q["user_query"]},
                    # {"master_agent_id": 1, "agent_id": 1, "_id": 0}
                # )
                # master_agent_id = doc.get("master_agent_id") if doc else None
                # agent_id = doc.get("agent_id") if doc else None

                # master_agent_details, sub_agent_details, agent_with_sub = None, None, None
                # if master_agent_id:
                    # master_agent_details = self.agent_collection.find_one({"agent_id": master_agent_id}, {"_id": 0})
                # if agent_id:
                    # sub_agent_details = self.agent_collection.find_one({"agent_id": agent_id}, {"_id": 0})
                # if master_agent_details:
                    # agent_with_sub = dict(master_agent_details)
                    # agent_with_sub["subagent"] = sub_agent_details if sub_agent_details else {}

                # result.append({
                    # "query": q["user_query"],
                    # "count": 1,
                    # "updated_ts": q["updated_ts"],
                    # "agent": agent_with_sub,
                    # "similar_queries": [q["user_query"]]
                # })
            # return result

        # vectorizer = TfidfVectorizer()
        # X = vectorizer.fit_transform(queries)
        # sim_matrix = cosine_similarity(X)
        # distance_matrix = 1 - sim_matrix

        # clustering = AgglomerativeClustering(
            # n_clusters=None,
            # metric="precomputed",
            # linkage="average",
            # distance_threshold=0.5
        # )
        # labels = clustering.fit_predict(distance_matrix)

        # clusters = self.cluster_data(labels, original_map, raw_queries)
        # result = self.cluster_result(clusters)

        # result.sort(
            # key=lambda x: (
                # -x["count"],
                # -x["updated_ts"].timestamp() if hasattr(x["updated_ts"], "timestamp") else x["updated_ts"]
            # )
        # )
        # return result[:4]
        
    def fetch_popular_queries(self, teams, user_type=None):
        try:
            # Step 1: Build the pipeline to fetch queries
            pipeline = [
                {"$match": {"user_query": {"$nin": [None, ""]}}},
                {"$sort": {"updated_ts": -1}}
            ]
            
            # Step 2: Fetch raw queries
            raw_queries = self._query_db(
                'chatbot_tracking',
                {'type': 'aggregate', 'pipeline': pipeline}
            )
            if not raw_queries:
                return []

            # Step 3: Filter queries based on team assignment (OPTIMIZED)
            # Collect unique agent_ids for bulk lookup
            agent_ids = list(set(q.get("agent_id") for q in raw_queries if q.get("agent_id")))
            if not agent_ids:
                return []

            # Bulk fetch all agent-to-agency mappings
            all_mappings = self._query_db(
                'agent_agency_mapping',
                {
                    'type': 'find',
                    'filter': {"agent_id": {"$in": agent_ids}},
                    'projection': {"agent_id": 1, "agency_id": 1, "_id": 0}
                }
            )

            # Bulk fetch all agency-to-team assignments
            agency_ids = list(set(m.get("agency_id") for m in all_mappings if m.get("agency_id")))
            all_agencies = self._query_db(
                'agency',
                {
                    'type': 'find',
                    'filter': {"agency_id": {"$in": agency_ids}},
                    'projection': {"agency_id": 1, "assigned_to": 1, "_id": 0}
                }
            )

            # Create in-memory lookup maps
            agency_team_map = {a['agency_id']: a.get('assigned_to') for a in all_agencies}
            agent_to_teams_map = {}
            for m in all_mappings:
                a_id, ag_id = m['agent_id'], m['agency_id']
                if agency_team_map.get(ag_id) == teams:
                    if a_id not in agent_to_teams_map:
                        agent_to_teams_map[a_id] = True

            # Filter queries using in-memory maps
            filtered_queries = [q for q in raw_queries if q.get("agent_id") in agent_to_teams_map]
            original_map = [q["user_query"] for q in filtered_queries]

            if not filtered_queries:
                return []

            # Step 4: Normalize queries
            queries = [self.normalize_query(q["user_query"]) for q in filtered_queries]

            # Step 5: Handle case with 2 or fewer queries (OPTIMIZED)
            if len(queries) <= 2:
                # Collect unique master_agent_ids and sub_agent_ids
                m_ids = list(set(q.get("master_agent_id") for q in filtered_queries if q.get("master_agent_id")))
                s_ids = list(set(q.get("agent_id") for q in filtered_queries if q.get("agent_id")))
                all_agent_ids = list(set(m_ids + s_ids))

                # Bulk fetch all agent details
                agents_data = self._query_db(
                    'agent',
                    {'type': 'find', 'filter': {"agent_id": {"$in": all_agent_ids}}, 'projection': {"_id": 0}}
                )
                agent_details_map = {a['agent_id']: a for a in agents_data}

                result = []
                for q in filtered_queries:
                    m_id, s_id = q.get("master_agent_id"), q.get("agent_id")
                    m_details = agent_details_map.get(m_id)
                    s_details = agent_details_map.get(s_id)
                    
                    agent_with_sub = None
                    if m_details:
                        agent_with_sub = dict(m_details)
                        agent_with_sub["subagent"] = s_details if s_details else {}

                    result.append({
                        "query": q["user_query"],
                        "count": 1,
                        "updated_ts": q["updated_ts"],
                        "agent": agent_with_sub,
                        "similar_queries": [q["user_query"]]
                    })
                return result

            # Step 6: Perform clustering for more than 2 queries
            from sklearn.feature_extraction.text import TfidfVectorizer
            from sklearn.metrics.pairwise import cosine_similarity
            from sklearn.cluster import AgglomerativeClustering

            vectorizer = TfidfVectorizer()
            X = vectorizer.fit_transform(queries)
            distance_matrix = 1 - cosine_similarity(X)
            
            clustering = AgglomerativeClustering(
                n_clusters=None, metric="precomputed", linkage="average", distance_threshold=0.5
            )
            labels = clustering.fit_predict(distance_matrix)
            clusters = self.cluster_data(labels, original_map, filtered_queries)
            result = self.cluster_result(clusters)

            # Step 7: Sort and return top 4
            result.sort(key=lambda x: (
                -x["count"],
                -x["updated_ts"].timestamp() if hasattr(x["updated_ts"], "timestamp") else x["updated_ts"]
            ))

            return result[:4]
        
        except Exception as e:
            print(f"Error in fetch_popular_queries: {e}")
            return []
    
 
 
    def cluster_data(self, labels, original_map, raw_queries):
        clusters = {}
        for idx, label in enumerate(labels):
            if label not in clusters:
                clusters[label] = {
                    "queries": [],
                    "count": 0,
                    "updated_ts": None
                }
            clusters[label]["queries"].append(original_map[idx])
            clusters[label]["count"] += 1
            ts = raw_queries[idx]["updated_ts"]
            clusters[label]["updated_ts"] = max(clusters[label]["updated_ts"], ts) if clusters[label]["updated_ts"] else ts
            
        return clusters

    def cluster_result(self, clusters):
        result = []
        for label, c in clusters.items():
            query_text = c["queries"][0]
            doc_operation = {
                'type': 'find_one',
                'filter': {"user_query": query_text},
                'projection': {"master_agent_id": 1, "agent_id": 1, "_id": 0}
            }
            doc = self._query_db('chatbot_tracking', doc_operation)
            master_agent_id = doc.get("master_agent_id") if doc else None
            agent_id = doc.get("agent_id") if doc else None

            master_agent_details, sub_agent_details, agent_with_sub = None, None, None
            if master_agent_id:
                master_operation = {
                    'type': 'find_one',
                    'filter': {"agent_id": master_agent_id,"$or": [
                        {"isDeleted": {"$ne": True}},
                        {"isDeleted": {"$exists": False}}
                    ]},
                    'projection': {"_id": 0}
                }
                master_agent_details = self._query_db('agent', master_operation)
            if agent_id:
                sub_operation = {
                    'type': 'find_one',
                    'filter': {"agent_id": agent_id,"$or": [
                        {"isDeleted": {"$ne": True}},
                        {"isDeleted": {"$exists": False}}
                    ]},
                    'projection': {"_id": 0}
                }
                sub_agent_details = self._query_db('agent', sub_operation)
            if master_agent_details:
                agent_with_sub = dict(master_agent_details)
                agent_with_sub["subagent"] = sub_agent_details if sub_agent_details else {}

            # Skip if agent or subagent is missing
            if not agent_with_sub or not sub_agent_details:
                continue  # Skip this query if either agent or subagent is missing

            result.append({
                "query": query_text,
                "count": c["count"],
                "updated_ts": c["updated_ts"],
                "agent": agent_with_sub,
                "similar_queries": c["queries"]
            })
        return result

    def update_feedback_dtls(self, data, user_type=None):
        agent_id = data.get("agent_id", "")
        rating = data.get("rating", "")
        feedback = data.get("feedback", "")
        user_id = data.get("user_id", "")

        update_doc = {}
        if rating != "":
            update_doc["rating"] = rating
        if feedback != "":
            update_doc["feedback"] = feedback
        if user_id != "":
            update_doc["updated_by"] = user_id

            operation = {
                'type': 'update_one',
                'filter': {"agent_id": agent_id},
                'update': {"$set": update_doc}
            }
            
            self._query_db('agent', operation, user_type)
            
            tracking_doc = {}
            if rating != "":
                tracking_doc["feedback_rating"] = rating
            if feedback != "":
                tracking_doc["feedback_comments"] = feedback

            print("tracking_doc", tracking_doc)
            print("agnet_id", agent_id)
            
            find_latest_operation = {
            'type': 'find_one',
            'filter': {"agent_id": agent_id},
            'sort': [("created_ts", -1)]        
        }

            latest_record = self._query_db('chatbot_tracking', find_latest_operation, user_type)

            if not latest_record or "event_id" not in latest_record:
                raise ValidationError("No recent conversation found for this agent")

            latest_event_id = latest_record["event_id"]
            print(f"Found latest event_id: {latest_event_id} for agent_id: {agent_id}")

            # === STEP 2: Update the record with that exact event_id (and agent_id) ===
            tracking_operation = {
                'type': 'update_one',
                'filter': {
                    
                    "event_id": latest_event_id
                },
                'update': {"$set": tracking_doc}
            }
            result = self._query_db('chatbot_tracking', tracking_operation, user_type)

            return True
         
            
    def update_review_feedback_dtls(self,data):
        agent_id = data.get("agent_id", "")
        unique_id = data.get("unique_id", "")  
        rating = data.get("rating", "")
        feedback = data.get("feedback", "")
        event_id= data.get("event_id", "")
        user_id = data.get("user_id", "")
        print("y",feedback)
        print("y",agent_id)
        print("z",unique_id)


        # Build the update document
        update_doc = {}
        if rating != "":
            update_doc["rating"] = rating
        if feedback != "":
            update_doc["feedback"] = feedback
        if user_id != "":
            update_doc["updated_by"] = user_id

        # Assuming agent_collection is a valid PyMongo collection object
        # self.agent_collection.update_one(
            # {"agent_id": agent_id},
            # {"$set": update_doc}
        # )
        # self.event_agency_tracking_collection.update_one(
            # {"agent_id": agent_id, "event_id": event_id,"unique_id": unique_id},  # find specific record
            # {"$set": update_doc}, 
            # upsert=True  # insert if not exists
        # )
        self.event_agency_tracking_collection.update_one(
            {"agent_id": agent_id, "event_id": event_id, "event_unique_id": unique_id}, # find specific record
            {"$set": update_doc}
            
        )
        # find_op = {
        #     'type': 'find_one',
        #     'filter': {
        #         "agent_id": agent_id,
        #         "event_id": event_id,
        #         "unique_id": unique_id
        #     }
        # }

        update_op = {
            'type': 'update_one',
            'filter': {
                "agent_id": agent_id,
                "event_id": event_id,
                "event_unique_id": unique_id
            },
            'update': {
                "$set": update_doc
            }
        }

        self._query_db('event_agency_tracking', update_op)

        

        # Execute the operations
        # existing = self._query_db('event_agency_tracking_collection', find_op)
        # if existing:
            
        # else:
        #     self._query_db('event_agency_tracking_collection', insert_op)


        

        track = self.event_agency_tracking_collection.find(
            {"event_id": event_id,},  # find specific record
            {"_id":0}
                # insert if not exists
        )
        all_have_feedback = True
        ratings=[]

# Iterate through all documents in the track cursor
        for document in track:
            if "feedback" not in document:
                all_have_feedback = False
                
            if "rating" in document:
                ratings.append(document["rating"])

        if all_have_feedback:
            average_rating = sum(ratings) / len(ratings) if ratings else 0
            self.agent_collection.update_one({"agent_id": agent_id}, {"$set": {"rating": average_rating}})
            self.agent_tracking_collection.update_one(
            {
                "agent_id": agent_id,
                "event_id": event_id,
                "agent_status": "completed"
                    # match at least one false flag
            },
            {
                "$set": { "action.1.flag": True }
            }
        )
            updates_op = {
            'type': 'update_one',
            'filter': {
                "agent_id": agent_id,
                "event_id": event_id,
                "agent_status": "completed"
                
            },
            'update': {
                "$set": { "action.1.flag": True }
            }
        }    
            self._query_db('agent_tracking', updates_op)


        return True
 
            
    # def update_review_feedback_dtls(self, data, user_type=None):
        # try:
            # agent_id = data.get("agent_id", "")
            # rating = data.get("rating", "")
            # feedback = data.get("feedback", "")
            # user_id = data.get("user_id", "")
            # unique_id = data.get("unique_id", "")
            # event_id = data.get("event_id", "")

            # update_doc = {}
            # if rating != "":
                # update_doc["rating"] = rating
            # if feedback != "":
                # update_doc["feedback"] = feedback
            # if user_id != "":
                # update_doc["updated_by"] = user_id

            # operation = {
                # 'type': 'update_one',
                # 'filter': {"agent_id": agent_id, "event_unique_id": unique_id, "event_id": event_id},
                # 'update': {"$set": update_doc}
            # }
            # self._query_db('event_agency_tracking', operation, user_type)

            # return jsonify({"Success": True, "Message": "Feedback updated successfully"})

        # except Exception as ex:
            # logging.error("Error in update_feedback_dtls:", exc_info=True)
            # return jsonify({"Success": False, "Message": str(ex)}), 500
            
        