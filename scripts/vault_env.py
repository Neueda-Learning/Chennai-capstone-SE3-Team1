"""Secrets for the Python tools: the TrustMe vault first, then an environment variable, then .env.

The vault is opened only when a password is supplied without a prompt (``-X trustme_password``,
``-X trustme_password_file``, or ``TRUSTME_PASSWORD``/``TRUSTME_PASSWORD_FILE`` in the environment or
.env) and the key file
exists, so a machine without the vault reads the repository's ``.env`` instead of stopping to ask.
A secret the vault does not hold also falls back, one secret at a time.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
KEY_FILE = REPO_ROOT / "leapcapstoneteam1-720d03.TM"
DOTENV = REPO_ROOT / ".env"

# Vault secret name to the environment variable that stands in for it.
ENV_NAMES = {
    "JWT_SECRET": "JWT_SECRET",
    "PostGres_Host": "POSTGRES_HOST",
    "Postgres_Port": "POSTGRES_PORT",
    "Postgres_DB": "POSTGRES_DB",
    "PostGres_User": "POSTGRES_USER",
    "PostGres": "POSTGRES_PASSWORD",
    "Fauxnance": "FAUXNANCE_API_KEY",
    "Fauxnance_Endpoint": "FAUXNANCE_BASE_URL",
    "AUTH_PRIVATE_KEY": "AUTH_PRIVATE_KEY",
}

_UNSET = object()
_vault = _UNSET
_dotenv: Optional[dict] = None


def env_name_for(secret_name: str) -> str:
    return ENV_NAMES.get(secret_name, secret_name.upper())


def parse_dotenv(text: str) -> dict:
    values = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()
        key, sep, value = line.partition("=")
        if not sep or not key.strip():
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] == '"':
            value = value[1:-1].replace("\\n", "\n")
        elif len(value) >= 2 and value[0] == value[-1] == "'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def dotenv() -> dict:
    """The repository's .env as a dict (empty when there is none). It never touches os.environ."""
    global _dotenv
    if _dotenv is None:
        _dotenv = parse_dotenv(DOTENV.read_text(encoding="utf-8")) if DOTENV.is_file() else {}
    return _dotenv


def setting(name: str, default: Optional[str] = None) -> Optional[str]:
    """A plain setting: the environment variable, then .env, then the default."""
    value = os.environ.get(name)
    if value:
        return value
    return dotenv().get(name) or default


def _option(name: str) -> Optional[str]:
    value = sys._xoptions.get(name)
    return value if isinstance(value, str) and value else None


def _password() -> Optional[str]:
    inline = _option("trustme_password") or setting("TRUSTME_PASSWORD")
    if inline:
        return inline
    password_file = _option("trustme_password_file") or setting("TRUSTME_PASSWORD_FILE")
    if password_file:
        try:
            return Path(password_file.strip()).read_text(encoding="utf-8").strip()
        except OSError:
            return None
    return None


def vault():
    """The unlocked vault, or None when it is not available. Opened once per process."""
    global _vault
    if _vault is _UNSET:
        _vault = None
        key_file = Path(_option("trustme_keyfile") or setting("TRUSTME_KEY_FILE") or KEY_FILE)
        password = _password()
        if key_file.is_file() and password:
            try:
                import trustme_secrets as trustme

                _vault = trustme.using(key_file, password)
            except Exception as exc:  # noqa: BLE001 - any failure means "use the fallback"
                print("TrustMe vault could not be opened (" + str(exc) + "); using environment variables and .env",
                      file=sys.stderr)
    return _vault


def vault_secret(name: str) -> Optional[str]:
    """A secret from the vault only, or None when the vault is unavailable or does not hold it."""
    client = vault()
    if client is None:
        return None
    try:
        return client.fetch(name) or None
    except Exception:  # noqa: BLE001 - a missing secret is "not in the vault"
        return None


def secret(name: str, default: Optional[str] = None) -> Optional[str]:
    """A vault secret, else its environment variable, else .env, else ``default``."""
    return vault_secret(name) or setting(env_name_for(name), default)
