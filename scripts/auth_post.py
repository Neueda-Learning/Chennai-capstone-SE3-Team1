#!/usr/bin/env python3
"""POST to the auth service the way the UI does: encrypted, and print the decrypted reply.

Every POST under /auth takes an encrypted envelope (see Application/Services/auth-service/README.md,
"Credentials over plain HTTP"), so curl with a JSON body is refused with 422. Use this instead:

    python scripts/auth_post.py login '{"username":"priya.menon","password":"Correct-Horse-Battery-9"}'
    python scripts/auth_post.py refresh '{"refreshToken":"..."}'
    python scripts/auth_post.py logout '{"refreshToken":"..."}' --token <ACCESS_TOKEN>

Or from Python:  from auth_post import post;  status, body = post("http://localhost:3000", "login", {...})
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _request(method: str, url: str, body: bytes | None = None, token: str | None = None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as failure:
        return failure.code, failure.read()


def post(base: str, path: str, body: dict, token: str | None = None) -> tuple[int, object]:
    """Encrypt `body`, POST it to {base}/auth/{path}, and return (status, decrypted JSON)."""
    base = base.rstrip("/")
    status, raw = _request("GET", f"{base}/auth/crypto-params")
    if status != 200:
        return status, json.loads(raw or b"null")
    params = json.loads(raw)

    key = os.urandom(32)
    iv = os.urandom(12)
    nonce = params["nonce"].encode()
    sealed = AESGCM(key).encrypt(iv, json.dumps(body).encode(), nonce)  # ciphertext + 16-byte tag
    public_key = serialization.load_pem_public_key(params["publicKey"].encode())
    wrapped = public_key.encrypt(
        key,
        padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
    )
    envelope = {
        "v": 1,
        "nonce": params["nonce"],
        "ek": base64.b64encode(wrapped).decode(),
        "iv": base64.b64encode(iv).decode(),
        "ct": base64.b64encode(sealed).decode(),
    }

    status, raw = _request("POST", f"{base}/auth/{path}", json.dumps(envelope).encode(), token)
    reply = json.loads(raw) if raw else None
    if status < 300 and isinstance(reply, dict) and reply.get("v") == 1 and "ct" in reply:
        plain = AESGCM(key).decrypt(base64.b64decode(reply["iv"]), base64.b64decode(reply["ct"]), nonce)
        reply = json.loads(plain)
    return status, reply


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("path", help="route under /auth, e.g. login, register, refresh")
    parser.add_argument("body", help="JSON request body")
    parser.add_argument("--base", default="http://localhost:3000", help="auth service URL")
    parser.add_argument("--token", help="access token, for routes that need one (logout)")
    args = parser.parse_args()

    status, reply = post(args.base, args.path, json.loads(args.body), args.token)
    print(json.dumps(reply, indent=2))
    return 0 if status < 300 else 1


if __name__ == "__main__":
    sys.exit(main())
