import unittest
from unittest.mock import patch, MagicMock, mock_open
import sys
import os
import requests
from agent import (
    UserStoryReader,
    Agent1,
    Agent2,
    TestWorkflowManager,
    run_test_workflow
)

# Mock all external dependencies at the module level
sys.modules['pydantic'] = MagicMock()
sys.modules['langgraph'] = MagicMock()
sys.modules['flask'] = MagicMock()
sys.modules['flask_cors'] = MagicMock()
sys.modules['pymongo'] = MagicMock()
sys.modules['pandas'] = MagicMock()
sys.modules['config_loader'] = MagicMock()
sys.modules['commonutils'] = MagicMock()


class TestUserStoryReader(unittest.TestCase):
    @patch('agent.ConfigLoader')
    def setUp(self, MockConfigLoader):
        self.mock_config_loader = MockConfigLoader.return_value
        self.reader = UserStoryReader()

    @patch('builtins.open', new_callable=mock_open, read_data="This is a user story.")
    @patch('os.path.exists')
    @patch('os.path.join')
    def test_read_from_file_success(self, mock_join, mock_exists, mock_file):
        """Test successfully reading a user story from a file."""
        # Arrange
        filename = "story.txt"
        expected_path = "/fake/path/story.txt"
        mock_join.return_value = expected_path
        mock_exists.return_value = True

        # Act
        result = self.reader.read_from_file(filename)

        # Assert
        self.assertEqual(result, "This is a user story.")
        mock_join.assert_called_once_with(self.mock_config_loader.USER_STORY_FOLDER, filename)
        mock_exists.assert_called_once_with(expected_path)
        mock_file.assert_called_once_with(expected_path, 'r', encoding='utf-8')

    @patch('os.path.exists')
    @patch('os.path.join')
    def test_read_from_file_not_found(self, mock_join, mock_exists):
        """Test that a FileNotFoundError is raised if the file does not exist."""
        # Arrange
        filename = "nonexistent.txt"
        mock_join.return_value = "/fake/path/nonexistent.txt"
        mock_exists.return_value = False

        # Act & Assert
        with self.assertRaises(FileNotFoundError) as context:
            self.reader.read_from_file(filename)
        
        self.assertIn("User story file 'nonexistent.txt' not found", str(context.exception))


class TestAgent1(unittest.TestCase):
    def setUp(self):
        self.event_id = "event-123"
        self.agent_id = "agent-1"
        self.filename = "story.txt"
        
    # CORRECTION: Patch the UserStoryReader class, not the instance attribute.
    # The instance will be created with the mocked class automatically.
    @patch('agent.UserStoryReader')
    def test_execute(self, MockUserStoryReader):
        """Test the execute method calls the reader and returns the correct state."""
        # Arrange
        user_story_content = "As a user, I want to log in."
        mock_reader_instance = MockUserStoryReader.return_value
        mock_reader_instance.read_from_file.return_value = user_story_content
        
        # The agent is now created inside the test with the mocked reader
        agent1 = Agent1(self.event_id, self.agent_id, self.filename)

        # Act
        result = agent1.execute({})

        # Assert
        MockUserStoryReader.assert_called_once()
        mock_reader_instance.read_from_file.assert_called_once_with(self.filename)
        self.assertEqual(result, {"user_story": user_story_content})


class TestAgent2(unittest.TestCase):
    @patch('agent.DatabaseCollections')
    @patch('agent.CommonUtils')
    @patch('agent.ConfigLoader')
    def setUp(self, MockConfigLoader, MockCommonUtils, MockDatabaseCollections):
        self.agent_data = {
            "agent_api_url": "https://api.example.com",
            "agent_api_key": "secret-key",
            "user_id": "user-123",
            "api_agent_id": "api-agent-456",
            "agent_session_id": "session-789"
        }
        self.event_id = "event-123"
        self.agent_id = "agent-2"
        self.agent2 = Agent2(self.agent_data, self.event_id, self.agent_id)

    @patch('requests.post')
    def test_execute_api_success(self, mock_post):
        """Test successful execution with a successful API call."""
        # Arrange
        initial_state = {"user_story": "A user story for testing."}
        expected_response_text = '{"test_cases": [{"name": "Test 1"}]}'
        mock_response = MagicMock()
        mock_response.json.return_value = {"response": expected_response_text}
        mock_response.raise_for_status.return_value = None
        mock_post.return_value = mock_response

        # Act
        result = self.agent2.execute(initial_state)

        # Assert
        expected_payload = {
            "user_id": "user-123",
            "agent_id": "api-agent-456",
            "session_id": "session-789",
            "message": unittest.mock.ANY, # We don't need to check the whole message
        }
        expected_headers = {
            "x-api-key": "secret-key",
            "Content-Type": "application/json",
        }
        mock_post.assert_called_once_with(
            "https://api.example.com",
            json=expected_payload,
            headers=expected_headers
        )
        self.assertEqual(result, {"response": expected_response_text, "desc": "A user story for testing."})

    @patch('requests.post')
    def test_execute_api_failure(self, mock_post):
        """Test execution when the API call raises an exception."""
        # Arrange
        initial_state = {"user_story": "A user story for testing."}
        mock_post.side_effect = requests.exceptions.RequestException("Network error")

        # Act
        result = self.agent2.execute(initial_state)

        # Assert
        self.agent2.utils.log_error.assert_called_once()
        self.assertIn("[FAILED] API error: Network error", result["response"])


# CORRECTION: Rename the test class to avoid conflict with the class in agent.py
class TestTestWorkflowManagerLogic(unittest.TestCase):
    @patch('agent.DatabaseCollections')
    @patch('agent.CommonUtils')
    @patch('agent.ConfigLoader')
    def setUp(self, MockConfigLoader, MockCommonUtils, MockDatabaseCollections):
        self.workflow_manager = TestWorkflowManager()
        
        # CORRECTION: Mock the StateGraph class itself, not the instance.
        # This ensures that when TestWorkflowManager creates a new instance,
        # it gets one of our mocks.
        self.mock_state_graph = MagicMock()
        self.mock_compiled = MagicMock()
        self.mock_compiled.invoke.return_value = {"final": "state"}
        self.mock_state_graph.return_value.compile.return_value = self.mock_compiled

    @patch('agent.Agent2')
    @patch('agent.Agent1')
    def test_run_test_workflow(self, MockAgent1, MockAgent2): # Arguments are in the correct order for the decorators
        """Test the workflow execution from start to finish."""
        # Arrange
        event_id = "event-123"
        filename = "story.txt"
        agent_data = {"key": "value"}
        agent_id = "agent-2"

        # Configure the mocks for the agents
        # MockAgent1 is the mock for agent.Agent1
        mock_agent1_instance = MockAgent1.return_value
        # MockAgent2 is the mock for agent.Agent2
        mock_agent2_instance = MockAgent2.return_value

        # Act
        with patch('agent.StateGraph', self.mock_state_graph):
            result = self.workflow_manager.run_test_workflow(event_id, filename, agent_data, agent_id)    

        # Assert
        # 1. Check that agents were instantiated with correct arguments
        # CORRECTION: These assertions now match the actual code in agent.py
        MockAgent1.assert_called_once_with(event_id, agent_id, filename)
        MockAgent2.assert_called_once_with(agent_data, event_id, agent_id)

        # 2. Check that the workflow was configured correctly
        self.mock_state_graph.return_value.add_node.assert_any_call("reader", mock_agent1_instance.execute)
        self.mock_state_graph.return_value.add_node.assert_any_call("generater_agent", mock_agent2_instance.execute)
        self.mock_state_graph.return_value.set_entry_point.assert_called_once_with("reader")
        self.mock_state_graph.return_value.add_edge.assert_called_once_with("reader", "generater_agent")
        self.mock_state_graph.return_value.set_finish_point.assert_called_once_with("generater_agent")
        
        # 3. Check that the workflow was compiled and invoked
        self.mock_state_graph.return_value.compile.assert_called_once()
        self.mock_compiled.invoke.assert_called_once_with({})

        # 4. Check the final result
        self.assertEqual(result, {"final": "state"})


class TestRunTestWorkflowFunction(unittest.TestCase):
    @patch('agent.TestWorkflowManager')
    def test_run_test_workflow_function(self, MockWorkflowManager):
        """Test the standalone run_test_workflow function."""
        # Arrange
        mock_manager_instance = MockWorkflowManager.return_value
        mock_manager_instance.run_test_workflow.return_value = {"result": "ok"}
        
        event_id = "event-123"
        filename = "story.txt"
        agent_data = {"key": "value"}
        agent_id = "agent-2"

        # Act
        result = run_test_workflow(event_id, filename, agent_data, agent_id)

        # Assert
        MockWorkflowManager.assert_called_once()
        mock_manager_instance.run_test_workflow.assert_called_once_with(event_id, filename, agent_data, agent_id)
        self.assertEqual(result, {"result": "ok"})


if __name__ == '__main__':
    unittest.main(argv=['first-arg-is-ignored'], exit=False)