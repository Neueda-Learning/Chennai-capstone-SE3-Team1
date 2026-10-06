# 0009 SMS is not a channel, and Notifications sends email through the SMTP account the auth service already uses

| Field | Value |
|---|---|
| Status | proposed |
| Date | 2026-10-06 |
| Decided by | requested by the team while reviewing Notifications (SEC3-590); to be confirmed with the instructor at the scope review |

## Context

[`0003`](0003-preferences-owns-contact-details-other-modules-reference-them.md) and [`0007`](0007-default-account-is-the-customers-own-and-a-missing-address-resolves-to-empty.md) allowed three channels, `EMAIL`, `SMS` and `PUSH`. Building Notifications showed that SMS had no provider and no budget this sprint: the only honest outcome was to record every SMS notification as `FAILED` (`SMS_NOT_CONFIGURED`), which left a choice on the settings screen that could never work. It also forced the rules in 0007 about a customer who picks SMS without a phone number.

For email, the first design added a second SMTP configuration (`spring.mail.*`) to the Trade API. The platform already has one: the auth service sends registration and password-reset codes through an SMTP account whose `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` live in the TrustMe vault.

## Options considered

| Option | For | Against |
|---|---|---|
| Keep SMS, show it as "coming soon" | Matches the brief's wording | A dead option on the screen; the phone rule and the `SMS_NOT_CONFIGURED` state stay |
| **Remove SMS from the channel set** | The choice only offers what works; deletes the phone rule from Preferences and the resolver | A customer who had chosen SMS has to be moved (migration `028`); a later SMS provider needs a new ADR and migration |
| Separate SMTP settings for Notifications (`spring.mail.*`, environment variables) | Independent of the auth service | A second place for a mail password; contradicts the repository rule that secrets come from the vault only |
| **Read the same four vault keys the auth service reads** | One mail account, one place to rotate it; no secret in a properties file or environment | The two services now share a failure mode (an expired mail password stops both OTPs and notifications) |

## Decision

1. `ChannelKind` is `EMAIL` and `PUSH`. `PUT .../preferences` with `SMS` is `VAL-422`. The profile phone number is no longer read by Preferences or Notifications; the `users.phone` column is untouched.
2. Migration `028_drop_sms_channel.sql` moves stored `SMS` preferences to `EMAIL`, returns `QUEUED` SMS notifications to `PENDING_CHANNEL` (the 60 s scanner re-resolves them), clears the channel and address on the other SMS rows, and tightens both `CHECK` constraints to `EMAIL`/`PUSH`.
3. `SmtpSettings` reads `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` from the vault through the `trustme.secret.*` property source, and sends with the same fixed rules as the auth service: port 587, STARTTLS required, authenticated, 10 s timeouts. If any of the four is missing or the vault refuses the lookup, email is not configured and each email notification is recorded `FAILED` with `EMAIL_NOT_CONFIGURED`. The password and user are masked in `toString()`. `spring.mail.*` and `notifications.email.from` are no longer used.

## Consequences

`0003` and `0007` stand except where they mention SMS: the rule that SMS with no phone resolves to empty and is refused at write no longer exists, and the resolver's third `Optional.empty()` case becomes "stored email is blank" (which `users.email NOT NULL` makes rare). The Angular settings screen offers Email and In-app only. A customer's own mail address is the only destination the module ever resolves. If SMS is added later it needs its own provider ADR, a migration that widens the constraints, and a vault key for the provider; nothing here prevents that.
