import jwt
import os
from dotenv import load_dotenv
from datetime import datetime, timedelta

load_dotenv()

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "")

def generate_jwt_token(email):
    try:
        payload = {
            "email": email,
            "iat": datetime.utcnow(),
            "exp": datetime.utcnow() + timedelta(hours=1)
        }
    
        return jwt.encode(payload, os.getenv("JWT_SECRET_KEY"), algorithm="HS256")
    except Exception as e:
        print(f"Error generating JWT token: {e}")
        return None