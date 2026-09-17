# Sprint 6 — Trade Order API

## Characterisation tests for the order placement path

Record what the service does now, including the parts you disagree with,
rather than what you think it should do.

They live in one package of their own, named here as the story requires:

```
src/test/java/com/team1/trading/api/characterisation/
```

`OrderPlacementCharacterisationTest` pins the order placement behaviour as
the service exhibits it today. Commit these pins before the change; when a
later change deliberately alters a pinned behaviour, that test is updated in
the **same commit** as the source change and the commit message says so.

### What comes back for an affordable order, field by field

Posting an affordable buy (account 2, `INFY` `BUY` 10 @ `100.00`) answers
HTTP 200 with:

- `orderId`: `ORD-` followed by the 36-character order UUID;
- `status`: `NEW`;
- `message`: `Order accepted`;
- `symbol`: `INFY`, `side`: `BUY`, `quantity`: 10, `price`: `100.00`.

### Which code and status come back for the rejects

- Reused idempotency key: HTTP 409, `errorCode` `ORD-409`, message
  `Duplicate order`. The first post still succeeds; the duplicate writes no
  second row and publishes no second event.
- Unaffordable buy: HTTP 400, `errorCode` `ORD-400`, message
  `Insufficient funds`. No order row is written and no event is published.
- Unknown symbol: HTTP 404, `errorCode` `INS-404`, message
  `Instrument not found`. No order row is written and no event is published.
- Account that is not ACTIVE: HTTP 403, `errorCode` `ACC-403`, message
  `Account not active`. No order row is written and no event is published.

### What is written when an order is accepted

For the accepted order above (account 3, `INFY` `BUY` 5 @ `100.00`):

- order row: `client_id = account_id` (3), `order_type = POSITION`,
  `status = NEW`, the submitted limit price stored, `executed_price` null,
  the idempotency key stored, `external_order_id` null;
- cash: untouched - the wallet balance and its version do not move;
- positions: no `portfolio_positions` row and no `portfolio_holding` row
  appear.

### What is published when an order is accepted

One `ORDER_PLACED` event goes to the `orders` topic, keyed by the account id
(`"2"`), wrapped in the shared five-field envelope (`eventId`, `eventType`,
`eventTime`, `source = trade-api`, `schemaVersion = 1`). The payload carries
the order id, account id, symbol, side, quantity, limit price, idempotency
key and a created-on timestamp. The Kafka template is a mock - the pin is
about what is sent and when, not about a broker.

## Why PostgreSQL and not H2

The placement path is pinned against a real PostgreSQL database because the
`PositionMapper` upserts use the PostgreSQL-only
`INSERT ... ON CONFLICT ... DO UPDATE` syntax, which H2 cannot parse. The
regular unit and integration tests keep using the H2 `schema.sql`; the
characterisation tests load their own Postgres schema from
`src/test/resources/charact-schema.sql` (selected via
`spring.sql.init.schema-locations` in `PostgresCharactDbInitializer`), with
seed data from the shared `data.sql`.

## Build

The characterisation tests run as part of the module's test suite. They need
a local PostgreSQL server (default `localhost:5432`) and the team TrustMe
key file at the repo root (`leapcapstoneteam1-720d03.TM`, overridable through
the `TRUSTME_KEY_FILE` / `CHARACT_DB_NAME` environment variables):

```bash
mvn -f sprint-06-api/pom.xml test
```
