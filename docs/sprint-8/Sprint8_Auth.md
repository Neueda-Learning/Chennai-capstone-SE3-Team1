# Sprint8_Auth

## Sprint Scope
This document captures Team 1 Sprint 8 authentication work in task format, including what each task is and which files were created/changed.

Normative contract: `contracts/auth-api.yaml`
Primary service: `services/team1-nestjs`

---

## Task 1 - SEC3-564: NestJS Project and Engineering Contract

### What this task is
Set up a reproducible NestJS TypeScript service on Node 20+, wired for local orchestration and environment-driven runtime config.

### What was implemented
- NestJS service scaffold and module structure under `services/team1-nestjs`
- Reproducible dependency workflow (`npm ci`) with committed lock file
- Build/test scripts (`npm run build`, `npm test`, `npm run test:e2e`)
- Multi-stage Docker image and local compose wiring
- Runtime configuration from environment/secret provider

### Files created/changed
- `services/team1-nestjs/package.json` : Added/updated scripts and dependencies for build, unit tests, and e2e execution.
- `services/team1-nestjs/package-lock.json` : Committed locked dependency graph to make `npm ci` reproducible.
- `services/team1-nestjs/Dockerfile` : Implemented multi-stage build to separate compile stage and runtime image.
- `services/team1-nestjs/docker-compose.yml` : Added service-level compose wiring for local container run.
- `services/team1-nestjs/src/main.ts` : Bootstrapped Nest app and configured Swagger routes.
- `services/team1-nestjs/src/app.module.ts` : Registered core modules and app-level providers.
- `services/team1-nestjs/src/config/configuration.ts` : Centralized runtime config for JWT, DB, and env-based settings.
- `infra/postgres/docker-compose.yml` : Integrated auth service into team orchestration on reserved port `3000`.

### Acceptance criteria status
- Clean machine flow (`npm ci`, `npm run build`, `npm test`): **PASS**
- Port/orchestration alignment (port `3000`): **PASS**

---

## Task 2 - SEC3-567: Credential Store and Password Hashing

### What this task is
Implement secure credential persistence and verification using strong password hashing, with safe logging and testable behavior.

### What was implemented
- Credential store backed by `users` table (auth migration)
- Password hashing with argon2id (no plaintext storage)
- Password verification flow for valid/invalid credentials
- Password policy enforcement and rehash support
- Constant-time style unknown-user login path (dummy hash verify)

### Files created/changed
- `services/team1-nestjs/migrations/012_auth_service_tables.sql` : Added auth persistence tables (`users`, `refresh_tokens`).
- `services/team1-nestjs/src/auth/user.repository.ts` : Implemented DB operations for user lookup/create/password-hash update.
- `services/team1-nestjs/src/auth/password.service.ts` : Implemented argon2id hashing, verification, and rehash checks.
- `services/team1-nestjs/src/auth/password-policy.ts` : Added password strength validation rules.
- `services/team1-nestjs/src/auth/auth.service.ts` : Wired secure register/login behavior with password and persistence flows.
- `services/team1-nestjs/src/auth/*.spec.ts` : Added/updated unit tests for credential and hashing paths.

### Acceptance criteria status
- Argon2id / no plaintext password storage: **PASS**
- Verifiable and defendable hashing approach in code/tests: **PASS**

---

## Task 3 - SEC3-568: Access Token Issuance and Exact Claim Set

### What this task is
Issue HS256 access tokens with the exact contract claim set and enforce strict verification.

### What was implemented
- HS256 token signing with configured `JWT_SECRET`
- Explicit claim-set construction (`sub`, `accountId`, `roles`, `iat`, `exp`, `iss`)
- Expiry policy (`exp = iat + 900`)
- Issuer configuration with default `auth-service`
- Verification with signature + issuer + claim-shape checks

### Files created/changed
- `services/team1-nestjs/src/auth/token.constants.ts` : Defined access TTL, refresh TTL, and default issuer constants.
- `services/team1-nestjs/src/auth/token.service.ts` : Implemented HS256 JWT issue/verify and exact contract claim set enforcement.
- `services/team1-nestjs/src/auth/token.service.spec.ts` : Added tests for claims, expiry, and signature verification behavior.
- `services/team1-nestjs/src/config/configuration.ts` : Added config binding for JWT secret/issuer runtime values.

### Acceptance criteria status
- Exact claim set and contract expiry behavior: **PASS**
- Signature verification with service key: **PASS**

---

## Task 4 - Team 1: Implement the Provided Auth Contract

### What this task is
Implement the four contract endpoints with exact path/verb/status/body behavior and a single platform error envelope.

### What was implemented
- Endpoints implemented under `/auth`:
  - `POST /auth/register`
  - `POST /auth/login`
  - `POST /auth/refresh`
  - `GET /auth/me`
- `register` does not mint tokens and does not create trading account
- Request validation and normalized `VAL-422`
- Error envelope standardized to `{ errorCode, message }`
- Protected route guarded by Bearer token verification

### Files created/changed
- `services/team1-nestjs/src/auth/auth.controller.ts` : Implemented contract endpoints for register/login/refresh/me.
- `services/team1-nestjs/src/auth/auth.service.ts` : Implemented contract business logic and response behavior.
- `services/team1-nestjs/src/auth/dto/register-request.dto.ts` : Added register request validation and schema metadata.
- `services/team1-nestjs/src/auth/dto/login-request.dto.ts` : Added login request validation and schema metadata.
- `services/team1-nestjs/src/auth/dto/refresh-request.dto.ts` : Added refresh request validation and schema metadata.
- `services/team1-nestjs/src/auth/dto/token-response.dto.ts` : Added contract token response model.
- `services/team1-nestjs/src/auth/dto/user-response.dto.ts` : Added contract user response model.
- `services/team1-nestjs/src/auth/auth-errors.ts` : Standardized auth error codes/messages for contract envelope.
- `services/team1-nestjs/src/auth/auth-exception.filter.ts` : Normalized exception output to `{ errorCode, message }`.
- `services/team1-nestjs/test/auth.e2e-spec.ts` : Added end-to-end checks for route/status/body contract compliance.

### Acceptance criteria status
- 4 operations match contract semantics: **PASS**
- Failure envelope remains platform-standard only: **PASS**

---

## Task 5 - Team 1: Adopt the Real Auth Service with Configuration Change Only

### What this task is
Integrate the real auth issuer into local platform flow using environment/orchestration configuration, not Java code changes in Trade REST API.

### What was implemented
- Auth service wired into local orchestration on port `3000`
- Shared JWT secret path between auth issuer and Trade REST API verifier
- Issuer settings exposed/configurable through environment
- Integration scenario documented for:
  - valid token accepted on protected Trade REST API route
  - missing token refused
  - wrong-signature token refused

### Files created/changed
- `infra/postgres/docker-compose.yml` : Added auth service runtime wiring for local platform integration.
- `.env.example` : Added/updated shared env values used by issuer and verifier services.
- `services/team1-nestjs/README.md` : Documented run/config steps and integration usage.
- `security-review/auth-service-security-review.md` : Recorded key/issuer and token-trust security decisions.

### Acceptance criteria status
- End-to-end protection with auth-issued token and no Java service changes: **PASS**
- Wrong-signature token refusal: **PASS**

---

## Task 6 - SEC3-571: One Answer for Every Failed Login

### What this task is
Prevent user enumeration by returning the same status/body/timing profile for unknown users vs wrong passwords, with a login throttle.

### What was implemented
- Uniform auth failure envelope: `AUTH-401` + `Unauthorised`
- Unknown username path performs dummy argon2 verify before failure
- Wrong password path follows comparable work before failure
- Login throttle added with fixed attempt budget and cooldown

### Files created/changed
- `services/team1-nestjs/src/auth/auth.service.ts` : Unified unknown-user/wrong-password response and added dummy-hash timing path.
- `services/team1-nestjs/src/auth/rate-limiter.ts` : Implemented throttle with attempt limit and cooldown window.
- `services/team1-nestjs/src/auth/auth-errors.ts` : Ensured shared `AUTH-401` envelope behavior for failed auth paths.
- `services/team1-nestjs/src/auth/auth-exception.filter.ts` : Mapped auth-related failures to consistent response envelope.
- `services/team1-nestjs/src/auth/auth.service.spec.ts` : Added tests for uniform login failure behavior and throttle logic.
- `services/team1-nestjs/test/auth.e2e-spec.ts` : Added e2e proof that failure responses stay uniform.

### Acceptance criteria status
- Unknown user and wrong password return same auth failure: **PASS**
- Throttle/cooldown behavior implemented: **PASS**

---

## Task 7 - Team 1: Guard and Token Verification on Protected Route

### What this task is
Protect the profile route and reject malformed, expired, or wrongly signed tokens with `AUTH-401`.

### What was implemented
- Bearer-token guard validates header presence/format
- Guard delegates signature+claim verification to token service
- Expired and wrong-signature paths covered in tests
- Verified claims attached to request user context for downstream handlers

### Files created/changed
- `services/team1-nestjs/src/auth/jwt-auth.guard.ts` : Implemented Bearer-token guard for protected endpoint access.
- `services/team1-nestjs/src/auth/token.service.ts` : Enforced verification checks for signature, issuer, and claims.
- `services/team1-nestjs/src/auth/auth.controller.ts` : Applied guard on protected profile route.
- `services/team1-nestjs/src/auth/jwt-auth.guard.spec.ts` : Added tests for valid, expired, malformed, and wrong-signature tokens.
- `services/team1-nestjs/test/auth.e2e-spec.ts` : Added e2e protected-route verification scenarios.

### Acceptance criteria status
- Protected route guard in place: **PASS**
- Malformed/expired/wrong-signature token refusal: **PASS**

---

## Task 8 - Team 1: Refresh Token Issuance and Rotation

### What this task is
Issue new refresh tokens on each refresh, store only hashes, and enforce revocation behavior for replayed tokens.

### What was implemented
- Opaque refresh token generation
- SHA-256 hashing before persistence
- Rotation on every successful refresh
- Presented token revoked once exchanged
- Replay/consumed-token presentation returns `AUTH-401` and triggers protective revocation behavior

### Files created/changed
- `services/team1-nestjs/src/auth/refresh-token.repository.ts` : Implemented refresh token hash storage and revoke/revoke-all operations.
- `services/team1-nestjs/src/auth/token.service.ts` : Implemented refresh token generation/hash helpers and refresh expiry helper.
- `services/team1-nestjs/src/auth/auth.service.ts` : Implemented refresh rotation, presented-token revocation, and replay handling.
- `services/team1-nestjs/src/auth/refresh-token.repository.spec.ts` : Added repository-level tests for refresh persistence and revocation behavior.
- `services/team1-nestjs/src/auth/auth.service.spec.ts` : Added refresh flow tests including replay refusal.
- `services/team1-nestjs/test/auth.e2e-spec.ts` : Added e2e coverage for refresh rotation and consumed-token refusal.

### Acceptance criteria status
- New refresh token issued on every refresh: **PASS**
- Declared revocation behavior enforced (`AUTH-401` on replay): **PASS**

---

## Task 9 - Team 1: OpenAPI Served by the Running Service

### What this task is
Serve a code-generated OpenAPI document from the running auth service, with both the human UI and JSON paths documented in the Sprint 8 README.

### What was implemented
- OpenAPI document generation from Nest decorators (controllers + DTOs), not hand-maintained YAML
- Swagger UI published by the running service
- Raw OpenAPI JSON published by the running service
- Both documentation paths recorded in sprint documentation

### Files created/changed
- `services/team1-nestjs/src/main.ts` : Configured Swagger/OpenAPI generation and exposed docs endpoints.
- `services/team1-nestjs/src/auth/auth.controller.ts` : Added endpoint decorators and response metadata used by OpenAPI generation.
- `services/team1-nestjs/src/auth/dto/register-request.dto.ts` : Added DTO validation/schema metadata consumed by OpenAPI generator.
- `services/team1-nestjs/src/auth/dto/login-request.dto.ts` : Added DTO validation/schema metadata consumed by OpenAPI generator.
- `services/team1-nestjs/src/auth/dto/refresh-request.dto.ts` : Added DTO validation/schema metadata consumed by OpenAPI generator.
- `services/team1-nestjs/src/auth/dto/token-response.dto.ts` : Added response schema metadata for token endpoints.
- `services/team1-nestjs/src/auth/dto/user-response.dto.ts` : Added response schema metadata for user-profile endpoints.
- `services/team1-nestjs/README.md` : Documented human docs path (`/docs`) and JSON path (`/docs/json`).
- `services/team1-nestjs/test/auth.e2e-spec.ts` : Added verification that `/docs` and `/docs/json` are served at runtime.

### Acceptance criteria status
- Running service publishes decorator-generated OpenAPI for auth routes: **PASS**
- Human and JSON docs paths documented and reachable: **PASS**

---

## Task 10 - Team 1: OWASP Security Review, Committed

### What this task is
Commit a completed OWASP security review with explicit findings/dispositions across categories, including broken auth/access control, token leakage, replay, and weak-secret risks.

### What was implemented
- Security review document created from template and filled with category-by-category findings
- Disposition recorded for each category, including residual risk where accepted
- Refresh-token rotation/replay decisions and implications documented
- JWT secret/issuer handling decisions documented for team review and cutover clarity

### Files created/changed
- `security-review/auth-service-security-review.md` : Added the completed OWASP review with findings, checks performed, and dispositions.
- `security-review/TEMPLATE.md` : Used as baseline template reference for the committed review structure.
- `services/team1-nestjs/README.md` : Referenced the committed security review artifact in sprint/service documentation.
- `docs/sprint-8/Sprint8_Auth.md` : Added Sprint 8 traceability entries for security-review deliverables.

### Acceptance criteria status
- Security review committed and materially filled (not template copy): **PASS**
- Written finding/disposition coverage across required categories: **PASS**

---

## End-to-end auth flow summary

1. `POST /auth/register` creates a user identity only (no token, no trading account).
2. `POST /auth/login` verifies credentials and returns access+refresh tokens.
3. `GET /auth/me` validates Bearer token and returns authenticated profile.
4. `POST /auth/refresh` rotates refresh token and issues a new token pair.

---

## Consolidated file map (quick reference)

- Core auth logic: `services/team1-nestjs/src/auth/auth.service.ts`
- Error contract/filter: `services/team1-nestjs/src/auth/auth-errors.ts`, `services/team1-nestjs/src/auth/auth-exception.filter.ts`
- JWT/claims: `services/team1-nestjs/src/auth/token.service.ts`, `services/team1-nestjs/src/auth/token.constants.ts`
- Guard/protected route: `services/team1-nestjs/src/auth/jwt-auth.guard.ts`
- Persistence: `services/team1-nestjs/src/auth/user.repository.ts`, `services/team1-nestjs/src/auth/refresh-token.repository.ts`
- Migration: `services/team1-nestjs/migrations/012_auth_service_tables.sql`
- E2E contract proof: `services/team1-nestjs/test/auth.e2e-spec.ts`

---

## Final outcome

Sprint 8 auth tasks are implemented as a contract-first, security-focused service with explicit traceability from each task to concrete files and test coverage.

