"""Incremental load from public.orders / public.order_history into analytics.fact_trades.

    python fact-trades/load_fact_trades.py dims    # dim_date, dim_instrument, dim_account
    python fact-trades/load_fact_trades.py facts   # watermarked merge into fact_trades
    python fact-trades/load_fact_trades.py all     # dims then facts

Dimensions are loaded first because the fact load refuses any row whose keys
do not resolve; it never inserts a placeholder dimension row to make one pass.
Rows that fail a check go to analytics.dead_letter_trades with the check name,
the reason and the load_id, and the load carries on.
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


def say(msg=""):
    print(msg, flush=True)


def step(msg):
    say("  -> " + msg)


def head(msg):
    say("")
    say("== " + msg + " " + "=" * max(0, 66 - len(msg)))


def new_load_id() -> str:
    return "ft-" + datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3)


def _lit(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, Decimal)):
        return str(value)
    if isinstance(value, datetime):
        return quote_literal(value.isoformat(sep=" ")) + "::timestamp"
    return quote_literal(str(value))


# ---------------------------------------------------------------- dimensions


def load_dim_date(cfg: DbConfig, load_id: str) -> int:
    """Cover every calendar day from the earliest order to a year past today."""
    sql = """
        INSERT INTO analytics.dim_date (
            date_key, calendar_date, day_of_week, day_of_week_number, day_of_month,
            week_of_year, month, month_name, quarter, year, is_weekend, is_trading_day
        )
        SELECT
            to_char(d, 'YYYYMMDD')::INTEGER,
            d::date,
            trim(to_char(d, 'Day')),
            extract(isodow FROM d)::SMALLINT,
            extract(day FROM d)::SMALLINT,
            extract(week FROM d)::SMALLINT,
            extract(month FROM d)::SMALLINT,
            trim(to_char(d, 'Month')),
            extract(quarter FROM d)::SMALLINT,
            extract(year FROM d)::SMALLINT,
            extract(isodow FROM d) >= 6,
            extract(isodow FROM d) < 6
        FROM generate_series(
            date_trunc('year', COALESCE((SELECT min(created_at) FROM orders), now())),
            date_trunc('year', now()) + interval '1 year' - interval '1 day',
            interval '1 day'
        ) AS d
        ON CONFLICT (date_key) DO NOTHING;
    """
    before = int(cfg.scalar("SELECT count(*) FROM analytics.dim_date;"))
    cfg.run_or_die("loading dim_date", sql=sql)
    after = int(cfg.scalar("SELECT count(*) FROM analytics.dim_date;"))
    return after - before


def load_dim_instrument(cfg: DbConfig, load_id: str) -> int:
    sql = (
        "INSERT INTO analytics.dim_instrument "
        "(instrument_id, instrument_name, is_active, source_updated_on, load_id) "
        "SELECT instrument_id, instrument_name, active, updated_on, " + quote_literal(load_id) + " "
        "FROM instruments "
        "ON CONFLICT (instrument_id) DO UPDATE SET "
        "  instrument_name = EXCLUDED.instrument_name, "
        "  is_active = EXCLUDED.is_active, "
        "  source_updated_on = EXCLUDED.source_updated_on, "
        "  load_id = EXCLUDED.load_id, "
        "  loaded_at = now();"
    )
    cfg.run_or_die("loading dim_instrument", sql=sql)
    return int(cfg.scalar("SELECT count(*) FROM analytics.dim_instrument;"))


def load_dim_account(cfg: DbConfig, load_id: str) -> int:
    sql = (
        "INSERT INTO analytics.dim_account "
        "(client_id, account_number, client_name, email, account_state, client_since, load_id) "
        "SELECT client_id, account_number, name, email, account_state, created_on, "
        + quote_literal(load_id) + " "
        "FROM clients "
        "ON CONFLICT (client_id) DO UPDATE SET "
        "  account_number = EXCLUDED.account_number, "
        "  client_name = EXCLUDED.client_name, "
        "  email = EXCLUDED.email, "
        "  account_state = EXCLUDED.account_state, "
        "  client_since = EXCLUDED.client_since, "
        "  load_id = EXCLUDED.load_id, "
        "  loaded_at = now();"
    )
    cfg.run_or_die("loading dim_account", sql=sql)
    return int(cfg.scalar("SELECT count(*) FROM analytics.dim_account;"))


def load_dims(cfg: DbConfig, load_id: str) -> dict:
    head("Dimensions  (load " + load_id + ")")
    dates = load_dim_date(cfg, load_id)
    step("dim_date        +" + str(dates) + " day(s)")
    instruments = load_dim_instrument(cfg, load_id)
    step("dim_instrument  " + str(instruments) + " row(s)")
    accounts = load_dim_account(cfg, load_id)
    step("dim_account     " + str(accounts) + " row(s)")
    return {"dim_date_added": dates, "dim_instrument": instruments, "dim_account": accounts}


# ---------------------------------------------------------------- facts


def read_watermark(cfg: DbConfig) -> Optional[datetime]:
    raw = cfg.scalar(
        "SELECT last_watermark FROM analytics.load_watermark WHERE table_name = "
        + quote_literal(WATERMARK_TABLE) + ";"
    )
    return datetime.fromisoformat(raw) if raw else None


def dimension_keys(cfg: DbConfig) -> DimensionKeys:
    instruments = {r[0] for r in cfg.rows("SELECT instrument_id FROM analytics.dim_instrument;")}
    clients = {int(r[0]) for r in cfg.rows("SELECT client_id FROM analytics.dim_account;")}
    dates = {int(r[0]) for r in cfg.rows("SELECT date_key FROM analytics.dim_date;")}
    return DimensionKeys(instrument_ids=instruments, client_ids=clients, date_keys=dates)


def extract(cfg: DbConfig, since: Optional[datetime]) -> List[dict]:
    """Terminal-state orders created after the watermark, one JSON object per row.

    The terminal event is the newest order_history row whose new_status is a
    terminal status; the order's own fields come from public.orders. Orders
    that have not reached a terminal state are not trades yet and are skipped.
    """
    where = "WHERE o.created_at > " + _lit(since) if since is not None else ""
    sql = """
        WITH terminal AS (
            SELECT DISTINCT ON (order_id)
                   order_id, new_status, event_timestamp, failure_code, failure_reason
            FROM order_history
            WHERE new_status IN ('FILLED', 'REJECTED', 'CANCELLED')
            ORDER BY order_id, event_timestamp DESC, history_id DESC
        )
        SELECT row_to_json(t) FROM (
            SELECT o.order_id, o.client_id, o.instrument_id, o.order_type, o.side,
                   o.quantity, o.price, o.executed_price, o.idempotency_key,
                   o.created_at AS order_created_at,
                   h.new_status AS status, h.event_timestamp AS terminal_at,
                   h.failure_code, h.failure_reason
            FROM orders o
            JOIN terminal h USING (order_id)
            """ + where + """
            ORDER BY o.created_at, o.order_id
        ) t;
    """
    rows = cfg.rows(sql)
    return [json.loads(r[0], parse_float=Decimal) for r in rows if r and r[0]]


def _fact_insert(clean: CleanTrade, load_id: str) -> str:
    return (
        "INSERT INTO analytics.fact_trades ("
        "date_key, instrument_key, account_key, order_id, idempotency_key, order_type, side, status, "
        "quantity, price, executed_price, trade_value, failure_code, failure_reason, "
        "order_created_at, terminal_at, load_id) "
        "SELECT " + _lit(clean.date_key) + ", i.instrument_key, a.account_key, "
        + _lit(str(clean.order_id)) + "::uuid, " + _lit(clean.idempotency_key) + ", "
        + _lit(clean.order_type) + ", " + _lit(clean.side) + ", " + _lit(clean.status) + ", "
        + _lit(clean.quantity) + ", " + _lit(clean.price) + ", " + _lit(clean.executed_price) + ", "
        + _lit(clean.trade_value) + ", " + _lit(clean.failure_code) + ", " + _lit(clean.failure_reason) + ", "
        + _lit(clean.order_created_at) + ", " + _lit(clean.terminal_at) + ", " + _lit(load_id) + " "
        "FROM analytics.dim_instrument i, analytics.dim_account a "
        "WHERE i.instrument_id = " + _lit(clean.instrument_id)
        + " AND a.client_id = " + _lit(clean.client_id) + " "
        "ON CONFLICT (order_id) DO UPDATE SET "
        "  date_key = EXCLUDED.date_key, instrument_key = EXCLUDED.instrument_key, "
        "  account_key = EXCLUDED.account_key, idempotency_key = EXCLUDED.idempotency_key, "
        "  order_type = EXCLUDED.order_type, side = EXCLUDED.side, status = EXCLUDED.status, "
        "  quantity = EXCLUDED.quantity, price = EXCLUDED.price, "
        "  executed_price = EXCLUDED.executed_price, trade_value = EXCLUDED.trade_value, "
        "  failure_code = EXCLUDED.failure_code, failure_reason = EXCLUDED.failure_reason, "
        "  order_created_at = EXCLUDED.order_created_at, terminal_at = EXCLUDED.terminal_at, "
        "  load_id = EXCLUDED.load_id, updated_at = now();"
    )


def _dead_letter_insert(rejection: Rejection, raw: dict, load_id: str) -> str:
    return (
        "INSERT INTO analytics.dead_letter_trades (load_id, order_id, check_name, reason, source_row) VALUES ("
        + _lit(load_id) + ", "
        + (_lit(str(rejection.order_id)) + "::uuid" if rejection.order_id else "NULL") + ", "
        + _lit(rejection.check_name) + ", " + _lit(rejection.reason[:500]) + ", "
        + quote_literal(json.dumps(raw, default=str)) + "::jsonb);"
    )


def load_facts(cfg: DbConfig, load_id: str, since: Optional[datetime] = None,
               dry_run: bool = False) -> dict:
    head("fact_trades  (load " + load_id + ")")
    watermark = since if since is not None else read_watermark(cfg)
    step("watermark: " + (watermark.isoformat(sep=" ") if watermark else "none (first load)"))

    rows = extract(cfg, watermark)
    step("extracted " + str(len(rows)) + " terminal order(s) after the watermark")
    if not rows:
        return {"extracted": 0, "merged": 0, "dead_lettered": 0, "watermark": watermark}

    dims = dimension_keys(cfg)
    if not dims.instrument_ids or not dims.client_ids or not dims.date_keys:
        step("WARNING a dimension is empty; every row will be dead-lettered. Run 'dims' first.")

    statements = ["\\set ON_ERROR_STOP on", "BEGIN;"]
    merged = dead = 0
    by_check: dict = {}
    newest = watermark
    for raw in rows:
        outcome = validate_row(raw, dims)
        if isinstance(outcome, Rejection):
            statements.append(_dead_letter_insert(outcome, raw, load_id))
            dead += 1
            by_check[outcome.check_name] = by_check.get(outcome.check_name, 0) + 1
        else:
            statements.append(_fact_insert(outcome, load_id))
            merged += 1
        created = datetime.fromisoformat(str(raw["order_created_at"]))
        if newest is None or created > newest:
            newest = created

    statements.append(
        "UPDATE analytics.load_watermark SET last_watermark = " + _lit(newest)
        + ", last_load_id = " + _lit(load_id) + ", last_run_at = now()"
        + ", rows_merged = " + str(merged) + ", rows_dead_lettered = " + str(dead)
        + " WHERE table_name = " + quote_literal(WATERMARK_TABLE) + ";"
    )
    statements.append("COMMIT;")

    for check, n in sorted(by_check.items()):
        step("dead-letter " + check + ": " + str(n))

    if dry_run:
        step("dry run: would merge " + str(merged) + ", dead-letter " + str(dead)
             + ", advance watermark to " + newest.isoformat(sep=" "))
        return {"extracted": len(rows), "merged": merged, "dead_lettered": dead, "watermark": watermark}

    cfg.run_or_die("fact_trades merge", script="\n".join(statements) + "\n", verbose_errors=True)
    step("merged " + str(merged) + ", dead-lettered " + str(dead)
         + ", watermark -> " + newest.isoformat(sep=" "))
    return {"extracted": len(rows), "merged": merged, "dead_lettered": dead, "watermark": newest}


# ---------------------------------------------------------------- cli


def build_parser():
    p = argparse.ArgumentParser(
        prog="load_fact_trades.py",
        description="Load analytics.dim_* and analytics.fact_trades from the trade database.",
    )
    p.add_argument("stage", choices=["dims", "facts", "all"],
                   help="dims: the three dimensions; facts: watermarked merge; all: both in order")
    add_connection_args(p)
    p.add_argument("--load-id", help="identifier recorded on every row this run writes (default: generated)")
    p.add_argument("--since", help="ignore the stored watermark and extract orders created after this "
                                   "timestamp (ISO 8601); use it to replay dead-lettered rows once fixed")
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
    say("  " + cfg.describe())

    try:
        if args.stage in ("dims", "all"):
            if args.dry_run:
                step("dry run: dims stage is idempotent and cheap; nothing skipped is reported")
            else:
                load_dims(cfg, load_id)
        if args.stage in ("facts", "all"):
            result = load_facts(cfg, load_id, since=since, dry_run=args.dry_run)
        else:
            result = None
    except DbError as exc:
        say("")
        say("FAILED: " + str(exc))
        return 1

    head("Summary")
    say("  load_id  : " + load_id)
    if result is not None:
        say("  facts    : " + str(result["extracted"]) + " extracted, " + str(result["merged"])
            + " merged, " + str(result["dead_lettered"]) + " dead-lettered")
    say("  elapsed  : " + format(time.time() - started, ".1f") + "s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
