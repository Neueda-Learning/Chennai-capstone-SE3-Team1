# 0015 The Trade API runs the ETL once per analysis day, records it in a ledger, and the ETL caches each day's fetches

| Field | Value |
|---|---|
| Status | proposed |
| Date | 2026-10-07 |
| Decided by | requested by the product owner on 2026-10-07 ("a scheduled job inside the Trade API ... runs every day once; when starting the ps1 file, if the pipeline was already run that day, use cached data, don't re-run") |

## Context

The advice the dashboard, the Advice page and the assistant show is published by the ETL (0011): `pipeline.py --live` refreshes `warehouse.duckdb` from Fauxnance (about 150 requests of the shared 2,000-a-day quota), then `analysis.py --publish` writes `market_analysis` and `daily_predictions`. Nothing ran it on a schedule; `run-local.ps1` published once per start, with whatever the warehouse held, so the data aged until someone ran the pipeline by hand. The live extractor's own cache is keyed without a date and serves the first response it ever stored, which is why the warehouse stopped at September. The stack is restarted several times a day during development.

## Options considered

| Option | For | Against |
|---|---|---|
| Windows Task Scheduler runs the ETL | Independent of the API | One more thing to install per machine; the task needs the vault password stored outside the vault; invisible to the app |
| `run-local.ps1` runs it on every start | Simple | Spends the quota on every restart; does nothing when the stack stays up for days |
| A cron in the Trade API at a fixed time | Always on while the API is | A start after that time on a day it did not run waits until tomorrow; a restart could run it twice |
| The Trade API checks at start-up and every 15 minutes whether the current analysis day has run, using a Postgres ledger; the ETL caches fetched candles per day | Exactly once per day however often it is restarted; a missed day catches up on the next start; a failure is retried; a forced re-run spends no quota | A child Python process launched by the API; the vault password is passed on its command line, as `run-local.ps1` already does |

## Decision

The last option.

- **Analysis day.** The day turns over at the cutoff, 16:30 IST, after the market closes. Before it, the day being served is yesterday's; from it, today's. A start at 10:00 reuses yesterday's run; the first check after 16:30 runs today's.
- **Ledger.** `etl_daily_runs` (migration 033) holds one row per analysis day. A check claims the day with an insert, or re-claims a `FAILED` day, or a `RUNNING` row older than the timeout (a dead process), up to 3 attempts. `SUCCEEDED` and `PARTIAL` close the day: a restart then uses what was already published.
- **The run.** `DailyAnalysisJob` launches `Application/ETL/etl-live/daily.py --day <analysis day>` from the repository root on its own thread (never on the scheduler thread the conditional-order poller shares), with a 45-minute timeout, and streams its output into the API log. `daily.py` refreshes the warehouse, then publishes the analysis. Exit 0 is `SUCCEEDED`; exit 3, where the refresh failed (no key, quota too low) and the analysis was published from the stored data, is `PARTIAL`; anything else is `FAILED`.
- **Per-day cache.** `daily.py` bypasses the extractor's undated cache and keeps its own under `.cache/daily/<day>/`, counting cached symbols against the quota check, so a re-run for the same day fetches nothing. Caches older than 7 days are deleted.
- `run-local.ps1` no longer publishes; it passes `-Detl.daily.workdir` to the API.

## Consequences

The advice is at most one trading day old while the API runs, and a stack started after a missed day catches up within seconds of starting. The first run of a day takes a few minutes in the background; until it finishes, the previous day's advice is shown with its date. Fauxnance quota spent by the ETL is bounded at about 150 requests per analysis day. The vault password reaches the child process's command line, which is outstanding item O10's exposure again, not a new one. A multi-instance deployment would need each instance to share the ledger, which it does through Postgres; only one would claim the day.
