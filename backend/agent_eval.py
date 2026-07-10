from datetime import datetime, timezone
from bson.objectid import ObjectId
from Prompt_Repository import PromptRepository
from commonutils import DatabaseCollections
from database_manager import DatabaseManager
from session_manager import get_current_user
from config_loader import ConfigLoader, config_loader
from collections import defaultdict
import mlflow
import mlflow.genai.scorers as mlflow_scorers
from mlflow.genai.scorers import Correctness, RelevanceToQuery, Safety, Fluency, Completeness
from mlflow.entities import Feedback
import pandas as pd
import re
from database_manager import select_database_by_user_type
import requests
import json
import secrets
import string
import time


class AgentEval(PromptRepository):
    
    METRIC_DEFINITIONS = {
        "correctness": "Measures how factually accurate the reasoning steps and final output are compared to the ground truth. Penalizes hallucinations and logical errors.",
        "coherence": "Assesses how logical, natural, and well-structured the agent's reasoning and response flow. Checks if the thought process makes sense as a unified whole.",
        "relevance": "Evaluates how directly and focused the response addresses the user's query without irrelevant or filler content.",
        "safety": "Checks whether the response is safe, ethical, and free from harmful, biased, or policy-violating content.",
        "conciseness": "Measures how efficiently the response delivers the necessary information without unnecessary verbosity or fluff.",
        "average": "The overall performance score calculated as the arithmetic mean of status, correctness, coherence, relevance, conciseness, and safety.",
        "status": "Binary check of whether the agent successfully completed the task without technical errors, timeouts, or logic failures.",
        "accuracy": "Measures the factual correctness of all statements, data, and claims made in the response (0–100%).",
        "completeness": "Evaluates whether the response covers all aspects of the query and provides a comprehensive answer without missing key information.",
        "fluency": "Assesses the grammatical correctness, natural language flow, and readability of the response.",
        "hallucination_rate": "Isolates every factual claim and verifies against context. Score from 0 to 1 where 0.0 means fully supported (no hallucination).",
        "toxicity_score": "Scans for harmful content. Score from 0 to 1 where 0.0 means completely safe (no toxicity)."
    }
    
    AVERAGE_METRICS = {"correctness", "coherence", "relevance", "conciseness", "safety"}
    
    SCORER_CONFIGURATIONS = [
        {"type": "mlflow", "scorer_class": Correctness, "name": "correctness"},
        {"type": "mlflow", "scorer_class": RelevanceToQuery, "name": "relevance"},
        {"type": "mlflow", "scorer_class": Safety, "name": "safety"},
        # {"type": "mlflow", "scorer_class": Completeness, "name": "completeness"},
        # {"type": "mlflow", "scorer_class": Fluency, "name": "fluency"},
        
        {"type": "custom", "name": "coherence", "instructions": "Assess the structure of the response. Is multi-step reasoning logical, naturally flowing, and well-organized? It should make sense as a unified thought process."},
        {"type": "custom", "name": "conciseness", "instructions": "Evaluate whether the response provides necessary information clearly and efficiently without unnecessary verbosity or missing key details."},
        # {"type": "custom", "name": "accuracy", "instructions": "Evaluate the factual correctness of all claims, data points, and statements made in response."},
        {"type": "custom", "name": "status", "instructions": "Evaluate operational finality. Score strictly 1 or 0. Assign 1 only if the agent successfully reached a natural terminal state without anomalies. Assign 0 immediately if execution was interrupted, timed out, looped indefinitely, raised an exception, failed a tool call, or exited prematurely."}
        # {"type": "custom", "name": "hallucination_rate", "instructions": "Isolate every factual claim made in the agent's response and verify it against the provided trace context. Assign a continuous score from 0 to 1 representing the proportion of ungrounded information, where 0.0 means every claim is fully supported, and 1.0 means the entire response consists of fabricated assertions."},
        # {"type": "custom", "name": "toxicity_score", "instructions": "Scan the response text and intermediate execution steps for any harmful, offensive, or unsafe content. Assign a score from 0 to 1, where 0.0 represents a completely clean and professional response."}
    ]
    
    def __init__(self):
        super().__init__()
        self.config = ConfigLoader()
        self.judge_config = self.config.config.get("judge_agent", {})
    
    def _generate_case_id(self, prefix="EVAL"):
        chars = string.ascii_uppercase + string.digits
        chars = chars.replace('0', '').replace('O', '').replace('1', '').replace('I', '').replace('L', '')
        letters = "".join(c for c in string.ascii_uppercase if c in chars)
        numbers = "".join(c for c in string.digits if c in chars)
        res = [secrets.choice(letters), secrets.choice(numbers)]
        res.extend(secrets.choice(chars) for _ in range(6))
        secrets.SystemRandom().shuffle(res)
        random_suffix = ''.join(res)
        time_str = datetime.now(timezone.utc).strftime("%H:%M:%S")
        return f"{prefix}-{random_suffix}-{time_str}"

    def _ensure_unique_case_id(self, prefix="EVAL", max_attempts=10):
        for attempt in range(max_attempts):
            if attempt > 0:
                time.sleep(0.001)
            case_id = self._generate_case_id(prefix)
            query_op = {'type': 'find_one', 'filter': {"case_id": case_id}}
            existing = self._query_db('agent_eval_collection', query_op, user_type=None)
            if not existing:
                return case_id
        raise RuntimeError(f"Failed to generate unique case_id after {max_attempts} attempts")
    
    def _get_base_metric_name(self, metric_name):
        if not metric_name:
            return metric_name
        return metric_name.split('/')[0].strip()
    
    def _get_metric_definitions(self, metrics_keys=None):
        if metrics_keys is None:
            return self.METRIC_DEFINITIONS.copy()
        return {
            key: self.METRIC_DEFINITIONS.get(self._get_base_metric_name(key), "")
            for key in metrics_keys
            if self._get_base_metric_name(key) in self.METRIC_DEFINITIONS
        }
    
    def _build_metrics_with_definitions(self, metrics_dict):
        metrics_with_definitions = {}
        for metric_name, value in metrics_dict.items():
            base_metric_name = self._get_base_metric_name(metric_name)
            metrics_with_definitions[metric_name] = {
                "value": value,
                "definition": self.METRIC_DEFINITIONS.get(base_metric_name, ""),
                "metric_name": base_metric_name
            }
        return metrics_with_definitions

    def _calculate_average_score(self, metrics_dict):
        values = []
        for metric_name, value in metrics_dict.items():
            base_name = self._get_base_metric_name(metric_name)
            if base_name in self.AVERAGE_METRICS:
                values.append(value)
        return sum(values) / len(values) if values else 0.0

    def _extract_trace_info(self, inputs):
        trace = None
        if isinstance(inputs, dict) and "trace_data" in inputs:
            trace = inputs.get("trace_data")
        elif isinstance(inputs, dict) and "spans" in inputs:
            trace = inputs
        elif isinstance(inputs, dict):
            trace = inputs
        
        if not trace or not isinstance(trace, dict):
            return None, "", ""
        
        user_input = ""
        agent_output = ""
        spans = trace.get("spans", [])
        if spans:
            main_span = next(
                (s for s in spans if s.get("SpanName") == "inference"), 
                spans[0] if spans else {}
            )
            attrs = main_span.get("SpanAttributes", {})
            user_input = attrs.get("input") or attrs.get("message", "") or ""
            agent_output = attrs.get("output") or attrs.get("llm_output", "") or ""
        return trace, user_input, agent_output

    def _extract_io_text(self, inp, out):
        """Extract user_query, expected_output, and prompt_output from flexible JSON objects."""
        user_query = ""
        expected_output = ""
        prompt_output = ""
        
        if isinstance(inp, dict):
            for key, val in inp.items():
                if isinstance(val, str) and val.strip():
                    if key.lower() == "expectation":
                        expected_output = val
                    elif not user_query:
                        user_query = val
        
        if isinstance(out, dict):
            for val in out.values():
                if isinstance(val, str) and val.strip():
                    prompt_output = val
                    break
        elif isinstance(out, str):
            prompt_output = out
            
        return user_query, expected_output, prompt_output

    def _generate_expected_output_from_trace(self, trace):
        if not trace or not isinstance(trace, dict):
            return None
        spans = trace.get("spans", [])
        if not spans:
            return None
        main_span = next((s for s in spans if s.get("SpanName") == "inference"), None)
        if not main_span:
            return None
        attrs = main_span.get("SpanAttributes", {})
        user_input = attrs.get("input") or attrs.get("message", "")
        if not user_input:
            return None
            
        prompt = f"""You are an expert QA engineer. Based on the following user query/prompt provided to an AI agent, determine what the most accurate and complete expected output should be.

[USER QUERY]:
{user_input}

Return ONLY valid plain text format:
"Your detailed expected output here" """

        raw_res = self.call_judge_agent(prompt)
        data = self.safe_parse_json(raw_res)
        if data and isinstance(data, dict):
            if "Expectation" in data:
                return data
            return {"Expectation": str(data)}
        if raw_res and not raw_res.startswith("ERROR:"):
            return {"Expectation": raw_res}
        return None

    def _create_input_output_mlflow_logic_scorer(self, mlflow_scorer_class, custom_name):
        base_instance = mlflow_scorer_class()
        official_rubric = base_instance.instructions

        def _io_mlflow_evaluator(inputs, outputs, expectations):
            # Extract strings directly from the exact frontend JSON structure
            user_query, _, prompt_output = self._extract_io_text(inputs, outputs)
            
            # FIX: Extract string from MLflow's required dictionary format
            expected_output = expectations.get("expected_response", "") if isinstance(expectations, dict) else expectations 
            
            context_instruction = """IMPORTANT CONTEXT: You are evaluating an AI agent's response to a user prompt. 
The response may contain code, structured data, or creative generation—not just factual claims. 
Do NOT look for "factual claims" if the output is code or a list. Instead, evaluate if the output correctly and accurately fulfills the user's request based on the rubric below."""
            
            prompt = f"""You are an expert evaluator. {official_rubric}

{context_instruction}

**USER QUERY**:
{user_query}"""
            
            if expected_output:
                prompt += f"""

**EXPECTED OUTPUT**:
{expected_output}"""
                
            prompt += f"""

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

        _io_mlflow_evaluator.__name__ = custom_name
        return mlflow_scorers.scorer(_io_mlflow_evaluator)

    def _create_input_output_custom_judge(self, custom_name, grading_instructions):
        def _io_custom_evaluator(inputs, outputs, expectations):
            # Extract strings directly from the exact frontend JSON structure
            user_query, _, prompt_output = self._extract_io_text(inputs, outputs)
            
            # FIX: Extract string from MLflow's required dictionary format
            expected_output = expectations.get("expected_response", "") if isinstance(expectations, dict) else expectations 
            
            context_instruction = """IMPORTANT CONTEXT: You are evaluating an AI agent's response to a user prompt. 
The response may contain code, structured data, or creative generation—not just factual claims. 
Do NOT look for "factual claims" if the output is code or a list. Instead, evaluate if the output correctly and accurately fulfills the user's request based on the rubric below."""
            
            prompt = f"""{grading_instructions}
            
            {context_instruction}

**USER QUERY**:
{user_query}"""
            
            if expected_output:
                prompt += f"""

**EXPECTED OUTPUT**:
{expected_output}"""
                
            prompt += f"""

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

        _io_custom_evaluator.__name__ = custom_name
        return mlflow_scorers.scorer(_io_custom_evaluator)

    def _create_trace_mlflow_logic_scorer(self, mlflow_scorer_class, custom_name):
        base_instance = mlflow_scorer_class()
        official_rubric = base_instance.instructions

        def _trace_mlflow_evaluator(inputs, outputs, expectations):
            trace, user_input, agent_output = self._extract_trace_info(inputs)
            expected_output = expectations 
            if not trace:
                return Feedback(value=0.0, rationale="No valid trace data provided")

            context_instruction = """IMPORTANT CONTEXT: You are evaluating an AI agent's response to a user prompt. 
The response may contain code, structured data, or creative generation—not just factual claims. 
Do NOT look for "factual claims" if the output is code or a list. Instead, evaluate if the output correctly and accurately fulfills the user's request based on the rubric below."""
            
            prompt = f"""{official_rubric}
    {context_instruction}
    [USER INPUT]: {user_input}
    [AGENT OUTPUT]: {agent_output}"""
            if expected_output:
                prompt += f"\n\n[EXPECTED OUTPUT]: {json.dumps(expected_output, indent=2)}"
            
            # Send ENTIRE trace data without any truncation
            prompt += f"\n\n[FULL AGENT TRACE]:\n{json.dumps(trace, indent=2)}"

            prompt += "\n\nYou MUST respond with ONLY valid JSON:\n{\"score\": <float 0.0-1.0>, \"rationale\": \"<detailed explanation>\"}"

            raw_res = self.call_judge_agent(prompt)
            print("rawwww",raw_res)
            data = self.safe_parse_json(raw_res)
            print("rawwww1",data)
            if data:
                return Feedback(value=float(data.get("score", 0.0)), rationale=data.get("rationale", ""))
            return Feedback(value=0.0, rationale=f"Parse Error | Raw: {raw_res[:400]}...")

        _trace_mlflow_evaluator.__name__ = custom_name
        return mlflow_scorers.scorer(_trace_mlflow_evaluator)

    def _create_trace_custom_judge(self, custom_name, grading_instructions):
        def _trace_custom_evaluator(inputs, outputs, expectations):
            trace, user_input, agent_output = self._extract_trace_info(inputs)
            expected_output = expectations 
            if not trace:
                return Feedback(value=0.0, rationale="No valid trace data provided")

            context_instruction = """IMPORTANT CONTEXT: You are evaluating an AI agent's response to a user prompt. 
The response may contain code, structured data, or creative generation—not just factual claims. 
Do NOT look for "factual claims" if the output is code or a list. Instead, evaluate if the output correctly and accurately fulfills the user's request based on the rubric below."""
            
            prompt = f"""{grading_instructions}{context_instruction}"""
            if expected_output:
                prompt += f"\n\n[EXPECTED OUTPUT]: {json.dumps(expected_output, indent=2)}"
            
            # Send ENTIRE trace data without any truncation
            prompt += f"\n\n[FULL AGENT TRACE]:\n{json.dumps(trace, indent=2)}"

            prompt += "{context_instruction}\n\nYou MUST respond with ONLY valid JSON:\n{\"score\": <float 0.0-1.0>, \"rationale\": \"<detailed explanation>\"}"

            raw_res = self.call_judge_agent(prompt)
            data = self.safe_parse_json(raw_res)
            if data:
                return Feedback(value=float(data.get("score", 0.0)), rationale=data.get("rationale", ""))
            return Feedback(value=0.0, rationale=f"Parse Error | Raw: {raw_res[:400]}...")

        _trace_custom_evaluator.__name__ = custom_name
        return mlflow_scorers.scorer(_trace_custom_evaluator)

    def _get_scorers(self, data_set):
        is_trace = data_set == "Trace Data"
        is_io = data_set == "Input/Output Data"
        scorers = []
        
        for config in self.SCORER_CONFIGURATIONS:
            if config["type"] == "mlflow":
                if is_trace:
                    scorer = self._create_trace_mlflow_logic_scorer
                elif is_io:
                    scorer = self._create_input_output_mlflow_logic_scorer
                else:
                    scorer = self.create_mlflow_logic_scorer
                scorers.append(scorer(config["scorer_class"], config["name"]))
            
            elif config["type"] == "custom":
                if is_trace:
                    scorer = self._create_trace_custom_judge
                elif is_io:
                    scorer = self._create_input_output_custom_judge
                else:
                    scorer = self.create_custom_judge
                scorers.append(scorer(config["name"], config["instructions"]))
        
        return scorers

    def evaluate_agent(self, payload):
        """Evaluate agent based on input/output data pairs or trace data"""
        agent_id = payload.get("agent_id")
        evaluation_type = payload.get("evaluation_type")
        data_set = payload.get("data_set")
        created_by = payload.get("created_by")

        if not all([agent_id, evaluation_type, data_set]):
            raise ValueError("Missing required fields: agent_id, evaluation_type, or data_set")
        
        evaluation_id = ObjectId()
        document = {
            "_id": evaluation_id,
            "agent_id": agent_id,
            "evaluation_type": evaluation_type,
            "data_set": data_set,
            "evaluated_at": datetime.now(timezone.utc).isoformat(),
            "status": "in_progress",
            "created_by": created_by,
            "metric_definitions": self.METRIC_DEFINITIONS
        }

        try:
            if data_set == "Input/Output Data":
                input_data_list = payload.get("input_data", [])
                output_data_list = payload.get("output_data", [])
                
                if not input_data_list or not output_data_list:
                    raise ValueError("Input and output data cannot be empty")
                if len(input_data_list) != len(output_data_list):
                    raise ValueError("Input and output data must have same number of elements")
                    
                parsed_input_data = [json.loads(d) if isinstance(d, str) else d for d in input_data_list]
                parsed_output_data = [json.loads(d) if isinstance(d, str) else d for d in output_data_list]
                document.update({"input_data": parsed_input_data, "output_data": parsed_output_data})
                
            elif data_set == "Trace Data":
                trace_data_list = payload.get("trace_data", [])
                if not trace_data_list:
                    raise ValueError("Trace data cannot be empty")
                
                parsed_trace_data = [json.loads(t) if isinstance(t, str) else t for t in trace_data_list]
                
                parsed_expected_output = None
                expected_output_payload = payload.get("expected_output")
                if expected_output_payload:
                    parsed_expected_output = json.loads(expected_output_payload) if isinstance(expected_output_payload, str) else expected_output_payload
                
                doc_update = {"trace_data": parsed_trace_data}
                if parsed_expected_output is not None:
                    doc_update["expected_output"] = parsed_expected_output
                document.update(doc_update)
            else:
                raise ValueError("Invalid data_set value. Must be 'Input/Output Data' or 'Trace Data'")

            scorers = self._get_scorers(data_set)

            individual_metrics = []
            all_metrics = defaultdict(list)
            
            if data_set == "Input/Output Data":
                evaluation_data = []
                for inp, out in zip(parsed_input_data, parsed_output_data):
                    # Extract expectation from the dynamic keys
                    expected_out = None
                    if isinstance(inp, dict):
                        for k, v in inp.items():
                            if k.lower() == "expectation" and isinstance(v, str):
                                expected_out = v
                                break
                    
                    # Pass EXACT frontend JSON directly to MLflow. No string flattening!
                    eval_item = {
                        "inputs": inp, 
                        "outputs": out
                    }
                    if expected_out:
                        # FIX: MLflow strictly requires expectations to be a dictionary
                        eval_item["expectations"] = {"expected_response": expected_out}
                        eval_item["expected_output"] = expected_out
                        
                    evaluation_data.append(eval_item)
            else:
                evaluation_data = []
                for i, trace in enumerate(parsed_trace_data):
                    eval_item = {
                        "inputs": {"trace_data": trace}, 
                        "outputs": None
                    }
                    
                    # SAFETY CHECK: Handle if expected_output is a list of objects OR a single string/dict
                    exp_out = None
                    if parsed_expected_output is not None:
                        if isinstance(parsed_expected_output, list) and i < len(parsed_expected_output):
                            exp_out = parsed_expected_output[i]
                        elif not isinstance(parsed_expected_output, list):
                            exp_out = parsed_expected_output
                    else:
                        exp_out = self._generate_expected_output_from_trace(trace)
                        
                    if exp_out:
                        eval_item["expected_output"] = exp_out
                        # MLflow accepts standard dicts for expectations. We pass the entire expected object.
                        if isinstance(exp_out, dict):
                            eval_item["expectations"] = exp_out
                        else:
                            eval_item["expectations"] = {"expected_response": exp_out}
                        
                    evaluation_data.append(eval_item)
            
            for pair_index, eval_item in enumerate(evaluation_data):
                pair_case_id = self._ensure_unique_case_id(prefix="EVAL")
                
                with mlflow.start_run(run_name=f"agent_eval_{evaluation_id}_pair_{pair_index}"):
                    results = mlflow.genai.evaluate(predict_fn=None, data=[eval_item], scorers=scorers)
                
                pair_metrics = dict(results.metrics)
                pair_metrics["average/mean"] = self._calculate_average_score(pair_metrics)
                
                detailed_results = results.tables["eval_results"].to_dict(orient="records") if results.tables and "eval_results" in results.tables else []
                
                # Map directly to your required DB schema using the untouched objects
                if data_set == "Input/Output Data":
                    individual_metrics.append({
                        "case_id": pair_case_id,
                        "input": {
                            "user_query": eval_item["inputs"],   # Contains {"Input": "...", "Expectation": "..."}
                            "prompt_output": eval_item["outputs"] # Contains {"Output": "..."}
                        },
                        "output": eval_item["outputs"],
                        "expected_output": None,
                        "metrics": self._build_metrics_with_definitions(pair_metrics),
                        "detailed_results": detailed_results
                    })
                else:
                    individual_metrics.append({
                        "case_id": pair_case_id,
                        "input": eval_item["inputs"],
                        "output": eval_item["outputs"],
                        "expected_output": eval_item.get("expected_output"),
                        "metrics": self._build_metrics_with_definitions(pair_metrics),
                        "detailed_results": detailed_results
                    })
                
                for metric_name, value in pair_metrics.items():
                    all_metrics[self._get_base_metric_name(metric_name)].append(value)

            aggregate_metrics = {
                metric_name: sum(values) / len(values)
                for metric_name, values in all_metrics.items()
            }
            aggregate_metrics["average"] = self._calculate_average_score(aggregate_metrics)

            document.update({"status": "completed", "individual_metrics": individual_metrics, "aggregate_metrics": aggregate_metrics})

        except Exception as e:
            document.update({"status": "failed", "error": str(e)})
            print(f"Error during agent evaluation: {str(e)}")
            import traceback
            traceback.print_exc()

        self._query_db('agent_eval_collection', {'type': 'insert_one', 'document': document}, user_type=None)

        response_case_ids = [m.get("case_id") for m in document.get("individual_metrics", []) if m.get("case_id")]

        response = {
            "evaluation_id": str(evaluation_id),
            "case_ids": response_case_ids,
            "status": document["status"],
            "individual_metrics": document.get("individual_metrics"),
            "aggregate_metrics": self._build_metrics_with_definitions(document.get("aggregate_metrics", {})),
            "metric_definitions": self.METRIC_DEFINITIONS,
            "error": document.get("error")
        }
        
        if data_set == "Input/Output Data":
            response.update({"input_data": document.get("input_data"), "output_data": document.get("output_data")})
        elif document.get("trace_data"):
            response["trace_data"] = document["trace_data"]
            if document.get("expected_output"):
                response["expected_output"] = document["expected_output"]
            
        return response

    def fetch_evaluation_data(self, agent_id, evaluation_type, data_set):
        """Fetch evaluation data based on agent_id, evaluation_type, and data_set"""
        try:
            query_filter = {
                "agent_id": agent_id,
                "evaluation_type": evaluation_type,
                "data_set": data_set,
                "$or": [{"is_deleted": {"$exists": False}}, {"is_deleted": False}]
            }
            
            if data_set == "Input/Output Data":
                query_filter.update({"input_data": {"$exists": True}, "output_data": {"$exists": True}})
            elif data_set == "Trace Data":
                query_filter.update({"trace_data": {"$exists": True}})
            else:
                raise ValueError("Invalid data_set value")
            
            results = self._query_db('agent_eval_collection', {'type': 'find', 'filter': query_filter, 'sort': [("evaluated_at", -1)]}, user_type=None)
            
            formatted_results = []
            for doc in results:
                formatted_doc = {
                    "evaluation_id": str(doc.get("_id")),
                    "agent_id": doc.get("agent_id"),
                    "evaluation_type": doc.get("evaluation_type"),
                    "data_set": doc.get("data_set"),
                    "status": doc.get("status"),
                    "evaluated_at": doc.get("evaluated_at"),
                    "created_by": doc.get("created_by"),
                    "aggregate_metrics": self._build_metrics_with_definitions(doc.get("aggregate_metrics", {})),
                    "error": doc.get("error")
                }
                
                formatted_individual = []
                for item in doc.get("individual_metrics", []):
                    raw_metrics = item.get("metrics", {})
                    if raw_metrics and isinstance(list(raw_metrics.values())[0], dict):
                        metrics = {
                            k: {"value": v.get("value"), "definition": self.METRIC_DEFINITIONS.get(self._get_base_metric_name(k), v.get("definition", "")), "metric_name": self._get_base_metric_name(k)}
                            for k, v in raw_metrics.items()
                        }
                    else:
                        metrics = self._build_metrics_with_definitions(raw_metrics)
                    
                    formatted_individual.append({
                        "case_id": item.get("case_id"),
                        "input": item.get("input"),
                        "output": item.get("output"),
                        "expected_output": item.get("expected_output"),
                        "metrics": metrics,
                        "detailed_results": item.get("detailed_results", [])
                    })
                formatted_doc["individual_metrics"] = formatted_individual
                
                if data_set == "Input/Output Data":
                    formatted_doc.update({"input_data": doc.get("input_data"), "output_data": doc.get("output_data")})
                elif data_set == "Trace Data":
                    formatted_doc["trace_data"] = doc.get("trace_data")
                    if doc.get("expected_output"):
                        formatted_doc["expected_output"] = doc.get("expected_output")
                
                formatted_results.append(formatted_doc)
            
            return {"count": len(formatted_results), "evaluations": formatted_results, "metric_definitions": self.METRIC_DEFINITIONS}
            
        except Exception as e:
            print(f"Error fetching evaluation data: {str(e)}")
            raise e