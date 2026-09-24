# curl reference — every endpoint

Every HTTP route the local stack (`.\run-local.ps1`) exposes, as copy-pasteable curl
commands: import straight into **Postman**/**Bruno** ("Import → Raw text / cURL"), or paste
directly into **PowerShell**.

Every command below is a single line and uses literal values — no `$variables`, no command
substitution — so a straight copy-paste works everywhere. Swap `<ACCESS_TOKEN>` /
`<ADMIN_TOKEN>` / `<REFRESH_TOKEN>` for a real value from the register/login responses.

**Why two formats for POST/PUT bodies:** Postman, Bruno and bash all parse
`-d '{"key":"value"}'` (plain single quotes) correctly. Native Windows PowerShell does not.
`curl.exe`'s argument handling under PowerShell mangles a plain `-d '{"key":"value"}'` (quotes
get silently stripped — verified: returns `422`), and a naive `\"`-escaped single-quoted body
only survives if no value contains a space (verified: breaks with a value like `"Test
Holder"`, works with `"RELIANCE"`). The one pattern verified to work in every case — spaces
included — is curl.exe with PowerShell's **stop-parsing token** `--%`, right after `curl.exe`,
with a double-quoted body:
```
curl.exe --% -s -X POST <url> -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" -d "{\"key\":\"value with spaces\"}"
```
`--%` turns off *all* further PowerShell parsing on that line — no `$variables`, no backtick
escapes past that point — which is exactly why it survives copy-paste: nothing about it is
PowerShell-specific to begin with. Requests with no body (GET, DELETE, and the PUT routes
that take query params instead of a body) are a single block that works unmodified in all
three tools, `--%` not needed.

Services: auth `:3000`, trade-api `:8081`, executor `:8083`.

---

## Health checks
*(no body — works everywhere as-is)*

```
curl -s http://localhost:3000/health
curl -s http://localhost:3000/health/ready
curl -s http://localhost:3000/health/startup
curl -s http://localhost:8081/actuator/health
curl -s http://localhost:8083/actuator/health
```

The executor has no other REST surface — it's purely Kafka-driven (consumes `orders`,
publishes `trade-events` / `market-data`, with `.DLT` dead-letter topics for each).

---

## Auth service (`:3000` — OpenAPI UI at `/docs`)

### Register
Public; `roles` in the body is ignored — self-registered users are always `CUSTOMER`.
Password policy: 12–128 chars, must not contain "password", "123456" or "qwerty".

**curl (Postman / Bruno / bash)**
```
curl -s -X POST http://localhost:3000/auth/register -H "Content-Type: application/json" -d '{"username":"priya.menon","email":"priya.menon@example.com","password":"Correct-Horse-Battery-9"}'
```

**PowerShell (curl.exe)**
```
curl.exe --% -s -X POST http://localhost:3000/auth/register -H "Content-Type: application/json" -d "{\"username\":\"priya.menon\",\"email\":\"priya.menon@example.com\",\"password\":\"Correct-Horse-Battery-9\"}"
```

Response:
```json
{"id":"...","username":"priya.menon","email":"priya.menon@example.com","accountId":null,"roles":["CUSTOMER"],"createdOn":"..."}
```

### Login
Seeded users (from `seed/`) **cannot** log in — their password hashes are placeholders.
Always register a fresh user first.

**curl (Postman / Bruno / bash)**
```
curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{"username":"priya.menon","password":"Correct-Horse-Battery-9"}'
```

**PowerShell (curl.exe)**
```
curl.exe --% -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d "{\"username\":\"priya.menon\",\"password\":\"Correct-Horse-Battery-9\"}"
```

Response:
```json
{"accessToken":"eyJ...","refreshToken":"...","tokenType":"Bearer","expiresIn":900}
```

### Refresh
Always refresh after linking a bank account — the new token carries the `accountId` claim
the old one didn't have.

**curl (Postman / Bruno / bash)**
```
curl -s -X POST http://localhost:3000/auth/refresh -H "Content-Type: application/json" -d '{"refreshToken":"<REFRESH_TOKEN>"}'
```

**PowerShell (curl.exe)**
```
curl.exe --% -s -X POST http://localhost:3000/auth/refresh -H "Content-Type: application/json" -d "{\"refreshToken\":\"<REFRESH_TOKEN>\"}"
```

### Current user
*(no body)*
```
curl -s http://localhost:3000/auth/me -H "Authorization: Bearer <ACCESS_TOKEN>"
```

---

## Trade API (`:8081`)

All routes below need `Authorization: Bearer <token>` unless marked **public**.

### Orders

**Place an order** — `side`: `BUY`|`SELL`. `idempotencyKey` must be unique per order (8–100
chars) — change it every time you re-run this, otherwise you'll get a duplicate-key rejection.

curl (Postman / Bruno / bash):
```
curl -s -X POST http://localhost:8081/api/v1/orders -H "Authorization: Bearer <ACCESS_TOKEN>" -H "Content-Type: application/json" -d '{"accountId":1,"symbol":"RELIANCE","side":"BUY","quantity":1,"price":1300.00,"idempotencyKey":"test-key-001"}'
```

PowerShell (curl.exe):
```
curl.exe --% -s -X POST http://localhost:8081/api/v1/orders -H "Authorization: Bearer <ACCESS_TOKEN>" -H "Content-Type: application/json" -d "{\"accountId\":1,\"symbol\":\"RELIANCE\",\"side\":\"BUY\",\"quantity\":1,\"price\":1300.00,\"idempotencyKey\":\"test-key-001\"}"
```

Response (immediate — the fill/reject happens asynchronously off Kafka a moment later; poll
`GET /accounts/{id}/orders` to see `status` move to `FILLED`/`REJECTED`):
```json
{"orderId":"ORD-...","status":"NEW","message":"Order accepted","symbol":"RELIANCE","side":"BUY","quantity":1,"price":1300.00}
```

**Cancel an order** *(no body)* — `{id}` is the stored UUID **without** the `ORD-` prefix;
only works before the order reaches a terminal state.
```
curl -s -X DELETE http://localhost:8081/api/v1/orders/6e376bd6-c410-4091-861a-5b90cd315cf9 -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### Accounts
*(all GET, no body)*
```
curl -s http://localhost:8081/api/v1/accounts/1 -H "Authorization: Bearer <ACCESS_TOKEN>"
curl -s http://localhost:8081/api/v1/accounts/1/balance -H "Authorization: Bearer <ACCESS_TOKEN>"
curl -s http://localhost:8081/api/v1/accounts/1/portfolio -H "Authorization: Bearer <ACCESS_TOKEN>"
curl -s http://localhost:8081/api/v1/accounts/1/orders -H "Authorization: Bearer <ACCESS_TOKEN>"
curl -s "http://localhost:8081/api/v1/accounts/1/orders?status=FILLED" -H "Authorization: Bearer <ACCESS_TOKEN>"
curl -s "http://localhost:8081/api/v1/accounts/1/orders?from=2026-01-01T00:00:00&to=2026-12-31T23:59:59" -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### Bank account linking (self-service onboarding)
The one account route a token *without* an `accountId` claim is meant for — links a bank
account to the authenticated user and creates their trading account. `accountNumber` must
match `^[A-Z0-9]{6,34}$` and already exist, unclaimed. Seeded unclaimed accounts:
`IN45ICIC0000008901234`, `IN45SBIN0000009012345`, `IN45AXIS0000010123456`,
`IN45KKBK0000011234567`, `IN45YESB0000012345678` (each can only be claimed once).

curl (Postman / Bruno / bash):
```
curl -s -X POST http://localhost:8081/api/v1/bank-accounts -H "Authorization: Bearer <ACCESS_TOKEN>" -H "Content-Type: application/json" -d '{"accountNumber":"IN45SBIN0000009012345"}'
```

PowerShell (curl.exe):
```
curl.exe --% -s -X POST http://localhost:8081/api/v1/bank-accounts -H "Authorization: Bearer <ACCESS_TOKEN>" -H "Content-Type: application/json" -d "{\"accountNumber\":\"IN45SBIN0000009012345\"}"
```

Response:
```json
{"accountId":7,"accountNumber":"IN45SBIN0000009012345","bankName":"State Bank","ifscCode":"SBIN0009012","accountState":"ACTIVE"}
```

### Wallet transfers
`direction`: `BANK_TO_WALLET`|`WALLET_TO_BANK`. `amount` > 0, 2 decimals.
`idempotencyKey`: 8–100 chars, unique per transfer.

curl (Postman / Bruno / bash):
```
curl -s -X POST http://localhost:8081/api/v1/accounts/7/transfers -H "Authorization: Bearer <ACCESS_TOKEN>" -H "Content-Type: application/json" -d '{"direction":"BANK_TO_WALLET","amount":10000,"idempotencyKey":"transfer-key-001"}'
```

PowerShell (curl.exe):
```
curl.exe --% -s -X POST http://localhost:8081/api/v1/accounts/7/transfers -H "Authorization: Bearer <ACCESS_TOKEN>" -H "Content-Type: application/json" -d "{\"direction\":\"BANK_TO_WALLET\",\"amount\":10000,\"idempotencyKey\":\"transfer-key-001\"}"
```

---

## Clients (`/api/clients` — pre-v1, mostly admin)
A `CUSTOMER` token reaches only the client matching its own `accountId`; everything else
needs `ADMIN` — see **Minting an admin token** below.

**Create (admin)**

curl (Postman / Bruno / bash):
```
curl -s -X POST http://localhost:8081/api/clients -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" -d '{"name":"Priya Menon","email":"priya.menon@example.com","phone":"9876543210"}'
```

PowerShell (curl.exe):
```
curl.exe --% -s -X POST http://localhost:8081/api/clients -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" -d "{\"name\":\"Priya Menon\",\"email\":\"priya.menon@example.com\",\"phone\":\"9876543210\"}"
```

**Reads (owner or admin)** *(no body)*
```
curl -s http://localhost:8081/api/clients/1 -H "Authorization: Bearer <ACCESS_TOKEN>"
curl -s http://localhost:8081/api/clients -H "Authorization: Bearer <ADMIN_TOKEN>"
curl -s http://localhost:8081/api/clients/account/IN45ICIC0000008901234 -H "Authorization: Bearer <ACCESS_TOKEN>"
```

**Update profile (owner or admin)**

curl (Postman / Bruno / bash):
```
curl -s -X PUT http://localhost:8081/api/clients/1/profile -H "Authorization: Bearer <ACCESS_TOKEN>" -H "Content-Type: application/json" -d '{"name":"Priya M.","email":"priya.m@example.com","phone":"9876543210"}'
```

PowerShell (curl.exe) — verified live, returns `200`:
```
curl.exe --% -s -X PUT http://localhost:8081/api/clients/1/profile -H "Authorization: Bearer <ACCESS_TOKEN>" -H "Content-Type: application/json" -d "{\"name\":\"Priya M.\",\"email\":\"priya.m@example.com\",\"phone\":\"9876543210\"}"
```

**Activate / suspend / close (admin)** *(no body)*
```
curl -s -X PUT http://localhost:8081/api/clients/1/activate -H "Authorization: Bearer <ADMIN_TOKEN>"
curl -s -X PUT http://localhost:8081/api/clients/1/suspend -H "Authorization: Bearer <ADMIN_TOKEN>"
curl -s -X PUT http://localhost:8081/api/clients/1/close -H "Authorization: Bearer <ADMIN_TOKEN>"
```

---

## Bank accounts (`/api/bank-accounts` — pre-v1, mostly admin)

**Create an unclaimed bank account (admin)** — add `"clientId":1` to the body to pre-link it
to an existing client instead of leaving it unclaimed.

curl (Postman / Bruno / bash):
```
curl -s -X POST http://localhost:8081/api/bank-accounts -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" -d '{"accountNumber":"IN45HDFC0000099999999","name":"Test Holder","bankName":"HDFC Bank","ifscCode":"HDFC0000099","initialBalance":0}'
```

PowerShell (curl.exe) — verified live, returns `201`:
```
curl.exe --% -s -X POST http://localhost:8081/api/bank-accounts -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" -d "{\"accountNumber\":\"IN45HDFC0000099999999\",\"name\":\"Test Holder\",\"bankName\":\"HDFC Bank\",\"ifscCode\":\"HDFC0000099\",\"initialBalance\":0}"
```

**Reads (owner or admin)** *(no body)*
```
curl -s http://localhost:8081/api/bank-accounts/account/IN45ICIC0000008901234 -H "Authorization: Bearer <ACCESS_TOKEN>"
curl -s http://localhost:8081/api/bank-accounts/client/1 -H "Authorization: Bearer <ACCESS_TOKEN>"
curl -s http://localhost:8081/api/bank-accounts -H "Authorization: Bearer <ADMIN_TOKEN>"
```

**Deposit / withdraw (owner or admin)** — query params, not a body, so these
work unmodified everywhere:
```
curl -s -X PUT "http://localhost:8081/api/bank-accounts/IN45ICIC0000008901234/deposit?amount=5000" -H "Authorization: Bearer <ACCESS_TOKEN>"
curl -s -X PUT "http://localhost:8081/api/bank-accounts/IN45ICIC0000008901234/withdraw?amount=1000" -H "Authorization: Bearer <ACCESS_TOKEN>"
```

---

## Minting an admin token

Public `/auth/register` always creates a `CUSTOMER`, so there's no self-service way to get an
`ADMIN` token. For local testing, hand-sign one with the dev `JWT_SECRET` `run-local.ps1`
starts the API with (`local-dev-secret-change-me-0123456789abcdef` by default, or whatever you
passed as `-JwtSecret`) — the API only checks the signature and the `roles` claim, so `sub` /
`accountId` can be anything.

**PowerShell** — paste this whole block (plain PowerShell, no `--%` needed here since there's
no embedded-quote body to fight), then use `$AdminT`:
```powershell
function New-Jwt($secret, $roles, $accountId = $null, $ttlSec = 3600) {
    $b64 = { param($bytes) [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+","-").Replace("/","_") }
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $h = & $b64 ([Text.Encoding]::UTF8.GetBytes('{"alg":"HS256","typ":"JWT"}'))
    $rolesJson = ($roles | ForEach-Object { '"' + $_ + '"' }) -join ','
    $accIdVal = if ($accountId) { $accountId } else { "null" }
    $p = & $b64 ([Text.Encoding]::UTF8.GetBytes(('{{"sub":"admin-test","accountId":{0},"roles":[{1}],"iss":"auth-service","iat":{2},"exp":{3}}}' -f $accIdVal, $rolesJson, $now, ($now + $ttlSec))))
    $mac = New-Object Security.Cryptography.HMACSHA256 (,[Text.Encoding]::UTF8.GetBytes($secret))
    $s = & $b64 ($mac.ComputeHash([Text.Encoding]::UTF8.GetBytes("$h.$p")))
    "$h.$p.$s"
}
$AdminT = New-Jwt "local-dev-secret-change-me-0123456789abcdef" @("ADMIN")
$AdminT
```
Copy the printed value out and paste it in place of `<ADMIN_TOKEN>` above — `--%` blocks
`$AdminT` variable expansion, so it has to go in as literal text, not a variable reference.
Verified live against both `/api/clients` and `/api/bank-accounts` (both `200` with the full
seeded list).

**Postman / Bruno**: run the PowerShell block above once to print `$AdminT`, then paste that
string as the `Bearer` value in the request's Authorization tab (or store it as an environment
variable).

---

## Kafka (`:9092` — not HTTP, no curl)
```
java -cp "C:\kafka\libs\*" org.apache.kafka.tools.TopicCommand --bootstrap-server localhost:9092 --list
java -cp "C:\kafka\libs\*" org.apache.kafka.tools.consumer.ConsoleConsumer --bootstrap-server localhost:9092 --topic trade-events --from-beginning
```
