from datetime import datetime, timezone
from bson.objectid import ObjectId
from utils import NotFoundError
from commonutils import DatabaseCollections
from database_manager import DatabaseManager
from session_manager import get_current_user
from config_loader import ConfigLoader,config_loader
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
from database_manager import select_database_by_user_type
import requests



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
    def save_promptrepo(self, agency_id, agent_id, prompt_title, user_query,map_id, user_type=None):
        """Save a new prompt to prompt_repo collection with soft delete flag"""
        current_user = get_current_user()
        created_by = current_user.get("email", "unknown") if current_user else "unknown"
        
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
                return Feedback(value=float(data.get("score", 0.0)), rationale=data.get("rationale", ""))
            return Feedback(value=0.0, rationale="Judge Parse Error")

        lyzr_judge_executor.__name__ = custom_name
        # ✅ Correct usage
        return mlflow_scorers.scorer(lyzr_judge_executor)

    def safe_parse_json(self, raw_res):
        """Safely parse JSON response from LLM"""
        if not raw_res or not isinstance(raw_res, str):
            return None
        
        # Attempt 1: Direct JSON parse
        try:
            return json.loads(raw_res)
        except:
            pass
        
        # Attempt 2: Remove markdown code blocks then parse
        try:
            content = raw_res.strip()
            content = re.sub(r'^```(?:json)?\s*', '', content, flags=re.IGNORECASE)
            content = re.sub(r'```\s*$', '', content)
            return json.loads(content)
        except:
            pass
        
        # Attempt 3: Regex fallback (only if both JSON parses fail)
        content = raw_res.strip()
        content = re.sub(r'^```(?:json)?\s*', '', content, flags=re.IGNORECASE)
        content = re.sub(r'```\s*$', '', content)
        
        score_match = re.search(r'"?score"?\s*[:=]\s*([0-9.]+)', content, re.IGNORECASE)
        
        # Fixed regex: handles escaped quotes and quotes/apostrophes INSIDE the string
        rationale_match = re.search(r'"rationale"\s*:\s*"((?:[^"\\]|\\.)*)"', content, re.DOTALL)
        
        if not rationale_match:
            # Try single-quote variant
            rationale_match = re.search(r"'rationale'\s*:\s*'((?:[^'\\]|\\.)*?)'", content, re.DOTALL)
        
        if score_match:
            try:
                score = float(score_match.group(1))
                rationale = rationale_match.group(1).strip() if rationale_match else "No rationale"
                return {"score": score, "rationale": rationale}
            except:
                pass
        return None

    def call_judge_agent(self, prompt):

        """Call judge agent for evaluation using the judge_agent config"""

        judge_config = self.config.config.get("judge_agent", {})

        api_key = judge_config.get("x_api_key", "")

        agent_id = judge_config.get("agent_id", "")

        agent_api_url = judge_config.get("Agent_api_url", "")

        user_id = judge_config.get("user_id", "evaluator")

        session_id = judge_config.get("session_id", f"eval_{int(time.time())}")
 
        if not api_key or not agent_id or not agent_api_url:

            print("❌ Judge agent configuration missing")

            return "ERROR: Judge agent configuration missing in config.json"
        
        print("pppp",prompt.strip())
 
        try:

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
 
            print(f"🔍 [Judge] Calling → {agent_api_url}")

            print(f"🔍 [Judge] Session ID: {session_id}")

            # print(f"🔍 [Judge] Prompt preview: {prompt[:300]}...")   # Uncomment only if needed
 
            response = requests.post(

                agent_api_url,

                headers=headers,

                json=payload,

                timeout=120

            )
 
            print(f"🔍 [Judge] Status Code: {response.status_code}")
 
            if response.status_code == 400:

                print(f"❌ [Judge] Bad Request Response: {response.text[:800]}")

                return f"ERROR: Bad Request - {response.text[:300]}"
 
            response.raise_for_status()

            result = response.json()
            print("rrr",result)

            return result.get('response', result.get('output', ''))
 
        except requests.exceptions.RequestException as e:

            print(f"❌ Judge agent call failed: {e}")

            if hasattr(e, 'response') and e.response is not None:

                print(f"❌ Response body: {e.response.text[:600]}")

            return f"ERROR: {str(e)}"

        except Exception as e:

            print(f"❌ Unexpected error in call_judge_agent: {e}")

            return f"ERROR: {str(e)}"
 


    def run_mlflow_evaluation(self, event_id, user_query, prompt_output,user_type):
        
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
                self.create_mlflow_logic_scorer(Correctness, "correctness"),
                self.create_mlflow_logic_scorer(RelevanceToQuery, "relevance"),
                self.create_mlflow_logic_scorer(Safety, "safety"),
                self.create_mlflow_logic_scorer(Completeness, "completeness"),
                self.create_mlflow_logic_scorer(Fluency, "fluency"),
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
                    "Evaluate the factual correctness of all claims, data points, and statements made in response."
                ),
                self.create_custom_judge(
                    "status",
                    "Evaluate operational finality. Score strictly 1 or 0. Assign 1 only if the agent successfully completed the response."
                ),
                self.create_custom_judge(
                    "hallucination_rate",
                    "Isolate every factual claim and verify against context. Assign score from 0 to 1 where 0.0 means fully supported."
                ),
                self.create_custom_judge(
                    "toxicity_score",
                    "Scan for harmful content. Assign score from 0 to 1 where 0.0 means completely safe."
                )
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
                self._query_db('chatbot_tracking', update_op,user_type=user_type)
                
                print(f"✅ MLflow evaluation completed for event_id: {event_id}")
                
        except Exception as e:
            print(f"❌ Error in MLflow evaluation for event_id {event_id}: {str(e)}")
            import traceback
            traceback.print_exc()