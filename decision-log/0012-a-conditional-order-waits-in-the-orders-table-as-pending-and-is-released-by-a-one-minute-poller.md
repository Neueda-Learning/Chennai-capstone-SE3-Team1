# 0012 A conditional order waits in the orders table as PENDING and a one-minute poller releases it as an ordinary order

| Field | Value |
|---|---|
| Status | proposed |
| Date | 2026-10-07 |
| Decided by | requested by the product owner on 2026-10-07 ("in the orders table, if an order is set to execute when a condition is met, hold it as pending and every minute poll to check if it can be executed"); supersedes the earlier strategies-module design, which was never merged |

## Context

Automated execution must act when a price or a moving-average or Bollinger-band condition is met. A first design ran rules as separate "strategies" on the `market-data` stream and placed orders by calling the Trade API with a token it minted for itself. The product owner asked instead for the order itself to wait in the `orders` table. That table holds only live orders (`chk_orders_status` allowed `NEW` only since migration 010); the executor fills or rejects an order the moment its `ORDER_PLACED` event arrives, and moves it to `order_history`. Market data arrives roughly once a minute per instrument through the `portfolio-service` consumer, which writes `market_quotes`.

## Options considered

| Option | For | Against |
|---|---|---|
| Rules run on the `market-data` stream and place orders through the Trade API with a minted token (the first design) | Reacts to every tick | A new credential the service mints for itself; a separate rule store; the customer's "order" does not exist until the rule fires |
| A conditional order is a row in `orders` with status `PENDING` and its condition; a scheduler checks pending rows every minute against `market_quotes` and releases met ones | The order exists from the moment the customer places it, through the ordinary route with their own token, so every check (account, instrument, cash or holdings, idempotency) runs then; release needs no identity at all; one place (the order book) to see what is waiting; cancel is the existing `DELETE /api/v1/orders/{id}` | Up to a minute's delay; the poller reads quotes rather than reacting to them; the `orders` table gains columns the executor ignores |
| Store the condition in the executor and let it hold the order | Executor already prices orders | Spreads order-entry logic across two services; the executor would need the history and indicator logic |

## Decision

The second option.

- **Placement**: `POST /api/v1/orders/conditional` runs every check `POST /api/v1/orders` runs, then holds the order: `status = 'PENDING'` with `condition_type` and its parameters and `expires_at` (default 30 days, at most 90). Nothing is published. At most 25 may wait per account.
- **Checking**: `ConditionalOrderPoller` runs every 60 s (`conditional-orders.poll-interval-ms`). It groups pending orders by symbol, reads each symbol's quotes once, and skips a symbol whose latest quote is flagged stale or older than ten minutes: a condition is never met on a price the market is not showing.
- **Conditions**: price at or above / at or below a trigger (levels, met on any check where true); short/long average crossing above or below, and price leaving a Bollinger band (events). Events store the last state seen (`condition_state`), so a crossing is caught however many quotes arrived between checks, and an order placed after a crossing waits for the next one.
- **Release**: a guarded `UPDATE ... SET status = 'NEW' ... WHERE status = 'PENDING'` and, in the same transaction, the same `OrderPlacedEvent` `placeOrder` publishes after commit. From there it is an ordinary order: the executor fills at the limit or better, or rejects it. Zero rows updated (cancelled a moment ago) publishes nothing.
- **Expiry**: an unmet order past `expires_at` is moved to `order_history` as `CANCELLED`, external status `EXPIRED`.

## Consequences

`OrderStatus` gains `PENDING` and the domain `Order` gains the condition fields (the schema parity check requires both). `PendingOrderRepublisher` still only republishes `NEW`, so a crash after release but before the Kafka send is recovered as it always was. Cash and holdings are checked at placement and again by the executor at release, not reserved in between, so a released order can be rejected for insufficient funds, visibly, with the reason in the blotter. The executor's history row does not carry the condition, so after a conditional order settles it looks like any other; the trigger reason is visible while it is in the book. A one-minute cadence matches the poller that feeds quotes; anything faster would only re-read the same quote.
