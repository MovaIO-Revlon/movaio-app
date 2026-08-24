import asyncio
import mimetypes
import re
import json
import logging
import uuid
import pypandoc
import requests
import httpx
from microsoft_teams.api import MessageActivity, TypingActivityInput, MessageActivityInput, Attachment, SuggestedActions, CardAction
from microsoft_teams.apps import ActivityContext, App
import os
from pymongo import MongoClient
from utility.send_files_output import send_file_without_consent_card, send_file_with_consent_card
from utility.aad_api import get_app_token, get_user_by_aaid

from contextlib import asynccontextmanager
from dotenv import load_dotenv
from starlette.requests import Request
from starlette.responses import JSONResponse
load_dotenv()

# Configure logging
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

# AAD Configuration
CLIENT_ID = os.getenv("CLIENT_ID", "")
CLIENT_SECRET = os.getenv("CLIENT_SECRET", "")
TENANT_ID = os.getenv("TENANT_ID", "")
AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
SCOPES = ["https://graph.microsoft.com/.default"]

# Initialize the Teams app
app = App(token= None)

async def send_message_activity(ctx: ActivityContext[MessageActivity], text="", attachments=None, suggested_actions=None) -> None:
    """Send a message activity with optional text, attachments, and suggested actions."""
    try:
        await ctx.send(MessageActivityInput(
            text=text,
            attachments=attachments,
            suggested_actions=suggested_actions
        ))
    except Exception as e:
        logger.error(f"Failed to send message activity: {e}")
        raise

async def handle_value_for_action_cards(ctx: ActivityContext[MessageActivity], value) -> None:
    """Handle actions from adaptive cards."""
    try:
        if value.get("action") == "start_new_conversation":
            aad_object_id = ctx.activity.from_.aad_object_id
            logger.info(f"User {aad_object_id} requested to start a new conversation.")

            mydb['UserSessions'].update_one(
                {'aad_object_id': aad_object_id},
                {'$set': {'session_id': uuid.uuid4().hex}}
            )
            await send_agent_cards_by_aaid(ctx.activity.from_.aad_object_id, ctx)
            return

        if value.get("action") == "download_transcript":
            logger.info(f"User {ctx.activity.from_.aad_object_id} requested to download transcript.")
            transcript = value.get("transcript", "No transcript available.")
            await send_file_without_consent_card(ctx, transcript)
            return

        if value.get("action") == "select_agent":
            aad_object_id = ctx.activity.from_.aad_object_id
            selected_agent_id = value.get("agent_id")
            selected_agent_name = value.get("agent_name")
            logger.info(f"User {aad_object_id} selected agent {selected_agent_name} ({selected_agent_id}).")

            suggested_actions_for_selected_agent = SuggestedActions(
                to=[ctx.activity.from_.id],
                actions=[
                    CardAction(
                        type="imBack",
                        title=suggested_cards,
                        value=suggested_cards
                    ) for suggested_cards in value.get("suggested_actions", [])
                ]
            )

            await send_message_activity(
                ctx, 
                text=f"You have selected {selected_agent_name}. How can I assist you further?", 
                suggested_actions=suggested_actions_for_selected_agent
            )
            
            mydb['UserSessions'].update_one(
                {'aad_object_id': aad_object_id},
                {'$set': {'selected_agent_id': selected_agent_id, 'session_id': uuid.uuid4().hex}}, 
                upsert=True
            )
            return

    except Exception as e:
        logger.error(f"Error handling action card: {e}")
        await send_message_activity(ctx, text="An error occurred while processing your request.")

async def send_agent_cards_by_aaid(aad_id, ctx): 
    try:
        agents = list(mydb['Agents'].find({"enabled": True}))
        if not agents:
            await send_message_activity(ctx, text="No agents are currently available.")
            return

        actions = [
            {
                "type": "Action.Submit", 
                "title": agent["agent_name"], 
                "data": {
                    "action": "select_agent", 
                    "agent_id": agent["agent_id"], 
                    "agent_name": agent["agent_name"], 
                    "suggested_actions": agent.get("suggested_actions", [])
                }
            } for agent in agents
        ]
        
        logger.info(f'Found {len(agents)} agents, created {len(actions)} actions')
        
        attachments = [
            Attachment(
                content_type="application/vnd.microsoft.card.adaptive",
                content_url=None,
                content={
                    "type": "AdaptiveCard",
                    "body": [
                        {
                            "type": "TextBlock",
                            "text": "Select an agent from the options below:",
                            "wrap": True
                        }
                    ],
                    "actions": actions,
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "version": "1.5"
                }
            )
        ]
        
        await send_message_activity(ctx, attachments=attachments)
        
    except Exception as e:
        logger.error(f"Error sending agent cards: {e}")
        await send_message_activity(ctx, text="Unable to load available agents at this time.")

@app.on_message_pattern(re.compile(r"hello|hi|greetings", re.IGNORECASE))
async def handle_greeting(ctx: ActivityContext[MessageActivity]) -> None:
    """Handle greeting messages."""
    logger.info(f'Handling greeting from user: {ctx.activity.from_.aad_object_id}')
    
    try:
        await ctx.reply(TypingActivityInput())
        await send_message_activity(ctx, text="Hello! How can I assist you today?")
        await send_agent_cards_by_aaid(ctx.activity.from_.aad_object_id, ctx)
    except Exception as e:
        logger.error(f"Error in greeting handler: {e}")
        await send_message_activity(ctx, text="Hello! I'm experiencing some technical difficulties.")

@app.on_message
async def handle_message(ctx: ActivityContext[MessageActivity]):
    """Handle message activities."""
    try:
        await ctx.reply(TypingActivityInput())
        aad_object_id = ctx.activity.from_.aad_object_id

        # Handle action cards
        value = ctx.activity.value
        if value:
            await handle_value_for_action_cards(ctx, value)
            return

        # Retrieve or create session
        session_data = mydb['UserSessions'].find_one({'aad_object_id': aad_object_id})
        if session_data:
            session_id = session_data['session_id']
            selected_agent_id = session_data.get('selected_agent_id')
        else:
            session_id = uuid.uuid4().hex
            default_agent = mydb['Agents'].find_one({"enabled": True})
            if not default_agent:
                await send_message_activity(ctx, text="No agents are available. Please contact support.")
                return
            selected_agent_id = default_agent['agent_id']
            mydb['UserSessions'].insert_one({
                'aad_object_id': aad_object_id, 
                'session_id': session_id,
                'selected_agent_id': selected_agent_id
            })

        text = (ctx.activity.text or "").strip()

        # Call agent API
        agent_data = mydb['Agents'].find_one({'agent_id': selected_agent_id})
        if not agent_data:
            await send_message_activity(ctx, text="Selected agent not found. Please select a valid agent.")
            return

        api_key = agent_data.get('agent_secret_key')
        headers = {
            "x-api-key": api_key,
            "Content-Type": "application/json",
        }

        payload = {
            "user_id": aad_object_id,
            "agent_id": selected_agent_id,
            "session_id": session_id,
            "message": text,
        }

        logger.info(f"Calling external API for user {aad_object_id}, agent {selected_agent_id}")
        
        timeout = httpx.Timeout(connect=10.0, read=60.0, write=30.0, pool=10.0)
        limits = httpx.Limits(max_keepalive_connections=20, max_connections=100)
        
        async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
            response = await client.post(
                "https://agent-prod.studio.lyzr.ai/v3/inference/chat/",
                json=payload,
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()

        logger.info("Received response from external API")

        # Process response
        output_data = None
        if isinstance(data, dict):
            output_data = data.get("response") or data.get("message") or data.get("data")
        if not output_data:
            output_data = json.dumps(data, ensure_ascii=False)

        if output_data:
            # Create response cards
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
                                "type": "ColumnSet",
                                "spacing": "Medium",
                                "columns": [
                                    {
                                        "type": "Column",
                                        "width": "stretch"
                                    },
                                    {
                                        "type": "Column",
                                        "width": "auto",
                                        "items": [
                                            {
                                                "type": "ActionSet",
                                                "actions": [
                                                    {
                                                        "type": "Action.Submit",
                                                        "title": "Download",
                                                        "data": {
                                                            "action": "download_transcript", 
                                                            "transcript": output_data
                                                        }
                                                    }
                                                ]
                                            }
                                        ]
                                    }
                                ]
                            }
                        ],
                        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                        "version": "1.4"
                    }
                )
            ]

            start_new_conversation_card_attachment = [
                Attachment(
                    content_type="application/vnd.microsoft.card.adaptive",
                    content_url=None,
                    content={
                        "type": "AdaptiveCard",
                        "actions": [
                            {
                                "type": "Action.Submit",
                                "title": "Start New Conversation",
                                "data": {"action": "start_new_conversation"}
                            }
                        ],
                        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                        "version": "1.4"
                    }
                )
            ]

            await send_message_activity(ctx, attachments=output_data_card_attachment)
            await send_message_activity(ctx, attachments=start_new_conversation_card_attachment)
        else:
            await send_message_activity(ctx, text="The service returned an empty response.")

    except httpx.TimeoutException:
        logger.error("Timeout calling external API")
        await send_message_activity(ctx, text="The request timed out. Please try again.")
    except httpx.RequestError as e:
        logger.error(f"Request error: {e}")
        await send_message_activity(ctx, text="Unable to connect to the service. Please try again later.")
    except Exception as e:
        logger.exception(f"Unexpected error: {e}")
        await send_message_activity(ctx, text="An unexpected error occurred. Please try again.")

@app.on_file_consent
async def handle_file_consent(ctx):
    """Handle file consent responses."""
    try:
        consent_response = ctx.activity.value
        if consent_response.action == "accept":
            upload_info = consent_response.upload_info
            upload_url = upload_info.upload_url
            file_name = upload_info.name
            local_file_path = f'temp/{file_name}'

            if not os.path.exists(local_file_path):
                await send_message_activity(ctx, text="File not found for upload.")
                return

            with open(local_file_path, 'rb') as f:
                file_data = f.read()

            headers = {
                'Content-Range': f'bytes 0-{len(file_data)-1}/{len(file_data)}'
            }

            async with httpx.AsyncClient() as client:
                response = await client.put(upload_url, headers=headers, content=file_data)
                if response.status_code in (200, 201):
                    attachments = [
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
    
    except Exception as e:
        logger.error(f"Error in file consent handler: {e}")
        await send_message_activity(ctx, text="An error occurred during file processing.")

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
