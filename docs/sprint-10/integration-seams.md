# Team 1 — Sprint 10 integration seams

The four extensions this sprint share one process (see [`decision-log/0001`](../../decision-log/0001-extension-modules-live-as-packages-in-the-trade-rest-api.md)) and three of them form a chain: Preferences owns the customer's channel, Notifications consumes `trade-events` and delivers on that channel, Watchlists consumes `market-data` and hands triggered alerts to Notifications.

This document fixes the two Java interfaces that cross module boundaries, their response shapes, and what each caller does when the module it depends on raises. It is the artifact SEC3-588 asks for. The package names, interface signatures and DTO shapes below are binding: changing one is an ADR entry under `decision-log/`.

Both seams are Java interfaces, not HTTP routes. The reasoning is in [`decision-log/0006`](../../decision-log/0006-watchlists-delivers-via-a-java-interface-not-an-http-route.md); the one-line version is that any route under `/api/v1/` is reachable with any valid customer token, which is the finding the Sprint 10 OWASP review is set up to catch.

## Package layout and ownership

| Module | Package | Publishes to other modules | Consumes from Kafka |
|---|---|---|---|
| Customer Preferences | `com.team1.trading.api.preferences` | `PreferenceResolver` | — |
| Customer Notifications | `com.team1.trading.api.notifications` | `NotificationDelivery` | `trade-events`, group `notification-service` |
| Watchlists and Price Alerts | `com.team1.trading.api.watchlists` | — | `market-data`, group `watchlist-service` |
| Portfolio and P&L | `com.team1.trading.api.portfolio` | — | `market-data`, group `portfolio-service` (already live) |

A module imports from another module's package **only** through the interfaces listed in the third column. Reaching into another module's mappers, repositories or tables is the mistake [`decision-log/0001`](../../decision-log/0001-extension-modules-live-as-packages-in-the-trade-rest-api.md) warns about; a reviewer will grep for it.

## Seam 1 — `PreferenceResolver`

Notifications calls this on every send to decide which channel the message goes out on and which address to use. Published by the Preferences package; the Preferences package is the only place `auth_db.users.email` is read.

### Interface

```java
package com.team1.trading.api.preferences;

import java.util.Optional;

public interface PreferenceResolver {

    /**
     * Resolve the channel and contact address for an account.
     *
     * The result reads auth_db.users at call time; nothing is cached by the resolver.
     * A customer who updates their email in users sees the next notification go to
     * the new address.
     *
     * Returns Optional.empty() when:
     *   - no preference row exists for the account, or
     *   - a preference row exists but channel is NULL (reserved for a future "no channel" state), or
     *   - the stored email address is blank.
     *
     * Throws PreferenceResolutionException when the resolver is reachable but the
     * underlying read fails (DB error, auth_db row missing for a known preference).
     * It does NOT throw for a missing preference; that is Optional.empty().
     */
    Optional<ResolvedChannel> resolve(long accountId);
}
```

### Return shape

```java
package com.team1.trading.api.preferences;

public record ResolvedChannel(ChannelKind kind, String address) {
    public ResolvedChannel {
        if (address == null || address.isBlank()) {
            throw new IllegalArgumentException("address must be non-blank");
        }
    }
}

public enum ChannelKind { EMAIL, PUSH }
```

`address` is personal data. Loggers in `com.team1.trading.api.notifications` redact any field named `address` or `contact` at any depth; the Preferences module never logs the address at all. A Java record prints every component from its default `toString()`, so `ResolvedChannel` overrides `toString()` to mask `address`, so logging a `ResolvedChannel` can never print the contact detail.

### Behaviour the caller depends on

| Situation | Resolver returns | Notifications' action | Decision log |
|---|---|---|---|
| Preference exists, channel resolves | `Optional.of(ResolvedChannel)` | Write notification row with `status = QUEUED`, resolved channel/address recorded, deliver on the queue | — |
| No preference row for the account | `Optional.empty()` | Write notification row with `status = PENDING_CHANNEL`, `channel = NULL`; the retry scanner re-resolves every 60 s | [`decision-log/0004`](../../decision-log/0004-notifications-holds-messages-as-pending-channel-when-no-preference-is-stored.md) |
| Preference row exists but channel is NULL (reserved) | `Optional.empty()` | Same as above — notification is held, not sent on a default | [`decision-log/0004`](../../decision-log/0004-notifications-holds-messages-as-pending-channel-when-no-preference-is-stored.md) |
| Resolver throws `PreferenceResolutionException` | — | Catch at the Kafka consumer boundary; write notification row with `status = PENDING_CHANNEL`, log the exception once with the `event_id` only (no account identifier beyond the one on the row), **do not** fall back to a hardcoded channel, commit the Kafka offset. The 60 s scanner will retry. | [`decision-log/0003`](../../decision-log/0003-preferences-owns-contact-details-other-modules-reference-them.md), [`decision-log/0004`](../../decision-log/0004-notifications-holds-messages-as-pending-channel-when-no-preference-is-stored.md) |

Notifications **never** falls back to `users.email` on its own. A failure path that reaches past Preferences is a second place deciding how to contact a customer, which is the duplication [`decision-log/0003`](../../decision-log/0003-preferences-owns-contact-details-other-modules-reference-them.md) rules out.

### Thread safety and timeouts

Synchronous and in-process. The call runs on the Kafka consumer thread; the floor on its latency is the Postgres round-trip for the `preferences` join to `users`. There is no circuit breaker and no timeout — a slow DB stalls the partition, which is survivable because the offset has not been committed yet. If DB latency becomes a real problem we add a bounded cache in a future ADR; nothing in the current scope depends on sub-millisecond resolution.

## Seam 2 — `NotificationDelivery`

Watchlists calls this when a price alert crosses its threshold. Published by the Notifications package; the Watchlists package has no visibility into the `notifications` table, the `trade-events` consumer group, or the outbound channel.

### Interface

```java
package com.team1.trading.api.notifications;

public interface NotificationDelivery {

    /**
     * Hand a triggered alert to Notifications for delivery.
     *
     * The call writes a row into the notifications table (keyed on alert.deliveryId,
     * which is the idempotency key; a replay returns the same outcome as the first call).
     * It resolves the channel through PreferenceResolver and queues the row for send.
     *
     * Returns the terminal state Watchlists should record on the alert, so that the UI
     * reflects whether the customer will actually receive the message.
     *
     * Does NOT throw for business reasons (missing preference, unknown account).
     * Throws NotificationDeliveryException only for infrastructure failure
     * (DB write failed). Watchlists leaves the alert in FIRED state in that case
     * and records deliveryState = DELIVERY_FAILED on the alert row.
     */
    DeliveryOutcome deliver(AlertNotification alert);
}
```

### Request shape

```java
package com.team1.trading.api.notifications;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

public record AlertNotification(
    UUID deliveryId,         // idempotency key — Watchlists passes alert_id + fired_at hash
    long accountId,          // target account; Notifications resolves channel from this
    String symbol,
    BigDecimal threshold,
    Direction direction,     // ABOVE or BELOW
    BigDecimal observedPrice,
    OffsetDateTime observedAt
) {
    public AlertNotification {
        if (deliveryId == null) throw new IllegalArgumentException("deliveryId");
        if (symbol == null || symbol.isBlank()) throw new IllegalArgumentException("symbol");
        if (threshold == null || observedPrice == null) throw new IllegalArgumentException("price");
        if (direction == null) throw new IllegalArgumentException("direction");
        if (observedAt == null) throw new IllegalArgumentException("observedAt");
    }
}

public enum Direction { ABOVE, BELOW }
```

### Return shape

```java
package com.team1.trading.api.notifications;

public enum DeliveryOutcome {
    /** Row written, channel resolved, message queued for the outbound channel. */
    QUEUED,

    /** Row written, no preference stored. The scanner will send when the customer sets one. */
    PENDING_CHANNEL,

    /** Nothing written — Notifications refused the request as malformed or for an unknown account. */
    REJECTED
}
```

### Behaviour the caller depends on

| Situation | Returns | Watchlists' action on the alert | Visible to customer |
|---|---|---|---|
| Preference exists, row written, channel queued | `QUEUED` | `state = FIRED`, `deliveryState = QUEUED`, `delivered_at = <row.created_at>` | "Alert fired — message sent" |
| No preference, row written as `PENDING_CHANNEL` | `PENDING_CHANNEL` | `state = FIRED`, `deliveryState = PENDING_CHANNEL` | "Alert fired — waiting for a channel preference" (deep link to settings) |
| Account unknown or payload malformed | `REJECTED` | `state = FIRED`, `deliveryState = REJECTED`, write the reason to the alert's audit log | "Alert fired — delivery refused" |
| `NotificationDeliveryException` thrown | — | `state = FIRED`, `deliveryState = DELIVERY_FAILED`, log the exception with `deliveryId` only. **Do not** retry. The alert stays in `FIRED` until the customer re-arms it ([`decision-log/0005`](../../decision-log/0005-a-price-alert-fires-once-then-deactivates.md)). | "Alert fired — delivery failed" |

Watchlists **never** falls back to writing the alert to a log file in place of calling Notifications. The acceptance criterion is explicit: "An alert written only to a log has not met the criterion." If `deliver()` returns `REJECTED` or raises, the alert still records the attempt — nothing silently disappears.

### Idempotency

`deliveryId` is the primary key on the notifications row for alert-sourced messages (trade-event sourced messages key on the Kafka `event_id` — same column, different source). A replay with the same `deliveryId` returns the row's current state as the outcome without writing again. This is what makes Watchlists' recovery safe: `AlertDeliverySweeper` re-hands any `FIRED` alert whose `delivery_state` is still empty after 30 s (a crash between the guarded fire and the hand-over), and the repeat is a no-op here ([`decision-log/0010`](../../decision-log/0010-a-crossing-is-reaching-the-threshold-on-a-live-quote-and-an-undelivered-alert-is-recovered-by-a-sweep.md)). Watchlists derives `deliveryId` deterministically (`UUID.nameUUIDFromBytes(alertId + "|" + firedAt)`) from `alert_id + fired_at` so that a re-firing after a re-arm is a distinct message, and an accidental double-call inside a single consumer poll is a no-op.

### Thread safety and timeouts

Synchronous and in-process. The call runs on the Watchlists Kafka consumer thread (`market-data`). There is no timeout; a slow DB stalls the `market-data` partition for this consumer group, which is survivable because `watchlist-service` and `portfolio-service` are different groups and portfolio keeps consuming independently (see [`decision-log/0002`](../../decision-log/0002-one-consumer-group-per-extension-module.md)).

## Consumer group identifiers

Fixed by `Application/Contracts/event-schemas/kafka-topics.md` and recorded here for the Sprint 10 modules.

| Module | Topic | Group id | Partitions | Max useful instances |
|---|---|---|---|---|
| Portfolio and P&L | `market-data` | `portfolio-service` | 6 | 6 |
| Customer Notifications | `trade-events` | `notification-service` | 3 | 3 |
| Watchlists and Price Alerts | `market-data` | `watchlist-service` | 6 | 6 |

Each group id is listed in the owning module's README. A new consumer with any of these names, in this process or any other, would silently split the partitions and lose messages — the catalogue flags this: "Two different consumers sharing a group identifier will split the partitions between them and each will see only part of the stream, which presents as messages going missing at random." The three group ids above are reserved; a module that needs a second consumer picks a new name.

## What this document rules out

- **No HTTP route for either seam.** No `/api/v1/notifications/internal/deliver`, no `/api/v1/preferences/internal/resolve`. Any route under `/api/v1/` is reachable with any valid customer token, which is the finding the OWASP review will look for first.
- **No cross-module table access.** Watchlists does not read `notifications`; Notifications does not read `preferences` tables directly, only through its own repository that joins to `auth_db.users` behind `PreferenceResolver`. A module reaching into another module's tables because the DataSource is right there is the shortcut [`decision-log/0001`](../../decision-log/0001-extension-modules-live-as-packages-in-the-trade-rest-api.md) is designed to prevent.
- **No alternative channel path.** Preferences is the only module that resolves a contact address. Notifications never falls back to `users.email` on its own.
- **No silent drop.** A Notifications-side infrastructure failure writes `PENDING_CHANNEL`; a Watchlists-side infrastructure failure records `DELIVERY_FAILED` on the alert. Nothing is lost without a trace.
