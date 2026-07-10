import pytest
from unittest.mock import patch, MagicMock
from flask import Flask, request
from datetime import datetime, timezone
import testcaseManage as tcm





@pytest.fixture
def app():

    return Flask(__name__)


@pytest.fixture
def client(app):
    return app.test_client()


# ----------------------
# clean_text
# ----------------------
def test_clean_text_valid_json():
    response_text = """```json
    {"test_case_title": "Login Test"}
    ```"""
    result = tcm.clean_text(response_text)
    assert isinstance(result, dict)
    assert result["test_case_title"] == "Login Test"


def test_clean_text_invalid_json():
    result = tcm.clean_text("not a json")
    assert isinstance(result, str)
    assert result == "not a json"


# ----------------------
# generate_event_id
# ----------------------
@patch("testcaseManage.event_agency_tracking_collection")
def test_generate_event_id(mock_event_agency_tracking_collection):
    mock_event_agency_tracking_collection.count_documents.return_value = 40
    event_id = tcm.generate_event_id(mock_event_agency_tracking_collection)
    assert event_id.startswith("UC-")
    assert event_id[3:].isdigit()
    assert len(event_id) == 6 # e.g. UC-041



# ----------------------
# get_agency_result
# ----------------------
@patch("testcaseManage.event_agency_tracking_collection")
def test_get_agency_result_success(mock_event_agency_tracking_collection):
    mock_event_agency_tracking_collection.find.return_value = [{"_id": "xyz", "name": "event"}]
    res = tcm.get_agency_result()
    assert isinstance(res, list)


@patch("testcaseManage.event_agency_tracking_collection")
def test_get_agency_result_failure(mock_event_agency_tracking_collection, caplog):
    mock_event_agency_tracking_collection.find.side_effect = Exception("DB error")
    res = tcm.get_agency_result()
    assert res == []
    assert "Error in get_agency_result" in caplog.text


# ----------------------
# run_workflow_endpoint_details
# ----------------------
@patch("testcaseManage.run_test_workflow")
@patch("testcaseManage.event_agency_tracking_collection")
@patch("testcaseManage.agent_collection")
@patch("testcaseManage.agent_agency_mapping_collection")
@patch("testcaseManage.event_steps_tracking_collection")
def test_run_workflow_endpoint_details(
mock_event_steps_tracking_collection,
mock_agent_agency_mapping_collection,
mock_agent_collection,
mock_event_agency_tracking_collection,
mock_run_test_workflow,
tmp_path,
app,
):
    # prepare folder and file
    folder = tmp_path
    (folder / "case1.txt").write_text("user story")

    mock_agent_agency_mapping_collection.find.return_value.sort.return_value = [
    {"agent_id": "A1", "status": "active"}
    ]
    mock_agent_collection.find.return_value = [{"agent_id": "A1"}]
    mock_run_test_workflow.return_value = {
    "response": '{"test_case_title": "Case 1"}',
    "desc": "desc",
    "accuracy": 0.95,
    }
    mock_event_agency_tracking_collection.find.return_value = []

    with app.test_request_context(
    json={"UserMail": "u1", "EventTrackingUniqueId": "ET1", "AgencyId": "AG1"}
    ):
        result = tcm.run_workflow_endpoint_details(str(folder), request)
        assert isinstance(result, list)



# ----------------------
# get_event_workflow_details
# ----------------------
@patch("testcaseManage.event_agency_tracking_collection")
@patch("testcaseManage.event_steps_tracking_collection")
def test_get_event_workflow_details_success(
mock_event_steps_tracking_collection,
mock_event_agency_tracking_collection,
app,
):
    mock_event_agency_tracking_collection.find_one.return_value = {
    "event_id": "UC-1"
    }
    mock_event_agency_tracking_collection.find.return_value.sort.return_value = [
    {"_id": "1"}
    ]
    mock_event_steps_tracking_collection.find_one.return_value = {"_id": "2"}

    with app.test_request_context(json={"agent_id": "A1"}):
        docs, status = tcm.get_event_workflow_details(request)
        assert isinstance(docs, list)


@patch("testcaseManage.event_agency_tracking_collection")
def test_get_event_workflow_details_no_agent(mock_event_agency_tracking_collection, app):
    with app.test_request_context(json={}): # no agent_id
        response, status = tcm.get_event_workflow_details(request)
        assert status == 200
        assert response.json["Message"] == "agent_id is required"


# ----------------------
# get_user_events_details
# ----------------------
@patch("testcaseManage.event_agency_tracking_collection")
def test_get_user_events_details_missing_email(mock_event_agency_tracking_collection, app):
    with app.test_request_context(json={"agencyId": "AG1"}):
        result = tcm.get_user_events_details(request)
        assert result[1] == 200
        assert result[0].json["Message"] == "Email ID is required"


@patch("testcaseManage.event_agency_tracking_collection")
def test_get_user_events_details_success(mock_event_agency_tracking_collection, app):
# Mock document
    mock_doc = {
    "_id": "123",
    "event_id": "UC-001",
    "created_ts": datetime.now(timezone.utc),
    "current_ts": datetime.now(timezone.utc)
    }

    # Create a mock cursor that behaves like a PyMongo cursor
    mock_cursor = MagicMock()
    mock_cursor.sort.return_value = mock_cursor # allows chaining .sort()
    mock_cursor.limit.return_value = [mock_doc] # for last_doc scenario
    mock_cursor.__iter__.return_value = [mock_doc] # for normal iteration
    mock_cursor.count_documents.return_value = 1 # optional if code uses count

    # Patch find() to always return our mock cursor
    mock_event_agency_tracking_collection.find.return_value = mock_cursor

    # Simulate request context
    with app.test_request_context(json={"UserMail": "test@example.com", "agencyId": "agency001"}):
        response = tcm.get_user_events_details(request)

    # Handle both possible return types
    if isinstance(response, tuple):
        data, status = response
        assert status == 200
        json_data = data.get_json()
        assert isinstance(json_data, list)
        assert json_data[0]["event_id"] == "UC-001"
    elif isinstance(response, list):
        assert len(response) > 0
        assert response[0]["event_id"] == "UC-001"
# ----------------------
# get_insight_agent_details
# ----------------------
@patch("testcaseManage.agent_collection")
@patch("testcaseManage.event_agency_tracking_collection")
def test_get_insight_agent_details_success(
mock_event_agency_tracking_collection, mock_agent_collection
):
    mock_agent_collection.distinct.return_value = ["A1"]
    mock_event_agency_tracking_collection.find_one.return_value = {
    "_id": "123",
    "event_id": "E1",
    "created_ts": datetime.now(timezone.utc),
    "current_ts": datetime.now(timezone.utc),
    }
    mock_agent_collection.find_one.return_value = {"name": "Insight Agent"}
    res = tcm.get_insight_agent_details()
    assert isinstance(res, list)


# ----------------------
# fetch_recent_data
# ----------------------
@patch("testcaseManage.chatbot_tracking_collection")
@patch("testcaseManage.agent_collection")
def test_fetch_recent_data(mock_agent_collection, mock_chatbot_tracking_collection):
    mock_chatbot_tracking_collection.find.return_value.sort.return_value.limit.return_value = [
    {"_id": "1", "agent_id": "A1"}
    ]
    mock_agent_collection.find_one.return_value = {"name": "Agent1"}
    res = tcm.fetch_recent_data("master1")
    assert isinstance(res, list)
    assert res[0]["name"] == "Agent1"


def test_fetch_recent_data_no_master():
    with pytest.raises(ValueError):
        tcm.fetch_recent_data("")


# ----------------------
# normalize_query
# ----------------------
def test_normalize_query_removes_stopwords_and_punct():
    text = "This is, an Example Queries!"
    res = tcm.normalize_query(text)
    assert "example" in res
    assert "querie" in res or "query" in res


def test_normalize_query_empty():
    assert tcm.normalize_query("") == ""


# ----------------------
# cluster_data & cluster_result
# ----------------------
@patch("testcaseManage.agent_collection")
@patch("testcaseManage.chatbot_tracking_collection")
def test_cluster_data_and_result(mock_chatbot_tracking_collection, mock_agent_collection):
    labels = [0, 0, 1]
    original_map = ["q1", "q2", "q3"]
    raw_queries = [
    {"updated_ts": datetime.now()},
    {"updated_ts": datetime.now()},
    {"updated_ts": datetime.now()},
    ]

    clusters = tcm.cluster_data(labels, original_map, raw_queries)
    assert 0 in clusters and 1 in clusters

    # for cluster_result
    mock_chatbot_tracking_collection.find_one.return_value = {
    "master_agent_id": "M1",
    "agent_id": "A1",
    }
    mock_agent_collection.find_one.return_value = {"name": "AgentName"}
    result = tcm.cluster_result(clusters)
    assert isinstance(result, list)
    assert "query" in result[0]


# ----------------------
# fetch_popular_queries
# ----------------------
@patch("testcaseManage.chatbot_tracking_collection")
@patch("testcaseManage.agent_collection")
def test_fetch_popular_queries_small(mock_agent_collection, mock_chatbot_tracking_collection):
    mock_chatbot_tracking_collection.aggregate.return_value = [
    {"user_query": "hi", "updated_ts": datetime.now()},
    {"user_query": "hello", "updated_ts": datetime.now()},
    ]
    mock_chatbot_tracking_collection.find_one.return_value = {
    "master_agent_id": "M1",
    "agent_id": "A1",
    }
    mock_agent_collection.find_one.return_value = {"name": "AgentName"}
    res = tcm.fetch_popular_queries()
    assert isinstance(res, list)


@patch("testcaseManage.chatbot_tracking_collection")
def test_fetch_popular_queries_none(mock_chatbot_tracking_collection):
    mock_chatbot_tracking_collection.aggregate.return_value = []
    res = tcm.fetch_popular_queries()
    assert res == []


# ----------------------
# update_feedback_dtls
# ----------------------
@patch("testcaseManage.agent_collection")
def test_update_feedback_dtls_success(mock_agent_collection, app):
    with app.test_request_context(
    json={"agent_id": "A1", "rating": "5", "feedback": "good", "user_id": "U1"}
    ):
        res = tcm.update_feedback_dtls(request.get_json())
        assert res is True


@patch("testcaseManage.agent_collection")
def test_update_feedback_dtls_failure(mock_agent_collection, app):
    mock_agent_collection.update_one.side_effect = Exception("DB error")
    with app.test_request_context(
    json={"agent_id": "A1", "rating": "5", "feedback": "good", "user_id": "U1"}
    ):
        res = tcm.update_feedback_dtls(request.get_json())
        assert res is False
