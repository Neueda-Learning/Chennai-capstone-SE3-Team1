"""Row-level validation for the fact_trades load.

Pure functions only: nothing here touches the database, so every check can be
unit-tested with a dict. A row either becomes a CleanTrade ready to merge, or a
Rejection naming the first check it failed and why.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Mapping, Optional, Set, Union

TERMINAL_STATUSES = ("FILLED", "REJECTED", "CANCELLED")
SIDES = ("BUY", "SELL")
ORDER_TYPES = ("POSITION", "HOLDING")


@dataclass(frozen=True)
class CleanTrade:
    order_id: uuid.UUID
    idempotency_key: str
    date_key: int
    instrument_id: str
    client_id: int
    order_type: str
    side: str
    status: str
    quantity: Decimal
    price: Decimal
    executed_price: Optional[Decimal]
    trade_value: Decimal
    failure_code: Optional[str]
    failure_reason: Optional[str]
    order_created_at: datetime
    terminal_at: datetime


@dataclass(frozen=True)
class Rejection:
    check_name: str
    reason: str
    order_id: Optional[uuid.UUID]


@dataclass(frozen=True)
class DimensionKeys:
    """The natural keys currently present in each dimension."""
    instrument_ids: Set[str]
    client_ids: Set[int]
    date_keys: Set[int]


class _Reject(Exception):
    def __init__(self, check_name: str, reason: str):
        super().__init__(reason)
        self.check_name = check_name
        self.reason = reason


def date_key_of(value: Union[date, datetime]) -> int:
    return value.year * 10000 + value.month * 100 + value.day


def _text(row: Mapping[str, Any], field: str, required: bool = True) -> Optional[str]:
    value = row.get(field)
    if value is None or (isinstance(value, str) and value.strip() == ""):
        if required:
            raise _Reject("null_" + field, field + " is null")
        return None
    return str(value).strip()


def _decimal(row: Mapping[str, Any], field: str, required: bool = True) -> Optional[Decimal]:
    raw = row.get(field)
    if raw is None or (isinstance(raw, str) and raw.strip() == ""):
        if required:
            raise _Reject("null_" + field, field + " is null")
        return None
    if isinstance(raw, bool):
        raise _Reject("type_" + field, field + " is a boolean, expected a number: " + repr(raw))
    try:
        value = Decimal(str(raw))
    except (InvalidOperation, ValueError):
        raise _Reject("type_" + field, field + " is not numeric: " + repr(raw))
    if not value.is_finite():
        raise _Reject("type_" + field, field + " is not a finite number: " + repr(raw))
    return value


def _timestamp(row: Mapping[str, Any], field: str) -> datetime:
    raw = row.get(field)
    if raw is None or (isinstance(raw, str) and raw.strip() == ""):
        raise _Reject("null_" + field, field + " is null")
    if isinstance(raw, datetime):
        return raw
    try:
        return datetime.fromisoformat(str(raw).strip())
    except ValueError:
        raise _Reject("type_" + field, field + " is not a timestamp: " + repr(raw))


def _integer(row: Mapping[str, Any], field: str) -> int:
    raw = row.get(field)
    if raw is None or (isinstance(raw, str) and raw.strip() == ""):
        raise _Reject("null_" + field, field + " is null")
    if isinstance(raw, bool):
        raise _Reject("type_" + field, field + " is a boolean, expected an integer")
    try:
        return int(str(raw).strip())
    except ValueError:
        raise _Reject("type_" + field, field + " is not an integer: " + repr(raw))


def _order_id(row: Mapping[str, Any]) -> Optional[uuid.UUID]:
    raw = row.get("order_id")
    if raw is None:
        return None
    try:
        return uuid.UUID(str(raw))
    except ValueError:
        return None


def validate_row(row: Mapping[str, Any], dims: DimensionKeys) -> Union[CleanTrade, Rejection]:
    """Run every load-and-data-quality check on one extracted row.

    Checks run in a fixed order and the first failure wins, so a row with several
    problems is dead-lettered once, under the most fundamental one.
    """
    order_id = _order_id(row)
    try:
        if order_id is None:
            raise _Reject("invalid_order_id", "order_id is missing or not a UUID: " + repr(row.get("order_id")))

        idempotency_key = _text(row, "idempotency_key")
        instrument_id = _text(row, "instrument_id")
        client_id = _integer(row, "client_id")
        order_created_at = _timestamp(row, "order_created_at")
        terminal_at = _timestamp(row, "terminal_at")

        # referential integrity into all three dimensions
        if instrument_id not in dims.instrument_ids:
            raise _Reject("fk_instrument", "instrument " + instrument_id + " is not in dim_instrument")
        if client_id not in dims.client_ids:
            raise _Reject("fk_account", "client " + str(client_id) + " is not in dim_account")
        date_key = date_key_of(order_created_at)
        if date_key not in dims.date_keys:
            raise _Reject("fk_date", "date " + str(date_key) + " is not in dim_date")

        # vocabulary
        order_type = _text(row, "order_type")
        if order_type not in ORDER_TYPES:
            raise _Reject("valid_order_type", "order_type " + repr(order_type) + " not in " + str(ORDER_TYPES))
        side = _text(row, "side")
        if side not in SIDES:
            raise _Reject("valid_side", "side " + repr(side) + " not in " + str(SIDES))
        status = _text(row, "status")
        if status not in TERMINAL_STATUSES:
            raise _Reject("valid_status", "status " + repr(status) + " not in " + str(TERMINAL_STATUSES))

        # measures
        quantity = _decimal(row, "quantity")
        if quantity <= 0:
            raise _Reject("positive_quantity", "quantity must be > 0, got " + str(quantity))
        price = _decimal(row, "price")
        if price <= 0:
            raise _Reject("positive_price", "price must be > 0, got " + str(price))
        executed_price = _decimal(row, "executed_price", required=False)
        if executed_price is not None and executed_price <= 0:
            raise _Reject("positive_executed_price", "executed_price must be > 0, got " + str(executed_price))
        if status == "FILLED" and executed_price is None:
            raise _Reject("filled_has_executed_price", "a FILLED order must carry an executed_price")

        trade_value = quantity * (executed_price if executed_price is not None else price)
        if trade_value <= 0:
            raise _Reject("trade_value_recomputes", "recomputed trade_value is " + str(trade_value))

        if terminal_at < order_created_at:
            raise _Reject("terminal_after_created", "terminal event at " + terminal_at.isoformat()
                          + " precedes order creation at " + order_created_at.isoformat())

    except _Reject as exc:
        return Rejection(exc.check_name, exc.reason, order_id)

    return CleanTrade(
        order_id=order_id,
        idempotency_key=idempotency_key,
        date_key=date_key,
        instrument_id=instrument_id,
        client_id=client_id,
        order_type=order_type,
        side=side,
        status=status,
        quantity=quantity,
        price=price,
        executed_price=executed_price,
        trade_value=trade_value,
        failure_code=_text(row, "failure_code", required=False),
        failure_reason=_text(row, "failure_reason", required=False),
        order_created_at=order_created_at,
        terminal_at=terminal_at,
    )
