# Sprint 8 — JIRA-4: Exact JWT Claim Set

> **Author:** Team 1 · **Owner:** JIRA-4 (Exact JWT Claim Set) · JIRA-2 pairs with this (Implement Auth Contract)
> **Presented:** Sprint 8 Review
> **Normative source:** `contracts/auth-api.yaml` » *"JWT claims contract"* section

---

## 1. One-line summary

Mint access tokens that carry **precisely the six contract-defined claims** —
no more, no less — so the trade API's `JwtValidator` can verify the signature,
expiry, issuer and ownership of a token minted by a real auth service.

---

## 2. What the JIRA expects

The contract's *JWT claims contract* section is **normative**: a token that does
not carry exactly these claims breaks the Trade REST API's authorisation check.

| Claim | Type | Meaning |
|---|---|---|
| `sub` | string (UUID) | The stable user identifier — not username, not email, because both can change |
| `accountId` | integer or `null` | Numeric trading account key `clients.client_id`; `null` until a bank account is linked; the claim is **always present** |
| `roles` | array of string | `CUSTOMER` / `ADMIN`; **always present, never empty** |
| `iat` | integer | Issued-at, seconds since the Unix epoch |
| `exp` | integer | Expiry; **15 minutes after `iat`** for an access token |
| `iss` | string | Issuer. `auth-service` for Sprint 8; consumers must validate the configured issuer |

Decoded example from the contract:

```json
{
  "sub": "8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f",
  "accountId": 1,
  "roles": ["CUSTOMER"],
  "iat": 1790000000,
  "exp": 1790000900,
  "iss": "auth-service"
}
```

| Aspect | Expectation from the JIRA / contract |
|---|---|
| **Signing** | `HS256` with a shared secret (`JWT_SECRET`), same algorithm + secret on auth service and Trade REST API |
| **Envelope** | Payload is base64, not encrypted — nothing that would not be published goes in a claim |
| **Lifetimes** | Access token 15 min (not revocable → short); refresh token 7 days (stored, revocable) |
| **Exactness** | Only the six claims appear; no `jti`, no `nbf`, no custom extras |

---

## 3. Claim set implementation

`TokenService` (`services/team1-nestjs/src/auth/token.service.ts`) is the single
place that mints and verifies tokens.

| Concern | Implementation |
|---|---|
| **Minting** | `signAccessToken` builds the payload explicitly — sets `iat` itself (Unix seconds), `exp = iat + 900`, `iss` from config — and signs HS256. No `expiresIn` option is passed, so the library cannot add claims |
| **Verifying** | `verifyAccessToken` forces `algorithms: ['HS256']`, pins the configured issuer, then `assertClaims` re-validates every claim's type and presence before the payload is trusted |
| **Exactness** | Constants in `token.constants.ts`: `ACCESS_TOKEN_TTL_SECONDS = 900`, `REFRESH_TOKEN_TTL_SECONDS = 7 × 24 × 60 × 60`, `DEFAULT_ISSUER = 'auth-service'` |
| **Consumer parity** | Trade API `JwtValidator` verifies the same shape: header `alg` → signature → expiry → claims (`sub` + non-empty `roles` required, `accountId` may be `null`) |

Key claim-set invariants:

- `exp − iat == 900` exactly
- `accountId` always present (integer **or** `null`)
- `roles` never empty
- `sub` is the UUID user id, never the mutable username/email
- wrong-issuer or non-HS256 tokens are rejected at verify time

---

## 4. Acceptance criteria and status

| # | Acceptance criterion | Status |
|---|---|---|
| 1 | Decoded key set == exactly `{sub, accountId, roles, iat, exp, iss}` — no extra claims (key-set equality test) | PASS |
| 2 | `exp − iat == 900` (15-minute access token) | PASS |
| 3 | HS256 pinned at signing **and** verification; other algorithms rejected | PASS |
| 4 | `iss` defaults to `auth-service`, configurable via `JWT_ISSUER`; wrong-issuer tokens rejected | PASS |
| 5 | Consumer `JwtValidator` (trade API) accepts the minted tokens and reads the identical claims | PASS |

---

## 5. Deliverables (code)

```
services/team1-nestjs/
├── src/auth/
│   ├── token.constants.ts                 900s access / 7d refresh / issuer — single source of truth
│   ├── token.service.ts                   claim-set sign + verify (HS256 pinned, issuer-pinned, assertClaims)
│   ├── token.service.spec.ts              key-set equality, exp−iat=900, issuer/alg rejection
│   └── auth.module.ts                     wires TokenService + JwtAuthGuard
├── src/config/configuration.ts            JWT_SECRET (min 32) + JWT_ISSUER; JWT_EXPIRES_IN removed
└── test/auth.e2e-spec.ts                  e2e: expired / forged / wrong-signed tokens → uniform AUTH-401
```

Supporting/consumer files:

- `sprint-06-api/contracts/auth-api.yaml` — the normative claim table
- `sprint-06-api/src/main/java/.../security/JwtValidator.java` — consumer that
  validates the same six claims (JIRA-3 scope; confirms JIRA-4 compatibility)

---

## 6. Tests done

| Suite | Scope | Result |
|---|---|---|
| **Unit** | 15 suites / **96 tests** — incl. token claim-set equality, `exp−iat=900`, issuer pinning, algorithm pinning | ✅ PASS |
| **E2E** | **18 tests** — expired / forged / wrongly-signed / missing tokens all collapse to uniform `AUTH-401` | ✅ PASS |
| **Build** | `nest build` (TypeScript compile) | ✅ PASS |
| **Lint** | `eslint` on `{src,apps,libs,test}/**/*.ts` | 0 errors |
| **JVM** | Sprint 6 trade API suite (230 tests, incl. `JwtValidator`) accepts the minted tokens | ✅ PASS |

Coverage highlight for the JIRA-4 surface:

| Target | Coverage |
|---|---|
| `token.service` | 92% |
| `auth.controller` | 100% |

E2E specifics proven against the claim set:

- `exp − iat == 900` asserted on a real minted token
- a token signed with the wrong secret is rejected (`AUTH-401`), not "accepted"
- an expired token is rejected identically to a malformed one (no enumeration
  of *which* check failed)
- decoded claims used by `GET /auth/me` match the registered user

---

## 7. Additional work done

Beyond the core JIRA, the following were found and closed:

- **jsonwebtoken `noTimestamp` gotcha** — verified in `node_modules` that
  `noTimestamp: true` **deletes** `iat` from the payload. The implementation
  never uses it; the payload supplies both `iat` and `exp` explicitly.
- **Deterministic-JWT consequence** — same-second access tokens are
  byte-identical by construction; the refresh e2e asserts **only the refresh
  token** rotates, not the access token.
- **Claim re-validation after signature** — `assertClaims` re-checks every
  claim's type/presence post-verify, so a validly-signed but structurally odd
  payload cannot pass.
- **Config hardening** — `JWT_EXPIRES_IN` removed (expiry is contract-fixed,
  not a knob); `JWT_SECRET` min length enforced (32); `JWT_ISSUER` added and
  shared with the trade API via env/vault.
- **Contract alignment confirmed** — consumer `JwtValidator` reads the same six
  claims with the same ordering expectations (signature → alg → expiry → claims).

---

## 8. Business value and importance

- **Interoperability** — the producer (auth service) and consumer (trade API)
  agree on one claim contract, so the `JwtValidator` can finally trust a real
  issuer instead of nothing.
- **Security** — HS256 pinned prevents algorithm-confusion attacks; a 15-minute
  access token bounds exposure; issuer-pinning blocks cross-issuer token
  injection; `accountId` powers the ownership check (`ACC-403` on mismatch/null).
- **No drift** — the claim table is normative in one YAML; both stacks verify
  against it independently.
- **Auditable and reproducible** — key-set equality, `exp−iat`, and issuer
  tests prove the contract at both unit and e2e level.

---

## 9. How the story fits the sprint

```
claims contract (auth-api.yaml) ──▶ TokenService (sign) ──▶ Bearer JWT
        ▲      (sub, accountId, roles, iat, exp=iat+900, iss, HS256)     │
        │                                                                ▼
register/login ──▶ AuthService ──▶ tokens ─────────────┐          trade-api /api/v1/**
                                                       │                │
refresh ──▶ rotation ──▶ new pair (same claims) ───────┘   JwtValidator ◀┘
```

- JIRA-4 = the exact claim set the validator relies on
- JIRA-2 = the service + endpoints + envelope that deliver those tokens
- Consumer-side verification (`JwtValidator` in `sprint-06-api`) sits in
  JIRA-3; its tests confirm JIRA-4 tokens pass