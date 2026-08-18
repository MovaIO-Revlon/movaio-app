from microsoft_teams.api import  MessageActivity, MessageActivityInput, Attachment , TypingActivityInput
from microsoft_teams.apps import ActivityContext
import os
import uuid
import mimetypes
import asyncio
import pypandoc
from docx import Document
import logging
from utility.aad_api import get_app_token, get_user_by_object_id
from utility.upload_sharepoint import upload_file_to_sharepoint

from dotenv import load_dotenv
load_dotenv()

logger = logging.getLogger("send_files_output")
logger.setLevel(logging.INFO)

def convert_md_to_docx(md_text: str) -> None:
    """Convert markdown text to a DOCX file."""
    try:
        # This is a placeholder function. Implement markdown to DOCX conversion logic here.
        output_path = 'temp/' + uuid.uuid4().hex + '.docx'
        pypandoc.convert_text(md_text, 'docx', format='markdown', outputfile=output_path)
        return {"status": "success", "output_path": output_path}
    except Exception as e:
        try:
            doc = Document()
        
            # doc.add_heading('JD', level=1)

            # Add your text
            text = md_text
            doc.add_paragraph(text)

            saved_path = 'temp/' + uuid.uuid4().hex + '.docx'

            # Save the document
            doc.save(saved_path)
            return {"status": "success", "output_path": saved_path}
        except Exception as e:
            # print("Error converting markdown to DOCX:", str(e))
            logger.error("Error converting markdown to DOCX:", str(e))
            return {"status": "failed", "error": str(e)}
    
async def send_file_with_consent_card(ctx: ActivityContext[MessageActivity], transcript: str) -> None:
    """Handle transcript download requests."""
    # Logic to handle transcript download
    # print("Downloading transcript for AAD Object ID:", ctx.activity.from_.aad_object_id)
    logger.info(f"Downloading transcript for AAD Object ID: {ctx.activity.from_.aad_object_id}")
    # For demonstration, we just print the transcript

    doc = Document()
    
    # doc.add_heading('JD', level=1)

    # Add your text
    text = transcript
    doc.add_paragraph(text)

    saved_path = 'temp/' + uuid.uuid4().hex + '.docx'

    # Save the document
    doc.save(saved_path)

    file_size = os.path.getsize(saved_path)

    card ={
        "contentType": "application/vnd.microsoft.teams.card.file.consent",
        "name": saved_path.split('/')[-1],
        "content": {
        "description": "Converted file",
        "sizeInBytes": file_size,
        "acceptContext": {
        },
        "declineContext": {
        }
        }
    }
    await ctx.send(MessageActivityInput().add_attachments(card))

    # print("Transcript:", transcript)
    return {"status": "success"}


async def send_file_without_consent_card(ctx: ActivityContext[MessageActivity], transcript: str) -> None:
    """Handle transcript download requests without consent."""
    # Logic to handle transcript download
    # print("Downloading transcript for AAD Object ID:", ctx.activity.from_.aad_object_id)
    logger.info(f"Downloading transcript for AAD Object ID: {ctx.activity.from_.aad_object_id}")
    try:

        aad_object_id = ctx.activity.from_.aad_object_id

        token= get_app_token()
        # print('token:\n\n\n\n\n\n\n\n', token)
        user = get_user_by_object_id(aad_object_id, token)
        # logger.info(f"User info from Graph: {user}")
        email = user.get("mail") or user.get("userPrincipalName")
        # logger.info(f"Resolved user email:\n\n\n {email} \n\n\n")
        
        upload_resp =  await asyncio.to_thread(convert_md_to_docx, transcript)

        saved_path = upload_resp.get("output_path")

        upload_res=upload_file_to_sharepoint(saved_path,email, token)

        if upload_res.get("status") != "success":
            await ctx.send(f"Failed to upload file '{saved_path.split('/')[-1]}'. Error: {upload_res.get('error')}")
            return
        
        card = Attachment(
            content_type="application/vnd.microsoft.teams.card.file.info",
            content_url=upload_res.get('url'),
            name=saved_path.split('/')[-1],
            content={
                "uniqueId": upload_res.get('uniqueId'),
                "fileType": mimetypes.guess_type(saved_path)[0] or "application/octet-stream"
            }
        )

        # card={
        #     "contentType": "application/vnd.microsoft.teams.card.file.info",
        #     "contentUrl": upload_res.get('url'),
        #     "name": saved_path.split('/')[-1],
        #     "content": {
        #         "uniqueId": upload_res.get('uniqueId'),
        #         "fileType": mimetypes.guess_type(saved_path)[0] or "application/octet-stream"
        #     }
        # }
        # print('card to send:\n\n\n\n\n\n', card)
        await ctx.send(MessageActivityInput().add_attachments(card))

        return {"status": "success"}
    except Exception as e:
        # print("Error in upload_without_consent_card:", str(e))
        logger.error("Error in upload_without_consent_card:", str(e))
        return {"status": "failed", "error": str(e)}
    