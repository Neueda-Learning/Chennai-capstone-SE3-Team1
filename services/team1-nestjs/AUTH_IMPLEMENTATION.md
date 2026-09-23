# Auth service implementation (Sprint 8)

## Overview

The Sprint 8 auth service implementation: registration, login, token refresh and
current-user lookup, on the paths, verbs, status codes and bodies fixed by
`contracts/auth-api.yaml`. This supersedes the email-keyed `credential.service`
(Sprint 3 heritage), which is removed.

## Contract compliance

| Method | Path | Protected | Success | Failures |
|---|---|---|---|---|
| `POST` | `/auth/register` | no | 201 `UserResponse` | `AUTH-409`, `VAL-422` |
| `POST` | `/auth/login` | no | 200 `TokenResponse` | `AUTH-401`, `VAL-422` |
| `POST` | `/auth/refresh` | no | 200 `TokenResponse` | `AUTH-401`, `VAL-422` |
| `GET` | `/auth/me` | bearer | 200 `UserResponse` | `AUTH-401` |

Every failure returns the platform envelope,

```json
{ "errorCode": "AUTH-401", "message": "Unauthorised" }
```

The only messages on a failure path are `Unauthorised`, `Registration failed`
and `Invalid input`. `additionalProperties: false` is enforced on every body
via a global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`,
`enableImplicitConversion`).

## JWT claim set

Access tokens are signed HS256 with `JWT_SECRET` and carry **exactly**:

`sub` (UUID), `accountId` (int), `roles` (`CUSTOMER`/`ADMIN`, never empty),
`iat`, `exp` (15 minutes after `iat`), `iss` (`auth-service` by default).

The signing payload is built explicitly (`token.service.ts`) — no `expiresIn`
option is passed, so `jsonwebtoken` cannot add extra claims. Verification is
pinned: `algorithms: ['HS256']` and the configured issuer, so a token header
never selects the algorithm.

Refresh tokens are 32 random bytes (`crypto.randomBytes`), base64url-encoded,
opaque, and stored as a SHA-256 hex digest (`CHAR(64)`) — never as themselves.

## Database

`migrations/012_auth_service_tables.sql` adds two tables:

- `users` — UUID `id`, `username` (unique, `^[a-zA-Z0-9._-]+$`, 3–64 chars),
  `account_id` `BIGINT` FK → `clients(client_id)`, `roles TEXT[]`, `password_hash`,
  `params_version`, `version`, `created_on`, `updated`. Registration never
  creates a `clients` row: unknown `accountId` fails validation.
- `refresh_tokens` — UUID `id`, `user_id` FK → `users`, `token_hash CHAR(64)`
  (unique), `expires_at`, `revoked_at`, `created_at`.

The legacy `auth` table (`003_auth.sql`) is left untouched for the Sprint 3 seed.

## Password storage

Passwords use **argon2id** (`@node-rs/argon2`) with `m=65536` (64 MB), `t=3`,
`p=4` — about 100 ms per verification (`password.constants.ts`). Cost upgrades
are handled by `params_version` + `needsRehash()` on login, which transparently
rehashes. Passwords are never written to a log; the logger redacts by key name
at any depth.

## Refresh rotation and replay handling

Every `POST /auth/refresh`:

1. Looks up the presented token by its hash.
2. If it was already revoked — theft. `revokeAllForUser` revokes the whole
   chain and the route answers `AUTH-401`.
3. If expired, revokes the presented token and answers `AUTH-401`.
4. Otherwise revokes the presented token, issues a new pair, stores the new
   refresh hash, returns the pair.

An access token is not revocable, which is why it lives for 15 minutes.

## One answer for every failure

An unknown username and a wrong password return the same status, the same body
and comparable timing. Where the username is not found, the supplied password is
verified against a fixed argon2id dummy hash before failing, so the two paths do
the same ~100 ms of hashing work. Login is throttled, but a throttled attempt
still returns the uniform `AUTH-401`, not a distinct `429`.

## Guard

`JwtAuthGuard` protects `/auth/me`. It requires a `Bearer` scheme, delegates to
`TokenService.verifyAccessToken` (signature, expiry, issuer, claim types) and
attaches the verified claims to `req.user`. Missing, malformed, expired and
wrongly-signed tokens all produce `AUTH-401`.

## OpenAPI

The running service serves its own generated document: UI at `/docs` and JSON
at `/docs/json`. It is generated from the controller and DTO decorators, and
describes all four routes.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | |
| `JWT_SECRET` | *required* | Min 32 chars, Joi-validated |
| `JWT_ISSUER` | `auth-service` | |
| `DB_HOST` / `DB_PORT` / `DB_USERNAME` / `DB_PASSWORD` / `DB_NAME` | localhost / 5432 / postgres / postgres / trading_platform | |
| `KAFKA_BROKER` | localhost:9092 | |

Values come from the environment at runtime; the only committed copy is the
development value in `.env.example`.

## Tests

- Unit: 15 suites / 96 tests (`src/**/*.spec.ts`, co-located). Covers the exact
  claim set, expired + wrong-signature guard paths, identical 401 bodies for
  unknown user vs wrong password, registration never minting tokens, refresh
  rotation + replay theft, DTO `additionalProperties: false`.
- Integration: 18 tests (`test/auth.e2e-spec.ts`, via `npm run test:e2e`)
  against the running Nest app with in-memory repository fakes, including
  OpenAPI at `/docs` and `/docs/json`.

```bash
npm ci
npm run build
npm test
npm run test:e2e
npm run lint
```

See `security-review/auth-service-security-review.md` for the OWASP review.