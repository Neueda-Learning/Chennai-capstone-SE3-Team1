# Security review: auth service

## Header

| Field | Value |
|---|---|
| Service | auth service, Sprint 8 |
| Reviewed by | Team 1 (auth service author; JIRA-2, JIRA-4) |
| Date of review | 2026-09-22 (refreshed 2026-09-24, see revision log) |
| Commit reviewed | First pass against branch `security` at HEAD `f72da85` (working tree, 2026-09-22). Refreshed 2026-09-24 to the committed implementation in `ac13d76` |
| Version of the OWASP Top Ten used | 2021 |

## Revision log

| Date | What changed |
|---|---|
| 2026-09-22 | Initial pass written against a working tree (auth module not yet committed) |
| 2026-09-24 | Refresh: review now references the committed implementation (`ac13d76`) rather than a working tree; findings and dispositions unchanged |

## Categories

| Category | In scope | Finding | Disposition |
|---|---|---|---|
| A01 Broken access control | Yes | `/auth/me` reads identity exclusively from the token claims placed on `req.user` by `JwtAuthGuard` after `TokenService.verifyAccessToken` — never from a query parameter or header the client controls. The public registration route ignores any self-declared `roles` and always stores `['CUSTOMER']` (`auth.service.ts:72`). The `ADMIN` role is minted into tokens by design but no route currently branches on it, so there is no higher-privilege endpoint to escalate to. | Fixed. The guard refuses any request without a signed, unexpired, correctly-issued token before a handler runs, and the controller receives no identity the client could have influenced. |
| A02 Cryptographic failures | Yes | Passwords are hashed with argon2id, m=65536 (64 MB), t=3, p=4 — about 100 ms per verification (OOM-hard, GPU-resistant; `password.constants.ts`). Access tokens are signed HS256 with the algorithm pinned at signing (`algorithm: 'HS256'`) and at verification (`algorithms: ['HS256']`, plus a pinned issuer) — the algorithm is never read from the token header (`token.service.ts:56,63`). Refresh tokens are stored as a SHA-256 hex digest (`CHAR(64)`), never the token itself, so database read access is not session takeover. The signing secret comes from `JWT_SECRET`, Joi-validated at startup to a minimum of 32 characters; it is present in no committed file except the clearly-marked development value in `.env.example`. | Fixed. One decision recorded: the development `JWT_SECRET` in `.env.example` is published in the repository. Accepted for a training stack; the residual risk is anyone with repo read access can mint tokens the consumers accept for as long as that value is live. The team will rotate it the day a real issuer exists (also recorded in `README.md`). |
| A03 Injection | Yes | Finding of none. Every statement in `user.repository.ts` and `refresh-token.repository.ts` binds its parameters (`$1`…) and no statement is assembled by string concatenation from an external value; verified by reading all ten SQL statements across both repositories. The one dynamic value, the column list, is a compile-time constant. | Fixed by design: parameterised statements only, no dynamic SQL. |
| A04 Insecure design | Yes | Designed in: every `POST /auth/refresh` rotates — the presented token is revoked before the response is written and a replacement is stored. Presenting a token that is already revoked is treated as theft: `revokeAllForUser` revokes the whole chain and the route answers `AUTH-401` (`auth.service.ts:140-147`). Registration issues no tokens, so the public route is not an unauthorised session factory, and it never creates a trading account — it validates the `accountId` against the Sprint 3 `clients` table. Login is throttled but a throttled attempt still returns the uniform `AUTH-401`, so the throttle does not become an enumeration oracle. | Fixed by design. The contract's deliberate-failure requirement and the refresh/replay handling were implemented rather than retrofitted. |
| A05 Security misconfiguration | Yes | `JWT_SECRET` is required: a missing or short value fails Joi validation at startup rather than defaulting to a weak secret. OpenAPI is served at `/docs` and `/docs/json` from the running process. `enableCors()` is called with no allowlist — CORS is broad, but the API authenticates with bearer tokens, so CORS is not the authorisation boundary. The Dockerfile is multi-stage and runs as a non-root user (`nestjs`, uid 1001). The global exception filter maps every unhandled fault to a generic `INTERNAL-500` envelope, so no exception name or stack leaks to a client. | Fixed. The broad CORS policy is accepted as a training-stack decision, with the residual risk that any origin may call the service; acceptable because every protected route requires a bearer token. |
| A06 Vulnerable and outdated components | Yes | `npm audit` (2026-09-22) reports 31 vulnerabilities: 4 low, 13 moderate, 14 high. All are in development/build tooling — `tmp` (via `external-editor` and `inquirer` under the schematics CLI) and `webpack` (via `@nestjs/cli`) — none in the runtime dependency tree, which is the tree the production image installs (`npm ci --omit=dev`). The recommended fix (`npm audit fix --force`) upgrades `@nestjs/cli` to a breaking major (12.x), which is not feasible during this sprint. Lockfile is committed so the tree is pinned and reproducible. | Accepted for this sprint with the residual risk that dev-time tooling is exploitable only to a developer's own build environment. Recorded as an outstanding item to clear once the `@nestjs/cli` major bump is scheduled. |
| A07 Identification and authentication failures | Yes | An unknown username and a wrong password return the same `AUTH-401` body, the same status and comparable timing: the not-found path verifies the supplied password against a fixed argon2id dummy hash before failing, so both paths do ~100 ms of hashing work (`auth.service.ts:90-96`). Token lifetimes are 900 s access / 7 days refresh; `exp` is enforced on every protected request by `verifyAccessToken`, so a token that was valid but is now expired is refused rather than accepted for ever. Password policy is length-first (min 12 / max 128) per the contract. Wrong signature / expired / malformed header all answer the identical `AUTH-401`. | Fixed, and demonstrated in e2e: `auth.e2e-spec.ts` asserts the two 401 bodies for unknown-user vs wrong-password are identical, and separately proves the expired-token and wrong-signature guard paths (signing a genuinely past-`exp` token, and signing with a different key). |
| A09 Security logging and monitoring failures | Yes | Login failures, rate-limit hits, successful logins, refresh rotations, expired-token revocations and replay-theft all write through `AUTH_LOGGER` with named events (`login_failed`, `login_success`, `rate_limited`, `token_refreshed`, `refresh_token_theft_detected`, `refresh_token_expired`, `credential_created`, `password_rehashed`). The logger redacts by key name at any depth (`password`, `token`, `refresh_token`, `authorization`, `secret`, …), and `auth.service.ts` logs only `username`/`userId` — never a password, hash or token value. A replayed refresh token is the incident log an operations team needs after a theft. | Fixed. The `AuthServiceException` and unhandled-`>=500` paths also log the request path; no credential is written to any log. |

### Two categories deliberately absent

A08 (software and data integrity) is covered here by A06 and by the committed, pinned `package-lock.json`. A10 (server-side request forgery) does not apply: the service makes no outbound requests on a caller's behalf. Neither was introduced by this implementation.

## Evidence

| Check | How it was performed | Result |
|---|---|---|
| `npm run build` | `nest build` | Pass, no errors |
| `npm test` (unit) | Jest over `src/**/*.spec.ts` | 15 suites, 96 tests, all pass |
| `npm run test:e2e` | Jest `test/auth.e2e-spec.ts` against the Nest app | 18 tests pass (register, login uniform 401 + timing-safe, me guard incl. expired + wrong-signature, refresh rotation + replay-theft, OpenAPI) |
| `npm run lint` | ESLint `{src,apps,libs,test}/**/*.ts` | 0 errors, 0 warnings |
| `npm run test:cov` | Coverage of auth module | `auth.controller.ts` 100%, `jwt-auth.guard.ts` 100%, `auth.service.ts` 97.8%, `token.service.ts` 92%, `refresh-token.repository.ts` 100%, `user.repository.ts` 87.5% |
| `npm audit` | against package-lock | 31 vulnerabilities (4 low / 13 moderate / 14 high), all dev-only tree |
| Code read | `auth.service.ts`, `token.service.ts`, `jwt-auth.guard.ts`, `auth-exception.filter.ts`, both repositories, `migrations/012_auth_service_tables.sql` | Contract claim set, pinned HS256+issuer, parameterised SQL, dummy-hash timing path, rotation + whole-chain revocation all confirmed in source |
| Decoded token | e2e decodes access token payload | Exactly `sub`, `accountId`, `roles`, `iat`, `exp` (`exp-iat = 900`), `iss` = `auth-service`; HS256 header |

## Outstanding items

| Item | Owner | Target date |
|---|---|---|
| Clear the 31 dev-only `npm audit` findings (requires `@nestjs/cli` breaking-major upgrade) | Team 1 | Post-sprint 8 / next maintenance window |
| Rotate the published development `JWT_SECRET` once a real issuer exists | Team 1 / platform ops | When the auth service goes beyond the training stack |
| Adopt the running auth service in place of the Sprint 6-7 auth stub in `run-local.ps1` and the Trade REST API integration (a configuration change only, per the sprint brief) | Team 1 | Sprint 8 integration demo |