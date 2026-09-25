# Sprint 8 — JIRA-2: Implement Auth Contract

> **Author:** Team 1 · **Owner:** JIRA-2 (Implement Auth Contract) + JIRA-4 (Exact JWT Claim Set)
> **Presented:** Sprint 8 Review
> **Normative source:** `contracts/auth-api.yaml`

---

## 1. One-line summary

Implement the Sprint 8 authentication service in `services/team1-nestjs` so its
four endpoints, responses, error envelope, and JWT claim set **exactly** match
`contracts/auth-api.yaml` — giving the trade API a real identity service whose
tokens it can validate and trust.

---

## 2. What the JIRA expects

| Aspect | Expectation from the JIRA / contract |
|---|---|
| **Endpoints** | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me` |
| **Success contracts** | Register → `201 UserResponse`; login/refresh → access + refresh tokens; `GET /auth/me` → `200 UserResponse` (guarded) |
| **Failure envelope** | Every error is `{errorCode, message}` with `additionalProperties: false` — no extra fields |
| **Error vocabulary** | `AUTH-401` Unauthorised · `AUTH-409` Registration failed · `VAL-422` Invalid input · `INTERNAL-500` |
| **JWT claim set** | `sub`, `accountId`, `roles`, `iat`, `exp = iat + 900`, `iss = auth-service`, signed HS256 |
| **Registration semantics** | Creates **no trading account** (unknown `accountId` → `VAL-422`), issues **no tokens** |
| **Security posture** | argon2 password hashing · constant-time login · refresh-token rotation · revocable tokens |

---

## 3. Endpoints created

All endpoints live under `/auth` in `services/team1-nestjs` (`AuthController`,
backed by `AuthService`). None of them carry a global `/api/v1` prefix; the
protected route requires a Bearer token.

| Method | Path | Auth | Request body | Success response | Failures |
|---|---|---|---|---|---|
| `POST` | `/auth/register` | public | `username`, `password`, `email` — optional `roles` **ignored** | **201** `UserResponse` (no tokens) | `VAL-422` invalid input · `AUTH-409` username/email taken |
| `POST` | `/auth/login` | public | `username`, `password` | **200** `TokenResponse` (access + refresh) | `VAL-422` invalid input · `AUTH-401` bad credentials |
| `POST` | `/auth/refresh` | public (refresh token in body) | `refreshToken` | **200** `TokenResponse` (new pair; old token rotated) | `VAL-422` invalid input · `AUTH-401` unknown/consumed/expired token |
| `GET` | `/auth/me` | **Bearer JWT** (`JwtAuthGuard`) | — | **200** `UserResponse` of the authenticated user | `AUTH-401` missing/invalid token |

Behavioural highlights per endpoint:

- **register** — validates the body, rejects self-declared roles (always
  `CUSTOMER`), creates the user **without** a trading account and **without**
  issuing tokens; duplicate username/email collapses to the same
  `AUTH-409 Registration failed`.
- **login** — rate limited, and every failure (unknown user, wrong password)
  returns the **identical** `AUTH-401 Unauthorised` body; passwords verified
  against an argon2id hash, refreshed transparently when the KDF parameters age.
- **refresh** — rotates the refresh token on every use (the presented token is
  revoked immediately); reusing a consumed token is treated as theft and revokes
  the **whole chain** for that user.
- **me** — guard reads `Authorization: Bearer <token>`, verifies HS256 + pinned
  issuer, attaches claims to the request, returns the current `UserResponse`.

All four endpoints are documented in Swagger (Bearer auth added) and served at
`/docs` with JSON at `/docs/json`.

---

## 4. Acceptance criteria and status

| # | Acceptance criterion | Status |
|---|---|---|
| 1 | The 4 contract routes are exposed under `/auth` | PASS |
| 2 | Success bodies match the contract schemas exactly | PASS |
| 3 | Every failure is the `{errorCode, message}` envelope, nothing extra | PASS |
| 4 | Error codes/messages match the contract vocabulary verbatim | PASS |
| 5 | Register returns `201 UserResponse`, creates no trading account, issues no tokens | PASS |
| 6 | Register validates body; malformed input → `VAL-422` | PASS |
| 7 | Duplicate username/email → `AUTH-409 Registration failed` (no enumeration) | PASS |
| 8 | Login authenticates and returns access + refresh tokens | PASS |
| 9 | Refresh **rotates** the token (old one is revoked, a new pair is issued) | PASS |
| 10 | `GET /auth/me` returns the authenticated user, guarded by the JWT | PASS |
| 11 | Passwords stored as argon2id, never plaintext; login is constant-time | PASS |
| 12 | JWT carries the exact claim set (see JIRA-4) | PASS |
| 13 | Unit + e2e test suites cover the contract; all green | PASS |
| 14 | OWASP security review delivered and committed | PASS |

---

## 5. Deliverables (code)

```
services/team1-nestjs/
├── migrations/012_auth_service_tables.sql      users + refresh_tokens schema
├── src/auth/
│   ├── dto/                                    contract DTOs + Swagger + validation
│   ├── auth-errors.ts                          AUTH-401/409, VAL-422, INTERNAL-500 + factories
│   ├── auth-exception.filter.ts                global exception → contract envelope
│   ├── token.constants.ts                      900s access, 7d refresh, issuer
│   ├── token.service.ts                        claim-set sign/verify, refresh hashing
│   ├── user.repository.ts                      users CRUD (pg, parameterised)
│   ├── refresh-token.repository.ts             store/revoke/rotation persistence
│   ├── auth.service.ts                         register/login/refresh/me orchestration
│   ├── jwt-auth.guard.ts                       Bearer-token guard for protected routes
│   ├── auth.controller.ts                      4 endpoints + OpenAPI metadata
│   └── auth.module.ts                          provider wiring (+ all specs)
├── src/main.ts                                 Swagger /docs + /docs/json
├── src/app.module.ts                           global ValidationPipe + exception filter
├── src/config/configuration.ts                 JWT secret/issuer managed via TrustMe vault
└── test/                                       jest-e2e.json, setup, mocks, e2e suite
```

Non-code deliverables:

- `security-review/auth-service-security-review.md` — OWASP 8-section review
- `services/team1-nestjs/AUTH_IMPLEMENTATION.md` — implementation notes
- `infra/postgres/docker-compose.yml` — auth-service joined to the trade stack
- Migrations kept immutable (`apply_db.py` checksum guard)

---

## 6. Tests done

| Suite | Scope | Result |
|---|---|---|
| **Unit** | 15 suites / **96 tests** — DTO validation, token claims, repositories, service, filter, guard, password, rate limiter | ✅ PASS |
| **E2E** | **18 tests** — register/login/refresh/me over HTTP, rotation, expired tokens, envelope shape | ✅ PASS |
| **Build** | `nest build` (TypeScript compile) | ✅ PASS |
| **Lint** | `eslint` on `{src,apps,libs,test}/**/*.ts` | 0 errors |

Coverage highlights:

| Target | Coverage |
|---|---|
| `auth.controller` | 100% |
| `jwt-auth.guard` | 100% |
| `refresh-token.repository` | 100% |
| `auth.service` | 97.8% |
| `token.service` | 92% |
| `auth-exception.filter` | 96% |

E2E specifics proven:

- refresh rotation — the presented token stops working after a refresh
- token-theft path — reusing a consumed token revokes the whole chain
- exact claim set — a key-set equality assertion on the decoded JWT
- expired/forged/missing tokens all collapse to a uniform `AUTH-401`
- Swagger exposed at `/docs` and `/docs/json` (verified in the e2e app)

---

## 7. Additional work done

Beyond the core JIRA, the following gaps were found and closed:

- **Cross-project regression fix** — migration 012's new tables tripped
  `tests/test_migrations.py`'s exact-table-set assertion; `EXPECTED_TABLES`
  was updated so the Python migration suite stays green.
- **Coverage hardened** — added the missing controller spec and pushed
  guard/repository coverage to 100%.
- **Flaky test fixed** — the argon2 timing test now uses the median of three
  verifies with a realistic bound.
- **Deterministic-JWT gotcha** — same-second minted access tokens are
  byte-identical; the rotation test asserts **only the refresh token** changes.
- **Vault-aware configuration** — `JWT_SECRET`/DB password now read from the
  TrustMe vault (mirroring Java's `trustme.*` pattern) with an e2e mock so tests
  never touch a live vault.
- **Documentation rewritten** — `AUTH_IMPLEMENTATION.md`, service README
  (endpoints + env table), root README migration list.
- **Docker wiring** — auth-service added to `infra/postgres/docker-compose.yml`
  sharing `JWT_SECRET`/`JWT_ISSUER` with the trade API; `docker compose config`
  validates.

---

## 8. Business value and importance

- Turns authentication from "assumed" into **real** — the trade API's
  `JwtValidator` can validate tokens minted by a genuine identity service,
  closing the hole left since Sprint 6.
- **Contract-first alignment** — both services implement one normative YAML, so
  client and consumer agree on codes, envelope, and claims with no drift.
- **Security posture raised** — argon2id hashing, constant-time login,
  refresh rotation, theft detection, no plaintext secrets at rest, uniform
  failure messages that prevent enumeration.
- **Safe default** — registration creates no trading account and never honours a
  self-declared role; every account/order route stays blocked until a bank
  account is linked (`accountId` claim stays `null`).
- **Auditable and reproducible** — 96 + 18 tests, 62-DB-check parity suite, and a
  committed security review make the work demonstrably done.

---

## 9. How the story fits the sprint

```
clients/auth (Sprint 3 schema) ── migration 012 ──▶ users + refresh_tokens
                                                          │
contracts/auth-api.yaml ──────────▶ services/team1-nestjs ◀── TrustMe vault
        │                                 │ (JIRA-2/4)
        ▼                                 ▼
trade-api /api/v1/** ◀── JwtValidator ◀── Bearer JWT (accountId, roles, exp)
```

- JIRA-2 = the service + endpoints + envelope
- JIRA-4 = the exact claim set the validator relies on
- Sprint 6 trade API (Story 4) consumes both; order-history/e2e wires them live