# Local infrastructure

The stack the platform runs against locally. Everything is containerised; the only host prerequisite is Docker Desktop with the WSL 2 backend.

| Component | Image | Host address | Stack address | Health check |
|---|---|---|---|---|
| Postgres | `postgres:17` | `localhost:5432` | `postgres:5432` | `pg_isready` + migrations applied |
| Kafka | `apache/kafka:3.8.0` | `localhost:9092` | `kafka:29092` | `kafka-topics.sh --list` succeeds |
| Auth service | (Sprint 8) | `localhost:3000` | `auth-service:3000` | - |

`infra/README.md` is the reference for everyone on the team. If the stack does not start on your machine, follow [Diagnosis](#diagnosis) before changing anything.

## Requirements and teardown

- Docker Desktop installed and running with the WSL 2 backend.
- `.env` copied from `.env.example` and kept current. `.env` is git-ignored; never commit real credentials.
- No accounts, roles or cluster-wide ldap: the broker is single-node KRaft and the database is a single Postgres instance.

## Starting the stack

From the repository root:

```bash
cp .env.example .env            # once
docker compose -f infra/postgres/docker-compose.yml up -d
docker compose -f infra/kafka/docker-compose.yml up -d
```

Wait for both health checks to pass (they are green when `docker compose ps` shows `healthy`). The database applies `migrations/` and loads `seed/` on first boot.

The broker starts empty and with auto-creation off. Create the contracted topics explicitly:

```powershell
infra\kafka\create-topics.ps1        # PowerShell, from the repository root
```

or `bash infra/kafka/create-topics.sh` from Git Bash / macOS. If you use WSL, either enable Docker Desktop's WSL integration for your distro (`Settings > Resources > WSL Integration`) or run the `.ps1` from Windows PowerShell. Both scripts are idempotent.

## Stopping / restarting / resetting

| Action | Command |
|---|---|
| Stop the whole stack | `docker compose -f infra/postgres/docker-compose.yml -f infra/kafka/docker-compose.yml stop` |
| Restart | `docker compose ... start` |
| Reset Kafka to empty (deletes broker data, topics, offsets) | `docker compose -f infra/kafka/docker-compose.yml down -v` then `up -d` and recreate topics |
| Reset the database to seed state | `docker compose -f infra/postgres/docker-compose.yml down -v` then `up -d` |

A reset returns the stack to the reference state: empty broker, seeded database.

## Kafka

- Topics are listed in `contracts/kafka-topics.md` and created only by `infra/kafka/create-topics.ps1` (Windows) or `infra/kafka/create-topics.sh` (Git Bash / macOS). Auto-creation is off, so a topic that was not created fails loudly instead of appearing silently with one partition and default retention.
- Dead-letter topics are named `<topic>.DLT` with the same partition count and retention as their source.
- Outside Docker, `localhost:9092` is the listener to use; containers on the `trading_platform_net` network use `kafka:29092`.

## Diagnosis

- Is Docker running? `docker info` succeeds.
- Is a container healthy? `docker compose -f <compose file> ps` shows `healthy` or `unhealthy`.
- Is Postgres up? `docker compose -f infra/postgres/docker-compose.yml exec postgres pg_isready -U postgres`.
- Is Kafka up? `docker compose -f infra/kafka/docker-compose.yml exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list`, which prints the six topics when healthy.
- Look at logs: `docker compose -f <compose file> logs --tail 200 <service>`.
- Check the `.env` values match the compose defaults (`localhost`, `5432`, `9092`, `postgres`/`trading_platform`).

## Notes

- The binding local-infrastructure requirements ask for Postgres 16. The compose file currently pins `postgres:17` because that is what the team built Sprint 6 against; aligning to 16 is a one-line change and a full stack reboot, and is left as a team decision.
- Nothing here runs the Auth service yet; it arrives with Sprint 8 and will be given the `auth-service` service name and `localhost:3000` mapping.