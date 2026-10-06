# Watchlists and Price Alerts

Lets a customer follow instruments with a live price beside each, and set a price alert that is handed to Notifications when a live quote reaches the threshold. Owns the `watchlists`, `watchlist_instruments` and `price_alerts` tables. A watchlist entry is not a position: nothing here touches orders, holdings or cash.

| | |
|---|---|
| Routes | `/api/v1/accounts/{accountId}/watchlists` and `/alerts` ([`watchlists-api.yaml`](../../../../../../../../../../Contracts/api-schemas/watchlists-api.yaml)); nine operations, all behind `AccessGuard.requireOwner` |
| Tables | `watchlists` (unique per account and lower-cased name), `watchlist_instruments` (cascade), `price_alerts` (migration `029`) |
| Consumes | `market-data` in consumer group `watchlist-service` (`QUOTE` events only) |
| Reads | `market_quotes` (latest quote per instrument) and `instruments` (symbol validation), read-only |
| Uses | `NotificationDelivery.deliver(AlertNotification) -> DeliveryOutcome` (Notifications; [`integration-seams.md`](../../../../../../../../../../../docs/sprint-10/integration-seams.md)) |
| Decisions | [`0005`](../../../../../../../../../../../decision-log/0005-a-price-alert-fires-once-then-deactivates.md), [`0006`](../../../../../../../../../../../decision-log/0006-watchlists-delivers-via-a-java-interface-not-an-http-route.md), [`0010`](../../../../../../../../../../../decision-log/0010-a-crossing-is-reaching-the-threshold-on-a-live-quote-and-an-undelivered-alert-is-recovered-by-a-sweep.md) |

## How an alert moves

1. `MarketDataAlertListener` reads a `QUOTE`, skips stale, malformed and non-positive prices (acknowledging them), and calls `AlertEvaluator.evaluate(symbol, price)`.
2. `PriceAlertMapper.findCrossedArmed` returns the `ARMED` alerts for that symbol the price has reached: `price >= threshold` for `ABOVE`, `price <= threshold` for `BELOW`. The partial index `idx_price_alerts_symbol_armed` serves it.
3. Each is fired with `UPDATE ... WHERE state = 'ARMED'`. Zero rows updated means someone else fired it and nothing is sent.
4. `AlertEvaluator.handOver` calls `NotificationDelivery.deliver` with a `deliveryId` derived from the alert id and its `fired_at`, and stores the outcome as `delivery_state`: `QUEUED`, `PENDING_CHANNEL`, `REJECTED`, or `DELIVERY_FAILED` if the call raised. The alert is never only logged.
5. The offset is acknowledged after evaluation. A database failure is not acknowledged (`nack` for 5 s). Any other failure on a quote is logged and the quote skipped.
6. `AlertDeliverySweeper` (every 60 s) re-hands any `FIRED` alert with no `delivery_state` that fired over 30 s ago, so a crash between steps 3 and 4 is repaired. Notifications ignores the repeat because `deliveryId` is the same.
7. The customer re-arms a `FIRED` or `DISABLED` alert with `PATCH {"state": "ARMED"}`; that clears the fired fields and the delivery state.

## Rules this package keeps

- **Own account only.** Both controllers call `AccessGuard.requireOwner` first; a different account in the path is `ACC-403` and an `ADMIN` token gets no bypass. A watchlist or alert id that belongs to another account is `WLT-404`, the same answer as one that does not exist.
- **Fire once.** One notification per crossing; the customer re-arms to be told again ([`0005`](../../../../../../../../../../../decision-log/0005-a-price-alert-fires-once-then-deactivates.md)).
- **Callers cannot set `FIRED`.** `PATCH` accepts `ARMED` or `DISABLED` only; anything else is `VAL-422`. Unknown JSON properties are `VAL-422` too.
- **Caps, enforced under a lock.** 10 watchlists and 25 alerts per account, 50 instruments per watchlist, each `429 WLT-429`. The count and the insert share a transaction that locks the account's `clients` row. A duplicate name is `409 WLT-409` (case-insensitive); an unknown or inactive symbol is `422 WLT-422`.
- **Consumes `market-data` only**, in its own group. It never reads `trade-events` or writes `orders`, and it has no visibility into the `notifications` table.
- **No route for delivery.** The hand-over is a Java call ([`0006`](../../../../../../../../../../../decision-log/0006-watchlists-delivers-via-a-java-interface-not-an-http-route.md)).
- **Group id is explicit.** `ConsumerGroupUniquenessTest` finds `watchlist-service` exactly once.

## Errors

| Code | Status | When |
|---|---|---|
| `ACC-403` | 403 | The path account is not the token's account |
| `AUTH-401` | 401 | No verified token |
| `VAL-422` | 422 | Blank or over-long name or symbol, threshold zero, negative, over 4 decimals or over 14 digits, bad direction, state `FIRED`, unknown property |
| `WLT-404` | 404 | Watchlist or alert not on this account, or an id that is not a UUID |
| `WLT-409` | 409 | A watchlist with that name already exists |
| `WLT-422` | 422 | Symbol is not an active instrument |
| `WLT-429` | 429 | A cap is reached |

## Properties

| Property | Default | Meaning |
|---|---|---|
| `watchlists.scheduler.enabled` | `true` (`false` in tests) | Turns the delivery sweeper on |
| `watchlists.sweep.interval-ms` | `60000` | Delay between sweeps |

## Known limitations

- The live price is the latest row in `market_quotes`, written by the Portfolio consumer. If that consumer is stopped, prices stop moving; each entry shows `quoteAsOf`, and a quote the market service flagged stale is shown as Delayed.
- An alert created when the price is already past the threshold fires on the next live quote ([`0010`](../../../../../../../../../../../decision-log/0010-a-crossing-is-reaching-the-threshold-on-a-live-quote-and-an-undelivered-alert-is-recovered-by-a-sweep.md)).
- A `DELIVERY_FAILED` alert is not retried; re-arming is the retry.
- Re-arming is not rate-limited. The only recipient is the customer's own resolved address and the Notifications row cap bounds the table.

## Tests

`WatchlistFlowTest` (scoping, caps, prices, names, alert CRUD), `AlertEvaluationFlowTest` (crossed and not crossed, fire once, hand-over outcomes, failure, sweep, guarded fire), `AlertDeliveryThroughNotificationsTest` (a crossed alert becomes a `PRICE_ALERT` ledger row through the real Notifications service; held when no preference; replay writes no second row), `MarketDataAlertListenerTest` (group, ack and nack rules, skipped quotes), `WatchlistControllerWebTest` and `AlertControllerWebTest` (`ACC-403` on every route, validation, error codes), plus `ConsumerGroupUniquenessTest`. The Postgres migration is covered by `tests/test_migrations.py`. The Angular page is covered by `watchlists-page.spec.ts` and `watchlist.service.spec.ts`.
