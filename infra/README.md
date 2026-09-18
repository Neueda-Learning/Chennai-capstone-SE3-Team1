# Local infrastructure

Split across two machines: Kafka runs as a Docker container on a Linux box; everything
else - Postgres, the auth stub, Trade REST API, Trade Executor - runs natively on Windows
via `run-local.ps1` at the repo root. There is no full-stack Docker option currently; it was
tried and dropped because it didn't match the actual requirement (see git history on
`Spring_Docker` if you want the removed docker-compose.yml/services).

`infra/README.md` is the reference for everyone on the team. If the stack does not start,
follow [Diagnosis](#diagnosis) before changing anything.

## Requirements

- **Linux box**: Docker + Docker Compose (or the `docker compose` plugin). Reachable from
  every Windows machine that will run `run-local.ps1` - same VPN/private network, or a
  public IP with port 9092 open.
- **Windows box(es)**: everything `run-local.ps1`'s own prerequisite check looks for (java,
  mvn, python + `trustme_secrets`, node, npm, psql, a local PostgreSQL service already
  running on 5432). See the script's own `.SYNOPSIS`/`.PARAMETER` docs (`Get-Help
  .\run-local.ps1 -Full`) for the full list and what each flag does.
- `leapcapstoneteam1-720d03.TM` at the repo root on both machines (it's committed, so a
  clone already has it) and its password, known to the team but not committed anywhere.

## Starting the stack

**On the Linux box**, once per boot (or after any `down`):

```bash
cd infra/kafka
cp ../../.env.example .env      # once - then edit KAFKA_ADVERTISED_HOST, see below
docker-compose up -d
```

(`.env` goes in `infra/kafka/`, not the repo root - Compose looks for it in whatever
directory you actually run the command from.)

`KAFKA_ADVERTISED_HOST` in `.env` must be this box's own reachable address (its private IP
on a VPN, typically) - not `localhost`, which only means something to a process running on
the box itself. Get it wrong and everything past the first connection attempt fails with an
`UNKNOWN_TOPIC_OR_PARTITION`-shaped error that looks unrelated to the real cause.

**On each Windows box**, from the repo root:

```powershell
.\run-local.ps1
```

It prompts for the TrustMe password and for the Kafka host's address (the same value you
just put in the Linux box's `.env`), then builds, creates the six topics on that remote
broker, starts the auth stub + API + executor locally, and tails their logs. `-KafkaHost` /
`-TrustMePassword` skip the prompts if you'd rather script it; `-Stop` shuts down the local
processes without touching Kafka (that's stopped separately, on Linux).

## Stopping / restarting / resetting

| Action | Where | Command |
|---|---|---|
| Stop local services | Windows | `.\run-local.ps1 -Stop` |
| Stop Kafka | Linux | `docker-compose -f infra/kafka/docker-compose.yml down` |
| Reset Kafka to empty (deletes topics/offsets - there's no volume, so this is also what a plain restart does) | Linux | `docker-compose -f infra/kafka/docker-compose.yml down && up -d`, then re-run `run-local.ps1` (or `infra/kafka/create-topics.sh`) to recreate topics |
| Reset the database to seed state | Windows | `.\run-local.ps1 -ResetDb` |

## Kafka

- Topics are listed in `contracts/kafka-topics.md`. `run-local.ps1` creates them every run
  (idempotent - `--if-not-exists`); `infra/kafka/create-topics.sh` does the same thing from
  the Linux side, for testing Kafka without the rest of the stack running. Auto-creation is
  off, so a topic that was never created fails loudly instead of appearing silently with one
  partition and default retention.
- Dead-letter topics are named `<topic>.DLT` with the same partition count and retention as
  their source.
- Kafka has no persistent volume: every `down` + `up` starts it empty. Topics have to be
  recreated after each one (see above).

## Diagnosis

- Is Docker running on the Linux box? `docker info` succeeds.
- Is Kafka healthy? `docker-compose -f infra/kafka/docker-compose.yml ps` shows `healthy`.
- Can Windows actually reach it? From a Windows box: `Test-NetConnection <KafkaHost> -Port 9092`.
- Wrong advertised address is the most common failure and the least obvious from the error:
  if Kafka logs or `run-local.ps1`'s "ensuring topics" step complain about a broker that
  "does not host this topic-partition", check `KAFKA_ADVERTISED_HOST` in the Linux box's
  `.env` first.
- Look at Kafka's logs: `docker-compose -f infra/kafka/docker-compose.yml logs --tail 200 kafka`.
- For the Windows-side services, check `logs\local\{api,executor,authstub}.{log,err}`.

## Notes

- The binding local-infrastructure requirements ask for Postgres 16; this setup uses
  whatever's installed locally as "PostgreSQL" on Windows, which is a team/environment
  decision, not something this repo pins.
- Nothing here runs the real Sprint 8 auth service; `services/auth-stub` (started locally by
  `run-local.ps1`) stands in for it. See `services/auth-stub/README.md`.
