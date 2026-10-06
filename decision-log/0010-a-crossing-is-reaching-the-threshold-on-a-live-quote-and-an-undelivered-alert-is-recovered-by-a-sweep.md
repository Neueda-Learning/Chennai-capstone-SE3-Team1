# 0010 A threshold is crossed when a live quote reaches it, the fire is a guarded one-row update, and an alert whose hand-over was interrupted is recovered by a sweep

| Field | Value |
|---|---|
| Status | proposed |
| Date | 2026-10-06 |
| Decided by | drafted while building Watchlists and Price Alerts (SEC3-591); to be confirmed with the instructor at the scope review |

## Context

[`0005`](0005-a-price-alert-fires-once-then-deactivates.md) decided that an alert fires once. It did not say what "crossed" means to the line of code that compares a quote with a threshold, what happens when the process stops between firing an alert and handing it to Notifications, or how the per-account cap is kept honest when two requests arrive together. SEC3-591 asks the team to define "crossed" and record why, and to decide what happens when the hand-over raises.

## Options considered

### What "crossed" means

| Option | For | Against |
|---|---|---|
| Strictly past: `price > threshold` (ABOVE), `price < threshold` (BELOW) | Matches "crossed" in everyday speech | A customer who sets 3500 and sees the price print exactly 3500 is told nothing; prices are quoted to 4 places so an exact hit is real |
| **Reached or passed: `price >= threshold` (ABOVE), `price <= threshold` (BELOW)** | An exact hit fires; the rule is one comparison with no second parameter; it is what the alert form says ("rises to or above") | An alert created while the price is already past the level fires on the next quote |
| Edge-triggered: fire only when the previous quote was on the other side | Never fires for a level already passed | Needs the previous price per symbol (state that does not survive a restart), and the first quote after a restart cannot be classified |

### When the hand-over is interrupted

| Option | For | Against |
|---|---|---|
| Fire and hand over in the consumer only | Simplest | A crash between the two leaves an alert `FIRED` that nobody was told about, and the guard `WHERE state = 'ARMED'` means no later quote will ever retry it |
| Hand over first, mark `FIRED` after | A crash re-sends | A crash after the hand-over and before the update sends twice unless the key is stable, and a failed update leaves an alert that can fire again |
| **Mark `FIRED` in the guarded update, hand over, record the outcome; a periodic sweep re-hands any `FIRED` alert whose `delivery_state` is still empty** | The fire is exactly once; the hand-over is at-least-once and idempotent because Notifications keys on `deliveryId` | A second small component (the sweeper) and a 30-second minimum age before it acts |

## Decision

1. **Crossed.** An `ARMED` alert fires when a live quote's price is greater than or equal to the threshold (`ABOVE`) or less than or equal to it (`BELOW`). The price is rounded to four decimal places, half up, before comparing, the same scale the threshold is stored at. An alert created when the price is already past the level fires on the next live quote; this is stated beside the form on the Angular page rather than hidden.
2. **Which quotes count.** Only `eventType = QUOTE` events with a positive price of at most 14 integer digits and `stale = false`. A stale quote is a replay of an earlier price and must not turn into a message. Everything else is acknowledged and skipped so one bad record cannot block the partition.
3. **Fire once.** `PriceAlertMapper.fire` is `UPDATE ... SET state = 'FIRED', delivery_state = NULL, fired_at, fired_price WHERE alert_id = ? AND state = 'ARMED'`. Zero rows means another quote or instance got there first and nothing is sent. Per-quote lookup is `findCrossedArmed(symbol, price)`, served by the partial index `idx_price_alerts_symbol_armed (instrument_id) WHERE state = 'ARMED'`, so the hot path reads only armed alerts for one symbol.
4. **Hand-over.** `AlertEvaluator.handOver` calls `NotificationDelivery.deliver` with `deliveryId = UUID.nameUUIDFromBytes(alertId + "|" + firedAt)`. The returned `DeliveryOutcome` is stored as `delivery_state` (`QUEUED`, `PENDING_CHANNEL`, `REJECTED`). If the call raises, `delivery_state` is `DELIVERY_FAILED`. Nothing is written to a log in place of the call. `setDeliveryState` only updates a `FIRED` row whose state is still empty, so a late result cannot overwrite a re-arm.
5. **Recovery.** `AlertDeliverySweeper` runs every 60 s (`watchlists.sweep.interval-ms`) and re-hands each `FIRED` alert whose `delivery_state` is empty and which fired more than 30 s ago, 100 at a time. The 30 s age keeps it off an alert the consumer is still handing over. Because `deliveryId` is derived from the alert and the firing, a repeat is a no-op in Notifications. A `DELIVERY_FAILED` alert is not retried, as [`0005`](0005-a-price-alert-fires-once-then-deactivates.md) says; the customer re-arms it.
6. **Database failure on a quote.** The consumer does not acknowledge and asks for redelivery in 5 s (`nack`), the same pattern as Notifications. Any other exception on a quote is logged and the quote skipped.
7. **Caps.** 10 watchlists and 25 alerts per account and 50 instruments per watchlist, each refused with `429 WLT-429`. The check and the insert run in one transaction that first locks the account's `clients` row (`SELECT ... FOR UPDATE`), so two concurrent creates cannot both pass the count. Watchlist names are unique per account ignoring case (`409 WLT-409`).
8. **Reads only from other modules' data.** Watchlists reads `market_quotes` (written by the Portfolio consumer) for the live price shown beside an entry, and `instruments` to validate a symbol. It writes neither. It consumes `market-data` in its own group, `watchlist-service`, and never `trade-events` or `orders` ([`0002`](0002-one-consumer-group-per-extension-module.md)).

## Consequences

A customer sees the alert's `state` (`ARMED`, `FIRED`, `DISABLED`) and, for a fired one, its `deliveryState` and the price it fired at. Re-arming clears the fired fields and the delivery state. A crash between the guarded update and the hand-over is repaired within about a minute without a duplicate message. A symbol that oscillates around the level sends one message until the customer re-arms. Watchlists shows the latest stored quote, so its price is as fresh as the Portfolio consumer's writes; if that consumer is down, entries show their last price with a "Delayed" badge only when the quote itself was marked stale. The sweeper and the consumer run in one process: a second Trade API instance would run a second sweeper, which is harmless because the hand-over is idempotent and the state change is guarded. The edge-triggered option stays available if the team later wants "only when it crosses" and is willing to store the previous price.
