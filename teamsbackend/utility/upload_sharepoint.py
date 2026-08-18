
import asyncio
import os
import json
import re
import math
import requests
from typing import Optional, Tuple
import logging

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("upload_sharepoint")
logger.setLevel(logging.INFO)

TENANT_ID = os.getenv("TENANT_ID", "")
CLIENT_ID = os.getenv("CLIENT_ID", "")
CLIENT_SECRET = os.getenv("CLIENT_SECRET", "")

LOCAL_FILE_PATH="test_zip.zip"
FILE_SIZE_LIMIT = 4 * 1024 * 1024


def get_drive_id_from_email(email: str, access_token: str) -> str:
    """Get the OneDrive drive ID for a given user email."""
    try:
        headers = {'Authorization': f'Bearer {access_token}'}
        drive_url = f"https://graph.microsoft.com/v1.0/users/{email}/drives"
        drives_data = requests.get(drive_url, headers=headers).json()
        # print(f"Drives Data for {email}: {drives_data}")
        drive_id = next(d['id'] for d in drives_data['value'] if d['driveType'] == 'business')
        # print(f"Drive ID for {email}: {drive_id}")
        return drive_id
    except StopIteration:
        raise ValueError("No business drive found for the user.")

def upload_file_to_sharepoint(local_file_path: str, email:  str, access_token: str) -> dict:
    """Upload a local file to SharePoint for the given user email."""
    try:
        file_size = os.path.getsize(local_file_path)
        drive_id = get_drive_id_from_email(email, access_token)

        if drive_id is None:
            return {"error": "Could not find OneDrive for Business drive.", "status":"failed"}

        if file_size <= FILE_SIZE_LIMIT:
            with open(local_file_path, 'rb') as file:
                file_content = file.read()

            url = f'https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/Microsoft%20Teams%20Chat%20Files/{os.path.basename(local_file_path)}:/content'
            headers = {
                'Authorization': f'Bearer {access_token}',
                'Content-Type': 'application/octet-stream'
            }
            response = requests.put(url, headers=headers, data=file_content)
            # print(f"Upload response: {response.status_code}, {response.json()}")

            if response.status_code in [200, 201]:
                webUrl= response.json().get('webUrl')
                uniqueId= response.json().get('eTag')[2:-4]
                # print(uniqueId)
                return {"message": "Upload successful!", "status":"success", "data": response.json(), 'url':webUrl , 'uniqueId':uniqueId}
            else:
                return {"error": f"Error: {response.status_code}", "status":"failed", "details": response.text}

        else:
            session_url = f'https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/UploadedFiles/{os.path.basename(local_file_path)}:/createUploadSession'
            session_headers = {
                'Authorization': f'Bearer {access_token}',
                'Content-Type': 'application/json'
            }
            session_data = {
                "item": {
                    "@microsoft.graph.conflictBehavior": "rename",
                    "name": os.path.basename(local_file_path)
                }
            }
            session_response = requests.post(session_url, headers=session_headers, json=session_data)
            if session_response.status_code != 200:
                return {"error": f"Error creating upload session: {session_response.status_code}", "status":"failed", "details": session_response.text}
            upload_url = session_response.json().get('uploadUrl')

            chunk_size = 320 * 1024 * 10
            total_chunks = math.ceil(file_size / chunk_size)

            with open(local_file_path, 'rb') as file:
                for chunk_index in range(total_chunks):
                    start_byte = chunk_index * chunk_size
                    end_byte = min(start_byte + chunk_size - 1, file_size - 1)
                    file.seek(start_byte)
                    chunk_data = file.read(end_byte - start_byte + 1)

                    chunk_headers = {
                        'Content-Range': f'bytes {start_byte}-{end_byte}/{file_size}'
                    }

                    chunk_response = requests.put(upload_url, headers=chunk_headers, data=chunk_data)
                    if chunk_response.status_code not in [200, 201, 202]:
                        return {"error": f"Error uploading chunk {chunk_index + 1}: {chunk_response.status_code}", "status":"failed", "details": chunk_response.text}
            return {"message": "Upload completed successfully!",'url':url, "status":"success"}
    except Exception as e:
        # print(f"Exception during upload: {str(e)}")
        logger.error(f"Exception during upload: {str(e)}")
        return {"error": "Exception during upload", "status":"failed", "details": str(e)}
    finally:
        try:
            # asyncio.create_task(async_safe_remove(local_file_path))
            os.remove(local_file_path)
        except Exception as e:
            # print(f"Error removing temporary file {local_file_path}: {str(e)}")
            logger.error(f"Error removing temporary file {local_file_path}: {str(e)}")
        # return


async def async_safe_remove(path):
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except Exception as e:
        # print(f"Error removing file {path}: {str(e)}")
        logger.error(f"Error removing file {path}: {str(e)}")

    