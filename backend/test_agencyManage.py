import pytest
from unittest.mock import patch, MagicMock
import agencyManage as am
from flask import Flask


# ---------------- Fixtures ---------------- #
@pytest.fixture
def app():
    app = Flask(__name__)
    return app


# ---------------- get_agency_with_agents_details ---------------- #
@patch.object(am, "agency_collection")
@patch.object(am, "agent_agency_mapping_collection")
@patch.object(am, "event_agency_tracking_collection")
@patch.object(am, "agent_collection")
def test_get_agency_with_agents_details_success(mock_agent, mock_event, mock_mapping, mock_agency, app):
    mock_agency.find.return_value = [{"agency_id": "A1", "agency_name": "TestAgency"}]
    mock_mapping.find.return_value = [{"agency_id": "A1", "agent_id": "AG1", "status": "active", "order_number": 1}]
    mock_agent.find_one.return_value = {"agent_id": "AG1", "name": "Agent1", "agent_type_name": "Task Agent"}
    mock_event.find_one.return_value = {"created_ts": "Tue, 02 Sep 2025 12:00:00 GMT"}
    mock_event.find.return_value = [{"agency_id": "A1", "eventTracking_UniqueId": "E1"}]

    with app.app_context():
        result = am.get_agency_with_agents_details()
        assert isinstance(result, list)
        assert result[0]["agency_id"] == "A1"
        assert result[0]["agents"][0]["agent_id"] == "AG1"


@patch.object(am, "agency_collection")
def test_get_agency_with_agents_details_no_agencies(mock_agency, app):
    mock_agency.find.return_value = []
    with app.app_context():
        resp, status = am.get_agency_with_agents_details()
        assert status == 200
        assert resp.json["Success"] is False


# ---------------- get_agency_types_details ---------------- #
@patch.object(am, "agency_type_collection")
def test_get_agency_types_details_success(mock_collection):
    mock_collection.find.return_value = [{"agency_type_id": "T1", "name": "Type1"}]
    result = am.get_agency_types_details()
    assert result[0]["agency_type_id"] == "T1"


# ---------------- onboard_and_update_agency_with_agents_details ---------------- #
@patch.object(am, "agent_agency_mapping_collection")
@patch.object(am, "agent_collection")
@patch.object(am, "agency_collection")
def test_onboard_and_update_agency_with_agents_details_success(mock_agency, mock_agent, mock_mapping, app):
    mock_agency.find_one.return_value = None
    mock_agent.find_one.return_value = {"agent_id": "AG1", "agent_type_name": "Task Agent"}
    mock_agency.insert_one.return_value = None

    payload = {
        "agency_name": "AgencyX",
        "agents": [{"agent_id": "AG1", "agent_name": "Agent1", "order_number": 1}]
    }
    req = app.test_request_context(json=payload).request

    with app.app_context():
        is_update, agency_id, type_counts = am.onboard_and_update_agency_with_agents_details(req)
        assert is_update is False
        assert "Task Agent" in type_counts


# ---------------- get_trending_agency_stats_dtls ---------------- #
@patch.object(am, "agency_collection")
@patch.object(am, "event_agency_tracking_collection")
def test_get_trending_agency_stats_dtls_success(mock_event, mock_agency):
    mock_agency.count_documents.side_effect = [5, 2]
    mock_agency.find.return_value = [{"agency_id": "A1", "agency_name": "TestAgency"}]
    mock_event.find.return_value = [{"agency_id": "A1", "usagecount": "3"}]

    total, trending_count, agencies = am.get_trending_agency_stats_dtls()
    assert total == 5
    assert trending_count == 2
    assert agencies[0]["usage_count"] == 3


# ---------------- delete_agency_details ---------------- #
@patch.object(am, "agency_collection")
@patch.object(am, "agent_agency_mapping_collection")
def test_delete_agency_details_success(mock_mapping, mock_agency):
    mock_agency.find_one.return_value = {"agency_id": "A1"}
    mock_agency.update_one.return_value = None
    mock_mapping.update_many.return_value = None

    agency_id = am.delete_agency_details("A1")
    assert agency_id == "A1"


@patch.object(am, "agency_collection")
def test_delete_agency_details_not_found(mock_agency, app):
    mock_agency.find_one.return_value = None
    with app.app_context():
        resp, status = am.delete_agency_details("X1")
        assert status == 200
        assert resp.json["Message"] == "Agency not found"


# ---------------- get_task_agents_with_agencies_details ---------------- #
@patch.object(am, "agent_collection")
@patch.object(am, "agent_tracking_collection")
@patch.object(am, "agent_agency_mapping_collection")
@patch.object(am, "agency_collection")
def test_get_task_agents_with_agencies_details_success(mock_agency, mock_mapping, mock_tracking, mock_agent):
    mock_agent.find.return_value = [{"agent_id": "AG1", "name": "Agent1", "agent_type_name": "Task Agent"}]
    mock_tracking.find_one.return_value = {"created_ts": "2025-09-02T12:00:00"}
    mock_mapping.find.return_value = [{"agency_id": "A1"}]
    mock_agency.find_one.return_value = {"agency_id": "A1", "agency_name": "Agency1"}

    result = am.get_task_agents_with_agencies_details()
    assert isinstance(result, list)
    assert result[0]["agent_id"] == "AG1"


# ---------------- get_agent_and_order2_agents_details ---------------- #
@patch.object(am, "agent_collection")
@patch.object(am, "agent_agency_mapping_collection")
def test_get_agent_and_order2_agents_details_success(mock_mapping, mock_agent, app):
    mock_agent.find_one.side_effect = [
        {"agent_id": "AG1", "name": "MainAgent"},  # main agent
        {"agent_id": "AG2", "name": "Order2Agent"},  # order 2 agent
    ]
    mock_mapping.find_one.return_value = {"agency_id": "A1"}
    mock_mapping.find.return_value = [{"agent_id": "AG2", "order_number": 2, "status": "active"}]

    req = app.test_request_context(json={"agent_id": "AG1"}).request
    main_agent, order_agents = am.get_agent_and_order2_agents_details(req)
    assert main_agent["agent_id"] == "AG1"
    assert order_agents[0]["agent_id"] == "AG2"


# ---------------- update_agency_mappings ---------------- #
@patch.object(am, "agent_collection")
@patch.object(am, "agent_agency_mapping_collection")
def test_update_agency_mappings_success(mock_mapping, mock_agent, app):
    mock_mapping.find.return_value = [{"_id": "m1", "agency_id": "A1", "agent_id": "AG1"}]
    mock_agent.find.return_value = [{"_id": "a1", "agent_id": "AG1"}]

    req = app.test_request_context(json={"agency_id": "A1"}).request
    mappings, agents = am.update_agency_mappings(req)
    assert mappings[0]["agency_id"] == "A1"
    assert agents[0]["agent_id"] == "AG1"
