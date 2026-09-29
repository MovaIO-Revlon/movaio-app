import base64
import os
from typing import Optional

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes, padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from dotenv import load_dotenv

load_dotenv()

AES_BLOCK_SIZE_BITS = 128
AES_KEY_SIZE_BYTES = 32
AES_IV_SIZE_BYTES = 16
PBKDF2_SALT_SIZE_BYTES = 16
PBKDF2_ITERATIONS = 200_000

SECRET_KEY = os.getenv("SECRET_KEY", "default_secret_key")

def _derive_key(password: str, salt: Optional[bytes] = None) -> tuple[bytes, bytes]:
    """Derive a 32-byte AES-256 key from a password using PBKDF2-HMAC-SHA256."""
    if salt is None:
        salt = os.urandom(PBKDF2_SALT_SIZE_BYTES)

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=AES_KEY_SIZE_BYTES,
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
        backend=default_backend(),
    )
    key = kdf.derive(password.encode("utf-8"))
    return key, salt


def _pad(data: bytes) -> bytes:
    padder = padding.PKCS7(AES_BLOCK_SIZE_BITS).padder()
    return padder.update(data) + padder.finalize()


def _unpad(data: bytes) -> bytes:
    unpadder = padding.PKCS7(AES_BLOCK_SIZE_BITS).unpadder()
    return unpadder.update(data) + unpadder.finalize()


def _encrypt_bytes(plaintext: bytes, key: bytes, iv: bytes) -> bytes:
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    encryptor = cipher.encryptor()
    padded = _pad(plaintext)
    return encryptor.update(padded) + encryptor.finalize()


def _decrypt_bytes(ciphertext: bytes, key: bytes, iv: bytes) -> bytes:
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    decryptor = cipher.decryptor()
    padded = decryptor.update(ciphertext) + decryptor.finalize()
    return _unpad(padded)


def encrypt_text(plaintext: str,) -> str:
    """Encrypt text with AES-256-CBC and return a base64-encoded string.

    The output is encoded as: salt || iv || ciphertext.
    """
    key, salt = _derive_key(SECRET_KEY)
    iv = os.urandom(AES_IV_SIZE_BYTES)
    ciphertext = _encrypt_bytes(plaintext.encode("utf-8"), key, iv)
    token = salt + iv + ciphertext
    return base64.b64encode(token).decode("utf-8")


def decrypt_text(token: str) -> str:
    """Decrypt a base64-encoded AES-256-CBC token created by encrypt_text."""
    decoded = base64.b64decode(token.encode("utf-8"))
    if len(decoded) < PBKDF2_SALT_SIZE_BYTES + AES_IV_SIZE_BYTES:
        raise ValueError("Invalid encrypted payload.")

    salt = decoded[:PBKDF2_SALT_SIZE_BYTES]
    iv = decoded[PBKDF2_SALT_SIZE_BYTES:PBKDF2_SALT_SIZE_BYTES + AES_IV_SIZE_BYTES]
    ciphertext = decoded[PBKDF2_SALT_SIZE_BYTES + AES_IV_SIZE_BYTES :]
    key, _ = _derive_key(SECRET_KEY, salt)
    plaintext_bytes = _decrypt_bytes(ciphertext, key, iv)
    return plaintext_bytes.decode("utf-8")


if __name__ == "__main__":
    sample_text = "NaveenKumar.ReddyR@movate.com"

    encrypted = encrypt_text(sample_text)
    print("Encrypted:", encrypted)

    decrypted = decrypt_text(encrypted)
    print("Decrypted:", decrypted)
