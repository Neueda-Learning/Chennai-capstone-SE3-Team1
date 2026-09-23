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
    """The PostgreSQL source. Skips the whole suite when none is reachable."""
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
def source_db(server):
    """A PostgreSQL database with the operational schema applied and no seed rows."""
    import apply_db

    cfg = config_for(TEST_DB)
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = apply_db.main(["--dbname", TEST_DB, "--reset", "--migrations-only"])
    if code != 0:
        raise AssertionError("could not build " + TEST_DB + ":\n" + out.getvalue()[-2000:])
    yield cfg
    drop_database(cfg, TEST_DB)


@pytest.fixture
def pg(source_db):
    """source_db with every data table emptied, so each test starts from nothing."""
    source_db.run_or_die(
        "resetting source data",
        sql=(
            "TRUNCATE order_history, orders, portfolio_holding, portfolio_positions, refresh_tokens, users, wallet_transfers, "
            "clients, bank_account, instruments RESTART IDENTITY CASCADE;"
        ),
    )
    return source_db


@pytest.fixture
def warehouse(tmp_path):
    """A DuckDB warehouse of its own per test, with the analytics schema applied.

    A file rather than :memory: because that is how it runs for real, and because the
    loader opens the path it is given.
    """
    import load_fact_trades as loader

    db_path = tmp_path / "warehouse.duckdb"
    con = loader.connect_duckdb(db_path)
    with contextlib.redirect_stdout(io.StringIO()):
        loader.apply_schema(con, db_path)
    yield con
    con.close()
