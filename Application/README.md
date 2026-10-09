# Application — Restructured Layout

This tree is a pure relocation of the repository's component directories into the
baseline shape below. No service was rewritten to move here: `git log --follow`
on any file still shows its full history, and the complete old → new list is
reproducible at any time with:

```bash
git diff --name-status --find-renames=40% origin/feat/email-otp-verification restructuring
```

(577 renames, 0 content changes at the move commits; reference updates and
derived artifacts came as separate follow-up commits on the same branch.)

## Where everything went, by module

### Frontend — serves :4200
| Was | Now |
|---|---|
| `sprint-09-trading-ui/` (everything: `src/`, `e2e/`, `openapi-generator/`, `package.json`) | `Frontend/frontend-app/` |

### Services
| Was | Now | Notes |
|---|---|---|
| `services/team1-nestjs/` | `Services/auth-service/` | Real auth service, :3000 |
| `sprint-06-api/` (incl. `Dockerfile`, `pom.xml`, `src/`) | `Services/order-service/` | Trade REST API, :8081 locally (`:8080` container mapping, unchanged) |
| `executor/` | `Services/executor-service/` | Trade executor + market-data poller, :8082 |
| `sprint-05-domain-engine/` | `Services/libs/domain-engine/` | Shared framework-free domain library both Java services install from source |
| `sprint-07/eventbus/` | `Services/libs/eventbus/` | Shared Kafka `Envelope` library |
| `services/auth-stub/` | `Services/auth-stub/` | Dev-only JWT stub (:4000), kept for local testing; `run-local.ps1` no longer starts it |

### Infrastructure — Kafka
| Was | Now |
|---|---|
| `infra/kafka/docker-compose.yml`, `infra/kafka/up.sh` | `Infrastructure/Kafka/` (same names) |
| `infra/kafka/create-topics.sh` | `Infrastructure/Kafka/scripts/create-topics.sh` |

`infra/postgres/` stays at the repo root (out of baseline scope, still referenced by `run-local.ps1`).

### Databases
| Was | Now |
|---|---|
| `migrations/000–024_*.sql` | `Databases/PostgreSQL/migrations/` (untouched — migrations are append-only) |
| `seed/010–040_*.csv` | `Databases/PostgreSQL/seeds/` (same files) |
| — (new, derived) | `Databases/PostgreSQL/schema.sql` — `pg_dump --schema-only` of a pristine `apply_db --reset` build, restore-validated |
| — (new, derived) | `Databases/PostgreSQL/seed_data.sql` — `--data-only` dump of the 4 seeded tables (6/12/6/8 rows, matches the CSVs) |
| — (new, derived) | `Databases/DuckDB/analytics/schema.sql` — the applied warehouse DDL consolidated in one file: `etl-trades` star schema + `etl-live` price store, each section source-marked |

### ETL layer
| Was | Now |
|---|---|
| `fact-trades/` (loader, `simulate_orders.py`, `transform.py`, own `migrations/`, `tests/`) | `ETL/etl-trades/` |
| `ETL_Analysis/` (pipeline, dashboard, charts, `tests/`, fixtures) | `ETL/etl-live/` |
| — (new) | `ETL/README.md` — which pipeline writes what into `warehouse.duckdb` |

### Contracts
| Was | Now |
|---|---|
| `contracts/analytics-schema.sql` | `Contracts/analytics-schemas/analytics-schema.sql` (binding star-schema shape) |
| `contracts/kafka-topics.md` | `Contracts/event-schemas/kafka-topics.md` |
| `sprint-06-api/contracts/trade-api.yaml`, `auth-api.yaml` | `Contracts/api-schemas/` (consumed by the UI generator via `openapi-generator/*.config.json`) |

## Deliberately not moved (still at repo root)
`scripts/` (DB tooling, now path-aware of both layouts), `tests/`, `bruno/`,
`services/auth-stub` → moved (see above), `infra/postgres/`, `run-local.ps1`
(paths updated), `leapcapstoneteam1-720d03.TM` (TrustMe vault — never moved,
never edited), `warehouse.duckdb`, `docs/`, `design/`, `legacy/`.

## Invariants held through the move
* **Ports:** 4200 / 3000 / 8081 / 8082 / 29092 / 5432 — including the Docker `8080` mapping. They are
  written once, in `Config/services.env` (see `Config/README.md`); nothing else repeats them.
* **Secrets frozen:** everything still resolves from the TrustMe vault; only
  *relative* `trustme.key-file` defaults were re-pointed (`../` → `../../../`).
* **Maven coordinates frozen:** `artifactId`s, jar names and the Docker build
  context (repo root) are unchanged — only directory prefixes moved.
* **Migrations append-only:** to change the schema, add `025_*.sql`, never edit `000–024`.
* **Derived files regenerate:** `schema.sql` / `seed-data.sql` via `pg_dump` from
  an `apply_db --reset` build; `DuckDB/analytics/schema.sql` by concatenating
  its two marked sources; UI clients via `npm run generate:clients`.
