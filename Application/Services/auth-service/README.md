# Team 1 NestJS Trading Service

A NestJS-based trading service built with TypeScript, following clean architecture principles.

## Requirements

- Node.js 20+
- npm 10+
- PostgreSQL 16+ (for database health checks)
- Kafka (for message queue health checks)

## Quick Start

```bash
# Install dependencies
npm ci

# Copy environment file
# no .env file: configuration comes from the TrustMe vault (see Configuration below)

# Run in development mode
npm run start:dev

# Run production build
npm run build
npm run start:prod

# Run tests
npm test

# Run e2e integration tests
npm run test:e2e

# Run tests with coverage
npm run test:cov

# Lint code
npm run lint

# Format code
npm run format
```

## Configuration

Nothing is configured through a `.env` file. Secrets and connection details come from the TrustMe vault
(the key file and its password are passed as `--trustme-key-file=...` / `--trustme-password=...`, as
`run-local.ps1` does); see `src/config/configuration.ts`.

| TrustMe secret | Description |
|---|---|
| `JWT_SECRET` | JWT signing secret (min 32 chars), required |
| `PostGres_Host`, `Postgres_Port`, `Postgres_DB`, `PostGres_User`, `PostGres` | PostgreSQL connection, required |
| `AUTH_PRIVATE_KEY` | RSA private key (PKCS#8 PEM) that opens encrypted credentials. Optional: if absent, a temporary key is generated at startup and a warning is logged. Set it so every instance and every restart share one key |
| `Fauxnance`, `Fauxnance_Endpoint` | Market-data API key and base URL. Optional |

Fixed in code: port `3000`, JWT issuer `auth-service`. Registration creates the account `ACTIVE`: there is no email verification and no password-reset route.
Read from the environment: `NODE_ENV` (default `development`) and `KAFKA_BROKER` (default
`localhost:29092`, used only by the health check).

## Docker

### Build Image

```bash
docker build -t team1-nestjs .
```

### Run Container

```bash
# The service needs the TrustMe key file and its password, passed as arguments (no secret is
# baked into the image or read from an env file):
docker run -d \
  -p 3000:3000 \
  --name team1-nestjs \
  team1-nestjs --trustme-key-file=/run/secrets/team.TM --trustme-password=...
```

### Health Checks

The container includes a health check that runs every 30 seconds:

```bash
docker ps
# Check STATUS column for (healthy)
```

## Credentials over plain HTTP

Every `POST` under `/auth` takes an encrypted envelope and answers with an encrypted response (the
protocol is in `Contracts/api-schemas/auth-api.yaml`, "Encrypted POST bodies"; the code is in
`src/auth/crypto/`). A plaintext body is refused with `422 VAL-422`. The Angular app does this in
`core/auth/credential-crypto.interceptor.ts`; anything else calling these routes (curl, Postman,
scripts) has to build the envelope too.

What it does: a passive observer on the network sees ciphertext, not passwords or tokens
in those requests and replies, and a captured request cannot be replayed (each nonce works once).

What it does not do: protect against anyone who can modify traffic in transit, because over HTTP
they can alter the page that does the encrypting; protect the `Authorization` header that carries
the access token on later calls; or protect any other API traffic. Only HTTPS fixes those. If you
can serve the app over HTTPS, do, and add HSTS.

Nonces are held in memory, so run a single instance or put a sticky route in front of
`/auth/crypto-params` and the POST that follows it.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Application info |
| `GET` | `/health` | Liveness probe |
| `GET` | `/health/ready` | Readiness probe |
| `GET` | `/health/startup` | Startup probe |
| `POST` | `/auth/register` | Register a user (no tokens issued) |
| `POST` | `/auth/login` | Log in, receive access + refresh tokens |
| `POST` | `/auth/refresh` | Rotate a refresh token for a new pair |
| `GET` | `/auth/me` | Current user (protected by bearer token) |
| `GET` | `/auth/crypto-params` | Public key and one-time nonce for encrypting a POST body |
| `GET` | `/docs` | Swagger UI |
| `GET` | `/docs/json` | OpenAPI JSON document |

## Project Structure

```
src/
├── app.module.ts           # Root module
├── app.controller.ts       # Root controller
├── app.service.ts          # Root service
├── main.ts                 # Application entry point
├── config/
│   └── configuration.ts    # Configuration with validation
├── auth/                   # Sprint 8 auth service (see AUTH_IMPLEMENTATION.md, security-review/)
│   ├── auth.controller.ts  # /auth/register, /auth/login, /auth/refresh, /auth/me
│   ├── auth.service.ts     # registration, login, refresh rotation, current user
│   ├── jwt-auth.guard.ts   # bearer-token guard for protected routes
│   ├── token.service.ts    # HS256 access tokens + refresh token hashing
│   ├── user.repository.ts  # users table (parametrised SQL)
│   ├── refresh-token.repository.ts  # refresh_tokens table
│   ├── auth-errors.ts      # AuthServiceException + error envelope
│   ├── auth-exception.filter.ts     # global filter -> AUTH-401/409, VAL-422
│   ├── dto/                # request/response DTOs + Role enum
│   └── password-*.ts, rate-limiter.ts  # argon2id, policy, login throttle
└── health/
    ├── health.module.ts    # Health module
    ├── health.controller.ts # Health endpoints
    ├── health.service.ts   # Health check orchestration
    └── indicators/
        ├── database.indicator.ts  # PostgreSQL health
        └── kafka.indicator.ts     # Kafka health
```

## Testing

Tests are co-located with the code they test (`*.spec.ts`):

```bash
# Unit tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:cov
```

## Configuration

Configuration is handled via `@nestjs/config` with:
- Schema validation using Joi
- Secrets in the TrustMe vault, never in `.env` files
- Type-safe configuration access via `ConfigService`

## Health Checks

Three probe types are implemented:

- **Liveness** (`/health`): Process is alive
- **Readiness** (`/health/ready`): Ready to serve traffic (checks DB + Kafka)
- **Startup** (`/health/startup`): Started successfully (checks DB + Kafka)

## Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run compiled app |
| `npm run start:dev` | Run with hot reload |
| `npm run start:prod` | Run production build |
| `npm run test` | Run unit tests |
| `npm run test:cov` | Run tests with coverage |
| `npm run lint` | Lint with ESLint |
| `npm run format` | Format with Prettier |

## License

UNLICENSED - Internal use only