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
  public IP with port 29092 open.
- **Windows box(es)**: everything `run-local.ps1`'s own prerequisite check looks for (java,
  mvn, python + `trustme_secrets`, node, npm, psql, a local PostgreSQL service already
  running on 5432). See the script's own `.SYNOPSIS`/`.PARAMETER` docs (`Get-Help
  .\run-local.ps1 -Full`) for the full list and what each flag does.
- `leapcapstoneteam1-720d03.TM` at the repo root on both machines (it's committed, so a
  clone already has it) and its password, known to the team but not committed anywhere.

## Starting the stack

**On the Linux box**, whenever you want a fresh, verified Kafka (first start, after a reboot,
or any time something looks off):

```bash
bash Application/Infrastructure/Kafka/up.sh
```

That's it - no `.env` to hand-edit. Every run does the same thing, start to finish:

1. Uses the repository's one `.env` at the repo root (creating it from `.env.example` on first
   run, and passing it to Compose with `--env-file`), and auto-detects this box's own reachable
   address (EC2 metadata endpoint, falling back to `hostname -I`) for `KAFKA_ADVERTISED_HOST`.
   It leaves `KAFKA_ADVERTISED_HOST` alone once it's been set to something other than the
   `localhost` default, so a manual override always wins. It refuses to run if `KAFKA_PORT` is
   not `29092`, because the broker advertises that port.
2. **Always restarts Kafka entirely**: `down -v --remove-orphans`, then a fresh container. Every
   topic and offset is discarded.
3. Waits for the container to be healthy (up to 240 s, `HEALTH_TIMEOUT` to change it).
4. Creates the six topics (`scripts/create-topics.sh`).
5. Runs seven checks and prints PASS/FAIL for each: the broker answers on the external
   (`localhost:29092`) and internal (`kafka:19092`) listeners; all six topics exist with the
   contracted partitions, retention and in-sync leaders; automatic topic creation is off; a
   message produced to a scratch topic is consumed back; port 29092 is open on the box; and the
   advertised address `KAFKA_ADVERTISED_HOST:29092` accepts connections from the box itself.

It exits `0` only when every check passes, and otherwise exits `1` after printing the broker's
last log lines. Because it wipes the topics each time, don't run it while the Windows services
are using this Kafka; restart them (`run-local.ps1`) afterwards.

`KAFKA_ADVERTISED_HOST` has to be this box's own reachable address, not `localhost` (which
only means something to a process running on the box itself) - if auto-detection ever fails
(no EC2 metadata endpoint, no `hostname -I`, e.g. off EC2 or a minimal image), `up.sh` says
so and leaves you to set it in the repo-root `.env` by hand before re-running. Getting this
wrong is the single most common failure, and the least obvious from the error: everything
past the first connection attempt fails with an `UNKNOWN_TOPIC_OR_PARTITION`-shaped error
that looks unrelated to the real cause.

**On each Windows box**, from the repo root:

```powershell
.\run-local.ps1
```

It prompts for the TrustMe password (Enter, or `-NoVault`, uses the repo-root `.env` instead) and
for the Kafka host's address (the same value you
just put in the Linux box's `.env`), then builds, creates the six topics on that remote
broker, starts the auth stub + API + executor locally, and tails their logs. `-KafkaHost` /
`-TrustMePassword` skip the prompts if you'd rather script it; `-Stop` shuts down the local
processes without touching Kafka (that's stopped separately, on Linux).

## Stopping / restarting / resetting

| Action | Where | Command |
|---|---|---|
| Stop local services | Windows | `.\run-local.ps1 -Stop` |
| Stop Kafka | Linux | `docker compose -f Application/Infrastructure/Kafka/docker-compose.yml down -v` |
| Restart Kafka from scratch, recreate the topics and verify it (deletes topics/offsets) | Linux | `bash Application/Infrastructure/Kafka/up.sh` |
| Reset the database to seed state | Windows | `.\run-local.ps1 -ResetDb` |

## Kafka

- Topics are listed in `Application/Contracts/event-schemas/kafka-topics.md`. `up.sh` creates
  them on every restart, and `run-local.ps1` creates them every run (idempotent -
  `--if-not-exists`). `Application/Infrastructure/Kafka/scripts/create-topics.sh` is what
  `up.sh` calls, and can be run on its own against a running container. Auto-creation is
  off, so a topic that was never created fails loudly instead of appearing silently with one
  partition and default retention.
- Dead-letter topics are named `<topic>.DLT` with the same partition count and retention as
  their source.
- Kafka has no persistent volume: every restart through `up.sh` starts it empty, and the
  topics are recreated straight away.

## Diagnosis

- Is Docker running on the Linux box? `docker info` succeeds.
- Is Kafka healthy? `docker ps --filter name=team1_kafka` shows `(healthy)`. Re-running `up.sh`
  re-checks everything and says which check fails.
- Can Windows actually reach it? From a Windows box: `Test-NetConnection <KafkaHost> -Port 29092`.
- Wrong advertised address is the most common failure and the least obvious from the error:
  if Kafka logs or `run-local.ps1`'s "ensuring topics" step complain about a broker that
  "does not host this topic-partition", check `KAFKA_ADVERTISED_HOST` in the Linux box's
  `.env` first.
- Look at Kafka's logs: `docker logs --tail 200 team1_kafka`.
- For the Windows-side services, check `logs\local\{api,executor,authstub}.{log,err}`.

## Notes

- The binding local-infrastructure requirements ask for Postgres 16; this setup uses
  whatever's installed locally as "PostgreSQL" on Windows, which is a team/environment
  decision, not something this repo pins.
- Nothing here runs the real Sprint 8 auth service; `Application/Services/auth-stub` (started locally by
  `run-local.ps1`) stands in for it. See `Application/Services/auth-stub/README.md`.
