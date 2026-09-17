# Sprint 4 Analytics and Ingestion Pipeline Guide

This guide explains the Sprint 4 analytics package file by file, both in code terms and in business terms, and lists the commands used to run it.

The package is split into three stages plus wiring:

- extract: obtain raw candle payloads
- transform: clean, validate, repair, derive, and quarantine
- load: write the transformed result into DuckDB
- pipeline: connect the three stages and expose the command line entry point

The current checkout does not include `pyproject.toml` or `setup.py`, so the runnable entry point here is module-based rather than an installed console script. Use `python -m ETL_Analysis...` from the repository root.

## Setup

From the repository root:

```bash
python -m venv .venv
.venv\Scripts\activate
python -m pip install -r ETL_Analysis/requirements.txt
```

If you plan to run the live Fauxnance path, create or update the root `.env` file with `FAUXNANCE_API_KEY` before using `--live`. The offline fixture path does not need a key.

`pytest` is already included in `ETL_Analysis/requirements.txt`, so the install above is enough for the documented test commands.

## 1. File-by-file explanation

### Package entry points

#### [ETL_Analysis/__init__.py](__init__.py)

This file is empty, but it matters because it turns `ETL_Analysis/` into an importable Python package.

Code-wise, it lets `python -m ETL_Analysis.pipeline`, `python -m ETL_Analysis.dashboard`, and the test suite import modules from the folder.

Logically, it is the smallest possible packaging hook: the package can be imported, but all real behavior stays in the dedicated modules.

#### [ETL_Analysis/pipeline.py](pipeline.py)

This is the orchestrator and the main command-line entry point.

Code-wise, `run()` does four things in order:

1. chooses the extract function
2. extracts each symbol
3. transforms the payloads
4. loads the results into DuckDB or prints them to the console

`main()` parses the CLI flags and decides which mode to run in:

- `--symbols` chooses the explicit symbol list
- `--live` switches from fixtures to the live Fauxnance client
- `--db` selects the DuckDB file
- `--print` sends output to the console instead of DuckDB
- `--claims` regenerates the claims document from the store
- `--dashboard` opens the Streamlit dashboard after a successful load
- `--legacy-report` writes the older standalone HTML report
- `--strict` disables the defect repair path in the transform
- `--interval` forwards the requested candle granularity to extract

Logically, this is the coordinator that keeps extract, transform, and load separated. It never cleans the data itself and it never talks to the database directly; it only wires the stages together and reports progress.

#### [ETL_Analysis/extract_fixtures.py](extract_fixtures.py)

This is the offline extract path used by the tests and by default runs.

Code-wise, it maps three symbols to three JSON fixture files in `fixtures/` and loads them as Python dictionaries. It also attaches a small `meta` block that records the fixture name and the requested range/interval.

Logically, this is the no-network version of the API client. It exists so the pipeline can be exercised deterministically without calling Fauxnance.

#### [ETL_Analysis/extract_live.py](extract_live.py)

This is the live Fauxnance client.

Code-wise, it:

- reads the API key from the environment-backed configuration
- builds the `/candles/{symbol}` request
- retries transient network failures with backoff
- detects HTTP 429 quota exhaustion
- distinguishes normal 4xx client errors from retryable connectivity errors
- caches raw JSON responses in `.cache/`

It also exposes `health()` and `usage()` helpers for the Fauxnance endpoints.

Logically, this is the only module that should touch the network. Everything downstream stays isolated from where the candles came from.

### Transform layer

#### [ETL_Analysis/transform.py](transform.py)

This is the core data-cleaning module.

Code-wise, `transform()` accepts one payload and returns a dictionary with four main pieces:

- `rows`: cleaned candles ready for loading
- `quarantined`: rejected candles plus reason and detail
- `summary`: counts and measures for the run
- `symbol`, `currency`, `interval`: top-level metadata

The transform performs several concrete jobs:

- parses ISO and non-ISO dates
- detects duplicate dates
- enforces required fields and numeric price values
- rejects non-positive prices
- repairs a swapped high/low when the candle still makes sense after the swap
- normalises the negative-volume sentinel to `None` when repair is enabled
- carries the `synthetic` flag through unchanged
- derives `range`, `change`, `daily_return_pct`, and `turnover`
- calculates summary measures such as return, volatility, drawdown, and volume statistics

`transform_many()` applies the same logic to a list of payloads.

`summarise_rows()` is the helper the store and report layers use when they rebuild results from stored rows.

Logically, this file is where the business rules live. It is also where the malformed fixture is handled, which is why the tests spend most of their effort here.

### Load and store layers

#### [ETL_Analysis/load.py](load.py)

This is the DuckDB writer.

Code-wise, it defines the analytical schema, maps transformed rows into insert tuples, writes results, and keeps the store consistent across reruns.

Important functions and responsibilities:

- `connect()` opens the DuckDB file and raises a clear error if DuckDB is missing
- `ensure_schema()` creates the analytics tables when needed
- `migrate_interval_into_the_grain()` handles the schema evolution that added `interval` to `daily_price`
- `price_row()`, `quarantine_row()`, and `run_row()` convert transformed dictionaries into database rows
- `write_result()` upserts one symbol's output into the store
- `load_many()` writes a full pipeline run and returns totals for the dashboard/pipeline summary
- `reconcile()` checks that `candles_in = rows_kept + rows_quarantined`

Logically, this module is the only writer in the analytics package. It owns the DuckDB schema and the rules that keep reruns stable.

#### [ETL_Analysis/load_print.py](load_print.py)

This is the console-only loader.

Code-wise, it formats the transformed rows as readable terminal output and prints the summary counts, repaired rows, and quarantined rows.

Logically, it is a lightweight inspection mode. It is useful for debugging because it shows the cleaned data without opening DuckDB.

#### [ETL_Analysis/store.py](store.py)

This is the read-only store access layer.

Code-wise, it:

- opens DuckDB in read-only mode
- falls back to a snapshot copy if the file is locked by a pipeline run
- blocks unsafe SQL in the console
- reconstructs rows from the stored tables
- exposes helper queries for the dashboard, claims, and report

Key helpers include:

- `connect()` for read-only access
- `check_query()` for the SQL guard on the console
- `records()` for row-to-dictionary fetching
- `runs()`, `ledger()`, `latest_run_id()`, `universe()`, `date_bounds()` for store summaries
- `price_records()` and `quarantine_records()` for rebuilding results from the store

Logically, this module is the read side of the analytics store. It keeps readers from mutating the file and gives the dashboard and claims layers a consistent way to query it.

### Visualization and reporting layers

#### [ETL_Analysis/charts.py](charts.py)

This is the Plotly figure factory for the dashboard.

Code-wise, it defines the style constants and returns plot dictionaries rather than rendering HTML directly. The major chart builders are:

- `comparison_figure()` for rebased multi-symbol comparisons
- `disposition_figure()` for loaded vs repaired vs quarantined counts
- `price_figure()` for daily closing prices
- `volume_figure()` for daily volumes
- `return_histogram()` for return distributions
- `metric_history_figure()` for run-to-run metric trends

Logically, the charts are built as pure data structures so the dashboard can render them without duplicating chart logic.

#### [ETL_Analysis/dashboard.py](dashboard.py)

This is the interactive Streamlit app.

Code-wise, it uses the store and chart modules to render:

- a summary strip
- a claims tab
- an instrument tab
- a data-quality tab
- a runs tab
- an SQL console tab

It also exposes `launch_command()` and `launch()` so the pipeline can open the dashboard after a run.

Logically, this is the live read-only front end for the loaded DuckDB store. It is what a teammate uses to explore the data without writing SQL by hand.

#### [ETL_Analysis/report.py](report.py)

This is the legacy standalone HTML report.

Code-wise, it renders Plotly figures and HTML into a self-contained report file, with optional inline JavaScript or CDN-hosted JavaScript.

Logically, it exists for the sprint's earlier dashboard/report path and remains supported for compatibility, even though the Streamlit dashboard is the preferred reader-facing surface.

#### [ETL_Analysis/claims.py](claims.py)

This module computes the business claims that populate `claims.md` and the dashboard Claims tab.

Code-wise, it:

- queries the store for market-wide quarter statistics
- filters out synthetic rows and duplicate listings
- computes three supported claims plus supporting measures and tables
- renders the claims document through `write_markdown()` / `render_markdown()`

Logically, this is where the analytical conclusions are turned into review-ready statements. The claims are not typed manually; they are computed from the store.

### Support files

#### [ETL_Analysis/symbols.py](symbols.py)

This is the symbol universe and quota planner.

Code-wise, it loads the bundled symbol file, groups symbols by venue, filters by exchange or limit, and checks quota usage before a large live pull.

Logically, it keeps the live pull bounded and gives the pipeline a predictable universe to work with when `--symbols` is omitted.

#### [ETL_Analysis/analytics_schema.sql](analytics_schema.sql)

This is the DuckDB schema used by the analytical store.

Code-wise, it defines the tables that `load.py` creates or ensures before writing:

- `daily_price`
- `quarantined_candle`
- `load_run`
- `run_metric`

Logically, it is the analytical model that the transform output lands in.

#### [ETL_Analysis/requirements.txt](requirements.txt)

This is the dependency list for the sprint package.

Code-wise, it installs the runtime libraries needed for extraction, transformation, loading, dashboarding, and testing:

- `duckdb`
- `streamlit`
- `plotly`
- `pandas`
- `requests`
- `pytest`

Logically, it is the quickest way to get a teammate onto the same dependency set as this workspace.

#### [ETL_Analysis/fixtures/README.md](fixtures/README.md)

This file explains the canned API responses.

Code-wise, it documents the shape of each JSON fixture and the six defects in `candles-malformed.json`.

Logically, it tells the transform tests what the malformed row decisions are meant to be.

#### `ETL_Analysis/fixtures/*.json`

These are the raw offline inputs.

Code-wise, there are three fixture payloads:

- `candles-reliance-ns-2026-07.json`
- `candles-infy-ns-2026-07.json`
- `candles-malformed.json`

Logically, they are the no-network inputs used for testing and for default pipeline runs.

#### `ETL_Analysis/claims.md`

This is a generated output, not a hand-written document.

Code-wise, `claims.py` rewrites it from the current store.

Logically, it is the sprint deliverable that states the three business claims and the chart supporting each one.

### Test files

#### [ETL_Analysis/tests/test_transform.py](tests/test_transform.py)

This is the most important test file.

Code-wise, it checks date parsing, duplicate handling, malformed input decisions, repair behavior, quarantine behavior, derived measures, and the summary counts.

Logically, it proves the transform module does the business-rule work the sprint requires.

#### [ETL_Analysis/tests/test_load.py](tests/test_load.py)

This file tests the DuckDB writer.

Code-wise, it checks exchange mapping, row conversion, schema creation, metrics writing, rerun stability, and reconciliation.

Logically, it proves the load layer writes the transformed data into the analytical store without duplicating or losing information.

#### [ETL_Analysis/tests/test_store.py](tests/test_store.py)

This file tests the read-only store layer.

Code-wise, it checks SQL safety, read-only opening, store reconstruction, venue derivation, run history, date bounds, and round-tripping rows back out of DuckDB.

Logically, it proves the dashboard and claims layers can query the store safely and consistently.

#### [ETL_Analysis/tests/test_charts.py](tests/test_charts.py)

This file tests the chart builders.

Code-wise, it checks palette choices, axis titles, label handling, comparison trimming, repair markers, volume annotations, and JSON serialisability.

Logically, it ensures the dashboard charts stay readable and that the visual language matches the business meaning.

#### [ETL_Analysis/tests/test_claims.py](tests/test_claims.py)

This file tests the claim generation logic.

Code-wise, it checks the SQL queries, the derived quarter context, claim wording, unsupported-claim behavior on thin stores, and markdown rendering.

Logically, it proves `claims.md` is generated from the store and not typed manually.

#### [ETL_Analysis/tests/test_dashboard.py](tests/test_dashboard.py)

This file tests the Streamlit app wiring.

Code-wise, it checks the summary helpers, command construction, widget availability, the run form, the claims tab text, and the pipeline launch path from the app.

Logically, it verifies the dashboard is actually usable as the read side of the analytics store.

#### [ETL_Analysis/tests/test_report.py](tests/test_report.py)

This file tests the legacy HTML report.

Code-wise, it checks report formatting, chart rendering, embedded JavaScript behavior, and the HTML document structure.

Logically, it preserves the older one-shot report path while still ensuring the report is self-contained and readable offline.

#### [ETL_Analysis/tests/test_symbols.py](tests/test_symbols.py)

This file tests symbol filtering and quota planning.

Code-wise, it checks venue filtering, exchange grouping, quota parsing, and the behavior of the bundled symbol universe file.

Logically, it keeps the live pull bounded and makes the symbol universe predictable.

#### [ETL_Analysis/tests/conftest.py](tests/conftest.py)

This file provides shared test fixtures.

Code-wise, it usually sets up reusable payloads, temporary stores, app helpers, or environment scaffolding.

Logically, it keeps the test files smaller and lets the suite share the same synthetic data setup.

## 2. How the pieces fit together

The runtime flow is:

1. `pipeline.py` chooses symbols and an extract function.
2. `extract_fixtures.py` or `extract_live.py` returns raw payload dictionaries.
3. `transform.py` cleans, repairs, quarantines, and derives measures.
4. `load.py` writes the results into DuckDB.
5. `store.py` reads the store back in read-only mode.
6. `charts.py`, `dashboard.py`, `report.py`, and `claims.py` present the analysis to a person.

That separation matters because it lets the tests isolate problems:

- if the raw payload is wrong, the extract tests fail
- if the cleaning decision is wrong, the transform tests fail
- if the database write is wrong, the load tests fail
- if the store cannot be read back, the store tests fail
- if the chart or report is misleading, the chart/report tests fail

## 3. Commands to run it

### Install dependencies

From the repository root:

```bash
pip install -r ETL_Analysis/requirements.txt
```

If you want to run the test suite, install pytest as part of that file or separately:

```bash
pip install pytest
```

### Run the pipeline

Offline, using fixtures:

```bash
python -m ETL_Analysis.pipeline
```

The default offline symbol set is the three fixture symbols:

- `RELIANCE.NS`
- `INFY.NS`
- `TATASTEEL.BO`

Run only one symbol:

```bash
python -m ETL_Analysis.pipeline --symbols RELIANCE.NS
```

Run against the live Fauxnance API:

```bash
python -m ETL_Analysis.pipeline --live
```

Run in strict mode, where everything questionable is quarantined instead of repaired:

```bash
python -m ETL_Analysis.pipeline --strict
```

Print to the console instead of loading DuckDB:

```bash
python -m ETL_Analysis.pipeline --print
```

Write to a different DuckDB file:

```bash
python -m ETL_Analysis.pipeline --db my.duckdb
```

Run the pipeline and regenerate the business claims:

```bash
python -m ETL_Analysis.pipeline --claims
```

Run the pipeline and open the dashboard afterwards:

```bash
python -m ETL_Analysis.pipeline --dashboard
```

Write the legacy standalone HTML report:

```bash
python -m ETL_Analysis.pipeline --legacy-report
```

Write the legacy report to a custom path:

```bash
python -m ETL_Analysis.pipeline --legacy-report out/run.html
```

Ask the pipeline to request a different candle interval:

```bash
python -m ETL_Analysis.pipeline --interval 1wk
```

List the bundled symbol universe:

```bash
python -m ETL_Analysis.pipeline --list-symbols
```

### Run the dashboard

Start the Streamlit app over the default store:

```bash
python -m ETL_Analysis.dashboard
```

Use a different DuckDB file:

```bash
python -m ETL_Analysis.dashboard --db my.duckdb
```

Serve on a different port:

```bash
python -m ETL_Analysis.dashboard --port 8600
```

Run without opening a browser:

```bash
python -m ETL_Analysis.dashboard --headless
```

If you need the raw Streamlit launcher, this also works:

```bash
python -m streamlit run ETL_Analysis/dashboard.py -- --db warehouse.duckdb
```

### Regenerate the claims document directly

```bash
python -m ETL_Analysis.claims
```

To regenerate it to a custom output path, use the claims CLI options described in `claims.py`.

### Run the tests

Run the whole sprint test suite:

```bash
pytest ETL_Analysis/tests -v
```

Or with the module runner:

```bash
python -m pytest ETL_Analysis/tests -v
```

Run just one area:

```bash
python -m pytest ETL_Analysis/tests/test_transform.py
python -m pytest ETL_Analysis/tests/test_load.py
python -m pytest ETL_Analysis/tests/test_store.py
python -m pytest ETL_Analysis/tests/test_charts.py
python -m pytest ETL_Analysis/tests/test_claims.py
python -m pytest ETL_Analysis/tests/test_dashboard.py
python -m pytest ETL_Analysis/tests/test_report.py
python -m pytest ETL_Analysis/tests/test_symbols.py
```

### Optional cleanup and inspection commands

If you want to clear the cached live payloads, remove the `.cache/` folder under `ETL_Analysis/`.

If you want to inspect the generated DuckDB store manually, open `warehouse.duckdb` with the dashboard or with your own DuckDB client.

## 4. What to remember when explaining this sprint

- The extract layer is allowed to touch the network; the transform layer is not.
- The transform decides what to quarantine and what to repair.
- The load layer writes to DuckDB and is the only writer.
- The store layer is read-only and is what the dashboard and claims use.
- `claims.md` is generated from the store, so it should not be edited by hand.
- The malformed fixture is intentionally broken so the tests can prove the transform handles real data-quality problems.

## 5. Recommended reading order

If you are presenting the sprint, read the files in this order:

1. [ETL_Analysis/README.md](README.md)
2. [ETL_Analysis/pipeline.py](pipeline.py)
3. [ETL_Analysis/transform.py](transform.py)
4. [ETL_Analysis/load.py](load.py)
5. [ETL_Analysis/store.py](store.py)
6. [ETL_Analysis/charts.py](charts.py)
7. [ETL_Analysis/dashboard.py](dashboard.py)
8. [ETL_Analysis/claims.py](claims.py)
9. [ETL_Analysis/tests/test_transform.py](tests/test_transform.py)

That order matches the data flow and makes the rest of the files easier to place.