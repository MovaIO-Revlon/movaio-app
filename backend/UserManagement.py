from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
import hashlib
import os
import random
import secrets
import smtplib
import string
from venv import logger
from flask import request, jsonify
import base64
import logging
import re
from bson.objectid import ObjectId
import requests
from utils.api_util import ValidationError
from config_loader import ConfigLoader
from commonutils import DatabaseCollections, CommonUtils
from session_manager import session_manager, get_current_user
from database_manager import select_database_by_user_type
from database_manager import DatabaseManager

from utils import AuthorizationError, NotFoundError

class UserManager(DatabaseCollections):
    def __init__(self):
        super().__init__()
        self.utils = CommonUtils()
        self.config = ConfigLoader()
        self.db = DatabaseManager()
        self._databases = {}
    
    def _query_db(self, collection_name, operation,user_type=None):
        """Helper method to query database with user type"""
        # ##print('------',)
        if user_type is None:
            try:
                current_user = get_current_user()
                ##print('current_user',current_user)
                prj_name = current_user.get('ActiveProject', self.config.config["MONGODB_COLLECTION_NAME_MASTER"]) if current_user else self.config.config["MONGODB_COLLECTION_NAME_MASTER"]
                user_type = self.project.find_one({'projectName': prj_name})['database_name']
            except:
                user_type = self.config.config["MONGODB_COLLECTION_NAME_MASTER"]
        if user_type == 'master':
            user_type = self.config.config["MONGODB_COLLECTION_NAME_MASTER"] 
        
        return self.db.execute_query(
            collection_name,
            operation,
            condition_func=select_database_by_user_type,
            user_type=user_type
        )

    def generate_hash(self, input_password, secret_key, salt):
        combined = input_password + secret_key + salt
        hash_bytes = hashlib.sha256(combined.encode('utf-8')).digest()
        return base64.b64encode(hash_bytes).decode('utf-8')

    def pwd_are_equal(self, plain_input, stored_password, secret_key, salt):
        try:
            print("plain_input",plain_input)
            print("secret_key",secret_key)
            print("store",stored_password)
            print("salt",salt)
            new_hash = self.generate_hash(plain_input, secret_key, salt)
            print("new_hash",new_hash)
            return new_hash == stored_password
        except Exception as e:
            print("pwd_are_equal",e)
            logger.error("\nError in pwd_are_equal Mail -- %s\n%s", datetime.now(timezone.utc), str(e), exc_info=True)
            return False
        
    def _send_azure_email(self, to_email, to_name, password, sourcefrom):
        """Helper method for sending emails via Azure Communication Services"""
        try:
            from azure.communication.email import EmailClient
            from azure.identity import ClientSecretCredential
        except ImportError:
            logger.warning("Azure Communication Services packages not installed, falling back to SMTP")
            return False, "Azure packages not available"
            
        acs_endpoint = self.config.AZURE_ACS_ENDPOINT
        sender_address = self.config.AZURE_SENDER_ADDRESS
        
        tenant_id = self.config.AZURE_TENANT_ID
        client_id = self.config.AZURE_CLIENT_ID
        client_secret = self.config.AZURE_CLIENT_SECRET
        
        if not all([tenant_id, client_id, client_secret]):
            return False, "Azure credentials not configured"
        
        credential = ClientSecretCredential(
            tenant_id=tenant_id,
            client_id=client_id,
            client_secret=client_secret
        )
        email_client = EmailClient(acs_endpoint, credential)
        
        base_path = os.path.abspath(os.path.dirname(__file__))

        if self.config.ISNEWPORT is False:  
            if sourcefrom == "Recovery":
                template_path = os.path.join(base_path, "templates", "EmailTemplate","App_Eng", self.config.RESET_PASSWORD_TEMPLATE_NAME)
            elif sourcefrom == "OTP":
                template_path = os.path.join(base_path, "templates", "EmailTemplate","App_Eng", self.config.OTP_TEMPLATE_NAME)            
            else:
                template_path = os.path.join(base_path, "templates", "EmailTemplate", "App_Eng", self.config.WELCOME_TEMPLATE_NAME)
        else:
            if sourcefrom == "Recovery":
                template_path = os.path.join(base_path, "templates", "EmailTemplate", self.config.RESET_PASSWORD_TEMPLATE_NAME)
            elif sourcefrom == "OTP":
                template_path = os.path.join(base_path, "templates", "EmailTemplate", self.config.OTP_TEMPLATE_NAME)                
            else:
                template_path = os.path.join(base_path, "templates", "EmailTemplate", self.config.WELCOME_TEMPLATE_NAME)
                
        with open(template_path, "r", encoding="utf-8") as f:
            body = f.read()
        
        body = body.replace("USERNAME", to_name)
        body = body.replace("PWD", password)
        body = body.replace("OTP_CODE", password)
        body = body.replace("SITEURL", self.config.SITE_URL)
        
        if sourcefrom != "Recovery":
            body = body.replace("USERID", to_email)
        
        message = {
            "content": {
                "subject": self.config.EMAIL_SUBJECT,
                "html": body
            },
            "recipients": {
                "to": [
                    {
                        "address": to_email,
                        "displayName": to_name
                    }
                ]
            },
            "senderAddress": sender_address
        }
        
        poller = email_client.begin_send(message)
        result = poller.result()
        return True, "Mail sent successfully"
        
    def send_mail(self, email, user_name, otp, sourcefrom):
        if self.config.AZ_MAIL_PWD:
            is_mail_sent = self.send_mail_azpwd(email, user_name, otp, sourcefrom)     
        else:
            is_mail_sent = self.send_mail_azapp(email, user_name, otp, sourcefrom)
        return is_mail_sent
            
    def send_mail_azapp(self, to_email, to_name, password, sourcefrom):
        try:
            success, message = self._send_azure_email(to_email, to_name, password, sourcefrom)
            return success
        except Exception as ex:
            logger.error("\nError in send_mail -- %s\n%s", datetime.now(timezone.utc), str(ex), exc_info=True)
            return False

    def send_mail_approval(self, to_email, to_name, data, sourcefrom):
        is_mail_sent = False
        try:
            from_address = self.config.EMAIL_FROM
            from_display_name = self.config.EMAIL_FROM_NAME
            smtp_username = self.config.SMTP_USER
            smtp_password = self.config.SMTP_PASS
            smtp_host = self.config.SMTP_HOST
            smtp_port = self.config.SMTP_PORT
            if sourcefrom == "Onboarding":
                subject = self.config.EMAIL_SUBJECT_APPROVAL_ONBOARDING
            elif sourcefrom == "Update":
                subject = self.config.EMAIL_SUBJECT_APPROVAL_UPDATE
            elif sourcefrom == "Delete":
                subject = self.config.EMAIL_SUBJECT_APPROVAL_DELETE
                deletion_description = data.get("deletion_description", "N/A")

            if not smtp_host or not smtp_username:
                logger.warning("SMTP configuration incomplete, skipping email")
                return False
            
            base_path = os.path.abspath(os.path.dirname(__file__))
            template_path = os.path.join(base_path, "templates", "EmailTemplate", self.config.APPROVAL_TEMPLATE_NAME)

            with open(template_path, "r", encoding="utf-8") as f:
                body = f.read()
            
            body = body.replace("AGENT_ID", data.get("agent_id", "N/A"))
            body = body.replace("AGENT_NAME", data.get("agent_name", "N/A"))
            body = body.replace("AGENT_DESCRIPTION", data.get("agent_description", "N/A"))
            body = body.replace("AGENT_ROLE", data.get("agent_role", "N/A"))
            body = body.replace("AGENT_INSTRUCTION", data.get("agent_instruction", "N/A"))
            body = body.replace("OPERATION", sourcefrom)

            reason_row = ""
            if sourcefrom == "Delete":
                reason_text = data.get("reason", deletion_description)
                reason_row = (
                    "<tr>"
                    "<td style=\"overflow-wrap:break-word;word-break:break-word;padding:10px;"
                    "font-family:arial,helvetica,sans-serif;border: 1px solid #ccc;\" align=\"left\">Reason</td>"
                    "<td style=\"overflow-wrap:break-word;word-break:break-word;padding:10px;"
                    "font-family:arial,helvetica,sans-serif;border: 1px solid #ccc;vertical-align: top;\" align=\"left\">"
                    "<div style=\"max-width:320px;max-height:140px;overflow:auto;white-space:normal;word-break:break-word;\">"
                    + reason_text +
                    "</div></td>"
                    "</tr>"
                )
            body = body.replace("REASON_ROW", reason_row)

            site_url = (self.config.URL_CONF or "http://localhost:5001").rstrip("/")
            agent_id = data.get("agent_id", "")
            approve_url = data.get("approve_url") or f"{site_url}/approvalAPI/{agent_id}/{sourcefrom}/Approved/confirm"
            decline_url = data.get("decline_url") or f"{site_url}/approvalAPI/{agent_id}/{sourcefrom}/Rejected/confirm"
            body = body.replace("APPROVE_URL", approve_url)
            body = body.replace("DECLINE_URL", decline_url)

            msg = EmailMessage()
            msg["Subject"] = subject
            msg["From"] = f"{from_display_name} <{from_address}>"
            msg["To"] = f"{to_name} <{to_email}>"
            msg.set_content("This is an HTML email. Please view it in an HTML-compatible email viewer.")
            msg.add_alternative(body, subtype="html")
            
            try:
                with smtplib.SMTP(smtp_host, smtp_port) as server:
                    server.starttls()
                    server.login(smtp_username, smtp_password)
                    server.send_message(msg)
                    is_mail_sent = True
            except (smtplib.SMTPException, OSError) as smtp_error:
                print(f"SMTP connection failed: {smtp_error}")
                is_mail_sent = False
            
            return is_mail_sent

        except Exception as ex:
            logger.error("\nError in send_mail_approval -- %s\n%s", datetime.now(timezone.utc), str(ex), exc_info=True)
            return False
    
    def send_mail_azpwd(self, to_email, to_name, password, sourcefrom):
        is_mail_sent = False
        try:
            from_address = self.config.EMAIL_FROM
            from_display_name = self.config.EMAIL_FROM_NAME
            smtp_username = self.config.SMTP_USER
            smtp_password = self.config.SMTP_PASS
            smtp_host = self.config.SMTP_HOST
            smtp_port = self.config.SMTP_PORT
            subject = self.config.EMAIL_SUBJECT
                        
            # Check if SMTP configuration is valid
            if not smtp_host or not smtp_username:
                logger.warning("SMTP configuration incomplete, skipping email")
                return False
            
            base_path = os.path.abspath(os.path.dirname(__file__))
            
            print('siteurl',self.config.SITE_URL)
            print('isnewport',self.config.ISNEWPORT)

            if self.config.ISNEWPORT is False:
                print('sdlc email')        
                if sourcefrom == "Recovery":
                    template_path = os.path.join(base_path, "templates", "EmailTemplate","App_Eng", self.config.RESET_PASSWORD_TEMPLATE_NAME)
                elif sourcefrom == "OTP":
                    template_path = os.path.join(base_path, "templates", "EmailTemplate","App_Eng", self.config.OTP_TEMPLATE_NAME)            
                else:
                    template_path = os.path.join(base_path, "templates", "EmailTemplate", "App_Eng", self.config.WELCOME_TEMPLATE_NAME)
            else:
                print('newport email')
                if sourcefrom == "Recovery":
                    template_path = os.path.join(base_path, "templates", "EmailTemplate", self.config.RESET_PASSWORD_TEMPLATE_NAME)
                elif sourcefrom == "OTP":
                    template_path = os.path.join(base_path, "templates", "EmailTemplate", self.config.OTP_TEMPLATE_NAME)   
                    subject = "One Time Password for AI-Infused Engineering Portal"                             
                else:
                    template_path = os.path.join(base_path, "templates", "EmailTemplate", self.config.WELCOME_TEMPLATE_NAME)
                    
            with open(template_path, "r", encoding="utf-8") as f:
                body = f.read()
            
            body = body.replace("USERNAME", to_name)
            body = body.replace("PWD", password)
            body = body.replace("OTP_CODE", password)
            body = body.replace("SITEURL", self.config.SITE_URL)
            
            if sourcefrom != "Recovery":
                body = body.replace("USERID", to_email)
            
            msg = EmailMessage()
            msg["Subject"] = subject
            msg["From"] = f"{from_display_name} <{from_address}>"
            msg["To"] = f"{to_name} <{to_email}>"
            msg.set_content("This is an HTML email. Please view it in an HTML-compatible email viewer.")
            msg.add_alternative(body, subtype="html")
            
            try:
                with smtplib.SMTP(smtp_host, smtp_port) as server:
                    server.starttls()
                    server.login(smtp_username, smtp_password)
                    server.send_message(msg)
                    is_mail_sent = True
            except (smtplib.SMTPException, OSError) as smtp_error:
                logger.error(f"SMTP connection failed: {smtp_error}")
                logger.info(f"Email would have been sent to {to_email} with password: {password}")
                is_mail_sent = False
            
            return is_mail_sent
        
        except Exception as ex:
            logger.error("\nError in ForgotPassword Mail -- %s\n%s", datetime.now(timezone.utc), str(ex), exc_info=True)
            return False
        
    def perform_login(self, user_details):
        email = user_details.get("EmailId", "").lower()
        input_password = user_details.get("Password")
        user_type = "master"
        
        # Find user using database manager
        user_op = {
            'type': 'find_one',
            'filter': {
                "Email": re.compile(f"^{re.escape(email)}$", re.IGNORECASE),
                "IsActive": True,
                "IsDelete": False
            }
            
        }
        user_data = self._query_db('user', user_op,user_type)
        
        if not user_data:
            raise NotFoundError("User not found or is not active.")
        
        # Get all active users
        all_users_op = {'type': 'find', 'filter': {"IsActive": True}}
        all_users = self._query_db('user', all_users_op,user_type)
        
        user_data["_id"] = str(user_data["_id"])
        all_users = [self.clean_document(u) for u in all_users]
        
        # Get roles using database manager
        roles_op = {'type': 'find', 'filter': {}}
        roles_data = self._query_db('role', roles_op,user_type)
        roles = {r["RoleId"]: r["RoleName"] for r in roles_data}
        for user in all_users:
            user["RoleName"] = roles.get(user.get("RoleId"), "Unknown")
        user_data["RoleName"] = roles.get(user_data.get("RoleId"), "Unknown")
        
        # Get teams using database manager
        teams_op = {'type': 'find', 'filter': {}}
        teams_data = self._query_db('team', teams_op,user_type)
        teams = {t["TeamId"]: t["TeamName"] for t in teams_data}
        for user in all_users:
            user["TeamName"] = teams.get(user.get("TeamId"), "Unknown")
        user_data["TeamName"] = teams.get(user_data.get("TeamId"), "Unknown")
        
        is_match = self.pwd_are_equal(input_password, user_data["Password"], self.config.SECRET_KEY, user_data["Salt"])
        print("Is_Match",is_match)
        if not is_match:
            ##raise AuthorizationError("Username or Password not matched")
            return {"Success": False, "Message": "Username or Password not matched"}
        
        full_name = f"{user_data['FirstName']} {user_data['LastName']}"
        
            # Get prjDetails safely (default to empty list)
        prj_details = user_data.get("PrjDetails", [])
        ##print("prj_details",prj_details)
        role = None

        # Check if RoleName exists in user_data and is not empty
        if "RoleName" in user_data and user_data["RoleName"] and user_data["RoleName"].lower() != "unknown":
            role = user_data["RoleName"]
            ##print("role_OD",role)
        else:
            # Fallback to prjDetails first element's role_name if available
            role = self.get_user_role(user_data)
                            
        return {
            "Success": True,
            "Email": user_data["Email"],
            "UserName": full_name,
            "Role": role,
            "Team": user_data["TeamName"],
            "IsOTP": self.config.OTP_RECAPTCHA,
            "Avatar": user_data.get("Avatar", ""),
            "ActiveProject": user_data.get("ActiveProject", ""),
            "ProjectDtl":prj_details
        }
    
    def get_user_role(self, user_data: dict) -> str | None:
        """Get role_name by matching prj_name from PrjDetails with ActiveProject"""
    
        if not user_data:
            return None

        # Get ActiveProject (can be string or None)
        active_project = user_data.get("ActiveProject")
        if not active_project or not isinstance(active_project, str):
            return None

        active_name = active_project.strip().lower()

        # Get PrjDetails and find matching project
        prj_details = user_data.get("PrjDetails") or user_data.get("PrjDetails", [])

        for p in prj_details:
            if isinstance(p, dict):
                prj_name = p.get("prj_name")
                if prj_name and isinstance(prj_name, str):
                    if prj_name.strip().lower() == active_name:
                        return p.get("role_name")  # return role_name directly

        return None
     
    def fetch_recaptcha_config(self):
        return {
            "OTPRecaptcha": self.config.OTP_RECAPTCHA,
            "SiteKey": self.config.RECAPTCHA_SITE_KEY
        }

    def convert_string(self, input_str):
        if input_str:
            if input_str.startswith('"') and input_str.endswith('"'):
                input_str = input_str[1:-1]
            input_str = input_str.replace("\\", "")
        return input_str

    def verify_token(self, token):
        cleaned_token = self.convert_string(token)

        if not token:
            raise ValidationError("Invalid reCAPTCHA token")

        url = "https://www.google.com/recaptcha/siteverify"
        payload = {
            "secret": self.config.RECAPTCHA_API_KEY,
            "response": cleaned_token
        }

        res = requests.post(url, data=payload)
        res.raise_for_status()
        captcha_response = res.json()

        if not captcha_response.get("success", False) and captcha_response.get("error-codes"):
            for error_code in captcha_response["error-codes"]:
                logger.warning(f"reCAPTCHA error: {error_code}")

        score = captcha_response.get("score", 0)
        is_human = captcha_response.get("success", False) and score >= 0.5

        if not is_human:
            raise ValidationError("reCAPTCHA verification failed.")
        
        return jsonify({"Success": True, "Message": "reCAPTCHA verification passed."})


    def generate_otp(self):
        """Generate a 6-digit OTP"""
        return str(secrets.randbelow(900000) + 100000)
    
    def cleanup_expired_otps(self):
        """Remove expired OTPs from database"""
        try:
            current_time = datetime.now(timezone.utc)
            result = self.otp_collection.delete_many({
                "expires_at": {"$lt": current_time}
            })
            logger.info(f"Cleaned up {result.deleted_count} expired OTPs")
        except Exception as ex:
            logger.error(f"Error cleaning up expired OTPs: {str(ex)}")
    
    def send_otp_details_external(self, user_data):
        otp_api_url = self.config.OTP_URL
        payload = {
            "UserId": user_data.get("EmployeeId", "CSS151837"),
            "UserEmail": user_data.get("EmailId"),
            "ClientName": self.config.CLIENT_NAME,
            "otp": ""
        }
        
        response = requests.post(otp_api_url, json=payload)
        
        if response.status_code != 200:
            raise ValidationError(f"OTP service failed with {response.status_code}")

        return True
        
    def send_otp_details_internal(self, user_data):
        email = user_data.get("EmailId")
        if not email:
            raise ValidationError("Email is required")
        
        # Clean up expired OTPs first
        self.cleanup_expired_otps()
        
        # Generate OTP
        otp = self.generate_otp()
        expiry_time = datetime.now(timezone.utc) + timedelta(minutes=2)  # 2 minutes expiry
        
        # Store OTP in MongoDB
        otp_doc = {
            "email": email.lower(),
            "otp": otp,
            "created_at": datetime.now(timezone.utc),
            "expires_at": expiry_time,
            "is_used": False,
            "attempts": 0
        }
        
        # Remove any existing OTP for this email
        self.otp_collection.delete_many({"email": email.lower()})
        
        # Insert new OTP
        self.otp_collection.insert_one(otp_doc)
        
        # Send OTP via email
        user_name = user_data.get("UserName", "User")
        is_mail_sent = self.send_mail(email, user_name, otp, 'OTP')
        
        if not is_mail_sent:
            raise ValidationError("Failed to send OTP email")
        
        return True
    
    def _send_otp_email(self, to_email, to_name, otp):
        """Send OTP via email using existing email infrastructure"""
        try:
            from azure.communication.email import EmailClient
            from azure.identity import ClientSecretCredential
        except ImportError:
            logger.warning("Azure Communication Services packages not installed")
            return False
            
        acs_endpoint = self.config.AZURE_ACS_ENDPOINT
        sender_address = self.config.AZURE_SENDER_ADDRESS
        
        tenant_id = self.config.AZURE_TENANT_ID
        client_id = self.config.AZURE_CLIENT_ID
        client_secret = self.config.AZURE_CLIENT_SECRET
        
        if not all([tenant_id, client_id, client_secret]):
            return False
        
        credential = ClientSecretCredential(
            tenant_id=tenant_id,
            client_id=client_id,
            client_secret=client_secret
        )
        email_client = EmailClient(acs_endpoint, credential)
        
        # Create OTP email content
        html_body = f"""
        <html>
        <body>
            <h2>Your OTP for Login</h2>
            <p>Dear {to_name},</p>
            <p>Your One-Time Password (OTP) is: <strong style="font-size: 18px; color: #007bff;">{otp}</strong></p>
            <p>This OTP will expire in 5 minutes.</p>
            <p>Please do not share this OTP with anyone.</p>
            <br>
            <p>Best regards,<br>AI Infused Team</p>
        </body>
        </html>
        """
        
        message = {
            "content": {
                "subject": "Your OTP for Login - AI Infused Portal",
                "html": html_body
            },
            "recipients": {
                "to": [
                    {
                        "address": to_email,
                        "displayName": to_name
                    }
                ]
            },
            "senderAddress": sender_address
        }
        
        try:
            poller = email_client.begin_send(message)
            result = poller.result()
            return True
        except Exception as ex:
            logger.error(f"Error sending OTP email: {str(ex)}")
            return False

    def validate_otp_service_external(self, user_details) -> dict:
        validate_otp_url = self.config.VALIDATE_OTP_URL
        client_name = self.config.CLIENT_NAME

        payload = {
            "UserId": user_details.get("EmployeeId", "CSS151837"),
            "UserEmail": user_details.get("EmailId"),
            "ClientName": client_name,
            "otp": str(user_details.get("Otp", ""))
        }

        response = requests.post(validate_otp_url, json=payload)

        json_response = response.json()

        if response.status_code != 200:
            raise ValidationError(f"Failed to validate OTP. Status code: {response.status_code}")
        
        return json_response
        
    def validate_otp_service_internal(self, user_details):
        email = user_details.get("EmailId")
        otp_input = str(user_details.get("Otp", "")).strip()

        if not email or not otp_input:
            raise ValidationError("Email and OTP are required")

        # Find OTP record
        otp_record = self.otp_collection.find_one({
            "email": email.lower(),
            "is_used": False
        })
        print('ud',user_details,'otprec',otp_record)
        if not otp_record:
            raise NotFoundError("No valid OTP found for this email")


        # Check if OTP is expired - ensure timezone-aware comparison
        expires_at = otp_record.get("expires_at")
        current_time = datetime.now(timezone.utc)
        print(current_time,'----+++-------',expires_at)
        # Ensure expires_at is a timezone-aware datetime
        if expires_at is None:
            raise ValidationError("Invalid OTP record - missing expiry")

        # Convert to datetime if needed and ensure it's timezone-aware
        if isinstance(expires_at, str):
            try:
                expires_at = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
            except:
                expires_at = datetime.fromisoformat(expires_at)
        elif isinstance(expires_at, datetime):
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
        else:
            raise ValidationError("Invalid expiry format")

        # Now both are timezone-aware datetimes
        if current_time > expires_at:
            # Mark as used and delete expired OTP
            self.otp_collection.delete_one({"_id": otp_record["_id"]})
            raise ValidationError("OTP has expired")


        # Check attempts limit (max 3 attempts)
        if otp_record["attempts"] >= 3:
            self.otp_collection.delete_one({"_id": otp_record["_id"]})
            raise ValidationError("Maximum OTP attempts exceeded")

        # Validate OTP
        if otp_record["otp"] != otp_input:
            # Increment attempts
            self.otp_collection.update_one(
                {"_id": otp_record["_id"]},
                {"$inc": {"attempts": 1}}
            )
            remaining_attempts = 3 - (otp_record["attempts"] + 1)
            raise ValidationError(
                f"Invalid OTP. {remaining_attempts} attempts remaining",
                {
                    "isMailSent": False,
                    "otp":otp_input
                }
                )
        
        # Mark OTP as used
        self.otp_collection.update_one(
            {"_id": otp_record["_id"]},
            {"$set": {"is_used": True, "used_at": datetime.now(timezone.utc)}}
        )
        return { "isMailSent": True, "otp": otp_input}
            
        
    # def get_user_details_service(self):
    #     try:
    #         all_users = list(self.user_collection.find({"IsDelete": False}))
    #         all_users = [self.clean_document(u) for u in all_users]
            
    #         all_roles = list(self.role_collection.find({"IsActive": True}))
    #         all_roles = [self.clean_document(u) for u in all_roles]
            
    #         all_team = list(self.team_collection.find({"IsActive": True}))
    #         all_team = [self.clean_document(u) for u in all_team]
            
    #         roles = {r["RoleId"]: r["RoleName"] for r in self.role_collection.find({})}

    #         for user in all_users:
    #             role_id = user.get("RoleId")
    #             user["RoleName"] = roles.get(role_id, "Unknown")

    #         teams = {r["TeamId"]: r["TeamName"] for r in self.team_collection.find({})}

    #         for user in all_users:
    #             team_id = user.get("TeamId")
    #             user["TeamName"] = teams.get(team_id, "Unknown")
    #             user.pop("Password", None)
    #             user.pop("Salt", None)

    #         if all_users:
    #             return {
    #                 "Success": True,
    #                 "UserManagement": all_users,
    #                 "RoleManagement": all_roles,
    #                 "TeamManagement": all_team
    #             }
    #         else:
    #             return {"Success": False, "Message": "UserDetails Not available"}

    #     except Exception as ex:
    #         logger.error("\nException while Get the UserDetails %s\n%s", str(ex), "-"*40)
    #         return {"Success": False, "Message": str(ex)}
        

    def get_user_details_service(self):
        # Get Current user
        current_user = get_current_user()
        ##print("-----",current_user)
        prj_dtls = current_user.get('ProjectDtl')
        user_type = "master"
        
        # Users using database manager
        users_op = {'type': 'find', 'filter': {"IsDelete": False}}
        all_users = self._query_db('user', users_op,user_type)
        all_users = [self.clean_document(u) for u in all_users]

        # Roles using database manager
        roles_op = {'type': 'find', 'filter': {"IsActive": True}}
        all_roles = self._query_db('role', roles_op,user_type)
        all_roles = [self.clean_document(r) for r in all_roles]
        roles_map = {r["RoleId"]: r["RoleName"] for r in all_roles}

        # Teams using database manager
        teams_op = {'type': 'find', 'filter': {"IsActive": True}}
        all_team = self._query_db('team', teams_op,user_type)
        all_team = [self.clean_document(t) for t in all_team]
        teams_map = {t["TeamId"]: t["TeamName"] for t in all_team}

        # Projects using database manager
        projects_op = {'type': 'find', 'filter': {}}
        all_projects = self._query_db('project', projects_op,user_type)
        all_projects = [self.clean_document(p) for p in all_projects]
        projects_map = [
            {"projectId": p["prj_id"], "projectName": p["prj_name"]}
            for p in prj_dtls
        ]
        
        ###print('------',projects_map)
        # Map Role, Team, Project Names to each user
        for user in all_users:
            # Roles
            role_ids = user.get("RoleIds") or ([user.get("RoleId")] if user.get("RoleId") else [])
            user["RoleNames"] = [roles_map.get(rid, "Unknown") for rid in role_ids]

        # Teams
        team_ids = user.get("TeamIds") or ([user.get("TeamId")] if user.get("TeamId") else [])
        user["TeamNames"] = [teams_map.get(tid, "Unknown") for tid in team_ids]

        # Projects
        project_ids = user.get("ProjectIds") or ([user.get("projectId")] if user.get("projectId") else [])
        user["ProjectNames"] = [projects_map.get(pid, "Unknown") for pid in project_ids]

        # Hide sensitive info
        user.pop("Password", None)
        user.pop("Salt", None)

        return {
            "Success": True,
            "UserManagement": all_users,
            "RoleManagement": all_roles,
            "TeamManagement": all_team,
            "ProjectManagement": all_projects,
            "MappedProject":projects_map
        }
        
    def generate_password(self, length=12):
        lower = string.ascii_lowercase
        upper = string.ascii_uppercase
        digits = string.digits
        special = "!@#$%^&*_-=+"
        all_charsets = [lower, upper, digits, special]

        password_chars = []

        for _ in range(length):
            charset = secrets.choice(all_charsets)
            password_chars.append(secrets.choice(charset))

        return ''.join(password_chars)

    def clean_document(self, doc):
        if not doc:
            return {}
        doc = dict(doc)
        if "_id" in doc:
            doc["_id"] = str(doc["_id"])
        return doc

    def send_mail_service(self, to_email, to_name, password, source_from):
        try:
            success, message = self._send_azure_email(to_email, to_name, password, source_from)
            return {"Success": success, "Message": message}
        except Exception as ex:
            logger.error("\nError in send_mail_service -- %s\n%s", datetime.now(timezone.utc), str(ex), exc_info=True)
            return {"Success": False, "Message": str(ex)}
        
    def perform_sent_mail_user_management(self, mail_id):
        # Find user using database manager
        user_op = {
            'type': 'find_one',
            'filter': {"Email": re.compile(f"^{re.escape(mail_id)}$", re.IGNORECASE),
                        "IsActive": True,
                        "IsDelete": False}
        }

        user = self._query_db('user', user_op)
        
        if not user:
            raise ValidationError("You are not an authorized user.")

        password = self.generate_password(10)
        full_name = f"{user.get('FirstName', '')} {user.get('LastName', '')}"
        
        is_mail_sent = self.send_mail(user["Email"], full_name, password, 'Welcome')
        
        print("is_mail_sent",is_mail_sent)
        
        if not is_mail_sent:
            raise ValidationError("Welcome mail has not been sent. Please check with the administrator.")

        hashed_password = self.generate_hash(password, self.config.SECRET_KEY, user["Salt"])
        
        # Update using database manager
        update_op = {
            'type': 'update_one',
            'filter': {"_id": ObjectId(user["_id"])},
            'update': {
                "$set": {
                    "Password": hashed_password,
                    "UpdatedDate": datetime.now(timezone.utc)
                }
            }
        }
        
        print("update_op",update_op)
        
        self._query_db('user', update_op)
        
        return True

    # def perform_add_user(self, user_dtls):
    #     try:
    #         salt_encrypt = self.create_salt(10)
            
    #         is_edit = user_dtls.get("IsEdit", False)
    #         email = user_dtls.get("Email", "")
    #         full_name = f"{user_dtls.get('FirstName', '')} {user_dtls.get('LastName', '')}"
    #         generated_password = self.generate_password(10)
    #         ##print("gen-password",generated_password)
    #         if not is_edit:
    #             user_onboard = {
    #                 "FirstName": user_dtls.get("FirstName", ""),
    #                 "LastName": user_dtls.get("LastName", ""),
    #                 "Email": email,
    #                 "Salt": salt_encrypt,
    #                 "Password": self.generate_hash(generated_password, self.config.SECRET_KEY, salt_encrypt),
    #                 "RoleId": int(user_dtls.get("Role", 1)),
    #                 "TeamId": int(user_dtls.get("Team", 1)),
    #                 "IsActive": True,
    #                 "IsDelete": False,
    #                 "CreatedBy": user_dtls.get("CreatedBy", ""),
    #                 "CreatedDate": self.utils.get_current_timestamp()
    #             }
    #         else:
    #             update_fields = {
    #                     "RoleId": int(user_dtls.get("Role", 1)),
    #                     "TeamId": int(user_dtls.get("Team", 1)),
    #                     "UpdatedBy": user_dtls.get("CreatedBy", ""),
    #                     "UpdatedDate": datetime.now(timezone.utc)
    #                 }
            
    #         if not is_edit:
    #             self.user_collection.insert_one(user_onboard)
    #             self.send_mail(email, full_name,generated_password, 'Welcome')
    #         else:
    #             self.user_collection.update_one(
    #                 {"Email": re.compile(f"^{re.escape(email)}$", re.IGNORECASE), "IsActive": True, "IsDelete":False},
    #                 {"$set": update_fields}
    #             )
            
    #         all_users = list(self.user_collection.find({
    #             "Email": re.compile(f"^{re.escape(email)}$", re.IGNORECASE),
    #             "IsActive": True
    #         }))
            
    #         all_users = [self.clean_document(u) for u in all_users]
            
    #         roles = {r["RoleId"]: r["RoleName"] for r in self.role_collection.find({})}
    #         for user in all_users:
    #             user["RoleName"] = roles.get(user.get("RoleId"), "Unknown")
            
    #         return {
    #             "Success": True,
    #             "Email": email,
    #             "UserName": full_name,
    #             "RoleName": all_users[0]["RoleName"]
    #         }
        
    #     except Exception as ex:
    #         logging.error("Error in AddOrUpdate User -- %s", datetime.now(timezone.utc))
    #         logging.exception(ex)
    #         return {"Success": False, "Message": str(ex)}

    def perform_add_user(self, user_dtls):
        salt_encrypt = self.create_salt(10)

        is_edit = user_dtls.get("IsEdit", False)
        email = user_dtls.get("Email", "")
        full_name = f"{user_dtls.get('FirstName', '')} {user_dtls.get('LastName', '')}"
        generated_password = self.generate_password(10)
        print(f"New User : {email} Password : {generated_password}")
        active_project = user_dtls.get("ActiveProject", "")

        prj_details = user_dtls.get("PrjDetails", [])
        role_id = user_dtls.get("RoleId") 
        team_id = user_dtls.get("TeamId") 

        if not email or not prj_details:
            raise ValidationError("Email and Project details are required")

        # Load project mappings (optional, if you validate names)
        projects_map = {p["projectName"]: p["projectId"] for p in self.project.find({})}


        enriched_projects = []
        for prj in prj_details:
            project_name = prj.get("project_name")
            team_name = prj.get("team_name")
            role_name = prj.get("role_name")
            prj_id = projects_map.get(project_name)
            role_id_item = prj.get("RoleId", role_id)
            team_id_item = prj.get("TeamId", team_id)

            enriched_projects.append({
                "prj_name": project_name,
                "prj_id": prj_id,
                "team_name": team_name,
                "role_name": role_name,
                "RoleId": role_id_item,
                "TeamId": team_id_item
            })

        if not is_edit:
            user_onboard = {
                "FirstName": user_dtls.get("FirstName", ""),
                "LastName": user_dtls.get("LastName", ""),
                "Email": email,
                "Salt": salt_encrypt,
                "Password": self.generate_hash(generated_password, self.config.SECRET_KEY, salt_encrypt),
                "RoleId": role_id, 
                "TeamId": team_id,  
                "PrjDetails": enriched_projects,
                "ActiveProject": active_project,
                "IsActive": True,
                "IsDelete": False,
                "Avatar":"",
                "CreatedBy": user_dtls.get("CreatedBy", ""),
                "CreatedDate": self.utils.get_current_timestamp()
            }

            result = self.user_collection.insert_one(user_onboard)
            user_onboard_op = {
                'type': 'insert_one',
                'document': {
                    "FirstName": user_dtls.get("FirstName", ""),
                    "LastName": user_dtls.get("LastName", ""),
                    "Email": email,
                    "Salt": salt_encrypt,
                    "Password": self.generate_hash(
                        generated_password,
                        self.config.SECRET_KEY,
                        salt_encrypt
                    ),
                    "RoleId": role_id,
                    "TeamId": team_id,
                    "PrjDetails": enriched_projects,
                    "ActiveProject": active_project,
                    "IsActive": True,
                    "IsDelete": False,
                    "Avatar":"",
                    "CreatedBy": user_dtls.get("CreatedBy", ""),
                    "CreatedDate": self.utils.get_current_timestamp()
                }
            }
            for prj in prj_details:
                project_name = prj.get("project_name")
                result = self.project.find_one(
                    {"projectName": project_name},
                    {"database_name": 1, "_id": 0}
                )

                user_type = result.get("database_name") if result else "master"

                
                find_op ={
                    'type': 'find_one', 
                    'filter': {
                        "Email": re.compile(f"^{re.escape(email)}$", re.IGNORECASE),
                        "IsActive": True,
                        "IsDelete": False
                    }
                }
                existing = self._query_db('user',find_op, user_type)
                if not existing:
                    self._query_db('user',user_onboard_op, user_type)
                # db_type = DatabaseType[project_name.upper()]
                # project_collection = self.db._collections[db_type]['user']
                # project_collection.insert_one(user_onboard)



            #self.send_mail(email, full_name, generated_password, 'Welcome')

        else:
            userdata = self.user_collection.find_one({"Email": re.compile(f"^{re.escape(email)}$", re.IGNORECASE),
                "IsActive": True,
                "IsDelete": False},{"_id":0})
            user_avatar = userdata.get("Avatar","")
            update_fields = {
                "RoleId": role_id,  
                "TeamId": team_id,
                "PrjDetails": enriched_projects,
                "ActiveProject": active_project,
                "UpdatedBy": user_dtls.get("CreatedBy", ""),
                "UpdatedDate": datetime.now(timezone.utc)
            }
            new_fields = {
                    "FirstName": user_dtls.get("FirstName", ""),
                    "LastName": user_dtls.get("LastName", ""),
                    "Email": email,
                    "Salt": salt_encrypt,
                    "Password": self.generate_hash(
                        generated_password,
                        self.config.SECRET_KEY,
                        salt_encrypt
                    ),
                    "RoleId": role_id,
                    "TeamId": team_id,
                    "PrjDetails": enriched_projects,
                    "ActiveProject": active_project,
                    "IsActive": True,
                    "Avatar":"user_avatar",
                    "IsDelete": False,
                    "CreatedBy": user_dtls.get("CreatedBy", ""),
                    "CreatedDate": self.utils.get_current_timestamp()
            }

            result = self.user_collection.update_one(
                {"Email": re.compile(f"^{re.escape(email)}$", re.IGNORECASE), "IsActive": True, "IsDelete": False},
                {"$set": update_fields}
            )
            update_op = {
                'type': 'update_one',
                'filter': {"Email": re.compile(f"^{re.escape(email)}$", re.IGNORECASE), "IsActive": True, "IsDelete": False},
                'update': {"$set": update_fields}
            }
            insert_op = {
                'type': 'insert_one',
                'document': new_fields
                }
            find_op ={
                'type': 'find_one',
                'filter': {
                    "Email": re.compile(f"^{re.escape(email)}$", re.IGNORECASE),
                    "IsActive": True,
                    "IsDelete": False
                }
            }
            for prj in prj_details:
                project_name = prj.get("project_name")
                result = self.project.find_one(
                    {"projectName": project_name},
                    {"database_name": 1, "_id": 0}
                )

                user_type = result.get("database_name") if result else "master"
                ##print("new user",user_type)
                existing = self._query_db('user',find_op, user_type)
                if existing:
                    self._query_db('user',update_op, user_type)
                else:
                    
                    self._query_db('user',insert_op, user_type)
                
            #     db_type = DatabaseType[project_name.upper()]
            #     project_collection = self.db._collections[db_type]['user']
            #     project_collection.update_one(
            #     {"Email": re.compile(f"^{re.escape(email)}$", re.IGNORECASE), "IsActive": True, "IsDelete": False},
            #     {"$set": update_fields}
            # )

            # if result.matched_count == 0:
                # return {"Success": False, "Message": "User not found for update"}

        updated_user = self.user_collection.find_one(
            {"Email": re.compile(f"^{re.escape(email)}$", re.IGNORECASE), "IsActive": True}
        )

        response_user = self.clean_document(updated_user)
        return {
            "Email": email,
            "UserName": full_name,
            "RoleId": response_user.get("RoleId"), 
            "TeamId": response_user.get("TeamId"),
            "PrjDetails": response_user.get("PrjDetails", [])
        }


        
  
    def get_project_teams_roles(self, data):
        project_id = data.get("projectId")
        team_name = data.get("teamName")  # since roles are inside team

        if not project_id:
            raise ValidationError ("projectId is required")
        
        # Case 1: Project selected → return all teams
        if not team_name:
            project_op = {
                'type': 'find_one',
                'filter': {"projectId": int(project_id)},
                'projection': {"_id": 0, "teams": 1}
            }
            project = self._query_db('project', project_op)
            if not project or "teams" not in project:
                return { "teams": [], "message": "No teams found for this project" }

            return {"projectId": project_id, "teams": project["teams"] }

        # Case 2: Team selected → return roles
        project_op = {
            'type': 'find_one',
            'filter': {"projectId": int(project_id)},
            'projection': {"_id": 0, "teams": 1}
        }
        project = self._query_db('project', project_op)
        if not project or "teams" not in project:
            return {"roles": [], "message": "No roles found for this team"}

        # Find the team inside the project
        team = next((t for t in project["teams"] if t["teamName"] == team_name), None)
        if not team:
            return { "roles": [], "message": "Team not found in this project"}

        return { "teamName": team_name, "roles": team.get("roles", [])}


    def perform_get_teams(self, payload):
        project_name = payload.get("projectName", "").strip()
        if not project_name:
            raise ValidationError("projectName is required")

        project_doc = self.project.find_one(
            {"projectName": project_name},
            {"_id": 0, "teams": 1}
        )
        if not project_doc or not project_doc.get("teams"):
            raise ValidationError( f"No teams found for project: {project_name}")

        teams_response = [
            {
                "teamName": t.get("teamName"),
                "roles": [r.get("role") for r in t.get("roles", [])]
            } for t in project_doc.get("teams", [])
        ]

        return { "ProjectName": project_name, "Teams": teams_response }



    def perform_get_roles(self, payload):
        project_name = payload.get("projectName", "").strip()
        team_name = payload.get("teamName", "").strip()

        if not project_name or not team_name:
            raise ValidationError("projectName and teamName are required")

        project_op = {'type': 'find_one', 'filter': {"projectName": project_name}}
        project_doc = self._query_db('project', project_op)
        if not project_doc or not project_doc.get("teams"):
            raise ValidationError("Project not found or has no teams")

        team_data = next(
            (t for t in project_doc.get("teams", []) if t.get("teamName") == team_name),
            None
        )
        if not team_data:
            raise ValidationError("Team not found in this project")

        roles = [r.get("role") for r in team_data.get("roles", [])]
        return { "Project": project_name, "Team": team_name, "Roles": roles}
 
        
    def update_user_service(self, data):
        email = data.get("Email", "").strip()
        new_pwd = data.get("Password", None)
        avatar = data.get("Avatar", None)

        # Find master user first
        user = self.user_collection.find_one(
            {"Email": re.compile(f"^{re.escape(email)}$", re.IGNORECASE),
            "IsActive": True, "IsDelete": False}
        )
        
        # Prepare update fields 
        update_fields = {
            "UpdatedDate": self.utils.get_current_timestamp(),
            "UpdatedBy": email
        }

        if new_pwd and new_pwd.strip() != "":
            
                salt = user.get("Salt", "")
                stored_password = user.get("Password", "")

                if not self.pwd_are_equal(new_pwd, stored_password, self.config.SECRET_KEY, salt):
                    print("Change Password","true")
                    new_hashed_password = self.generate_hash(new_pwd, self.config.SECRET_KEY, salt)
                    update_fields["Password"] = new_hashed_password
                else:
                    print("Change Password","false")
                    raise ValidationError("New password cannot be the same as the old password")
            
        if avatar and avatar.strip() != "":
            
            update_fields["Avatar"] = avatar

        # Now update all project databases
        projects = user.get("PrjDetails", [])
        for project in projects:
            project_name = project.get("prj_name")
            result = self.project.find_one(
                {"projectName": project_name},
                {"database_name": 1, "_id": 0}
            )
            user_type = result.get("database_name") if result else "master"

            # Optional: verify user exists in this project DB (skip if not found)
            user_op = {
                'type': 'find_one',
                'filter': {
                    "Email": re.compile(f"^{re.escape(email)}$", re.IGNORECASE),
                    "IsActive": True,
                    "IsDelete": False
                }
            }
            user_in_project = self._query_db('user', user_op, user_type)
            if not user_in_project:
                continue  # or log warning, but don't fail entire update

            # Perform update in project DB
            update_op = {
                'type': 'update_one',
                'filter': {
                    "Email": re.compile(f"^{re.escape(email)}$", re.IGNORECASE),
                    "IsActive": True,
                    "IsDelete": False
                },
                'update': {"$set": update_fields}
            }
            self._query_db('user', update_op, user_type)

        # Finally, update the master collection
        self.user_collection.update_one(
            {"Email": re.compile(f"^{re.escape(email)}$", re.IGNORECASE),
            "IsActive": True, "IsDelete": False},
            {"$set": update_fields}
        )

        return True,avatar

    def user_active_or_inactive_service(self, user_dtls):
        email_id = user_dtls.get("EmailId", "")
        status = user_dtls.get("Status", False)
        updated_by = user_dtls.get("LogginUser", "")

        status = not status  
        
        update_fields = {
            "IsActive": status,
            "UpdatedBy": updated_by,
            "UpdatedDate": datetime.now(timezone.utc)
        }

        # Update using database manager
        update_op = {
            'type': 'update_one',
            'filter': {"Email": re.compile(f"^{re.escape(email_id)}$", re.IGNORECASE)},
            'update': {"$set": update_fields}
        }
        self._query_db('user', update_op)
        
        # Get all users using database manager
        users_op = {'type': 'find', 'filter': {"IsDelete": False}}
        all_users = self._query_db('user', users_op)
        all_users = [self.clean_document(u) for u in all_users]
        
        # Get roles and teams using database manager
        roles_op = {'type': 'find', 'filter': {}}
        roles_data = self._query_db('role', roles_op)
        roles = {r["RoleId"]: r["RoleName"] for r in roles_data}
        
        teams_op = {'type': 'find', 'filter': {}}
        teams_data = self._query_db('team', teams_op)
        teams = {r["TeamId"]: r["TeamName"] for r in teams_data}

        for user in all_users:
            user["RoleName"] = roles.get(user.get("RoleId"), "Unknown")
            user["TeamName"] = teams.get(user.get("TeamId"), "Unknown")

        return {
            "IsActive": update_fields.get('IsActive'),
            "UserManagement": all_users
        }
        
    def delete_user_details_service(self, user_dtls):
        email_id = user_dtls.get("EmailId", "")
        updated_by = user_dtls.get("LogginUser", "")
        project_names = user_dtls.get("ProjectName", [])

        # Normalize project_names to list
        if isinstance(project_names, str):
            project_names = [project_names]

        now = datetime.now(timezone.utc)

        # Common filter for case-insensitive email match
        email_filter = {
            "Email": re.compile(f"^{re.escape(email_id)}$", re.IGNORECASE),
            "IsDelete": False
        }

        # Fields to update
        update_fields = {
            "IsDelete": True,
            "UpdatedBy": updated_by,
            "UpdatedDate": now,
            "IsActive": False
        }

        # 1️⃣ Update in master DB
        self.user_collection.update_one(
            email_filter,
            {"$set": update_fields}
        )

        # 2️⃣ Update in each project DB
        project_update_op = {
            'type': 'update_one',
            'filter': email_filter,
            'update': {"$set": update_fields}
        }

        for project in project_names:
            result = self.project.find_one(
                {"projectName": project},
                {"database_name": 1, "_id": 0}
            )
            user_type = result.get("database_name") if result else "master"
            self._query_db('user', project_update_op, user_type)

        # 3️⃣ Return refreshed user list
        active_users = list(self.user_collection.find({"IsDelete": False}))
        active_users = [self.clean_document(u) for u in active_users]

        # Attach role names
        roles = {r["RoleId"]: r["RoleName"] for r in self.role_collection.find({})}
        for user in active_users:
            user["RoleName"] = roles.get(user.get("RoleId"), "Unknown")

        return {
            "UserManagement": active_users
        }


    def upload_image_helper(self):
        if 'file' not in request.files:
            raise ValidationError ('No file part')
        
        uploaded_file = request.files['file']
        if uploaded_file.filename == '':
            raise ValidationError ('No selected file')

        original_name = uploaded_file.filename.rsplit('.', 1)[0]
        ext = uploaded_file.filename.rsplit('.', 1)[-1].lower()

        unique_filename = f"{original_name}-{self.utils.generate_uuid()[:8]}.{ext}"

        full_path = os.path.join(self.config.UserImage_folder, unique_filename)
        uploaded_file.save(full_path)

        with open(full_path, "rb") as image_file:
            encoded_string = base64.b64encode(image_file.read()).decode('utf-8')

        file_path = f"assets/userprofile/{unique_filename}"
        data_url = f"data:image/{ext};base64,{encoded_string}"

        return {'filePath': file_path, 'dataUrl': data_url}

    def create_salt(self, size: int) -> str:
        random_bytes = secrets.token_bytes(size)
        return base64.b64encode(random_bytes).decode('utf-8')

    def validate_password(self):
        data = request.get_json()
        email = data.get("Email", "").strip()
        password = data.get("Password", "")

        if not email or not password:
            raise ValidationError("Missing required fields")

        # Find user using database manager
        user_op = {
            'type': 'find_one',
            'filter': {"Email": email, "IsActive": True, "IsDelete": False}
        }
        user = self._query_db('user', user_op)
        
        if not user:
            raise ValidationError("User not found or inactive")

        salt = user.get("Salt", "")
        stored_password = user.get("Password", "")
        print("Validate_plain_input",password)
        print("Validate_secret_key",self.config.SECRET_KEY)
        print("Validate_store",stored_password)
        print("Validate_salt",salt)
        
        if self.pwd_are_equal(password, stored_password, self.config.SECRET_KEY, salt):
            raise ValidationError("New password should not be same as old password")

        return True
        
    def switch_projectname(self, prj_name):
        current_user = get_current_user()
        if not current_user:
            raise ValidationError("User session not found")
        user_type ="master"
        email_id = current_user.get('user_id')
        if not email_id:
            raise ValidationError("User email not found in session")
        
        # Update user using database manager
        update_op = {
            'type': 'update_one',
            'filter': {"Email": re.compile(f"^{re.escape(email_id)}$", re.IGNORECASE),"IsActive": True, "IsDelete": False},
            'update': {"$set": {"ActiveProject": prj_name}}
        }
        
        self._query_db('user', update_op,user_type)
        
        # Get updated user data and refresh session
        user_op = {'type': 'find_one', 'filter': {"Email": re.compile(f"^{re.escape(email_id)}$", re.IGNORECASE),"IsActive": True, "IsDelete": False}}
        user_data = self._query_db('user', user_op,user_type)
        session_manager.replace_session(current_user['session_id'], user_data)
        
        return True
        
    # CREATE / ONBOARD PROJECT
    def onboard_project_details(self, request):
        project_details = request.get_json()
        ##print("Raw data:", project_details)
        
        project_name = project_details.get('projectName')
        project_desc = project_details.get('project_desc', "")
        active = project_details.get('active', True)
        teams = project_details.get('teams', [])
        user_type = project_details.get('project_db_name', "")
        app_url = project_details.get('app_url', "")

        if not project_name:
            raise ValidationError("Project name is required")

        if not teams:
            raise ValidationError("At least one team is required")

        # ✅ Check if project already exists
        existing_project = self.project.find_one({"projectName": project_name})
        if existing_project:
            raise ValidationError(f"Project '{project_name}' already exists")

        # ✅ Create project doc
        project_id = self.generate_project_id()
        valid_teams = []
        for t in teams:
            team_name = t.get("teamName")
            roles = t.get("roles", [])
            if team_name:
                valid_teams.append({
                    "teamName": team_name.strip(),
                    "roles": [{"role": r.get("role")} for r in roles if r.get("role")]
                })

        if not valid_teams:
            raise ValidationError("No valid teams provided")

        project_doc = {
            "projectName": project_name,
            "projectId": project_id,
            "project_desc": project_desc,
            "description": project_desc,
            "active": active,
            "teams": valid_teams,
            "database_name": user_type,
            "app_url": app_url,
            "dateCreated": datetime.now().strftime("%Y-%m-%d")
        }

        # ✅ Insert into master project collection
        self.project.insert_one(project_doc)

        # ✅ Insert into project-specific DB (but check duplicates first)
        project_onboard_op = {
            'type': 'insert_one',
            'document': project_doc
        }
        self._query_db('project', project_onboard_op, user_type)

        # ✅ Insert related data for each team
        for t in teams:
            team_name = t.get("teamName")

            # Agencies
            agencies = list(self.agency_collection.find({"assigned_to": team_name,"is_deleted":False}, {"_id": 0}))
            if agencies:
                agency_ids = [a["agency_id"] for a in agencies]
                existing_agencies = list(self._query_db(
                    'agency',
                    {'type': 'find', 'filter': {'agency_id': {'$in': agency_ids}}, 'projection': {'agency_id': 1, '_id': 0}},
                    user_type
                ))
                existing_agency_ids = {a['agency_id'] for a in existing_agencies}

                new_agencies = [a for a in agencies if a["agency_id"] not in existing_agency_ids]
                if new_agencies:
                    cursor= self.workflow_collection.find({"agency_name": {"$in": [a["agency_name"] for a in new_agencies]}})
                    workflow_list = list(cursor)
                    # print("workflow",workflow_list)
                    if workflow_list:
                        self._query_db('workflow_collection', {'type': 'insert_many', 'documents': workflow_list}, user_type)
                    
                    

                    # Mappings
                    mappings = list(self.agent_agency_mapping_collection.find({"agency_id": {"$in": agency_ids},"status":"active"}, {"_id": 0}))
                    mapping_ids = [m["agent_id"] + "_" + m["agency_id"] for m in mappings]

                    existing_mappings = list(self._query_db(
                        'agent_agency_mapping',
                        {'type': 'find', 'filter': {'$or': [{"agent_id": m["agent_id"], "agency_id": m["agency_id"]} for m in mappings]}, 'projection': {'agent_id': 1, 'agency_id': 1, '_id': 0}},
                        user_type
                    ))
                    existing_mapping_ids = {em['agent_id'] + "_" + em['agency_id'] for em in existing_mappings}

                    new_mappings = [m for m in mappings if m["agent_id"] + "_" + m["agency_id"] not in existing_mapping_ids]
                    if new_mappings:
                        self._query_db('agent_agency_mapping', {'type': 'insert_many', 'documents': new_mappings}, user_type)

                    # Agents
                    agent_ids = [m["agent_id"] for m in mappings]
                    agents = list(self.agent_collection.find(
                        {"agent_id": {"$in": agent_ids}, "status": "active"},
                        {"_id": 0}
                         ))
                    existing_agents = list(self._query_db(
                        'agent',
                        {'type': 'find', 'filter': {'agent_id': {'$in': agent_ids},"status": "active"}, 'projection': {'agent_id': 1, '_id': 0}},
                        user_type
                    ))
                    existing_agent_ids = {ea['agent_id'] for ea in existing_agents}

                    new_agents = [a for a in agents if a["agent_id"] not in existing_agent_ids]
                    if new_agents:
                        self._query_db('agent', {'type': 'insert_many', 'documents': new_agents}, user_type)
                    
                    self._query_db('agency', {'type': 'insert_many', 'documents': new_agencies}, user_type)

                # Mappings
                mappings = list(self.agent_agency_mapping_collection.find({"agency_id": {"$in": agency_ids},"status":"active"}, {"_id": 0}))
                mapping_ids = [m["agent_id"] + "_" + m["agency_id"] for m in mappings]

                existing_mappings = list(self._query_db(
                    'agent_agency_mapping',
                    {'type': 'find', 'filter': {'$or': [{"agent_id": m["agent_id"], "agency_id": m["agency_id"]} for m in mappings]}, 'projection': {'agent_id': 1, 'agency_id': 1, '_id': 0}},
                    user_type
                ))
                existing_mapping_ids = {em['agent_id'] + "_" + em['agency_id'] for em in existing_mappings}

                new_mappings = [m for m in mappings if m["agent_id"] + "_" + m["agency_id"] not in existing_mapping_ids]
                if new_mappings:
                    self._query_db('agent_agency_mapping', {'type': 'insert_many', 'documents': new_mappings}, user_type)

                # Agents
                agent_ids = [m["agent_id"] for m in mappings]
                agents = list(self.agent_collection.find(
                    {"agent_id": {"$in": agent_ids}, "status": "active"},
                    {"_id": 0}
                ))

                existing_agents = list(self._query_db(
                    'agent',
                    {'type': 'find', 'filter': {'agent_id': {'$in': agent_ids},"status": "active"}, 'projection': {'agent_id': 1, '_id': 0}},
                    user_type
                ))
                existing_agent_ids = {ea['agent_id'] for ea in existing_agents}

                new_agents = [a for a in agents if a["agent_id"] not in existing_agent_ids]
                if new_agents:
                    self._query_db('agent', {'type': 'insert_many', 'documents': new_agents}, user_type)
                
                # 1. Find agents that have a valid knowledge_store with at least one entry with 'id'
                agents_with_kb = [
                    a for a in agents
                    if "knowledge_store" in a
                    and isinstance(a["knowledge_store"], list)
                    and a["knowledge_store"]  # not empty
                    and isinstance(a["knowledge_store"][0], dict)
                    and "id" in a["knowledge_store"][0]
                    and a["knowledge_store"][0]["id"]  # not falsy/empty string
                ]

                if agents_with_kb:
                    # Extract the knowledge store IDs
                    # Taking [0] → assumes usually one knowledge store per agent
                    knowstore_ids = [
                        a["knowledge_store"][0]["id"]
                        for a in agents_with_kb
                    ]

                    # Optional: remove duplicates (in case same kb is referenced by multiple agents)
                    knowstore_ids = list(set(knowstore_ids))

                    if knowstore_ids:
                        # Fetch from main/source knowledge base
                        kb_records = list(self.kb_collection.find(
                            {"rag_id": {"$in": knowstore_ids}},
                            # projection if you want to limit fields (recommended)
                            # {"name": 1, "enabled": 1, "content": 1, ...}
                        ))

                        # Check which ones already exist in the target collection
                        existing_kb = list(self._query_db(
                            'kb_collection',
                            {
                                'type': 'find',
                                'filter': {'rag_id': {'$in': knowstore_ids}}
                                },
                            user_type
                        ))

                        existing_kb_ids = {doc['_id'] for doc in existing_kb}

                        # Upsert logic: insert if missing, full replace if exists
                        for kb in kb_records:
                            kb_id = kb['rag_id']

                            if kb_id not in existing_kb_ids:
                                self._query_db(
                                    'kb_collection',
                                    {
                                        'type': 'insert_one',
                                        'document': kb
                                    },
                                    user_type
                                )
                            else:
                                # Full document replacement
                                # If you prefer to do partial update → change to $set on specific fields
                                self._query_db(
                                    'kb_collection',
                                    {
                                        'type': 'update_one',
                                        'filter': {'rag_id': kb_id},
                                        'update': {'$set': kb}          # replaces all fields
                                        # Alternative (safer): {'$set': {k: v for k, v in kb.items() if k != '_id'}}
                                    },
                                    user_type
                                )

        return True         
            
    def generate_project_id(self):
        try:
            # Find the project with the highest projectId
            last_project = self.project.find_one(sort=[("projectId", -1)])
            if last_project and "projectId" in last_project:
                return last_project["projectId"] + 1
            return 1  # Start from 1 if no projects exist
        except Exception as ex:
            logger.error(f"Error generating project ID: {str(ex)}")
            return 1   

    def get_all_projects_old(self):
        try:
            
            raw_projects = list(self.project.find({}))
            raw_projects.sort(key=lambda x: x.get("projectId", ""))
            projects = [self.clean_document(p) for p in raw_projects]

            
            project_teams = {
                p["projectName"]: [t["teamName"] for t in p.get("teams", [])]
                for p in projects
            }

            
            users = list(self.user_collection.find({"IsDelete": False}))
            user_count_map = {}
            for u in users:
                for prj in u.get("PrjDetails", []):
                    name = prj.get("prj_name")
                    if name:
                        user_count_map[name] = user_count_map.get(name, 0) + 1

           
            agencies = list(
                self.agency_collection.find({"is_deleted": False},
                                            {"agency_id": 1, "assigned_to": 1})
            )
            
            team_agencies = {}
            for ag in agencies:
                team = ag.get("assigned_to")
                if team:
                    team_agencies.setdefault(team, []).append(ag["agency_id"])

           
            agent_mappings = list(
                self.agent_agency_mapping_collection.find(
                    {"status": "active"},
                    {"agency_id": 1}
                )
            )
            agency_agent_count = {}
            for m in agent_mappings:
                aid = m.get("agency_id")
                if aid:
                    agency_agent_count[aid] = agency_agent_count.get(aid, 0) + 1

           
            project_stats = {}
            for proj_name, teams in project_teams.items():
                agency_ids = set()
                for team in teams:
                    agency_ids.update(team_agencies.get(team, []))

                agency_cnt = len(agency_ids)
                agent_cnt  = sum(agency_agent_count.get(aid, 0) for aid in agency_ids)

                project_stats[proj_name] = {
                    "AgencyCount": agency_cnt,
                    "AgentCount":  agent_cnt
                }

            
            for p in projects:
                name = p["projectName"]
                stats = project_stats.get(name, {"AgencyCount": 0, "AgentCount": 0})

                p["UserCount"]    = user_count_map.get(name, 0)
                p["AgencyCount"]  = stats["AgencyCount"]
                p["AgentCount"]   = stats["AgentCount"]

            return projects

        except Exception as ex:
            logging.error("Error in GetAllProjects:", exc_info=True)
            raise ex
            
    def get_all_projects(self):
        # Single aggregation pipeline for projects with teams
        projects_pipeline = [
            {"$project": {
                "projectName": 1, "project_desc": 1, "description": 1, "projectId": 1,"database_name":1,"dateCreated":1,"dateUpdated":1, 
                "app_url": 1,
                "teams": {"$ifNull": ["$teams", []]}
            }}
        ]
        projects = list(self.project.aggregate(projects_pipeline))
        projects = [self.clean_document(p) for p in projects]
        
        project_names = [p["projectName"] for p in projects if p.get("projectName")]
        if not project_names:
            return projects

        # Aggregation for user counts
        user_counts = list(self.user_collection.aggregate([
            {"$match": {"IsDelete": False, "PrjDetails.prj_name": {"$in": project_names}}},
            {"$unwind": "$PrjDetails"},
            {"$match": {"PrjDetails.prj_name": {"$in": project_names}}},
            {"$group": {"_id": "$PrjDetails.prj_name", "count": {"$sum": 1}}}
        ]))
        user_count_map = {u["_id"]: u["count"] for u in user_counts}

        # Calculate project stats per project using their specific databases
        project_stats = {}
        for p in projects:
            project_name = p.get("projectName")
            database_name = p.get("database_name", "master")
            
            if not project_name:
                continue
            
            # Check if this is MASTER_DB
            if project_name == self.config.MASTER_DB:
                total_agencies = self.agency_collection.count_documents({"is_deleted": False})
                total_agents = self.agent_collection.count_documents({"isDeleted": {"$ne": True}})
                project_stats[project_name] = {"AgencyCount": total_agencies, "AgentCount": total_agents}
            else:
                # Query project-specific database for agencies
                agency_op = {'type': 'find', 'filter': {"is_deleted": False}}
                agencies = self._query_db('agency', agency_op, database_name)
                
                # Count ALL agencies in this project to match marketplace
                agency_ids = {ag["agency_id"] for ag in agencies}
                
                # Count agents directly from project database (same as marketplace logic)
                # Match marketplace: count all non-deleted agents in the project
                agent_count_op = {
                    'type': 'count', 
                    'filter': {
                        "$or": [
                            {"isDeleted": {"$ne": True}},
                            {"isDeleted": {"$exists": False}}
                        ]
                    }
                }
                agent_count = self._query_db('agent', agent_count_op, database_name)
                
                project_stats[project_name] = {
                    "AgencyCount": len(agency_ids),
                    "AgentCount": agent_count
                }

        # Assign stats to projects
        for p in projects:
            name = p.get("projectName")
            if not name:
                continue
            
            stats = project_stats.get(name, {"AgencyCount": 0, "AgentCount": 0})
            p["AgencyCount"] = stats["AgencyCount"]
            p["AgentCount"] = stats["AgentCount"]
            p["UserCount"] = user_count_map.get(name, 0)

        return projects

    def update_project_details(self, project_id, request):
        data = request.get_json()
        update_fields = {}

        if "projectName" in data:
            update_fields["projectName"] = data["projectName"]
        if "project_desc" in data:
            update_fields["project_desc"] = data["project_desc"]
        if "description" in data:
            update_fields["description"] = data["description"]
        if "teams" in data:
            update_fields["teams"] = data["teams"]
        if "project_db_name" in data:
            update_fields["database_name"] = data["project_db_name"]
        if "app_url" in data:
            update_fields["app_url"] = data["app_url"]

        if not update_fields:
            raise ValidationError("No fields to update")
            
        update_fields["dateUpdated"] = datetime.now().strftime("%Y-%m-%d")

        from bson.objectid import ObjectId

        # ✅ Update the master project collection
        update_result = self.project.update_one(
            {"_id": ObjectId(project_id)},
            {"$set": update_fields}
        )

        if update_result.matched_count == 0:
            raise ValidationError("Project not found")

        # ✅ Determine user_type (database name)
        project_record = self.project.find_one(
            {"_id": ObjectId(project_id)},
            {"database_name": 1, "projectName": 1, "_id": 0}
        )
        user_type = project_record.get("database_name") if project_record else "master"
        project_name = project_record.get("projectName")

        # ✅ Mirror update to project collection in specific DB
        update_op = {
            'type': 'update_one',
            'filter': {"projectName": project_name},
            'update': {"$set": update_fields}
        }
        self._query_db('project', update_op, user_type)

        
        teams = data.get("teams", [])
        for t in teams:
            team_name = t.get("teamName")
            if not team_name:
                continue

            
            agencies = list(self.agency_collection.find({"assigned_to": team_name,"is_deleted":False}, {"_id": 0}))
            if agencies:
                agency_ids = [a["agency_id"] for a in agencies]

                existing_agencies = list(self._query_db(
                    'agency',
                    {'type': 'find', 'filter': {'agency_id': {'$in': agency_ids}}, 'projection': {'agency_id': 1, '_id': 0}},
                    user_type
                ))
                existing_agency_ids = {a['agency_id'] for a in existing_agencies}

                new_agencies = [a for a in agencies if a["agency_id"] not in existing_agency_ids]
                if new_agencies:
                    cursor= self.workflow_collection.find({"agency_name": {"$in": [a["agency_name"] for a in new_agencies]}})
                    workflow_list = list(cursor)
                    if workflow_list:
                        self._query_db('workflow_collection', {'type': 'insert_many', 'documents': workflow_list}, user_type)
                    
                    self._query_db('agency', {'type': 'insert_many', 'documents': new_agencies}, user_type)

            
            if agencies:
                mappings = list(self.agent_agency_mapping_collection.find({"agency_id": {"$in": agency_ids},"status":"active"}, {"_id": 0}))
                if mappings:
                    mapping_keys = {f"{m['agent_id']}_{m['agency_id']}" for m in mappings}
                    existing_mappings = list(self._query_db(
                        'agent_agency_mapping',
                        {'type': 'find', 'filter': {'$or': [{"agent_id": m["agent_id"], "agency_id": m["agency_id"]} for m in mappings]},
                        'projection': {'agent_id': 1, 'agency_id': 1, '_id': 0}},
                        user_type
                    ))
                    existing_mapping_keys = {f"{em['agent_id']}_{em['agency_id']}" for em in existing_mappings}

                    new_mappings = [m for m in mappings if f"{m['agent_id']}_{m['agency_id']}" not in existing_mapping_keys]
                    if new_mappings:
                        self._query_db('agent_agency_mapping', {'type': 'insert_many', 'documents': new_mappings}, user_type)


            if agencies:
                agent_ids = [m["agent_id"] for m in mappings] if mappings else []
                if agent_ids:
                    agents = list(self.agent_collection.find({"agent_id": {"$in": agent_ids},"status": "active"}, {"_id": 0}))
                    existing_agents = list(self._query_db(
                        'agent',
                        {'type': 'find', 'filter': {'agent_id': {'$in': agent_ids}}, 'projection': {'agent_id': 1, '_id': 0}},
                        user_type
                    ))
                    existing_agent_ids = {ea['agent_id'] for ea in existing_agents}
                    new_agents = [a for a in agents if a["agent_id"] not in existing_agent_ids]
                    if new_agents:
                        self._query_db('agent', {'type': 'insert_many', 'documents': new_agents}, user_type)
                        
                    agents_with_kb = [a for a in agents if "knowledge_store_id" in a and a["knowledge_store_id"]]

                    if agents_with_kb:
                        knowstore_ids = [a["knowledge_store_id"] for a in agents_with_kb]

                        
                        kb_records = list(self.kb_collection.find(
                            {"_id": {"$in": knowstore_ids}}
                                # Include any fields you need
                        ))

                        
                        existing_kb = list(self._query_db(
                            'kb_collection',
                            {'type': 'find', 'filter': {'_id': {'$in': knowstore_ids}}, 'projection': {'_id': 1}},
                            user_type
                        ))
                        existing_kb_ids = {k['_id'] for k in existing_kb}

                        
                        for kb in kb_records:
                            if kb['_id'] not in existing_kb_ids:
                                
                                self._query_db(
                                    'kb_collection',
                                    {
                                        'type': 'insert_one',
                                        'document': kb
                                    },
                                    user_type
                                )
                            else:
                                
                                self._query_db(
                                    'kb_collection',
                                    {
                                        'type': 'update_one',
                                        'filter': {'_id': kb['_id']},
                                        'update': {'$set': kb}
                                    },
                                    user_type
                                )

        return True

    def delete_project(self, project_id):
        from bson.objectid import ObjectId
        prj_id = self.project.find_one({"_id": ObjectId(project_id)}, {"projectId": 1, "_id": 0})

        result = self.project.delete_one({"_id": ObjectId(project_id)})

        # Get the value — whichever field actually exists
        prj_id_value = prj_id.get("projectId") if prj_id else None

        if prj_id_value is not None:

            self.user_collection.update_many(
                {"PrjDetails.prj_id": prj_id_value},                     # ← find documents where at least one array element has this prj_id
                {
                    "$pull": {
                        "PrjDetails": { "prj_id": prj_id_value }
                    }
                }
            )

        # db_type = DatabaseType[project_name.upper()]
        # project_collection = self.db._collections[db_type]['project']
        # project_collection.delete_one({"_id": ObjectId(project_id)})

        return result.deleted_count > 0 
        
    def get_all_teams_service(self):
        all_teams = list(self.team_collection.find({"IsActive": True}))
        all_teams = [self.clean_document(t) for t in all_teams]
        
        return all_teams

    def get_all_roles_service(self):
        all_roles = list(self.role_collection.find({"IsActive": True}))
        all_roles = [self.clean_document(r) for r in all_roles]
        
        return all_roles

    def util_process_mapping(self,agency_ids,user_type):
                    
        # Mappings
        mappings = list(self.agent_agency_mapping_collection.find({"agency_id": {"$in": agency_ids},"status":"active"}, {"_id": 0}))
        mapping_ids = [m["agent_id"] + "_" + m["agency_id"] for m in mappings]

        existing_mappings = list(self._query_db(
            'agent_agency_mapping',
            {'type': 'find', 'filter': {'$or': [{"agent_id": m["agent_id"], "agency_id": m["agency_id"]} for m in mappings]}, 'projection': {'agent_id': 1, 'agency_id': 1, '_id': 0}},
            user_type
        ))
        existing_mapping_ids = {em['agent_id'] + "_" + em['agency_id'] for em in existing_mappings}

        new_mappings = [m for m in mappings if m["agent_id"] + "_" + m["agency_id"] not in existing_mapping_ids]
        if new_mappings:
            self._query_db('agent_agency_mapping', {'type': 'insert_many', 'documents': new_mappings}, user_type)

        # Agents
        agent_ids = [m["agent_id"] for m in mappings]
        agents = list(self.agent_collection.find(
            {"agent_id": {"$in": agent_ids}, "status": "active"},
            {"_id": 0}
                ))
        existing_agents = list(self._query_db(
            'agent',
            {'type': 'find', 'filter': {'agent_id': {'$in': agent_ids},"status": "active"}, 'projection': {'agent_id': 1, '_id': 0}},
            user_type
        ))
        existing_agent_ids = {ea['agent_id'] for ea in existing_agents}

        new_agents = [a for a in agents if a["agent_id"] not in existing_agent_ids]
        if new_agents:
            self._query_db('agent', {'type': 'insert_many', 'documents': new_agents}, user_type)

        return agents
    
# # Global instance for backward compatibility
# user_manager = UserManager()

# # Function wrappers for backward compatibility
# def perform_login(user_details):
#     return user_manager.perform_login(user_details)

# def create_salt(size: int):
#     return user_manager.create_salt(size)

# def fetch_recaptcha_config():
#     return user_manager.fetch_recaptcha_config()

# def verify_token(token):
#     return user_manager.verify_token(token)

# def send_otp_details(user_data):
#     return user_manager.send_otp_details(user_data)

# def validate_otp_service(user_details):
#     return user_manager.validate_otp_service(user_details)

# def get_user_details_service():
#     return user_manager.get_user_details_service()

# def perform_add_user(user_dtls):
#     return user_manager.perform_add_user(user_dtls)

# def get_project_teams_roles(data):
#     return user_manager.get_project_teams_roles(data)

# def perform_get_teams(payload):
#     return user_manager.perform_get_teams(payload)

# def perform_get_roles(payload):
#     return user_manager.perform_get_roles(payload)

# def update_user_service(data):
#     return user_manager.update_user_service(data)

# def user_active_or_inactive_service(user_dtls):
#     return user_manager.user_active_or_inactive_service(user_dtls)

# def delete_user_details_service(user_dtls):
#     return user_manager.delete_user_details_service(user_dtls)

# def perform_sent_mail_user_management(mail_id):
#     return user_manager.perform_sent_mail_user_management(mail_id)

# def validate_password():
#     return user_manager.validate_password()

# def switch_projectname(prj_name):
#     return user_manager.switch_projectname(prj_name)

# def onboard_project_details(request):
#     return user_manager.onboard_project_details(request)

# def get_all_projects():
#     return user_manager.get_all_projects()

# def update_project_details(project_id, request):
#     return user_manager.update_project_details(project_id, request)

# def delete_project(project_id):
#     return user_manager.delete_project(project_id)

# def get_all_teams_service():
#     return user_manager.get_all_teams_service()

# def get_all_roles_service():
#     return user_manager.get_all_roles_service()
