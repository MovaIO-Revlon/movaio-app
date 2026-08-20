from datetime import datetime, timezone
from bson.objectid import ObjectId
from utils import NotFoundError
from commonutils import DatabaseCollections
from database_manager import DatabaseManager
from session_manager import get_current_user
from config_loader import ConfigLoader
from collections import defaultdict
import mlflow
import mlflow.genai.scorers as mlflow_scorers
from mlflow.genai.scorers import Correctness, RelevanceToQuery, Safety, Fluency, Completeness
from mlflow.entities import Feedback
import pandas as pd
import re
from datetime import datetime, timezone
import json
import time
import requests
import numpy as np
 



class PromptRepository(DatabaseCollections):
    def __init__(self):
        super().__init__()
        self.db = DatabaseManager()
        self.config = ConfigLoader()
        from agencyManage import AgencyManager
        self.agency_manager = AgencyManager()
    
    def _query_db(self, collection_name, operation, user_type=None):
        """Helper method to query database with user type"""
        if user_type is None:
            try:
                current_user = get_current_user()
                prj_name = current_user.get('ActiveProject', self.config.config["MONGODB_COLLECTION_NAME_MASTER"])
                user_type = self.project.find_one({'projectName': prj_name})['database_name']
            except:
                user_type = self.config.config["MONGODB_COLLECTION_NAME_MASTER"]
        
        if user_type == 'master':
            user_type = self.config.config["MONGODB_COLLECTION_NAME_MASTER"]
        
        return self.db.execute_query(
            collection_name,
            operation,
            condition_func=self._select_database_by_user_type,
            user_type=user_type
        )

    def _select_database_by_user_type(self, user_type):
        """Database selection logic"""
        return user_type

    # === Enhanced Existing Methods ===
    def get_agent_queries(self, agent_id, user_type=None):
        """Fetch all queries for a specific agent from chatbot_tracking"""
        query_op = {
            'type': 'find',
            'filter': {
                "agent_id": agent_id, 
                "status": "completed",
                "isSavedToRepo": { "$ne": False },
                "$or": [
                    {"is_deleted": {"$exists": False}},
                    {"is_deleted": False}
                ]
            },
            'sort': [("created_ts", -1)]
        }
        return self._query_db('chatbot_tracking', query_op, user_type)

    def get_deduplicated_queries(self, agent_id, user_type=None):
        """Get only the best executed query for each unique user query.
        Priority: Highest accuracy → Latest updated_ts"""
        all_queries = self.get_agent_queries(agent_id, user_type)
        if not all_queries:
            return []
        
        # Group by user_query
        query_map = defaultdict(list)
        
        for query in all_queries:
            user_query = query.get("user_query", "").strip()
            if not user_query:
                continue
            query_map[user_query].append(query)
        
        # Select best record per group
        result = []
        
        for user_query, records in query_map.items():
            if not records:
                continue
                
            # Sort with priority: highest accuracy first, then latest updated_ts
            best_record = max(records, key=lambda q: (
                self._get_accuracy_score(q),          # Primary: Highest accuracy
                q.get("updated_ts") or q.get("created_ts") or datetime.min  # Secondary: Latest time
            ))
            
            # Add execution count
            best_record = best_record.copy()
            best_record["execution_count"] = len(records)
            
            result.append(best_record)
        
        # Sort final result by updated_ts (newest first)
        result.sort(key=lambda x: x.get("updated_ts") or x.get("created_ts") or datetime.min, reverse=True)
        
        return result


    def _get_accuracy_score(self, query):
        """Extract accuracy score from metrics or detailed_results"""
        # Priority 1: metrics dict
        if isinstance(query.get("metrics"), dict):
            acc = query["metrics"].get("accuracy/mean")
            if acc is not None:
                return float(acc)
        
        # Priority 2: detailed_results
        if isinstance(query.get("detailed_results"), list) and query["detailed_results"]:
            first = query["detailed_results"][0]
            acc = first.get("accuracy/value") or first.get("accuracy/mean")
            if acc is not None:
                return float(acc)
        
        # Default fallback
        return 0.0
 
 

    def get_agent_stats(self, agent_id, user_type=None):
        """Calculate usage stats for an agent"""
        queries = self.get_agent_queries(agent_id, user_type)
        if not queries:
            return {"usage_count": 0, "average_rating": 0, "last_used": None}
        
        ratings = [q.get("feedback_rating", 0) for q in queries if q.get("feedback_rating")]
        average_rating = sum(ratings) / len(ratings) if ratings else 0
        
        last_used = max([q.get("created_ts") for q in queries])
        
        return {
            "usage_count": len(queries),
            "average_rating": round(average_rating, 1),
            "last_used": last_used
        }

    # === New Prompt Management Methods ===
    def save_promptrepo(self, agency_id, agent_id, prompt_title, user_query,map_id,created_by,user_type=None):
        """Save a new prompt to prompt_repo collection with soft delete flag"""
        
        prompt_data = {
            "agency_id": agency_id,
            "agent_id": agent_id,
            "prompt_title": prompt_title,
            "user_query": user_query,
            "map_id": map_id,
            "created_by": created_by,
            "created_ts": datetime.now(timezone.utc),
            "updated_ts": datetime.now(timezone.utc),
            "is_deleted": False  # Soft delete flag
        }
        
        insert_op = {'type': 'insert_one', 'document': prompt_data}
        result = self._query_db('prompt_repo', insert_op, user_type)
        
        inserted_id = result.get('inserted_id') if isinstance(result, dict) else result.inserted_id
        
        return {
            "success": True,
            "message": "Prompt saved successfully",
            "prompt_id": str(inserted_id)
        }

    def get_stored_prompts(self, agency_id: str, agent_id: str, user_type=None):
        """Get only prompts that are NOT executed (is_executed = false or missing)"""
        query_op = {
            'type': 'find',
            'filter': {
                "agency_id": agency_id,
                "agent_id": agent_id,
                "$or": [
                    {"is_executed": {"$exists": False}},
                    {"is_executed": False}
                ],
                "$or": [
                    {"is_deleted": {"$exists": False}},
                    {"is_deleted": False}
                ]
            },
            'sort': [("created_ts", -1)]
        }
        
        stored_prompts = self._query_db('prompt_repo', query_op, user_type) or []
        
        non_executed_prompts = []
        for prompt in stored_prompts:
            formatted = prompt.copy()
            formatted.update({
                "prompt_id": str(prompt.get("_id")),
                "status": "stored",
                "is_stored_prompt": True,
                "execution_count": 0,
                "source": "prompt_repo"
            })
            non_executed_prompts.append(formatted)
        
        return non_executed_prompts

    def is_prompt_executed(self, agent_id, prompt_title, user_query, user_type=None):
        """Check if prompt is executed (either in prompt_repo or chatbot_tracking)"""
        try:
            # First check if prompt_repo has it marked as executed
            query_op_repo = {
                'type': 'find_one',
                'filter': {
                    "agent_id": agent_id,
                    "prompt_title": prompt_title,
                    "user_query": user_query,
                    "is_executed": True
                }
            }
            result_repo = self._query_db('prompt_repo', query_op_repo, user_type)
            if result_repo:
                return True
            
            # Then check chatbot_tracking for completed status
            query_op_chatbot = {
                'type': 'find_one',
                'filter': {
                    "agent_id": agent_id,
                    "prompt_title": prompt_title,
                    "user_query": user_query,
                    "status": "completed",
                    "$or": [
                        {"is_deleted": {"$exists": False}},
                        {"is_deleted": False}
                    ]
                }
            }
            result_chatbot = self._query_db('chatbot_tracking', query_op_chatbot, user_type)
            return result_chatbot is not None
        except:
            return False

    def update_prompt_in_repo(self, agent_id, prompt_title, user_query, user_type=None):
        """Update prompt in prompt_repo (simplified)"""
        update_op = {
            'type': 'update_one',
            'filter': {
                "agency_id": agent_id,
                "agent_id": agent_id,  # Added agent_id to filter
                "prompt_title": prompt_title,
                "user_query": user_query,
                "$or": [
                    {"is_deleted": {"$exists": False}},
                    {"is_deleted": False}
                ]
            },
            'update': {
                "$set": {
                    "prompt_title": prompt_title,  # Use the same value
                    "user_query": user_query,       # Use the same value
                    "updated_ts": datetime.now(timezone.utc)
                }
            }
        }
        result = self._query_db('prompt_repo', update_op, user_type)
        return {"success": True, "message": "Updated in prompt_repo"}

    def update_prompt_in_both_collections(self, agent_id, prompt_title, user_query, user_type=None):
        """Update in both collections (simplified)"""
        # Update prompt_repo (has agency_id)
        self.update_prompt_in_repo(
            agent_id=agent_id,
            prompt_title=prompt_title,
            user_query=user_query,
            user_type=user_type
        )
        
        # Update chatbot_tracking (doesn't have agency_id)
        update_op = {
            'type': 'update_many',
            'filter': {
                "agent_id": agent_id,
                "prompt_title": prompt_title,
                "user_query": user_query,
                "$or": [
                    {"is_deleted": {"$exists": False}},
                    {"is_deleted": False}
                ]
            },
            'update': {
                "$set": {
                    "prompt_title": prompt_title,  # Use the same value
                    "user_query": user_query,       # Use the same value
                    "updated_ts": datetime.now(timezone.utc)
                }
            }
        }
        result = self._query_db('chatbot_tracking', update_op, user_type)
        
        return {"success": True, "message": "Updated in both collections"}

    def soft_delete_prompt_in_repo(self, agent_id, prompt_title, user_query, user_type=None):
        """Soft delete prompt in prompt_repo"""
        update_op = {
            'type': 'update_one',
            'filter': {
                "agent_id": agent_id,
                "prompt_title": prompt_title,
                "user_query": user_query,
                "$or": [
                    {"is_deleted": {"$exists": False}},
                    {"is_deleted": False}
                ]
            },
            'update': {
                "$set": {
                    "is_deleted": True,
                    "updated_ts": datetime.now(timezone.utc)
                }
            }
        }
        result = self._query_db('prompt_repo', update_op, user_type)
        return {"success": True, "message": "Soft deleted in prompt_repo"}

    def soft_delete_prompt_in_both_collections(self, agent_id, prompt_title, user_query, user_type=None):
        """Soft delete prompt in both collections"""
        self.soft_delete_prompt_in_repo(agent_id, prompt_title, user_query, user_type)
        
        update_op = {
            'type': 'update_many',
            'filter': {
                "agent_id": agent_id,
                "prompt_title": prompt_title,
                "user_query": user_query,
                "$or": [
                    {"is_deleted": {"$exists": False}},
                    {"is_deleted": False}
                ]
            },
            'update': {
                "$set": {
                    "isSavedToRepo":False,
                    "updated_ts": datetime.now(timezone.utc)
                }
            }
        }
        result = self._query_db('chatbot_tracking', update_op, user_type)
        
        return {"success": True, "message": "Soft deleted in both collections"}

    def get_stored_prompts_excluding_executed(self, agency_id: str, agent_id: str, user_type=None):
        """Get only non-executed stored prompts.
        Exclude any prompt that has a corresponding executed version in chatbot_tracking."""
        
        # First get all executed event_ids / prompt signatures from chatbot
        executed_op = {
            'type': 'find',
            'filter': {
                "agent_id": agent_id,
                "status": "completed",
                "isSavedToRepo": True,
                "$or": [{"is_deleted": {"$exists": False}}, {"is_deleted": False}]
            },
            'projection': {"user_query": 1, "prompt_title": 1, "event_id": 1}
        }
        executed_list = self._query_db('chatbot_tracking', executed_op, user_type) or []
        
        # Create a set of unique signatures to exclude
        exclude_signatures = set()
        for ex in executed_list:
            signature = (ex.get("prompt_title"), ex.get("user_query"))
            if signature[0] or signature[1]:  # at least one field
                exclude_signatures.add(signature)
        
        # Now fetch stored prompts, excluding the above
        query_op = {
            'type': 'find',
            'filter': {
                "agency_id": agency_id,
                "agent_id": agent_id,
                "$or": [
                    {"is_executed": {"$exists": False}},
                    {"is_executed": False}
                ],
                "$or": [
                    {"is_deleted": {"$exists": False}},
                    {"is_deleted": False}
                ]
            },
            'sort': [("created_ts", -1)]
        }
        
        stored_prompts = self._query_db('prompt_repo', query_op, user_type) or []
        
        non_executed_prompts = []
        for prompt in stored_prompts:
            signature = (prompt.get("prompt_title"), prompt.get("user_query"))
            
            # Skip if this prompt was already executed and saved to repo
            if signature in exclude_signatures:
                continue
                
            formatted = prompt.copy()
            formatted.update({
                "prompt_id": str(prompt.get("_id")),
                "status": "stored",
                "is_stored_prompt": True,
                "execution_count": 0,
                "source": "prompt_repo"
            })
            non_executed_prompts.append(formatted)
        
        return non_executed_prompts
    
    def get_stored_prompts_excluding_executed_by_map_id(self, agency_id: str, agent_id: str, user_type=None):
        """Get stored prompts from prompt_repo, but exclude any that exist in chatbot_tracking by map_id"""
        
        # Get all map_ids that are already executed/saved in chatbot_tracking
        executed_map_ids = set()
        executed_op = {
            'type': 'find',
            'filter': {
                "agent_id": agent_id,
                "isSavedToRepo": { "$ne": False },
                "map_id": {"$exists": True, "$ne": None}
            },
            'projection': {"map_id": 1}
        }
        executed_list = self._query_db('chatbot_tracking', executed_op, user_type) or []
        
        for ex in executed_list:
            if ex.get("map_id"):
                executed_map_ids.add(ex["map_id"])
        
        # Now fetch stored prompts, excluding those map_ids
        query_op = {
            'type': 'find',
            'filter': {
                "agency_id": agency_id,
                "agent_id": agent_id,
                "map_id": {"$nin": list(executed_map_ids)},   # Exclude executed map_ids
                "$or": [
                    {"is_executed": {"$exists": False}},
                    {"is_executed": False}
                ],
                "$or": [
                    {"is_deleted": {"$exists": False}},
                    {"is_deleted": False}
                ],
            },
            'sort': [("created_ts", -1)]
        }
        
        stored_prompts = self._query_db('prompt_repo', query_op, user_type) or []
        
        non_executed_prompts = []
        for prompt in stored_prompts:
            formatted = prompt.copy()
            formatted.update({
                "prompt_id": str(prompt.get("_id")),
                "status": "stored",
                "is_stored_prompt": True,
                "execution_count": 0,
                "source": "prompt_repo"
            })
            non_executed_prompts.append(formatted)
        
        return non_executed_prompts

    def get_agency_with_agents_promptrepo(self, user_type=None):
        """Get agencies with agents that have user queries.
        PRIORITY: chatbot_tracking (when map_id matches) > prompt_repo
        Ensures all entries have a prompt_title field (defaulting to 'No Title' if missing)"""
        
        agencies_data = self.agency_manager.get_agency_with_agents_details(user_type)
        
        filtered_agencies = []
        
        for agency in agencies_data:
            agency_id = agency.get("agency_id")
            agency_has_active_agents = False
            agents_with_queries = []
            
            for agent in agency.get("agents", []):
                agent_id = agent.get("agent_id")
                
                # 1. Get executed queries from chatbot_tracking (HIGHEST PRIORITY)
                executed_queries = self.get_deduplicated_queries(agent_id, user_type) or []
                
                # 2. Get stored prompts from prompt_repo, but EXCLUDE those already in chatbot_tracking by map_id
                stored_prompts = self.get_stored_prompts_excluding_executed_by_map_id(
                    agency_id, agent_id, user_type
                ) or []
                
                # Combine queries (executed first, then stored)
                all_queries = executed_queries + stored_prompts
                
                # Ensure all queries have a prompt_title field
                for query in all_queries:
                    if "prompt_title" not in query:
                        query["prompt_title"] = "No Title"
                
                # Get agent stats
                stats = self.get_agent_stats(agent_id, user_type)
                
                # Update agent with queries
                agent["queries"] = all_queries
                agent["usage_count"] = stats["usage_count"]
                agent["average_rating"] = stats["average_rating"]
                agent["last_used"] = stats["last_used"]
                
                if all_queries:
                    agents_with_queries.append(agent)
                    agency_has_active_agents = True
            
            if agency_has_active_agents:
                agency["agents"] = agents_with_queries
                filtered_agencies.append(agency)
        
        return filtered_agencies

    def has_any_user_queries(self, agency_id, agent_id, user_type=None):
        """Check if agent has any user queries (executed OR stored)"""
        try:
            # Check executed in chatbot_tracking
            executed_op = {
                'type': 'find_one',
                'filter': {
                    "agent_id": agent_id,
                    "status": "completed",
                    "isSavedToRepo": { "$ne": False },
                    "$or": [{"is_deleted": {"$exists": False}}, {"is_deleted": False}]
                }
            }
            has_executed = self._query_db('chatbot_tracking', executed_op, user_type) is not None
            
            # Check non-executed stored prompts
            stored_op = {
                'type': 'find_one',
                'filter': {
                    "agency_id": agency_id,
                    "agent_id": agent_id,
                    "$or": [{"is_executed": {"$exists": False}}, {"is_executed": False}],
                    "$or": [{"is_deleted": {"$exists": False}}, {"is_deleted": False}]
                }
            }
            has_stored = self._query_db('prompt_repo', stored_op, user_type) is not None
            
            return has_executed or has_stored
        except:
            return False

    def create_mlflow_logic_scorer(self, mlflow_scorer_class, custom_name):
        """Create MLflow logic scorer using judge agent"""
        base_instance = mlflow_scorer_class()
        official_rubric = base_instance.instructions

        def score_logic(inputs, outputs, expectations):
            user_query = inputs.get("user_query", "")
            prompt_output = inputs.get("prompt_output", "")
            
            prompt = f"""You are an expert evaluator. {official_rubric}

**USER QUERY**:
{user_query}

**AGENT RESPONSE**:
{prompt_output}

Return **ONLY** valid JSON:
{{
"score": <float 0.0-1.0>,
"rationale": "detailed explanation"
}}"""
            
            raw_res = self.call_judge_agent(prompt)
            data = self.safe_parse_json(raw_res)
            if data:
                return Feedback(value=float(data.get("score", 0.0)), rationale=data.get("rationale", ""))
            return Feedback(value=0.0, rationale="Parse Error")

        score_logic.__name__ = custom_name
        # ✅ Correct usage
        return mlflow_scorers.scorer(score_logic)

    def create_custom_judge(self, custom_name, grading_instructions):
        """Create custom judge scorer using judge agent"""
        
        def lyzr_judge_executor(inputs, outputs, expectations):
            user_query = inputs.get("user_query", "")
            prompt_output = inputs.get("prompt_output", "")
            
            prompt = f"""{grading_instructions}

**USER QUERY**:
{user_query}

**AGENT RESPONSE**:
{prompt_output}

Return ONLY valid JSON:
{{
"score": <float 0-1>,
"rationale": "detailed explanation"
}}"""
            
            raw_res = self.call_judge_agent(prompt)
            data = self.safe_parse_json(raw_res)
            if data:
                print(f"✅ {custom_name} PARSED SUCCESSFULLY: score = {data.get('score')}")
                return Feedback(value=float(data.get("score", 0.0)), rationale=data.get("rationale", ""))
            return Feedback(value=0.0, rationale="Judge Parse Error")

        lyzr_judge_executor.__name__ = custom_name
        # ✅ Correct usage
        return mlflow_scorers.scorer(lyzr_judge_executor)

    def safe_parse_json(self, raw_res):
        """Robust JSON parser that handles json_object wrapper, markdown, and partial JSON."""
        if not raw_res:
            return None
        
        # Handle full Lyzr response wrapper (dict)
        if isinstance(raw_res, dict):
            raw_res = raw_res.get('response') or raw_res.get('output') or raw_res

        if isinstance(raw_res, dict):
            return raw_res  # already a dict

        if not isinstance(raw_res, str):
            return None

        raw = raw_res.strip()

        # 1. Direct JSON parse
        try:
            return json.loads(raw)
        except:
            pass

        # 2. Strip markdown/code blocks
        cleaned = re.sub(r'^```(?:json)?\s*', '', raw, flags=re.IGNORECASE)
        cleaned = re.sub(r'```\s*$', '', cleaned).strip()

        try:
            return json.loads(cleaned)
        except:
            pass

        # 3. Regex fallback - extract JSON object
        json_match = re.search(r'(\{[\s\S]*?\})', cleaned, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except:
                pass

        # 4. Score + rationale fallback
        score_match = re.search(r'"?score"?\s*[:=]\s*([0-9.]+)', cleaned, re.IGNORECASE)
        if score_match:
            try:
                score = float(score_match.group(1))
                rationale_match = re.search(r'"?rationale"?\s*[:=]\s*["\']?([\s\S]*?)(?=\s*["\']?\s*[,}\n]|$)', 
                                        cleaned, re.IGNORECASE | re.DOTALL)
                rationale = rationale_match.group(1).strip() if rationale_match else "No rationale provided"
                rationale = re.sub(r'^["\']|["\']$', '', rationale).strip()
                return {"score": score, "rationale": rationale}
            except:
                pass

        print(f"[WARN] safe_parse_json failed: {raw[:600]}...")
        return None

    def call_judge_agent(self, prompt, max_retries=3, backoff_factor=2):
        """Call judge agent with robust retry logic for empty responses."""
        
        print("=== PROMPT SENT TO JUDGE ===")
        print(prompt[:1500] + "..." if len(prompt) > 1500 else prompt)
        print("============================\n")

        judge_config = self.config.config.get("judge_agent", {})
        api_key = judge_config.get("x_api_key", "")
        agent_id = judge_config.get("agent_id", "")
        agent_api_url = judge_config.get("Agent_api_url", "")
        user_id = judge_config.get("user_id", "evaluator")

        if not all([api_key, agent_id, agent_api_url]):
            print("❌ Judge agent configuration missing")
            return "ERROR: Judge agent configuration missing in config.json"

        for attempt in range(max_retries + 1):
            try:
                session_id = judge_config.get("session_id", f"eval_{int(time.time())}")
                payload = {
                    "user_id": user_id,
                    "agent_id": agent_id,
                    "session_id": session_id,
                    "message": prompt.strip()
                }
                headers = {
                    'Content-Type': 'application/json',
                    'x-api-key': api_key,
                    'Accept': 'application/json'
                }

                print(f"🔍 [Judge] Attempt {attempt + 1}/{max_retries + 1} → {agent_api_url} | Session: {session_id}")

                response = requests.post(
                    agent_api_url,
                    headers=headers,
                    json=payload,
                    timeout=120
                )

                print(f"🔍 [Judge] Status Code: {response.status_code}")

                response.raise_for_status()
                result = response.json()

                print("=== FULL RAW RESPONSE FROM JUDGE ===")
                print(json.dumps(result, indent=2))
                print("====================================\n")

                # Extract output
                output = result.get('response') or result.get('output') or ""
                if isinstance(output, dict):
                    output = output.get('response') or output.get('output') or json.dumps(output)

                output_str = str(output).strip()

                if output_str:
                    print(f"✅ Extracted output length: {len(output_str)} chars")
                    return output_str
                else:
                    print(f"⚠️  Empty response received from judge (Attempt {attempt + 1})")
                    if attempt < max_retries:
                        continue  # Explicitly retry on empty response

            except requests.exceptions.RequestException as e:
                print(f"❌ Request failed (Attempt {attempt + 1}): {e}")
                if hasattr(e, 'response') and e.response is not None:
                    print(f"❌ Response body: {e.response.text[:600]}")
            except Exception as e:
                print(f"❌ Unexpected error (Attempt {attempt + 1}): {e}")

            # Retry delay (only if not last attempt)
            if attempt < max_retries:
                sleep_time = backoff_factor * (2 ** attempt)
                print(f"⏳ Retrying in {sleep_time:.1f} seconds...")
                time.sleep(sleep_time)

        print("❌ Judge agent failed after all retries (empty or error responses)")
        return "ERROR: Judge agent returned empty response after maximum retries"
    
    def call_title_recover_agent(self, prompt, max_retries=3, backoff_factor=2):
        """Call judge agent with robust retry logic for empty responses."""

        judge_config = self.config.config.get("title_recovery_agent", {})
        api_key = judge_config.get("x_api_key", "")
        agent_id = judge_config.get("agent_id", "")
        agent_api_url = judge_config.get("Agent_api_url", "")
        user_id = judge_config.get("user_id", "evaluator")

        if not all([api_key, agent_id, agent_api_url]):
            print("❌ Judge agent configuration missing")
            return "ERROR: Judge agent configuration missing in config.json"

        for attempt in range(max_retries + 1):
            try:
                session_id = judge_config.get("session_id", f"eval_{int(time.time())}")
                payload = {
                    "user_id": user_id,
                    "agent_id": agent_id,
                    "session_id": session_id,
                    "message": prompt.strip()
                }
                headers = {
                    'Content-Type': 'application/json',
                    'x-api-key': api_key,
                    'Accept': 'application/json'
                }

                print(f"🔍 [Judge] Attempt {attempt + 1}/{max_retries + 1} → {agent_api_url} | Session: {session_id}")

                response = requests.post(
                    agent_api_url,
                    headers=headers,
                    json=payload,
                    timeout=120
                )

                print(f"🔍 [Judge] Status Code: {response.status_code}")

                response.raise_for_status()
                result = response.json()

                print("=== FULL RAW RESPONSE FROM JUDGE ===")
                print(json.dumps(result, indent=2))
                print("====================================\n")

                # Extract output
                output = result.get('response') or result.get('output') or ""
                if isinstance(output, dict):
                    output = output.get('response') or output.get('output') or json.dumps(output)

                output_str = str(output).strip()

                if output_str:
                    print(f"✅ Extracted output length: {len(output_str)} chars")
                    return output_str
                else:
                    print(f"⚠️  Empty response received from judge (Attempt {attempt + 1})")
                    if attempt < max_retries:
                        continue  # Explicitly retry on empty response

            except requests.exceptions.RequestException as e:
                print(f"❌ Request failed (Attempt {attempt + 1}): {e}")
                if hasattr(e, 'response') and e.response is not None:
                    print(f"❌ Response body: {e.response.text[:600]}")
            except Exception as e:
                print(f"❌ Unexpected error (Attempt {attempt + 1}): {e}")

            # Retry delay (only if not last attempt)
            if attempt < max_retries:
                sleep_time = backoff_factor * (2 ** attempt)
                print(f"⏳ Retrying in {sleep_time:.1f} seconds...")
                time.sleep(sleep_time)

        print("❌ Judge agent failed after all retries (empty or error responses)")
        return "ERROR: Judge agent returned empty response after maximum retries"
    
    def call_analysis_instruction_agent(self, prompt, max_retries=3, backoff_factor=2):
        """Call judge agent with robust retry logic for empty responses."""
        
        print("=== PROMPT SENT TO JUDGE ===")
        print(prompt)
        print("============================\n")

        judge_config = self.config.config.get("analysis_instruction_agent", {})
        api_key = judge_config.get("x_api_key", "")
        agent_id = judge_config.get("agent_id", "")
        agent_api_url = judge_config.get("Agent_api_url", "")
        user_id = judge_config.get("user_id", "evaluator")

        if not all([api_key, agent_id, agent_api_url]):
            print("❌ Judge agent configuration missing")
            return "ERROR: Judge agent configuration missing in config.json"

        for attempt in range(max_retries + 1):
            try:
                session_id = judge_config.get("session_id", f"eval_{int(time.time())}")
                payload = {
                    "user_id": user_id,
                    "agent_id": agent_id,
                    "session_id": session_id,
                    "message": prompt.strip()
                }
                headers = {
                    'Content-Type': 'application/json',
                    'x-api-key': api_key,
                    'Accept': 'application/json'
                }

                print(f"🔍 [Judge] Attempt {attempt + 1}/{max_retries + 1} → {agent_api_url} | Session: {session_id}")

                response = requests.post(
                    agent_api_url,
                    headers=headers,
                    json=payload,
                    timeout=120
                )

                print(f"🔍 [Judge] Status Code: {response.status_code}")

                response.raise_for_status()
                result = response.json()

                print("=== FULL RAW RESPONSE FROM JUDGE ===")
                print(json.dumps(result, indent=2))
                print("====================================\n")

                # Extract output
                output = result.get('response') or result.get('output') or ""
                if isinstance(output, dict):
                    output = output.get('response') or output.get('output') or json.dumps(output)

                output_str = str(output).strip()

                if output_str:
                    print(f"✅ Extracted output length: {len(output_str)} chars")
                    return output_str
                else:
                    print(f"⚠️  Empty response received from judge (Attempt {attempt + 1})")
                    if attempt < max_retries:
                        continue  # Explicitly retry on empty response

            except requests.exceptions.RequestException as e:
                print(f"❌ Request failed (Attempt {attempt + 1}): {e}")
                if hasattr(e, 'response') and e.response is not None:
                    print(f"❌ Response body: {e.response.text[:600]}")
            except Exception as e:
                print(f"❌ Unexpected error (Attempt {attempt + 1}): {e}")

            # Retry delay (only if not last attempt)
            if attempt < max_retries:
                sleep_time = backoff_factor * (2 ** attempt)
                print(f"⏳ Retrying in {sleep_time:.1f} seconds...")
                time.sleep(sleep_time)

        print("❌ Judge agent failed after all retries (empty or error responses)")
        return "ERROR: Judge agent returned empty response after maximum retries"
        
    def run_mlflow_evaluation(self, event_id, user_query, prompt_output, user_type=None):
        
        """Run MLflow evaluation using user_query and prompt_output"""
        try:
            print("metrics method entered")
            # Set up MLflow experiment
            mlflow.set_experiment("chatbot_metrics_evaluation")
            
            # Prepare evaluation data
            eval_data = [{
                "inputs": {
                    "user_query": user_query,
                    "prompt_output": prompt_output
                },
                "outputs": prompt_output
            }]
            
            # Define scorers (same as your provided code but simplified)
            scorers = [
                # self.create_mlflow_logic_scorer(Correctness, "correctness"),
                self.create_mlflow_logic_scorer(RelevanceToQuery, "relevance"),
                self.create_mlflow_logic_scorer(Safety, "safety"),
                # self.create_mlflow_logic_scorer(Completeness, "completeness"),
                # self.create_mlflow_logic_scorer(Fluency, "fluency"),
                self.create_custom_judge(
                    "correctness",
                    "Evaluate the factual consistency. Compare the reasoning steps and final answers against the Ground Truth. Penalize any hallucinations or logical fallacies."
                ),
                self.create_custom_judge(
                    "coherence",
                    "Assess the structure of the response. Is multi-step reasoning logical, naturally flowing, and well-organized?"
                ),
                self.create_custom_judge(
                    "conciseness",
                    "Evaluate whether the response provides necessary information clearly and efficiently without unnecessary verbosity."
                ),
                self.create_custom_judge(
                    "accuracy",
                    "Evaluate and measure the factual correctness of all claims, data points, and statements made in response."
                ),
                self.create_custom_judge(
                    "status",
                    "Evaluate operational finality. Score strictly 1 or 0. Assign 1 only if the agent successfully completed the response."
                ),
                # self.create_custom_judge(
                #     "hallucination_rate",
                #     "Isolate every factual claim and verify against context. Assign score from 0 to 1 where 0.0 means fully supported."
                # ),
                # self.create_custom_judge(
                #     "toxicity_score",
                #     "Scan for harmful content. Assign score from 0 to 1 where 0.0 means completely safe."
                # ),
                # self.create_custom_judge(
                #     "average",
                #     "Calculate the overall score by computing the arithmetic mean of all individual metric scores."
                # )
            ]
            
            print("🚀 Starting MLflow evaluation...")
            
            with mlflow.start_run(run_name=f"eval_{event_id}"):
                results = mlflow.genai.evaluate(
                    predict_fn=None,
                    data=eval_data,
                    scorers=scorers
                )
                
                
                # Prepare results for storage
                metrics = dict(results.metrics)
                for key, value in metrics.items():
                    # Check if the value is a float or numpy float, and if it is NaN
                    if isinstance(value, (float, np.floating)) and np.isnan(value):
                        metrics[key] = np.float64(0.0)
                detailed_results = []
                
                if results.tables and "eval_results" in results.tables:
                    detailed_results = results.tables["eval_results"].to_dict(orient="records")
                
                # Store metrics in database
                update_op = {
                    'type': 'update_one',
                    'filter': {'event_id': event_id},
                    'update': {
                        "$set": {
                            "metrics": metrics,
                            "detailed_results": detailed_results,
                            "evaluated_at": datetime.now(timezone.utc).isoformat()
                        }
                    }
                }
                self._query_db('chatbot_tracking', update_op)
                
                print(f"✅ MLflow evaluation completed for event_id: {event_id}")
                
        except Exception as e:
            print(f"❌ Error in MLflow evaluation for event_id {event_id}: {str(e)}")
            import traceback
            traceback.print_exc()