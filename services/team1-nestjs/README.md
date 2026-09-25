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
cp .env.example .env

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

## Environment Variables

All configuration is loaded from environment variables. See `.env.example` for all available options.

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment (development/production/test) | `development` |
| `PORT` | HTTP server port | `3000` |
| `JWT_SECRET` | JWT signing secret (min 32 chars) | *required* |
| `JWT_ISSUER` | JWT issuer claim | `auth-service` |
| `DB_HOST` | PostgreSQL host | `localhost` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_USERNAME` | PostgreSQL username | *required* |
| `DB_PASSWORD` | PostgreSQL password | *required* |
| `DB_NAME` | PostgreSQL database name | `trading_platform` |
| `KAFKA_BROKER` | Kafka broker address | `localhost:9092` |
| `FAUXNANCE_BASE_URL` | Fauxnance API base URL | `https://y4t9nq2bqf.execute-api.eu-west-2.amazonaws.com/v1` |
| `FAUXNANCE_API_KEY` | Fauxnance API key | *optional* |

## Docker

### Build Image

```bash
docker build -t team1-nestjs .
```

### Run Container

```bash
docker run -d \
  -p 3000:3000 \
  --env-file .env \
  --name team1-nestjs \
  team1-nestjs
```

### Health Checks

The container includes a health check that runs every 30 seconds:

```bash
docker ps
# Check STATUS column for (healthy)
```

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
- Environment-specific `.env` files
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