import os
import sys
from typing import Any, Dict, Optional
from urllib.parse import quote

import httpx
from dotenv import load_dotenv

load_dotenv()


def _coerce_to_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def get_graph_token(tenant_id: str, client_id: str, client_secret: str) -> str:
    url = f"https://login.microsoftonline.com/{quote(tenant_id, safe='')}/oauth2/v2.0/token"
    body = {
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": "https://graph.microsoft.com/.default",
        "grant_type": "client_credentials",
    }
    res = httpx.post(url, data=body, timeout=10)
    res.raise_for_status()
    return res.json()["access_token"]


def _get_graph_app_credentials() -> Dict[str, str]:
    return {
         "client_id": os.getenv("CLIENT_ID"),
         "client_secret": os.getenv("CLIENT_SECRET"),
         "tenant_id": os.getenv("TENANT_ID")
    }


def _get_graph_headers() -> Dict[str, str]:
    creds = _get_graph_app_credentials()
    print(f"tenant_id :{creds["tenant_id"]},client_id:{creds["client_id"]},client_secret:{creds["client_secret"]}")
    token = get_graph_token(creds["tenant_id"], creds["client_id"], creds["client_secret"])
    return {"Authorization": f"Bearer {token}", "Accept": "application/json"}


def _fetch_teams_user_profile_by_graph_id(graph_id: str) -> Optional[Dict[str, str]]:
    try:
        
        print(f"Graph_ID: {graph_id}")
        
        headers = _get_graph_headers()

        user_url = (
            f"https://graph.microsoft.com/v1.0/users/{quote(graph_id, safe='')}"
            "?$select=id,displayName,mail,userPrincipalName"
        )
        res = httpx.get(user_url, headers=headers, timeout=10)
        if res.status_code == 200:
            user = res.json()
            return {
                "userName": _coerce_to_text(user.get("displayName")),
                "userEmail": _coerce_to_text(user.get("mail"))
                or _coerce_to_text(user.get("userPrincipalName")),
                "aadObjectId": _coerce_to_text(user.get("id")),
            }
        if res.status_code == 404:
            return None
        res.raise_for_status()
        return None
    except Exception as e:
        print(f"Error fetching user profile by Graph ID {graph_id}: {e}")
        return None


def fetch_teams_user_profile_by_email(email: str) -> Optional[Dict[str, str]]:
    """Returns {"userName", "userEmail", "aadObjectId"} for the given email,
    or None if no matching user is found."""
    headers = _get_graph_headers()

    # Fast path: works if `email` is actually the user's userPrincipalName,
    # since Graph accepts UPN as an alternate key in the /users/{id} route.
    direct_url = (
        f"https://graph.microsoft.com/v1.0/users/{quote(email, safe='')}"
        "?$select=id,displayName,mail,userPrincipalName"
    )
    res = httpx.get(direct_url, headers=headers, timeout=10)
    if res.status_code == 200:
        user = res.json()
        return {
            "userName": _coerce_to_text(user.get("displayName")),
            "userEmail": _coerce_to_text(user.get("mail"))
            or _coerce_to_text(user.get("userPrincipalName")),
            "aadObjectId": _coerce_to_text(user.get("id")),
        }

    # Fallback: filter by SMTP mail address, which can differ from the UPN.
    escaped_email = email.replace("'", "''")
    filter_expr = "mail eq '" + escaped_email + "'"
    filter_url = (
        "https://graph.microsoft.com/v1.0/users?"
        f"$filter={quote(filter_expr, safe='')}"
        "&$select=id,displayName,mail,userPrincipalName"
    )
    res = httpx.get(filter_url, headers=headers, timeout=10)
    res.raise_for_status()
    matches = res.json().get("value", [])
    if not matches:
        return None

    user = matches[0]
    return {
        "userName": _coerce_to_text(user.get("displayName")),
        "userEmail": _coerce_to_text(user.get("mail"))
        or _coerce_to_text(user.get("userPrincipalName")),
        "aadObjectId": _coerce_to_text(user.get("id")),
    }


def fetch_teams_user_profile_by_aad_object_id(aad_object_id: str) -> Optional[Dict[str, str]]:
    """Returns {"userName", "userEmail", "aadObjectId"} for the given AAD object id,
    or None if no matching user is found."""
    return _fetch_teams_user_profile_by_graph_id(aad_object_id)

def fetch_teams_user_profile_by_aad_object_id_cross_tenant(aad_object_id: str, tenant_id: str) -> Optional[Dict[str, str]]:
    """Returns {"userName", "userEmail", "aadObjectId"} for the given AAD object id in a different tenant,
    or None if no matching user is found."""
    try:
        token = get_graph_token(tenant_id, os.getenv("CLIENT_ID"), os.getenv("CLIENT_SECRET"))
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json"
        }

        user_url = (
            f"https://graph.microsoft.com/v1.0/users/{quote(aad_object_id, safe='')}"
            "?$select=id,displayName,mail,userPrincipalName"
        )
        res = httpx.get(user_url, headers=headers, timeout=10)
        if res.status_code == 200:
            user = res.json()
            return {
                "userName": _coerce_to_text(user.get("displayName")),
                "userEmail": _coerce_to_text(user.get("mail"))
                or _coerce_to_text(user.get("userPrincipalName")),
                "aadObjectId": _coerce_to_text(user.get("id")),
            }
        if res.status_code == 404:
            return None
        res.raise_for_status()
        return None
    except Exception as e:
        print(f"Error fetching user profile by Graph ID {aad_object_id} in tenant {tenant_id}: {e}")
        return None