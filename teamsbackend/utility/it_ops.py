
import token

from microsoft_teams.api import MessageActivity, TypingActivityInput, MessageActivityInput , Attachment , SuggestedActions , CardAction
from microsoft_teams.apps import ActivityContext

from dotenv import load_dotenv
import os
import logging
import asyncio
import httpx

from pymongo import MongoClient
from bson.objectid import ObjectId 
from utility.aad_api import get_user_by_aaid
from utility.send_activity import send_message_activity
from utility.database_manager import mydb
from datetime import datetime, timedelta, timezone

load_dotenv()

# client = MongoClient(os.getenv("DB_URL", "mongodb://localhost:27017/"))
# mydb = client[os.getenv("DB_NAME", "TATwin")]

logger = logging.getLogger("it_ops")
logger.setLevel(logging.INFO)

ITOPS_API=os.getenv("ITOPS_API", "http://20.121.64.98:9000")
MOVAIO_API=os.getenv("MOVAIO_API", "")
MOVAIO_API_KEY=os.getenv("MOVAIO_API_KEY", "")

async def get_userdata_by_aaid(aad_id):
    try:
        user = mydb['UserSessions'].find_one({'aad_object_id': aad_id})
        if user and 'email' in user:
            email = user['email']
        elif user and 'email' not in user:
            aad_user = get_user_by_aaid(aad_id)
            email = aad_user.get('mail') or aad_user.get('userPrincipalName')
            mydb['UserSessions'].update_one({'aad_object_id': aad_id},{'$set': {'email': email}}, upsert=True)
        else:
            aad_user = get_user_by_aaid(aad_id)
            email = aad_user.get('mail') or aad_user.get('userPrincipalName')
            mydb['UserSessions'].insert_one({'aad_object_id': aad_id, 'email': email, 'selected_agent_id':None})
        userdata = mydb['Users'].find_one({'email': email.lower()})
        return userdata
    except Exception as e:
        logger.exception("Error retrieving user email by AAID: %s", e)
        return None

async def send_agent_cards_by_aaid(aad_id, ctx):
    try:
        user_data = await get_userdata_by_aaid(aad_id)
        if not user_data:
            await send_message_activity(ctx, text="Sorry, I couldn't retrieve your user information. Please ensure your account is properly set up and try again.")
            return
        email = user_data.get('email') if user_data else None

        # user_data= mydb['UserManagement'].find_one({'Email': email.lower()})
        # # print('user_data:', user_data)
        # active_project = user_data.get('ActiveProject') if user_data else None
        # # print('active_project:', active_project)
        # agency = mydb['agency_collection'].find_one({'assigned_to': active_project}) if active_project else None
        # # print('agency:', agency)
        # agency_id= agency.get('agency_id') if agency else None
        # # print('agency_id:', agency_id)
        # agents = mydb['AgencyAgentMappingCollection'].find({'agency_id': agency_id}) if agency_id else []
        # # print('agents:', agents)
        # actions = [{"type": "Action.Submit", "title": agent["agent_name"], "data": {"action": "select_agent", "agent_id": agent["agent_id"], "agent_name": agent["agent_name"] , "suggested_actions":agent.get("suggested_actions", [])}} for agent in agents]
        # # if len(actions) == 0:
        # #     await send_message_activity(ctx, text="No agents are available for your project. Please contact the administrator.")
        # #     return

        persona = user_data.get('persona') if user_data else None
        sn_username = user_data.get('sn_username') if user_data else None

        persona_data = mydb['Persona'].find_one({'_id': ObjectId(persona)})

        # await send_message_activity(ctx, text=persona_data.get('title', "Welcome! Please select an agent from the options below:"))
        
        agents = mydb['Agents'].find({"persona": persona, "enabled": True},{"_id":0})
        actions= []
        for agent in agents:
            actions.append({
                "type": "Action.Submit", 
                "title": agent["agent_name"], 
                "data": {**agent, "action": "select_agent", "sn_username": sn_username}
            })
        # print('actions:', actions)
        # actions = [{"type": "Action.Submit", "title": agent["agent_name"], "data": {"action": "select_agent", "agent_id": agent["agent_id"], "agent_name": agent["agent_name"] , "suggested_actions":agent["suggested_actions"]}} for agent in agents]

        attachments = [
            Attachment(
                content_type="application/vnd.microsoft.card.adaptive",
                content_url=None,
                content={
                    "type": "AdaptiveCard",
                    "body": [
                        {
                            "type": "TextBlock",
                            "text": persona_data.get('title', "Welcome! Please select an agent from the options below:"),
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
        

# async def send_message_activity(ctx: ActivityContext[MessageActivity], text="" , attachments=None ,suggested_actions=None) -> None:
#     """
#     Send a message activity with optional text, attachments, and suggested actions.
#     args:
#         ctx (ActivityContext[MessageActivity]): The activity context.
#         text (str): The text message to send.
#         attachments (list, optional): List of attachments to include in the message.
#         suggested_actions (SuggestedActions, optional): Suggested actions to include in the message.
#     """
#     await ctx.send(MessageActivityInput(
#         text=text, 
#         attachments=attachments, 
#         suggested_actions=suggested_actions
#     ))
#     return 

async def create_incident(ctx,value):
    try:
        short_description = value.get('data').get("short_description", "")
        description = value.get('data').get("description", "")
        caller_name = value.get("sn_username", "")
        
        # Log the incident details
        logger.info(f"Incident Created:")
        logger.info(f"  Short Description: {short_description}")
        logger.info(f"  Description: {description}")
        logger.info(f"  Caller Name: {caller_name}")
        

        payload = {
            "caller_name": caller_name,
            "description": description,
            "short_description": short_description
        }

        logger.info(f"Calling external API for incident creation with payload: {payload}")
        # 60-second read timeout (1 minute). You can tune connect/write/pool as needed.
        timeout = httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=10.0)
        limits = httpx.Limits(max_keepalive_connections=20, max_connections=100)
        async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
            # Basic call (no retries). If you enable retries, wrap this in a loop and catch Read/Connect timeouts.
            response = await client.post(
                f"{ITOPS_API}/demo/create",
                json=payload
            )

            # Raise for non-2xx to unify error handling
            response.raise_for_status()

            # Safely parse JSON
            try:
                data = response.json()
                logger.info(f"Received response from incident API: {data}")
                sys_id = data.get("sys_id")
                incident_number = data.get("number")
                incident_card = [Attachment(
                    content_type="application/vnd.microsoft.card.adaptive",
                    content_url=None,
                    content={
                        "type": "AdaptiveCard",
                        "body": [
                            {
                                "type": "TextBlock",
                                "text": f"Incident Created",
                                "weight": "bolder",
                                "size": "large"
                            },
                            {
                                "type": "TextBlock",
                                "text": f"{incident_number} created in ServiceNow",
                                "spacing": "medium"
                            }
                        ],
                        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                        "version": "1.5"
                    }
                )]
                await send_message_activity(ctx, attachments=incident_card)
            except ValueError:
                # If server returns non-JSON (text/html), log truncated body
                raw_text = response.text
                logger.error("Invalid JSON from agent (status=%s): %s", response.status_code, raw_text[:1000])
                await send_message_activity(ctx, text="Received an unexpected response from the service.")
                return
            incident_status = 'In Progress'
            triage_status = 'In Progress'
            timeout_counter=0
            while incident_status != 'Completed' and timeout_counter<60:
                # Simulate checking incident status (replace with actual API call)
                await asyncio.sleep(10)  # Wait for 5 seconds before checking again
                timeout_counter+=1


                logger.info(f"Calling external API for incident status: {ITOPS_API}/demo/status/{sys_id}")
                # Basic call (no retries). If you enable retries, wrap this in a loop and catch Read/Connect timeouts.
                response = await client.get(
                    f"{ITOPS_API}/demo/status/{sys_id}"
                )

                # Raise for non-2xx to unify error handling
                response.raise_for_status()

                # Safely parse JSON
                try:
                    data = response.json()
                    logger.info(f"Received response from Status API: {data}")
                    if data.get("stage") in ['resolved', 'no_sop_found', 'manual_resolution', 'exec_failed']:
                        incident_status = 'Completed'
                        sop_content = data.get("sop_content", "No SOP Found.")
                        assignment_group = data.get("assignment_group", "Unknown")
                        output_message_step_3=f"No matching SOP — {assignment_group} assigned for investigation" if data.get("stage")=='no_sop_found' else f"Manual SOP steps posted —  {assignment_group} notified" if data.get("stage")=='manual_resolution' else f"SOP executed successfully — {assignment_group} notified" if data.get("stage")=='resolved' else f"Script is running — {assignment_group} notified" if data.get("stage")=='script_running' else f"SOP execution failed — {assignment_group} notified"
                        resolution_card = [
                            Attachment(
                            content_type="application/vnd.microsoft.card.adaptive",
                            content_url=None,
                            content={
                                "type": "AdaptiveCard",
                                "body": [
                                    {
                                        "type": "TextBlock",
                                        "text": f"Resolution Path",
                                        "weight": "bolder",
                                        "size": "large"
                                    },
                                    {
                                        "type": "TextBlock",
                                        "text": output_message_step_3,
                                        "spacing": "medium"
                                    }
                                ],
                                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                                "version": "1.5"
                            }
                        ),
                        Attachment(
                            content_type="application/vnd.microsoft.card.adaptive",
                            content_url=None,
                            content={
                                "type": "AdaptiveCard",
                                "body": [
                                    {
                                        "type": "TextBlock",
                                        "text": f"Summary",
                                        "weight": "bolder",
                                        "size": "large"
                                    },
                                    {
                                        "type": "TextBlock",
                                        "text": f"Incident : {incident_number}",
                                        "spacing": "small"
                                    },
                                    {
                                        "type": "TextBlock",
                                        "text": f"Category : {category} / {subcategory}",
                                        "spacing": "small"
                                    },
                                    {
                                        "type": "TextBlock",
                                        "text": f"Priority : {priority}",
                                        "spacing": "small"
                                    },
                                    {
                                        "type": "TextBlock",
                                        "text": f"Assigned to : {assignment_group}",
                                        "spacing": "small"
                                    },
                                    {
                                        "type": "TextBlock",
                                        "text": f"Resolution : {'Routed — Manual SOP' if data.get('stage')=='manual_resolution' else 'SOP Not Found' if data.get('stage')=='no_sop_found' else 'Resolved' if data.get('stage')=='resolved' else 'Script Running' if data.get('stage')=='script_running' else 'Execution Failed' }",
                                        "spacing": "small"
                                    }
                                    
                                ],
                                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                                "version": "1.5"
                            }
                        )
                        ]
                        if sop_content:
                            resolution_card.append(Attachment(
                                content_type="application/vnd.microsoft.card.adaptive",
                                content_url=None,
                                content={
                                    "type": "AdaptiveCard",
                                    "body": [
                                        {
                                            "type": "TextBlock",
                                            "text": f"Manual SOP — Resolution Steps",
                                            "weight": "bolder",
                                            "size": "large",
                                            "wrap":True
                                        },
                                        {
                                            "type": "TextBlock",
                                            "text": f"{sop_content}",
                                            "spacing": "small",
                                            "wrap":True
                                        }
                                    ],
                                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                                    "version": "1.5"
                                }
                            ))
                        await send_message_activity(ctx, attachments=resolution_card)
                        # if sop_content:
                        #     await send_message_activity(ctx, text=f"Manual SOP — Resolution Steps \n\n{sop_content}")
                        await send_agent_cards_by_aaid(ctx.activity.from_.aad_object_id, ctx)
                    elif data.get("stage")=="triage_complete" and triage_status != 'Completed':
                        triage_status = 'Completed'
                        category = data.get("category")
                        subcategory = data.get("subcategory")
                        priority = data.get("priority")
                        assignment_group = data.get("assignment_group")
                        triage_card = [Attachment(
                            content_type="application/vnd.microsoft.card.adaptive",
                            content_url=None,
                            content={
                                "type": "AdaptiveCard",
                                "body": [
                                    {
                                        "type": "TextBlock",
                                        "text": f"Ingestion & Triage",
                                        "weight": "bolder",
                                        "size": "large"
                                    },
                                    {
                                        "type": "TextBlock",
                                        "text": f"{category} / {subcategory} - {priority} - {assignment_group}",
                                        "spacing": "medium"
                                    }
                                ],
                                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                                "version": "1.5"
                            }
                        )]
                        await send_message_activity(ctx, attachments=triage_card)
                    else:
                        logger.info(f"Incident {incident_number} is still in progress...")
                        # await send_message_activity(ctx, text=f"Incident {incident_number} is still in progress...{data}")
                except ValueError:
                    # If server returns non-JSON (text/html), log truncated body
                    raw_text = response.text
                    logger.error("Invalid JSON from agent (status=%s): %s", response.status_code, raw_text[:1000])
                    await send_message_activity(ctx, text="Received an unexpected response from the service.")
                    return
    except Exception as e:
        logger.error(f"An error occurred while requesting {e.request.url!r}: {str(e)}")
        await send_message_activity(ctx, text="Failed to connect to the incident management service.")

async def create_incident2(ctx,incident_number):
    try:
        timeout = httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=10.0)
        limits = httpx.Limits(max_keepalive_connections=20, max_connections=100)
        async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
            incident_status = 'In Progress'
            triage_status = 'In Progress'
            timeout_counter=0
            while incident_status != 'Completed' and timeout_counter<60:
                # Simulate checking incident status (replace with actual API call)
                await asyncio.sleep(10)  # Wait for 5 seconds before checking again
                timeout_counter+=1


                logger.info(f"Calling external API for incident status: {ITOPS_API}/servicenow/v2/status-by-number/{incident_number}")
                # Basic call (no retries). If you enable retries, wrap this in a loop and catch Read/Connect timeouts.
                response = await client.get(
                    f"{ITOPS_API}/servicenow/v2/status-by-number/{incident_number}"
                )

                # Raise for non-2xx to unify error handling
                response.raise_for_status()

                # Safely parse JSON
                try:
                    data = response.json()
                    logger.info(f"Received response from Status API: {data}")
                    if data.get("stage") in ['resolved', 'no_sop_found', 'manual_resolution', 'exec_failed']:
                        incident_status = 'Completed'
                        sop_content = data.get("sop_content", "No SOP Found.")
                        assignment_group = data.get("assignment_group", "Unknown")
                        output_message_step_3=f"No matching SOP — {assignment_group} assigned for investigation" if data.get("stage")=='no_sop_found' else f"Manual SOP steps posted —  {assignment_group} notified" if data.get("stage")=='manual_resolution' else f"SOP executed successfully — {assignment_group} notified" if data.get("stage")=='resolved' else f"Script is running — {assignment_group} notified" if data.get("stage")=='script_running' else f"SOP execution failed — {assignment_group} notified"
                        resolution_card=[]
                        # resolution_card = [
                        #     Attachment(
                        #     content_type="application/vnd.microsoft.card.adaptive",
                        #     content_url=None,
                        #     content={
                        #         "type": "AdaptiveCard",
                        #         "body": [
                        #             {
                        #                 "type": "TextBlock",
                        #                 "text": f"Resolution Path",
                        #                 "weight": "bolder",
                        #                 "size": "large"
                        #             },
                        #             {
                        #                 "type": "TextBlock",
                        #                 "text": output_message_step_3,
                        #                 "spacing": "medium"
                        #             }
                        #         ],
                        #         "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                        #         "version": "1.5"
                        #     }
                        # ),
                        # Attachment(
                        #     content_type="application/vnd.microsoft.card.adaptive",
                        #     content_url=None,
                        #     content={
                        #         "type": "AdaptiveCard",
                        #         "body": [
                        #             {
                        #                 "type": "TextBlock",
                        #                 "text": f"Summary",
                        #                 "weight": "bolder",
                        #                 "size": "large"
                        #             },
                        #             {
                        #                 "type": "TextBlock",
                        #                 "text": f"Incident : {incident_number}",
                        #                 "spacing": "small"
                        #             },
                        #             {
                        #                 "type": "TextBlock",
                        #                 "text": f"Category : {category} / {subcategory}",
                        #                 "spacing": "small"
                        #             },
                        #             {
                        #                 "type": "TextBlock",
                        #                 "text": f"Priority : {priority}",
                        #                 "spacing": "small"
                        #             },
                        #             {
                        #                 "type": "TextBlock",
                        #                 "text": f"Assigned to : {assignment_group}",
                        #                 "spacing": "small"
                        #             },
                        #             {
                        #                 "type": "TextBlock",
                        #                 "text": f"Resolution : {'Routed — Manual SOP' if data.get('stage')=='manual_resolution' else 'SOP Not Found' if data.get('stage')=='no_sop_found' else 'Resolved' if data.get('stage')=='resolved' else 'Script Running' if data.get('stage')=='script_running' else 'Execution Failed' }",
                        #                 "spacing": "small"
                        #             }
                                    
                        #         ],
                        #         "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                        #         "version": "1.5"
                        #     }
                        # )
                        # ]
                        if sop_content:
                            resolution_card.append(Attachment(
                                content_type="application/vnd.microsoft.card.adaptive",
                                content_url=None,
                                content={
                                    "type": "AdaptiveCard",
                                    "body": [
                                        {
                                            "type": "TextBlock",
                                            "text": f"SOP — Resolution Steps for {incident_number}",
                                            "weight": "bolder",
                                            "size": "large",
                                            "wrap":True
                                        },
                                        {
                                            "type": "TextBlock",
                                            "text": f"{sop_content}",
                                            "spacing": "small",
                                            "wrap":True
                                        }
                                    ],
                                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                                    "version": "1.5"
                                }
                            ))

                        # new_text = f"##Manual SOP — Resolution Steps for {incident_number}\n\n{sop_content}"
                            await send_message_activity(ctx, attachments=resolution_card)
                            # await send_message_activity(ctx, text=f"Manual SOP — Resolution Steps for {incident_number}\n\n{sop_content}")

                            # resolution_confirmation_card = [Attachment(
                            # content_type="application/vnd.microsoft.card.adaptive",
                            # content_url=None,
                            # content={
                            #     "type": "AdaptiveCard",
                            #     "body": [
                            #     {
                            #         "type": "TextBlock",
                            #         "text": "Take your time, let me know if this resolves your ticket ?",
                            #         "wrap": True
                            #     }
                            # ],
                            # "actions": [
                            #     {
                            #         "type": "Action.Submit",
                            #         "title": "Yes",
                            #         "data": {
                            #             "action": "select_agent",
                            #             "type":"incident_resolved",
                            #             # "sys_id": sys_id,
                            #             "incident_number": incident_number
                            #         }
                            #     },
                            #     {
                            #         "type": "Action.Submit",
                            #         "title": "No",
                            #         "data": {
                            #             "action": "select_agent",
                            #             "type":"incident_not_resolved",
                            #             # "sys_id": sys_id,
                            #             "incident_number": incident_number
                            #         }
                            #     }
                            # ],
                            # "$schema": "http://adaptivecards.io/schemas/adaptive-card.json", #schema for cards to be displayed in teams (important to have this for the card to render properly)
                            # "version": "1.5"
                            # }
                            # )]
                            # await send_message_activity(ctx, attachments=resolution_confirmation_card)
                        # await send_message_activity(ctx, text=new_text)
                        # if sop_content:
                        #     await send_message_activity(ctx, text=f"Manual SOP — Resolution Steps \n\n{sop_content}")
                        # await send_agent_cards_by_aaid(ctx.activity.from_.aad_object_id, ctx)
                    elif data.get("stage")=="triage_complete" and triage_status != 'Completed':
                        triage_status= 'Completed'
                        await send_message_activity(ctx, text=f"Incident {incident_number} has been triaged. Please wait while we find a resolution...")
                        # triage_status = 'Completed'
                        # category = data.get("category")
                        # subcategory = data.get("subcategory")
                        # priority = data.get("priority")
                        # assignment_group = data.get("assignment_group")
                        # triage_card = [Attachment(
                        #     content_type="application/vnd.microsoft.card.adaptive",
                        #     content_url=None,
                        #     content={
                        #         "type": "AdaptiveCard",
                        #         "body": [
                        #             {
                        #                 "type": "TextBlock",
                        #                 "text": f"Ingestion & Triage",
                        #                 "weight": "bolder",
                        #                 "size": "large"
                        #             },
                        #             {
                        #                 "type": "TextBlock",
                        #                 "text": f"{category} / {subcategory} - {priority} - {assignment_group}",
                        #                 "spacing": "medium"
                        #             }
                        #         ],
                        #         "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                        #         "version": "1.5"
                        #     }
                        # )]
                        # await send_message_activity(ctx, attachments=triage_card)
                    else:
                        logger.info(f"Incident {incident_number} is still in progress...")
                        # await send_message_activity(ctx, text=f"Incident {incident_number} is still in progress...{data}")
                except ValueError:
                    # If server returns non-JSON (text/html), log truncated body
                    raw_text = response.text
                    logger.error("Invalid JSON from agent (status=%s): %s", response.status_code, raw_text[:1000])
                    await send_message_activity(ctx, text="Received an unexpected response from the service.")
                    return
    except Exception as e:
        logger.error(f"An error occurred while requesting {e.request.url!r}: {str(e)}")
        await send_message_activity(ctx, text="Failed to connect to the incident management service.")


async def fill_disk(ctx,value):
    try:
        VM_NAME = value.get('data').get("vm_name", "")
        RESOURCE_GROUP = value.get('data').get("resource_group", "")
        payload = {
            "vm_name": VM_NAME,
            "resource_group": RESOURCE_GROUP
            }

        logger.info(f"Calling external API for incident creation with payload: {payload}")
        # 60-second read timeout (1 minute). You can tune connect/write/pool as needed.
        timeout = httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=10.0)
        limits = httpx.Limits(max_keepalive_connections=20, max_connections=100)
        async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
            # Basic call (no retries). If you enable retries, wrap this in a loop and catch Read/Connect timeouts.
            response = await client.post(
                f"{ITOPS_API}/test/disk_cleanup/fill",
                json=payload
            )

            # Raise for non-2xx to unify error handling
            response.raise_for_status()

            # Safely parse JSON
            try:
                data = response.json()
                operation_id = data.get("operation_id")
                logger.info(f"Disk fill operation started with operation_id: {operation_id}")
                await send_message_activity(ctx, text="Filling up the disk... Please wait.")
            except ValueError:
                # If server returns non-JSON (text/html), log truncated body
                logger.error("Invalid JSON from agent (status=%s): %s", response.status_code)
                await send_message_activity(ctx, text="Received an unexpected response from the service.")
                return
            
            while True:
                # Simulate checking operation status (replace with actual API call)
                await asyncio.sleep(15)  # Wait for 5 seconds before checking again

                logger.info(f"Checking disk fill status for operation_id: {operation_id}")
                response = await client.get(
                    f"{ITOPS_API}/test/disk_cleanup/fill/status/{operation_id}"
                )

                # Raise for non-2xx to unify error handling
                response.raise_for_status()

                try:
                    data = response.json()
                    status = data.get("status")
                    logger.info(f"Disk fill status: {status}")
                    if status == 'running':
                        logger.info(f"Disk fill operation is still running...{data}")
                        # await send_message_activity(ctx, text="Disk fill operation is still running... Please wait.")
                    elif status == 'succeeded':
                        logger.info("Disk fill operation completed successfully.")
                        success_card = [Attachment(
                            content_type="application/vnd.microsoft.card.adaptive",
                            content_url=None,
                            content={
                                "type": "AdaptiveCard",
                                "body": [
                                    {
                                        "type": "TextBlock",
                                        "text": f"Disk filled on VM: {VM_NAME}",
                                        "weight": "bolder",
                                        "size": "large"
                                    },
                                    {
                                        "type": "TextBlock",
                                        "text": f"~1.5 GB of junk files created in C:\\Windows\\Temp.\n\n",
                                        "spacing": "medium"
                                    }
                                ],
                                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                                "version": "1.5"
                            }
                        )]
                        await send_message_activity(ctx, attachments=success_card)
                        await send_agent_cards_by_aaid(ctx.activity.from_.aad_object_id, ctx)
                        # await send_message_activity(ctx, text="Disk fill operation completed successfully.")
                        break
                    elif status == 'failed':
                        logger.error("Disk fill operation failed.")
                        await send_message_activity(ctx, text="Disk fill operation failed.")
                        break
                    else:
                        logger.info(f"Unexpected status '{status}' for disk fill operation.")
                        break
                except ValueError:
                    logger.error("Invalid JSON from agent (status=%s): %s", response.status_code)
                    await send_message_activity(ctx, text="Received an unexpected response from the service.")
                    return
    except Exception as e:
        logger.exception("Error during fill_disk operation: %s", e)
        await send_message_activity(ctx, text="An error occurred while filling the disk.")

async def my_tickets(ctx, value):
    try:
        sn_username = value.get("sn_username", "")
        count = value.get('data').get("count", 5)
        payload = {
            "caller ": sn_username,
            "count": count
        }
        logger.info(f"Calling external API to retrieve tickets with payload: {payload}")
        timeout = httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=10.0)
        limits = httpx.Limits(max_keepalive_connections=20, max_connections=100)
        async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
            response = await client.get(
                f"{ITOPS_API}/servicenow/my-tickets?caller={sn_username}&count={count}"
            )

            response.raise_for_status()

            try:
                data = response.json()
                tickets = data.get("tickets", [])
                if not tickets:
                    await send_message_activity(ctx, text="No tickets found for your username.")
                    return

                # body=[
                #     {
                #         "type": "TextBlock",
                #         "text":f"Incident Number: {ticket.get('number')}\nCategory: {ticket.get('category')}\nSub Category: {ticket.get('subcategory')}\nState: {ticket.get('state')}\nPriority: {ticket.get('priority')}\nAssignment Group: {ticket.get('assignment_group')}\nAssigned To: {ticket.get('assigned_to')}",
                #     } for ticket in tickets
                # ]
                body = []
                for ticket in tickets:
                    body.extend([
                        {
                            "type": "TextBlock",
                            "text": f"Incident Number: {ticket.get('number')}",
                            "weight": "bolder"
                        },
                        {
                            "type": "TextBlock",
                            "text": f"Category: {ticket.get('category')}"
                        },
                        {
                            "type": "TextBlock",
                            "text": f"Sub Category: {ticket.get('subcategory')}"
                        },
                        {
                            "type": "TextBlock",
                            "text": f"State: {ticket.get('state')}"
                        },
                        {
                            "type": "TextBlock",
                            "text": f"Priority: {ticket.get('priority')}"
                        },
                        {
                            "type": "TextBlock",
                            "text": f"Assignment Group: {ticket.get('assignment_group')}"
                        },
                        {
                            "type": "TextBlock",
                            "text": f"Assigned To: {ticket.get('assigned_to')}"
                        },
                        {
                            "type": "TextBlock",
                            "text": f"---"
                        }
                    ])
                
                card = Attachment(
                    content_type="application/vnd.microsoft.card.adaptive",
                    content_url=None,
                    content={
                        "type": "AdaptiveCard",
                        "body": [
                            {
                                "type": "TextBlock",
                                "text": f"Here are your list of incidents",
                                "weight": "bolder",
                                "size": "large"
                            }
                        ]+body,
                        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                        "version": "1.5"
                    }
                )
                
                await send_message_activity(ctx, attachments=[card])
                await send_agent_cards_by_aaid(ctx.activity.from_.aad_object_id, ctx)
            except ValueError:
                logger.error("Invalid JSON from agent (status=%s): %s", response.status_code)
                await send_message_activity(ctx, text="Received an unexpected response from the service.")
                return
    except Exception as e:
        logger.exception("Error retrieving tickets: %s", e)
        await send_message_activity(ctx, text="An error occurred while retrieving your tickets.")
        return

async def my_tickets2(ctx, value):
    try:
        sn_username = value.get("sn_username", "")
        count = value.get('data').get("count", 5)
        payload = {
            "caller ": sn_username,
            "count": count
        }
        logger.info(f"Calling external API to retrieve tickets with payload: {payload}")
        timeout = httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=10.0)
        limits = httpx.Limits(max_keepalive_connections=20, max_connections=100)
        async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
            response = await client.get(
                f"{ITOPS_API}/servicenow/my-tickets?caller={sn_username}&count={count}"
            )

            response.raise_for_status()

            try:
                data = response.json()
                tickets = data.get("tickets", [])
                if not tickets:
                    await send_message_activity(ctx, text="No tickets found for your username.")
                    return

                # body=[
                #     {
                #         "type": "TextBlock",
                #         "text":f"Incident Number: {ticket.get('number')}\nCategory: {ticket.get('category')}\nSub Category: {ticket.get('subcategory')}\nState: {ticket.get('state')}\nPriority: {ticket.get('priority')}\nAssignment Group: {ticket.get('assignment_group')}\nAssigned To: {ticket.get('assigned_to')}",
                #     } for ticket in tickets
                # ]
                body = []
                i=0
                for ticket in tickets:
                    print(f"Ticket: {ticket}, Index: {i}")
                    i+=1
                    body.extend([
                        # {
                        #     "type": "TextBlock",
                        #     "text": f"{i}. Incident Number: {ticket.get('number')} | State: {ticket.get('state')}\n",
                        #     # "weight": "bolder"
                        # },
                        {
                            "type": "RichTextBlock",
                            "inlines": [
                                # {"type": "TextRun", "text": f"{i}. ", "weight": "bolder"},
                                {"type": "TextRun", "text": "Incident Number: ","weight": "bolder"},
                                {"type": "TextRun", "text": f"{ticket.get('number')}"}
                            ]
                        },
                        {
                            "type": "RichTextBlock",
                            "inlines": [
                                {"type": "TextRun", "text": "Title: ", "weight": "bolder"},
                                {"type": "TextRun", "text": f"{ticket.get('short_description')}"}
                            ]
                        },
                        {
                            "type": "RichTextBlock",
                            "inlines": [
                                {"type": "TextRun", "text": "State: ", "weight": "bolder"},
                                {"type": "TextRun", "text": f"{ticket.get('state')}"}
                            ]
                        },
                        # {
                        #     "type": "TextBlock",
                        #     "text": f"---"
                        # }
                        # {
                        #     "type": "TextBlock",
                        #     "text": f"Category: {ticket.get('category')}"
                        # },
                        # {
                        #     "type": "TextBlock",
                        #     "text": f"Sub Category: {ticket.get('subcategory')}"
                        # },
                        # {
                        #     "type": "TextBlock",
                        #     "text": f" State: {ticket.get('state')}\n"
                        # },
                        # {
                        #     "type": "TextBlock",
                        #     "text": f"Priority: {ticket.get('priority')}"
                        # },
                        # {
                        #     "type": "TextBlock",
                        #     "text": f"Assignment Group: {ticket.get('assignment_group')}"
                        # },
                        # {
                        #     "type": "TextBlock",
                        #     "text": f"Assigned To: {ticket.get('assigned_to')}"
                        # },
                        # {
                        #     "type": "TextBlock",
                        #     "text": f"---"
                        # }
                    ])
                    if ticket.get('state','')!='Resolved':
                        body.append({
                            "type": "ActionSet",
                            "actions": [
                                {
                                    "type": "Action.Submit",
                                    "title": "Resolved",
                                    "data": {
                                        "action": "incident_resolution",
                                        "sub-action": "resolved",
                                        "incident_number": ticket.get('number')
                                    }
                                },
                                {
                                    "type": "Action.Submit",
                                    "title": "Unresolved",
                                    "data": {
                                        "action": "incident_resolution",
                                        "sub-action": "unresolved",
                                        "incident_number": ticket.get('number')
                                    }
                                }
                            ]
                        })
                    body.append({
                        "type": "TextBlock",
                        "text": f"---"
                    })
                
                card = Attachment(
                    content_type="application/vnd.microsoft.card.adaptive",
                    content_url=None,
                    content={
                        "type": "AdaptiveCard",
                        "body": [
                            {
                                "type": "TextBlock",
                                "text": f"Here are your list of incidents\n",
                                "weight": "bolder",
                                "size": "large"
                            },
                            {
                                "type": "TextBlock",
                                "text": f"---"
                            }
                        ]+body,
                        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                        "version": "1.5"
                    }
                )
                
                await send_message_activity(ctx, attachments=[card])
                # await send_agent_cards_by_aaid(ctx.activity.from_.aad_object_id, ctx)
            except ValueError:
                logger.error("Invalid JSON from agent (status=%s): %s", response.status_code)
                await send_message_activity(ctx, text="Received an unexpected response from the service.")
                return
    except Exception as e:
        logger.exception("Error retrieving tickets: %s", e)
        await send_message_activity(ctx, text="An error occurred while retrieving your tickets.")
        return

# async def handle_incident_resolution(ctx, value):
#     try:
#         incident_number = value.get("incident_number")
#         sub_action = value.get("sub-action")
#         timestamp = value.get("timestamp","")

#         # use timezone-aware UTC for current time
#         if timestamp:
#             dt1 = datetime.now(timezone.utc)

#             # normalize incoming ISO timestamps that end with 'Z' to '+00:00'
#             # e.g. '2026-08-05T03:24:20.483635Z' -> '2026-08-05T03:24:20.483635+00:00'
#             if isinstance(timestamp, str) and timestamp.endswith("Z"):
#                 timestamp = timestamp[:-1] + "+00:00"

#             dt2 = datetime.fromisoformat(timestamp)
#             if dt2.tzinfo is None:
#                 dt2 = dt2.replace(tzinfo=timezone.utc)

#             diff_seconds = (dt1 - dt2).total_seconds()
#             print(f"Time difference in seconds: {diff_seconds}")

#             if diff_seconds < 50:  #50 seconds threshold
#                 logger.info(f"Incident resolution action received within {diff_seconds} seconds. Proceeding with resolution.")
#                 await send_message_activity(ctx, text=f"The incident ({incident_number}) has been acknowledged and is currently under investigation, please try again after {int(50 - diff_seconds)} seconds.")
#                 return

#         payload = {
#             "number": incident_number,
#             "action": sub_action
#         }

#         timeout = httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=10.0)
#         limits = httpx.Limits(max_keepalive_connections=20, max_connections=100)
#         async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
#             response = await client.post(
#                 f"{ITOPS_API}/servicenow/feedback",
#                 json=payload
#             )

#             response.raise_for_status()

#             try:
#                 data = response.json()
#                 logger.info(f"Incident resolution response: {data}")
#                 await send_message_activity(ctx, text=data.get("message", ""))
#             except ValueError:
#                 logger.error("Invalid JSON from agent (status=%s): %s", response.status_code)
#                 # await send_message_activity(ctx, text="")
#                 return
#         return
        
#     except Exception as e:
#         logger.exception("Error handling incident resolution: %s", e)
#         # await send_message_activity(ctx, text="An error occurred while processing your request.")
#         return

async def handle_incident_resolution(ctx, value, user_data):
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

            # if diff_seconds < 50:  #50 seconds threshold
            #     logger.info(f"Incident resolution action received within {diff_seconds} seconds. Proceeding with resolution.")
            #     await send_message_activity(ctx, text=f"The incident ({incident_number}) has been acknowledged and is currently under investigation, please try again after {int(50 - diff_seconds)} seconds.")
            #     return

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
                suggested_cards=["My Open Tickets","Create a new ticket"]
                                                            
                suggested_actions_for_selected_agent = SuggestedActions(
                    to=[ctx.activity.from_.id],
                    actions=[CardAction(
                        type="imBack",
                        title=suggested_card,
                        value=suggested_card
                    ) for suggested_card in suggested_cards]
                )
                await send_message_activity(ctx, text=data.get("message", ""), suggested_actions=suggested_actions_for_selected_agent)
            except ValueError:
                logger.error("Invalid JSON from agent (status=%s): %s")
                # await send_message_activity(ctx, text="")
                return
        return
        
    except Exception as e:
        logger.exception("Error handling incident resolution: %s", e)
        # await send_message_activity(ctx, text="An error occurred while processing your request.")
        return


async def handle_custom_agent_selection(ctx, value):
    try:
        # Placeholder for handling custom agent selections that are not of type "lyzr"
        print(f"Handling custom agent selection with data: {value}")
        if value.get('data').get('type') == 'create_incident':
            await create_incident(ctx, value)
        elif value.get('data').get('type') == 'fill_disk':
            await fill_disk(ctx, value)
        elif value.get('data').get('type') == 'my_tickets':
            await my_tickets(ctx, value)
        else:
            logger.warning(f"Unknown custom agent action type: {value.get('type')}")
            await send_message_activity(ctx, text="Unknown action type selected.")
    except Exception as e:
        logger.exception("Error handling custom agent selection: %s", e)
        await send_message_activity(ctx, text="An error occurred while processing your request.")
        return
    