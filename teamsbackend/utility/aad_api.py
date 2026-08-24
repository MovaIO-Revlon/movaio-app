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
    app = msal.ConfidentialClientApplication(
        CLIENT_ID,
        authority=AUTHORITY,
        client_credential=CLIENT_SECRET
    )

    # Acquire a token (log non-sensitive details)
    # logger.info("Requesting app token for client_id=%s scopes=%s", CLIENT_ID, SCOPES)
    result = app.acquire_token_for_client(scopes=SCOPES)
    print(f"Connection Result : {result}"-------)
    if "access_token" not in result:
        print(f"Connection Error Result : {result}"-------)
        raise RuntimeError(f"Token acquisition failed: {result}")
    return result["access_token"]

def get_user_by_object_id(aad_object_id, token):
    url = f"https://graph.microsoft.com/v1.0/users/{aad_object_id}"
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

