# 0003 Preferences holds the customer's channel choice and resolves the contact detail from `auth_db.users` at send time; other modules never store a copy

| Field | Value |
|---|---|
| Status | proposed |
| Date | 2026-10-06 |
| Decided by | drafted by SE ahead of the Monday scope review with the instructor |

## Context

Customer Notifications has to send a message to a customer, which means it has to know an email address or a telephone number. The platform already stores both: migration `021_users_owns_email_and_phone.sql` moved `email` and `phone` onto `auth_db.users` and dropped the duplicate columns from `clients`, with the explicit note that "`auth_db.users` becomes the single stored copy of both contact fields." The Preferences brief flags storing them a second time: "An email address and a telephone number are personal data that may already exist elsewhere on the platform. Storing a second copy doubles the number of places a leak can happen and creates a reconciliation problem the day one of them changes." This decision records which module answers "where does the address come from" on every send.

## Options considered

| Option | For | Against |
|---|---|---|
| Preferences stores the channel choice (`EMAIL`, `SMS`, `PUSH`) plus a full copy of the contact address | Self-contained; one query resolves the delivery target; no cross-schema join | A second copy of personal data; migration `021` is undone in effect; when a customer updates their email in `users` the notification path keeps the old address until something reconciles |
| Preferences stores the channel choice; the contact address is read from `auth_db.users` at send time, inside a Preferences-owned resolver | One source of truth for the contact detail; a corrected email takes effect on the next notification with no cache invalidation; the module that leaks is Preferences, which does not store the sensitive value | Two reads per send; a cross-schema dependency on `auth_db` that migration `018` already makes work through the extended `search_path` |
| Preferences stores only the channel choice; callers (Notifications) join to `users` themselves | Preferences stays contact-free; narrower leak surface | The join is now in every caller; auditing where contact details are read becomes "every module that calls Notifications", not "one query inside Preferences" |

## Decision

Option 2. The `customer_preferences` table holds `account_id`, `default_account_id`, `channel` (`EMAIL` / `SMS` / `PUSH`) and `channel_contact_override` (nullable). A `PreferenceResolver` interface published by the Preferences package returns a `ResolvedChannel { kind, address }` built per call: the kind comes from `preferences.channel`, and the address comes from `channel_contact_override` if set and otherwise from `auth_db.users.email` or `auth_db.users.phone`. Callers never see either column directly. Reasoning: option 1 creates the leak the OWASP A02 row will flag; option 3 pushes the sensitive read into every module that sends a message, which is the opposite of what the review wants.

## Consequences

`PreferenceResolver.resolve(accountId)` is the one place on the platform where a contact detail enters a module that is about to put it on a wire; the review entry for A02 says so and the logger redacts `address` by key name. A customer who updates their email in `users` sees the next notification go to the new address with no cache invalidation, because the resolver reads fresh per call. The `channel_contact_override` column exists so a customer can route notifications to a different address than the one they signed up with — out of scope for Sprint 10 unless the rest is finished, but the column is there so a later migration does not need to add it. Preferences depends on the `auth_db` schema being present via the `search_path` set in migration `018`; if auth ever moves to a separate database this join breaks and the decision is revisited. The resolver is a Java interface rather than an HTTP route, per [0006](0006-watchlists-delivers-via-a-java-interface-not-an-http-route.md), for the same reason.
