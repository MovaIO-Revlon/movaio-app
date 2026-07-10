import json
from typing import Any, Dict, List, Optional
from config_loader import config_loader
from opensearchpy import OpenSearch, helpers
import datetime
from database_manager import DatabaseManager
from commonutils import DatabaseCollections, CommonUtils

class InsightsManager(DatabaseCollections):
    def __init__(self):
        super().__init__()
        opensearch = config_loader.get_opensearch_details()
        self.db = DatabaseManager()
   
        
        self.client = OpenSearch(
            hosts=[{'host': opensearch["host"], 'port': opensearch["port"], 'scheme': 'http'}],
            http_auth=(opensearch["username"], opensearch["password"]), 
            verify_certs=False,
            
            ssl_show_warn=False,
            sniff_on_start=False,
            sniff_on_connection_fail=False
        )
       
    

    @staticmethod
    def resolve_path(data: Dict, path: str) -> Any:
        """Navigate nested dict using dot notation"""
        if not path:
            return data
        parts = path.split(".")
        current = data
        for part in parts:
            if isinstance(current, dict) and part in current:
                current = current[part]
            else:
                return None
        return current

    def parse(self, raw_response: Dict, config: Dict) -> Dict:
        chart_type = config.get("chart_type")
        data_source = config.get("data_source")

        if data_source == "hits":
            return self._parse_hits(raw_response, config.get("extraction_config", {}), chart_type)
        elif data_source == "aggregations":
            return self._parse_aggregations(raw_response, config.get("extraction_config", {}), chart_type)
        else:
            raise ValueError(f"Unsupported data_source: {data_source}")

    def _parse_hits(self, raw_response: Dict, extraction: Dict, chart_type: str) -> Dict:
        hits = self.resolve_path(raw_response, "hits.hits") or []
        fields = extraction.get("fields_to_extract", [])

        parsed_data = []
        for hit in hits:
            source = hit.get("_source", {})
            extracted = {field: source.get(field) for field in fields} if fields else source
            parsed_data.append(extracted)

        return {
            
            "data": parsed_data,
            "total": self.resolve_path(raw_response, "hits.total.value")
        }

    

    def _parse_aggregations(self, raw_response: Dict, extraction: Dict, chart_type: str) -> Dict:
        root_path = extraction.get("root_path", "aggregations")
        buckets = self.resolve_path(raw_response, root_path)

        # Fallback: Try to find buckets automatically
        if not buckets or not isinstance(buckets, list):
            aggs = raw_response.get("aggregations", {})
            if isinstance(aggs, dict):
                # Try first aggregation that has buckets
                for key, value in aggs.items():
                    if isinstance(value, dict) and "buckets" in value:
                        buckets = value.get("buckets")
                        break

        if isinstance(buckets, dict) and "buckets" in buckets:
            buckets = buckets["buckets"]

        if not isinstance(buckets, list):
            buckets = []

        labels = []
        datasets = []

        # === Support both old simple format and new metrics format ===
        metrics = extraction.get("metrics")

        if not metrics:  # Old simple format fallback
            metrics = [{
                "label": extraction.get("dataset_label", "Value"),
                "value_path": extraction.get("value_path", "doc_count")
            }]

        for bucket in buckets:
            label = self._extract_label(bucket, extraction.get("label_path"))
            if label is None:
                continue

            labels.append(label)

            # Extract values for all metrics
            bucket_values = []
            for metric in metrics:
                value_path = metric.get("value_path", "doc_count")
                value = self._extract_value(bucket, value_path)
                bucket_values.append({
                    "label": metric.get("label", "Value"),
                    "value": value
                })

            datasets.append(bucket_values)

        # Build final output
        if len(metrics) == 1:
            # Single dataset (most common: bar, pie, simple line)
            return {
                
                "data": {
                    "labels": labels,
                    "datasets": [{
                        "label": metrics[0].get("label", "Value"),
                        "values": [d[0]["value"] for d in datasets]
                    }]
                }
            }
        else:
            # Multi-metric (multiple lines, grouped bars, etc.)
            return {
                
                "data": {
                    "labels": labels,
                    "datasets": [
                        {
                            "label": m.get("label", f"Dataset {i}"),
                            "values": [d[i]["value"] for d in datasets]
                        }
                        for i, m in enumerate(metrics)
                    ]
                }
            }

    def _extract_label(self, bucket: Dict, label_path: Optional[str]) -> Any:
        if label_path:
            val = self.resolve_path(bucket, label_path)
            if val is not None:
                return val

        if "key_as_string" in bucket:
            return bucket["key_as_string"]
        if "key" in bucket:
            return bucket["key"]

        return str(bucket.get("key", "Unknown"))

    def _extract_value(self, bucket: Dict, value_path: str) -> Any:
        if value_path == "doc_count":
            return bucket.get("doc_count", 0)

        value = self.resolve_path(bucket, value_path)
        if isinstance(value, dict) and "value" in value:
            return value["value"]   # For avg, sum, min, max, value_count etc.

        return value if value is not None else 0



    def fetch_response_details(self, req_data: Dict) -> Dict:
        """
        Extracts and validates necessary details from the agent response.
        """
        try:
            
            usecase_name = req_data.get("usecase_name")
            
            if not usecase_name:
                raise ValueError("usecase_name is missing from request.")
            
            usecase_name = usecase_name.strip()
            # FIX 1: Make sure this is the same collection you saved to!
            # Also added {"_id": 0} so MongoDB's ObjectId doesn't break json.dumps later
            response_json = self.mcp_usecase_collection.find_one(
                {"usecase_name": usecase_name,"key":"trends"}, 
                {"_id": 0} 
            )
            
            if not response_json:   
                # FIX 3: Fixed the undefined 'agent_data' variable error
                raise ValueError(f"No data found for usecase_name: {usecase_name}")
            index_name = response_json.get("index_name")
            if not index_name:
                raise ValueError(f"index_name is missing in the database document for usecase_name: {usecase_name}")
            
            #self.flaskapp.store_kpi_history(run_id=run_id, page_name = page_name, entity=entity, start=start, end=end, agent_name="", index_name=index_name, kpis=data)
            return self.execute_agent_workflow(response_json, self.client,index_name)
            
        except (json.JSONDecodeError, KeyError) as e:
            raise ValueError(f"Invalid agent response format: {str(e)}")

    def execute_agent_workflow(self, agent_response, opensearch_client, index_name):
        try:
            if isinstance(agent_response, str):
                agent_data = json.loads(agent_response)
            elif isinstance(agent_response, dict):
                agent_data = agent_response
            else:
                raise TypeError("agent_response must be a dictionary or a valid JSON string")
            
            # FIX 2: Look inside 'parsed_trends_json' because that is where you saved it!
            
            payload = agent_data.get("parsed_trends_json", {})
            
            # Now extract query and config from the payload
            query = payload.get("opensearch_query")
            config = payload.get("chartfit_structure_json")
            data_source = config.get("data_source")

            if not query or not config:
                raise ValueError("Missing 'opensearch_query' or 'chartfit_structure_json' in database document.")

            # Basic Validation
            if config.get("data_source") == "aggregations" and "aggs" not in query:
                raise ValueError("Mismatch: data_source=aggregations but no aggs in query")

            # Execute query
            raw_response = opensearch_client.search(
                body=query,
                index=index_name
            )
            print("Raw OpenSearch Response:", json.dumps(raw_response))  # Debug log

            formatted_hits = {
                "hits": raw_response.get("hits", {}),
                "aggregations": raw_response.get("aggregations", {})
            }
            

            return formatted_hits
            


        except Exception as e:
            return {
                "error": str(e),
                "chart_type": "error",
                "message": "Failed to process request. Please try again."
            }