# ETL Layer

Two pipelines share one DuckDB warehouse (`warehouse.duckdb` at the repo root).
The full warehouse DDL is consolidated for review at
`../Databases/DuckDB/analytics/schema.sql` (derived — the loaders below stay
authoritative).

| Pipeline | Directory | Source | Target | Run |
|---|---|---|---|---|
| Trade facts | `etl-trades/` | PostgreSQL `order_history` terminal rows | `analytics.fact_trades` + dims, watermarked merge | `python Application/ETL/etl-trades/load_fact_trades.py all [--db ...] [--since ...]` |
| Order fixtures | `etl-trades/simulate_orders.py` | — (generates) | PostgreSQL `orders` + `order_history` + portfolio books | `python Application/ETL/etl-trades/simulate_orders.py --count 50 --bad-share 0` for verify runs |
| Market prices | `etl-live/` | Fauxnance API / fixtures | `daily_price` + quarantine/audit tables | `python Application/ETL/etl-live/pipeline.py` |
| Daily run | `etl-live/daily.py` | Fauxnance (cached per day) | the warehouse refresh, then the analysis publish, once per analysis day; started by the Trade API (ADR 0015) | `python Application/ETL/etl-live/daily.py --day YYYY-MM-DD [--skip-refresh]` |
| Analysis and predictions | `etl-live/analysis.py` | `daily_price` (read-only), extended with PostgreSQL `daily_candles` | PostgreSQL `market_analysis` (replaced) + `daily_predictions` (kept), read by the Trade API's advice routes, the dashboard and the assistant (ADR 0011) | `python Application/ETL/etl-live/analysis.py [--publish] [--json out.json]` |

Conventions:

* `etl-trades` validates every row (`transform.py`); failures go to
  `analytics.dead_letter_trades`, never silently dropped. Replay a window with
  `--since`.
* `etl-live` writes the price series the trade facts join against in-DB.
* Close the warehouse (dashboard shell, DuckDB CLI) before loading: single writer.
