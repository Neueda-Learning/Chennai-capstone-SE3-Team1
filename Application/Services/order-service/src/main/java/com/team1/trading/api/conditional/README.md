# Conditional orders

An order that waits in the `orders` table as `PENDING` until a price or signal is reached, then runs as an ordinary order ([`0012`](../../../../../../../../../../../decision-log/0012-a-conditional-order-waits-in-the-orders-table-as-pending-and-is-released-by-a-one-minute-poller.md)). In production this would also sit behind suitability and risk controls.

| | |
|---|---|
| Where customers place them | Market & Trade ([`0016`](../../../../../../../../../../../decision-log/0016-scheduled-orders-are-placed-from-the-stocks-chart-with-the-condition-inferred-not-chosen.md)): "At a price level" or "On a moving average" opens the stock's chart; the level is marked on it (rise or fall inferred) or the average line drawn (buy = cross above, sell = cross below); waiting orders are listed under the ticket with Cancel and drawn on the chart. The assistant proposes them too |
| Routes | `POST /api/v1/orders/conditional`, `GET /api/v1/orders/{id}`, `GET /api/v1/accounts/{accountId}/conditional-orders` ([`conditional-orders-api.yaml`](../../../../../../../../../../Contracts/api-schemas/conditional-orders-api.yaml)); cancel is the existing `DELETE /api/v1/orders/{id}` |
| Placement | `OrderService.placeConditionalOrder`: every check `placeOrder` makes, then `Order.holdUntil` and an insert with `status = PENDING`; nothing published |
| Checking | `ConditionalOrderPoller` every 60 s calls `ConditionalOrderChecker.checkAll` |
| Release | `ConditionalOrderReleaser.release`: guarded `UPDATE ... SET status = 'NEW' WHERE status = 'PENDING'` and the same `OrderPlacedEvent` an ordinary order publishes |
| Reads | `market_quotes` (latest quote and recent history per symbol) |
| Schema | migration `031` (condition columns on `orders`, `PENDING` allowed, `previous_status = PENDING` allowed in history); `034` allows a crossover's short window of 1, the price itself |

## One pass

1. Expire: a PENDING order past `expires_at` is deleted from `orders` and archived as `CANCELLED`, external status `EXPIRED`.
2. Per symbol, read the latest quote. Stale, missing, or older than `conditional-orders.max-quote-age` (10 minutes): skip the symbol.
3. Read as many recent quotes as the most demanding order on that symbol needs.
4. `ConditionRules.evaluate` each order. Price levels are met whenever true; crossovers and bands are met when the stored `condition_state` moves into the wanted one.
5. Met: release. Not met: store the state and `last_checked_at`.

## Properties

| Property | Default | Meaning |
|---|---|---|
| `conditional-orders.poll-interval-ms` | `60000` | Delay between passes |
| `conditional-orders.max-quote-age` | `PT10M` | A quote older than this is not acted on |
| `conditional-orders.release.enabled` | `true` | `false` keeps checking and recording state but releases nothing (kill switch) |
| `conditional-orders.scheduler.enabled` | `true` (`false` in tests) | Turns the poller on |

## Errors

`COND-422` (condition missing what its type needs), `COND-429` (25 already waiting), plus the ordinary order codes (`ACC-403`, `ORD-400`, `ORD-409`, `INS-404`, `VAL-422`).

## Tests

`ConditionalOrderTest` (domain), `ConditionRulesTest` (levels, crossings, bands, too few quotes), `ConditionalOrderFlowTest` on H2 (held as PENDING and unpublished; released and published once when met; not met stays PENDING; stale and old quotes ignored; crossover waits for a crossing; expiry; cancel; status with condition; ordinary checks; COND-422; cap; ordinary orders unchanged), `ConditionalOrderControllerWebTest`, the list route in `ModuleRouteAuthorisationTest`. Angular: `order-ticket-page.spec.ts` (scheduled orders: level marked on the chart, rise or fall inferred, buy or sell asked, moving-average line, faster average, limits, refusal, waiting list and cancel, link); the assistant's proposal: `ChatOrderToolsTest`, `chat.store.spec.ts`.
