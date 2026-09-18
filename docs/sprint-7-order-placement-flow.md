# Sprint 7 Order Placement Flow

This document explains how order placement flows through three modules in this repo:

- `sprint-05-domain-engine` (business model and domain rules)
- `sprint-06-api` (synchronous order acceptance + event publication)
- `executor` (asynchronous pricing, settlement, event outcomes)

It also separates all major placement scenarios (accept, reject, retry, dead-letter, replay).

---

## 1) What each module does

## `sprint-05-domain-engine` (business language)

This module defines the business meaning, enums, and exception vocabulary used by API and executor.

Key logic/examples:

- `Client.canTrade()` -> account must be `ACTIVE`.
- `Client.canAfford(amount)` -> wallet must cover required cost.
- `Instrument.isTradable()` -> instrument must be active/tradable.
- `Order` lifecycle states (`NEW`, `FILLED`, `REJECTED`, `CANCELLED`) and transitions.
- Domain exceptions such as:
  - `AccountNotFoundException`
  - `AccountNotActiveException`
  - `InsufficientFundsException`
  - `InsufficientHoldingsException`
  - `InstrumentNotFoundException`
  - `DuplicateOrderException`

Input DTO validation is defined in domain DTO:

- `PlaceOrderRequest` validates accountId, symbol, side, quantity, price, idempotencyKey.

## `sprint-06-api` (accept order + emit event)

Responsibilities:

- Validate request and account reachability/token ownership.
- Re-check account and instrument rules at acceptance time.
- Apply rule-ordered business checks (fail fast).
- Insert order row at `NEW`.
- Append `order_history` acceptance row (`CREATED -> NEW`).
- Publish `ORDER_PLACED` after commit.

It does **not** perform price discovery or fill settlement synchronously.

## `executor` (consume, price, settle, publish outcome)

Responsibilities:

- Consume `ORDER_PLACED` from Kafka `orders` topic.
- Validate event envelope and payload safety.
- Check instrument still tradable at execution time.
- Fetch quote from Fauxnance.
- Run pure fill rule (`FillRule`) from order + quote.
- Settle in one DB transaction:
  - guarded order status update (`WHERE status='NEW'`),
  - wallet update (optimistic lock retry),
  - position update,
  - terminal `order_history` append.
- Publish `ORDER_FILLED` or `ORDER_REJECTED` to `trade-events`.
- Acknowledge Kafka offset after processing/publish path.

---

## 2) Primary control flow (happy path)

1. Client calls `POST /api/v1/orders`.
2. API validates request and domain rules in order.
3. API inserts into `orders` with status `NEW`.
4. API inserts `order_history` row (`event_type='CREATED'`, `new_status='NEW'`).
5. After commit, API publishes `ORDER_PLACED` (key = accountId) to topic `orders`.
6. Executor consumer receives event in consumer group `trade-executor`.
7. Executor validates instrument + fetches quote.
8. `FillRule.evaluate(order, quote)` decides fill/reject and price.
9. `SettlementService` performs atomic settlement transaction.
10. Executor publishes terminal event to `trade-events`:
    - `ORDER_FILLED` (with `cashDelta`, `positionQuantityAfter`, `averageCostAfter`), or
    - `ORDER_REJECTED` (with reason code).
11. Consumer acknowledges Kafka offset.

---

## 3) Business logic map by stage

## API-time checks (before order is accepted)

Performed in `OrderService.placeOrder(...)`:

1. Account exists.
2. Token account scope matches request account.
3. Account can trade (`ACTIVE`).
4. Instrument exists and is tradable.
5. Quantity and price are valid.
6. BUY affordability check.
7. SELL holdings check.
8. Idempotency key uniqueness (`orders` unique constraint).

If any check fails, API returns error and **no order event is published**.

## Executor-time checks (after order accepted)

Performed in `OrderConsumer` + `SettlementService`:

- Envelope/eventType/payload sanity checks.
- Instrument tradable re-check at execution time.
- Quote availability and quality checks.
- Fill decision from market quote.
- Account active re-check and affordability/holdings re-check inside settlement.
- Atomic writes and replay guard through conditional order status update.

---

## 4) Scenario-by-scenario control flow

## Scenario A: API rejects before order is accepted

Typical causes:

- Account missing
- Token mismatch
- Account not active
- Unknown/untradable symbol
- Invalid quantity/price
- Insufficient funds/holdings at request time
- Duplicate idempotency key

Outcome:

- No row inserted into `orders` for a new order attempt (except duplicate case where existing row already exists).
- No `ORDER_PLACED` event.
- No executor involvement.

## Scenario B: Accepted order -> FILLED

Flow:

- API writes `orders(NEW)` and `order_history(CREATED->NEW)`; publishes `ORDER_PLACED`.
- Executor computes fill and settles.

DB outcomes:

- `orders`: `NEW -> FILLED`, `executed_price`, `executed_on` set.
- `clients`: wallet debited for BUY or credited for SELL.
- `portfolio_holding`: quantity/avg-cost updated.
- `order_history`: terminal row appended (`EXECUTED`, `NEW -> FILLED`).

Kafka outcome:

- `ORDER_FILLED` to `trade-events` keyed by account.

## Scenario C: Accepted order -> business REJECT (non-terminal errors resolved)

Typical causes:

- Limit rule not marketable (`BUY_LIMIT_BELOW_ASK`, `SELL_LIMIT_ABOVE_BID`).
- No price available from quote decision path.
- Quote permanent business failure mapped to reject reason.
- Execution-time insufficient funds/holdings (state drift since acceptance).

DB outcomes:

- `orders`: `NEW -> REJECTED`.
- `clients`/`portfolio_holding`: unchanged for reject path.
- `order_history`: terminal reject row with failure code/reason.

Kafka outcome:

- `ORDER_REJECTED` published to `trade-events` with reason.

## Scenario D: Accepted order -> account not active at execution time

Cause:

- Account becomes suspended/closed between API acceptance and executor settlement.

Outcome:

- Settlement returns `ACCOUNT_NOT_ACTIVE`.
- Classified as deterministic failure category.
- Message is dead-lettered (immediate path), preventing infinite retries.

## Scenario E: Transient infrastructure failure -> retry then success

Typical causes:

- Temporary DB connectivity issue.
- Temporary quote service unreachable.

Outcome:

- Exponential backoff retry inside consumer flow.
- If later attempt succeeds, order resolves and no DLT entry is produced.

## Scenario F: Transient failure -> retry budget exhausted -> DLT

Cause:

- Transient issue persists beyond retry budget.

Outcome:

- Message published to dead-letter topic with headers:
  - failure reason/details
  - category
  - attempt count
  - first failure time
- Offset acknowledged so partition does not stall indefinitely.

## Scenario G: Poison / malformed / unexpected event

Typical causes:

- Null/malformed payload.
- Missing required fields.
- Unexpected `eventType` (not `ORDER_PLACED`).
- Order ID not found in DB.

Outcome:

- Immediate dead-letter (no retry loop).
- Offset acknowledged.

## Scenario H: Duplicate/replayed delivery

Cause:

- Kafka at-least-once semantics replay same message.

Guard behavior:

- Settlement guarded update (`status='NEW'`) affects zero rows if already settled.
- Executor detects `ALREADY_SETTLED_*` and exits without duplicate publish.

Outcome:

- No second cash move.
- No second position move.
- No second `ORDER_FILLED`/`ORDER_REJECTED` event.

---

## 5) Data consistency and ordering guarantees

- Topic keys preserve ordering scope:
  - `orders` and `trade-events` keyed by account.
  - `market-data` keyed by symbol.
- Guarded state transition prevents double settlement.
- Account update uses optimistic lock retry.
- Settlement writes are transactional (all-or-nothing).
- Publish occurs after transaction outcome; consumer ack is after publish path.

---

## 6) Key files for tracing this flow

Domain layer:

- `sprint-05-domain-engine/src/main/java/com/team1/trading/domain/entity/Client.java`
- `sprint-05-domain-engine/src/main/java/com/team1/trading/domain/entity/Instrument.java`
- `sprint-05-domain-engine/src/main/java/com/team1/trading/domain/entity/Order.java`
- `sprint-05-domain-engine/src/main/java/com/team1/trading/domain/dto/PlaceOrderRequest.java`

API layer:

- `sprint-06-api/src/main/java/com/team1/trading/api/controller/OrderController.java`
- `sprint-06-api/src/main/java/com/team1/trading/api/service/OrderService.java`
- `sprint-06-api/src/main/java/com/team1/trading/api/mapper/OrderMapper.java`
- `sprint-06-api/src/main/java/com/team1/trading/api/mapper/OrderHistoryMapper.java`

Executor layer:

- `executor/src/main/java/com/team1/executor/consumer/OrderConsumer.java`
- `executor/src/main/java/com/team1/executor/rule/FillRule.java`
- `executor/src/main/java/com/team1/executor/settlement/SettlementService.java`
- `executor/src/main/java/com/team1/executor/error/ErrorClassifier.java`
- `executor/src/main/java/com/team1/executor/error/ErrorCategory.java`
- `executor/src/main/java/com/team1/executor/error/DeadLetterService.java`
- `executor/src/main/java/com/team1/executor/mapper/OrderHistoryMapper.java`

Schema/migrations:

- `migrations/005_orders.sql`
- `migrations/006_order_history.sql`
- `migrations/011_order_history_add_client_id.sql`

---

## 7) Kafka in this application (producer, consumer, and purpose)

## Producers

- `sprint-06-api` is a producer for `orders`:
  - publishes `ORDER_PLACED` after DB commit,
  - key = `accountId` (keeps one account's order stream ordered).
- `executor` is a producer for `trade-events`:
  - publishes `ORDER_FILLED` / `ORDER_REJECTED`,
  - key = `accountId`.
- `executor` market-data poller is a producer for `market-data`:
  - publishes one quote message per symbol,
  - key = `symbol`.
- `executor` dead-letter service is a producer for DLT topics (`orders.DLT`, etc.) when a message cannot be processed safely.

## Consumers

- `executor` is the main consumer of `orders` (consumer group: `trade-executor`):
  - reads `ORDER_PLACED`,
  - validates/prices/settles,
  - publishes outcome events.
- Other consumers (dashboards/analytics/monitoring) can consume `trade-events` and `market-data` independently without changing API/executor runtime logic.

## What Kafka does here

Kafka is the async backbone between acceptance and execution.

- Decouples API from executor: API can accept quickly; executor can process asynchronously.
- Preserves ordering per key and partition:
  - all messages for one account stay ordered in `orders`/`trade-events`,
  - all messages for one symbol stay ordered in `market-data`.
- Provides durability and replay support (at-least-once delivery):
  - duplicate delivery can happen by design,
  - executor uses guarded state transition + idempotent settlement behavior to avoid double effects.
- Supports resilient failure handling:
  - retry transient issues,
  - dead-letter poison/deterministic failures,
  - keep partition progress moving.

---

## 8) Practical summary

When an order is placed, the API does rule validation and files the order at `NEW`; the executor then owns pricing and terminal resolution. Every accepted order is forced to a terminal outcome (`FILLED`, `REJECTED`, or DLT-handled failure path), while transactional guards prevent double debit and duplicate downstream events.

