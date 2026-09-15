"""End-to-end tests for the incremental load. Skips cleanly without PostgreSQL."""
from __future__ import annotations

import load_fact_trades as loader

ORDER_1 = "550e8400-e29b-41d4-a716-446655440001"
ORDER_2 = "550e8400-e29b-41d4-a716-446655440002"
ORDER_3 = "550e8400-e29b-41d4-a716-446655440003"


def seed_reference_data(db):
    db.run_or_die("seeding reference data", sql="""
        INSERT INTO bank_account (account_number, client_id, name, phone, email, account_balance, bank_name, ifsc_code)
        VALUES ('ACC001', 1, 'Aarav', '9999', 'aarav@example.com', 100000, 'SBI', 'SBIN0001');
        INSERT INTO clients (client_id, account_number, name, email, phone, created_on, account_state, wallet_balance)
        VALUES (1, 'ACC001', 'Aarav', 'aarav@example.com', '9999', '2025-12-01', 'ACTIVE', 50000);
        INSERT INTO instruments (instrument_id, instrument_name, active) VALUES ('RELIANCE', 'Reliance', TRUE);
        SELECT setval('clients_client_id_seq', 1);
    """)


def place_order(db, order_id, created_at, status, quantity="40", price="2875.5", executed=None,
                terminal_at=None, failure_code=None):
    executed_sql = "NULL" if executed is None else executed
    db.run_or_die("placing order " + order_id, sql=(
        "INSERT INTO orders (order_id, client_id, account_id, instrument_id, order_type, side, quantity, price, "
        "executed_price, status, idempotency_key, created_at, updated_at) VALUES ("
        "'" + order_id + "', 1, 1, 'RELIANCE', 'HOLDING', 'BUY', " + quantity + ", " + price + ", "
        + executed_sql + ", '" + status + "', 'idem-" + order_id[-4:] + "', '" + created_at + "', '" + created_at + "');"
    ))
    if terminal_at:
        db.run_or_die("history for " + order_id, sql=(
            "INSERT INTO order_history (order_id, event_type, previous_status, new_status, event_timestamp, failure_code) "
            "VALUES ('" + order_id + "', 'CREATED', NULL, 'NEW', '" + created_at + "', NULL), "
            "('" + order_id + "', '" + status + "', 'NEW', '" + status + "', '" + terminal_at + "', "
            + ("NULL" if failure_code is None else "'" + failure_code + "'") + ");"
        ))


def count(db, table):
    return int(db.scalar("SELECT count(*) FROM " + table + ";"))


def test_incremental_load_populates_fact_trades(db):
    seed_reference_data(db)
    place_order(db, ORDER_1, "2026-01-05 09:16:00", "FILLED", executed="2880", terminal_at="2026-01-05 09:17:00")
    place_order(db, ORDER_2, "2026-01-05 09:18:00", "REJECTED", terminal_at="2026-01-05 09:18:30",
                failure_code="INSUFFICIENT_FUNDS")
    place_order(db, ORDER_3, "2026-01-05 09:20:00", "NEW")  # still open: not a trade yet

    loader.load_dims(db, "t-1")
    result = loader.load_facts(db, "t-1")

    assert result == {"extracted": 2, "merged": 2, "dead_lettered": 0,
                      "watermark": result["watermark"]}
    assert count(db, "analytics.fact_trades") == 2
    assert count(db, "analytics.dead_letter_trades") == 0

    rows = db.rows(
        "SELECT order_id, status, trade_value, failure_code, date_key FROM analytics.fact_trades ORDER BY order_id;"
    )
    assert rows[0][:2] == [ORDER_1, "FILLED"]
    assert rows[0][2] == "115200.0000"          # 40 * 2880 (executed price)
    assert rows[1][:2] == [ORDER_2, "REJECTED"]
    assert rows[1][2] == "115020.0000"          # 40 * 2875.5 (limit price, never executed)
    assert rows[1][3] == "INSUFFICIENT_FUNDS"
    assert rows[0][4] == "20260105"

    watermark = db.scalar("SELECT last_watermark FROM analytics.load_watermark WHERE table_name='fact_trades';")
    assert watermark.startswith("2026-01-05 09:18:00")


def test_second_load_with_no_new_data_adds_no_rows(db):
    seed_reference_data(db)
    place_order(db, ORDER_1, "2026-01-05 09:16:00", "FILLED", executed="2880", terminal_at="2026-01-05 09:17:00")
    loader.load_dims(db, "t-1")
    loader.load_facts(db, "t-1")
    assert count(db, "analytics.fact_trades") == 1

    again = loader.load_facts(db, "t-2")
    assert again["extracted"] == 0 and again["merged"] == 0
    assert count(db, "analytics.fact_trades") == 1

    # a forced replay over the same window merges, it does not duplicate
    replay = loader.load_facts(db, "t-3", since=loader.datetime(2026, 1, 1))
    assert replay["merged"] == 1
    assert count(db, "analytics.fact_trades") == 1
    assert db.scalar("SELECT load_id FROM analytics.fact_trades;") == "t-3"


def test_order_reaching_terminal_state_after_watermark_is_picked_up(db):
    seed_reference_data(db)
    place_order(db, ORDER_1, "2026-01-05 09:16:00", "FILLED", executed="2880", terminal_at="2026-01-05 09:17:00")
    loader.load_dims(db, "t-1")
    loader.load_facts(db, "t-1")

    place_order(db, ORDER_2, "2026-01-06 10:00:00", "CANCELLED", terminal_at="2026-01-06 10:05:00")
    result = loader.load_facts(db, "t-2")
    assert result["merged"] == 1
    assert count(db, "analytics.fact_trades") == 2


def test_invalid_row_is_dead_lettered_and_load_continues(db):
    seed_reference_data(db)
    place_order(db, ORDER_1, "2026-01-05 09:16:00", "FILLED", executed="2880", terminal_at="2026-01-05 09:17:00")
    # a bad row the source constraints cannot catch: terminal event before creation
    place_order(db, ORDER_2, "2026-01-05 09:18:00", "FILLED", executed="2880", terminal_at="2026-01-05 09:00:00")
    place_order(db, ORDER_3, "2026-01-05 09:20:00", "CANCELLED", terminal_at="2026-01-05 09:21:00")

    loader.load_dims(db, "t-1")
    result = loader.load_facts(db, "t-1")

    assert result["merged"] == 2
    assert result["dead_lettered"] == 1
    assert count(db, "analytics.fact_trades") == 2

    dl = db.rows("SELECT order_id, check_name, load_id, source_row->>'quantity' FROM analytics.dead_letter_trades;")
    assert dl == [[ORDER_2, "terminal_after_created", "t-1", "40.0000"]]

    # the watermark still advanced past the bad row: it is not silently retried forever
    watermark = db.scalar("SELECT last_watermark FROM analytics.load_watermark WHERE table_name='fact_trades';")
    assert watermark.startswith("2026-01-05 09:20:00")


def test_skipped_dimension_load_dead_letters_instead_of_inserting_placeholder(db):
    seed_reference_data(db)
    place_order(db, ORDER_1, "2026-01-05 09:16:00", "FILLED", executed="2880", terminal_at="2026-01-05 09:17:00")

    result = loader.load_facts(db, "t-1")  # no load_dims first

    assert result["merged"] == 0 and result["dead_lettered"] == 1
    assert count(db, "analytics.fact_trades") == 0
    assert count(db, "analytics.dim_instrument") == 0
    assert db.scalar("SELECT check_name FROM analytics.dead_letter_trades;") == "fk_instrument"

    # fix: load dims and replay the window
    loader.load_dims(db, "t-2")
    replay = loader.load_facts(db, "t-2", since=loader.datetime(2026, 1, 1))
    assert replay["merged"] == 1
    assert count(db, "analytics.fact_trades") == 1


def test_dim_loads_are_idempotent_and_reflect_source_changes(db):
    seed_reference_data(db)
    loader.load_dims(db, "t-1")
    dates_before = count(db, "analytics.dim_date")
    loader.load_dims(db, "t-2")
    assert count(db, "analytics.dim_date") == dates_before
    assert count(db, "analytics.dim_instrument") == 1

    db.run_or_die("suspending client", sql="UPDATE clients SET account_state = 'SUSPENDED' WHERE client_id = 1;")
    loader.load_dims(db, "t-3")
    assert count(db, "analytics.dim_account") == 1
    assert db.scalar("SELECT account_state FROM analytics.dim_account;") == "SUSPENDED"
