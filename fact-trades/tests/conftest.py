from __future__ import annotations

import contextlib
import io
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
for path in (REPO_ROOT / "scripts", REPO_ROOT / "fact-trades", REPO_ROOT / "tests"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from db_config import DbConfig, DbError  # noqa: E402
from dbenv import drop_database  # noqa: E402

TEST_DB = os.environ.get("TEST_DBNAME", "trading_platform_test") + "_facts"


def config_for(dbname):
    return DbConfig.resolve(SimpleNamespace(dbname=dbname))


@pytest.fixture(scope="session")
def server():
    try:
        cfg = config_for("postgres")
    except DbError as exc:
        pytest.skip("no usable psql: " + str(exc))
    reachable, detail = cfg.server_reachable()
    if not reachable:
        pytest.skip("no PostgreSQL server at " + cfg.host + ":" + str(cfg.port)
                    + " - " + (detail.splitlines()[0] if detail else "unreachable"))
    return cfg


@pytest.fixture(scope="session")
def schema_db(server):
    """A database with the operational and analytics schemas applied and no seed."""
    import apply_db

    cfg = config_for(TEST_DB)
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = apply_db.main(["--dbname", TEST_DB, "--reset", "--analytics", "--migrations-only"])
    if code != 0:
        raise AssertionError("could not build " + TEST_DB + ":\n" + out.getvalue()[-2000:])
    yield cfg
    drop_database(cfg, TEST_DB)


@pytest.fixture
def db(schema_db):
    """schema_db with every data table emptied, so each test starts from nothing."""
    schema_db.run_or_die(
        "resetting test data",
        sql=(
            "TRUNCATE analytics.fact_trades, analytics.dead_letter_trades, "
            "analytics.dim_instrument, analytics.dim_account, analytics.dim_date "
            "RESTART IDENTITY CASCADE; "
            "UPDATE analytics.load_watermark SET last_watermark = NULL, last_load_id = NULL, "
            "last_run_at = NULL, rows_merged = 0, rows_dead_lettered = 0; "
            "TRUNCATE order_history, orders, portfolio_holding, portfolio_positions, auth, "
            "clients, bank_account, instruments RESTART IDENTITY CASCADE;"
        ),
    )
    return schema_db
