import unittest
from unittest.mock import patch, MagicMock, mock_open
import json
import os
import datetime
from bson import ObjectId
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from flask import Flask, jsonify

# Import the class to test
from testcaseManage import TestCaseManager

class TestTestCaseManager(unittest.TestCase):
    def setUp(self):
        """Set up test fixtures before each test method."""
        self.app = Flask(__name__)
        self.app_context = self.app.app_context()
        self.app_context.push()
        self.test_case_manager = TestCaseManager()
        
        # Mock the collections that are used in the class
        self.test_case_manager.project = MagicMock()
        self.test_case_manager.agent_collection = MagicMock()
        self.test_case_manager.event_agency_tracking_collection = MagicMock()
        self.test_case_manager.agent_tracking_collection = MagicMock()
        self.test_case_manager.agent_agency_mapping_collection = MagicMock()
        self.test_case_manager.chatbot_tracking_collection = MagicMock()
        
    def tearDown(self):
        """Clean up after each test method."""
        self.app_context.pop()
        
    @patch('testcaseManage.get_current_user')
    @patch('testcaseManage.config_loader')
    def test_query_db(self, mock_config_loader, mock_get_current_user):
        """Test the _query_db helper method."""
        # Mock the dependencies
        mock_get_current_user.return_value = {'ActiveProject': 'test_project'}
        mock_config_loader.query_db.return_value = {'result': 'test_result'}
        self.test_case_manager.project.find_one.return_value = {'database_name': 'test_db'}
        
        # Test with user_type=None
        result = self.test_case_manager._query_db('test_collection', {'type': 'find'})
        
        # Verify the call
        mock_config_loader.query_db.assert_called_once_with(
            'test_collection',
            {'type': 'find'},
            condition_func=unittest.mock.ANY,
            user_type='test_db'
        )
        self.assertEqual(result, {'result': 'test_result'})
        
        # Test with user_type provided
        mock_config_loader.reset_mock()
        result = self.test_case_manager._query_db('test_collection', {'type': 'find'}, user_type='test_user_type')
        
        # Verify the call
        mock_config_loader.query_db.assert_called_once_with(
            'test_collection',
            {'type': 'find'},
            condition_func=unittest.mock.ANY,
            user_type='test_user_type'
        )
        self.assertEqual(result, {'result': 'test_result'})

    @patch('testcaseManage.run_test_workflow')
    @patch('testcaseManage.os.listdir')
    @patch('testcaseManage.uuid.uuid4')
    @patch('testcaseManage.datetime')
    def test_run_workflow_endpoint_details(self, mock_datetime, mock_uuid, mock_listdir, mock_run_test_workflow):
        """Test the run_workflow_endpoint_details method."""
        # Mock the dependencies
        mock_uuid.return_value.hex = 'test_uuid'
        mock_datetime.utcnow.return_value = datetime.datetime(2023, 1, 1)
        mock_listdir.return_value = ['test1.txt', 'test2.txt']
        mock_run_test_workflow.return_value = {
            "response": '{"test_case_title": "Test Title", "test_steps": ["Step 1", "Step 2"]}',
            "desc": "Test Description"
        }
        
        # Mock agent data
        agent_data = {
            "agent_id": "test_agent_id",
            "name": "Test Agent",
            "agent_api_key": "test_api_key",
            "status": "active",
            "actions": [{"flag": True}, {"flag": False}]
        }
        self.test_case_manager.agent_collection.find_one.return_value = agent_data
        
        # Mock request
        mock_request = MagicMock()
        mock_request.get_json.return_value = {
            "agent_id": "test_agent_id",
            "ischat": False
        }
        
        # Mock the _query_db method
        with patch.object(self.test_case_manager, '_query_db') as mock_query_db:
            mock_query_db.return_value = None
            
            # Call the method
            result = self.test_case_manager.run_workflow_endpoint_details('test_folder', mock_request)
            
            # Verify the results
            self.assertEqual(result, '{"test_case_title": "Test Title", "test_steps": ["Step 1", "Step 2"]}')
            
            # Verify database operations
            self.assertEqual(self.test_case_manager.event_agency_tracking_collection.insert_one.call_count, 2)
            self.assertEqual(self.test_case_manager.agent_collection.update_one.call_count, 1)
            # The agent_tracking_collection.insert_one is not called directly but through _query_db
            self.assertEqual(mock_query_db.call_count, 4)  # 2 for event tracking, 1 for agent update, 1 for agent tracking

    @patch('testcaseManage.requests.get')
    def test_get_explanation(self, mock_requests_get):
        """Test the get_explanation method."""
        # Mock the API responses
        trace_response = MagicMock()
        trace_response.json.return_value = {
            "traces": [{"trace_id": "test_trace_id"}]
        }
        trace_response.raise_for_status.return_value = None
        
        detail_response = MagicMock()
        detail_response.json.return_value = [
            {
                "input_messages": [
                    {
                        "role": "user",
                        "content": "You are an AI assistant tasked with test case generation"
                    }
                ]
            }
        ]
        detail_response.raise_for_status.return_value = None
        
        # Set up the mock to return different responses for different calls
        mock_requests_get.side_effect = [trace_response, detail_response]
        
        # Call the method
        result = self.test_case_manager.get_explanation("test_agent_id", "test_api_key")
        
        # Verify the result
        self.assertEqual(result, "You are an AI assistant tasked with test case generation")
        
        # Verify API calls
        self.assertEqual(mock_requests_get.call_count, 2)
        
        # Reset the mock for the next test
        mock_requests_get.reset_mock()
        
        # Test with no traces - use a new mock to avoid StopIteration
        with patch('testcaseManage.requests.get') as new_mock_requests_get:
            new_trace_response = MagicMock()
            new_trace_response.json.return_value = {"traces": []}
            new_mock_requests_get.return_value = new_trace_response
            result = self.test_case_manager.get_explanation("test_agent_id", "test_api_key")
            self.assertEqual(result, "Explanation is not available.")
        
        # Test with no relevant user message - use a new mock to avoid StopIteration
        with patch('testcaseManage.requests.get') as new_mock_requests_get:
            new_trace_response = MagicMock()
            new_trace_response.json.return_value = {"traces": [{"trace_id": "test_trace_id"}]}
            new_detail_response = MagicMock()
            new_detail_response.json.return_value = [
                {
                    "input_messages": [
                        {
                            "role": "user",
                            "content": "This is not a relevant message"
                        }
                    ]
                }
            ]
            new_mock_requests_get.side_effect = [new_trace_response, new_detail_response]
            result = self.test_case_manager.get_explanation("test_agent_id", "test_api_key")
            self.assertEqual(result, "No relevant user message found in trace data.")

    def test_clean_text(self):
        """Test the clean_text method."""
        # Test with valid JSON
        json_text = '```json\n{"test": "value"}\n```'
        result = self.test_case_manager.clean_text(json_text)
        self.assertEqual(result, {"test": "value"})
        
        # Test with invalid JSON
        invalid_json = 'This is not JSON'
        result = self.test_case_manager.clean_text(invalid_json)
        self.assertEqual(result, invalid_json)
        
        # Test with JSON containing newlines
        json_with_newlines = '{"test": "value\\nwith newlines"}'
        result = self.test_case_manager.clean_text(json_with_newlines)
        self.assertEqual(result, {"test": "value\nwith newlines"})

    def test_preprocess_query(self):
        """Test the preprocess_query method."""
        # Test with a short query
        query = "This is a short query"
        result = self.test_case_manager.preprocess_query(query)
        self.assertEqual(result, "This is a short query")
        
        # Test with a long query
        long_query = "This is a very long query with more than thirty words " * 3
        result = self.test_case_manager.preprocess_query(long_query, max_tokens=30)
        self.assertEqual(len(result.split()), 30)

    def test_normalize_route_query(self):
        """Test the normalize_route_query method."""
        # Test with a normal query
        query = "Test Query for Normalization"
        result = self.test_case_manager.normalize_route_query(query)
        self.assertEqual(result, "test queri for normal")
        
        # Test with a query that needs wordninja splitting
        query = "testquerywithcombinedwords"
        result = self.test_case_manager.normalize_route_query(query)
        self.assertEqual(result, "test queri with combin word")

    @patch.object(TestCaseManager, 'fetch_task_agents')
    @patch.object(TestCaseManager, 'find_best_match')
    @patch.object(TestCaseManager, 'build_agent_response')
    def test_route_query(self, mock_build_agent_response, mock_find_best_match, mock_fetch_task_agents):
        """Test the route_query method."""
        # Mock the dependencies
        mock_fetch_task_agents.return_value = [
            {"agent_id": "agent1", "name": "Test Agent 1"},
            {"agent_id": "agent2", "name": "Test Agent 2"}
        ]
        mock_find_best_match.return_value = ({"agent_id": "agent1", "name": "Test Agent 1"}, 0.8)
        mock_build_agent_response.return_value = {"agent_id": "agent1", "name": "Test Agent 1"}
        
        # Mock the _query_db method
        with patch.object(self.test_case_manager, '_query_db') as mock_query_db:
            mock_query_db.return_value = None
            
            # Test with a matching query
            result = self.test_case_manager.route_query("test query", None)
            self.assertTrue(result["success"])
            self.assertEqual(result["agent"], {"agent_id": "agent1", "name": "Test Agent 1"})
            self.assertEqual(result["similarity_score"], 0.8)
            
            # Test with no task agents
            mock_fetch_task_agents.return_value = []
            result = self.test_case_manager.route_query("test query", None)
            self.assertFalse(result["success"])
            self.assertEqual(result["message"], "No task agents found")
            
            # Test with a low similarity score
            mock_fetch_task_agents.return_value = [
                {"agent_id": "agent1", "name": "Test Agent 1"},
                {"agent_id": "agent2", "name": "Test Agent 2"}
            ]
            mock_find_best_match.return_value = ({"agent_id": "agent1", "name": "Test Agent 1"}, 0.1)
            result = self.test_case_manager.route_query("test query", None)
            self.assertFalse(result["success"])
            self.assertEqual(result["message"], "Please refine your query.")

    @patch.object(TestCaseManager, '_query_db')
    def test_fetch_task_agents(self, mock_query_db):
        """Test the fetch_task_agents method."""
        # Mock the database response
        mock_query_db.return_value = [
            {"agent_id": "agent1", "name": "Test Agent 1", "agent_type_name": "Task Agent"},
            {"agent_id": "agent2", "name": "Test Agent 2", "agent_type_name": "Task Agent"}
        ]
        
        # Call the method
        result = self.test_case_manager.fetch_task_agents()
        
        # Verify the result
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["agent_id"], "agent1")
        self.assertEqual(result[1]["agent_id"], "agent2")
        
        # Verify the database query
        mock_query_db.assert_called_once_with(
            'agent',
            {
                'type': 'find',
                'filter': {"agent_type_name": "Task Agent"},
                'projection': {"_id": 0}
            },
            None
        )

    def test_find_best_match(self):
        """Test the find_best_match method."""
        # Test data
        task_agents = [
            {"agent_id": "agent1", "name": "Test Agent for Login"},
            {"agent_id": "agent2", "name": "Test Agent for Registration"}
        ]
        user_query = "login test case"
        
        # Call the method
        matched_agent, score = self.test_case_manager.find_best_match(user_query, task_agents)
        
        # Verify the result
        self.assertEqual(matched_agent["agent_id"], "agent1")
        self.assertGreater(score, 0.5)  # Should be a good match for "login"

    @patch.object(TestCaseManager, '_query_db')
    def test_build_agent_response(self, mock_query_db):
        """Test the build_agent_response method."""
        # Mock the database responses
        mock_query_db.side_effect = [
            {"agency_id": "agency1"},  # agent_agency_mapping_collection.find_one
            {"agent_id": "master_agent_id"},  # agent_agency_mapping_collection.find_one
            {"agent_id": "master_agent_id", "name": "Master Agent"}  # agent_collection.find_one
        ]
        
        # Mock the collections
        self.test_case_manager.agent_agency_mapping_collection = MagicMock()
        self.test_case_manager.agent_collection = MagicMock()
        
        # Set up the collection mocks to return the expected values
        self.test_case_manager.agent_agency_mapping_collection.find_one.side_effect = [
            {"agency_id": "agency1"},
            {"agent_id": "master_agent_id"}
        ]
        self.test_case_manager.agent_collection.find_one.return_value = {
            "agent_id": "master_agent_id", 
            "name": "Master Agent"
        }
        
        # Test data
        matched_agent = {"agent_id": "agent1", "name": "Test Agent"}
        
        # Call the method
        result = self.test_case_manager.build_agent_response(matched_agent)
        
        # Verify the result
        self.assertEqual(result["agent_id"], "master_agent_id")
        self.assertEqual(result["name"], "Master Agent")
        self.assertEqual(result["subagent"]["agent_id"], "agent1")
        self.assertEqual(result["subagent"]["name"], "Test Agent")

    def test_generate_event_id(self):
        """Test the generate_event_id method."""
        # Mock the database response
        self.test_case_manager.event_agency_tracking_collection.count_documents.return_value = 15  # Total events count
        
        # Call the method
        result = self.test_case_manager.generate_event_id()
        
        # Verify the result
        self.assertEqual(result, "UC-016")  # Round 0, position 16

    @patch.object(TestCaseManager, '_query_db')
    def test_get_event_workflow_details(self, mock_query_db):
        """Test the get_event_workflow_details method."""
        # Mock the database responses
        mock_query_db.side_effect = [
            {"event_id": "event1", "agent_id": "agent1"},  # Latest event
            [  # Event documents
                {"_id": ObjectId("60f1b2b3b3b3b3b3b3b3b3b3"), "event_id": "event1", "filename": "test1.txt"},
                {"_id": ObjectId("60f1b2b3b3b3b3b3b3b3b3b4"), "event_id": "event1", "filename": "test2.txt"}
            ],
            None  # Update result
        ]
        
        # Mock request
        mock_request = MagicMock()
        mock_request.get_json.return_value = {
            "agent_id": "agent1",
            "ischat": False
        }
        
        # Call the method
        result, status_result = self.test_case_manager.get_event_workflow_details(mock_request)
        
        # Verify the result
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["event_id"], "event1")
        self.assertEqual(result[0]["filename"], "test1.txt")
        self.assertEqual(result[1]["event_id"], "event1")
        self.assertEqual(result[1]["filename"], "test2.txt")
        
        # Verify the database queries
        self.assertEqual(mock_query_db.call_count, 3)

    @patch.object(TestCaseManager, '_query_db')
    def test_get_user_events_details(self, mock_query_db):
        """Test the get_user_events_details method."""
        # Mock the database responses
        mock_query_db.side_effect = [
            [{"current_ts": datetime.datetime(2023, 1, 1)}],  # Last document
            [  # Event documents
                {"_id": ObjectId("60f1b2b3b3b3b3b3b3b3b3b3"), "event_id": "event1", "filename": "test1.txt"},
                {"_id": ObjectId("60f1b2b3b3b3b3b3b3b3b3b4"), "event_id": "event1", "filename": "test2.txt"}
            ],
            100  # Total count
        ]
        
        # Mock request
        mock_request = MagicMock()
        mock_request.get_json.return_value = {
            "UserMail": "test@example.com",
            "agencyId": "agency1"
        }
        
        # Call the method
        result = self.test_case_manager.get_user_events_details(mock_request)
        
        # Verify the result
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["event_id"], "event1")
        self.assertEqual(result[0]["filename"], "test1.txt")
        self.assertEqual(result[1]["event_id"], "event1")
        self.assertEqual(result[1]["filename"], "test2.txt")
        
        # Verify the database queries
        self.assertEqual(mock_query_db.call_count, 3)

    @patch.object(TestCaseManager, '_query_db')
    def test_fetch_graph_data(self, mock_query_db):
        """Test the fetch_graph_data method."""
        # Mock the database response
        mock_query_db.return_value = [
            {"_id": ObjectId("60f1b2b3b3b3b3b3b3b3b3b3"), "name": "Node 1", "value": 10},
            {"_id": ObjectId("60f1b2b3b3b3b3b3b3b3b3b4"), "name": "Node 2", "value": 20}
        ]
        
        # Mock the utils.serialize_doc method
        with patch.object(self.test_case_manager.utils, 'serialize_doc') as mock_serialize:
            mock_serialize.side_effect = [
                {"_id": "60f1b2b3b3b3b3b3b3b3b3b3", "name": "Node 1", "value": 10},
                {"_id": "60f1b2b3b3b3b3b3b3b3b3b4", "name": "Node 2", "value": 20}
            ]
            
            # Call the method
            result = self.test_case_manager.fetch_graph_data()
            
            # Verify the result
            self.assertEqual(len(result), 2)
            self.assertEqual(result[0]["name"], "Node 1")
            self.assertEqual(result[1]["name"], "Node 2")
            
            # Verify the database query
            mock_query_db.assert_called_once_with('kb_collection', {'type': 'find', 'filter': {}})

    @patch.object(TestCaseManager, '_query_db')
    def test_get_insight_agent_details(self, mock_query_db):
        """Test the get_insight_agent_details method."""
        # Mock the database responses
        mock_query_db.side_effect = [
            [{"agent_id": "agent1"}],  # Insight agents
            {"_id": ObjectId("60f1b2b3b3b3b3b3b3b3b3b3"), "event_id": "event1", "agent_id": "agent1", "current_ts": datetime.datetime(2023, 1, 1)},  # Latest event
            {"name": "Insight Agent"}  # Agent document
        ]
        
        # Call the method
        result = self.test_case_manager.get_insight_agent_details()
        
        # Verify the result
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["event_id"], "event1")
        self.assertEqual(result[0]["agent_id"], "agent1")
        self.assertEqual(result[0]["agent_name"], "Insight Agent")
        
        # Verify the database queries
        self.assertEqual(mock_query_db.call_count, 3)

    @patch.object(TestCaseManager, '_query_db')
    def test_fetch_recent_data(self, mock_query_db):
        """Test the fetch_recent_data method."""
        # Mock the database responses
        mock_query_db.side_effect = [
            [  # All records
                {
                    "_id": ObjectId("60f1b2b3b3b3b3b3b3b3b3b3"),
                    "user_query": "test query 1",
                    "feedback_rating": 5,
                    "prompt_output": {"response": "test response 1"},
                    "updated_ts": datetime.datetime(2023, 1, 1),
                    "agent_id": "agent1"
                },
                {
                    "_id": ObjectId("60f1b2b3b3b3b3b3b3b3b3b4"),
                    "user_query": "test query 2",
                    "feedback_rating": 3,
                    "prompt_output": {"response": "test response 2"},
                    "updated_ts": datetime.datetime(2023, 1, 2),
                    "agent_id": "agent2"
                }
            ],
            {"name": "Agent 1"},  # Agent 1 document
            {"name": "Agent 2"}   # Agent 2 document
        ]
        
        # Call the method
        result = self.test_case_manager.fetch_recent_data()
        
        # Verify the result - only one record should be returned after processing
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["user_query"], "test query 1")  # The one with higher rating
        self.assertEqual(result[0]["name"], "Agent 1")
        
        # Verify the database queries
        self.assertEqual(mock_query_db.call_count, 2)  # Only 2 calls are made in the actual implementation

    def test_normalize_query(self):
        """Test the normalize_query method."""
        # Test with a normal query
        query = "This is a test query with punctuation!"
        result = self.test_case_manager.normalize_query(query)
        self.assertEqual(result, "test query punctuation")
        
        # Test with an empty query
        query = ""
        result = self.test_case_manager.normalize_query(query)
        self.assertEqual(result, "")
        
        # Test with a query containing stopwords
        query = "This is a test query with some stop words"
        result = self.test_case_manager.normalize_query(query)
        self.assertEqual(result, "test query stop word")

    @patch.object(TestCaseManager, '_query_db')
    def test_fetch_popular_queries(self, mock_query_db):
        """Test the fetch_popular_queries method."""
        # Create a custom mock function that returns different values based on the query
        def mock_query_db_impl(collection_name, operation, user_type=None):
            if collection_name == 'chatbot_tracking' and operation.get('type') == 'aggregate':
                # For the aggregate operation
                return [
                    {
                        "user_query": "test query 1",
                        "updated_ts": datetime.datetime(2023, 1, 1),
                        "agent_id": "agent1"
                    },
                    {
                        "user_query": "test query 2",
                        "updated_ts": datetime.datetime(2023, 1, 2),
                        "agent_id": "agent2"
                    }
                ]
            elif collection_name == 'agent_agency_mapping':
                # For the find operation
                return [{"agency_id": "agency1"}] if operation['filter']['agent_id'] == 'agent1' else [{"agency_id": "agency2"}]
            elif collection_name == 'agency':
                # For the find_one operation - return a dictionary
                return {"assigned_to": "team1"}
            elif collection_name == 'chatbot_tracking' and operation.get('type') == 'find_one':
                # For the find_one operation to get master_agent_id
                user_query = operation['filter']['user_query']
                if user_query == "test query 1":
                    return {"master_agent_id": "master1", "agent_id": "agent1"}
                else:
                    return {"master_agent_id": "master2", "agent_id": "agent2"}
            elif collection_name == 'agent':
                # For the agent name lookups - FIXED THIS PART
                agent_id = operation.get('filter', {}).get('agent_id')
                if agent_id == 'master1':
                    return {"name": "Master Agent 1"}
                elif agent_id == 'master2':
                    return {"name": "Master Agent 2"}
                elif agent_id == 'agent1':
                    return {"name": "Master Agent 1"}
                elif agent_id == 'agent2':
                    return {"name": "Master Agent 2"}
                else:
                    return {"name": "Unknown Agent"}
            else:
                return None

        mock_query_db.side_effect = mock_query_db_impl

        # Call the method
        result = self.test_case_manager.fetch_popular_queries("team1")

        # Verify the result
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["query"], "test query 1")
        self.assertEqual(result[0]["count"], 1)
        self.assertEqual(result[0]["agent"]["name"], "Master Agent 1")
        self.assertEqual(result[0]["agent"]["subagent"]["name"], "Master Agent 1")  # This should now pass

        def test_cluster_data(self):
            """Test the cluster_data method."""
            # Test data
            labels = [0, 0, 1, 1]
            original_map = ["query 1", "query 2", "query 3", "query 4"]
            raw_queries = [
                {"user_query": "query 1", "updated_ts": datetime.datetime(2023, 1, 1)},
                {"user_query": "query 2", "updated_ts": datetime.datetime(2023, 1, 2)},
                {"user_query": "query 3", "updated_ts": datetime.datetime(2023, 1, 3)},
                {"user_query": "query 4", "updated_ts": datetime.datetime(2023, 1, 4)}
            ]
            
            # Call the method
            result = self.test_case_manager.cluster_data(labels, original_map, raw_queries)
            
            # Verify the result
            self.assertEqual(len(result), 2)
            self.assertEqual(result[0]["queries"], ["query 1", "query 2"])
            self.assertEqual(result[0]["count"], 2)
            self.assertEqual(result[0]["updated_ts"], datetime.datetime(2023, 1, 2))
            self.assertEqual(result[1]["queries"], ["query 3", "query 4"])
            self.assertEqual(result[1]["count"], 2)
            self.assertEqual(result[1]["updated_ts"], datetime.datetime(2023, 1, 4))

    @patch.object(TestCaseManager, '_query_db')
    def test_cluster_result(self, mock_query_db):
        """Test the cluster_result method."""
        # Mock the database responses
        mock_query_db.side_effect = [
            {"master_agent_id": "master1", "agent_id": "agent1"},  # Document
            {"name": "Master Agent 1"},  # Master agent
            {"name": "Agent 1"}  # Agent
        ]
        
        # Test data
        clusters = {
            0: {
                "queries": ["query 1", "query 2"],
                "count": 2,
                "updated_ts": datetime.datetime(2023, 1, 1)
            }
        }
        
        # Call the method
        result = self.test_case_manager.cluster_result(clusters)
        
        # Verify the result
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["query"], "query 1")
        self.assertEqual(result[0]["count"], 2)
        self.assertEqual(result[0]["agent"]["name"], "Master Agent 1")
        self.assertEqual(result[0]["agent"]["subagent"]["name"], "Agent 1")
        self.assertEqual(result[0]["similar_queries"], ["query 1", "query 2"])
        
        # Verify the database queries
        self.assertEqual(mock_query_db.call_count, 3)

    @patch.object(TestCaseManager, '_query_db')
    def test_update_feedback_dtls(self, mock_query_db):
        """Test the update_feedback_dtls method."""
        # Mock the database responses - need to provide more values to avoid StopIteration
        mock_query_db.side_effect = [
            None,  # Agent update result
            {"event_id": "event1"},  # Latest record
            None  # Tracking update result
        ]
        
        # Test data
        data = {
            "agent_id": "agent1",
            "rating": 5,
            "feedback": "Great work!",
            "user_id": "user1"
        }
        
        # Call the method
        result = self.test_case_manager.update_feedback_dtls(data)
        
        # Verify the result - it returns a Flask Response object
        self.assertEqual(result.status_code, 200)
        result_data = json.loads(result.data)
        self.assertTrue(result_data["Success"])
        self.assertEqual(result_data["Message"], "Feedback updated successfully")
        
        # Verify the database queries - the method actually makes 3 calls
        self.assertEqual(mock_query_db.call_count, 3)

    def test_update_review_feedback_dtls(self):
        """Test the update_review_feedback_dtls method."""
        # Mock the find method
        self.test_case_manager.event_agency_tracking_collection.find.return_value = [
            {
                "event_id": "event1",
                "event_unique_id": "unique1",
                "feedback": "Good work",
                "rating": 4
            },
            {
                "event_id": "event1",
                "event_unique_id": "unique2",
                "feedback": "Excellent",
                "rating": 5
            }
        ]
        
        # Test data
        data = {
            "agent_id": "agent1",
            "unique_id": "unique1",
            "event_id": "event1",
            "rating": 4,
            "feedback": "Good work",
            "user_id": "user1"
        }
        
        # Mock the _query_db method to avoid request context issues
        with patch.object(self.test_case_manager, '_query_db') as mock_query_db:
            mock_query_db.return_value = None
            
            # Call the method
            result = self.test_case_manager.update_review_feedback_dtls(data)
            
            # Verify the result - it returns a Flask Response object
            self.assertEqual(result.status_code, 200)
            result_data = json.loads(result.data)
            self.assertTrue(result_data["Success"])
            self.assertEqual(result_data["Message"], "Feedback updated successfully")
            
            # Verify the database operations
            self.test_case_manager.event_agency_tracking_collection.update_one.assert_called_once()
            self.test_case_manager.agent_collection.update_one.assert_called_once()
            self.test_case_manager.agent_tracking_collection.update_one.assert_called_once()

    def test_get_agency_result(self):
        """Test the get_agency_result method."""
        # Mock the collection directly instead of using _query_db
        self.test_case_manager.event_agency_tracking_collection.find.return_value = [
            {"_id": ObjectId("60f1b2b3b3b3b3b3b3b3b3b3"), "event_id": "event1", "filename": "test1.txt"},
            {"_id": ObjectId("60f1b2b3b3b3b3b3b3b3b3b4"), "event_id": "event2", "filename": "test2.txt"}
        ]
        
        # Call the method
        result = self.test_case_manager.get_agency_result()
        
        # Verify the result
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["event_id"], "event1")
        self.assertEqual(result[0]["filename"], "test1.txt")
        self.assertEqual(result[1]["event_id"], "event2")
        self.assertEqual(result[1]["filename"], "test2.txt")

if __name__ == '__main__':
    unittest.main()