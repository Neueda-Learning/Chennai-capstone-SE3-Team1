"""Incremental load from PostgreSQL orders/order_history into a DuckDB warehouse.

    python fact-trades/load_fact_trades.py schema   # create analytics.* in the DuckDB file
    python fact-trades/load_fact_trades.py dims     # dim_date, dim_instrument, dim_account
    python fact-trades/load_fact_trades.py facts    # watermarked merge into fact_trades
    python fact-trades/load_fact_trades.py all      # all three, in order

Source is the operational PostgreSQL database, read through the same psql-based
DbConfig every other script in this repo uses. Target is a DuckDB file, by default
the warehouse.duckdb that ETL_Analysis already writes daily_price into, so a trade
can be joined against the price series without crossing a database boundary.

Dimensions are loaded before facts because the fact load refuses any row whose keys
do not resolve; it never inserts a placeholder dimension row to make one pass. Rows
that fail a check go to analytics.dead_letter_trades with the check name, the reason
and the load_id, and the load carries on.
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
import time
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import List, Optional

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))
sys.path.insert(0, str(HERE))

from db_config import DbConfig, DbError, add_connection_args, quote_literal  # noqa: E402
from transform import CleanTrade, DimensionKeys, Rejection, validate_row  # noqa: E402

WATERMARK_TABLE = "fact_trades"
DEFAULT_DB_PATH = REPO_ROOT / "warehouse.duckdb"
MIGRATIONS_DIR = HERE / "migrations"


def say(msg=""):
    print(msg, flush=True)


def step(msg):
    say("  -> " + msg)


def head(msg):
    say("")
    say("== " + msg + " " + "=" * max(0, 66 - len(msg)))


def new_load_id() -> str:
    return "ft-" + datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3)


def connect_duckdb(db_path, read_only=False):
    try:
        import duckdb
    except ImportError:
        raise DbError(
            "duckdb is required for the fact-trades warehouse. Install it with:\n"
            "    pip install duckdb"
        )
    try:
        return duckdb.connect(str(db_path), read_only=read_only)
    except Exception as exc:
        raise DbError(
            "could not open the DuckDB warehouse at " + str(db_path) + ": " + str(exc)
            + "\nDuckDB allows many readers or one writer, not both. Close anything "
              "holding the file (the ETL_Analysis dashboard, a psql-style shell) and retry."
        )


# ---------------------------------------------------------------- schema


def apply_schema(con, db_path) -> int:
    head("Schema  (" + str(db_path) + ")")
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        raise DbError("no .sql files in " + str(MIGRATIONS_DIR))
    for path in files:
        con.execute(path.read_text(encoding="utf-8"))
        step("applied " + path.name)
    return len(files)


# ---------------------------------------------------------------- dimensions


def load_dim_date(con, cfg: DbConfig, load_id: str) -> int:
    """Cover every calendar day from the earliest order to the end of next year.

    Generated inside DuckDB; only the lower bound comes from PostgreSQL.
    """
    # live orders alone no longer reach back far enough: a settled order has left that
    # table, and its creation date only survives on the order_history row.
    earliest = cfg.scalar(
        "SELECT least((SELECT min(created_at) FROM orders),"
        " (SELECT min(order_created_at) FROM order_history));"
    )
    start_year = datetime.fromisoformat(earliest).year if earliest else datetime.now().year
    end_year = max(start_year, datetime.now().year) + 1

    before = con.execute("SELECT count(*) FROM analytics.dim_date").fetchone()[0]
    con.execute(
        """
        INSERT INTO analytics.dim_date
        SELECT
            CAST(strftime(d, '%Y%m%d') AS INTEGER),
            CAST(d AS DATE),
            dayname(d),
            CAST(isodow(d) AS SMALLINT),
            CAST(dayofmonth(d) AS SMALLINT),
            CAST(weekofyear(d) AS SMALLINT),
            CAST(month(d) AS SMALLINT),
            monthname(d),
            CAST(quarter(d) AS SMALLINT),
            CAST(year(d) AS SMALLINT),
            isodow(d) >= 6,
            isodow(d) < 6
        FROM generate_series(
            CAST(? AS DATE), CAST(? AS DATE), INTERVAL 1 DAY
        ) AS t(d)
        WHERE CAST(strftime(d, '%Y%m%d') AS INTEGER) NOT IN (
            SELECT date_key FROM analytics.dim_date
        )
        """,
        [f"{start_year}-01-01", f"{end_year}-12-31"],
    )
    after = con.execute("SELECT count(*) FROM analytics.dim_date").fetchone()[0]
    return after - before


def load_dim_instrument(con, cfg: DbConfig, load_id: str) -> int:
    rows = cfg.rows(
        "SELECT instrument_id, instrument_name, active, updated_on FROM instruments;"
    )
    for r in rows:
        con.execute(
            """
            INSERT INTO analytics.dim_instrument
                (instrument_id, instrument_name, is_active, source_updated_on, load_id)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (instrument_id) DO UPDATE SET
                instrument_name   = EXCLUDED.instrument_name,
                is_active         = EXCLUDED.is_active,
                source_updated_on = EXCLUDED.source_updated_on,
                load_id           = EXCLUDED.load_id,
                loaded_at         = now()
            """,
            [r[0], r[1], r[2] == "t", r[3] or None, load_id],
        )
    return con.execute("SELECT count(*) FROM analytics.dim_instrument").fetchone()[0]


def load_dim_account(con, cfg: DbConfig, load_id: str) -> int:
    rows = cfg.rows(
        # clients has no account number since migration 015; it lives on the client's bank_account.
        # clients has no email of its own since migration 021 either; it lives on the linked
        # user (auth_db.users, reachable unqualified via the default search_path).
        "SELECT c.client_id, b.account_number, c.name, u.email, c.account_state, c.created_on "
        "FROM clients c "
        "LEFT JOIN bank_account b ON b.client_id = c.client_id "
        "LEFT JOIN users u ON u.account_id = c.client_id;"
    )
    for r in rows:
        con.execute(
            """
            INSERT INTO analytics.dim_account
                (client_id, account_number, client_name, email, account_state, client_since, load_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (client_id) DO UPDATE SET
                account_number = EXCLUDED.account_number,
                client_name    = EXCLUDED.client_name,
                email          = EXCLUDED.email,
                account_state  = EXCLUDED.account_state,
                client_since   = EXCLUDED.client_since,
                load_id        = EXCLUDED.load_id,
                loaded_at      = now()
            """,
            [int(r[0]), r[1] or None, r[2], r[3], r[4], r[5], load_id],
        )
    return con.execute("SELECT count(*) FROM analytics.dim_account").fetchone()[0]


def load_dims(con, cfg: DbConfig, load_id: str) -> dict:
    head("Dimensions  (load " + load_id + ")")
    dates = load_dim_date(con, cfg, load_id)
    step("dim_date        +" + str(dates) + " day(s)")
    instruments = load_dim_instrument(con, cfg, load_id)
    step("dim_instrument  " + str(instruments) + " row(s)")
    accounts = load_dim_account(con, cfg, load_id)
    step("dim_account     " + str(accounts) + " row(s)")
    return {"dim_date_added": dates, "dim_instrument": instruments, "dim_account": accounts}


# ---------------------------------------------------------------- facts


def read_watermark(con) -> Optional[datetime]:
    row = con.execute(
        "SELECT last_watermark FROM analytics.load_watermark WHERE table_name = ?",
        [WATERMARK_TABLE],
    ).fetchone()
    return row[0] if row and row[0] else None


def dimension_keys(con) -> DimensionKeys:
    instruments = {r[0] for r in con.execute(
        "SELECT instrument_id FROM analytics.dim_instrument").fetchall()}
    clients = {int(r[0]) for r in con.execute(
        "SELECT client_id FROM analytics.dim_account").fetchall()}
    dates = {int(r[0]) for r in con.execute(
        "SELECT date_key FROM analytics.dim_date").fetchall()}
    return DimensionKeys(instrument_ids=instruments, client_ids=clients, date_keys=dates)


def extract(cfg: DbConfig, since: Optional[datetime]) -> List[dict]:
    """Terminal orders created after the watermark, one JSON object per row.

    Since migration 010 the operational database keeps live orders in `orders` and moves
    an order onto its terminal `order_history` row when it settles, deleting it from the
    live book. That terminal row carries the order's own fields, so this reads one table
    and needs no join. A row is the order itself rather than a bare transition exactly
    when it carries an idempotency_key.
    """
    where = "  AND order_created_at > " + quote_literal(since.isoformat(sep=" ")) + "::timestamp"         if since is not None else ""
    sql = """
        SELECT row_to_json(t) FROM (
            SELECT order_id, client_id, instrument_id, order_type, side,
                   quantity, price, executed_price, idempotency_key,
                   order_created_at,
                   new_status      AS status,
                   event_timestamp AS terminal_at,
                   failure_code, failure_reason
            FROM order_history
            WHERE idempotency_key IS NOT NULL
              AND new_status IN ('FILLED', 'REJECTED', 'CANCELLED')
            """ + where + """
            ORDER BY order_created_at, order_id
        ) t;
    """
    return [json.loads(r[0], parse_float=Decimal) for r in cfg.rows(sql) if r and r[0]]


def merge_fact(con, clean: CleanTrade, load_id: str):
    con.execute(
        """
        INSERT INTO analytics.fact_trades (
            date_key, instrument_key, account_key, order_id, idempotency_key,
            order_type, side, status, quantity, price, executed_price, trade_value,
            failure_code, failure_reason, order_created_at, terminal_at, load_id
        )
        SELECT ?, i.instrument_key, a.account_key, CAST(? AS UUID), ?,
               ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?
        FROM analytics.dim_instrument i, analytics.dim_account a
        WHERE i.instrument_id = ? AND a.client_id = ?
        ON CONFLICT (order_id) DO UPDATE SET
            date_key         = EXCLUDED.date_key,
            instrument_key   = EXCLUDED.instrument_key,
            account_key      = EXCLUDED.account_key,
            idempotency_key  = EXCLUDED.idempotency_key,
            order_type       = EXCLUDED.order_type,
            side             = EXCLUDED.side,
            status           = EXCLUDED.status,
            quantity         = EXCLUDED.quantity,
            price            = EXCLUDED.price,
            executed_price   = EXCLUDED.executed_price,
            trade_value      = EXCLUDED.trade_value,
            failure_code     = EXCLUDED.failure_code,
            failure_reason   = EXCLUDED.failure_reason,
            order_created_at = EXCLUDED.order_created_at,
            terminal_at      = EXCLUDED.terminal_at,
            load_id          = EXCLUDED.load_id,
            updated_at       = now()
        """,
        [clean.date_key, str(clean.order_id), clean.idempotency_key,
         clean.order_type, clean.side, clean.status, clean.quantity, clean.price,
         clean.executed_price, clean.trade_value,
         clean.failure_code, clean.failure_reason, clean.order_created_at, clean.terminal_at,
         load_id,
         clean.instrument_id, clean.client_id],
    )


def dead_letter(con, rejection: Rejection, raw: dict, load_id: str):
    con.execute(
        """
        INSERT INTO analytics.dead_letter_trades
            (load_id, order_id, check_name, reason, source_row)
        VALUES (?, CAST(? AS UUID), ?, ?, CAST(? AS JSON))
        """,
        [load_id,
         str(rejection.order_id) if rejection.order_id else None,
         rejection.check_name,
         rejection.reason[:500],
         json.dumps(raw, default=str)],
    )


def load_facts(con, cfg: DbConfig, load_id: str, since: Optional[datetime] = None,
               dry_run: bool = False) -> dict:
    head("fact_trades  (load " + load_id + ")")
    watermark = since if since is not None else read_watermark(con)
    step("watermark: " + (watermark.isoformat(sep=" ") if watermark else "none (first load)"))

    rows = extract(cfg, watermark)
    step("extracted " + str(len(rows)) + " terminal order(s) after the watermark")
    if not rows:
        return {"extracted": 0, "merged": 0, "dead_lettered": 0, "watermark": watermark}

    dims = dimension_keys(con)
    if not dims.instrument_ids or not dims.client_ids or not dims.date_keys:
        step("WARNING a dimension is empty; every row will be dead-lettered. Run 'dims' first.")

    merged = dead = 0
    by_check: dict = {}
    newest = watermark
    outcomes = []
    for raw in rows:
        outcome = validate_row(raw, dims)
        outcomes.append((outcome, raw))
        if isinstance(outcome, Rejection):
            dead += 1
            by_check[outcome.check_name] = by_check.get(outcome.check_name, 0) + 1
        else:
            merged += 1
        created = datetime.fromisoformat(str(raw["order_created_at"]))
        if newest is None or created > newest:
            newest = created

    for check, n in sorted(by_check.items()):
        step("dead-letter " + check + ": " + str(n))

    if dry_run:
        step("dry run: would merge " + str(merged) + ", dead-letter " + str(dead)
             + ", advance watermark to " + newest.isoformat(sep=" "))
        return {"extracted": len(rows), "merged": merged, "dead_lettered": dead,
                "watermark": watermark}

    # One transaction: either everything this run found lands, or none of it does.
    con.execute("BEGIN TRANSACTION")
    try:
        for outcome, raw in outcomes:
            if isinstance(outcome, Rejection):
                dead_letter(con, outcome, raw, load_id)
            else:
                merge_fact(con, outcome, load_id)
        con.execute(
            """
            UPDATE analytics.load_watermark
               SET last_watermark = ?, last_load_id = ?, last_run_at = now(),
                   rows_merged = ?, rows_dead_lettered = ?
             WHERE table_name = ?
            """,
            [newest, load_id, merged, dead, WATERMARK_TABLE],
        )
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise

    step("merged " + str(merged) + ", dead-lettered " + str(dead)
         + ", watermark -> " + newest.isoformat(sep=" "))
    return {"extracted": len(rows), "merged": merged, "dead_lettered": dead, "watermark": newest}


# ---------------------------------------------------------------- cli


def build_parser():
    p = argparse.ArgumentParser(
        prog="load_fact_trades.py",
        description="Load analytics.dim_* and analytics.fact_trades from the trade database "
                    "into a DuckDB warehouse.",
    )
    p.add_argument("stage", choices=["schema", "dims", "facts", "all"],
                   help="schema: create the analytics tables; dims: the three dimensions; "
                        "facts: watermarked merge; all: all three in order")
    add_connection_args(p)
    p.add_argument("--db", default=str(DEFAULT_DB_PATH),
                   help="DuckDB warehouse file to write (default: %(default)s)")
    p.add_argument("--load-id", help="identifier recorded on every row this run writes")
    p.add_argument("--since", help="ignore the stored watermark and extract orders created after "
                                   "this timestamp (ISO 8601); use it to replay dead-lettered rows")
    p.add_argument("--dry-run", action="store_true",
                   help="facts stage: validate and report, but write nothing")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    started = time.time()
    load_id = args.load_id or new_load_id()

    # the secrets vault looks for its key file in the working directory
    os.chdir(REPO_ROOT)
    try:
        cfg = DbConfig.resolve(args)
        since = datetime.fromisoformat(args.since) if args.since else None
    except (DbError, ValueError) as exc:
        say("error: " + str(exc))
        return 1

    head("Target")
    say("  source : " + cfg.describe())
    say("  warehouse: " + args.db)

    con = None
    try:
        con = connect_duckdb(args.db)
        if args.stage in ("schema", "all"):
            apply_schema(con, args.db)
        if args.stage in ("dims", "all"):
            load_dims(con, cfg, load_id)
        result = None
        if args.stage in ("facts", "all"):
            result = load_facts(con, cfg, load_id, since=since, dry_run=args.dry_run)
    except DbError as exc:
        say("")
        say("FAILED: " + str(exc))
        return 1
    finally:
        if con is not None:
            con.close()

    head("Summary")
    say("  load_id  : " + load_id)
    if result is not None:
        say("  facts    : " + str(result["extracted"]) + " extracted, " + str(result["merged"])
            + " merged, " + str(result["dead_lettered"]) + " dead-lettered")
    say("  elapsed  : " + format(time.time() - started, ".1f") + "s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
