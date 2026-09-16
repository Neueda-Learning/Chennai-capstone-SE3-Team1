# fact-trades — incremental load into FACT_TRADES

Moves every order that reached a terminal state out of the trade database
(`public.orders` + `public.order_history`) into a star schema under the
`analytics` schema of the same PostgreSQL database: `fact_trades` and its three
dimensions `dim_date`, `dim_instrument`, `dim_account`. The load is driven by a
watermark on `orders.created_at`, merges on `order_id`, and dead-letters any row
that fails a quality check instead of dropping it.

Needs the same things `scripts/apply_db.py` needs: `psql` and Python 3.8+. No
third-party packages (`pytest` to run the tests).

## The three pipeline commands

Each stage can be run on its own. Connection flags, `PG*`-style env vars and
`.env` work exactly as for `apply_db.py`.

```
# 1. schema — creates analytics.* (idempotent; tracked in schema_migrations as fact-trades/…)
python scripts/apply_db.py --analytics --migrations-only

# 2. dimensions — dim_date for the whole range, then dim_instrument, then dim_account
python fact-trades/load_fact_trades.py dims

# 3. facts — watermarked merge into fact_trades, dead-lettering failures
python fact-trades/load_fact_trades.py facts
```

`load_fact_trades.py all` runs 2 then 3. Useful flags on the facts stage:

```
--dry-run                 validate and report; write nothing
--since 2026-01-01        ignore the stored watermark and re-extract from here
--load-id my-run          stamp every row this run writes with a name you choose
```

Run the dimensions before the facts, every time. The fact stage refuses a row
whose instrument, client or date is not in its dimension and never inserts a
placeholder dimension row to make it pass — if you see every row dead-lettered
under `fk_instrument`, the dimension load was skipped.

## Generating orders to load

There is a simulator so you can exercise the pipeline without the REST API:

```
cd fact-trades && python -m simulate_orders              # 20 new orders
python fact-trades/simulate_orders.py --count 50         # the same from the repo root
python fact-trades/simulate_orders.py --bad-share 0      # only well-formed orders
python fact-trades/simulate_orders.py --dry-run          # print the SQL, write nothing
```

Every run creates brand-new orders — uuid4 ids, unique idempotency keys,
`created_at` continuing after the newest order already there — so runs never
collide and each one is picked up by the next `facts` load. Each order gets its
`orders` row and its `order_history` trail (`CREATED -> NEW`, then the terminal
event), the way the platform writes them.

The default mix per run is roughly 60% `FILLED`, 15% `REJECTED` (with a
failure code), 10% `CANCELLED`, 5% still `NEW`, and 15% *bad*: rows that pass
the database's own constraints and only the load's checks can catch —

| kind | what it is | what clears it |
|---|---|---|
| `late_creation` | terminal event stamped before the order was created | nothing; a real fault |
| `unknown_instrument` | order on a symbol listed after the last `dims` run | `dims`, then `facts --since …` |
| `unknown_client` | order from a client created after the last `dims` run | `dims`, then `facts --since …` |

The summary it prints tells you what to expect from the next load.

## Layout

```
fact-trades/
  migrations/
    001_analytics_dimensions.sql   analytics schema, dim_date, dim_instrument, dim_account
    002_fact_trades.sql            fact_trades, dead_letter_trades, load_watermark
  transform.py                     the row checks; pure functions, no database
  simulate_orders.py               writes new good / failed / bad orders to load
  load_fact_trades.py              the dims / facts / all stages
  tests/                           python -m pytest fact-trades/tests
```

## What lands in fact_trades

One row per order, at the grain of the order, for every order whose newest
`order_history` event has `new_status` in `FILLED`, `REJECTED`, `CANCELLED`.
Orders still `NEW` are not trades yet and are skipped until they become one.

Rejected and cancelled orders are loaded deliberately: fill rate is
`FILLED / all terminal orders`, and the denominator has to be in the table.

| column | source |
|---|---|
| `date_key`, `instrument_key`, `account_key` | resolved from the dimensions by `orders.created_at`, `instrument_id`, `client_id` |
| `order_id`, `idempotency_key`, `order_type`, `side`, `quantity`, `price`, `executed_price` | `orders` |
| `status`, `terminal_at`, `failure_code`, `failure_reason` | the terminal `order_history` row |
| `trade_value` | recomputed: `quantity * coalesce(executed_price, price)`; a CHECK on the table re-verifies it |
| `order_created_at` | `orders.created_at` — the watermark column |
| `load_id`, `loaded_at`, `updated_at` | this load |

## How a load runs

1. Read `analytics.load_watermark.last_watermark` for `fact_trades`.
2. Extract, as JSON so nulls and types survive, every terminal order with
   `orders.created_at > watermark`, oldest first.
3. Read the natural keys currently in the three dimensions.
4. Run every check on every row in Python (`transform.validate_row`). The
   first failing check wins. A row that fails becomes an `INSERT` into
   `dead_letter_trades` with `check_name`, `reason`, `load_id` and the whole
   source row as JSONB; a row that passes becomes an
   `INSERT … ON CONFLICT (order_id) DO UPDATE`.
5. Run all of those plus the watermark update as one `psql` transaction, so
   either everything from this run lands or nothing does.

### The checks, in order

| check | fails when |
|---|---|
| `invalid_order_id` | `order_id` missing or not a UUID |
| `null_<field>` / `type_<field>` | a required field is null, blank, non-numeric, non-integer or not a timestamp |
| `fk_instrument`, `fk_account`, `fk_date` | the key is not in `dim_instrument` / `dim_account` / `dim_date` |
| `valid_order_type`, `valid_side`, `valid_status` | outside `POSITION/HOLDING`, `BUY/SELL`, `FILLED/REJECTED/CANCELLED` |
| `positive_quantity`, `positive_price`, `positive_executed_price` | `<= 0` |
| `filled_has_executed_price` | `FILLED` with no `executed_price` |
| `trade_value_recomputes` | the recomputed value is not positive |
| `terminal_after_created` | the terminal event is timestamped before the order was created |

### Idempotence

- A second run with no new orders extracts nothing and writes nothing.
- A forced replay (`--since`) over rows already loaded updates them in place;
  `uq_fact_trades_order_id` makes a duplicate impossible.
- The dimension loads are upserts on their natural keys and can be re-run any
  time; `dim_date` only ever adds days.

### Watermark and dead-lettered rows

The watermark advances to the newest `created_at` **extracted**, including
rows that were dead-lettered. Otherwise a bad row would be re-extracted and
re-quarantined on every run. Once the cause is fixed, replay the window:

```
python fact-trades/load_fact_trades.py facts --since '2026-01-05 00:00:00'
```

and the row merges in. The dead-letter row stays as a record of what happened.

## Decisions recorded here

**Source is `order_history`, not `orders.status`.** The team's model is that
an order's terminal state is the last `order_history` event; the row in
`orders` is joined only for the order's own fields. The two agree in healthy
data, and if they ever disagree the history is the audit trail we trust.

**Watermark on `orders.created_at`, as the story asks.** The consequence: an
order created before the watermark that reaches a terminal state *after* it is
only picked up if created after the previous run's newest order. In practice an
order is created before it fills, so a run that sees the creation usually sees
the fill too; when it does not (a long-lived `NEW` order that fills days later)
the row is picked up on `--since` replay. If that becomes routine the watermark
should move to `order_history.event_timestamp`; the schema already carries
`terminal_at` for it.

**Separate `analytics` schema in the same database**, not a second database
and not DuckDB. It keeps the load a single-server transaction and lets the
existing `apply_db.py` ledger track the DDL.

**No third-party driver.** The loader goes through the same `psql`-based
`DbConfig` as every other script in this repo, so it runs wherever they run.

## Something this found on the first run

Against a database seeded from `seed/`, every seeded order was dead-lettered
under `terminal_after_created`: `050_orders.csv` carried no `created_at`, so the
orders were stamped with the seed time while `060_order_history.csv` said they
had filled on 2026-01-05 — months earlier. The quarantine table is what made
that visible; a loader that dropped bad rows would have reported a clean run
over an empty fact table.

Fixed in `make_seed.py`: `order_timestamps()` is now the single clock both
builders read, so an order's `created_at` is by construction the timestamp of
its own `CREATED` event and the two files cannot drift again. The seeded data
now loads with no dead letters, and `fill_rate` over it comes out at 85.7%.

## Tests

```
python -m pytest fact-trades/tests
```

`test_transform.py` needs no database and covers nulls, type mismatches and
every contract check. `test_load.py` builds its own `trading_platform_test_facts`
database with the analytics migrations and drops it afterwards; it skips
cleanly if no PostgreSQL server is reachable. It covers the four paths the
story names: an incremental load populates `fact_trades`; a second load with no
new data adds no rows; an invalid row is dead-lettered with its reason and the
load continues; and a skipped dimension load is caught rather than papered over.
