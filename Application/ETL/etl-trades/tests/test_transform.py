"""Pure tests for the row checks: no database needed."""
from __future__ import annotations

from decimal import Decimal

import pytest

from transform import CleanTrade, DimensionKeys, Rejection, date_key_of, validate_row

DIMS = DimensionKeys(
    instrument_ids={"RELIANCE", "TCS"},
    client_ids={1, 2},
    date_keys={20260105, 20260106},
)


def good_row(**overrides):
    row = {
        "order_id": "550e8400-e29b-41d4-a716-446655440001",
        "client_id": 1,
        "instrument_id": "RELIANCE",
        "order_type": "HOLDING",
        "side": "BUY",
        "quantity": Decimal("40"),
        "price": Decimal("2875.5000"),
        "executed_price": Decimal("2880.0000"),
        "idempotency_key": "ord-1001",
        "order_created_at": "2026-01-05T09:16:00",
        "status": "FILLED",
        "terminal_at": "2026-01-05T09:17:00",
        "failure_code": None,
        "failure_reason": None,
    }
    row.update(overrides)
    return row


def test_clean_row_passes_and_recomputes_trade_value():
    out = validate_row(good_row(), DIMS)
    assert isinstance(out, CleanTrade)
    assert out.date_key == 20260105
    assert out.trade_value == Decimal("40") * Decimal("2880.0000")


def test_trade_value_falls_back_to_limit_price_when_not_filled():
    out = validate_row(good_row(status="CANCELLED", executed_price=None), DIMS)
    assert isinstance(out, CleanTrade)
    assert out.trade_value == Decimal("40") * Decimal("2875.5000")


@pytest.mark.parametrize("field,value,check", [
    ("quantity", None, "null_quantity"),
    ("quantity", "", "null_quantity"),
    ("price", None, "null_price"),
    ("side", None, "null_side"),
    ("status", None, "null_status"),
    ("order_created_at", None, "null_order_created_at"),
    ("idempotency_key", "   ", "null_idempotency_key"),
])
def test_nulls_are_dead_lettered_not_coerced(field, value, check):
    out = validate_row(good_row(**{field: value}), DIMS)
    assert isinstance(out, Rejection)
    assert out.check_name == check


@pytest.mark.parametrize("field,value,check", [
    ("quantity", "forty", "type_quantity"),
    ("quantity", True, "type_quantity"),
    ("price", "NaN", "type_price"),
    ("client_id", "one", "type_client_id"),
    ("order_created_at", "yesterday", "type_order_created_at"),
    ("order_id", "not-a-uuid", "invalid_order_id"),
])
def test_type_mismatches_are_dead_lettered(field, value, check):
    out = validate_row(good_row(**{field: value}), DIMS)
    assert isinstance(out, Rejection)
    assert out.check_name == check


@pytest.mark.parametrize("field,value,check", [
    ("quantity", "-5", "positive_quantity"),
    ("quantity", "0", "positive_quantity"),
    ("price", "0", "positive_price"),
    ("executed_price", "-1", "positive_executed_price"),
    ("side", "HOLD", "valid_side"),
    ("status", "NEW", "valid_status"),
    ("order_type", "MARKET", "valid_order_type"),
    ("instrument_id", "INFY", "fk_instrument"),
    ("client_id", 99, "fk_account"),
    ("order_created_at", "2025-12-31T10:00:00", "fk_date"),
])
def test_contract_checks(field, value, check):
    out = validate_row(good_row(**{field: value}), DIMS)
    assert isinstance(out, Rejection)
    assert out.check_name == check


def test_filled_order_needs_an_executed_price():
    out = validate_row(good_row(executed_price=None), DIMS)
    assert isinstance(out, Rejection)
    assert out.check_name == "filled_has_executed_price"


def test_terminal_event_cannot_precede_creation():
    out = validate_row(good_row(terminal_at="2026-01-05T09:00:00"), DIMS)
    assert isinstance(out, Rejection)
    assert out.check_name == "terminal_after_created"


def test_rejection_keeps_order_id_for_investigation():
    out = validate_row(good_row(quantity="-1"), DIMS)
    assert isinstance(out, Rejection)
    assert str(out.order_id) == "550e8400-e29b-41d4-a716-446655440001"


def test_date_key_format():
    from datetime import datetime
    assert date_key_of(datetime(2026, 1, 5, 9, 16)) == 20260105
