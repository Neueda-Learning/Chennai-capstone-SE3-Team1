# 0004 Notifications records every event it consumes; when Preferences has no channel, the row is held as `PENDING_CHANNEL` and delivered when a preference exists

| Field | Value |
|---|---|
| Status | proposed |
| Date | 2026-10-06 |
| Decided by | drafted by SE ahead of the Monday scope review with the instructor |

## Context

Preferences will not have a record for every customer when Notifications starts consuming — a customer who registered on Monday and never opened the settings screen has no stored channel on Tuesday. The Preferences brief frames this as a decision the team has to take: "What the platform does when no preference has been set, and what a caller does when nothing has been stored, are both behaviours somebody has to choose deliberately." The Notifications brief raises the stakes: "A notification cannot be routed without knowing where to route it ... Choosing nothing means the message is lost and nobody finds out." The Kafka offset for `trade-events` moves whether a message was deliverable or not, so a choice to drop at consume time is a choice to lose the event permanently.

## Options considered

| Option | For | Against |
|---|---|---|
| Send on a documented default channel (e.g. the sign-up email on `users.email`) when no preference is stored | Customer always hears about trades; no new state in the notifications table | Hidden coupling — Notifications now picks a channel that Preferences is meant to own; two places on the platform decide the default; a customer who deliberately chose "no channel" (if that becomes a Preferences value later) still receives messages |
| Drop the message with a logged warning | Zero state; simplest code to write | Fails the Notifications brief: the whole point of the module is that "nothing on the platform tells anyone the order they placed will never happen"; silent at exactly the moment it is supposed to speak |
| Record the message with `status = PENDING_CHANNEL`, deliver when a preference is set, commit the Kafka offset after the row is written | Nothing is lost; a customer who sets a preference later sees past notifications arrive; demonstrable in a replay (set no preference, place an order, set a preference, see the message appear) | Delivery is deferred by the resolution interval; the notifications table carries rows for customers who may never set a preference; two entry points (Kafka consumer and the retry scanner) have to agree on idempotency |

## Decision

Option 3. Notifications has its own `notifications` table with columns `id (UUID)`, `event_id (UNIQUE)`, `account_id`, `kind`, `channel (nullable)`, `address (nullable)`, `status`, `payload (JSONB)`, `created_at`, `delivered_at`. On every `trade-events` message the consumer writes a row (keyed on `event_id` so a replay is a no-op per [0002](0002-one-consumer-group-per-extension-module.md)), calls `PreferenceResolver.resolve(accountId)`, and sets `status = PENDING_CHANNEL` if nothing was returned or `status = QUEUED` with the resolved channel/address if something was. The offset is committed after the row is written. A scheduled task walks `PENDING_CHANNEL` rows every 60 s, re-resolves, and moves successful ones to `QUEUED`. The acceptance criterion is delivery on the channel Preferences holds — not on a default — and this is the only option that both records the event and respects that criterion.

## Consequences

The `notifications` table carries a nullable `channel` column and a `status` enum of (`PENDING_CHANNEL`, `QUEUED`, `SENT`, `FAILED`). The Kafka offset is committed after row insertion rather than after delivery — the Notifications brief calls this out directly: "Commit the offset once the notification is durably recorded for delivery, not once an external provider has confirmed." A customer who never sets a preference will accumulate `PENDING_CHANNEL` rows; the row count is capped per account (10 000) to protect the table, and the cap is recorded in the Notifications README. The in-process scheduled task is a second entry point into Notifications and must share the same idempotency key (`event_id`) as the Kafka consumer, which the `UNIQUE` constraint enforces. The inbox view shows all history regardless of channel state, so a customer who opens the app before setting a preference sees their missed messages — delivered or not — in the UI.
