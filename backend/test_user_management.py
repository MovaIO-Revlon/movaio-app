# test_user_management.py
import io
import os
from unittest.mock import MagicMock, patch, mock_open
from bson import ObjectId
import pytest
from flask import Flask
from requests import RequestException
from werkzeug.datastructures import FileStorage, FileMultiDict

from UserManagement import UserManager
from config_loader import config_loader
from utils import ApiError


# -----------------------
# Pytest fixtures
# -----------------------
@pytest.fixture
def app():
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app

@pytest.fixture
def um()-> UserManager:
    return UserManager()

@pytest.fixture(autouse=True)
def patch_constants(monkeypatch, tmp_path, um: UserManager):
    # Ensure constants exist and are harmless during tests
    monkeypatch.setattr(um, "SECRET_KEY", "TEST_SECRET", raising=False)
    monkeypatch.setattr(um, "OTP_RECAPTCHA", True, raising=False)
    monkeypatch.setattr(um, "RECAPTCHA_SITE_KEY", "site-key", raising=False)
    monkeypatch.setattr(um, "RECAPTCHA_API_KEY", "api-key", raising=False)
    monkeypatch.setattr(um, "OTP_URL", "https://otp.service/send", raising=False)
    monkeypatch.setattr(um, "CLIENT_NAME", "TEST_CLIENT", raising=False)
    monkeypatch.setattr(um, "VALIDATE_OTP_URL", "https://otp.service/validate", raising=False)
    monkeypatch.setattr(um, "EMAIL_FROM", "noreply@example.com", raising=False)
    monkeypatch.setattr(um, "EMAIL_FROM_NAME", "No Reply", raising=False)
    monkeypatch.setattr(um, "EMAIL_SUBJECT", "Welcome", raising=False)
    monkeypatch.setattr(um, "SMTP_USER", "smtp-user", raising=False)
    monkeypatch.setattr(um, "SMTP_PASS", "smtp-pass", raising=False)
    monkeypatch.setattr(um, "SMTP_HOST", "smtp.example.com", raising=False)
    monkeypatch.setattr(um, "SMTP_PORT", 587, raising=False)
    monkeypatch.setattr(um, "UserImage_folder", str(tmp_path), raising=False)


@pytest.fixture(autouse=True)
def mock_collections(um: UserManager):
    # Replace Mongo collections with MagicMocks on the module
    um.user_collection = MagicMock()
    um.user_collection = MagicMock()
    um.role_collection = MagicMock()
    um.agent_tracking_collection = MagicMock()
    um.event_agency_tracking_collection = MagicMock()
    um.team_collection = MagicMock()
    um.agent_collection = MagicMock()
    um.agent_agency_mapping_collection = MagicMock()
    um.agent_provider_collection = MagicMock()
    um.agent_role_master_collection = MagicMock()
    um.llm_master_collection = MagicMock()
    um.mcp_master_collection = MagicMock()
    um.agent_type_master_collection = MagicMock()
    um.agency_collection = MagicMock()
    um.agency_type_collection = MagicMock()
    um.event_steps_tracking_collection = MagicMock()
    return {
        "user": um.user_collection,
        "role": um.role_collection,
        "team": um.team_collection,
    }

# -----------------------
# Utility/simple functions
# -----------------------
def test_generate_hash_and_pwd_are_equal(um: UserManager):
    salt = um.create_salt(8)
    h1 = um.generate_hash("password", "TEST_SECRET", salt)
    assert isinstance(h1, str)
    # same input -> equal
    assert um.pwd_are_equal("password", h1, "TEST_SECRET", salt) is True
    # different input -> not equal
    assert um.pwd_are_equal("wrong", h1, "TEST_SECRET", salt) is False


def test_convert_string(um: UserManager):
    assert um.convert_string(r"\"token\"") == '"token"'  # the function removes backslashes first
    assert um.convert_string('"abc"') == "abc"
    assert um.convert_string(r"a\b\c") == "abc"
    assert um.convert_string("") == ""


def test_generate_password(um: UserManager):
    p = um.generate_password(16)
    assert len(p) == 16
    # it should include characters from various classes
    assert any(c.islower() for c in p)
    assert any(c.isupper() for c in p)
    assert any(c.isdigit() for c in p)
    assert any(c in "!@#$%^&*_-=+" for c in p)


def test_create_salt_and_clean_document(um: UserManager):
    s = um.create_salt(8)
    assert isinstance(s, str)
    doc = {"_id": ObjectId()}
    cleaned = um.clean_document(doc)
    assert isinstance(cleaned["_id"], str)



# -----------------------
# Email helpers
# -----------------------
class DummySMTP:
    def __init__(self, host, port):
        self.host = host
        self.port = port
        self.sent = False

    def starttls(self):
        return True

    def login(self, u, p):
        return True

    def send_message(self, msg):
        self.sent = True

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def _mock_template_html():
    return "<html>Hi USERNAME, your PWD is PWD and id USERID</html>"


@patch("smtplib.SMTP", new=DummySMTP)
def test_send_mail_success(monkeypatch):
    # Make sure open reads a template
    monkeypatch.setattr(
        "builtins.open", mock_open(read_data=_mock_template_html())
    )
    ok = um.send_mail("u@example.com", "Test User", "Secret123!", "Welcome")
    assert ok is True


@patch("smtplib.SMTP", new=DummySMTP)
def test_send_mail_service_success(monkeypatch):
    monkeypatch.setattr(
        "builtins.open", mock_open(read_data=_mock_template_html())
    )
    resp = um.send_mail_service("u@example.com", "Test User", "Secret123!", "Welcome")
    assert resp["Success"] is True


# -----------------------
# verify_token (Flask/jsonify + requests)
# -----------------------
class DummyResp:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def raise_for_status(self):
        if self.status_code >= 500:
            raise Exception("HTTP error")

    def json(self):
        return self._payload


def test_verify_token_missing_token_raises_api_error(app, um: UserManager):
    with app.app_context(), pytest.raises(ApiError) as error:
        um.verify_token("")  # missing token
        
    assert isinstance(error.value, ApiError)
    
    assert error.value.status == 400


def test_verify_token_success(app, monkeypatch):
    def fake_post(url, data=None, **kwargs):
        assert "secret" in data and "response" in data
        return DummyResp(
            200, {"success": True, "score": 0.9}
        )
    import UserManagement
    monkeypatch.setattr(UserManagement.requests, "post", fake_post)
    test_um = UserManagement.UserManager()

    with app.app_context():
        resp = test_um.verify_token("valid-token")
        # success branch returns jsonify only (no explicit status) -> a Response
        assert resp.json["Success"] is True


def test_verify_token_fail_score_low(app, monkeypatch):
    def fake_post(url, data=None, **kwargs):
        return DummyResp(200, {"success": True, "score": 0.1})
    
    import UserManagement
    monkeypatch.setattr(UserManagement.requests, "post", fake_post)
    test_um = UserManagement.UserManager()

    with pytest.raises(ApiError) as error:
        test_um.verify_token("low-score-token")

    assert error.value.status == 400


def test_verify_token_exception_returns_500(app, monkeypatch):
    error_msg = "boom"
    import UserManagement
    def boom(*a, **k):
        raise UserManagement.requests.RequestException(error_msg)
    
    monkeypatch.setattr(UserManagement.requests, "post", boom)
    test_um = UserManagement.UserManager()

    with pytest.raises(Exception) as error:
        test_um.verify_token("x")

    assert isinstance(error.value, RequestException)
    assert error.value.args[0] == error_msg


# -----------------------
# perform_login (DB + verify_token + pwd)
# -----------------------
def test_perform_login_success(app, mock_collections, monkeypatch, um: UserManager):
    user_doc = {
        "_id": object(),
        "Email": "user@example.com",
        "FirstName": "First",
        "LastName": "Last",
        "Password": "HASHED",
        "Salt": "SALT",
        "RoleId": 2,
        "TeamId": 3,
        "IsActive": True,
        "IsDelete": False,
        "Avatar": "a.png",
    }
    um._query_db = MagicMock()
    def mock_query_db(collection_name, operation,user_type=None):
        if collection_name == 'user':
            if operation.get('type') == 'find_one':
                return user_doc.copy()
            return [user_doc.copy()]
        
        if collection_name == 'role':
            return [{"RoleId": 2, "RoleName": "Admin"}]
        
        if collection_name == 'team':
            return [{"TeamId": 3, "TeamName": "TeamX"}]

    um._query_db.side_effect = mock_query_db
    # Avoid external calls: stub verify_token & pwd check
    monkeypatch.setattr(um, "verify_token", lambda token: None)
    monkeypatch.setattr(um, "pwd_are_equal", lambda p, h, sk, s: True)

    with app.app_context():
        res = um.perform_login(
            {"EmailId": "user@example.com", "Password": "pass", "RecaptchaResponse": "tok"}
        )
        assert res["Role"] == "Admin"
        assert res["Team"] == "TeamX"
        assert res["Avatar"] == "a.png"


def test_perform_login_user_not_found(app, mock_collections, monkeypatch, um: UserManager):
    um._query_db = MagicMock()
    um._query_db.return_value = None
    monkeypatch.setattr(um, "verify_token", lambda t: None)
    with pytest.raises(ApiError) as error:
        um.perform_login({"EmailId": "nobody@example.com", "Password": "x", "RecaptchaResponse": ""})
    assert isinstance(error.value, ApiError)
    assert error.value.status == 404


def test_perform_login_bad_password(app, mock_collections, monkeypatch, um: UserManager):
    user_doc = {
        "_id": object(),
        "Email": "user@example.com",
        "FirstName": "F",
        "LastName": "L",
        "Password": "HASHED",
        "Salt": "SALT",
        "RoleId": 1,
        "TeamId": 1,
        "IsActive": True,
        "IsDelete": False,
    }
    um._query_db = MagicMock()
    def mock_query_db(collection_name, operation,user_type=None):
        if collection_name == 'user':
            if operation.get('type') == 'find_one':
                return user_doc.copy()
            return [user_doc.copy()]
        
        if collection_name == 'role':
            return []
        
        if collection_name == 'team':
            return []

    um._query_db.side_effect = mock_query_db
    monkeypatch.setattr(um, "verify_token", lambda t: None)
    monkeypatch.setattr(um, "pwd_are_equal", lambda p, h, sk, s: False)

    with pytest.raises(ApiError) as error:
        um.perform_login({"EmailId": "user@example.com", "Password": "bad", "RecaptchaResponse": ""})

    assert isinstance(error.value, ApiError)
    assert error.value.status == 401


# -----------------------
# fetch_recaptcha_config
# -----------------------
def test_fetch_recaptcha_config(um: UserManager):
    cfg = um.fetch_recaptcha_config()
    assert cfg["OTPRecaptcha"] is config_loader.OTP_RECAPTCHA
    assert cfg["SiteKey"] == config_loader.RECAPTCHA_SITE_KEY


# -----------------------
# OTP async services (httpx)
# -----------------------
class DummyAsyncResp:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


class DummyAsyncClient:
    def __init__(self, resp: DummyAsyncResp):
        self._resp = resp

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, *a, **k):
        return self._resp


@pytest.mark.asyncio
async def test_send_otp_details_success(monkeypatch):
    monkeypatch.setattr(um.httpx, "AsyncClient", lambda: DummyAsyncClient(DummyAsyncResp(200)))
    res = await um.send_otp_details({"EmailId": "u@example.com"})
    assert res["Success"] is True


@pytest.mark.asyncio
async def test_send_otp_details_fail(monkeypatch):
    monkeypatch.setattr(um.httpx, "AsyncClient", lambda: DummyAsyncClient(DummyAsyncResp(500)))
    res = await um.send_otp_details({"EmailId": "u@example.com"})
    assert res["Success"] is False


@pytest.mark.asyncio
async def test_validate_otp_service_success(monkeypatch):
    payload = {"Success": True, "Message": "OK"}
    monkeypatch.setattr(
        um.httpx, "AsyncClient", lambda: DummyAsyncClient(DummyAsyncResp(200, payload))
    )
    res = await um.validate_otp_service({"EmailId": "u@example.com", "Otp": "123456"})
    assert res == payload


@pytest.mark.asyncio
async def test_validate_otp_service_fail(monkeypatch):
    monkeypatch.setattr(um.httpx, "AsyncClient", lambda: DummyAsyncClient(DummyAsyncResp(500)))
    res = await um.validate_otp_service({"EmailId": "u@example.com", "Otp": "000"})
    assert res["Success"] is False


# -----------------------
# get_user_details_service
# -----------------------
def test_get_user_details_service_success(mock_collections):
    user_doc = {
        "_id": ObjectId(),
        "Email": "u@example.com",
        "RoleId": 2,
        "TeamId": 5,
        "IsDelete": False
    }
    
    mock_collections["user"].find.return_value = [user_doc]
    mock_collections["role"].find.return_value = [
        {"RoleId": 2, "RoleName": "Manager", "IsActive": True}
    ]
    mock_collections["team"].find.return_value = [
        {"TeamId": 5, "TeamName": "QA", "IsActive": True}
    ]

    res = um.get_user_details_service()
    assert res["Success"] is True
    assert "UserManagement" in res
    assert "RoleManagement" in res
    assert "TeamManagement" in res
    assert res["UserManagement"][0]["RoleName"] == "Manager"
    assert res["UserManagement"][0]["TeamName"] == "QA"

def test_get_user_details_service_none(mock_collections):
    um.user_collection.find.return_value = []
    res = um.get_user_details_service()
    assert res["Success"] is False


# -----------------------
# perform_sent_mail_user_management
# -----------------------
@patch("smtplib.SMTP", new=DummySMTP)
def test_perform_sent_mail_user_management_success(monkeypatch, mock_collections):
    user = {
        "_id": object(),
        "Email": "u@example.com",
        "FirstName": "A",
        "LastName": "B",
        "Salt": "SALT"
    }
    um.user_collection.find_one.return_value = user

    # ensure template open ok
    monkeypatch.setattr("builtins.open", mock_open(read_data=_mock_template_html()))

    # Force send_mail path in this function to succeed
    # We'll patch um.send_mail to avoid SMTP as an extra safety
    monkeypatch.setattr(um, "send_mail", lambda *a, **k: True)

    res = um.perform_sent_mail_user_management("u@example.com")
    assert res["Success"] is True
    um.user_collection.update_one.assert_called()


def test_perform_sent_mail_user_management_unauthorized(mock_collections):
    um.user_collection.find_one.return_value = None
    res = um.perform_sent_mail_user_management("nobody@example.com")
    assert res["Success"] is False


# -----------------------
# perform_add_user (insert + update)
# -----------------------
def test_perform_add_user_insert(monkeypatch, mock_collections):
    # No edit -> insert_one called, send_mail called
    um.user_collection.find.return_value = [{
        "_id": object(), "Email": "u@example.com", "RoleId": 1, "Avatar": "a.png", "IsActive": True
    }]
    um.role_collection.find.return_value = [{"RoleId": 1, "RoleName": "User"}]

    monkeypatch.setattr(um, "send_mail", lambda *a, **k: True)

    res = um.perform_add_user({
        "IsEdit": False,
        "FirstName": "F",
        "LastName": "L",
        "Email": "u@example.com",
        "Password": "P@ss",
        "Role": 1,
        "Team": 2,
        "CreatedBy": "admin"
    })
    um.user_collection.insert_one.assert_called()
    assert res["Success"] is True
    assert res["RoleName"] == "User"


def test_perform_add_user_update_with_password(monkeypatch, mock_collections):
    # Edit with password (and no Avatar)
    um.user_collection.find.return_value = [{
        "_id": object(), "Email": "u@example.com", "RoleId": 2, "Avatar": "", "IsActive": True
    }]
    um.role_collection.find.return_value = [{"RoleId": 2, "RoleName": "Admin"}]

    res = um.perform_add_user({
        "IsEdit": True,
        "Email": "u@example.com",
        "Password": "NewP@ss",
        "Role": 2,
        "Team": 3,
        "CreatedBy": "admin"
    })
    um.user_collection.update_one.assert_called()
    assert res["Success"] is True
    assert res["RoleName"] == "Admin"


def test_perform_add_user_update_avatar_only(monkeypatch, mock_collections):
    # Edit with Avatar => no Password required
    um.user_collection.find.return_value = [{
        "_id": object(), "Email": "u@example.com", "RoleId": 3, "Avatar": "avatar.png", "IsActive": True
    }]
    um.role_collection.find.return_value = [{"RoleId": 3, "RoleName": "Lead"}]

    res = um.perform_add_user({
        "IsEdit": True,
        "Email": "u@example.com",
        "Avatar": "avatar.png",
        "Role": 3,
        "Team": 10,
        "CreatedBy": "admin"
    })
    um.user_collection.update_one.assert_called()
    assert res["Success"] is True
    assert res["RoleName"] == "Lead"


# -----------------------
# update_user_service
# -----------------------
def test_update_user_service_user_not_found(mock_collections):
    um.user_collection.find_one.return_value = None
    res = um.update_user_service({"Email": "x@example.com"})
    assert res is False


def test_update_user_service_same_password(monkeypatch, mock_collections):
    um.user_collection.find_one.return_value = {
        "Email": "x@example.com", "IsActive": True, "IsDelete": False, "Salt": "S", "Password": "H"
    }
    monkeypatch.setattr(um, "pwd_are_equal", lambda p, h, sk, s: True)  # same
    res = um.update_user_service({"Email": "x@example.com", "Password": "same"})
    assert res is False


def test_update_user_service_update_password(monkeypatch, mock_collections):
    um.user_collection.find_one.return_value = {
        "Email": "x@example.com", "IsActive": True, "IsDelete": False, "Salt": "S", "Password": "H"
    }
    monkeypatch.setattr(um, "pwd_are_equal", lambda p, h, sk, s: False)  # different
    res = um.update_user_service({"Email": "x@example.com", "Password": "newpass"})
    assert res is True
    um.user_collection.update_one.assert_called()


def test_update_user_service_update_avatar_only(mock_collections):
    um.user_collection.find_one.return_value = {
        "Email": "x@example.com", "IsActive": True, "IsDelete": False, "Salt": "S", "Password": "H"
    }
    res = um.update_user_service({"Email": "x@example.com", "Avatar": "pic.png"})
    assert res is True
    um.user_collection.update_one.assert_called()


# -----------------------
# user_active_or_inactive_service
# -----------------------
def test_user_active_or_inactive_service(mock_collections):
    # After toggling, function returns all users (IsDelete: False) with Role/Team names
    users = [{"_id": object(), "Email": "a@example.com", "RoleId": 2, "TeamId": 7, "IsDelete": False}]
    um.user_collection.find.return_value = users
    um.role_collection.find.return_value = [{"RoleId": 2, "RoleName": "R"}]
    um.team_collection.find.return_value = [{"TeamId": 7, "TeamName": "T"}]

    res = um.user_active_or_inactive_service({"EmailId": "a@example.com", "Status": True, "LogginUser": "admin"})
    assert res["Success"] is True
    assert res["UserManagement"][0]["RoleName"] == "R"
    assert res["UserManagement"][0]["TeamName"] == "T"
    um.user_collection.update_one.assert_called()


# -----------------------
# delete_user_details_service
# -----------------------
def test_delete_user_details_service(mock_collections):
    users = [{"_id": object(), "Email": "a@example.com", "RoleId": 2, "IsDelete": False}]
    um.user_collection.find.return_value = users
    um.role_collection.find.return_value = [{"RoleId": 2, "RoleName": "R"}]

    res = um.delete_user_details_service({"EmailId": "a@example.com", "LogginUser": "admin"})
    assert res["Success"] is True
    assert res["UserManagement"][0]["RoleName"] == "R"
    um.user_collection.update_one.assert_called()


# -----------------------
# upload_image_helper (Flask request with files)
# -----------------------
def test_upload_image_helper_no_file(app):
    with app.test_request_context(method="POST", data={}):
        out = um.upload_image_helper()
        assert out["error"] == "No file part"


def test_upload_image_helper_empty_filename(app):
    storage = FileStorage(stream=io.BytesIO(b"abc"), filename="")
    files = FileMultiDict([("file", storage)])
    with app.test_request_context(method="POST", data={}, headers={}):
        # inject into request.files
        app.preprocess_request()
        um.request.files = files
        out = um.upload_image_helper()
        assert out["error"] == "No selected file"


def test_upload_image_helper_success(app, tmp_path, monkeypatch):
    content = b"fake-image-bytes"
    storage = FileStorage(stream=io.BytesIO(content), filename="avatar.png")
    files = FileMultiDict([("file", storage)])

    with app.test_request_context(method="POST", data={}, headers={}):
        # inject into request.files and UserImage_folder already patched
        app.preprocess_request()
        um.request.files = files
        out = um.upload_image_helper()
        assert "filePath" in out and "dataUrl" in out
        # file should exist on disk (unique filename)
        rel = out["filePath"].split("/")[-1]
        full = os.path.join(um.UserImage_folder, rel.split("-")[0] + "-" + rel.split("-")[1])
        # we can list directory to ensure at least one file saved
        assert len(os.listdir(um.UserImage_folder)) >= 1
        assert out["dataUrl"].startswith("data:image/png;base64,")


# -----------------------
# validate_password (Flask request JSON)
# -----------------------
def test_validate_password_missing_fields(app):
    with app.test_request_context(method="POST", json={"Email": ""}):
        res = um.validate_password()
        assert res is False


def test_validate_password_user_not_found(app, mock_collections):
    um.user_collection.find_one.return_value = None
    with app.test_request_context(method="POST", json={"Email": "x@example.com", "Password": "p"}):
        res = um.validate_password()
        assert res is False


def test_validate_password_same_as_old(app, mock_collections, monkeypatch):
    um.user_collection.find_one.return_value = {"Email": "x@example.com", "IsActive": True, "IsDelete": False, "Salt": "S", "Password": "H"}
    monkeypatch.setattr(um, "pwd_are_equal", lambda p, h, sk, s: True)
    with app.test_request_context(method="POST", json={"Email": "x@example.com", "Password": "p"}):
        res = um.validate_password()
        assert res is False


def test_validate_password_ok(app, mock_collections, monkeypatch):
    um.user_collection.find_one.return_value = {"Email": "x@example.com", "IsActive": True, "IsDelete": False, "Salt": "S", "Password": "H"}
    monkeypatch.setattr(um, "pwd_are_equal", lambda p, h, sk, s: False)
    with app.test_request_context(method="POST", json={"Email": "x@example.com", "Password": "p"}):
        res = um.validate_password()
        assert res is True
