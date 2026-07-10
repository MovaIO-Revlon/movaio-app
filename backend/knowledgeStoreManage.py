from pydantic import ValidationError
from config_loader import ConfigLoader, config_loader
import requests
from commonutils import DatabaseCollections, CommonUtils
from session_manager import get_current_user
from config_loader import config_loader
from database_manager import select_database_by_user_type

class KnowledgeStoreManager(DatabaseCollections):
    def __init__(self):
        super().__init__()
        self.config = ConfigLoader()        
        self.utils = CommonUtils()
    
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
    
    def get_knowledgestore_details_counts(self):
        total_op = {'type': 'count', 'filter': {}}
        total = self._query_db('kb_collection', total_op)
        
        return total
        
    def get_knowledgestore_details(self):
        all_kg_op = {'type': 'find', 'filter': {}}
        all_kg_detls = self._query_db('kb_collection', all_kg_op)
        
        return all_kg_detls

    def get_knowledgestore_statistics(self, user_type=None):

        stats_op = {'type': 'find', 'filter': {}}
        stats = self._query_db('kb_collection', stats_op, user_type=user_type)
        
        KB_COUNT = 0
        KG_COUNT = 0
        for kb in stats:
            provider = kb.get('vector_store_provider')
            if not provider:
                provider = kb.get('config', {}).get('vector_store_provider')
            
            if provider:
                if "Neo4J" in provider or "neo4j" in provider:
                    KG_COUNT += 1
                else:
                    KB_COUNT += 1
            else:
                KB_COUNT += 1
                
        all_agents_op = {'type': 'find', 'filter': {
                "$or": [
                    {"isDeleted": {"$exists": False}},
                    {"isDeleted": False}
                ]
            }}
        all_agents_detls = self._query_db('agent', all_agents_op, user_type=user_type)

        ks_ids = set()
        for agent in all_agents_detls:
            ks_id = self._get_agent_ks_id(agent)
            if ks_id:
                ks_ids.add(ks_id)

        if not ks_ids:
            return {
                "knowledge_graph_base_count": {"Knowledge Graph": KG_COUNT, "Knowledge Base": KB_COUNT},
                "agents_by_knowledge_store": {},
                "knowledge_store_count": len(stats)
            }

        or_conditions = []
        for ks_id in ks_ids:
            or_conditions.append({"rag_id": ks_id})
            or_conditions.append({"config._id": ks_id})

        ks_query_op = {'type': 'find', 'filter': {'$or': or_conditions}}
     
        ks_details_map = {}
        for ks in self._query_db('kb_collection', ks_query_op, user_type=user_type):

            potential_key = ks.get('rag_id') or ks.get('config', {}).get('_id')
            if potential_key in ks_ids:
                ks_details_map[potential_key] = ks

        agents_by_ks = {}
        for agent in all_agents_detls:
            agent_name = agent.get('name')
            ks_id = self._get_agent_ks_id(agent)

            if ks_id:
                ks_details = ks_details_map.get(ks_id)
                if ks_details:
                    ks_name = ks_details.get('collection_name')
                    
                    if agent_name not in agents_by_ks:
                        agents_by_ks[agent_name] = []
                    
                    agents_by_ks[agent_name].append(ks_name)

        return {
            "knowledge_graph_base_count": {
                "Knowledge Graph": KG_COUNT,
                "Knowledge Base": KB_COUNT
            },
            "agents_by_knowledge_store": agents_by_ks,
            "knowledge_store_count": len(stats)
        }

    def _get_agent_ks_id(self, agent: dict) -> str | None:
        ks_id = None
        ks_field = agent.get('knowledge_store')
        if ks_field:
            if isinstance(ks_field, dict):
                ks_id = ks_field.get('id')
            elif isinstance(ks_field, list) and len(ks_field) > 0:
                ks_id = ks_field[0].get('id')
        else:
            ks_id = agent.get('knowledge_store_id')
        return ks_id

 
    def get_mcp_statistics(self,user_type=None):
        stats_op = {'type': 'find', 'filter': {}}
        stats = self._query_db('mcp_master', stats_op, user_type=user_type)
       
        mcp_connector_count = {}
        mcp_entity_count = {}
 
        for mcp in stats:
            connector_type = mcp.get('connector_type')
            entity_type = mcp.get('entity_type')
            if connector_type:
                mcp_connector_count[connector_type] = mcp_connector_count.get(connector_type, 0) + 1
            if entity_type:
                mcp_entity_count[entity_type] = mcp_entity_count.get(entity_type, 0) + 1
 
        return {
            "mcp_count": len(stats),
            "connector_count": len(mcp_connector_count),
            "mcp_connector_count": mcp_connector_count,
            "mcp_entity_count": mcp_entity_count,
            "total_entity_count": len(mcp_entity_count)
        }
        
    def get_knowledgestore_doc_details(self, rag_id):
        if not rag_id:
            raise ValidationError("rag_id is required")
        
        ##all_kg_op = {'type': 'find', 'filter': {'name': "knowledge_store"}}
        ##all_kg_detls = self._query_db('appconfig', all_kg_op)

        ##appconfig_doc = self.appconfig.find_one({'name': "knowledge_store"})
        
        kg_api_id= self.kb_collection.find_one({"rag_id": rag_id}, {"rag_id": 0})
        
        print("kg_api_id:", kg_api_id)
        
        url = f"{config_loader.LYZR_RAG_URL}/v3/rag/documents/{rag_id}"
        headers = {
            "x-api-key": kg_api_id['user_id'],
            "Content-Type": "application/json"
        }
        ####print("Url :",url,"headers:",headers)
        response = requests.get(url, headers=headers)
        response.raise_for_status()  # Raises HTTPError for bad status

        try:
            data = response.json()  # Raises ValueError if not valid JSON
        except ValueError as ve:
            raise ValidationError(f"Invalid JSON response for rag_id {rag_id}: {ve}")

        return data
        
    # def get_mcp_statistics(self, user_type=None):   # ← you can keep user_type param if needed
    #     stats_op = {'type': 'find', 'filter': {}}
    #     stats = self._query_db('mcp_master', stats_op, user_type=user_type)
        
    #     mcp_connector_count = {}
    #     for mcp in stats:
    #         connector_type = mcp.get('connector_type')
    #         if connector_type:
    #             mcp_connector_count[connector_type] = mcp_connector_count.get(connector_type, 0) + 1
        
    #     return {
    #         "mcp_count": len(stats),
    #         "connector_count": len(mcp_connector_count),
    #         "mcp_connector_count": mcp_connector_count
    #     }

# Global instance for backward compatibility
kw_manager = KnowledgeStoreManager()

# Function wrappers for backward compatibility

def get_knowledgestore_details_counts():
    return kw_manager.get_knowledgestore_details_counts()

def get_knowledgestore_details():
    return kw_manager.get_knowledgestore_details()

def get_knowledgestore_doc_details(rag_id):
    return kw_manager.get_knowledgestore_doc_details(rag_id)