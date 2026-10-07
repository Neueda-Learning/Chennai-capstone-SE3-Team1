# Team 1 — Trade Database (PostgreSQL)

SEC3-91 / SEC3-94 / SEC3-95

PostgreSQL schema for the trading platform, built from numbered migration files,
with a script to apply them and load seed data, and a test suite that checks the
result.

The schema mirrors the domain entities in `sprint-05-domain-engine` — one table
per entity class, one column per field. `verify_db.py` reads those Java classes
and fails if the two ever drift apart. See [docs/erd.md](docs/erd.md).

## Setup

Needs PostgreSQL (server + `psql`) and Python 3.8+. No third-party packages,
except `pytest` if you want to run the test suite.

```
python scripts/apply_db.py      # create the database, migrate, seed
python scripts/verify_db.py     # run the checks
python -m pytest tests/         # run the migration test suite
```

The connection settings come from the TrustMe vault (see below); a CLI flag
(`--host`, `--password`, ...) overrides any of them for one run.

If `psql` is not on `PATH` the scripts look in
`C:\Program Files\PostgreSQL\<version>\bin`, or set the `PSQL_BIN` environment variable.

## Configuration and secrets

Every secret and connection detail comes from the TrustMe vault
(`leapcapstoneteam1-720d03.TM`). There are no `.env` files for them and no
environment-variable fallbacks, so there is one place a value can live and one
place it can be wrong.

| TrustMe secret | Used for | Read by |
|---|---|---|
| `PostGres_Host`, `Postgres_Port`, `Postgres_DB`, `PostGres_User`, `PostGres` | the database connection | Trade API, executor, auth service, `scripts/*.py` |
| `JWT_SECRET` | signing and verifying access tokens (HS256, 32+ characters) | Trade API, executor, auth service |
| `Fauxnance`, `Fauxnance_Endpoint` | the market-data API key and base URL | executor (quotes), Trade API (daily candles), `ETL_Analysis/` |
| `AUTH_PRIVATE_KEY` | RSA private key (PKCS#8 PEM, `\n` for line breaks) that opens encrypted login and registration bodies; a temporary key is generated if absent | auth service |

Everything else is a plain value in code or in `application.properties` / `application.yml`
(ports, the JWT issuer, the currency, the SMTP port and TLS mode, the `.NS` symbol suffix, the
poll interval). The only environment variables still read are `KAFKA_BOOTSTRAP_SERVERS` and
`KAFKA_BROKER` (where Kafka is: `localhost` on a laptop, another host with
`run-local.ps1 -KafkaHosted`), `NODE_ENV` (set by the runtime), and `PSQL_BIN` (where `psql` is).

To add or change a secret, do it in TrustMe; nothing in the repo needs to change.

## Layout

```
migrations/      numbered .sql files, the only definition of the schema
seed/            CSV data, loaded in filename order
scripts/         apply_db.py, verify_db.py, make_seed.py, create_test_account.py, db_config.py
tests/           pytest suite over the migrations, seed and schema parity
docs/            ERD and order lifecycle diagrams
infra/postgres/  docker compose setup
legacy/          the original single-file schema
```

## migrations/

The number is the order.

| File | Contents |
|---|---|
| `000_migration_ledger.sql` | `schema_migrations` tracking table |
| `001_bank_account.sql` | funding account |
| `002_clients.sql` | clients, wallet balance, account state rules |
| `003_auth.sql` | credentials, `version` for optimistic concurrency (dropped in 014) |
| `004_instruments.sql` | instruments keyed by symbol, delisting |
| `005_orders.sql` | orders, `order_type`, `side`, idempotency key |
| `006_order_history.sql` | audit trail of order status changes |
| `007_portfolio.sql` | `portfolio_holding` and `portfolio_positions` |
| `008_maintenance.sql` | `fn_resync_sequences()` |
| `009_clients_version_and_order_uuid.sql` | `clients.version`, `orders.uuid` |
| `010_terminal_orders_move_to_history.sql` | terminal orders archived to history |
| `011_credential_argon2.sql` | `auth.params_version` for argon2 cost upgrades |
| `012_auth_service_tables.sql` | `users` + `refresh_tokens` for the Sprint 8 auth service |
| `013_unique_user_per_account.sql` | one user per trading account |
| `014_users_replace_auth.sql` | drops `auth`; `users` gains `email`, `account_id` becomes nullable until a bank account is linked |
| `015_clients_drop_account_number.sql` | drops `clients.account_number`; `bank_account.client_id` (unique, checked immediately) is the only link |
| `016_wallet_transfers.sql` | `wallet_transfers`: every movement between a wallet and its linked bank account, idempotency key unique |
| `017_bank_account_unclaimed.sql` | `bank_account.client_id` nullable: bank accounts exist unclaimed until onboarding claims one |
| `018_users_to_auth_db_schema.sql` | `users` and `refresh_tokens` move to a new `auth_db` schema; default `search_path` extended so unqualified references still resolve |
| `019_bank_account_drop_contact.sql` | drops `bank_account.phone` and `.email`: an unclaimed or claimed bank account is never a contact record |
| `020_bank_account_drop_name.sql` | drops `bank_account.name`: `client_id` is the only identity a bank account needs, joining to `clients` gets the name once one is linked |
| `021_users_owns_email_and_phone.sql` | adds `users.phone`; drops `clients.email` and `.phone` — `auth_db.users` becomes the single stored copy of both contact fields |
| `022_otp_verification.sql` | `users.status` (PENDING/ACTIVE) and `auth_db.otp_codes`: emailed one-time codes for registration and password reset |
| `023_market_quotes.sql` | `market_quotes`: a rolling window of the polled quotes the Trade API keeps for the market screen and its charts |
| `024_daily_candles.sql` | `daily_candles` + `daily_candle_syncs`: a year of end-of-day history per instrument, fetched from Fauxnance once a day, for the long-range charts |

Running `psql -f` over these in order rebuilds the database without the Python
scripts.

Do not edit a migration once it has been applied — add `009_`, `010_` instead,
since other people already have databases with data in them. `apply_db.py`
stores a sha256 of each file it applies and stops if one changed.

## scripts/apply_db.py

```
python scripts/apply_db.py                  # create db if needed, migrate, seed
python scripts/apply_db.py --reset          # drop the database and rebuild
python scripts/apply_db.py --reseed         # reload seed data
python scripts/apply_db.py --migrations-only
python scripts/apply_db.py --seed-only
python scripts/apply_db.py --dry-run
```

- Creates the database if it does not exist.
- Applies `migrations/*.sql` in filename order via `psql -v ON_ERROR_STOP=1`, so
  a failing migration stops the run instead of exiting zero.
- Records applied files in `schema_migrations` and skips them next time, so
  re-running is a no-op.
- Aborts if a migration changed after it was applied (`--allow-modified` to
  re-record, `--reset` to rebuild).
- Loads `seed/*.csv` in filename order inside one transaction, so a bad file
  leaves nothing half-loaded. `clients` loads before `bank_account`, whose
  `client_id` foreign key is checked at insert.
- Validates every seed file before loading any of it — unknown column, duplicate
  column, blank line, wrong field count, each reported with file and line. Type
  and constraint errors roll the whole load back. Bad rows are never skipped.
- Resyncs sequences past the seeded ids.

Seed files are named `NNN_<table>.csv`. The header row is the column list, so a
file only supplies the columns it has and the rest take their defaults. An
unquoted empty field is `NULL`.

Every seeded user (`aarav.mehta`, `diya.sharma`, ...) signs in with the password
`Pass@word123456`; `seed/030_users.csv` carries its argon2id hash. Test data only.

## scripts/create_test_account.py

Writes a ready-to-sign-in account straight to the database, so nothing is emailed and no
one-time code is needed. Test data only.

```
python scripts/create_test_account.py                   # test.trader / TestTrader#2026!
python scripts/create_test_account.py --no-sample-data  # just the login, account and bank
python scripts/create_test_account.py --seed-quotes     # also a synthetic 3 hour price history
```

It is idempotent: running it again resets that account's activity and password. Connection
settings resolve as in `apply_db.py`. The password is hashed with the auth service's own argon2
parameters (it calls node from `services/team1-nestjs`, so run `npm ci` there first).
`--seed-quotes` replaces everything in `market_quotes`, so use it only where the poller is not
running.

## scripts/verify_db.py

```
python scripts/verify_db.py
python scripts/verify_db.py -v
python scripts/verify_db.py --only C
```

62 checks in four sections: structure, constraints, behaviour, data consistency.
Anything that writes runs inside `BEGIN`/`ROLLBACK`, so the database is unchanged
afterwards.

Two of them read the Java source rather than a hard-coded list. `A05` parses
every entity class and fails if a table has a column no field maps to, or a
field with no column. `B02` parses `OrderStatus`, `OrderType`, `OrderSide` and
`AccountStatus` and fails if a `CHECK` constraint's vocabulary differs from the
enum it stands for. Between them, the schema cannot drift from the entities
without a test going red.

Behavioural checks assert on SQLSTATEs — a duplicate idempotency key must raise
`23505`, a `FILLED` order with no executed price must be refused, a stale
credential writer must get rowcount 0.

Section D rebuilds both portfolio books by replaying the filled orders read back
from the database and compares them against the stored rows.

## tests/

```
python -m pytest tests/          # migrations, seed and schema parity
python -m pytest                 # the above plus the ETL_Analysis suite
```

Creates and drops its own `trading_platform_test` database, so your working
database is never touched. Set `TEST_DBNAME` to use a different name. The whole
suite skips cleanly if no PostgreSQL server is reachable.

What it covers beyond `verify_db.py`:

- every migration is numbered, unique and wrapped in a single transaction
- migrations apply to an empty database and create exactly the expected tables
- applying twice applies nothing the second time
- a migration edited after it was applied is refused, and `--allow-modified`
  re-records it
- a failing migration leaves nothing behind
- `--dry-run` creates no database
- `seed/` matches what `make_seed.py` generates, with no stray files
- seed row counts in the database match the CSV files
- a seed file with an unknown column or a short row is rejected, with the line
- reseeding is stable
- `fk_bank_account_client` is checked at insert, and `clients` references nothing in `bank_account`

## scripts/make_seed.py

```
python scripts/make_seed.py           # rewrite seed/
python scripts/make_seed.py --check   # fail if seed/ is out of date
python scripts/make_seed.py --prune   # also delete .csv files it does not generate
```

The dataset is fixed in the script, so output is deterministic. Portfolio rows
are computed by replaying the filled orders through `apply_fill()` rather than
typed in, so they always match the orders.

Covers all three client states, a delisted instrument with orders against it,
all four order statuses, both order types, an intraday short, and a position
squared off to zero.

`--check` also fails on a `.csv` in `seed/` that the script does not generate,
because `apply_db.py` would still load it.

## infra/postgres/

```
cd infra/postgres && docker compose up -d
```

Brings up Postgres with the migrations applied and seed data loaded.
`migrations/` and `seed/` are mounted from the repo rather than copied into an
image. The healthcheck waits for the schema, so `depends_on: service_healthy`
means the database is ready.

Not run against Docker — there is no Docker on the machine this was written on.
The init script itself was run against a local PostgreSQL 17 and produced a
database that passes all 62 checks.

## Notes

Money uses `DECIMAL(18,2)` for cash and `DECIMAL(18,4)` for prices and
quantities. A check asserts there is no `real`, `double precision` or `money`
column.

Idempotency is a `UNIQUE` constraint, not a read-then-write.

Optimistic concurrency on `auth.version`: read the version, then
`UPDATE ... WHERE version = <value read>`. Rowcount 0 means you lost. This sits
on `auth` rather than `bank_account` because `Auth` is the entity that carries a
`version` field and `changePassword()` increments it.

Instruments are keyed by their symbol (`RELIANCE`, `TCS`), because
`Instrument.instrumentId` is a `String`.

Nothing is deleted. Clients go to `CLOSED`, instruments to `active = FALSE`,
both enforced by triggers, and `CLOSED` is one-way.

An order's history lives in `order_history`, one row per status change. There is
no settlement queue and no terminal-state table: `orders.status` carries the
current state and `order_history` carries how it got there.

Settlement is application-layer work. The database decides which book a fill
belongs in (`orders.order_type`) and keeps the two books separate, but does not
move fills into them.

See [docs/erd.md](docs/erd.md) for the ERD and the details.
