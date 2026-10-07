# Trade Advice and Signals

Serves the ETL analysis service's BUY, SELL or HOLD view and next-session prediction for what a customer holds and watches, and the market's strongest ideas for the dashboard. It computes nothing and writes nothing: `Application/ETL/etl-live/analysis.py` publishes `market_analysis` and `daily_predictions` (migration `032`), and this package reads them.

| | |
|---|---|
| Routes | `GET /api/v1/accounts/{accountId}/advice`, `GET .../advice/{symbol}` ([`advice-api.yaml`](../../../../../../../../../../Contracts/api-schemas/advice-api.yaml)); both behind `AccessGuard.requireOwner` |
| Reads | `market_analysis`, `daily_predictions` (`AnalysisMapper`, read-only); holdings via `AccountService.getPortfolio`; watched symbols via `WatchedSymbols` (seam 3); active instruments via `MarketService` |
| Used by | the Advice page, the dashboard's Ideas card, and the assistant's `get_analysis` and `get_daily_predictions` (through `AnalysisQueries`, which is account-free) |
| Decisions | [`0011`](../../../../../../../../../../../decision-log/0011-advice-is-computed-by-the-etl-analysis-service-and-published-to-postgres-for-the-api-to-read.md), [`0014`](../../../../../../../../../../../decision-log/0014-watchlists-publishes-the-symbols-a-customer-watches-through-a-java-interface.md) |

## Rules this package keeps

- **Own account only.** `ACC-403` for another account, no ADMIN bypass.
- **One answer.** The page, the dashboard and the assistant all read the same published rows, so they cannot disagree.
- **No suggestion without data.** Too little history is published as `INSUFFICIENT_DATA`; an instrument with nothing published is listed with no suggestion and a sentence saying so.
- **Freshness is shown.** `asOf` on every signal; `stale` when it is more than four days old; the page and the card mark it.
- **Every response carries the disclaimer** and the methodology.

## Keeping it current: the daily ETL job

`DailyAnalysisJob` runs the ETL once per analysis day ([`0015`](../../../../../../../../../../../decision-log/0015-the-trade-api-runs-the-etl-once-per-analysis-day-recorded-in-a-ledger-and-cached-per-day.md)): `Application/ETL/etl-live/daily.py`, which refreshes the warehouse from Fauxnance and publishes the analysis. The day turns over at 16:30 IST; it is checked at start-up and every 15 minutes, and recorded in `etl_daily_runs` (migration `033`), so a restart the same day reuses what was published. The run is a child process on its own thread.

| Property | Default | Meaning |
|---|---|---|
| `etl.daily.enabled` | `true` (`false` in tests) | Turns the job on |
| `etl.daily.workdir` | the vault key's folder | The repository root; `run-local.ps1` passes it |
| `etl.daily.python` | `python` | The interpreter |
| `etl.daily.cutoff` / `etl.daily.zone` | `16:30` / `Asia/Kolkata` | When the analysis day turns over |
| `etl.daily.check-interval-ms` | `900000` | How often it checks |
| `etl.daily.timeout-minutes` | `45` | A run is killed after this |
| `etl.daily.max-attempts` | `3` | Retries for a failed day |

To see what happened: `SELECT * FROM etl_daily_runs ORDER BY run_day DESC`, or the `[etl]` lines in the API log.

## Tests

`DailyAnalysisJobTest` (H2 ledger, fake runner: analysis day and cutoff, runs once and records, restart the same day reuses the run, next day runs, partial closes the day, failed retried up to the limit, running not duplicated and a dead run taken over, no folder no run), `AnalysisQueriesTest` (H2: published rows to views, insufficient data, ranking, inactive instruments left out, stale flag, prediction history), `AdviceServiceTest` (holdings and watchlist with sources, ideas, nothing published, unknown symbol, portfolio refusal), `AdviceControllerWebTest` (`ACC-403`, ADMIN, `AUTH-401`, `INS-404`), both routes in `ModuleRouteAuthorisationTest`. The computation: `Application/ETL/etl-live/tests/test_analysis.py`. Angular: `advice-page.spec.ts`, `advice-ideas.spec.ts`.
