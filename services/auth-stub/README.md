# Trading Auth Stub

A minimal Node.js service that issues JWTs, standing in for the Sprint 8 auth service
described in `sprint-06-api/contracts/auth-api.yaml`. It doesn't validate a real credential
store — its job is to hand out tokens signed with the same secret the Trade REST API and
executor verify, so the group can test "valid token in, protected data out" without a real
identity service behind it. Copied as-is from the Module 9 mission-control auth stub: same
two hardcoded users, same response shape, no mapping onto this project's seed data.

## Run it standalone

```bash
cd services/auth-stub
npm install
npm start
```

Listens on `http://localhost:4000`. Or via Docker Compose, from the repo root:

```bash
docker-compose --profile platform up -d --build auth-stub
```

Or via `run-local.ps1` on Windows — it starts this alongside Kafka, the API and the
executor, using the same `-JwtSecret` so a token minted here verifies against the API.

## Get a token

```bash
curl -X POST http://localhost:4000/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"mission123"}'
```

Returns `{"token": "eyJhbGc..."}`. Use `bob`/`wrongpermissions` to see a `GUEST`-role token
instead of a `MISSION_OPERATOR` one, or any wrong password to see a `401`.

Note: neither user's token carries an `accountId` claim (this stub was left exactly as
copied, not adapted to this project's accounts), so it's good for exercising the Trade REST
API's authentication check but not the per-account reach check — that still resolves to
"no token" and is skipped, per `TokenAccountIdResolver`'s documented behaviour.

## The shared secret

The Trade REST API and this stub both need to know the same HMAC secret. The API's
`jwt.secret` property normally resolves from the TrustMe vault, which this stub knows
nothing about — so for a minted token to actually verify, override `jwt.secret` to a value
you both share:

- **Docker**: `.env`'s `JWT_SECRET` plus a `JWT_SECRET: ${JWT_SECRET}` entry for `trade-api`
  in `docker-compose.override.yml`.
- **`run-local.ps1`**: already handled — the script exports `JWT_SECRET` for both the API
  process and this stub before starting either, from its `-JwtSecret` parameter (default
  `local-dev-secret-change-me`).

Without that override, the API is checking signatures against a secret this stub was never
given, and every token comes back `401`.
