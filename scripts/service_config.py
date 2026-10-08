"""Where the services live, for the Python tools: Application/Config/services.env.

The one place hosts, ports and URLs are written down (see Application/Config/README.md). Nothing in
the Python code repeats them; it asks this module. A value is looked up in this order:

    1. a real environment variable,
    2. the git-ignored .env at the repo root,
    3. Application/Config/services.env.

Usage:
    import service_config as cfg
    cfg.url("TRADE_API")        # scheme://host:port, from TRADE_API_HOST and TRADE_API_PORT
    cfg.port("KAFKA")           # the number in KAFKA_PORT
    cfg.value("FAUXNANCE_BASE_URL")
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_FILE = REPO_ROOT / "Application" / "Config" / "services.env"
DOTENV_FILE = REPO_ROOT / ".env"

_file_values: Optional[dict] = None
_dotenv_values: Optional[dict] = None


class ConfigError(RuntimeError):
    pass


def parse_env(text: str) -> dict:
    """KEY=value lines; comments, blank lines and an optional leading "export " are ignored."""
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


def _read(path: Path) -> dict:
    return parse_env(path.read_text(encoding="utf-8")) if path.is_file() else {}


def config_file_values() -> dict:
    """Application/Config/services.env alone (SERVICES_CONFIG_FILE points elsewhere, e.g. in Docker)."""
    global _file_values
    if _file_values is None:
        _file_values = _read(Path(os.environ.get("SERVICES_CONFIG_FILE") or CONFIG_FILE))
    return _file_values


def dotenv_values() -> dict:
    global _dotenv_values
    if _dotenv_values is None:
        _dotenv_values = _read(DOTENV_FILE)
    return _dotenv_values


def value(name: str, default: Optional[str] = None) -> Optional[str]:
    """The environment variable, else .env, else services.env, else ``default``."""
    found = os.environ.get(name) or dotenv_values().get(name) or config_file_values().get(name)
    return found if found else default


def require(name: str) -> str:
    found = value(name)
    if not found:
        raise ConfigError(
            name + " is not set. It belongs in Application/Config/services.env "
            "(or the environment / .env as an override)."
        )
    return found


def host(service: str) -> str:
    return require(service + "_HOST")


def port(service: str) -> int:
    return int(require(service + "_PORT"))


def address(service: str) -> str:
    """host:port of a service, from its <SERVICE>_HOST and <SERVICE>_PORT keys."""
    return host(service) + ":" + str(port(service))


def url(service: str, scheme: str = "http") -> str:
    """scheme://host:port of a service, from its <SERVICE>_HOST and <SERVICE>_PORT keys."""
    return scheme + "://" + address(service)


def reset_cache() -> None:
    """For tests that change the environment or the files."""
    global _file_values, _dotenv_values
    _file_values = None
    _dotenv_values = None
