# 0014 Every service host, port and URL lives in Application/Config, and nothing else writes one

| Field | Value |
|---|---|
| Status | accepted |
| Date | 2026-10-08 |
| Decided by | requested by the team after review feedback: addresses were hardcoded across the code |

## Context

The same ports and URLs were typed in many places and in seven different tools: `localhost:3000` and `localhost:8081` in the Angular app, `server.port` in two Spring files, `3000` in the NestJS configuration and its Dockerfile, `4000` in the auth stub, defaults in four Python scripts, `run-local.ps1`, `up.sh`, three compose files and the Dockerfiles. A scan of the commit before this change found 54 such places in 22 files. Changing a port meant finding all of them, and the review had already flagged the hardcoding.

## Options considered

| Option | For | Against |
|---|---|---|
| Keep them in code, document them | No work | It is the problem the review raised; the copies drift |
| One generated file per tool from a master list | Each tool reads its native format | A generator and its output to keep in step; more files to review |
| **One `KEY=value` file that every part reads** | One place to edit; the format needs no library in Spring, Node, Python, PowerShell, Bash or Compose | The browser cannot read a repo file, so Angular needs a small step; Dockerfiles cannot read a file at all |
| Put the values in `.env` | The file already exists | `.env` is git-ignored and holds secrets; addresses must be reviewed and shared |

## Decision

1. `Application/Config/services.env` holds every host, port and external URL, and nothing secret. A value is the environment variable, else `.env`, else this file, so one machine can override it without editing the shared file.
2. Each part reads it: Spring through `VaultEnvironmentPostProcessor` and `${KEY}` placeholders, the auth service and stub through `service-config`, Python through `service_config.py`, `run-local.ps1` and the Kafka scripts through small readers, Compose through `--env-file` with `${KEY:?}` so a missing value is an error and never a default. Angular gets `public/config.json`, generated from the file by `npm start` / `npm run build` and loaded before the app starts. Dockerfiles take their port as a build argument.
3. `scripts/check_config.py`, run by `tests/test_config_rule.py`, fails when a service port or URL is written anywhere else. The ports it looks for are read from `services.env`.
4. Moved with it: `application-test.properties` from `src/main/resources` to `src/test/resources` (it is test configuration and was shipped in the jar); CORS now allows the one frontend origin from the config instead of every `localhost` port; the local Kafka broker's controller port comes from `KAFKA_CONTROLLER_PORT`.
5. `.env.example` no longer carries any address, so a copied `.env` cannot quietly shadow the shared file.

## Consequences

Changing a service's port is one line, in one file. The cost is indirection: reading `server.port=${TRADE_API_PORT}` means opening `services.env`, and the Angular app cannot start without `config.json` (it says how to make it). `docker compose` needs `--env-file` (and 2.24 or newer for two files). The API contracts under `Application/Contracts`, docs, tests with made-up addresses, and Bruno's environment file are deliberately not covered by the check. Adding a service means adding its keys to `services.env` and to `tests/test_service_config.py`.
