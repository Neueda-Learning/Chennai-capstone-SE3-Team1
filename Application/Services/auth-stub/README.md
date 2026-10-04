# Trading Auth Stub

A minimal Node.js service that issues JWTs, standing in for the Sprint 8 auth service
described in `Application/Contracts/api-schemas/auth-api.yaml`. It doesn't validate a real credential
store — its job is to hand out tokens signed with the same secret the Trade REST API and
executor verify, so the group can test "valid token in, protected data out" without a real
identity service behind it. Copied as-is from the Module 9 mission-control auth stub: same
two hardcoded users, same response shape, no mapping onto this project's seed data.

## Run it standalone

```bash
cd Application/Services/auth-stub
npm install
node server.js --trustme-key-file=../../../../leapcapstoneteam1-720d03.TM --trustme-password=<password>
```

Listens on `http://localhost:4000`. It is the legacy stand-in for the real auth service
(`Application/Services/auth-service`), and `run-local.ps1` no longer starts it. When it did, it used its
`-JwtSecret` so a token minted here verifies against the API.

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

The Trade REST API and this stub both need the same HMAC secret, and both now get it from the
same place: the `JWT_SECRET` entry in the TrustMe vault. The stub fetches it once at startup
(the `--trustme-*` arguments above), refuses to start if it is missing or shorter than 32
characters, and has no fallback value, so a token it issues verifies against the API without
any step to keep two copies in sync.
