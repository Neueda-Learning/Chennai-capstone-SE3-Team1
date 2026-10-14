# 0017. Email verification, email notifications and the assistant are back

**Status:** Accepted, supersedes 0011 and 0012

## Context

0011 removed the assistant chatbot and every email path from main, and 0012 made registration create
accounts ACTIVE without email verification. Both features stayed on the `side` branch. With the stack
deployed on EC2, the TrustMe vault holds `LLM_API_KEY` and the four `SMTP_*` secrets, so both features
can run in the deployed environment.

## Decision

Bring back from `side`: the assistant (order-service `chat` package, `chat-api.yaml`, the Angular chat
widget, `CHT-*` errors), the EMAIL notification channel, and OTP email verification with
forgot-password / reset-password in the auth service. Work added to main since (the env/.env fallback
for vault secrets, conditional orders, the daily ETL, services.env, the Docker setup) is kept.

Migrations stay append-only: 031 and 032 remain applied; 037 allows the EMAIL channel again.

## Consequences

- New registrations are PENDING until the emailed code is entered; existing accounts stay ACTIVE.
- Mail needs all four `SMTP_*` secrets; without them OTP codes are written to the auth-service log and
  EMAIL notifications are recorded as FAILED.
- The assistant needs `LLM_API_KEY`; without it the chat endpoint answers 503 (`CHT-503`).
