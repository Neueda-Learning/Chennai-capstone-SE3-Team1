# Team 1 Trade Database Guide

This document explains the Team 1 PostgreSQL trade database sprint-1 task

## Setup

From the repository root, make sure you have:

- PostgreSQL server and `psql`
- Python 3.8 or newer
- the repository `.env` settings if you want to override the defaults

If you want the unattended Docker path, start Postgres with:

```bash
docker compose -f infra/postgres/docker-compose.yml up -d
```

For the script-driven path, the usual bootstrap sequence is:

```bash
python scripts/apply_db.py
python scripts/verify_db.py
python -m pytest tests/
```

If `psql` is not on `PATH`, the Python scripts look for the PostgreSQL client in the standard Windows install locations or honor `PSQL_BIN`.

The implementation is split across four layers:

- schema definition in `migrations/`
- database bootstrap and validation in `scripts/`
- local container bootstrap in `infra/postgres/`
- verification and design documents in `tests/` and `docs/`

The key idea is that the database is the source of truth for the trading platform. Sprint 6 writes orders into it, Sprint 7 settles against it, and Sprint 9 reads it back.

## 1. What each file does

### Root overview

#### [README.md](../README.md)

This is the top-level entry point for the sprint.

Code-wise, it describes the project layout, the main scripts, and the tests that prove the schema behaves correctly.

- `migrations/` defines the schema in numbered SQL files
- `seed/` holds the CSV data loaded after the schema exists
- `scripts/apply_db.py` builds a database from scratch
- `scripts/verify_db.py` checks the behavioral rules
- `tests/` keeps the schema aligned with the entities and seed data
- `infra/postgres/` starts the database unattended in Docker

### Schema files

#### `migrations/000_migration_ledger.sql`

This is the bootstrap migration.

Code-wise, it creates the `schema_migrations` ledger table that records which migration files have already been applied and their checksums.

Logically, this table is what lets the apply script be idempotent. Without it, the script would not know whether a file had already been run or whether someone edited an old migration after the fact.

#### `migrations/001_bank_account.sql`

This creates the external funding account table.

Code-wise, it defines:

- `account_number` as the primary key
- `client_id` as a foreign-key-bearing reference to the owning client
- monetary and contact columns
- checks for non-negative balances and non-blank account numbers

Logically, this table is the bank-side identity for the customer. It is separate from `clients`, because the platform has both the customer-facing account reference and the internal client row.

#### `migrations/002_clients.sql`

This creates the internal client table and the account-state rules.

Code-wise, it defines:

- `client_id` as a generated primary key
- `account_number` as a reference back to `bank_account`
- `account_state` constrained to `ACTIVE`, `SUSPENDED`, or `CLOSED`
- `wallet_balance` constrained to be non-negative
- indexes on `account_number` and `account_state`
- triggers that prevent delete and prevent reopening a closed account

Logically, this is where the sprint enforces the business lifecycle:

- `ACTIVE` accounts can trade
- `SUSPENDED` accounts are reversible
- `CLOSED` accounts are terminal and cannot be deleted

The foreign-key cycle between `clients` and `bank_account` is deliberate. The bank account foreign key is marked `DEFERRABLE INITIALLY DEFERRED`, so both tables can be loaded in one transaction during seed loading.

#### `migrations/003_auth.sql`

This creates the authentication row keyed by email.

Code-wise, it defines:

- `email` as the primary key and foreign key to `clients(email)`
- `password_hash`, timestamps, and `version`
- checks for a non-blank password hash, non-negative version, and non-decreasing timestamps

Logically, this table carries optimistic concurrency control through `version`. The application reads a version, updates with `WHERE version = <read value>`, and treats rowcount 0 as a lost update.

#### `migrations/004_instruments.sql`

This defines tradable instruments.

Code-wise, it uses the instrument symbol itself as the primary key, makes the human-readable name unique, adds an `active` flag, and prevents deletes through a trigger.

Logically, an instrument that stops trading is never removed. It is marked inactive so historical orders still resolve against the original row.

#### `migrations/005_orders.sql`

This is the main order table.

Code-wise, it defines:

- `order_id` as a UUID primary key
- foreign keys to `clients` and `instruments`
- `account_id`, `order_type`, `side`, `quantity`, `price`, `executed_price`, `status`, `idempotency_key`, `external_order_id`, timestamps
- a unique constraint on `idempotency_key`
- checks for allowed order types, sides, statuses, positive quantity and price, valid executed price, and timestamp order
- indexes on the lookup columns used by the common queries

Logically, this table records the order when it is received, not just when it finishes. The `status` column carries the current lifecycle state, and `executed_price` is separate from `price` because fills can happen at a different price than the request.

The unique idempotency key is the concurrency-safe duplicate guard. It replaces a read-then-write check with a database guarantee, which is the only reliable way to stop two concurrent requests from both slipping through.

#### `migrations/006_order_history.sql`

This is the audit trail for order lifecycle changes.

Code-wise, it stores one row per status transition and keeps the event identity in `history_id`. It also indexes by `order_id` and by `new_status`.

Logically, this is the history that was not present in the older terminal-table design. It lets the system answer “how did this order get here?” instead of only “what state is it in now?”.

#### `migrations/007_portfolio.sql`

This defines the two portfolio books.

Code-wise, it creates:

- `portfolio_holding`
- `portfolio_positions`

Both tables carry the same core shape: client, instrument, quantity, price per unit, overall gains, timestamps, a uniqueness rule for the client/instrument pair, and indexes on client and instrument.

Logically, the two tables split delivery holdings from intraday positions so the application can treat them differently without adding a flag to every portfolio query.

#### `migrations/008_maintenance.sql`

This adds `fn_resync_sequences()`.

Code-wise, the function walks the database, finds serial or identity columns, computes the current maximum value in each table, and advances the associated sequence to match.

Logically, it prevents seeded or replayed data from leaving sequences behind the real row ids. That matters after loading CSVs or rebuilding tables.

#### `migrations/009_clients_version_and_order_uuid.sql`

This extends `clients` with `version` and `updated_on`.

Code-wise, it adds a version counter and a timestamp column.

Logically, `version` supports optimistic concurrency on client-side balance or profile updates, so the second writer can detect that it lost.

### Script layer

#### [scripts/db_config.py](../scripts/db_config.py)

This file centralizes connection handling.

Code-wise, it resolves connection values from three places, in this order:

1. CLI flags
2. environment variables
3. `.env`

If none are supplied, it falls back to the built-in defaults:

- host `localhost`
- port `5432`
- database `trading_platform`
- user `postgres`
- password `postgres`

It also finds `psql`, builds safe shell commands, and exposes helpers for running SQL, files, and scripts.

Logically, this keeps the rest of the tooling simple. Every script can ask for a database connection without duplicating environment parsing or path discovery.

#### [scripts/apply_db.py](../scripts/apply_db.py)

This is the one-command database builder.

Code-wise, it:

- resolves the target database from CLI flags, environment, or `.env`
- checks whether PostgreSQL is reachable before doing anything else
- creates the database if needed
- bootstraps the migration ledger from `000_migration_ledger.sql`
- applies every `migrations/*.sql` file in filename order
- records checksums in `schema_migrations`
- refuses to continue if an already-applied migration changed on disk, unless `--allow-modified` is passed
- validates each seed file before loading it
- generates a temporary seed-loading script that uses `\copy` inside one transaction
- resyncs sequences after the seed load

Logically, this script is the safest path from an empty database to a working database. It fails early, stops on the first SQL error, and avoids the partial-state problems that come from loading files manually one at a time.

The apply script also supports a few operational modes:

- `--reset` drops and rebuilds the database
- `--migrations-only` applies schema without seed data
- `--seed-only` loads seed data without migrations
- `--reseed` truncates and reloads seed data
- `--analytics` also applies the analytics migrations under `fact-trades/migrations/`
- `--dry-run` prints what would happen without changing anything

#### [scripts/queries.sql](../scripts/queries.sql)

This file contains the six named queries from the sprint brief.

Code-wise, it is plain SQL with placeholders for the runtime parameters:

- `:client_id`
- `:since_timestamp`
- `:account_number_reference`

Logically, the file is the canonical query set used in the index justification document. It is how the team proves the schema supports the expected reads.

#### [scripts/indexes.md](../scripts/indexes.md)

This is the index justification write-up.

Code-wise, it records the `EXPLAIN ANALYZE` plans before and after each index decision.

Logically, it explains why each index exists, what query it serves, what the write cost is, and which query shapes already work because of an existing primary key or unique key.

#### [scripts/DESIGN.md](../scripts/DESIGN.md)

This is the historical-trade-data design note.

Code-wise, it documents the retention grain, population path, incremental extraction strategy, growth behavior, and operational cost.

Logically, it is the design answer for what should be kept beyond the order row itself, and how a downstream system should extract it efficiently.

#### [scripts/make_seed.py](../scripts/make_seed.py)

This script is the seed generator and validator.

Code-wise, it defines the deterministic data set that populates `seed/`, and it can check whether the checked-in CSVs still match the generated version.

Logically, it guarantees the seed data stays aligned with the schema and includes the edge cases the sprint needs:

- all three account states
- an almost-empty account
- a delisted instrument
- the four order lifecycle states
- holdings and positions that reconcile to the filled orders

### Infrastructure layer

#### [infra/README.md](../infra/README.md)

This describes the local Docker stack.

Code-wise, it documents the Postgres and Kafka compose files, their health checks, and the commands to start or reset the stack.

Logically, it is the runbook for a teammate who wants to bring up the environment exactly the way the platform expects it.

#### [infra/postgres/docker-compose.yml](../infra/postgres/docker-compose.yml)

This composes the Postgres service used by the sprint.

Code-wise, it:

- runs `postgres:17`
- exposes the database on port 5432
- mounts the repo migrations and seed folders read-only into the container
- mounts the init scripts under `/docker-entrypoint-initdb.d`
- waits for both Postgres readiness and the `schema_migrations` table before reporting healthy

Logically, this means `docker compose up -d` is enough to get a fully initialized database without a manual post-start step.

#### [infra/postgres/initdb/10-apply-migrations-and-seed.sh](../infra/postgres/initdb/10-apply-migrations-and-seed.sh)

This is the Docker init script that performs the same bootstrap as the Python apply command.

Code-wise, it:

- runs `psql` with `ON_ERROR_STOP=1`
- applies every `.sql` migration in `/migrations`
- records the checksum for each migration in `schema_migrations`
- loads every `.csv` file in `/seed` in one transaction
- resyncs sequences after loading

Logically, it exists so that a fresh container starts in the ready state without anyone logging in and typing SQL by hand.

### Verification layer

#### [tests/test_migrations.py](../tests/test_migrations.py)

This file tests migration behavior and seed loading rules.

Code-wise, it checks that:

- migrations exist and are numbered correctly
- each migration is wrapped in a single transaction
- migrations build the expected tables
- running the migration pass twice is safe
- edited migrations are refused unless explicitly allowed
- a failing migration leaves nothing behind
- the seed data matches the generator
- the seed loader respects foreign-key deferral and transaction boundaries

Logically, this is the safety net that proves the migration and seed process actually behaves like the sprint brief says it should.

#### [tests/test_schema_parity.py](../tests/test_schema_parity.py)

This file checks the database against the domain entities.

Code-wise, it verifies that:

- every entity field has a matching column
- every table column maps back to an entity field
- check-constraint vocabularies match the Java enums
- the main behavioral checks still pass

Logically, this keeps the database schema and the Java domain model from drifting apart.

### Design and diagram layer

#### [docs/erd.md](erd.md)

This is the entity relationship diagram and schema explanation.

Code-wise, it renders the table relationships in Mermaid and explains why the foreign keys, triggers, and table split are shaped the way they are.

Logically, it is the best place to understand the data model before reading the migrations line by line.

## 2. How the pieces work together

The build flow is:

1. `apply_db.py` or the Docker init script finds the migrations in filename order.
2. `000_migration_ledger.sql` creates `schema_migrations`.
3. The remaining migrations create the core tables and constraints.
4. The seed loader validates all CSV headers and row widths before inserting anything.
5. Seed data is loaded in a single transaction.
6. `fn_resync_sequences()` advances all sequences beyond the imported ids.

That flow is what makes the database reproducible from a clean slate.

The important design choices are:

- use database constraints for domain rules, not application guesses
- keep order state in one row and history in another
- keep closed accounts and inactive instruments in place rather than deleting them
- use exact numeric types for money and quantities
- use a unique idempotency key to make duplicate order submission safe
- use a version column for optimistic concurrency where the domain needs it

## 3. Commands to run it

### From the repository root

Create or rebuild the database, then load the seed data:

```bash
python scripts/apply_db.py
```

Rebuild from scratch:

```bash
python scripts/apply_db.py --reset
```

Apply only the migrations:

```bash
python scripts/apply_db.py --migrations-only
```

Load only the seed data into an already-migrated database:

```bash
python scripts/apply_db.py --seed-only
```

Reload seed data after truncating the seeded tables:

```bash
python scripts/apply_db.py --reseed
```

Include the analytics migrations as well:

```bash
python scripts/apply_db.py --analytics
```

Print what would happen without changing anything:

```bash
python scripts/apply_db.py --dry-run
```

Run the database verification script:

```bash
python scripts/verify_db.py
```

Run the migration and schema tests:

```bash
python -m pytest tests/
```

Run only the migration-focused tests:

```bash
python -m pytest tests/test_migrations.py
```

Run only the schema-parity tests:

```bash
python -m pytest tests/test_schema_parity.py
```

Check that the generated seed data still matches the CSV files:

```bash
python scripts/make_seed.py --check
```

### With Docker

Start the Postgres container and let it bootstrap itself:

```bash
docker compose -f infra/postgres/docker-compose.yml up -d
```

If you prefer to run from inside the folder:

```bash
cd infra/postgres
docker compose up -d
```

Stop or reset the database container:

```bash
docker compose -f infra/postgres/docker-compose.yml down -v
docker compose -f infra/postgres/docker-compose.yml up -d
```

### Manual PostgreSQL fallback

If you need to reproduce the migration sequence manually, apply the files in order and force `psql` to stop on the first error:

```bash
psql -v ON_ERROR_STOP=1 -f migrations/000_migration_ledger.sql
psql -v ON_ERROR_STOP=1 -f migrations/001_bank_account.sql
psql -v ON_ERROR_STOP=1 -f migrations/002_clients.sql
psql -v ON_ERROR_STOP=1 -f migrations/003_auth.sql
psql -v ON_ERROR_STOP=1 -f migrations/004_instruments.sql
psql -v ON_ERROR_STOP=1 -f migrations/005_orders.sql
psql -v ON_ERROR_STOP=1 -f migrations/006_order_history.sql
psql -v ON_ERROR_STOP=1 -f migrations/007_portfolio.sql
psql -v ON_ERROR_STOP=1 -f migrations/008_maintenance.sql
psql -v ON_ERROR_STOP=1 -f migrations/009_clients_version_and_order_uuid.sql
```

Then load the seed CSVs in order.

## 4. Environment and connection behavior

The scripts read connection settings from the command line first, then the environment, then `.env`, then defaults.

The important variables are:

- `POSTGRES_HOST`
- `POSTGRES_PORT`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `PSQL_BIN`

If `psql` is not on `PATH`, the scripts try the standard Windows PostgreSQL installation locations. That makes the sprint usable on a plain Windows machine without extra shell setup.

## 5. What to read first if you are explaining it to someone else

If you need to present the sprint quickly, read these in order:

1. [README.md](../README.md)
2. [docs/erd.md](erd.md)
3. [scripts/apply_db.py](../scripts/apply_db.py)
4. `migrations/002_clients.sql`
5. `migrations/005_orders.sql`
6. [scripts/indexes.md](../scripts/indexes.md)
7. [scripts/DESIGN.md](../scripts/DESIGN.md)

That order gives the model, the lifecycle, the command flow, and the justification documents without jumping around.