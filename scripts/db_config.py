from __future__ import annotations

import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vault_env import env_name_for, secret, setting  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent


def _first_existing(*candidates):
    """Return the first path that exists, else the first candidate.

    The layout moved under Application/ (Phase 1); the old root-level
    directories are kept as a fallback so older checkouts keep working.
    """
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


MIGRATIONS_DIR = _first_existing(
    REPO_ROOT / "Application" / "Databases" / "PostgreSQL" / "migrations",
    REPO_ROOT / "migrations",
)
SEED_DIR = _first_existing(
    REPO_ROOT / "Application" / "Databases" / "PostgreSQL" / "seeds",
    REPO_ROOT / "seed",
)

# The host and port come from Application/Config/services.env (POSTGRES_HOST, POSTGRES_PORT) via
# vault_env.secret(); only the names below are defaults here.
DEFAULTS = {
    "dbname": "trading_platform",
    "user": "postgres",
}

ENV_KEYS = {
    "host": "PostGres_Host",
    "port": "Postgres_Port",
    "dbname": "Postgres_DB",
    "user": "PostGres_User",
    "password": "PostGres",
}

_WINDOWS_PSQL_GLOBS = [
    "C:\\Program Files\\PostgreSQL\\*\\bin\\psql.exe",
    "C:\\Program Files (x86)\\PostgreSQL\\*\\bin\\psql.exe",
]

FIELD_SEP = "\x1f"


class DbError(RuntimeError):
    pass


def find_psql():
    override = setting("PSQL_BIN")
    if override:
        if Path(override).is_file():
            return override
        raise DbError("PSQL_BIN is set to " + repr(override) + " but that file does not exist.")

    on_path = shutil.which("psql")
    if on_path:
        return on_path

    if sys.platform == "win32":
        import glob

        found = []
        for pattern in _WINDOWS_PSQL_GLOBS:
            found.extend(glob.glob(pattern))
        if found:
            return sorted(found)[-1]

    raise DbError(
        "psql was not found. Install the PostgreSQL client tools, or point at the "
        "binary directly with PSQL_BIN=/path/to/psql."
    )


@dataclass
class DbConfig:
    host: str
    port: str
    dbname: str
    user: str
    password: str
    psql: str

    @classmethod
    def resolve(cls, args=None):
        settings = {}
        for name, secret_name in ENV_KEYS.items():
            cli_value = getattr(args, name, None) if args is not None else None
            settings[name] = cli_value or secret(secret_name) or DEFAULTS.get(name)
        if not settings["password"]:
            raise DbError(
                "No database password found. Add a " + repr(ENV_KEYS["password"])
                + " secret to the TrustMe vault, set " + env_name_for(ENV_KEYS["password"])
                + " in the environment or .env, or pass --password."
            )
        psql = getattr(args, "psql", None) if args is not None else None
        return cls(psql=psql or find_psql(), **settings)


    def _env(self):
        env = os.environ.copy()
        env["PGPASSWORD"] = self.password
        env["PGCLIENTENCODING"] = "UTF8"
        return env

    def _base_cmd(self, dbname=None):
        return [
            self.psql,
            "--no-psqlrc",
            "--host", self.host,
            "--port", str(self.port),
            "--username", self.user,
            "--dbname", dbname or self.dbname,
            "--set", "ON_ERROR_STOP=1",
        ]

    def run(self, sql=None, file=None, script=None, dbname=None, quiet=True,
            verbose_errors=False, tuples_only=False):
        sources = [s is not None for s in (sql, file, script)]
        if sum(sources) != 1:
            raise ValueError("pass exactly one of sql=, file= or script=")

        cmd = self._base_cmd(dbname)
        if quiet:
            cmd.append("--quiet")
        if tuples_only:
            cmd += ["--tuples-only", "--no-align"]
        if verbose_errors:
            cmd += ["--set", "VERBOSITY=verbose"]

        stdin_text = None
        if file is not None:
            cmd += ["--file", str(file)]
        elif script is not None:
            cmd += ["--file", "-"]
            stdin_text = script
        else:
            cmd += ["--command", sql]

        return subprocess.run(
            cmd, env=self._env(), input=stdin_text, capture_output=True, text=True,
            encoding="utf-8", errors="replace",
        )

    def run_or_die(self, what, **kwargs):
        proc = self.run(**kwargs)
        if proc.returncode != 0:
            raise DbError(
                what + " failed (psql exit " + str(proc.returncode) + ").\n"
                + (proc.stderr or proc.stdout).strip()
            )
        return proc.stdout

    def scalar(self, sql, dbname=None):
        cmd = self._base_cmd(dbname) + ["--tuples-only", "--no-align", "--command", sql]
        proc = subprocess.run(
            cmd, env=self._env(), capture_output=True, text=True,
            encoding="utf-8", errors="replace",
        )
        if proc.returncode != 0:
            raise DbError("query failed: " + sql + "\n" + (proc.stderr or proc.stdout).strip())
        return proc.stdout.strip()

    def rows(self, sql, dbname=None):
        cmd = self._base_cmd(dbname) + [
            "--tuples-only", "--no-align", "--field-separator", FIELD_SEP, "--command", sql,
        ]
        proc = subprocess.run(
            cmd, env=self._env(), capture_output=True, text=True,
            encoding="utf-8", errors="replace",
        )
        if proc.returncode != 0:
            raise DbError("query failed: " + sql + "\n" + (proc.stderr or proc.stdout).strip())
        return [line.split(FIELD_SEP) for line in proc.stdout.splitlines() if line.strip()]

    def server_reachable(self):
        proc = self.run(sql="SELECT 1", dbname="postgres")
        return proc.returncode == 0, (proc.stderr or proc.stdout).strip()

    def database_exists(self):
        out = self.scalar(
            "SELECT 1 FROM pg_database WHERE datname = " + quote_literal(self.dbname),
            dbname="postgres",
        )
        return out == "1"

    def describe(self):
        return self.user + "@" + self.host + ":" + str(self.port) + "/" + self.dbname


def quote_literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def quote_ident(value):
    return '"' + str(value).replace('"', '""') + '"'


def add_connection_args(parser):
    g = parser.add_argument_group("connection (TrustMe vault, then POSTGRES_* in the environment or .env, unless given here)")
    g.add_argument("--host", help="database host (default: POSTGRES_HOST in Application/Config/services.env)")
    g.add_argument("--port", help="database port (default: POSTGRES_PORT in Application/Config/services.env)")
    g.add_argument("--dbname", help="database name (default " + DEFAULTS["dbname"] + ",)")
    g.add_argument("--user", help="database user (default " + DEFAULTS["user"] + ",)")
    g.add_argument("--password", help="database password (default: the vault's PostGres secret, or POSTGRES_PASSWORD)")
    g.add_argument("--psql", help="path to the psql binary (default: found on PATH, or the PSQL_BIN environment variable)")
