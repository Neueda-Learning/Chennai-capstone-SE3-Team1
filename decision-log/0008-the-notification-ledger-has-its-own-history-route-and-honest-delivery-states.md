# 0008 The notification ledger has its own history route, and a message is only marked sent when something was actually sent

| Field | Value |
|---|---|
| Status | proposed |
| Date | 2026-10-06 |
| Decided by | drafted by SE while building Notifications (SEC3-590); to be confirmed with the instructor at the scope review |

## Context

Building Notifications ([`0004`](0004-notifications-holds-messages-as-pending-channel-when-no-preference-is-stored.md)) raised three questions the scope document answers in a way that does not survive contact with the code.

**Which route serves the ledger?** [`scope-and-backlog.md`](../docs/sprint-10/scope-and-backlog.md) proposed that the new module "takes over" `GET /api/v1/accounts/{accountId}/notifications` and deletes the old query. That route is not a history of messages. It is an activity feed derived from `orders`, `order_history` and `wallet_transfers`, and the Angular bell and its pop-ups are driven by it. Replacing it with the ledger would empty the bell for every order placed before the ledger existed and would change the response shape the bell parses.

**What do `SENT` and `FAILED` mean when a channel has no provider?** The brief asks for one real channel. Email is built on `JavaMailSender`, but an environment whose vault has no SMTP entries cannot send. Recording `SENT` for a message nobody received would make the history screen lie to the customer and would hide the fault from operators.

**What happens when the trade-event consumer cannot write the row?** An acknowledged offset that has no row behind it loses the message for good.

## Options considered

| Option | For | Against |
|---|---|---|
| Ledger replaces `/notifications` | One route, as the scope document says | Breaks the bell; the old feed has no `eventId`, no channel, no status, so it cannot be mapped onto the ledger shape |
| Ledger is merged into the old feed (union of both sources) | One route | Two shapes in one list; the paging cursor would have to span a derived feed and a table; the old query is not indexable by `created_at` the same way |
| **Ledger at its own route, `/notification-history`; old feed untouched** | Nothing existing changes; the settings screen reads the ledger, the bell keeps reading the feed; each route has one shape and one cursor | Two notification-like routes until the feed is retired in a later sprint |
| Unconfigured channel is recorded `SENT` (log-only sender) | Demo looks complete | The history is false; a missing mail host would never be noticed |
| **Unconfigured channel is recorded `FAILED` with a reason code** | History is true; operators see `EMAIL_NOT_CONFIGURED`; adding the SMTP entries to the vault is the only change needed to go live | A fresh checkout shows failures in the history until mail is configured |
| Retry `FAILED` rows automatically | Self-healing | A permanently bad address or an unconfigured channel would be retried forever; the brief puts sophisticated retry out of scope |
| Acknowledge the offset before the insert | Never blocks the consumer | A crash between the two loses the message |
| **Acknowledge only after the row is durably written; `nack` on database failure** | No loss; the replay hits `UNIQUE(event_id)` and is a no-op | A prolonged database outage pauses this consumer group (nothing else) |

## Decision

1. The ledger is served at `GET /api/v1/accounts/{accountId}/notification-history` with `limit` (default 30, clamped 1–100) and a `before` cursor on `created_at`. The existing `GET .../notifications` feed is unchanged. The scope document's route row is corrected.
2. States are honest. `QUEUED` until a dispatcher sends it; then `SENT` only if the channel reported success, otherwise `FAILED` with one reason code (`EMAIL_NOT_CONFIGURED`, `INVALID_ADDRESS`, `EMAIL_REFUSED`, `CHANNEL_ERROR`). `PUSH` is the in-app inbox, so recording the row is the delivery and it is `SENT`. `FAILED` rows are not retried automatically.
3. Delivery is two steps: the consumer (or `NotificationDelivery.deliver`) records the row; a `@Scheduled` dispatcher (5 s, `notifications.dispatch.interval-ms`) sends `QUEUED` rows; a second task (60 s, `notifications.rescan.interval-ms`) re-resolves `PENDING_CHANNEL` rows and promotes them to `QUEUED`. State changes are guarded updates (`WHERE status = 'QUEUED'`), so a replay cannot move a finished row.
4. The offset is acknowledged only after the row exists. Malformed events, events of other types and events for an unknown account are acknowledged and skipped. A database failure `nack`s with a five-second delay so the event is redelivered.
5. The row stores a whitelisted JSON payload of order or alert facts (kind, symbol, quantity, price, direction, threshold, reason; control characters removed, 200-character cap) and no credentials. The resolved destination is kept in the row's `address` column for audit and is never returned by a route; `LedgerRow` and `ResolvedChannel` mask it in `toString()`, and the logs carry the event id and account id only.
6. A per-account cap of 10 000 rows is kept by pruning the oldest rows after an insert pushes the count past it; the insert and the prune share one transaction.
7. There is still no HTTP route that delivers or resolves ([`0006`](0006-watchlists-delivers-via-a-java-interface-not-an-http-route.md)); `NoResolverRouteTest` covers the new controller automatically.

## Consequences

The Angular settings page gains a history card reading `/notification-history`; the bell is untouched. Email uses the same SMTP account as the auth service ([`0009`](0009-sms-is-not-a-channel-and-email-uses-the-auth-services-smtp-account.md)); until `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` are in the vault, email notifications are recorded `FAILED` / `EMAIL_NOT_CONFIGURED`; this is intended, and the live email demonstration needs nothing else. The dispatcher has no claim state, so two order-service instances running at once could send the same `QUEUED` row twice; the deployment today is a single instance, and a `SENDING` claim state (or `SELECT ... FOR UPDATE SKIP LOCKED`) is the change to make before scaling out. The two notification routes (`/notifications` feed, `/notification-history` ledger) coexist until the feed is retired; that retirement needs its own story because the bell would have to move to the ledger. The security review rows P1–P4, P7 and P8 are closed for this module by the tests named there.
