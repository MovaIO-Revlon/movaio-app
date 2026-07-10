# test_agentsManage.py

import pytest
import json
from unittest.mock import patch, MagicMock
from flask import Flask, request
import agentsManage as am
from datetime import datetime, timezone


@pytest.fixture
def app():
    app = Flask(__name__)
    app.config.update(TESTING=True)
    return app


# ---------------- Scheduler Tests ---------------- #

def test_validate_daily_valid():
    data = {"time": "10:30"}
    result = am.validate_daily(data)
    assert result == {"time": "10:30"}


def test_validate_weekly_valid():
    data = {"days": ["Mon", "Wed"], "time": "15:00"}
    result = am.validate_weekly(data)
    assert result == {"days": ["Mon", "Wed"], "time": "15:00"}


def test_validate_monthly_valid():
    data = {"dates": ["09/10/2025"], "time": "09:00"}
    result = am.validate_monthly(data)
    assert "dates" in result
    assert result["time"] == "09:00"


def test_process_scheduler_with_multiple_frequencies():
    schedule_frequencies = ["daily", "weekly"]
    scheduler_time = {
        "daily": {"time": "08:00"},
        "weekly": {"days": ["Fri"], "time": "12:00"}
    }
    result = am.process_scheduler(schedule_frequencies, scheduler_time)
    assert "daily" in result and "weekly" in result


# ---------------- Onboard Agent ---------------- #

@patch.object(am, "agent_collection")
@patch.object(am, "agent_role_master_collection")
@patch.object(am, "llm_master_collection")
@patch.object(am, "mcp_master_collection")
@patch.object(am, "agent_type_master_collection")
def test_onboard_agent_details_success(mock_type, mock_mcp, mock_llm, mock_role, mock_agent_col, app):
    payload = {
        "agent_id": "123",
        "name": "Test Agent",
        "role_id": "r1",
        "model": "m1",
        "mcp_connector_id": "mcp1",
        "agent_type_id": "t1",
        "scheduleFrequency": "daily",
        "schedulerTime": {"daily": {"time": "10:00"}}
    }

    mock_role.find_one.return_value = {"agent_role_name": "Tester"}
    mock_llm.find_one.return_value = {"model_name": "GPT"}
    mock_mcp.find_one.return_value = {"mcp_name": "Connector"}
    mock_type.find_one.return_value = {"agent_type_name": "Type A"}

    with app.test_request_context(json=payload):
        result = am.onboard_agent_details(request)
        assert result is True
        mock_agent_col.insert_one.assert_called_once()


# ---------------- Dropdown Details ---------------- #

@patch.object(am, "mcp_master_collection")
@patch.object(am, "llm_master_collection")
@patch.object(am, "agent_role_master_collection")
@patch.object(am, "agent_type_master_collection")
@patch.object(am, "agent_provider_collection")
def test_get_all_dropdown_details(mock_provider, mock_type, mock_role, mock_llm, mock_mcp):
    mock_mcp.find.return_value = [{"mcp_id": "1", "mcp_name": "Connector"}]
    mock_llm.find.return_value = [{"llm_id": "2", "model_name": "GPT"}]
    mock_role.find.return_value = [{"agent_role_id": "3", "agent_role_name": "Role"}]
    mock_type.find.return_value = [{"agent_type_id": "4", "agent_type_name": "Type"}]
    mock_provider.find.return_value = [{"provider_id": "5", "provider_name": "Provider"}]

    result = am.get_all_dropdown_details()
    assert len(result) == 5
    assert result[0][0]["label"] == "Connector"


# ---------------- External Agent ---------------- #

@patch("agentsManage.requests.get")
@patch.object(am, "agent_collection")
def test_insert_external_agent_success(mock_agent_col, mock_requests, app):
    payload = {
        "agent_id": "123",
        "api_key": "key",
        "agent_name": "External",
        "user_id": "u1"
    }
    mock_requests.return_value.status_code = 200
    mock_requests.return_value.json.return_value = {
        "description": "desc",
        "agent_role": "role",
        "provider_id": "p1"
    }
    mock_agent_col.find_one.return_value = None

    with app.test_request_context(json=payload):
        result, status = am.insert_external_agent(request)
        assert status == 200
        assert result.json["Success"] is True


# ---------------- Agent Details ---------------- #

@patch.object(am, "agent_tracking_collection")
@patch.object(am, "agent_collection")
def test_get_all_agent_details(mock_agent_col, mock_track):
    mock_track.distinct.return_value = {"123"}
    mock_agent_col.find.return_value = [{"agent_id": "123"}]

    result = am.get_all_agent_details()
    assert isinstance(result, list)
    assert "trending" in result[0]


# ---------------- Assign Rating ---------------- #

@patch.object(am, "agent_collection")
def test_assign_rating_existing_valid(mock_agent_col):
    agent = {"rating": "4.0"}
    rating = am.assign_rating(agent, "123")
    assert 3.0 <= rating <= 5.0


@patch.object(am, "agent_collection")
def test_assign_rating_invalid_creates_new(mock_agent_col):
    agent = {"rating": "invalid"}
    mock_agent_col.update_one.return_value.modified_count = 1
    rating = am.assign_rating(agent, "123")
    assert 3.0 <= rating <= 5.0
    mock_agent_col.update_one.assert_called_once()


# ---------------- Update Agent ---------------- #

@patch.object(am, "agent_collection")
@patch.object(am, "agent_role_master_collection")
def test_update_agent_manage_details(mock_role, mock_agent_col, app):
    payload = {"role_id": "r1", "name": "Updated"}
    mock_role.find_one.return_value = {"agent_role_name": "Tester"}

    with app.test_request_context(json=payload):
        result = am.update_agent_manage_details(request, "123")
        assert result is True
        mock_agent_col.update_one.assert_called_once()


# ---------------- Counts ---------------- #

@patch.object(am, "agent_collection")
def test_get_agent_details_counts(mock_agent_col):
    mock_agent_col.count_documents.side_effect = [10, 5, 3]
    total, active, trending = am.get_agent_details_counts()
    assert total == 10
    assert active == 5
    assert trending == 3


# ---------------- Provider ---------------- #

@patch.object(am, "agent_provider_collection")
def test_get_provider_dtls_success(mock_provider, app):
    mock_provider.find_one.return_value = {
        "provider_url": "http://test.com",
        "provider_key": "key123"
    }
    with app.test_request_context(json={"provider_id": "p1"}):
        result = am.get_provider_dtls(request)
        assert result["provider_url"] == "http://test.com"


@patch.object(am, "agent_provider_collection")
def test_get_provider_dtls_missing_provider_id(mock_provider, app):
    with app.test_request_context(json={}):
        result, status = am.get_provider_dtls(request)
        assert result.json["Success"] is False
        assert status == 200


@patch.object(am, "agent_provider_collection")
def test_get_provider_dtls_not_found(mock_provider, app):
    mock_provider.find_one.return_value = None
    with app.test_request_context(json={"provider_id": "invalid"}):
        result, status = am.get_provider_dtls(request)
        assert result.json["Success"] is False
        assert status == 200


# ---------------- Delete Agent ---------------- #

from unittest.mock import patch, MagicMock
import agentsManage as am  # adjust import if needed

@patch.object(am, "agent_collection")
def test_delete_agent_details(mock_agent_col):
    # Step 1: Mock find_one() to return a fake agent
    mock_agent_col.find_one.side_effect = [
        {"agent_id": "123"},  # First call: before update
        {"agent_id": "123", "isDeleted": True}  # Second call: after update
    ]

    # Step 2: Mock update_one() to simulate a successful update
    mock_update_result = MagicMock()
    mock_update_result.modified_count = 1
    mock_agent_col.update_one.return_value = mock_update_result

    # Step 3: Call the function under test
    result = am.delete_agent_details("123")

    # Step 4: Assert that we got back the updated agent document
    assert result == {"agent_id": "123", "isDeleted": True}

    # Step 5: Verify calls
    mock_agent_col.find_one.assert_any_call({"agent_id": "123"})
    mock_agent_col.update_one.assert_called_once_with(
        {"agent_id": "123"},
        {"$set": {"isDeleted": True}}
    )

# ---------------- Scheduler Edge Cases ---------------- #

def test_validate_daily_invalid():
    with pytest.raises(ValueError):
        am.validate_daily({"time": "invalid"})

def test_validate_weekly_invalid_format(app):
    with app.app_context():
        result, status = am.validate_weekly("not-a-dict")
        assert status == 200
        assert result.json["Success"] is False

def test_validate_monthly_with_invalid_dates():
    data = {"dates": ["invalid-date"], "time": "10:00"}
    result = am.validate_monthly(data)
    assert result["dates"] == []

def test_process_scheduler_invalid_raises(app):
    with app.test_request_context():
        result, status = am.process_scheduler("daily", {"daily": {"time": "invalid"}})
        assert status == 200
        assert result.json["Success"] is False


# ---------------- Onboard Agent Edge Cases ---------------- #

def test_onboard_agent_missing_agent_id(app):
    with app.test_request_context(json={"name": "Test"}):
        result = am.onboard_agent_details(request)
        assert result is False

@patch.object(am, "agent_collection", side_effect=Exception("DB error"))
def test_onboard_agent_exception(mock_agent_col, app):
    with app.test_request_context(json={"agent_id": "123"}):
        result, status = am.onboard_agent_details(request)
        assert status == 200   # ✅ code always returns 200 with error JSON
        assert result.json["Success"] is False


# ---------------- Insert External Agent Edge Cases ---------------- #

def test_insert_external_agent_missing_agent_id(app):
    with app.test_request_context(json={"api_key": "k"}):
        result, status = am.insert_external_agent(request)
        assert status == 200
        assert result.json["Success"] is False

@patch("agentsManage.requests.get")
def test_insert_external_agent_api_error(mock_requests, app):
    mock_requests.return_value.status_code = 500
    with app.test_request_context(json={"agent_id": "123", "api_key": "k"}):
        result = am.insert_external_agent(request)   # returns Response, not tuple
        assert result.status_code == 200
        assert result.json["Success"] is False

@patch("agentsManage.requests.get")
def test_insert_external_agent_invalid_json(mock_requests, app):
    mock_requests.return_value.status_code = 200
    mock_requests.return_value.json.side_effect = json.JSONDecodeError("err", "doc", 0)
    mock_requests.return_value.text = "invalid"
    with app.test_request_context(json={"agent_id": "123", "api_key": "k"}):
        result = am.insert_external_agent(request)

        # handle both Response and (Response, status)
        if isinstance(result, tuple):
            resp, status = result
            assert status == 500
            assert resp.json["Success"] is False
        else:
            assert result.status_code == 500
            assert result.json["Success"] is False


@patch("agentsManage.requests.get")
@patch.object(am, "agent_collection")
def test_insert_external_agent_duplicate(mock_agent_col, mock_requests, app):
    mock_requests.return_value.status_code = 200
    mock_requests.return_value.json.return_value = {"description": "d"}
    mock_agent_col.find_one.return_value = {"agent_id": "123"}
    with app.test_request_context(json={"agent_id": "123", "api_key": "k"}):
        result, status = am.insert_external_agent(request)
        assert status == 200
        assert result.json["Success"] is False


# ---------------- Assign Rating Edge Case ---------------- #

@patch.object(am, "agent_collection")
def test_assign_rating_update_failed(mock_agent_col):
    mock_agent_col.update_one.return_value.modified_count = 0
    agent = {"rating": ""}
    rating = am.assign_rating(agent, "123")
    assert 3.0 <= rating <= 5.0


# ---------------- Update Agent Edge Cases ---------------- #

@patch.object(am, "agent_collection")
def test_update_agent_manage_details_empty_payload(mock_agent_col, app):
    with app.test_request_context(json={}):
        result = am.update_agent_manage_details(request, "123")
        assert result is False

@patch.object(am, "agent_collection")
def test_update_agent_manage_details_invalid_scheduler(mock_agent_col, app):
    payload = {"scheduleFrequency": "daily", "schedulerTime": {"daily": {"time": "invalid"}}}
    with app.test_request_context(json=payload):
        result = am.update_agent_manage_details(request, "123")
        assert result is True  # goes through but scheduler result is tuple


# ---------------- Delete Agent Edge Case ---------------- #

@patch.object(am, "agent_collection")
def test_delete_agent_details_not_found(mock_agent_col, app):
    mock_agent_col.find_one.return_value = None
    with app.app_context():
        result, status = am.delete_agent_details("doesnotexist")
        assert status == 200
        assert result.json["Success"] is False

# ---------------- Counts Exception ---------------- #

@patch.object(am, "agent_collection")
def test_get_agent_details_counts_exception(mock_agent_col, app):
    mock_agent_col.count_documents.side_effect = Exception("DB error")
    with app.app_context():
        result = am.get_agent_details_counts()
        assert result.json["Success"] is False