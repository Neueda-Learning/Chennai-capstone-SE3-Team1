"""End-to-end tests for the incremental load.

Source is PostgreSQL, target is a DuckDB file. Skips cleanly without PostgreSQL.
"""
from __future__ import annotations

import load_fact_trades as loader

ORDER_1 = "550e8400-e29b-41d4-a716-446655440001"
ORDER_2 = "550e8400-e29b-41d4-a716-446655440002"
ORDER_3 = "550e8400-e29b-41d4-a716-446655440003"


def seed_reference_data(pg):
    pg.run_or_die("seeding reference data", sql="""
        INSERT INTO clients (client_id, name, email, phone, created_on, account_state, wallet_balance)
        VALUES (1, 'Aarav', 'aarav@example.com', '9999', '2025-12-01', 'ACTIVE', 50000);
        INSERT INTO bank_account (account_number, client_id, name, phone, email, account_balance, bank_name, ifsc_code)
        VALUES ('ACC001', 1, 'Aarav', '9999', 'aarav@example.com', 100000, 'SBI', 'SBIN0001');
        INSERT INTO instruments (instrument_id, instrument_name, active) VALUES ('RELIANCE', 'Reliance', TRUE);
        SELECT setval('clients_client_id_seq', 1);
    """)


def place_order(pg, order_id, created_at, status, quantity="40", price="2875.5", executed=None,
                terminal_at=None, failure_code=None):
    """Put an order into the source database the way the running system would.

    Since migration 010 those are two different places. A live order is a row in orders.
    A settled one is not in orders at all - it is the terminal order_history row, which
    carries the order's own fields because the orders row was deleted on settlement.
    """
    if terminal_at is None:
        pg.run_or_die("placing live order " + order_id, sql=(
            "INSERT INTO orders (order_id, client_id, account_id, instrument_id, order_type, side, "
            "quantity, price, status, idempotency_key, created_at, updated_at) VALUES ("
            "'" + order_id + "', 1, 1, 'RELIANCE', 'HOLDING', 'BUY', " + quantity + ", " + price + ", "
            "'NEW', 'idem-" + order_id[-4:] + "', '" + created_at + "', '" + created_at + "');"
        ))
        return

    pg.run_or_die("settling order " + order_id, sql=(
        "INSERT INTO order_history (order_id, event_type, previous_status, new_status, "
        "event_timestamp, failure_code, client_id, account_id, instrument_id, order_type, side, "
        "quantity, price, executed_price, idempotency_key, order_created_at) VALUES ("
        "'" + order_id + "', '" + status + "', 'NEW', '" + status + "', '" + terminal_at + "', "
        + ("NULL" if failure_code is None else "'" + failure_code + "'") + ", "
        "1, 1, 'RELIANCE', 'HOLDING', 'BUY', " + quantity + ", " + price + ", "
        + ("NULL" if executed is None else executed) + ", "
        "'idem-" + order_id[-4:] + "', '" + created_at + "');"
    ))


def count(warehouse, table):
    return warehouse.execute("SELECT count(*) FROM " + table).fetchone()[0]


def test_incremental_load_populates_fact_trades(pg, warehouse):
    seed_reference_data(pg)
    place_order(pg, ORDER_1, "2026-01-05 09:16:00", "FILLED", executed="2880", terminal_at="2026-01-05 09:17:00")
    place_order(pg, ORDER_2, "2026-01-05 09:18:00", "REJECTED", terminal_at="2026-01-05 09:18:30",
                failure_code="INSUFFICIENT_FUNDS")
    place_order(pg, ORDER_3, "2026-01-05 09:20:00", "NEW")  # still open: not a trade yet

    loader.load_dims(warehouse, pg, "t-1")
    result = loader.load_facts(warehouse, pg, "t-1")

    assert result["extracted"] == 2
    assert result["merged"] == 2
    assert result["dead_lettered"] == 0
    assert count(warehouse, "analytics.fact_trades") == 2
    assert count(warehouse, "analytics.dead_letter_trades") == 0

    rows = warehouse.execute(
        "SELECT CAST(order_id AS VARCHAR), status, trade_value, failure_code, date_key "
        "FROM analytics.fact_trades ORDER BY CAST(order_id AS VARCHAR)"
    ).fetchall()
    assert rows[0][0] == ORDER_1 and rows[0][1] == "FILLED"
    assert float(rows[0][2]) == 40 * 2880          # executed price wins when filled
    assert rows[1][0] == ORDER_2 and rows[1][1] == "REJECTED"
    assert float(rows[1][2]) == 40 * 2875.5        # limit price, since it never executed
    assert rows[1][3] == "INSUFFICIENT_FUNDS"
    assert rows[0][4] == 20260105

    watermark = loader.read_watermark(warehouse)
    assert watermark.strftime("%Y-%m-%d %H:%M:%S") == "2026-01-05 09:18:00"


def test_second_load_with_no_new_data_adds_no_rows(pg, warehouse):
    seed_reference_data(pg)
    place_order(pg, ORDER_1, "2026-01-05 09:16:00", "FILLED", executed="2880", terminal_at="2026-01-05 09:17:00")
    loader.load_dims(warehouse, pg, "t-1")
    loader.load_facts(warehouse, pg, "t-1")
    assert count(warehouse, "analytics.fact_trades") == 1

    again = loader.load_facts(warehouse, pg, "t-2")
    assert again["extracted"] == 0 and again["merged"] == 0
    assert count(warehouse, "analytics.fact_trades") == 1

    # a forced replay over the same window merges, it does not duplicate
    replay = loader.load_facts(warehouse, pg, "t-3", since=loader.datetime(2026, 1, 1))
    assert replay["merged"] == 1
    assert count(warehouse, "analytics.fact_trades") == 1
    assert warehouse.execute("SELECT load_id FROM analytics.fact_trades").fetchone()[0] == "t-3"


def test_order_reaching_terminal_state_after_watermark_is_picked_up(pg, warehouse):
    seed_reference_data(pg)
    place_order(pg, ORDER_1, "2026-01-05 09:16:00", "FILLED", executed="2880", terminal_at="2026-01-05 09:17:00")
    loader.load_dims(warehouse, pg, "t-1")
    loader.load_facts(warehouse, pg, "t-1")

    place_order(pg, ORDER_2, "2026-01-06 10:00:00", "CANCELLED", terminal_at="2026-01-06 10:05:00")
    result = loader.load_facts(warehouse, pg, "t-2")
    assert result["merged"] == 1
    assert count(warehouse, "analytics.fact_trades") == 2


def test_invalid_row_is_dead_lettered_and_load_continues(pg, warehouse):
    seed_reference_data(pg)
    place_order(pg, ORDER_1, "2026-01-05 09:16:00", "FILLED", executed="2880", terminal_at="2026-01-05 09:17:00")
    # a bad row the source constraints cannot catch: terminal event before creation
    place_order(pg, ORDER_2, "2026-01-05 09:18:00", "FILLED", executed="2880", terminal_at="2026-01-05 09:00:00")
    place_order(pg, ORDER_3, "2026-01-05 09:20:00", "CANCELLED", terminal_at="2026-01-05 09:21:00")

    loader.load_dims(warehouse, pg, "t-1")
    result = loader.load_facts(warehouse, pg, "t-1")

    assert result["merged"] == 2
    assert result["dead_lettered"] == 1
    assert count(warehouse, "analytics.fact_trades") == 2

    dl = warehouse.execute(
        "SELECT CAST(order_id AS VARCHAR), check_name, load_id, "
        "json_extract_string(source_row, '$.quantity') FROM analytics.dead_letter_trades"
    ).fetchall()
    assert dl == [(ORDER_2, "terminal_after_created", "t-1", "40.0000")]

    # the watermark still advanced past the bad row: it is not silently retried forever
    assert loader.read_watermark(warehouse).strftime("%Y-%m-%d %H:%M:%S") == "2026-01-05 09:20:00"


def test_skipped_dimension_load_dead_letters_instead_of_inserting_placeholder(pg, warehouse):
    seed_reference_data(pg)
    place_order(pg, ORDER_1, "2026-01-05 09:16:00", "FILLED", executed="2880", terminal_at="2026-01-05 09:17:00")

    result = loader.load_facts(warehouse, pg, "t-1")  # no load_dims first

    assert result["merged"] == 0 and result["dead_lettered"] == 1
    assert count(warehouse, "analytics.fact_trades") == 0
    assert count(warehouse, "analytics.dim_instrument") == 0
    assert warehouse.execute(
        "SELECT check_name FROM analytics.dead_letter_trades").fetchone()[0] == "fk_instrument"

    # fix: load dims and replay the window
    loader.load_dims(warehouse, pg, "t-2")
    replay = loader.load_facts(warehouse, pg, "t-2", since=loader.datetime(2026, 1, 1))
    assert replay["merged"] == 1
    assert count(warehouse, "analytics.fact_trades") == 1


def test_dim_loads_are_idempotent_and_reflect_source_changes(pg, warehouse):
    seed_reference_data(pg)
    loader.load_dims(warehouse, pg, "t-1")
    dates_before = count(warehouse, "analytics.dim_date")
    loader.load_dims(warehouse, pg, "t-2")
    assert count(warehouse, "analytics.dim_date") == dates_before
    assert count(warehouse, "analytics.dim_instrument") == 1

    pg.run_or_die("suspending client",
                  sql="UPDATE clients SET account_state = 'SUSPENDED' WHERE client_id = 1;")
    loader.load_dims(warehouse, pg, "t-3")
    assert count(warehouse, "analytics.dim_account") == 1
    assert warehouse.execute(
        "SELECT account_state FROM analytics.dim_account").fetchone()[0] == "SUSPENDED"


def test_schema_is_idempotent(warehouse, tmp_path):
    """Re-applying the migrations over a populated warehouse changes nothing."""
    import contextlib
    import io

    before = count(warehouse, "analytics.load_watermark")
    with contextlib.redirect_stdout(io.StringIO()):
        loader.apply_schema(warehouse, tmp_path / "warehouse.duckdb")
    assert count(warehouse, "analytics.load_watermark") == before
