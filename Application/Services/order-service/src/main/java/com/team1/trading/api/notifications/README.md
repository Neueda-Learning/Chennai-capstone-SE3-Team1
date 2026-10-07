# Notifications

Records one message per trade-event outcome or price alert, sends it through the customer's chosen channel, and keeps the history the customer can read. Owns the `notifications` table and publishes the delivery seam other modules call.

| | |
|---|---|
| Route | `GET /api/v1/accounts/{accountId}/notification-history` ([`notifications-api.yaml`](../../../../../../../../../../Contracts/api-schemas/notifications-api.yaml)); `limit` 1–100 (default 30) and `before` cursor |
| Table | `notifications` (migration `027`); `UNIQUE(event_id)`; the resolved destination is kept in `address` for audit and never returned |
| Consumes | `trade-events` in consumer group `notification-service` (`ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`) |
| Published seam | `NotificationDelivery.deliver(AlertNotification) -> DeliveryOutcome` ([`integration-seams.md`](../../../../../../../../../../../docs/sprint-10/integration-seams.md)) |
| Uses | `PreferenceResolver` (Preferences) |
| Decisions | [`0004`](../../../../../../../../../../../decision-log/0004-notifications-holds-messages-as-pending-channel-when-no-preference-is-stored.md), [`0006`](../../../../../../../../../../../decision-log/0006-watchlists-delivers-via-a-java-interface-not-an-http-route.md), [`0008`](../../../../../../../../../../../decision-log/0008-the-notification-ledger-has-its-own-history-route-and-honest-delivery-states.md), [`0009`](../../../../../../../../../../../decision-log/0009-sms-is-not-a-channel-and-email-uses-the-auth-services-smtp-account.md), [`0011`](../../../../../../../../../../../decision-log/0011-email-is-not-a-channel-and-nothing-sends-mail.md) |

## How a message moves

1. `TradeEventListener` (or `NotificationDeliveryService` for an alert) calls `NotificationRecorder.record`. It resolves the channel through `PreferenceResolver` and writes one row: `QUEUED` with the channel, or `PENDING_CHANNEL` when the resolver answers empty or throws.
2. The offset is acknowledged only after the row is written. A repeated `event_id` hits `UNIQUE(event_id)` and is a no-op. A database failure is not acknowledged (`nack` for 5 s) so the event comes back.
3. `NotificationDispatcher.dispatchQueued` (every 5 s) resolves the address again, sends, and marks the row `SENT` or `FAILED` with a reason code.
4. `NotificationDispatcher.rescanPending` (every 60 s) re-resolves `PENDING_CHANNEL` rows and moves them to `QUEUED` once a channel exists.

## Rules this package keeps

- **Own account only.** `NotificationHistoryController` calls `AccessGuard.requireOwner` first; a different account in the path is `ACC-403`, with no admin bypass.
- **Address never returned or logged.** The destination is stored on the row for audit but the history response has no address field; `LedgerRow.toString()` and `ResolvedChannel.toString()` mask it, and logs carry the event id and account id only.
- **No route for delivery.** `NotificationDelivery` is a Java interface; `NoResolverRouteTest` fails the build if a controller path contains `resolve`, `deliver` or `/internal`.
- **Fixed destinations.** The recipient comes from the resolver, never from an event, alert or request field. Addresses containing whitespace, commas, semicolons, quotes or angle brackets are refused (`INVALID_ADDRESS`).
- **Message bodies carry order or alert facts only.** The payload is whitelisted, control characters are stripped and each value is capped at 200 characters.
- **Cap.** At most 10 000 rows per account; the oldest are pruned in the same transaction as the insert.
- **Group id is explicit.** Every `@KafkaListener` sets `groupId`; `ConsumerGroupUniquenessTest` fails if a reserved id is shared.

## Channels

| Channel | Behaviour | Row ends as |
|---|---|---|
| `PUSH` | The in-app inbox; recording the row is the delivery | `SENT` |
| Any error | | `FAILED` / `CHANNEL_ERROR` (the rest of the batch continues) |

`FAILED` rows are not retried. There is no email or SMS channel ([`0009`](../../../../../../../../../../../decision-log/0009-sms-is-not-a-channel-and-email-uses-the-auth-services-smtp-account.md), [`0011`](../../../../../../../../../../../decision-log/0011-email-is-not-a-channel-and-nothing-sends-mail.md)).

## Properties

| Property | Default | Meaning |
|---|---|---|
| `notifications.scheduler.enabled` | `true` (`false` in tests) | Turns the dispatcher and scanner on |
| `notifications.dispatch.interval-ms` | `5000` | Delay between dispatch runs |
| `notifications.rescan.interval-ms` | `60000` | Delay between `PENDING_CHANNEL` scans |

## Known limitation

State changes are guarded (`WHERE status = 'QUEUED'`) but a row is not claimed before sending, so two order-service instances running the dispatcher at once could send the same row twice. The deployment is a single instance; add a `SENDING` claim state or `FOR UPDATE SKIP LOCKED` before scaling out ([`0008`](../../../../../../../../../../../decision-log/0008-the-notification-ledger-has-its-own-history-route-and-honest-delivery-states.md)).

## Tests

`NotificationLedgerFlowTest` (real resolver, H2 ledger: record, replay, hold, promote, cap, paging), `TradeEventListenerTest`, `NotificationDeliveryServiceTest`, `NotificationHistoryControllerWebTest`, `MessageComposerTest`, `NotificationRecorderRaceTest`, `ConsumerGroupUniquenessTest`, plus `NoResolverRouteTest`. The Postgres migration is covered by `tests/test_migrations.py`. The Angular card is covered by `notification-history-card.spec.ts` and `notification-history.service.spec.ts`.
