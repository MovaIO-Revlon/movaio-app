import unittest
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone, timedelta
from flask import jsonify
import agencyManage


# Import the class to be tested.
from agencyManage import AgencyManager


class TestAgencyManager(unittest.TestCase):
    @patch('agencyManage.DatabaseManager')
    @patch('agencyManage.CommonUtils')
    @patch('agencyManage.ConfigLoader')
    @patch('agencyManage.DatabaseCollections')
    def setUp(self, MockDbCollections, MockConfigLoader, MockCommonUtils, MockDatabaseManager):
        """Set up for each test method with robust, isolated patching."""
        self.MockDbCollections = MockDbCollections
        self.MockConfigLoader = MockConfigLoader
        self.MockCommonUtils = MockCommonUtils
        self.MockDatabaseManager = MockDatabaseManager

        self.agency_manager = AgencyManager()

        self.agency_manager._query_db = MagicMock()
        self.agency_manager.agency_collection = MagicMock()
        self.agency_manager.agent_collection = MagicMock()
        self.agency_manager.agent_agency_mapping_collection = MagicMock()
        self.agency_manager.project = MagicMock()
        self.agency_manager.kb_collection = MagicMock()
        self.agency_manager.event_agency_tracking_collection = MagicMock()
        self.agency_manager.agent_tracking_collection = MagicMock()
        self.agency_manager.agency_type_collection = MagicMock()

    # =================================================================
    # ORIGINAL AND CORRECTED TESTS
    # =================================================================

    def test_init(self):
        """Test the initialization of the AgencyManager class."""
        self.assertIsInstance(self.agency_manager.utils, MagicMock)
        self.assertIsInstance(self.agency_manager.config, MagicMock)
        self.assertIsInstance(self.agency_manager.db, MagicMock)
        self.assertEqual(self.agency_manager.utils, self.MockCommonUtils())
        self.assertEqual(self.agency_manager.config, self.MockConfigLoader())
        self.assertEqual(self.agency_manager.db, self.MockDatabaseManager())

    def test_compute_trending_flag_true(self):
        """Test compute_trending_flag returns True for a recent event."""
        agency_id = "AGENCY001"
        recent_ts = datetime.now(timezone.utc) - timedelta(hours=2)
        mock_event = {"created_ts": recent_ts}
        self.agency_manager._query_db.return_value = mock_event
        
        result = self.agency_manager.compute_trending_flag(agency_id, datetime.now(timezone.utc) - timedelta(days=1))
        
        self.assertTrue(result)
        self.agency_manager._query_db.assert_called_once_with(
            'event_agency_tracking',
            {'type': 'find_one', 'filter': {"agency_id": agency_id}},
            None
        )

    def test_compute_trending_flag_false_old_event(self):
        """Test compute_trending_flag returns False for an old event."""
        agency_id = "AGENCY001"
        old_ts = datetime.now(timezone.utc) - timedelta(days=2)
        mock_event = {"created_ts": old_ts}
        self.agency_manager._query_db.return_value = mock_event
        
        result = self.agency_manager.compute_trending_flag(agency_id, datetime.now(timezone.utc) - timedelta(days=1))
        
        self.assertFalse(result)

    def test_compute_trending_flag_false_no_event(self):
        """Test compute_trending_flag returns False when no event is found."""
        agency_id = "AGENCY001"
        self.agency_manager._query_db.return_value = None
        
        result = self.agency_manager.compute_trending_flag(agency_id, datetime.now(timezone.utc) - timedelta(days=1))
        
        self.assertFalse(result)

    def test_compute_run_count(self):
        """Test compute_run_count correctly sums events and chatbot runs."""
        agency_id = "AGENCY001"
        user_type = "test_user"
        
        mock_events = [
            {"eventTracking_UniqueId": "e1"},
            {"eventTracking_UniqueId": "e2"},
            {"eventTracking_UniqueId": "e1"}, # Duplicate
            {"eventTracking_UniqueId": "e3"}
        ]
        mock_mappings = [
            {"agent_id": "agent1"},
            {"agent_id": "agent2"}
        ]
        mock_chatbot_count = 5
        
        self.agency_manager._query_db.side_effect = [mock_events, mock_mappings, mock_chatbot_count]
        
        result = self.agency_manager.compute_run_count(agency_id, user_type)
        
        self.assertEqual(result, 8)
        self.assertEqual(self.agency_manager._query_db.call_count, 3)

    def test_get_agency_rating_valid_existing(self):
        """Test get_agency_rating returns a valid existing rating without updating."""
        agency_id = "AGENCY001"
        agency_doc = {"rating": "4.5"}
        user_type = "test_user"
        
        result = self.agency_manager.get_agency_rating(agency_doc, agency_id, user_type)
        
        self.assertEqual(result, 4.5)
        self.agency_manager._query_db.assert_not_called()

    def test_get_agency_rating_invalid_generates_new(self):
        """Test get_agency_rating generates a new rating if existing is invalid."""
        agency_id = "AGENCY001"
        agency_doc = {"rating": "invalid_rating"}
        user_type = "test_user"
        new_rating = 4.2
        
        self.agency_manager.utils.generate_random_rating.return_value = new_rating
        self.agency_manager.utils.get_current_timestamp.return_value = "2023-01-01T00:00:00Z"
        
        result = self.agency_manager.get_agency_rating(agency_doc, agency_id, user_type)
        
        self.assertEqual(result, new_rating)
        self.agency_manager.utils.generate_random_rating.assert_called_once()
        self.agency_manager._query_db.assert_called_once_with(
            'agency',
            {
                'type': 'update_one',
                'filter': {"agency_id": agency_id},
                'update': {"$set": {"rating": str(new_rating), "updated_ts": "2023-01-01T00:00:00Z"}}
            },
            user_type
        )

    def test_get_agency_result_structure(self):
        """Test get_agency_result returns a correctly structured dictionary."""
        agency = {"agency_id": "AGENCY001", "agency_name": "Test Agency"}
        agents = [{"agent_id": "agent1", "name": "Agent 1"}]
        rating = 4.5
        run_count = 10
        trending_flag = True
        
        result = self.agency_manager.get_agency_result(agency, agents, rating, run_count, trending_flag)
        
        expected_keys = [
            "agency_id", "agency_name", "agency_desc", "agency_type", "avatar",
            "provider_id", "provider_name", "last_run_ts", "agent_type_counts",
            "created_ts", "updated_ts", "created_by", "assigned_to", "agents",
            "usage_count", "rating", "agency_run_count", "trending_agency"
        ]
        self.assertEqual(sorted(list(result.keys())), sorted(expected_keys))
        self.assertEqual(result["agency_id"], "AGENCY001")
        self.assertEqual(result["agents"], agents)
        self.assertEqual(result["rating"], rating)
        self.assertEqual(result["usage_count"], run_count)
        self.assertEqual(result["trending_agency"], trending_flag)

    def test_get_agency_with_agents_details_success(self):
        """Test the main workflow of get_agency_with_agents_details."""
        mock_agencies = [{"agency_id": "AGENCY001", "rating": "4.0"}]
        mock_mappings = [{"agency_id": "AGENCY001", "agent_id": "agent1"}]

        self.agency_manager._query_db.side_effect = [mock_agencies, mock_mappings]

        self.agency_manager.compute_trending_flag = MagicMock(return_value=True)
        self.agency_manager.compute_run_count = MagicMock(return_value=20)
        self.agency_manager.get_agents_for_agency = MagicMock(return_value=[{"agent_id": "agent1"}])
        self.agency_manager.get_agency_rating = MagicMock(return_value=4.0)
        self.agency_manager.update_agency_db_flags = MagicMock()

        result = self.agency_manager.get_agency_with_agents_details(user_type='test_project')

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["agency_id"], "AGENCY001")
        self.agency_manager.update_agency_db_flags.assert_called_once_with("AGENCY001", True, "test_project")

    @patch('agencyManage.jsonify')
    def test_get_agency_with_agents_details_no_agencies(self, mock_jsonify):
        """Test get_agency_with_agents_details when no agencies are found."""
        self.agency_manager._query_db.return_value = []  # Mock empty agency list
        
        expected_json = {"Success": False, "Message": "No agencies found"}
        expected_status_code = 200
        mock_jsonify.return_value = expected_json

        result = self.agency_manager.get_agency_with_agents_details(user_type='test_project')
        
        mock_jsonify.assert_called_once_with(expected_json)
        self.assertEqual(result, (expected_json, expected_status_code))

    def test_onboard_and_update_agency_new(self):
        """Test onboarding a new agency."""
        payload = {
            "agency_name": "New Agency",
            "agents": [{"agent_id": "agent1", "agent_name": "Agent 1", "order_number": 1}],
            "team": "TeamA"
        }
        mock_request = MagicMock()
        mock_request.get_json.return_value = payload

        self.agency_manager.generate_agency_id = MagicMock(return_value="AGENCY123")
        self.agency_manager.project.find.return_value = [{"projectName": "project1", "database_name": "db1"}]
        self.agency_manager.agency_collection.find_one.return_value = None
        self.agency_manager.agent_collection.find_one.return_value = {"agent_id": "agent1", "name": "Agent 1"}
        
        self.agency_manager._activate_agent = MagicMock()
        self.agency_manager._upsert_mapping = MagicMock()
        self.agency_manager._upsert_agency = MagicMock()
        
        is_update, agency_id, type_counts = self.agency_manager.onboard_and_update_agency_with_agents_details(mock_request)
        
        self.assertFalse(is_update)
        self.assertEqual(agency_id, "AGENCY123")
        self.agency_manager._upsert_agency.assert_called_once()
        call_args = self.agency_manager._upsert_agency.call_args[0]
        self.assertEqual(call_args[0], "AGENCY123")
        self.assertFalse(call_args[2]) # is_update flag

    @patch('agencyManage.jsonify')
    def test_onboard_and_update_agency_missing_payload(self, mock_jsonify):
        """Test onboarding with missing required payload fields."""
        mock_request = MagicMock()
        mock_request.get_json.return_value = {"agency_name": "Test Agency"} # Missing 'agents'

        expected_json = {"Success": False, "Message": "agency_name and agents are required"}
        expected_status_code = 200
        mock_jsonify.return_value = expected_json

        result = self.agency_manager.onboard_and_update_agency_with_agents_details(mock_request)
        
        mock_jsonify.assert_called_once_with(expected_json)
        self.assertEqual(result, (expected_json, expected_status_code))

    def test_delete_agency_details_success(self):
        """Test successful soft-deletion of an agency."""
        agency_id = "AGENCY001"
        team_name = "TeamA"
        db_name = "db1"
        
        self.agency_manager.agency_collection.find_one.return_value = {
            "agency_id": agency_id, "assigned_to": team_name, "is_deleted": False
        }
        self.agency_manager.project.find.return_value = iter([{"projectName": "project1"}])
        self.agency_manager.project.find_one.return_value = {"database_name": db_name}
        self.agency_manager.agent_agency_mapping_collection.distinct.return_value = ["agent1", "agent2"]
        
        result = self.agency_manager.delete_agency_details(agency_id)
        
        self.assertTrue(result["success"])
        self.agency_manager.agency_collection.update_one.assert_called_once()
        self.agency_manager.agent_collection.update_many.assert_called_once()
        
        expected_update_calls = [
            unittest.mock.call('agency', unittest.mock.ANY, db_name),
            unittest.mock.call('agent_agency_mapping', unittest.mock.ANY, db_name),
            unittest.mock.call('agent', unittest.mock.ANY, db_name)
        ]
        self.agency_manager._query_db.assert_has_calls(expected_update_calls, any_order=False)

    def test_delete_agency_details_already_deleted(self):
        """Test deleting an agency that is already marked as deleted."""
        agency_id = "AGENCY001"
        self.agency_manager.agency_collection.find_one.return_value = {
            "agency_id": agency_id, "is_deleted": True
        }
        
        result = self.agency_manager.delete_agency_details(agency_id)
        
        self.assertFalse(result["success"])
        self.assertEqual(result["message"], "Agency already deleted")

    def test_delete_agency_not_found(self):
        """Test deleting an agency that does not exist."""
        agency_id = "AGENCY999"
        self.agency_manager.agency_collection.find_one.return_value = None
        
        result = self.agency_manager.delete_agency_details(agency_id)
        
        self.assertFalse(result["success"])
        self.assertEqual(result["message"], "Agency not found")

    @patch('agencyManage.get_current_user')
    def test_get_task_agents_with_agencies_details_completed(self, mock_get_current_user):
        """Test get_task_agents_with_agencies_details for a completed agent run."""
        mock_get_current_user.return_value = {"ActiveProject": "test_project"}
        
        mock_agent = {"agent_id": "agent1", "name": "Task Agent 1", "run_status": "completed"}
        mock_last_run = {"created_ts": datetime.now(timezone.utc), "action": [{"flag": False, "percentage": 75}]}
        
        self.agency_manager._query_db.side_effect = [[mock_agent], mock_last_run]
        
        self.agency_manager.agent_agency_mapping_collection.find.return_value = [{"agency_id": "AGENCY001"}]
        self.agency_manager.agency_collection.find_one.return_value = {"agency_id": "AGENCY001"}
        
        result = self.agency_manager.get_task_agents_with_agencies_details()
        
        self.assertEqual(len(result), 1)
        agent_data = result[0]
        self.assertEqual(agent_data["confidence_perc"], 75)
        self.assertEqual(agent_data["review_status"], "yet to start")

    @patch('agencyManage.get_current_user')
    def test_get_task_agents_with_agencies_details_completed_all_passed(self, mock_get_current_user):
        """Test task agent where all actions in the last run passed."""
        mock_get_current_user.return_value = {"ActiveProject": "test_project"}
        
        mock_agent = {"agent_id": "agent1", "name": "Task Agent 1", "run_status": "completed"}
        mock_last_run = {"created_ts": datetime.now(timezone.utc), "action": [{"flag": True}, {"flag": True}]}
        
        self.agency_manager._query_db.side_effect = [[mock_agent], mock_last_run]
        
        self.agency_manager.agent_agency_mapping_collection.find.return_value = [{"agency_id": "AGENCY001"}]
        self.agency_manager.agency_collection.find_one.return_value = {"agency_id": "AGENCY001"}
        
        result = self.agency_manager.get_task_agents_with_agencies_details()
        
        self.assertEqual(len(result), 1)
        agent_data = result[0]
        self.assertEqual(agent_data["confidence_perc"], 0)
        self.assertEqual(agent_data["confidence_status"], "yet to start")
        self.assertEqual(agent_data["review_status"], "Take Action")

    @patch('agencyManage.get_current_user')
    def test_get_task_agents_with_agencies_details_no_agents(self, mock_get_current_user):
        """Test when no task agents are found."""
        mock_get_current_user.return_value = {"ActiveProject": "test_project"}
        
        self.agency_manager._query_db.return_value = [] # Mock empty agent list
        
        result = self.agency_manager.get_task_agents_with_agencies_details()
        
        self.assertEqual(result, []) # Should return an empty list

    def test_get_agency_types_details_success(self):
        """Test successful retrieval of agency types."""
        mock_types = [{"type_id": 1, "type_name": "Type A"}, {"type_id": 2, "type_name": "Type B"}]
        self.agency_manager.agency_type_collection.find.return_value = mock_types
        
        result = self.agency_manager.get_agency_types_details()
        
        self.assertEqual(result, mock_types)
        self.agency_manager.agency_type_collection.find.assert_called_once_with({}, {'_id': 0})

    def test_get_trending_agency_stats_dtls_success(self):
        """Test successful retrieval of trending agency stats."""
        self.agency_manager.agency_collection.count_documents.side_effect = [100, 25] # total, trending
        mock_trending_agencies = [{"agency_id": "AGENCY001", "agency_name": "Trending Agency"}]
        self.agency_manager.agency_collection.find.return_value = mock_trending_agencies
        mock_events = [{"agency_id": "AGENCY001", "usagecount": "10"}, {"agency_id": "AGENCY001", "usagecount": "5"}]
        self.agency_manager.event_agency_tracking_collection.find.return_value = mock_events
        
        total_count, trending_count, trending_agencies = self.agency_manager.get_trending_agency_stats_dtls()
        
        self.assertEqual(total_count, 100)
        self.assertEqual(trending_count, 25)
        self.assertEqual(len(trending_agencies), 1)
        self.assertEqual(trending_agencies[0]["usage_count"], 15) # 10 + 5

    def test_get_agent_and_order2_agents_details_success(self):
        """Test successful retrieval of a main agent and its order-2 agents."""
        mock_request = MagicMock()
        mock_request.get_json.return_value = {"agent_id": "agent1"}
        
        mock_main_agent = {"agent_id": "agent1", "name": "Main Agent"}
        mock_mapping = {"agency_id": "AGENCY001", "agent_id": "agent1", "status": "active"}
        mock_order2_agent = {"agent_id": "agent2", "name": "Order 2 Agent"}
        
        self.agency_manager.agent_collection.find_one.side_effect = [mock_main_agent, mock_order2_agent]
        self.agency_manager.agent_agency_mapping_collection.find_one.return_value = mock_mapping
        self.agency_manager.agent_agency_mapping_collection.find.return_value = [mock_mapping] # For order 2
        
        main_agent_info, order_2_agents = self.agency_manager.get_agent_and_order2_agents_details(mock_request)
        
        self.assertEqual(main_agent_info["agent_id"], "agent1")
        self.assertEqual(len(order_2_agents), 1)
        self.assertEqual(order_2_agents[0]["agent_id"], "agent2")

    def test_update_agency_mappings_success(self):
        """Test successful retrieval of agency mappings and agent details."""
        mock_request = MagicMock()
        mock_request.get_json.return_value = {"agency_id": "AGENCY001"}
        
        mock_mappings = [{"_id": 1, "agency_id": "AGENCY001", "agent_id": "agent1"}]
        mock_agents = [{"_id": 2, "agent_id": "agent1", "name": "Agent 1"}]
        
        self.agency_manager.agent_agency_mapping_collection.find.return_value = mock_mappings
        self.agency_manager.agent_collection.find.return_value = mock_agents
        
        mappings, agents = self.agency_manager.update_agency_mappings(mock_request)
        
        self.assertEqual(len(mappings), 1)
        self.assertEqual(mappings[0]["_id"], "1") # _id is converted to string
        self.assertEqual(len(agents), 1)
        self.assertEqual(agents[0]["_id"], "2")

    # =================================================================
    # NEW TESTS FOR COVERAGE
    # =================================================================

    @patch('agencyManage.jsonify')
    def test_onboard_and_update_agency_empty_agents_list(self, mock_jsonify):
        """Test onboarding when the agents list is provided but empty."""
        payload = {"agency_name": "Test Agency", "agents": [], "team": "TeamA"}
        mock_request = MagicMock()
        mock_request.get_json.return_value = payload
        expected_json = {"Success": False, "Message": "agency_name and agents are required"}
        mock_jsonify.return_value = expected_json

        result = self.agency_manager.onboard_and_update_agency_with_agents_details(mock_request)
        
        mock_jsonify.assert_called_once_with(expected_json)
        self.assertEqual(result, (expected_json, 200))

    @patch('agencyManage.jsonify')
    def test_get_agency_with_agents_details_exception(self, mock_jsonify):
        """Test exception handling in get_agency_with_agents_details."""
        self.agency_manager._query_db.side_effect = Exception("Database error")
        expected_json = {"Success": False, "Message": "Database error"}
        mock_jsonify.return_value = expected_json

        result = self.agency_manager.get_agency_with_agents_details(user_type='test_project')
        
        mock_jsonify.assert_called_once_with(expected_json)
        self.assertEqual(result, (expected_json, 500))

        def test_compute_trending_flag_with_string_timestamp(self):
            """Test compute_trending_flag when created_ts is a string."""
            agency_id = "AGENCY001"
            # CORRECTION: Use a timestamp string that is recent (within the last day)
            recent_ts_str = (datetime.now(timezone.utc) - timedelta(hours=2)).strftime('%a, %d %b %Y %H:%M:%S GMT')
            mock_event = {"created_ts": recent_ts_str}
            self.agency_manager._query_db.return_value = mock_event

            result = self.agency_manager.compute_trending_flag(agency_id, datetime.now(timezone.utc) - timedelta(days=1))

            self.assertTrue(result)

    def test_deactivate_absent_agents_nothing_to_do(self):
        """Test deactivating agents when all are already active."""
        agency_id = "AGENCY001"
        self.agency_manager.agent_agency_mapping_collection.find.return_value = [] # No inactive agents found
        project_names = ["project1"]

        self.agency_manager._deactivate_absent_agents(agency_id, ["agent1", "agent2"], project_names)
        
        self.agency_manager.agent_collection.update_many.assert_not_called()
        self.agency_manager.agent_agency_mapping_collection.update_many.assert_not_called()

    @patch('agencyManage.jsonify')
    def test_onboard_and_update_agency_general_exception(self, mock_jsonify):
        """Test the general exception handler in onboard_and_update_agency_with_agents_details."""
        payload = {
            "agency_name": "Test Agency",
            "agents": [{"agent_id": "agent1", "agent_name": "Agent 1", "order_number": 1}],
            "team": "TeamA"
        }
        mock_request = MagicMock()
        mock_request.get_json.return_value = payload

        # Mock one of the internal methods to raise an exception
        self.agency_manager._process_agents = MagicMock(side_effect= Exception("Unexpected processing error"))
        
        expected_json = {"Success": False, "Message": "Unexpected processing error"}
        mock_jsonify.return_value = expected_json

        result = self.agency_manager.onboard_and_update_agency_with_agents_details(mock_request)
        
        # Assert that the exception was caught and handled correctly
        mock_jsonify.assert_called_once_with(expected_json)
        self.assertEqual(result, (expected_json, 500))

    @patch('agencyManage.jsonify')
    def test_delete_agency_details_team_has_no_projects(self, mock_jsonify):
        """Test deleting an agency whose team is not assigned to any projects."""
        agency_id = "AGENCY001"
        self.agency_manager.agency_collection.find_one.return_value = {
            "agency_id": agency_id, "assigned_to": "TeamA", "is_deleted": False
        }
        self.agency_manager.project.find.return_value = iter([])
        expected_json = {"status": "error", "message": "No projects found with team TeamA"}
        mock_jsonify.return_value = expected_json

        result = self.agency_manager.delete_agency_details(agency_id)

        mock_jsonify.assert_called_once_with(expected_json)
        self.assertEqual(result, (expected_json, 404))

    @patch('agencyManage.jsonify')
    def test_get_agent_and_order2_agents_details_agent_not_found(self, mock_jsonify):
        """Test get_agent_and_order2_agents_details when the main agent is not found."""
        mock_request = MagicMock()
        mock_request.get_json.return_value = {"agent_id": "nonexistent_agent"}
        expected_json = {"Success": False, "Message": "Agent not found"}
        mock_jsonify.return_value = expected_json

        self.agency_manager.agent_collection.find_one.return_value = None
        
        result = self.agency_manager.get_agent_and_order2_agents_details(mock_request)
        
        mock_jsonify.assert_called_once_with(expected_json)
        self.assertEqual(result, (expected_json, 200))

    @patch('agencyManage.jsonify')
    def test_get_task_agents_with_agencies_details_exception(self, mock_jsonify):
        """Test exception handling in get_task_agents_with_agencies_details."""
        self.agency_manager._query_db.side_effect = Exception("DB connection failed")
        expected_json = {"Success": False, "Message": "DB connection failed"}
        mock_jsonify.return_value = expected_json

        result = self.agency_manager.get_task_agents_with_agencies_details()
        
        mock_jsonify.assert_called_once_with(expected_json)
        self.assertEqual(result, (expected_json, 500))

    @patch('agencyManage.jsonify')
    def test_update_agency_mappings_missing_agency_id(self, mock_jsonify):
        """Test update_agency_mappings when agency_id is missing from payload."""
        mock_request = MagicMock()
        mock_request.get_json.return_value = {} # Missing agency_id
        expected_json = {"Success": False, "Message": "Missing required field: agency_id"}
        mock_jsonify.return_value = expected_json

        result = self.agency_manager.update_agency_mappings(mock_request)
        
        mock_jsonify.assert_called_once_with(expected_json)
        self.assertEqual(result, (expected_json, 200))

    def test_generate_agency_id_first_agency(self):
        """Test generate_agency_id when no other agencies exist."""
        self.agency_manager.agency_collection.find_one.return_value = None
        
        result = self.agency_manager.generate_agency_id()
        
        self.assertEqual(result, "AGENCY001")

    @patch('agencyManage.jsonify')
    def test_get_agency_types_details_exception(self, mock_jsonify):
        """Test exception handling in get_agency_types_details."""
        self.agency_manager.agency_type_collection.find.side_effect = Exception("Collection error")
        expected_json = {"Success": False, "Message": "Collection error"}
        mock_jsonify.return_value = expected_json

        result = self.agency_manager.get_agency_types_details()
        
        mock_jsonify.assert_called_once_with(expected_json)
        self.assertEqual(result, (expected_json, 500))

    @patch('agencyManage.jsonify')
    def test_get_trending_agency_stats_dtls_exception(self, mock_jsonify):
        """Test exception handling in get_trending_agency_stats_dtls."""
        self.agency_manager.agency_collection.count_documents.side_effect = Exception("Count error")
        expected_json = {"error": "Count error"}
        mock_jsonify.return_value = expected_json

        result = self.agency_manager.get_trending_agency_stats_dtls()
        
        mock_jsonify.assert_called_once_with(expected_json)
        self.assertEqual(result, (expected_json, 500))

    # =================================================================
    # ADDITIONAL TARGETED TESTS FOR >80% COVERAGE (CORRECTED)
    # =================================================================

    @patch('agencyManage.jsonify')
    def test_onboard_and_update_agency_get_json_exception(self, mock_jsonify):
        """Test onboard when request.get_json() fails."""
        mock_request = MagicMock()
        mock_request.get_json.side_effect = Exception("Invalid JSON")
        expected_json = {"Success": False, "Message": "Invalid JSON"}
        mock_jsonify.return_value = expected_json

        result = self.agency_manager.onboard_and_update_agency_with_agents_details(mock_request)
        
        mock_jsonify.assert_called_once_with(expected_json)
        self.assertEqual(result, (expected_json, 500))

    def test_compute_trending_flag_invalid_string_timestamp(self):
        """Test compute_trending_flag with an unparsable string timestamp."""
        agency_id = "AGENCY001"
        invalid_ts_str = "this is not a date"
        mock_event = {"created_ts": invalid_ts_str}
        self.agency_manager._query_db.return_value = mock_event
        
        result = self.agency_manager.compute_trending_flag(agency_id, datetime.now(timezone.utc) - timedelta(days=1))
        
        self.assertFalse(result)

    def test__process_agents_with_invalid_agent_in_list(self):
        """Test _process_agents skips invalid agents and processes valid ones."""
        agency_id = "AGENCY001"
        agency_name = "Test Agency"
        agents = [
            {"agent_name": "Valid Agent", "order_number": 1}, # Missing agent_id
            {"agent_id": "agent2", "order_number": 2},         # Missing agent_name
            {"agent_id": "agent3", "agent_name": "Agent 3", "order_number": 3} # Valid
        ]
        project_names = ["project1"]
        
        self.agency_manager.agent_collection.find_one.return_value = {"agent_id": "agent3", "name": "Agent 3"}
        self.agency_manager._activate_agent = MagicMock()
        self.agency_manager._upsert_mapping = MagicMock()

        type_counts, agent_ids = self.agency_manager._process_agents(agents, agency_id, agency_name, project_names)
        
        self.assertEqual(agent_ids, ["agent3"])
        self.agency_manager._activate_agent.assert_called_once_with("Agent 3", project_names)
        self.agency_manager._upsert_mapping.assert_called_once()

    # CORRECTED TEST: Now checks for the correct two calls to _query_db
    def test__activate_agent_inserts_new_agent_in_project(self):
        """Test _activate_agent inserts an agent into a project DB if it doesn't exist."""
        agent_name = "Agent 1"
        project_names = ["project1"]
        db_name = "db1"
        agent_data = {"agent_id": "agent1", "name": agent_name}
        
        self.agency_manager.agent_collection.find_one.return_value = agent_data
        self.agency_manager.project.find_one.return_value = {"database_name": db_name}
        # The first call (find_one) returns None, the second (insert_one) is the one we're testing
        self.agency_manager._query_db.side_effect = [None, MagicMock()]

        self.agency_manager._activate_agent(agent_name, project_names)
        
        # Assert that _query_db was called twice with the expected operations
        expected_calls = [
            unittest.mock.call('agent', {'type': 'find_one', 'filter': {'name': 'Agent 1'}, 'projection': {'_id': 1}}, db_name),
            unittest.mock.call('agent', {'type': 'insert_one', 'document': agent_data}, db_name)
        ]
        self.agency_manager._query_db.assert_has_calls(expected_calls)

    # CORRECTED TEST: Now checks for the correct two calls to _query_db
    def test__upsert_agency_new_agency_not_in_project(self):
        """Test _upsert_agency when creating a new agency that isn't in the project DB."""
        agency_id = "AGENCY001"
        agency_doc = {"agency_name": "New Agency"}
        self.agency_manager.project.find_one.return_value = {"database_name": "db1"}
        # The first call (find_one) returns None, the second (insert_one) is the one we're testing
        self.agency_manager._query_db.side_effect = [None, MagicMock()]

        self.agency_manager._upsert_agency(agency_id, agency_doc, is_update=False, project_names=["project1"])
        
        self.agency_manager.agency_collection.insert_one.assert_called_once()
        expected_calls = [
            unittest.mock.call('agency', {'type': 'find_one', 'filter': {'agency_id': agency_id}, 'projection': {'_id': 1}}, db_name),
            unittest.mock.call('agency', unittest.mock.ANY, db_name) # Use ANY for the document as it's complex
        ]
        self.agency_manager._query_db.assert_has_calls(expected_calls)

    # CORRECTED TEST: Mock the method on the instance
    def test__upsert_mapping_new_mapping_not_in_project(self):
        """Test _upsert_mapping when creating a new mapping that isn't in the project DB."""
        # Mock the method on the instance
        self.agency_manager.generate_mapping_id = MagicMock(return_value="MAP001")
        self.agency_manager.project.find_one.return_value = {"database_name": "db1"}
        self.agency_manager._query_db.side_effect = [None, MagicMock()] # find_one returns None, insert_one happens
        
        self.agency_manager._upsert_mapping("AGENCY001", "Agency A", "agent1", "Agent 1", 1, ["project1"])
        
        self.agency_manager.agent_agency_mapping_collection.insert_one.assert_called_once()
        expected_calls = [
            unittest.mock.call('agent_agency_mapping', {'type': 'find_one', 'filter': {"agency_id": "AGENCY001", "agent_name": "Agent 1"}, 'projection': {'_id': 1}}, "db1"),
            unittest.mock.call('agent_agency_mapping', unittest.mock.ANY, "db1")
        ]
        self.agency_manager._query_db.assert_has_calls(expected_calls)


    def test__upsert_agency_new_agency_not_in_project(self):
        """Test _upsert_agency when creating a new agency that isn't in the project DB."""
        agency_id = "AGENCY001"
        agency_doc = {"agency_name": "New Agency"}
        db_name = "db1" # Moved db_name here
        
        self.agency_manager.project.find_one.return_value = {"database_name": db_name}
        self.agency_manager._query_db.side_effect = [None, MagicMock()]

        self.agency_manager._upsert_agency(agency_id, agency_doc, is_update=False, project_names=["project1"])
        
        self.agency_manager.agency_collection.insert_one.assert_called_once()
        expected_calls = [
            unittest.mock.call('agency', {'type': 'find_one', 'filter': {'agency_id': agency_id}, 'projection': {'_id': 1}}, db_name),
            unittest.mock.call('agency', unittest.mock.ANY, db_name)
        ]
        self.agency_manager._query_db.assert_has_calls(expected_calls)
    
    def test__upsert_mapping_new_mapping_not_in_project(self):
        """Test _upsert_mapping when creating a new mapping that isn't in the project DB."""
        # Mock the method on the instance
        self.agency_manager.generate_mapping_id = MagicMock(return_value="MAP001")
        self.agency_manager.project.find_one.return_value = {"database_name": "db1"}
        
        # CORRECTION: Mock the master collection find_one to return None to trigger an insert
        self.agency_manager.agent_agency_mapping_collection.find_one.return_value = None
        self.agency_manager._query_db.side_effect = [None, MagicMock()] # project find_one, project insert_one
        
        self.agency_manager._upsert_mapping("AGENCY001", "Agency A", "agent1", "Agent 1", 1, ["project1"])
        
        # Now insert_one on the master collection should be called
        self.agency_manager.agent_agency_mapping_collection.insert_one.assert_called_once()
        expected_calls = [
            unittest.mock.call('agent_agency_mapping', {'type': 'find_one', 'filter': {"agency_id": "AGENCY001", "agent_name": "Agent 1"}, 'projection': {'_id': 1}}, "db1"),
            unittest.mock.call('agent_agency_mapping', unittest.mock.ANY, "db1")
        ]
        self.agency_manager._query_db.assert_has_calls(expected_calls)
    
        # NEW TEST TO GET COVERAGE OVER 80%
    @patch('agencyManage.jsonify')
    def test_get_agent_and_order2_agents_details_exception(self, mock_jsonify):
        """Test the general exception handler in get_agent_and_order2_agents_details."""
        import agencyManage
        
        # Create a mock request that raises an exception when get_json is called
        mock_request = MagicMock()
        mock_request.get_json.side_effect = Exception("Failed to parse JSON body")
        
        # Store the original request to restore it later
        original_request = agencyManage.request
        
        try:
            # Monkey-patch the request object in the module
            agencyManage.request = mock_request
            
            expected_json = {"Success": False, "Message": "Failed to parse JSON body"}
            mock_jsonify.return_value = expected_json

            # The method under test calls the patched request.get_json()
            result = self.agency_manager.get_agent_and_order2_agents_details(mock_request)
            
            # Assert that the exception was caught and handled correctly
            mock_jsonify.assert_called_once_with(expected_json)
            self.assertEqual(result, (expected_json, 500))
        finally:
            # IMPORTANT: Always restore the original request object
            agencyManage.request = original_request


    @patch('agencyManage.jsonify')
    @patch('agencyManage.get_current_user')
    def test_get_task_agents_with_agencies_details_db_error(self, mock_get_current_user, mock_jsonify):
        """Test exception handling in get_task_agents_with_agencies_details."""
        mock_get_current_user.return_value = {"ActiveProject": "test_project"}
        
        # Force an exception in the _query_db call within the method
        self.agency_manager._query_db.side_effect = Exception("Database connection failed")
        
        expected_json = {"Success": False, "Message": "Database connection failed"}
        mock_jsonify.return_value = expected_json

        result = self.agency_manager.get_task_agents_with_agencies_details()
        
        mock_jsonify.assert_called_once_with(expected_json)
        self.assertEqual(result, (expected_json, 500))

    # CORRECTED TEST: The method does not return an error, it returns empty lists
    def test_update_agency_mappings_no_mappings_found(self):
        """Test update_agency_mappings when agency exists but has no mappings."""
        mock_request = MagicMock()
        mock_request.get_json.return_value = {"agency_id": "AGENCY001"}
        
        # Mock that agency has no mappings
        self.agency_manager.agent_agency_mapping_collection.find.return_value = []
        self.agency_manager.agent_collection.find.return_value = []

        mappings, agents = self.agency_manager.update_agency_mappings(mock_request)
        
        # The method should return empty lists, not a JSON error
        self.assertEqual(mappings, [])
        self.assertEqual(agents, [])


if __name__ == '__main__':
    unittest.main(argv=['first-arg-is-ignored'], exit=False)