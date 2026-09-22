# Credential Store & Password Hashing

## Overview
Implementation of secure credential storage using **argon2id** with parameter versioning for future upgrades, rate limiting, and comprehensive password policy.

## Features

| Feature | Implementation |
|---------|----------------|
| **Hash Algorithm** | argon2id (memory-hard, GPU-resistant) |
| **Parameters** | m=65536 (64MB), t=3, p=4 → ~100ms per verification |
| **Parameter Upgrades** | `params_version` column + `needsRehash()` on login |
| **Rate Limiting** | 5 attempts / 15min window / 15min lockout |
| **Password Policy** | 12+ chars, upper/lower/number/special, blocks common patterns |
| **Timing Safety** | Constant-time verification via native argon2 |
| **User Enumeration Protection** | Dummy hash verification for non-existent users |
| **Audit Logging** | Per-event logging with automatic redaction |

## Database Migration

```sql
-- migrations/011_credential_argon2.sql
BEGIN;
ALTER TABLE auth ADD COLUMN IF NOT EXISTS params_version INT NOT NULL DEFAULT 1;
UPDATE auth SET params_version = 1 WHERE params_version IS NULL;
COMMIT;
```

Only adds `params_version` to existing `auth` table - no new tables.

## Configuration

All parameters in code constants (`src/auth/password.constants.ts`):

```typescript
export const ARGON2_PARAMS = {
  memoryCost: 65536,  // 64 MB
  timeCost: 3,
  parallelism: 4,
  algorithm: Algorithm.Argon2id,
};
```

## API Endpoints

### Register Credential
```bash
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "Strong-Pass-123!"
}
```

**Success (201):**
```json
{ "message": "Credential created successfully" }
```

**Validation Error (400):**
```json
{
  "statusCode": 400,
  "message": "Bad Request",
  "errors": [
    "Password must be at least 12 characters",
    "Password must contain a special character"
  ]
}
```

### Login
```bash
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "Strong-Pass-123!"
}
```

**Success (200):**
```json
{ "message": "Login successful", "verified": true }
```

**Invalid Credentials (401):**
```json
{ "message": "Invalid credentials", "verified": false }
```

**Rate Limited (429):**
```json
{
  "statusCode": 429,
  "message": "Too many attempts",
  "retryAfterMs": 900000
}
```

## Password Policy Rules

| Rule | Description |
|------|-------------|
| Length | Minimum 12 characters |
| Uppercase | At least one A-Z |
| Lowercase | At least one a-z |
| Number | At least one 0-9 |
| Special | At least one non-alphanumeric |
| No "password" | Case-insensitive substring check |
| No sequential | Blocks "123456" etc. |
| No keyboard patterns | Blocks "qwerty" etc. |

## Parameter Upgrade Flow

1. Update `ARGON2_PARAMS` constants and increment `CURRENT_PARAMS_VERSION`
2. On next login, `needsRehash()` detects old params
3. Rehashes password with new params transparently
4. Updates `params_version` in database

## Rate Limiting

| Parameter | Value |
|-----------|-------|
| Max Attempts | 5 |
| Window | 15 minutes |
| Lockout Duration | 15 minutes |
| Scope | Per email address |

## Logging & Redaction

All auth events logged to `logs/auth/auth-YYYY-MM-DD.log` with automatic redaction:

```json
{
  "timestamp": "2026-09-22T10:30:45.123Z",
  "level": "WARN",
  "source": "auth",
  "message": "login_failed",
  "context": "login",
  "metadata": { "email": "u***@example.com" }
}
```

Redacted keys: `password`, `passwordhash`, `password_hash`, `token`, `authorization`, `secret`, `apikey`, `access_token`, `refresh_token`, `jwt`, `creditCard`, `cvv`, `ssn`.

## Running Locally

```bash
cd services/team1-nestjs
cp .env.example .env
# Edit .env with DB credentials
npm ci
npm run start:dev
```

## Testing

```bash
npm test          # All 46 tests pass
npm run build     # TypeScript compilation
npm run lint      # ESLint (0 errors)
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@node-rs/argon2` | Native argon2id implementation |
| `pg` | PostgreSQL client |

