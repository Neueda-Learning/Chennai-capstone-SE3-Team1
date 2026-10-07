# 0012 Registration needs no email verification, and there is no password reset

| Field | Value |
|---|---|
| Status | accepted |
| Date | 2026-10-07 |
| Decided by | requested by the team; the email-based flows are kept on the `side` branch |

## Context

[`0011`](0011-email-is-not-a-channel-and-nothing-sends-mail.md) removed every way `main` sends mail. Registration still created users `PENDING` and refused sign-in until a six-digit code was entered, and password reset still depended on a code; both codes only reached the auth service log. A customer has no way to read that log, so on `main` neither flow could be completed by the person it was for.

## Options considered

| Option | For | Against |
|---|---|---|
| Keep the codes in the log and reword the screens | No behaviour change; the routes stay | Only whoever runs the services can finish a registration or a reset |
| Show the code in the app after registration | Works for anyone, needs no mail | The check proves nothing; it is verification in name only |
| **Create accounts `ACTIVE` and remove the code routes** | Registration works end to end; no flow that cannot be finished | Anyone can register any address; a forgotten password cannot be recovered on `main` |

## Decision

1. `POST /auth/register` creates the user `ACTIVE`; sign-in works straight away.
2. `POST /auth/verify-otp`, `/auth/resend-otp`, `/auth/forgot-password` and `/auth/reset-password` are removed, with `OtpService`, `OtpRepository`, `OtpOutboxService`, their DTOs and the `AUTH-410` error. The Angular verify, forgot-password and reset-password screens are removed; after registering, the UI goes to sign-in with the "Account created" banner.
3. Migration `032_activate_pending_users.sql` activates every user still `PENDING`. `users.status` and `auth_db.otp_codes` stay in the schema, unused, so earlier migrations and the entity parity checks are untouched.

## Consequences

An email address is no longer proven to belong to the person who registered it. Nothing on `main` sends to that address, so the risk is limited to someone claiming an address that is not theirs. A user who forgets their password needs an operator to reset it (for example `scripts/create_test_account.py` for test accounts). Bringing either flow back means merging from `side`, where both still exist with real email.
