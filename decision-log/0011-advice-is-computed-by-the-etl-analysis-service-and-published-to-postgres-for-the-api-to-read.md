# 0011 Advice is computed by the ETL analysis service and published to Postgres; the Trade API only reads it

| Field | Value |
|---|---|
| Status | proposed |
| Date | 2026-10-07 |
| Decided by | requested by the product owner on 2026-10-07 ("use the service in the ETL analysis folder to compute and make suggestions for the dashboard"); drafted while building Trade Advice |

## Context

Trade Advice must state a BUY, SELL or HOLD view with its reasoning for what a customer holds and watches, show it on the dashboard, and give the assistant both the analysis and a daily prediction. The ETL analysis folder (`Application/ETL/etl-live`) already owns a year of daily prices for about 150 NSE and BSE listings in `warehouse.duckdb`, with the extract, transform and store code and 400-odd tests around it. A first version of Advice computed a moving-average signal inside the Trade API; the product owner asked for the ETL service to do the computing instead. The Trade API has no DuckDB driver, and a DuckDB file allows one writer or many readers, so a long-lived reader in the API would block the pipeline's next load.

## Options considered

| Option | For | Against |
|---|---|---|
| Keep computing in the Trade API from `daily_candles` | No new moving parts | Two analysis code bases (the ETL already computes returns, volatility and drawdown); not what was asked |
| Trade API reads `warehouse.duckdb` directly through a DuckDB JDBC driver | One source of truth | New dependency; a reader in a running service holds the file and blocks the pipeline's writer; the API would depend on a file path on the analytics host |
| The ETL runs an HTTP service the API calls | Live answers | A sixth process to deploy, secure and keep up; the answers only change once a day anyway |
| The ETL job computes and publishes rows to two Postgres tables it owns (`market_analysis`, `daily_predictions`); the API reads them read-only | Computation stays in the ETL with its tests; Postgres is already the API's database; the answer changes once a day, so a batch hand-over fits; predictions are kept, so they can be checked against what happened | The API shows whatever was last published, so the data can be stale; publishing needs the platform's Postgres credentials on the ETL side |

## Decision

The last option. `analysis.py` reads the store read-only, extends each series with the daily candles the Trade API has stored in Postgres when they are newer (so the prediction is for the next session, not the day after the last pipeline run), and publishes in one transaction through the same `psql` resolver `apply_db.py` uses. `market_analysis` is replaced each run; `daily_predictions` is upserted by `(instrument, for_date)` and kept. The Trade API runs it once per analysis day ([0015](0015-the-trade-api-runs-the-etl-once-per-analysis-day-recorded-in-a-ledger-and-cached-per-day.md)).

The rules are published with the data and are deliberately simple enough to state in one paragraph: trend (+/-40), momentum (20-session return doubled, capped at +/-30), RSI (+/-20 at the extremes); 30 or more is BUY, -30 or less SELL. The prediction is a drift-and-volatility range, with the chance of an up session held between 40% and 60%. Fewer than 60 sessions is `INSUFFICIENT_DATA` and no suggestion; an instrument with nothing published is shown with no suggestion and says so. Every response carries a disclaimer that it is information, not a personal recommendation.

## Consequences

The API never computes advice, so the dashboard, the Advice page and the assistant cannot disagree. Freshness is now an operational property: each row carries `as_of`, and the API flags data more than four days old as stale and the UI shows it. If the job does not run, nothing breaks; the advice simply ages, visibly. A deliberately rules-based score cannot claim more than it is; changing the rules is a change to `analysis.py` and its tests, and to this entry.
