import os
import uuid
import pytest
import builtins
import pandas as pd
from unittest.mock import patch, MagicMock, mock_open

import agent


@pytest.fixture(autouse=True)
def patch_mongo():
    """Patch Mongo collections globally for tests."""
    with patch.object(agent, "agent_tracking_collection") as mock_agent_col, \
         patch.object(agent, "event_steps_tracking_collection") as mock_steps_col:
        yield mock_agent_col, mock_steps_col


def test_read_user_story_from_file(tmp_path):
    # Arrange
    test_file = tmp_path / "story.txt"
    test_file.write_text("As a user, I want to test this.")
    agent.USER_STORY_FOLDER = str(tmp_path)

    # Act
    result = agent.read_user_story_from_file("story.txt")

    # Assert
    assert "As a user" in result


def test_read_user_story_from_file_not_found():
    agent.USER_STORY_FOLDER = "/non/existent/folder"
    with pytest.raises(FileNotFoundError):
        agent.read_user_story_from_file("missing.txt")


def test_create_agent1_inserts_and_updates(patch_mongo, tmp_path):
    mock_agent_col, mock_steps_col = patch_mongo
    filename = "story.txt"
    filepath = tmp_path / filename
    filepath.write_text("User story content")
    agent.USER_STORY_FOLDER = str(tmp_path)

    agent_config = {"agent_id": "agent1"}
    func = agent.create_agent1(agent_config, "event123", "agency123", filename, "track123")

    result = func({})

    # Verify DB calls
    mock_agent_col.insert_one.assert_called_once()
    mock_steps_col.update_one.assert_called_once()

    # Verify return contains user_story
    assert "User story content" in result["user_story"]


@patch("agent.requests.post")
@patch("agent.get_lyzr_internal_agent_details")
def test_create_agent2_api_and_excel(mock_get_details, mock_post, patch_mongo, tmp_path):
    mock_agent_col, mock_steps_col = patch_mongo

    # Fake API details
    mock_get_details.return_value = ("http://fake-url", "apikey", "user1", "agentX", "sess123")

    # Fake API response
    mock_post.return_value.json.return_value = {"response": '{"test_case_title": "Title"}'}
    mock_post.return_value.raise_for_status = lambda: None

    # Patch Excel saving to tmp dir
    excel_file = tmp_path / "standard_responses.xlsx"
    with patch("agent.pd.DataFrame.to_excel") as mock_to_excel, \
         patch("agent.os.path.exists", return_value=False):

        agent_config = {"agent_id": "agent2"}
        func = agent.create_agent2(agent_config, "event456", "agency456", "track456")

        result = func({"user_story": "As a tester, I want something.\nSo that I learn."})

        # Verify API called
        mock_post.assert_called_once()
        assert "response" in result
        assert "accuracy" in result

        # Verify DB inserts
        mock_agent_col.insert_one.assert_called_once()
        mock_steps_col.update_one.assert_called_once()

        # Verify Excel was attempted
        mock_to_excel.assert_called_once()


def test_run_test_workflow_executes(patch_mongo, tmp_path):
    # Create a dummy user story file
    story_file = tmp_path / "story.txt"
    story_file.write_text("As a QA, I want to test workflows.")
    agent.USER_STORY_FOLDER = str(tmp_path)

    # Fake agents
    agents = {
        "agent1": {"agent_id": "agent1"},
        "agent2": {"agent_id": "agent2"}
    }
    agent_mappings = [{"agent_id": "agent1"}, {"agent_id": "agent2"}]

    # Patch agent2 to avoid real API/Excel
    with patch("agent.create_agent2") as mock_agent2:
        mock_agent2.return_value = lambda state: {"response": "ok", "desc": "QA story", "accuracy": 95}

        result = agent.run_test_workflow("event789", "story.txt", agent_mappings, agents, "agency789", "track789")

    assert "response" in result
    assert result["accuracy"] == 95
