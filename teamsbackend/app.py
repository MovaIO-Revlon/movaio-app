import asyncio
import mimetypes
import re
import json
import logging
import uuid
import requests
import pypandoc
import httpx
import inspect
from microsoft_teams.api import Activity, AdaptiveCardActionCardResponse, AdaptiveCardActionMessageResponse, AdaptiveCardInvokeAction, AdaptiveCardInvokeActivity, AdaptiveCardInvokeResponse, MessageActivity, TypingActivityInput, MessageActivityInput , Attachment , SuggestedActions , CardAction
from microsoft_teams.apps import ActivityContext, App
from msgraph.generated.models.chat_message import ChatMessage
from msgraph.generated.models.item_body import ItemBody
from msgraph import GraphServiceClient
import os
from pymongo import MongoClient
from bson.objectid import ObjectId 
from bson import json_util
from utility.send_files_output import send_file_without_consent_card, send_file_with_consent_card
from utility.aad_api import get_app_token, get_user_by_aaid, get_user_by_name
from utility.it_ops import create_incident2, handle_custom_agent_selection, create_incident, handle_incident_resolution, my_tickets , my_tickets2 
from utility.graph_api import fetch_teams_user_profile_by_aad_object_id, fetch_teams_user_profile_by_aad_object_id_cross_tenant,get_device_info_by_aaid
from utility.fetch_teams_profile_by_aadId import fetch_teams_user_profile_by_user_name
from utility.movaio_token_generation import generate_jwt_token
from utility.send_activity import send_message_activity,delete_processing_message
from utility.database_manager import mydb
from datetime import datetime, timedelta, timezone
import time
import jwt
from azure.identity.aio import ClientSecretCredential

from contextlib import asynccontextmanager
from starlette.requests import Request
from starlette.responses import JSONResponse
from dotenv import load_dotenv
load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("teams-app")

# Database connection with error handling
try:
    client = MongoClient(os.getenv("MONGODB_URL", "mongodb://admin_user:Movate$20261@mongodb:27017/"))
    mydb = client[os.getenv("MONGODB_NAME", "teamsapp")]
    # Test connection
    client.admin.command('ping')
    logger.info(f'Successfully connected to MongoDB: {mydb}')
except Exception as e:
    logger.error(f"Failed to connect to MongoDB: {e}")
    raise

# Set pandoc path for Linux container
try:
    pypandoc.get_pandoc_version()
    logger.info("Pandoc is available")
except OSError:
    logger.warning("Pandoc not found in PATH")

# AAD should have required permissions like Files.ReadWrite.All , User.Read.All .
CLIENT_ID = os.getenv("CLIENT_ID", "")
CLIENT_SECRET = os.getenv("CLIENT_SECRET", "")
TENANT_ID = os.getenv("TENANT_ID", "")
SESSION_TIMEOUT_MINUTES = int(os.getenv("SESSION_TIMEOUT_MINUTES", "30"))
AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
SCOPES = ["https://graph.microsoft.com/.default"]

MOVAIO_API=os.getenv("MOVAIO_API", "")
MOVAIO_API_KEY=os.getenv("MOVAIO_API_KEY", "")
SELECTED_AGENT_ID=os.getenv("SELECTED_AGENT_ID", None)

MS_APP_ID = os.getenv("MICROSOFT_APP_ID", "")
MS_APP_PWD = os.getenv("MICROSOFT_APP_PWD", "")

credential = ClientSecretCredential(
    tenant_id=TENANT_ID,
    client_id=CLIENT_ID,
    client_secret=CLIENT_SECRET,
)

graph_client = GraphServiceClient(
    credentials=credential,
    scopes=["https://graph.microsoft.com/.default"]
)

app = App(client_id=MS_APP_ID, client_secret=MS_APP_PWD)

async def handle_value_for_action_cards(ctx: ActivityContext[MessageActivity], value, user_data) -> None:
    """Handle actions from adaptive cards."""
    print('handle_value_for_action_cards called with value:', value)
    
    if value.get("action") == "start_new_conversation":
        # Handle the action to start a new conversation
        aad_object_id = ctx.activity.from_.aad_object_id
        logger.info(f"User {aad_object_id} requested to start a new conversation.")

        # Remove existing session from database
        mydb['UserSessions'].update_one({'aad_object_id': aad_object_id},{'$set': {'session_id': uuid.uuid4().hex, 'first_message': True}})
        await send_agent_cards_by_aaid(ctx.activity.from_.aad_object_id, ctx)
        
        return
    if value.get("action") == "download_transcript":
        logger.info(f"User {ctx.activity.from_.aad_object_id} requested to download transcript.")
        #download the transcript
        transcript = value.get("transcript", "No transcript available.")
        await send_file_without_consent_card(ctx, transcript)
        return
    if value.get("action") == "incident_resolution":
        logger.info(f"value received for incident resolution: {value}")
        incident_number = value.get("incident_number")
        sub_action = value.get("sub-action")
        logger.info(f"User {ctx.activity.from_.aad_object_id} marked incident {incident_number} as {sub_action}.")
        asyncio.create_task(handle_incident_resolution(ctx, value, user_data))
        return
    if value.get("action") == "need_more_help":
        logger.info(f"value received for need more help: {value}")
        incident_number = value.get("incident_number")
        sub_action = value.get("sub-action")
        logger.info(f"User {ctx.activity.from_.aad_object_id} requested more help for incident {incident_number}.")
        asyncio.create_task(handle_need_more_help(ctx, value, user_data))
        return
    if value.get("action") == "approve_ticket_creation":
        logger.info(f"User {ctx.activity.from_.aad_object_id} approved ticket creation.")
        logger.info(f"value received for ticket creation approval: {value}")
        asyncio.create_task(approve_ticket_creation(ctx, value, user_data))
        return
    if value.get("action") == "ignore_ticket_creation":
        logger.info(f"User {ctx.activity.from_.aad_object_id} ignored ticket creation.")
        logger.info(f"value received for ticket creation ignore: {value}")
        asyncio.create_task(ignore_ticket_creation(ctx, value, user_data))
        return
    if value.get("action") == "select_agent":
        if value.get("agent_type")=="lyzr" or value.get("agent_type")=="lyzr_single_agent":
            aad_object_id = ctx.activity.from_.aad_object_id
            selected_agent_id = value.get("agent_id")
            selected_agent_name = value.get("agent_name")
            logger.info(f"User {aad_object_id} selected agent {selected_agent_name} ({selected_agent_id}).")

            suggested_actions_for_selected_agent = SuggestedActions(
                to=[ctx.activity.from_.id],
                actions=[CardAction(
                            type="imBack",
                            title=suggested_cards,
                            value=suggested_cards
                        ) for suggested_cards in value.get("suggested_actions", [])]
            )

            await send_message_activity(ctx, text=f"You have selected {selected_agent_name}. How can I assist you further?", suggested_actions=suggested_actions_for_selected_agent)
            mydb['UserSessions'].update_one({'aad_object_id': aad_object_id},{'$set': {'selected_agent_id': selected_agent_id, 'session_id': uuid.uuid4().hex, 'first_message': True}}, upsert=True)
            return
        else:
            logger.info(f"data from card action: {value}")
            asyncio.create_task(handle_custom_agent_selection(ctx, value))
            return

async def get_userdata_by_aaid(aad_id):
    try:
        print('\n\n\n\n\n\n\n\n\n',aad_id)
        user = mydb['UserSessions'].find_one({'aad_object_id': aad_id})
        if user and 'email' in user:
            email = user['email']
            print(f"Validation_Id 1------------ {email}")
        elif user and 'email' not in user:
            print(f"Validation_Id 2------------ {aad_id}")
            aad_user = fetch_teams_user_profile_by_aad_object_id(aad_id)
            print('aad_user:', aad_user)
            email = aad_user.get('userEmail') or aad_user.get('userPrincipalName')
            mydb['UserSessions'].update_one({'aad_object_id': aad_id},{'$set': {'email': email, 'session_id': uuid.uuid4().hex, 'first_message': True}}, upsert=True)
        else:
            print(f"Validation_Id 3------------ {aad_id}")
            aad_user = fetch_teams_user_profile_by_aad_object_id(aad_id)
            print('aad_user:', aad_user)
            email = aad_user.get('userEmail') or aad_user.get('userPrincipalName')
            mydb['UserSessions'].insert_one({'aad_object_id': aad_id, 'email': email, 'selected_agent_id':None, 'session_id': uuid.uuid4().hex, 'first_message': True})
        userdata = mydb['Users'].find_one({
            'email': {
                '$regex': f'^{email}$',
                '$options': 'i'
            }
        })
        return userdata
    except Exception as e:
        logger.exception("Error retrieving user email by AAID: %s", e)
        return None

async def get_userdata_by_aaid_cross_tenant(ctx, aad_id):
    try:
        print('\n\n\n\n\n\n\n\n\n',aad_id)
        teams_tenant_id = ctx.activity.conversation.tenant_id
        print('teams_tenant_id:', teams_tenant_id)
        user = mydb['UserSessions'].find_one({'aad_object_id': aad_id})
        if user and 'email' in user:
            email = user['email']
        elif user and 'email' not in user:
            aad_user = fetch_teams_user_profile_by_aad_object_id_cross_tenant(aad_id, teams_tenant_id)
            print('aad_user:', aad_user)
            email = aad_user.get('userEmail') or aad_user.get('userPrincipalName')
            mydb['UserSessions'].update_one({'aad_object_id': aad_id},{'$set': {'email': email, 'session_id': uuid.uuid4().hex, 'first_message': True}}, upsert=True)
        else:
            aad_user = fetch_teams_user_profile_by_aad_object_id_cross_tenant(aad_id, teams_tenant_id)
            print('aad_user:', aad_user)
            email = aad_user.get('userEmail') or aad_user.get('userPrincipalName')
            mydb['UserSessions'].insert_one({'aad_object_id': aad_id, 'email': email, 'selected_agent_id':None, 'session_id': uuid.uuid4().hex, 'first_message': True})
        userdata = mydb['Users'].find_one({
            'email': {
                '$regex': f'^{email}$',
                '$options': 'i'
            }
        })
        return userdata
    except Exception as e:
        logger.exception("Error retrieving user email by AAID: %s", e)
        return None

async def get_userdata_by_username(aad_id , username):
    try:
        print('\n\n\n\n\n\n\n\n\n',aad_id)
        user = mydb['UserSessions'].find_one({'aad_object_id': aad_id})
        if user and 'email' in user:
            email = user['email']
            print(f"Validation 1------------ {email}")
        elif user and 'email' not in user:
            UserEmail = user['email']
            print(f"Validation 2------------ {UserEmail}")
            aad_user = fetch_teams_user_profile_by_user_name(UserEmail or username)
            print('aad_user:', aad_user)
            email = aad_user.get('userEmail') or aad_user.get('userPrincipalName')
            mydb['UserSessions'].update_one({'aad_object_id': aad_id},{'$set': {'email': email, 'session_id': uuid.uuid4().hex, 'first_message': True}}, upsert=True)
        else:
            UserEmail = user['email']
            print(f"Validation 3------------ {UserEmail}")
            aad_user = fetch_teams_user_profile_by_user_name(UserEmail or username)
            print('aad_user:', aad_user)
            email = aad_user.get('userEmail') or aad_user.get('userPrincipalName')
            mydb['UserSessions'].insert_one({'aad_object_id': aad_id, 'email': email, 'selected_agent_id':None, 'session_id': uuid.uuid4().hex, 'first_message': True})
        userdata = mydb['Users'].find_one({
            'email': {
                '$regex': f'^{email}$',
                '$options': 'i'
            }
        })
        return userdata
    except Exception as e:
        logger.exception("Error retrieving user email by AAID: %s", e)
        return None

async def send_agent_cards_by_aaid(aad_id, ctx, user_data=None):
    try:
        if user_data is None:
            user_data = await get_userdata_by_aaid(aad_id)
        if not user_data:
            await send_message_activity(ctx, text="Sorry, I couldn't retrieve your user information. Please ensure your account is properly set up and try again.")
            return
        email = user_data.get('email') if user_data else None
        persona = user_data.get('persona') if user_data else None
        sn_username = user_data.get('sn_username') if user_data else None

        persona_data = mydb['Persona'].find_one({'_id': ObjectId(persona)})
        title = persona_data.get('title', "Welcome! Please select an agent from the options below:")

        if not persona:
            agents = json.loads(json_util.dumps(mydb['Agents'].find({"enabled": True},{"_id":0})))
        else:
            agents = json.loads(json_util.dumps(mydb['Agents'].find({"persona": persona, "enabled": True},{"_id":0})))

        if len(agents) == 1:
            logger.info(f"Only one agent available for user {aad_id}. Automatically selecting agent.{agents[0]}")
            agent = agents[0]
            aad_object_id = aad_id
            selected_agent_id = agent.get("agent_id")
            selected_agent_name = agent.get("agent_name")
            logger.info(f"User {aad_object_id} selected agent {selected_agent_name} ({selected_agent_id}).")
            mydb['UserSessions'].update_one({'aad_object_id': aad_object_id},{'$set': {'selected_agent_id': selected_agent_id, 'session_id': uuid.uuid4().hex, 'first_message': True}}, upsert=True)
            
            return
        actions= []
        for agent in agents:
            actions.append({
                "type": "Action.Submit", 
                "title": agent["agent_name"], 
                "data": {**agent, "action": "select_agent", "sn_username": sn_username}
            })

        attachments = [
            Attachment(
                content_type="application/vnd.microsoft.card.adaptive",
                content_url=None,
                content={
                    "type": "AdaptiveCard",
                    "body": [
                        {
                            "type": "TextBlock",
                            "text": title,
                            "wrap": True
                        }
                    ],
                    "actions": actions,
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json", #schema for cards to be displayed in teams (important to have this for the card to render properly)
                    "version": "1.5"
                }
            )
        ]

        await send_message_activity(ctx, attachments=attachments)

    except Exception as e:
        logger.exception("Error in send_agent_cards_by_aaid: %s", e)
        await send_message_activity(ctx, text="Sorry, there was an error retrieving your agents. Please try again later.")

def get_current_utc():
    return datetime.now(timezone.utc)

def is_session_expired(session_data):
    """
    Returns True when the session has been inactive
    longer than SESSION_TIMEOUT_MINUTES.
    """

    last_activity = session_data.get("last_activity")

    if not last_activity:
        return True

    # Handle string values if any old records exist
    if isinstance(last_activity, str):
        last_activity = datetime.fromisoformat(last_activity)

    # MongoDB often returns naive datetime objects
    if last_activity.tzinfo is None:
        last_activity = last_activity.replace(
            tzinfo=timezone.utc
        )

    expiry_time = (
        last_activity
        + timedelta(minutes=SESSION_TIMEOUT_MINUTES)
    )

    return get_current_utc() > expiry_time

def generate_auth_token(email):

    payload = {
        "user_id": email,
        "iat": datetime.utcnow(),
        "exp": datetime.utcnow() + timedelta(hours=1)
    }

    return jwt.encode(payload, os.getenv("JWT_SECRET_KEY"), algorithm="HS256")

async def send_open_tickets(ctx, user_data):
    try:
        payload={
            "email":user_data.get('movaio_email','')
        }
        auth_token = generate_auth_token(user_data.get('email','test@gmail.com'))
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {auth_token}"
        }
        # 60-second read timeout (1 minute). You can tune connect/write/pool as needed.
        timeout = httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=10.0)
        limits = httpx.Limits(max_keepalive_connections=20, max_connections=100)
        async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
            # Basic call (no retries). If you enable retries, wrap this in a loop and catch Read/Connect timeouts.
            response = await client.post(
                f"{MOVAIO_API}/getOpenTickets",
                json=payload,
                headers=headers,
            )

            # Raise for non-2xx to unify error handling
            response.raise_for_status()

            # Safely parse JSON
            try:
                data = response.json()
                print("\n\n\n\n\n\ndata",data)
                tickets_list = data.get("open_tickets", [])
                tickets_text = "Here are your list of open tickets:\n\n| Ticket ID | Title | Status |\n|---|---|---|\n"

                tickets_table=""

                for ticket in tickets_list:
                    tickets_table += f"| {ticket.get('refId', 'N/A')} | {ticket.get('title', 'N/A')} | {ticket.get('currentState', 'N/A')} |\n"

                tickets_text += tickets_table

                new_body=[
                    {
                        "type": "TextBlock",
                        "text": tickets_text,
                        "weight": "bolder",
                        "size": "medium",
                        "wrap": True,
                        "spacing": "Medium"
                    },
                    {
                        "type":"TextBlock",
                        "text":"Here are the 10 recent open tickets. Would you like to take any action on a specific ticket, or is there a new IT issue I can help you log?",
                        "wrap": True,
                        "spacing": "Medium"
                    }
                ]

                attachment = Attachment(
                    content_type="application/vnd.microsoft.card.adaptive",
                    content_url=None,
                    content={
                        "type": "AdaptiveCard",
                        "body": new_body,
                        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                        "version": "1.4"
                    }
                )

                await send_message_activity(ctx, attachments=[attachment])
                return {
                    "status":"Success"
                }
            except ValueError:
                # If server returns non-JSON (text/html), log truncated body
                return {
                    "status":"Failed"
                }
    except Exception as exc:
        # Catch-all
        logger.exception("Unexpected error calling external API: %s", exc)
        return {
            "status":"Failed"
        }

@app.on_message
async def handle_message(ctx: ActivityContext[MessageActivity]):
    """Handle message activities using the new generated handler system."""

    #send typing indicator to user while processing the message
    #await ctx.reply(TypingActivityInput())

    # Retrieve the user's AAD object ID from the activity context which is unique to each user in Microsoft Teams and can be used to identify the user across different conversations and sessions.
    aad_object_id = ctx.activity.from_.aad_object_id

    user_data = await get_userdata_by_aaid(aad_object_id)
    #user_data = await get_userdata_by_aaid_cross_tenant(ctx, aad_object_id)
    if not user_data:
        user_data = await get_userdata_by_username(aad_object_id, ctx.activity.from_.name)

    configuration = mydb['Configurations'].find_one({})

    print('fetched user data for ', aad_object_id, ':', user_data)
    if not user_data:
        logger.error(f"User data not found for AAD object ID: {aad_object_id}. Cannot proceed with message handling.")
        await send_message_activity(ctx, text="Sorry, I couldn't retrieve your user information. Please ensure your account is properly set up and try again.")
        return

    # name = user_data.get('name') if user_data else None

    # for action cards clicked
    value = ctx.activity.value
    if value:
        await handle_value_for_action_cards(ctx, value, user_data)
        return

    session_data = mydb['UserSessions'].find_one({'aad_object_id': aad_object_id})
        
    session_expired = False
        
    if session_data:
        selected_agent_id = session_data.get('selected_agent_id')
        
    if is_session_expired(session_data):
        
        session_expired = True
        
        session_id = uuid.uuid4().hex
        
        mydb['UserSessions'].update_one(
                {'aad_object_id': aad_object_id},
                {
                    '$set': {
                        'session_id': session_id,
                        'last_activity': get_current_utc()
                    }
                }
                )
        
        logger.info(
                    f"Session expired for user "
                    f"{aad_object_id}. "
                    f"Created new session: {session_id}"
                )
                
    else:
        
        default_agent = mydb['Agents'].find_one(
                {"enabled": True}
            )
        
        if not default_agent:
            await send_message_activity(
                    ctx,
                    text="No agents are currently available."
                )
            return
        
        selected_agent_id = default_agent['agent_id']
        session_id = session_data.get('session_id')
        
        mydb['UserSessions'].update_one(
            {'aad_object_id': aad_object_id},
            {
                '$set': {
                    'selected_agent_id': selected_agent_id,
                    'session_id': session_id,
                    'last_activity': get_current_utc()
                }
            },
            upsert=True
        )

    text = (ctx.activity.text or "").strip()
    
    # Persistent typing indicator

    stop_typing_event = asyncio.Event()

    typing_task = asyncio.create_task(
        typing_loop(
            ctx,
            stop_typing_event
        )
    )

    processing_message_ids = None
    
    if session_expired:
        await send_message_activity(
                ctx,
                text=(
                    "Your previous session expired due to "
                    "inactivity. I've started a new "
                    "conversation."
                )
        )


    agent_data={}

    #logic for calling the agent API
    try:
        
        progress_task = asyncio.create_task(send_progress_updates(ctx))
        
        device_info = get_device_info_by_aaid(aad_object_id)
        
        print(f"Retriving deviceInfo using Intune API : {device_info}")
        
        print(f"User_Data : {user_data}")
        auth_token = generate_auth_token(user_data.get('email','test@revlon.com'))

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {auth_token}"
        }

        print(f"Calling external API for user {aad_object_id}, agent {selected_agent_id}, session {session_id} with text: {text}")

        payload = {
            "user_id": user_data.get('email','test@revlon.com'),
            "agent_id": SELECTED_AGENT_ID,
            "session_id": session_id,
            "userQuery": text
        }

        print(f"Payload for external API: {payload}, with auth token: {auth_token} , calling URL: {MOVAIO_API}/chatbotagent/chat")

        logger.info(f"Calling external API for user {aad_object_id}, agent {selected_agent_id}, session {session_id}.")
        # 60-second read timeout (1 minute). You can tune connect/write/pool as needed.
        timeout = httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=10.0)
        limits = httpx.Limits(max_keepalive_connections=20, max_connections=100)
        async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
            # Basic call (no retries). If you enable retries, wrap this in a loop and catch Read/Connect timeouts.
            
            print(f"{MOVAIO_API}/chatbotagent/chat")
            print(f"API Payload : {payload}")
            
            response = await client.post(
                f"{MOVAIO_API}/chatbotagent/chat",
                json=payload,
                headers=headers,
            )

            # Raise for non-2xx to unify error handling
            response.raise_for_status()

            # Stop waiting for progress updates
            processing_message_ids = await progress_task

            # Safely parse JSON
            try:
                data = response.json()
                
                mydb['UserSessions'].update_one(
                    {'aad_object_id': aad_object_id},
                    {
                        '$set': {
                            'last_activity': get_current_utc()
                        }
                    }
                )
                
            except ValueError:
                # If server returns non-JSON (text/html), log truncated body
                raw_text = response.text
                data= raw_text
                logger.error("Invalid JSON from agent (status=%s): %s", response.status_code, raw_text[:1000])
                if processing_message_ids:
                    await delete_processing_message(ctx,processing_message_ids)
                await send_message_activity(ctx, text="Received an unexpected response from the service.")
                return

    except Exception as exc:

        data = str(exc)

        logger.exception(
            "Unexpected error calling external API: %s",
            exc
        )

        if processing_message_ids:
            await delete_processing_message(ctx,processing_message_ids)

        await send_message_activity(
            ctx,
            text=(
                "An unexpected error occurred "
                "while processing your request."
            )
        )

        return
    
    finally:

        stop_typing_event.set()

        try:
            typing_task.cancel()
            
        except Exception as e:
            logger.error("Error occurred while canceling typing task: %s", e)
            print("Error occurred while canceling typing task: %s", e)
            pass

    # Handle response content safely
    logger.info("Received response from external API for user %s", aad_object_id)

    # Try common response shape
    output_data = None
    if isinstance(data, dict):
        output_data = data.get("data",{}).get("response","")
    if not output_data:
        # Fallback: stringify if nothing obvious
        output_data = json.dumps(data, ensure_ascii=False)

    if output_data:

        action_buttons = []
        suggested_actions_for_selected_agent = None
        
        if ("We hope this recommendation helps resolve your issue" in output_data or "by selecting one of the action buttons below" in output_data):
            incident_number_match = re.search(r'INC\d{7}', output_data)
            if incident_number_match:
                incident_number = incident_number_match.group()
                print(f"Extracted incident number: {incident_number}")
                mydb['UserSessions'].update_one({'aad_object_id': aad_object_id},{'$set': {'session_id': uuid.uuid4().hex, 'first_message': True}})
                action_buttons=[
                    {
                        "type": "Action.Submit",
                        "title": "Unresolved",
                        "data": {"action": "incident_resolution","sub-action": "unresolved","incident_number": incident_number, "timestamp":datetime.utcnow().isoformat()}
                    },
                    {   
                        "type": "Action.Submit",
                        "title": "Resolved",
                        "data": {"action": "incident_resolution","sub-action": "resolved","incident_number": incident_number, "timestamp":datetime.utcnow().isoformat()}
                    }
                ]

        # incident_resolution_keywords = ["incident has been created", "created in ServiceNow", "has been raised", "your ticket has been successfully created", "your incident ticket has been created successfully.", "your ticket has been logged successfully", "your ticket has been created successfully", "ticket has been created", "ticket has been logged"]
        incident_resolution_keywords = configuration.get('incident_resolution_keywords', ["incident has been created", "created in ServiceNow", "has been raised", "your ticket has been successfully created", "your incident ticket has been created successfully.", "your ticket has been logged successfully", "your ticket has been created successfully", "ticket has been created", "ticket has been logged"])


        # if ("incident has been created" in output_data or "created in ServiceNow" in output_data or "has been raised" in output_data or 'your ticket has been successfully created' in output_data.lower() or "your incident ticket has been created successfully." in output_data.lower() or "your ticket has been logged successfully" in output_data.lower() or "your ticket has been created successfully" in output_data.lower() or "ticket has been created" in output_data.lower() or "ticket has been logged" in output_data.lower()):
        if any(keyword in output_data.lower() for keyword in incident_resolution_keywords):
            # incident_number_match = re.search(r'INC\d{7}', output_data)
            incident_number_match = re.search(r'INC-\d{2}-\d{2}-\d{6}', output_data)
            if incident_number_match :
                incident_number = incident_number_match.group()
                print(f"Extracted incident number: {incident_number}")
                mydb['UserSessions'].update_one({'aad_object_id': aad_object_id},{'$set': {'session_id': uuid.uuid4().hex, 'first_message': True, 'session_messages_count': 0, "session_exceeded_limit_count": 0}})
                mydb['ActionButtonsHistory'].update_one({'session_id':session_id,"button_type":"approve"},{'$set': {"clicked": True}}, upsert=True)
                if "Our team will review your request" not in output_data and "There is no automated resolution guide available" not in output_data:
                    action_buttons=[
                        {
                            "type": "Action.Submit",
                            "title": "Escalate Ticket",
                            "data": {"action": "incident_resolution","sub-action": "unresolved","incident_number": incident_number, "timestamp":datetime.utcnow().isoformat()}
                        },
                        {   
                            "type": "Action.Submit",
                            "title": "Resolved",
                            "data": {"action": "incident_resolution","sub-action": "resolved","incident_number": incident_number, "timestamp":datetime.utcnow().isoformat()}
                        },
                        {
                            "type": "Action.Submit",
                            "title": "Need More Help",
                            "data": {"action": "need_more_help","sub-action": "need_more_help","incident_number": incident_number, "timestamp":datetime.utcnow().isoformat()}
                        }
                    ]

        if ("check_incident_status" in output_data and agent_data.get('agent_type','')=='lyzr_single_agent'):
            logger.info(f"User {aad_object_id} has requested to check incident status. Informing them about ServiceNow.")
            value = {
                "sn_username": user_data.get('sn_username'),
                "data":{
                    "count":5
                }
            }
                        
            await my_tickets2(ctx, value)
            return
        approve_ticket_keywords=configuration.get('approve_ticket_keywords', ["approve to create the ticket", "**approve** to create the ticket", "Please reply \"approve\" to confirm", "please reply \"approve\" to confirm", "please reply approve to confirm", "please reply **approve** to confirm", "\"approve\" to confirm", "**approve** to confirm", "approve to confirm"])
        
        if any(keyword in output_data.lower() for keyword in approve_ticket_keywords):

        # if ("approve to create the ticket" in output_data or "**approve** to create the ticket" in output_data or "Please reply \"approve\" to confirm" in output_data or "please reply \"approve\" to confirm" in output_data.lower() or "please reply approve to confirm" in output_data.lower() or "please reply **approve** to confirm" in output_data.lower() or "\"approve\" to confirm" in output_data.lower() or "**approve** to confirm" in output_data.lower() or "approve to confirm" in output_data.lower() ):
            approve_button_id= str(uuid.uuid4())
            ignore_button_id= str(uuid.uuid4())
            action_buttons=[
                {
                    "type": "Action.Submit",
                    "title": "Approve",
                    "data": {"action": "approve_ticket_creation","message": output_data,"button_type":"approve", "timestamp":datetime.utcnow().isoformat(), "session_id": session_id, "agent_id": selected_agent_id, "user_id": user_data.get('movaio_email',''),"button_id": approve_button_id}
                },
                {   
                    "type": "Action.Submit",
                    "title": "Ignore",
                    "data": {"action": "ignore_ticket_creation","button_type":"ignore", "timestamp":datetime.utcnow().isoformat(), "session_id": session_id, "agent_id": selected_agent_id, "user_id": user_data.get('movaio_email',''),"button_id": ignore_button_id}
                }
            ]

            mydb['ActionButtonsHistory'].update_one({'session_id':session_id,"button_type":"approve"},{'$set': {'aad_object_id': aad_object_id,"button_type":"approve", 'action': "approve_ticket_creation", 'timestamp': datetime.utcnow(), 'session_id': session_id,'clicked': False, 'agent_id': selected_agent_id, 'user_id': user_data.get('movaio_email',''), 'button_id': approve_button_id}}, upsert=True)
            mydb['ActionButtonsHistory'].update_one({'session_id':session_id,"button_type":"ignore"},{'$set': {'aad_object_id': aad_object_id,"button_type":"ignore", 'action': "ignore_ticket_creation", 'timestamp': datetime.utcnow(), 'session_id': session_id,'clicked': False, 'agent_id': selected_agent_id, 'user_id': user_data.get('movaio_email',''), 'button_id': ignore_button_id}}, upsert=True)


        output_data_card_attachment = [
            Attachment(
                content_type="application/vnd.microsoft.card.adaptive",
                content_url=None,
                content={
                "type": "AdaptiveCard",
                "body": [
                    {
                        "type": "TextBlock",
                        "text": output_data,
                        "wrap": True,
                        "width": "stretch"
                    }
                ],
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",  #schema for cards to be displayed in teams (important to have this for the card to render properly)
                "version": "1.4"
            })
        ]


        start_new_conversation_card_attachment =[
            Attachment(
                content_type="application/vnd.microsoft.card.adaptive",
                content_url=None,
                content={
                    "type": "AdaptiveCard",
                    "actions": [
                        {
                            "type": "Action.Submit",
                            "title": "Start New Conversation",
                            # "iconUrl": "https://img.icons8.com/ios-filled/50/ffffff/plus--v1.png",
                            "data": {"action": "start_new_conversation"}
                        }
                    ],
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",  #schema for cards to be displayed in teams (important to have this for the card to render properly)
                    "version": "1.4"
                }
            )
        ]

        # -----------------------------------------------------
        # DELETE PROCESSING CARD
        # -----------------------------------------------------

        if processing_message_ids:
           await delete_processing_message(ctx,processing_message_ids)

        await send_message_activity(ctx, attachments=output_data_card_attachment, suggested_actions=suggested_actions_for_selected_agent)

    else:
        if processing_message_ids:
                   await delete_processing_message(ctx,processing_message_ids)
                   
        await send_message_activity(ctx, text="The service returned an empty response.")

    return

async def process_request(ctx):
    from microsoft_teams.apps.routing.activity_context import send_or_update_activity
    from microsoft_teams.api import ActivityParams
    # from microsoft_teams.api.clients import update_activity
    updated_card = {
        "type": "AdaptiveCard",
        "body": [
            {
                "type": "TextBlock",
                "text": "Your approval has been recorded. The ticket creation process will proceed.",
                "wrap": True,
                "weight": "Bolder",
                "color": "Good"
            }
        ],
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "version": "1.5"
    }
    activity = MessageActivityInput(
        # id="ctx.activity.id",
        attachments=[Attachment(
            content_type="application/vnd.microsoft.card.adaptive",
            content=updated_card
        )]
    )
    await ctx.send(activity)

@app.on_card_action
async def handle_card_action(ctx: ActivityContext[AdaptiveCardInvokeActivity],
) -> AdaptiveCardInvokeResponse:
    """Handle card actions using the new generated handler system."""
    # value = ctx.activity.value
    print('value from card action:', ctx.activity.value)
    value = ctx.activity.value
    print('value from card action:', value.action.data)
    print(ctx.activity.id)
    aad_object_id = ctx.activity.from_.aad_object_id
    
    user_data = await get_userdata_by_username(aad_object_id, ctx.activity.from_.name)
    print('fetched user data for ', aad_object_id, ':', user_data)
    if not user_data:
        logger.error(f"User data not found for AAD object ID: {aad_object_id}. Cannot proceed with message handling.")
        await send_message_activity(ctx, text="Sorry, I couldn't retrieve your user information. Please ensure your account is properly set up and try again.")
        return

    if value.action.verb == "approve_ticket_creation":
        await asyncio.create_task(approve_ticket_creation(ctx,value.action.data, user_data))
        message = value.action.data.get("message", "")
        updated_card = {
            "type": "AdaptiveCard",
            "body": [
                {
                    "type": "TextBlock",
                    "text": message,
                    "wrap": True
                },
                {
                    "type": "TextBlock",
                    "text": "Your approval has been recorded. The ticket creation process will proceed.",
                    "wrap": True,
                    "weight": "Bolder",
                    "color": "Good"
                }
            ],
            "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
            "version": "1.5"
        }
        # return AdaptiveCardInvokeResponse(status_code=200, type="application/vnd.microsoft.card.adaptive", value={"message": message})
            
        return AdaptiveCardActionCardResponse(
            value=updated_card
        )
    if value.action.verb == "ignore_ticket_creation":
        message = value.action.data.get("message", "")
        await asyncio.create_task(ignore_ticket_creation(ctx,value.action.data, user_data))
        updated_card = {
            "type": "AdaptiveCard",
            "body": [
                {
                    "type": "TextBlock",
                    "text": message,
                    "wrap": True
                },
                {
                    "type": "TextBlock",
                    "text": "You have chosen to ignore the ticket creation.",
                    "wrap": True,
                    "weight": "Bolder",
                    "color": "Warning"
                }
            ],
            "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
            "version": "1.5"
        }
        return AdaptiveCardActionCardResponse(
            value=updated_card
        )

    if value.action.verb == "incident_resolution":
        response = await handle_incident_resolution_card_update(ctx, value.action.data, user_data)
        if not response:
            return AdaptiveCardInvokeResponse(status_code=500, type="application/vnd.microsoft.card.adaptive", value={"message": "Failed to process incident resolution."})
        if response.get("status","")!= "success":
            return AdaptiveCardInvokeResponse(status_code=500, type="application/vnd.microsoft.card.adaptive", value={"message": response.get("message","Failed to process incident resolution.")})

        
        message = value.action.data.get("message", "")
        updated_card = {
            "type": "AdaptiveCard",
            "body": [
                {
                    "type": "TextBlock",
                    "text": message,
                    "wrap": True
                },
                {
                    "type": "TextBlock",
                    "text": response.get("message","Incident resolution processed successfully."),
                    "wrap": True,
                    "weight": "Bolder",
                    "color": "Good" if value.action.data.get('sub-action') == 'resolved' else 'Warning'
                }
            ],
            "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
            "version": "1.5"
        }
        return AdaptiveCardActionCardResponse(
            value=updated_card
        )

@app.on_card_action_execute("test_verb")
async def handle_test_verb(ctx: ActivityContext[AdaptiveCardInvokeActivity],)-> AdaptiveCardInvokeResponse:
    print('value from test_verb card action:')
    activity = ctx.activity
    print(activity.value)
    await asyncio.create_task(process_request())
    return AdaptiveCardInvokeResponse(status_code=200, type="application/vnd.microsoft.card.adaptive", value={"message": "Transcript download initiated."})

@app.on_file_consent
async def handle_file_consent(ctx):
    """Handle file consent responses."""
    consent_response = ctx.activity.value
    if consent_response.action == "accept":
        upload_info= consent_response.upload_info
        upload_url = upload_info.upload_url
        file_name = upload_info.name
        local_file_path = 'temp/' + file_name  # Assuming the file was saved here

        with open(local_file_path, 'rb') as f:
            file_data = f.read()

        headers = {
            'Content-Range': f'bytes 0-{len(file_data)-1}/{len(file_data)}'
        }

        async with httpx.AsyncClient() as client:
            response = await client.put(upload_url, headers=headers, content=file_data)
            if response.status_code in (200, 201):
                attachments=[
                    Attachment(
                        content_type="application/vnd.microsoft.teams.card.file.info",
                        content_url=upload_info.content_url,
                        name=file_name,
                        content={
                            "uniqueId": upload_info.unique_id,
                            "fileType": mimetypes.guess_type(file_name)[0] or "application/octet-stream"
                        }
                    )
                ]
                await send_message_activity(ctx, attachments=attachments)

            else:
                await send_message_activity(ctx, text=f"File upload failed with status code {response.status_code}.")
    else:
        await send_message_activity(ctx, text="File upload was declined by the user.")  

async def approve_ticket_creation(ctx, value, user_data):
    try:
        session_id = value.get("session_id")
        actions_data = mydb["ActionButtonsHistory"].find_one({"session_id": session_id,"button_type":"approve"})
        ignore_action_data = mydb["ActionButtonsHistory"].find_one({"session_id": session_id,"button_type":"ignore"})
        configuration = mydb["Configurations"].find_one({})
        print(f"Approval action data retrieved for session_id {session_id}: {actions_data}")
        print(f"value received: {value}")
        if not actions_data:
            logger.warning(f"No approval action found for session_id: {session_id}")
            await send_message_activity(ctx, text="No approval action found for this session.")
            return
        if actions_data.get("clicked"):
            logger.info(f"Approval action already processed for session_id: {session_id}")
            await send_message_activity(ctx, text="This approval action has already been processed.")
            return
        if ignore_action_data and ignore_action_data.get("clicked"):
            logger.info(f"Ignore action already processed for session_id: {session_id}")
            await send_message_activity(ctx, text="The ticket creation has been ignored. Please let me know if you have any other issue")
            return
        if value.get("button_id") != actions_data.get("button_id"):
            logger.warning(f"Button ID mismatch for session_id: {session_id}. Expected: {actions_data.get('button_id')}, Received: {value.get('button_id')}")
            await send_message_activity(ctx, text="Please Click the latest button to approve the ticket creation.")
            return
        await send_message_activity(ctx, text="Please wait, I have started creating a ticket for you.")
        await ctx.reply(TypingActivityInput())
        aad_object_id=actions_data.get("aad_object_id")
        selected_agent_id=actions_data.get("agent_id")
        mydb["ActionButtonsHistory"].update_one({"session_id": session_id,"button_type":"approve"}, {"$set": {"clicked": True}})
        mydb["UserSessions"].update_one({"aad_object_id": aad_object_id}, {"$set": {"session_id": uuid.uuid4().hex, "first_message": True, "session_messages_count": 0,"session_exceeded_limit_count": 0}})
        # await send_message_activity(ctx, text="Your approval has been recorded. The ticket creation process will proceed.")
        try:
            auth_token = generate_auth_token(user_data.get('email','test@gmail.com'))

            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {auth_token}"
            }

            payload = {
                "user_id": actions_data.get("user_id"),
                "agent_id": actions_data.get("agent_id"),
                "session_id": actions_data.get("session_id"),
                "userQuery": 'approve'
            }

            print(f"Payload for external API: {payload}, with auth token: {auth_token} , calling URL: {MOVAIO_API}/chatbotagent/chat")

            logger.info(f"Calling external API for user {actions_data.get('user_id')}, agent {actions_data.get('agent_id')}, session {actions_data.get('session_id')}.")
            # 60-second read timeout (1 minute). You can tune connect/write/pool as needed.
            timeout = httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=10.0)
            limits = httpx.Limits(max_keepalive_connections=20, max_connections=100)
            async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
                # Basic call (no retries). If you enable retries, wrap this in a loop and catch Read/Connect timeouts.
                response = await client.post(
                    f"{MOVAIO_API}/chatbotagent/chat",
                    json=payload,
                    headers=headers,
                )

                # Raise for non-2xx to unify error handling
                response.raise_for_status()

                # Safely parse JSON
                try:
                    data = response.json()
                except ValueError:
                    # If server returns non-JSON (text/html), log truncated body
                    raw_text = response.text
                    data= raw_text
                    mydb['UserChatHistory'].update_one({'aad_object_id': actions_data.get('aad_object_id')},{'$push': {'chat_history': {'timestamp': datetime.utcnow(),"role":"assistant", 'message': data,"error": "Received an unexpected response from the service.", 'session_id': actions_data.get('session_id') , 'agent_id': actions_data.get('agent_id') , 'user_id': actions_data.get('user_id')}},'$set': {'email': user_data.get('email',''),'aad_object_id': actions_data.get('aad_object_id')}}, upsert=True)
                    logger.error("Invalid JSON from agent (status=%s): %s", response.status_code, raw_text[:1000])
                    await send_message_activity(ctx, text="Received an unexpected response from the service.")
                    return

        except Exception as exc:
            # Catch-all
            data = str(exc)
            mydb['UserChatHistory'].update_one({'aad_object_id': actions_data.get('aad_object_id')},{'$push': {'chat_history': {'timestamp': datetime.utcnow(),"role":"assistant", 'message': "","error": str(exc), 'session_id': actions_data.get('session_id') , 'agent_id': actions_data.get('agent_id') , 'user_id': actions_data.get('user_id')}},'$set': {'email': user_data.get('email',''),'aad_object_id': actions_data.get('aad_object_id')}}, upsert=True)
            logger.exception("Unexpected error calling external API: %s", exc)
            await send_message_activity(ctx, text="An unexpected error occurred while processing your request.")
            return

        
        try:
            mydb['UserChatHistory'].update_one({'aad_object_id': aad_object_id},{'$push': {'chat_history': {'timestamp': datetime.utcnow(),"role":"assistant", 'message': data, 'session_id': session_id , 'agent_id': selected_agent_id , 'user_id': user_data.get('movaio_email','')}},'$set': {'email': user_data.get('email',''),'aad_object_id': aad_object_id}}, upsert=True)
        except Exception as e:
            logger.exception("Error updating chat history for user %s: %s", aad_object_id, e)
            mydb['UserChatHistory'].update_one({'aad_object_id': aad_object_id},{'$push': {'chat_history': {'timestamp': datetime.utcnow(),"role":"assistant", 'message': "","error": str(e), 'session_id': session_id , 'agent_id': selected_agent_id , 'user_id': user_data.get('movaio_email','')}},'$set': {'email': user_data.get('email',''),'aad_object_id': aad_object_id}}, upsert=True)

        # Handle response content safely
        logger.info("Received response from external API for user %s", aad_object_id)

        # Try common response shape
        output_data = None
        if isinstance(data, dict):
            output_data = data.get("data",{}).get("response","")
        if not output_data:
            # Fallback: stringify if nothing obvious
            output_data = json.dumps(data, ensure_ascii=False)
            # output_data = "Something went wrong. Please try again later."


        if output_data:

            action_buttons = []
            suggested_actions_for_selected_agent=None

            
            if ("We hope this recommendation helps resolve your issue" in output_data or "by selecting one of the action buttons below" in output_data):
                incident_number_match = re.search(r'INC\d{7}', output_data)
                if incident_number_match:
                    incident_number = incident_number_match.group()
                    print(f"Extracted incident number: {incident_number}")
                    mydb['UserSessions'].update_one({'aad_object_id': aad_object_id},{'$set': {'session_id': uuid.uuid4().hex, 'first_message': True}})
                    action_buttons=[
                        {
                            "type": "Action.Submit",
                            "title": "Unresolved",
                            "data": {"action": "incident_resolution","sub-action": "unresolved","incident_number": incident_number, "timestamp":datetime.utcnow().isoformat()}
                        },
                        {   
                            "type": "Action.Submit",
                            "title": "Resolved",
                            "data": {"action": "incident_resolution","sub-action": "resolved","incident_number": incident_number, "timestamp":datetime.utcnow().isoformat()}
                        }
                    ]

            incident_resolution_keywords = configuration.get('incident_resolution_keywords', ["incident has been created", "created in ServiceNow", "has been raised", "your ticket has been successfully created", "your incident ticket has been created successfully.", "your ticket has been logged successfully", "your ticket has been created successfully", "ticket has been created", "ticket has been logged"])
            
            # if ("incident has been created" in output_data or "created in ServiceNow" in output_data or "has been raised" in output_data or 'your ticket has been successfully created' in output_data.lower() or "your incident ticket has been created successfully." in output_data.lower() or "your ticket has been logged successfully" in output_data.lower() or "your ticket has been created successfully" in output_data.lower() or "ticket has been created" in output_data.lower() or "ticket has been logged" in output_data.lower()):
            if any(keyword in output_data.lower() for keyword in incident_resolution_keywords):
                # incident_number_match = re.search(r'INC\d{7}', output_data)
                incident_number_match = re.search(r'INC-\d{2}-\d{2}-\d{6}', output_data)
                if incident_number_match and "Our team will review your request" not in output_data and "There is no automated resolution guide available" not in output_data:
                    incident_number = incident_number_match.group()
                    print(f"Extracted incident number: {incident_number}")
                    # mydb['UserSessions'].update_one({'aad_object_id': aad_object_id},{'$set': {'session_id': uuid.uuid4().hex, 'first_message': True , 'session_messages_count':0}})
                    action_buttons=[
                        {
                            "type": "Action.Submit",
                            "title": "Escalate Ticket",
                            "data": {"action": "incident_resolution","sub-action": "unresolved","incident_number": incident_number, "timestamp":datetime.utcnow().isoformat()}
                        },
                        {   
                            "type": "Action.Submit",
                            "title": "Resolved",
                            "data": {"action": "incident_resolution","sub-action": "resolved","incident_number": incident_number, "timestamp":datetime.utcnow().isoformat()}
                        },
                        {
                            "type": "Action.Submit",
                            "title": "Need More Help",
                            "data": {"action": "need_more_help","sub-action": "need_more_help","incident_number": incident_number, "timestamp":datetime.utcnow().isoformat()}
                        }
                    ]

                    # suggested_cards=["My Open Tickets","Create a new ticket"]
                    
                    # suggested_actions_for_selected_agent = SuggestedActions(
                    #     to=[ctx.activity.from_.id],
                    #     actions=[CardAction(
                    #         type="imBack",
                    #         title=suggested_card,
                    #         value=suggested_card
                    #     ) for suggested_card in suggested_cards]
                    # )

            if ("check_incident_status" in output_data ):
                logger.info(f"User {aad_object_id} has requested to check incident status. Informing them about ServiceNow.")
                value = {
                    "sn_username": user_data.get('sn_username'),
                    "data":{
                        "count":5
                    }
                }
                await my_tickets2(ctx, value)
                return

            approve_ticket_keywords=configuration.get('approve_ticket_keywords', ["approve to create the ticket", "**approve** to create the ticket", "Please reply \"approve\" to confirm", "please reply \"approve\" to confirm", "please reply approve to confirm", "please reply **approve** to confirm", "\"approve\" to confirm", "**approve** to confirm", "approve to confirm"])

            if any(keyword in output_data.lower() for keyword in approve_ticket_keywords):
                approve_button_id= str(uuid.uuid4())
                ignore_button_id= str(uuid.uuid4())
                action_buttons=[
                    {
                        "type": "Action.Submit",
                        "title": "Approve",
                        "data": {"action": "approve_ticket_creation","button_type":"approve", "timestamp":datetime.utcnow().isoformat(), "session_id": session_id, "agent_id": selected_agent_id, "user_id": user_data.get('movaio_email',''),"button_id": approve_button_id}
                    },
                    {   
                        "type": "Action.Submit",
                        "title": "Ignore",
                        "data": {"action": "ignore_ticket_creation","button_type":"ignore", "timestamp":datetime.utcnow().isoformat(), "session_id": session_id, "agent_id": selected_agent_id, "user_id": user_data.get('movaio_email',''),"button_id": ignore_button_id}
                    }
                ]

                mydb['ActionButtonsHistory'].update_one({'session_id':session_id,"button_type":"approve"},{'$set': {'aad_object_id': aad_object_id,"button_type":"approve", 'action': "approve_ticket_creation", 'timestamp': datetime.utcnow(), 'session_id': session_id,'clicked': False, 'agent_id': selected_agent_id, 'user_id': user_data.get('movaio_email',''), 'button_id': approve_button_id}}, upsert=True)
                mydb['ActionButtonsHistory'].update_one({'session_id':session_id,"button_type":"ignore"},{'$set': {'aad_object_id': aad_object_id,"button_type":"ignore", 'action': "ignore_ticket_creation", 'timestamp': datetime.utcnow(), 'session_id': session_id,'clicked': False, 'agent_id': selected_agent_id, 'user_id': user_data.get('movaio_email',''), 'button_id': ignore_button_id}}, upsert=True)

                # mydb['ActionButtonsHistory'].insert_one({'aad_object_id': aad_object_id, 'action': "approve_ticket_creation", 'timestamp': datetime.utcnow(), 'session_id': session_id, 'agent_id': selected_agent_id, 'user_id': user_data.get('movaio_email','')})
                # mydb['ActionButtonsHistory'].insert_one({'aad_object_id': aad_object_id, 'action': "reject_ticket_creation", 'timestamp': datetime.utcnow(), 'session_id': session_id, 'agent_id': selected_agent_id, 'user_id': user_data.get('movaio_email','')})


            output_data_card_attachment = [
                Attachment(
                    content_type="application/vnd.microsoft.card.adaptive",
                    content_url=None,
                    content={
                    "type": "AdaptiveCard",
                    "body": [
                        {
                            "type": "TextBlock",
                            "text": output_data,
                            "wrap": True,
                            "width": "stretch"
                        },
                        {
                            "type": "ActionSet",
                            "actions": action_buttons
                        }
                        # {
                        #     "type": "ColumnSet",
                        #     "spacing": "Medium",
                        #     "columns": [
                        #         {
                        #             "type": "Column",
                        #             "width": "stretch"
                        #         },
                        #         {
                        #             "type": "Column",
                        #             "width": "auto",
                        #             "items": [
                        #                 {
                        #                     "type": "ActionSet",
                        #                     "actions": [
                        #                         {
                        #                             "type": "Action.Submit",
                        #                             "title": "Download",
                        #                             # "iconUrl": "https://img.icons8.com/ios-filled/50/ffffff/download--v1.png",
                        #                             "data": {"action": "download_transcript", "transcript": output_data}
                        #                         }
                        #                     ]
                        #                 }
                        #             ]
                        #         }
                        #     ]
                        # }
                    ],
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",  #schema for cards to be displayed in teams (important to have this for the card to render properly)
                    "version": "1.4"
                })
            ]

            start_new_conversation_card_attachment =[
                Attachment(
                    content_type="application/vnd.microsoft.card.adaptive",
                    content_url=None,
                    content={
                        "type": "AdaptiveCard",
                        "actions": [
                            {
                                "type": "Action.Submit",
                                "title": "Start New Conversation",
                                # "iconUrl": "https://img.icons8.com/ios-filled/50/ffffff/plus--v1.png",
                                "data": {"action": "start_new_conversation"}
                            }
                        ],
                        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",  #schema for cards to be displayed in teams (important to have this for the card to render properly)
                        "version": "1.4"
                    }
                )
            ]

            # suggested_cards=["My Open Tickets","Create a new ticket"]
                                
            # suggested_actions_for_selected_agent = SuggestedActions(
            #     to=[ctx.activity.from_.id],
            #     actions=[CardAction(
            #         type="imBack",
            #         title=suggested_card,
            #         value=suggested_card
            #     ) for suggested_card in suggested_cards]
            # )
            

            await send_message_activity(ctx, attachments=output_data_card_attachment, suggested_actions=suggested_actions_for_selected_agent)

        return
    except Exception as e:
        logger.exception("Error handling ticket creation approval: %s", e)
        await send_message_activity(ctx, text="An error occurred while processing your request.")
        return

async def ignore_ticket_creation(ctx, value, user_data):
    try:
        session_id = value.get("session_id")
        actions_data = mydb["ActionButtonsHistory"].find_one({"session_id": session_id,"button_type":"ignore"})
        approve_action_data = mydb["ActionButtonsHistory"].find_one({"session_id": session_id,"button_type":"approve"})
        print(f"Ignore action data retrieved for session_id {session_id}: {actions_data}")
        print(f"value received: {value}")
        if not actions_data:
            logger.warning(f"No ignore action found for session_id: {session_id}")
            # await send_message_activity(ctx, text="No ignore action found for this session.")
            return
        if actions_data.get("clicked"):
            logger.info(f"Ignore action already processed for session_id: {session_id}")
            # await send_message_activity(ctx, text="This ignore action has already been processed.")
            return
        if approve_action_data and approve_action_data.get("clicked"):
            logger.info(f"Approve action already processed for session_id: {session_id}")
            await send_message_activity(ctx, text="The ticket creation has already been approved. Please let me know if you have any other issue")
            return
        if value.get("button_id") != actions_data.get("button_id"):
            logger.warning(f"Button ID mismatch for session_id: {session_id}. Expected: {actions_data.get('button_id')}, Received: {value.get('button_id')}")
            # await send_message_activity(ctx, text="Please Click the latest button to ignore the ticket creation.")
            return
        
        user_session = mydb["UserSessions"].find_one({"aad_object_id": actions_data.get("aad_object_id")})
        if user_session and user_session.get("session_id") == session_id:
            logger.info(f"User {actions_data.get('aad_object_id')} has chosen to ignore ticket creation. Starting a new session.")
            mydb["ActionButtonsHistory"].update_one({"session_id": session_id,"button_type":"ignore"}, {"$set": {"clicked": True}})
            mydb["UserSessions"].update_one({"aad_object_id": actions_data.get("aad_object_id")}, {"$set": {"session_id": uuid.uuid4().hex, "first_message": True, "session_messages_count": 0}})
            await send_message_activity(ctx, text="I am sorry that this was not helpful. Please let me know if I can help you with any other IT services-related issues.")
            return
        logger.warning(f"Session ID mismatch for user {actions_data.get('aad_object_id')}. Expected: {user_session.get('session_id') if user_session else 'None'}, Received: {session_id}")
        
    except Exception as e:
        logger.exception("Error handling ticket creation ignore: %s", e)
        await send_message_activity(ctx, text="An error occurred while processing your request.")
        return

async def handle_inactivity(ctx, value, user_data):
    try:
        incident_number = value.get("incident_number")
        sub_action = value.get("sub-action")
        logger.info(f"User {ctx.activity.from_.aad_object_id} requested more help for incident {incident_number}.")
        aad_object_id=ctx.activity.from_.aad_object_id
        user_session = mydb["UserSessions"].find_one({"aad_object_id": aad_object_id})
        if not user_session:
            logger.warning(f"No active session found for user {aad_object_id}. Cannot monitor inactivity.")
            return

        session_messages_count = user_session.get("session_messages_count", 0)
        logger.info(f"Monitoring inactivity for user {aad_object_id}. Current session message count: {session_messages_count}. Waiting for 10 minutes.")
        await asyncio.sleep(600)  # Wait for 10 minutes (600 seconds)
        user_session_after_wait = mydb["UserSessions"].find_one({"aad_object_id": aad_object_id})
        if not user_session_after_wait:
            logger.warning(f"No active session found for user {aad_object_id} after waiting. Cannot monitor inactivity.")
            return
        session_messages_count_after_wait = user_session_after_wait.get("session_messages_count", 0)
        if session_messages_count_after_wait == session_messages_count:
            logger.info(f"User {aad_object_id} has been inactive for 10 minutes for incident {incident_number}.")
            mydb["UserSessions"].update_one({"aad_object_id": aad_object_id}, {"$set": {"session_id": uuid.uuid4().hex, "first_message": True, "session_messages_count": 0}})
            # await send_message_activity(ctx, text="We haven’t heard back from you for a little while, so this session will be ending shortly. If you need any further assistance on the ticket Please join the ITCC Virtual Desk (https://teams.microsoft.com/meet/4294651712672?p=0UWFBeV8p7ieSWEXvp).")
            await send_message_activity(ctx, text="We haven’t heard back from you for a little while, so this session will be ending shortly. ")
    except Exception as e:
        logger.exception("Error handling inactivity: %s", e)
        await send_message_activity(ctx, text="An error occurred while processing your request.")
        return

async def handle_need_more_help(ctx, value, user_data):
    try:
        incident_number = value.get("incident_number")
        sub_action = value.get("sub-action")
        logger.info(f"User {ctx.activity.from_.aad_object_id} requested more help for incident {incident_number}.")
        # Here you can implement the logic to handle the "need more help" action.
        # For example, you might want to log this request, notify a support team, or provide additional resources to the user.
        await ctx.reply(TypingActivityInput())
        aad_object_id=ctx.activity.from_.aad_object_id

        user_data = await get_userdata_by_aaid(aad_object_id)
        #user_data = await get_userdata_by_aaid_cross_tenant(ctx, aad_object_id)
        if not user_data:
            user_data = await get_userdata_by_username(aad_object_id, ctx.activity.from_.name)

        user_id = user_data.get('movaio_email','test@gmail.com')

        configuration = mydb['Configurations'].find_one({})

        selected_agent_id= configuration.get("agent_id", SELECTED_AGENT_ID)

        # selected_agent_id=SELECTED_AGENT_ID
        # mydb["ActionButtonsHistory"].update_one({"session_id": session_id,"button_type":"approve"}, {"$set": {"clicked": True}})
        session_id = str(uuid.uuid4().hex)
        mydb["UserSessions"].update_one({"aad_object_id": aad_object_id}, {"$set": {"session_id": session_id, "first_message": True, "session_messages_count": 0,"session_exceeded_limit_count": 0}})
        # await send_message_activity(ctx, text="Your approval has been recorded. The ticket creation process will proceed.")
        try:
            auth_token = generate_auth_token(user_data.get('email','test@gmail.com'))

            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {auth_token}"
            }

            configuration = mydb['Configurations'].find_one({})
            need_more_help_prompt = configuration.get("need_more_help_button_prompt",f"Please provide summary for <incident_number> first , include a question at the end saying \"Is there anything you need assistance with regarding this ticket?\" and then do not ask any further questions and do not say let me retrieve instead provide a proper response ")
            need_more_help_prompt = need_more_help_prompt.replace("<incident_number>", incident_number)

            payload = {
                "user_id": user_data.get('movaio_email','test@gmail.com'),
                "agent_id": selected_agent_id,
                "session_id": session_id,
                # "userQuery": 'need more help for incident -' + incident_number
                # "userQuery": f"can you provide summary for {incident_number} and ask user for any further assistance needed regarding this incident"
                "userQuery": need_more_help_prompt
            }

            print(f"Payload for external API: {payload}, with auth token: {auth_token} , calling URL: {MOVAIO_API}/chatbotagent/chat")

            logger.info(f"Calling external API for user {user_id}, agent {selected_agent_id}, session {session_id}.")
            # 60-second read timeout (1 minute). You can tune connect/write/pool as needed.
            timeout = httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=10.0)
            limits = httpx.Limits(max_keepalive_connections=20, max_connections=100)
            async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
                # Basic call (no retries). If you enable retries, wrap this in a loop and catch Read/Connect timeouts.
                response = await client.post(
                    f"{MOVAIO_API}/chatbotagent/chat",
                    json=payload,
                    headers=headers,
                )

                # Raise for non-2xx to unify error handling
                response.raise_for_status()

                # Safely parse JSON
                try:
                    data = response.json()
                except ValueError:
                    # If server returns non-JSON (text/html), log truncated body
                    raw_text = response.text
                    data= raw_text
                    mydb['UserChatHistory'].update_one({'aad_object_id': aad_object_id},{'$push': {'chat_history': {'timestamp': datetime.utcnow(),"role":"assistant", 'message': data,"error": "Received an unexpected response from the service.", 'session_id': session_id , 'agent_id': selected_agent_id , 'user_id': user_id}},'$set': {'email': user_data.get('email',''),'aad_object_id': aad_object_id}}, upsert=True)
                    logger.error("Invalid JSON from agent (status=%s): %s", response.status_code, raw_text[:1000])
                    await send_message_activity(ctx, text="Received an unexpected response from the service.")
                    return

        except Exception as exc:
            # Catch-all
            data = str(exc)
            mydb['UserChatHistory'].update_one({'aad_object_id':aad_object_id},{'$push': {'chat_history': {'timestamp': datetime.utcnow(),"role":"assistant", 'message': "","error": str(exc), 'session_id': session_id , 'agent_id': selected_agent_id , 'user_id': user_id}},'$set': {'email': user_data.get('email',''),'aad_object_id': aad_object_id}}, upsert=True)
            logger.exception("Unexpected error calling external API: %s", exc)
            await send_message_activity(ctx, text="An unexpected error occurred while processing your request.")
            return

        
        try:
            mydb['UserChatHistory'].update_one({'aad_object_id': aad_object_id},{'$push': {'chat_history': {'timestamp': datetime.utcnow(),"role":"assistant", 'message': data, 'session_id': session_id , 'agent_id': selected_agent_id , 'user_id': user_id}},'$set': {'email': user_data.get('email',''),'aad_object_id': aad_object_id}}, upsert=True)
        except Exception as e:
            logger.exception("Error updating chat history for user %s: %s", aad_object_id, e)
            mydb['UserChatHistory'].update_one({'aad_object_id': aad_object_id},{'$push': {'chat_history': {'timestamp': datetime.utcnow(),"role":"assistant", 'message': "","error": str(e), 'session_id': session_id , 'agent_id': selected_agent_id , 'user_id': user_id}},'$set': {'email': user_data.get('email',''),'aad_object_id': aad_object_id}}, upsert=True)

        # Handle response content safely
        logger.info("Received response from external API for user %s", aad_object_id)

        # Try common response shape
        output_data = None
        if isinstance(data, dict):
            output_data = data.get("data",{}).get("response","")
        if not output_data:
            # Fallback: stringify if nothing obvious
            output_data = json.dumps(data, ensure_ascii=False)
            # output_data = "Something went wrong. Please try again later."


        if output_data:

            action_buttons = []
            suggested_actions_for_selected_agent = None

            
            # if ("We hope this recommendation helps resolve your issue" in output_data or "by selecting one of the action buttons below" in output_data):
            #     incident_number_match = re.search(r'INC\d{7}', output_data)
            #     if incident_number_match:
            #         incident_number = incident_number_match.group()
            #         print(f"Extracted incident number: {incident_number}")
            #         mydb['UserSessions'].update_one({'aad_object_id': aad_object_id},{'$set': {'session_id': uuid.uuid4().hex, 'first_message': True}})
            #         action_buttons=[
            #             {
            #                 "type": "Action.Submit",
            #                 "title": "Unresolved",
            #                 "data": {"action": "incident_resolution","sub-action": "unresolved","incident_number": incident_number, "timestamp":datetime.utcnow().isoformat()}
            #             },
            #             {   
            #                 "type": "Action.Submit",
            #                 "title": "Resolved",
            #                 "data": {"action": "incident_resolution","sub-action": "resolved","incident_number": incident_number, "timestamp":datetime.utcnow().isoformat()}
            #             }
            #         ]

            # if ("incident has been created" in output_data or "created in ServiceNow" in output_data or "has been raised" in output_data or 'your ticket has been successfully created' in output_data.lower() or "your incident ticket has been created successfully." in output_data.lower() or "your ticket has been logged successfully" in output_data.lower() or "your ticket has been created successfully" in output_data.lower() or "ticket has been created" in output_data.lower() or "ticket has been logged" in output_data.lower()):
            #     # incident_number_match = re.search(r'INC\d{7}', output_data)
            #     incident_number_match = re.search(r'INC-\d{2}-\d{2}-\d{6}', output_data)
            #     if incident_number_match and "Our team will review your request" not in output_data and "There is no automated resolution guide available" not in output_data:
            #         incident_number = incident_number_match.group()
            #         print(f"Extracted incident number: {incident_number}")
            #         # mydb['UserSessions'].update_one({'aad_object_id': aad_object_id},{'$set': {'session_id': uuid.uuid4().hex, 'first_message': True , 'session_messages_count':0}})
            #         action_buttons=[
            #             {
            #                 "type": "Action.Submit",
            #                 "title": "Escalate Ticket",
            #                 "data": {"action": "incident_resolution","sub-action": "unresolved","incident_number": incident_number, "timestamp":datetime.utcnow().isoformat()}
            #             },
            #             {   
            #                 "type": "Action.Submit",
            #                 "title": "Resolved",
            #                 "data": {"action": "incident_resolution","sub-action": "resolved","incident_number": incident_number, "timestamp":datetime.utcnow().isoformat()}
            #             },
            #             {
            #                 "type": "Action.Submit",
            #                 "title": "Need More Help",
            #                 "data": {"action": "need_more_help","sub-action": "need_more_help","incident_number": incident_number, "timestamp":datetime.utcnow().isoformat()}
            #             }
            #         ]

            #         suggested_cards=["Status of ticket","Create a new ticket"]

            #         suggested_actions_for_selected_agent = SuggestedActions(
            #             to=[ctx.activity.from_.id],
            #             actions=[CardAction(
            #                 type="imBack",
            #                 title=suggested_card,
            #                 value=suggested_card
            #             ) for suggested_card in suggested_cards]
            #         )

            # if ("check_incident_status" in output_data ):
            #     logger.info(f"User {aad_object_id} has requested to check incident status. Informing them about ServiceNow.")
            #     value = {
            #         "sn_username": user_data.get('sn_username'),
            #         "data":{
            #             "count":5
            #         }
            #     }
            #     await my_tickets2(ctx, value)
            #     return

            # if ("approve to create the ticket" in output_data):
            #     approve_button_id= str(uuid.uuid4())
            #     ignore_button_id= str(uuid.uuid4())
            #     action_buttons=[
            #         {
            #             "type": "Action.Submit",
            #             "title": "Approve",
            #             "data": {"action": "approve_ticket_creation","button_type":"approve", "timestamp":datetime.utcnow().isoformat(), "session_id": session_id, "agent_id": selected_agent_id, "user_id": user_data.get('movaio_email',''),"button_id": approve_button_id}
            #         },
            #         {   
            #             "type": "Action.Submit",
            #             "title": "Ignore",
            #             "data": {"action": "ignore_ticket_creation","button_type":"ignore", "timestamp":datetime.utcnow().isoformat(), "session_id": session_id, "agent_id": selected_agent_id, "user_id": user_data.get('movaio_email',''),"button_id": ignore_button_id}
            #         }
            #     ]

            #     mydb['ActionButtonsHistory'].update_one({'session_id':session_id,"button_type":"approve"},{'$set': {'aad_object_id': aad_object_id,"button_type":"approve", 'action': "approve_ticket_creation", 'timestamp': datetime.utcnow(), 'session_id': session_id,'clicked': False, 'agent_id': selected_agent_id, 'user_id': user_data.get('movaio_email',''), 'button_id': approve_button_id}}, upsert=True)
            #     mydb['ActionButtonsHistory'].update_one({'session_id':session_id,"button_type":"ignore"},{'$set': {'aad_object_id': aad_object_id,"button_type":"ignore", 'action': "ignore_ticket_creation", 'timestamp': datetime.utcnow(), 'session_id': session_id,'clicked': False, 'agent_id': selected_agent_id, 'user_id': user_data.get('movaio_email',''), 'button_id': ignore_button_id}}, upsert=True)

            #     # mydb['ActionButtonsHistory'].insert_one({'aad_object_id': aad_object_id, 'action': "approve_ticket_creation", 'timestamp': datetime.utcnow(), 'session_id': session_id, 'agent_id': selected_agent_id, 'user_id': user_data.get('movaio_email','')})
            #     # mydb['ActionButtonsHistory'].insert_one({'aad_object_id': aad_object_id, 'action': "reject_ticket_creation", 'timestamp': datetime.utcnow(), 'session_id': session_id, 'agent_id': selected_agent_id, 'user_id': user_data.get('movaio_email','')})


            output_data_card_attachment = [
                Attachment(
                    content_type="application/vnd.microsoft.card.adaptive",
                    content_url=None,
                    content={
                    "type": "AdaptiveCard",
                    "body": [
                        {
                            "type": "TextBlock",
                            "text": output_data,
                            "wrap": True,
                            "width": "stretch"
                        },
                        {
                            "type": "ActionSet",
                            "actions": action_buttons
                        }
                        # {
                        #     "type": "ColumnSet",
                        #     "spacing": "Medium",
                        #     "columns": [
                        #         {
                        #             "type": "Column",
                        #             "width": "stretch"
                        #         },
                        #         {
                        #             "type": "Column",
                        #             "width": "auto",
                        #             "items": [
                        #                 {
                        #                     "type": "ActionSet",
                        #                     "actions": [
                        #                         {
                        #                             "type": "Action.Submit",
                        #                             "title": "Download",
                        #                             # "iconUrl": "https://img.icons8.com/ios-filled/50/ffffff/download--v1.png",
                        #                             "data": {"action": "download_transcript", "transcript": output_data}
                        #                         }
                        #                     ]
                        #                 }
                        #             ]
                        #         }
                        #     ]
                        # }
                    ],
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",  #schema for cards to be displayed in teams (important to have this for the card to render properly)
                    "version": "1.4"
                })
            ]

            start_new_conversation_card_attachment =[
                Attachment(
                    content_type="application/vnd.microsoft.card.adaptive",
                    content_url=None,
                    content={
                        "type": "AdaptiveCard",
                        "actions": [
                            {
                                "type": "Action.Submit",
                                "title": "Start New Conversation",
                                # "iconUrl": "https://img.icons8.com/ios-filled/50/ffffff/plus--v1.png",
                                "data": {"action": "start_new_conversation"}
                            }
                        ],
                        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",  #schema for cards to be displayed in teams (important to have this for the card to render properly)
                        "version": "1.4"
                    }
                )
            ]

            await send_message_activity(ctx, attachments=output_data_card_attachment, suggested_actions=suggested_actions_for_selected_agent)
            asyncio.create_task(handle_inactivity(ctx, value, user_data))

        return
    except Exception as e:
        logger.exception("Error handling ticket creation approval: %s", e)
        await send_message_activity(ctx, text="An error occurred while processing your request.")
        return

async def handle_incident_resolution_card_update(ctx, value, user_data):
    try:
        incident_number = value.get("incident_number")
        sub_action = value.get("sub-action")
        timestamp = value.get("timestamp","")

        # use timezone-aware UTC for current time
        if timestamp:
            dt1 = datetime.now(timezone.utc)

            # normalize incoming ISO timestamps that end with 'Z' to '+00:00'
            # e.g. '2026-08-05T03:24:20.483635Z' -> '2026-08-05T03:24:20.483635+00:00'
            if isinstance(timestamp, str) and timestamp.endswith("Z"):
                timestamp = timestamp[:-1] + "+00:00"

            dt2 = datetime.fromisoformat(timestamp)
            if dt2.tzinfo is None:
                dt2 = dt2.replace(tzinfo=timezone.utc)

            diff_seconds = (dt1 - dt2).total_seconds()
            print(f"Time difference in seconds: {diff_seconds}")

        payload = {
            "number": incident_number,
            "action": sub_action
        }

        headers = {
            "X-API-Key": MOVAIO_API_KEY,
            "Content-Type": "application/json"
        }

        timeout = httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=10.0)
        limits = httpx.Limits(max_keepalive_connections=20, max_connections=100)
        async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
            response = await client.post(
                f"{MOVAIO_API}/feedback",
                json=payload,
                headers=headers
            )

            response.raise_for_status()

            try:
                data = response.json()
                logger.info(f"Incident resolution response: {data}")
                # await send_message_activity(ctx, text=data.get("message", ""))
                return {
                    "status": "success",
                    "message": data.get("message", "")
                }
            except ValueError:
                logger.error("Invalid JSON from agent (status=%s): %s", response.status_code)
                # await send_message_activity(ctx, text="")
                return {
                    "status": "error",
                    "message": "Received an unexpected response from the service."
                }
        return {
            "status": "error",
            "message": "An unexpected error occurred while processing your request."
        }
        
    except Exception as e:
        logger.exception("Error handling incident resolution: %s", e)
        return

async def typing_loop(ctx, stop_event):
    while not stop_event.is_set():
        try:
            await ctx.reply(TypingActivityInput())

            try:
                await asyncio.wait_for(
                    stop_event.wait(),
                    timeout=4
                )
            except asyncio.TimeoutError:
                pass

        except Exception as ex:
            logger.error(f"Typing indicator error: {ex}")
            break

async def send_processing_message(
    graph_client,
    chat_id: str,
    text: str
):
    request_body = ChatMessage(
        body=ItemBody(
            content=text
        )
    )

    result = await (
        graph_client
        .chats
        .by_chat_id(chat_id)
        .messages
        .post(request_body)
    )

    return result.id

async def send_progress_updates(ctx):
    activity_ids = []

    messages = [
         "🤖 Please wait while I process your request...",
        "🔍 Analyzing your query...",
        "📚 Reviewing knowledge sources...",
        "🧠 Thinking...",
        "⚙️ Preparing response..."
    ]

    for msg in messages:
        try:
            activity = await send_message_activity(ctx, text=msg)
            activity_ids.append(activity.id)

            # Wait 2-3 seconds before next update
            await asyncio.sleep(2)

        except Exception as ex:
            print(f"Failed to send progress message: {ex}")

    return activity_ids

        
async def health(request: Request):
    return JSONResponse({"status": "ok"})

@asynccontextmanager
async def lifespan(fastapi_app):
    await app.initialize()
    yield

fastapi_app = app.server.adapter.app
fastapi_app.router.lifespan_context = lifespan
fastapi_app.add_api_route("/", health, methods=["GET"])
asgi_app = fastapi_app

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(asgi_app, host="0.0.0.0", port=int(os.getenv("PORT", 5002)))