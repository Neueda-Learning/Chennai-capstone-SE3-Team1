#!/usr/bin/env python3
"""Fails if a service port or URL is written anywhere except Application/Config/.

The rule (see Application/Config/README.md): every host, port and URL of a service lives in
Application/Config/services.env and is read from there. This scans the source tree for the ways a
value gets written out again:

    http://host:3000/...        a URL literal
    localhost:29092             a host:port pair (any host), and any :<port> that services.env defines
    server.port=8081            a port assigned to something named port
    EXPOSE 3000, "8080:8080"    a Docker port
    ...amazonaws.com            the external service hosts

and exits 1 listing every offender. The ports it looks for are read from services.env, so adding a
service there extends the check by itself.

Not scanned: Application/Config/ itself, tests and specs (fixtures use made-up addresses), docs,
API contracts (documentation), generated clients, lock files, and Bruno's own environment file.
A line that must keep a literal (say, a deliberately invalid port in a test profile) carries the
marker  config-ok  on the line or the line above, with the reason.

    python scripts/check_config.py          # exit 0 clean, 1 with offenders
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path
from typing import Iterable, List, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_FILE = REPO_ROOT / "Application" / "Config" / "services.env"
MARKER = "config-ok"

SCANNED_SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".java", ".py", ".ps1", ".sh", ".yml", ".yaml", ".properties"}
SCANNED_NAMES = {"Dockerfile"}

EXCLUDED_PREFIXES = (
    "Application/Config/",
    "Application/Contracts/",
    "Application/Frontend/frontend-app/src/app/generated/",
    "docs/", "design/", "Diagrams/", "decision-log/", "security-review/", "legacy/", "bruno/", "tests/",
    "scripts/check_config.py",
)
EXCLUDED_PARTS = ("/node_modules/", "/dist/", "/target/", "/.cache/", "/test/", "/tests/", "/src/test/", "/out-tsc/", "/playwright-report/")
EXCLUDED_SUFFIXES = (".spec.ts", ".test.ts", ".test.mjs", ".test.js", "e2e-spec.ts", "Test.java", "Tests.java")

# URL hosts that are not services of ours: standards, licences, schema references.
ALLOWED_URL_HOSTS = (
    "www.w3.org", "www.apache.org", "apache.org", "maven.apache.org", "json.schemastore.org",
    "www.springframework.org", "xmlns.jcp.org", "java.sun.com", "mybatis.org", "github.com",
    "raw.githubusercontent.com", "www.typescriptlang.org", "angular.dev", "docs.docker.com",
)

URL = re.compile(r"https?://([A-Za-z0-9][A-Za-z0-9.-]*)(?::(.))?")
LOOPBACK = ("localhost", "127.0.0.1")
HOST_PORT = re.compile(r"(?<![\w$])[A-Za-z0-9_.@-]+:(\d{2,5})\b")
PORT_ASSIGNMENT = re.compile(r"""(?:\bport|[a-z]Port|_PORT|\bPORT)['"]?\s*[:=]\s*['"]?(\d{2,5})\b""")
DOCKER_PORT = re.compile(r"""(?:\bEXPOSE\s+(\d{2,5})\b|["'](\d{2,5}):(\d{2,5})["'])""")
EXTERNAL_HOST = re.compile(r"amazonaws\.com|archive\.apache\.org|169\.254\.169\.254|googleapis\.com")


class Offence:
    def __init__(self, path: str, number: int, text: str, rule: str):
        self.path, self.number, self.text, self.rule = path, number, text.strip(), rule

    def __str__(self) -> str:
        return f"{self.path}:{self.number}: [{self.rule}] {self.text[:140]}"


def config_ports(config_file: Path = CONFIG_FILE) -> List[str]:
    """Every *_PORT value in services.env: the ports whose literal must not appear elsewhere."""
    ports = []
    for line in config_file.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip().endswith("_PORT") and value.strip().isdigit():
            ports.append(value.strip())
    return sorted(set(ports))


def is_scanned(path: str) -> bool:
    if path.startswith(EXCLUDED_PREFIXES) or any(part in "/" + path for part in EXCLUDED_PARTS):
        return False
    if path.endswith(EXCLUDED_SUFFIXES):
        return False
    name = path.rsplit("/", 1)[-1]
    return Path(path).suffix in SCANNED_SUFFIXES or name in SCANNED_NAMES or name.startswith("Dockerfile")


def check_text(path: str, text: str, ports: Iterable[str]) -> List[Offence]:
    port_set = set(ports)
    offences: List[Offence] = []
    lines = text.splitlines()
    for index, line in enumerate(lines):
        previous = lines[index - 1] if index else ""
        if MARKER in line or MARKER in previous:
            continue
        number = index + 1
        for match in URL.finditer(line):
            host, after_colon = match.group(1), match.group(2)
            if any(host == h or host.endswith("." + h) for h in ALLOWED_URL_HOSTS):
                continue
            # http://localhost:${PORT}/health has no port written in it: only a literal (or no) port is flagged.
            if host in LOOPBACK and after_colon is not None and not after_colon.isdigit():
                continue
            offences.append(Offence(path, number, line, "url"))
            break
        else:
            hit = next((m for m in HOST_PORT.finditer(line) if m.group(1) in port_set), None)
            if hit or PORT_ASSIGNMENT.search(line) or DOCKER_PORT.search(line) or EXTERNAL_HOST.search(line):
                rule = "host:port" if hit else "port" if (PORT_ASSIGNMENT.search(line) or DOCKER_PORT.search(line)) else "external-url"
                offences.append(Offence(path, number, line, rule))
    return offences


def tracked_files(root: Path = REPO_ROOT) -> List[str]:
    """Tracked files plus new ones not ignored, so an uncommitted change is checked too."""
    out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"],
                         cwd=root, capture_output=True, text=True, encoding="utf-8", check=True).stdout
    return sorted({line for line in out.splitlines() if line})


def scan(root: Path = REPO_ROOT, config_file: Optional[Path] = None) -> List[Offence]:
    ports = config_ports(config_file or (root / "Application" / "Config" / "services.env"))
    offences: List[Offence] = []
    for path in tracked_files(root):
        if not is_scanned(path):
            continue
        file = root / path
        if not file.is_file():
            continue
        try:
            text = file.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        offences.extend(check_text(path, text, ports))
    return offences


def main() -> int:
    offences = scan()
    if not offences:
        print("check_config: no service port or URL is written outside Application/Config/")
        return 0
    print(f"check_config: {len(offences)} place(s) write a service port or URL instead of reading Application/Config/services.env:\n")
    for offence in offences:
        print("  " + str(offence))
    print("\nRead the value from the config (see Application/Config/README.md), or mark a justified literal with 'config-ok: <reason>'.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
