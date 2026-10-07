# 0011 Email is not a channel, and nothing on main sends mail

| Field | Value |
|---|---|
| Status | accepted |
| Date | 2026-10-07 |
| Decided by | requested by the team; the email and chatbot code is kept on the `side` branch |

## Context

[`0009`](0009-sms-is-not-a-channel-and-email-uses-the-auth-services-smtp-account.md) left two channels, `EMAIL` and `PUSH`, with email sent through the SMTP account the auth service already used for registration and password-reset codes. The team decided `main` should not send email at all. The SMTP code, the assistant chatbot and everything that depends on them now live only on the `side` branch.

## Options considered

| Option | For | Against |
|---|---|---|
| Keep `EMAIL` as a choice but never send it | No migration | A dead option on the settings screen whose every message ends `FAILED`, the situation 0009 removed for SMS |
| **Remove `EMAIL` from the channel set, as 0009 did for SMS** | The settings screen only offers what works; one channel, one resolver rule | Stored `EMAIL` preferences must be moved (migration `031`); old history rows lose their channel |

## Decision

1. `ChannelKind` is `PUSH` only. `PUT .../preferences` with `EMAIL` is refused like any unknown value.
2. Migration `031_drop_email_channel.sql` moves stored `EMAIL` preferences to `PUSH`, returns `QUEUED` email notifications to `PENDING_CHANNEL` (the 60 s scanner re-resolves them to the inbox), clears the channel and address on the other email rows, and tightens both `CHECK` constraints to `PUSH`.
3. The Trade API no longer depends on `spring-boot-starter-mail`; `SmtpSettings` and `NotificationMailConfig` are gone.
4. The auth service no longer depends on `nodemailer`. Registration and password-reset codes are written to its log as `[otp.outbox] <purpose> email=<address> code=<code>`, the fallback it already used when SMTP was not configured.

## Consequences

Point 3 of 0009 is superseded. The vault keys `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` are no longer read on `main`. Anyone verifying an account or resetting a password locally reads the code from the auth service log. A database migrated to `031` refuses `EMAIL` rows, so running the `side` branch against it needs a fresh database (`.\run-local.ps1 -ResetDb` on `side`). Bringing email back means merging from `side` and a migration that widens the constraints again.
