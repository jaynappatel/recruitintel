import base64
import re
from typing import Protocol

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_AAD = b"recruitintel-calendar-token:v1"
_HEX_KEY = re.compile(r"^[0-9a-fA-F]{64}$")


class CredentialCipher(Protocol):
    def encrypt(self, plaintext: str) -> str: ...

    def decrypt(self, envelope: str) -> str: ...


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


class AesGcmCredentialCipher:
    def __init__(self, encoded_key: str) -> None:
        value = encoded_key.strip()
        key = bytes.fromhex(value) if _HEX_KEY.fullmatch(value) else _b64url_decode(value)
        if len(key) != 32:
            raise ValueError("CALENDAR_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes")
        self._cipher = AESGCM(key)

    def encrypt(self, plaintext: str) -> str:
        if not plaintext:
            raise ValueError("cannot encrypt an empty credential")
        import os

        nonce = os.urandom(12)
        encrypted = self._cipher.encrypt(nonce, plaintext.encode(), _AAD)
        ciphertext, tag = encrypted[:-16], encrypted[-16:]
        return ".".join(
            ("v1", _b64url_encode(nonce), _b64url_encode(ciphertext), _b64url_encode(tag))
        )

    def decrypt(self, envelope: str) -> str:
        parts = envelope.split(".")
        if len(parts) != 4 or parts[0] != "v1":
            raise ValueError("encrypted credential envelope is invalid")
        nonce, ciphertext, tag = (_b64url_decode(value) for value in parts[1:])
        if len(nonce) != 12 or len(tag) != 16:
            raise ValueError("encrypted credential envelope is invalid")
        return self._cipher.decrypt(nonce, ciphertext + tag, _AAD).decode()
