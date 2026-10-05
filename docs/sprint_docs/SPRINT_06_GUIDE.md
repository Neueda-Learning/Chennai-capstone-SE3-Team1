# Sprint 06 Trade REST API Guide

This module is the HTTP layer for the trading platform. It exposes the contract in `contracts/trade-api.yaml`, verifies tokens, translates requests into domain calls, persists state through MyBatis, and publishes the order event that the executor consumes later.

## Setup

Before running the service locally, make sure these pieces are available:

1. Java 21 and Maven 3.9+.
2. A local PostgreSQL database populated with the sprint 3 schema and seed data.
3. The TrustMe key file at the repository root: `leapcapstoneteam1-720d03.TM`.
4. A JWT secret in the TrustMe secret store, plus any auth-stub data the tests expect.
5. Kafka reachable on `localhost:9092` if you want to exercise the order event path end to end.

The module reads its infrastructure settings from `sprint-06-api/src/main/resources/application.properties`. The important defaults are:

- PostgreSQL connection values come from TrustMe secrets.
- The service port defaults to `8081`.
- JWT verification uses `jwt.secret` and `jwt.issuer`.
- Kafka producer settings are already tuned for idempotent publishing.

Typical local startup sequence:

1. Start PostgreSQL and load the database schema/seed.
2. Ensure the TrustMe key file is present at the repo root.
3. Export any additional environment variables you need, such as `SERVER_PORT`, `JWT_ISSUER`, or `KAFKA_BOOTSTRAP_SERVERS`.
4. Run the module tests or start the app with Maven.

## How To Run

Run the module tests:

```bash
mvn -f sprint-06-api/pom.xml test
```

Run the application locally:

```bash
mvn -f sprint-06-api/pom.xml spring-boot:run
```

Build the jar:

```bash
mvn -f sprint-06-api/pom.xml clean package
```

Build the container image from the repository root:

```bash
docker build -f sprint-06-api/Dockerfile -t sprint-06-api .
```

If you need to override the TrustMe key path, set `trustme.key-file` on the command line or in the environment. The default assumes the app is launched from inside `sprint-06-api`.

## Code Map

The module is split into a few clear layers:

- `controller` handles HTTP routing and parameter binding.
- `service` contains the actual request rules and read/write orchestration.
- `mapper` is the persistence boundary, implemented with MyBatis.
- `security` validates JWTs and extracts the account claim used for reach checks.
- `exception` standardises every error into the contract envelope.
- `dto` defines the response bodies that leave the API.
- `event` publishes the order-created event after the database write commits.

## File Walkthrough

### `Sprint06ApiApplication.java`

This is the Spring Boot entry point. It only boots the application context through `SpringApplication.run(...)`. There is no custom startup logic here, which keeps the application easy to test and reason about.

### Controllers

`OrderController` exposes the two contract-backed order endpoints:

- `POST /api/v1/orders` places an order.
- `DELETE /api/v1/orders/{id}` cancels an order.

It accepts the `Authorization` header, passes it to `TokenAccountIdResolver`, and forwards the resolved account id into `OrderService`. The controller itself does not decide whether the token is valid or whether the account can be reached.

`AccountController` exposes the four read endpoints under `/api/v1/accounts`:

- `GET /api/v1/accounts/{id}` for the account summary.
- `GET /api/v1/accounts/{id}/balance` for the cash balance.
- `GET /api/v1/accounts/{id}/positions` for the current holdings.
- `GET /api/v1/accounts/{id}/orders` for the order history.

It also accepts `Authorization` and forwards the token-derived account id to `AccountService`, where the reach and activeness checks happen once for every read.

`ClientController` is the non-contract client administration surface. It creates clients, lists them, fetches by id or account number, and changes profile/state. It is a thin wrapper around `ClientService`.

`BankAccountController` manages the banking side of the model. It creates bank accounts, reads them back, updates contact details, and applies deposits or withdrawals. This controller is also a thin transport layer over `BankAccountService`.

### Services

`OrderService` is the core write path. It validates the domain rules in the same order as the contract:

1. account exists,
2. account can trade,
3. instrument exists and is tradable,
4. quantity is positive,
5. price is positive,
6. buy orders can be afforded,
7. sell orders have enough holdings,
8. idempotency key is unique.

If all checks pass, it inserts the order as `NEW`, publishes `OrderPlacedEvent`, and returns the synchronous acceptance response. Cancellation is also guarded here: only a `NEW` order can move to `CANCELLED`.

The service deliberately does not do cash settlement or portfolio mutation. That later execution step belongs to the trade executor, not the REST API.

`AccountService` implements the read side. Every method first resolves the account and enforces the same reach and activeness check. Then it returns one of four views:

- account summary,
- cash balance,
- positions,
- order history.

The order history method also parses the `status`, `from`, and `to` filters before it queries the database.

`ClientService` and `BankAccountService` are narrower CRUD services for admin-style endpoints. They mostly delegate to their mappers, but they keep the domain object construction in one place so controllers stay thin.

### Mappers

`AccountMapper` reads and updates the `clients` table. It carries a guarded balance update with the `version` column so concurrent writes do not silently overwrite each other.

`ClientMapper` maps the same `clients` table into the shared domain `Client` entity. It covers lookup, listing, insert, profile update, and account-state changes.

`InstrumentMapper` looks up an instrument by symbol and exposes the active flag needed by the order rules.

`OrderMapper` owns the `orders` table. It can insert a new order, find an order by UUID, cancel a `NEW` order with a guarded update, and list account history with optional filters. The nested `OrderInsert`, `OrderRow`, and `OrderHistoryFilter` classes are lightweight data carriers for MyBatis.

`PositionMapper` reads and writes the position tables. It supports three main operations:

- read the held quantity for sell validation,
- list current positions,
- upsert buy or reduce sell rows.

The `ON CONFLICT` logic in this mapper is why the integration tests require PostgreSQL rather than only H2.

### Security

`JwtVerificationFilter` is the route-level gate for everything under `/api/v1/`. It rejects missing, malformed, expired, or forged tokens before any controller runs. Valid tokens are parsed into `JwtClaims` and stored in `JwtRequestContext` for downstream use.

`JwtValidator` performs the actual verification. It checks the bearer prefix, decodes the token, verifies the HS256 signature, checks expiry, and then reads the subject and claims. The filter turns any failure into the same `AUTH-401` response body.

`TokenAccountIdResolver` is the seam that extracts the numeric `accountId` from the token header. If the header is absent or unreadable, it resolves to `null`, which keeps the slice tests simple and lets the service treat the request as tokenless.

### Exceptions

`GlobalExceptionHandler` is the single error policy for the API. It converts all domain and framework failures into the fixed envelope defined by `ErrorResponse`.

The important mappings are:

- `ACC-404` for missing accounts,
- `ACC-403` for unreachable or inactive accounts,
- `INS-404` for missing or inactive instruments,
- `ORD-400` for insufficient funds,
- `ORD-409` for duplicate, missing, or non-cancellable orders,
- `VAL-422` for validation and type errors,
- `AUTH-401` for token failures,
- `INTERNAL-500` for everything else.

The handler logs the detailed internal state on the server side, but the client always sees the same two-field body.

`ErrorCatalogue` holds the code-to-status mapping that keeps those responses consistent.

### DTOs

The DTO classes define the public payloads:

- `OrderResponse` returns order id, status, message, symbol, side, quantity, and price.
- `AccountResponse` returns the account identity, holder name, balance, status, version, and last update time.
- `BalanceResponse` returns the account, amount, currency, and timestamp.
- `PositionResponse` returns the account, symbol, quantity, and average cost.
- `OrderHistoryEntry` returns the audit trail fields for the history endpoint.
- `ClientResponse`, `CreateClientRequest`, `CreateBankAccountRequest`, and `ErrorResponse` cover the admin and error surfaces.

These classes are intentionally simple so the contract shape stays obvious.

### Eventing

`OrderPlacedEvent` is the internal event published after a successful insert. `KafkaOrderEventPublisher` turns that event into the Kafka message expected by the downstream executor. The REST API only emits the event; it does not perform settlement itself.

## Tests

`src/test/java/com/team1/trading/api/controller/TradeApiControllerWebTest.java` is the main controller slice test. It proves request/response shapes, validation errors, cancellation responses, and filter-to-service token propagation.

`src/test/java/com/team1/trading/api/exception/GlobalExceptionHandlerWebTest.java` proves the error envelope for every documented failure mode.

`src/test/java/com/team1/trading/api/security/JwtVerificationFilterTest.java` proves the route-level JWT gate and checks that all failures collapse to the same `AUTH-401` response.

`src/test/java/com/team1/trading/api/service/OrderServiceTest.java` is the main business-rule test. It verifies the rule order, idempotency handling, guarded cancellation, and event publication.

There are also mapper, service, and characterisation tests that pin the database-backed behavior.

## Practical Notes

The module currently depends on the domain engine from Sprint 5, so the runtime model and the HTTP layer stay aligned. The API package still uses MyBatis and JDBC directly rather than JPA, which is why the SQL in the mappers matters as much as the Java code.

For local debugging, the most useful places to start are `OrderService`, `AccountService`, `JwtVerificationFilter`, and `GlobalExceptionHandler`. Those four files define the full request lifecycle.