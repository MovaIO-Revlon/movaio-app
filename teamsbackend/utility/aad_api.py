import os
from dotenv import load_dotenv
import msal
import logging
import requests

load_dotenv()

logger = logging.getLogger("aad_api")
logger.setLevel(logging.INFO)   

CLIENT_ID = os.getenv("CLIENT_ID", "")
CLIENT_SECRET = os.getenv("CLIENT_SECRET", "")
TENANT_ID = os.getenv("TENANT_ID", "")
AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
SCOPES = ["https://graph.microsoft.com/.default"]

def get_app_token(scope="https://graph.microsoft.com/.default"):
    try:
        app = msal.ConfidentialClientApplication(
            CLIENT_ID,
            authority=AUTHORITY,
            client_credential=CLIENT_SECRET
        )

        # Acquire a token (log non-sensitive details)
        # logger.info("Requesting app token for client_id=%s scopes=%s", CLIENT_ID, SCOPES)
        result = app.acquire_token_for_client(scopes=SCOPES)
        if "access_token" not in result:
            raise RuntimeError(f"Token acquisition failed: {result}")
        return result["access_token"]
    except Exception as e:
        logger.exception("Error acquiring app token: %s", e)
        return None

def get_user_by_object_id(aad_object_id, token):
    url = f"https://graph.microsoft.com/v1.0/users/{aad_object_id}"
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(url, headers=headers)
    if resp.status_code != 200:
        raise RuntimeError(f"Graph error {resp.status_code}: {resp.text}")
    return resp.json()


def get_user_by_username(username, token):
    url = f"https://graph.microsoft.com/v1.0/users/{username}"
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(url, headers=headers)
    if resp.status_code != 200:
        raise RuntimeError(f"Graph error {resp.status_code}: {resp.text}")
    return resp.json()


def get_user_by_aaid(aad_id):
    token = get_app_token()
    user = get_user_by_object_id(aad_id, token)
    print(f"Retrieved user: {user}")
    return user


def get_user_by_name(username):
    token = get_app_token()
    user = get_user_by_username(username, token)
    print(f"Retrieved user: {user}")
    return user

def get_user_by_email(email,token):
    url = f"https://graph.microsoft.com/v1.0/users/{email}"
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(url, headers=headers)
    if resp.status_code != 200:
        raise RuntimeError(f"Graph error {resp.status_code}: {resp.text}")
    user = resp.json()
    print(f"Retrieved user: {user}")
    return user

# token=get_app_token()
# print(f"Retrieved token: {token}")
# #for movate tenant
# aad_id="6e2998ee-3058-4a39-be98-390358f6e91e" 
# # for dev tenant 
# # aad_id="42f4016c-6f0b-446d-91f9-718ab16f4df2"
# user = get_user_by_object_id(aad_id, token)
# print(f"Retrieved user: {user}")

# get_user_by_email("Clara.George@movate.com",token)

# user2=get_user_by_name("Naveen Kumar Reddy R")
# print(user2)






