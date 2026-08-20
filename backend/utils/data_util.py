import json

from config_loader import config_loader
from cryptography.fernet import Fernet, InvalidToken

cipher_suite = Fernet(config_loader.encryption_key)

def is_encrypted(value) -> bool:
    if not value or not isinstance(value, str):
        return False
        
    return value.startswith("gAAAAA") and len(value) > 90


def decrypt_data(data: dict) -> dict:
    decrypted_data = {}

    for key, value in data.items():
        if is_encrypted(value):
            try:
                decrypted_bytes = cipher_suite.decrypt(value.encode("utf-8"))
                decrypted_str = decrypted_bytes.decode("utf-8")
                
                try:
                    decrypted_data[key] = json.loads(decrypted_str)
                except (json.JSONDecodeError, TypeError):
                    decrypted_data[key] = decrypted_str
                    
            except InvalidToken:
                decrypted_data[key] = value
        else:
            decrypted_data[key] = value

    return decrypted_data


def encrypt_data(data: dict) -> dict:
    encrypted_credentials = {}

    for key, value in data.items():
        if is_encrypted(value):
            encrypted_credentials[key] = value
            continue

        if isinstance(value, (dict, list)):
            str_val = json.dumps(value)
        else:
            str_val = str(value)

        encrypted_bytes = cipher_suite.encrypt(str_val.encode("utf-8"))
        encrypted_credentials[key] = encrypted_bytes.decode("utf-8")

    return encrypted_credentials