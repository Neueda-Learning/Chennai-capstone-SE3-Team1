# Trading Auth Stub

A minimal Node.js service that issues JWTs, standing in for the Sprint 8 auth service
described in `sprint-06-api/contracts/auth-api.yaml`. It doesn't validate a real credential
store — its job is to hand out tokens signed with the same secret the Trade REST API and
executor verify, so the group can test "valid token in, protected data out" without a real
identity service behind it. Adapted from the Module 9 mission-control auth stub.

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

## Get a token

```bash
curl -X POST http://localhost:4000/login \
  -H "Content-Type: application/json" \
  -d '{"username":"aarav.mehta@example.com","password":"trading123"}'
```

Returns `{"token": "eyJhbGc...", "tokenType": "Bearer", "expiresIn": 3600, "accountId": 1}`.

## Users

Every user below shares the one stub password `trading123` — `seed/030_auth.csv`'s password
hashes are placeholders (`SEEDDATAONLYnotarealhash...`) and were never meant to be checked
against anything, so this doesn't try to. What's real is the `accountId`: it maps onto the
seeded accounts in `seed/020_clients.csv`, so a minted token addresses an account the Trade
REST API and executor already know about.

| username | accountId | account state |
|---|---|---|
| `aarav.mehta@example.com` | 1 | ACTIVE |
| `diya.sharma@example.com` | 2 | ACTIVE |
| `rohan.iyer@example.com` | 3 | ACTIVE |
| `meera.nair@example.com` | 4 | SUSPENDED — use this one to see the account-not-active rejection path |

Any other username, or the wrong password, returns `401`.

## The shared secret

The Trade REST API and this stub both need to know the same HMAC secret. The API's
`jwt.secret` property normally resolves from the TrustMe vault, which this stub knows
nothing about — so for a minted token to actually verify, override `jwt.secret` to a value
you both share, via `.env`'s `JWT_SECRET` and a `JWT_SECRET: ${JWT_SECRET}` entry in
`docker-compose.override.yml` for `trade-api` (see the comment in `.env.example`). Without
that override, the API is checking signatures against a secret this stub was never given,
and every token comes back `401`.
