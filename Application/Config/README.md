# Config: where every service lives

**The rule: no host, port or URL of a service is written anywhere in the code. It is written here, once, in
[`services.env`](services.env), and everything else reads it from here.**

`services.env` holds addresses only: nothing in it is secret. Passwords, keys and tokens stay in the
TrustMe vault or the git-ignored `.env` at the repository root.

## The file

`KEY=value`, one per line, no quotes and no `${}` references (a URL is built from its `_HOST` and
`_PORT` where it is used).

| Keys | What they are |
|---|---|
| `FRONTEND_HOST`, `FRONTEND_PORT` | the Angular dev server; also the one origin the Trade API allows in CORS |
| `AUTH_SERVICE_HOST`, `AUTH_SERVICE_PORT` | the NestJS auth service |
| `AUTH_STUB_HOST`, `AUTH_STUB_PORT` | the legacy auth stub |
| `TRADE_API_HOST`, `TRADE_API_PORT`, `TRADE_API_CONTAINER_PORT` | the Trade API (order-service); the last is its port inside the Docker image |
| `EXECUTOR_HOST`, `EXECUTOR_PORT` | the trade executor |
| `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_CONTAINER_PORT` | PostgreSQL: the defaults (the vault, or `POSTGRES_*` in the environment or `.env`, take precedence), and the port inside its container |
| `KAFKA_HOST`, `KAFKA_PORT`, `KAFKA_LEGACY_PORT` | where clients reach Kafka; `run-local.ps1` tries `KAFKA_PORT` and then `KAFKA_LEGACY_PORT` |
| `KAFKA_INTERNAL_PORT`, `KAFKA_CONTROLLER_PORT` | Kafka listeners that only exist inside its container network |
| `KAFKA_VERSION`, `KAFKA_DOWNLOAD_BASE_URL` | the Kafka distribution `run-local.ps1` downloads |
| `FAUXNANCE_BASE_URL` | the market-data API (the vault's `Fauxnance_Endpoint`, when present, overrides it) |
| `INSTANCE_METADATA_URL` | AWS instance metadata, used by `up.sh` to find the Kafka box's own address |

## Overriding a value

A value is looked up in this order, and the first one found wins:

1. a real **environment variable** with the same name,
2. the repository's git-ignored **`.env`**,
3. **`services.env`**.

So to point one machine somewhere else, put the key in your `.env` (for example `KAFKA_HOST=10.8.65.2`).
`Application/Infrastructure/Kafka/up.sh --port N` does exactly that for `KAFKA_PORT`.

## How each part reads it

| Part | How |
|---|---|
| Trade API, executor (Spring) | `VaultEnvironmentPostProcessor` adds the file as the lowest property source, so `application.properties` / `application.yml` say `server.port=${TRADE_API_PORT}`. `SERVICES_CONFIG_FILE` points it at a copy where there is no repository (Docker). |
| Auth service (NestJS) | `src/config/service-config.ts`, used by `configuration.ts` |
| Auth stub | `server.js` |
| Angular | the browser cannot read this file, so `scripts/generate-config.mjs` writes `public/config.json` from it (`npm start` and `npm run build` do this first), and `main.ts` loads that before the app starts. `npm start` also serves on `FRONTEND_PORT`. |
| Playwright | `scripts/service-config.mjs`, the same reader |
| Python scripts, ETL | `scripts/service_config.py` (and `vault_env.setting`) |
| `run-local.ps1` | `Read-EnvFile` / `Get-Svc` at the top of the script |
| Kafka `up.sh`, `create-topics.sh` | `config_value` / `setting` |
| Docker Compose | `--env-file Application/Config/services.env`; every port is `${KEY:?set in Application/Config/services.env}`, so a missing value is an error and never a quiet default |
| Dockerfiles | a Dockerfile cannot read a file, so Compose passes the port as a build argument (`ARG`) and the build stops with a message if it is missing |

## Adding or changing a service

1. Add `<NAME>_HOST` and `<NAME>_PORT` (and anything else the service needs) to `services.env`.
2. Read them where the service is used, the way the table above shows. Never type the value.
3. Add the keys to `EXTRA_KEYS` or `SERVICES` in `tests/test_service_config.py`.

## The check

`python scripts/check_config.py` fails when a service port or URL is written outside this folder: a
URL literal, a `host:port` pair, a port assigned to something named `port`, `EXPOSE` or a Docker
port mapping, and the external service hosts. The ports it looks for are read from `services.env`
itself. It also runs as `tests/test_config_rule.py`, so the test suite fails too.

Not checked, on purpose: this folder, tests and specs (they use made-up addresses), docs, the API
contracts under `Application/Contracts` (documentation), generated clients, lock files, and
Bruno's `bruno/` environment file (a separate tool). A literal that has to stay carries the marker
`config-ok: <reason>` on its line or the line above.
