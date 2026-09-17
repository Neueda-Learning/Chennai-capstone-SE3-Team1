# Sprint 5 - Trading Domain Engine Guide

This guide explains the Sprint 5 domain module in code terms and in business terms, with the actual class names used in this repository.

The sprint brief talks about `Account` and `Position`. In this codebase, those responsibilities are implemented by `Client` and `PortfolioHolding` / `PortfolioPosition` respectively. That mapping is important when you read the code:

- `Client` is the account object that owns cash, status, and optimistic locking state.
- `Instrument` is the tradable reference data object.
- `Order` is the order aggregate that carries lifecycle state.
- `PortfolioHolding` and `PortfolioPosition` are the two position-like portfolio entries.

## Setup

From the repository root, this module is a standalone Maven project inside `sprint-05-domain-engine`.

### Prerequisites

- Java 21
- Maven 3.9 or later
- No Docker, database, Spring, or servlet runtime is needed for this sprint

### Install and verify the module

```bash
cd sprint-05-domain-engine
mvn clean test-compile
mvn test
```

If you want to make sure the dependency ban is enforced explicitly, run:

```bash
mvn validate
```

That is the step that fails as soon as somebody adds a banned dependency such as Spring, servlet, JDBC, MyBatis, or a connection pool.

## What this module contains

This sprint is a pure domain model. It is meant to be framework-free so that Sprint 6 can reuse it as source inside the Trade REST API.

The module is organized into:

- `src/main/java/com/team1/trading/domain/entity/` for the domain objects
- `src/main/java/com/team1/trading/domain/entity/types/` for enums
- `src/main/java/com/team1/trading/domain/dto/` for the order request DTO
- `src/main/java/com/team1/trading/domain/exception/` for the exception hierarchy
- `src/main/java/com/team1/trading/domain/service/` for the business rule services
- `src/test/java/com/team1/trading/domain/` for the JUnit 5 test suite
- `design/` for the UML diagrams

## File-by-file explanation

### Package and build files

#### [pom.xml](pom.xml)

This file defines the Maven build for the domain engine.

Code-wise, it sets Java 21, JUnit 5, and the Jakarta Validation API as the main build pieces. It also includes test-scope dependencies for Hibernate Validator and Jakarta EL so the DTO validation tests can actually run.

The important safeguard is the Maven Enforcer plugin. The `bannedDependencies` rule blocks:

- Spring and Spring Boot
- servlet APIs
- MyBatis
- JDBC drivers
- HikariCP and other pools

Logically, this keeps the domain pure. If the package starts pulling transport or persistence dependencies, it stops being the reusable core Sprint 6 depends on.

#### [manifest.env](manifest.env)

This file declares the package coordinates and the base package name.

Code-wise, it records:

- `BASE_PACKAGE=com.team1.trading.domain`
- `MAVEN_GROUP_ID=com.team1.trading`
- `MAVEN_ARTIFACT_ID=domain-engine`
- `MAVEN_VERSION=1.0-SNAPSHOT`

Logically, this is the handoff contract for Sprint 6. The package name is chosen to describe the domain, not the transport, because the same package is carried into the REST API later.

### Domain entities

#### [src/main/java/com/team1/trading/domain/entity/Client.java](src/main/java/com/team1/trading/domain/entity/Client.java)

This is the account aggregate in practice.

Code-wise, it carries:

- `clientId` as the numeric identity
- `accountNumber` as the customer-facing reference
- `name`, `email`, `phone`
- `createdOn`, `updatedOn`
- `accountState`
- `walletBalance`
- `version`

Its behavior is the important part:

- `canTrade()` checks whether the account is `ACTIVE`
- `activate()`, `suspend()`, and `close()` move the account between states
- `canAfford()` compares money exactly using `BigDecimal`
- `credit()` and `debit()` move the wallet balance and advance the version
- `debit()` refuses to go negative before subtracting anything
- `updateProfile()` changes the profile fields and refreshes the timestamp/version

Logically, this class owns the account balance and the account lifecycle. That is why the tests focus on state transitions, affordability, and money precision.

#### [src/main/java/com/team1/trading/domain/entity/Instrument.java](src/main/java/com/team1/trading/domain/entity/Instrument.java)

This is the tradable instrument reference object.

Code-wise, it carries the symbol, display name, active flag, and an `updatedOn` timestamp. Its behavior is small but important:

- `isTradable()` only returns true if the instrument is active and has not been delisted
- `update()` marks the instrument inactive and stamps the update time
- `activate()` and `deactivate()` flip the active flag

Logically, instruments are never deleted. They are deactivated so old orders still resolve against the same symbol.

#### [src/main/java/com/team1/trading/domain/entity/Order.java](src/main/java/com/team1/trading/domain/entity/Order.java)

This is the order aggregate.

Code-wise, it stores:

- identity and foreign keys: `orderId`, `clientId`, `accountId`, `instrumentId`
- order meaning: `orderType`, `side`
- economics: `quantity`, `price`, `executedPrice`
- lifecycle: `status`, `createdAt`, `updatedAt`
- deduplication: `idempotencyKey`
- external traceability: `externalOrderId`

Its lifecycle methods are the key behavior:

- `markInProgress()`
- `markCompleted(BigDecimal executedPrice)`
- `markFailed()`
- `cancel()`

All of them only allow transitions away from `NEW` once, through `requireTransitionableFromNew()`.

Logically, this class models the fact that an order is recorded on receipt and then reaches exactly one terminal state. It also preserves the difference between the requested price and the executed price.

#### [src/main/java/com/team1/trading/domain/entity/PortfolioHolding.java](src/main/java/com/team1/trading/domain/entity/PortfolioHolding.java)

This is the delivery-book entry.

Code-wise, it extends `PortfolioEntry` and implements the average-cost rule for holdings:

- `incrementQuantity()` recalculates the weighted average price when buying more
- `decrementQuantity()` reduces quantity and refuses to go below zero
- `calculateHoldingValue()` multiplies quantity by a market price

Logically, this is the long-only holding book. It never goes negative.

#### [src/main/java/com/team1/trading/domain/entity/PortfolioPosition.java](src/main/java/com/team1/trading/domain/entity/PortfolioPosition.java)

This is the intraday position book.

Code-wise, it is a thin subclass of `PortfolioEntry` with a `getPositionId()` alias.

Logically, it exists because the sprint brief separates delivery holdings from intraday positions. The class is simple because the main behavior lives in the shared base class and the service layer.

#### [src/main/java/com/team1/trading/domain/entity/PortfolioEntry.java](src/main/java/com/team1/trading/domain/entity/PortfolioEntry.java)

This is the shared base for holding and position records.

Code-wise, it carries the common fields: id, client id, instrument id, quantity, price per unit, and timestamp handling.

Logically, it lets the two portfolio books share storage shape and common state without collapsing them into one table or one concept.

#### [src/main/java/com/team1/trading/domain/entity/BankAccount.java](src/main/java/com/team1/trading/domain/entity/BankAccount.java)

This is the external bank-side account record.

Code-wise, it stores client/account identity plus bank contact and balance fields, and supports deposit, withdraw, and contact updates.

Logically, it mirrors the database-side bank account relation from Sprint 3, but in this sprint it is just part of the domain model package and not the main account aggregate used by order placement.

#### [src/main/java/com/team1/trading/domain/entity/Auth.java](src/main/java/com/team1/trading/domain/entity/Auth.java)

This is the credential record.

Code-wise, it stores email, password hash, timestamps, and a version for optimistic concurrency. `changePassword()` updates the hash and increments the version.

Logically, it exists because the domain model also needs to represent the authentication side of the account lifecycle, not just trading.

#### [src/main/java/com/team1/trading/domain/entity/OrderHistory.java](src/main/java/com/team1/trading/domain/entity/OrderHistory.java)

This is the audit trail object for order status changes.

Code-wise, it stores previous status, new status, event metadata, external response details, failure details, and timestamps.

Logically, it reflects the idea that every order event can be recorded separately from the current order state.

### Enumerations

#### [src/main/java/com/team1/trading/domain/entity/types/AccountStatus.java](src/main/java/com/team1/trading/domain/entity/types/AccountStatus.java)

The allowed account states are `ACTIVE`, `SUSPENDED`, and `CLOSED`.

Logically, these are the only states the account lifecycle can express.

#### [src/main/java/com/team1/trading/domain/entity/types/OrderSide.java](src/main/java/com/team1/trading/domain/entity/types/OrderSide.java)

The allowed sides are `BUY` and `SELL`.

Logically, this keeps the order side contract fixed across the domain and the API.

#### [src/main/java/com/team1/trading/domain/entity/types/OrderStatus.java](src/main/java/com/team1/trading/domain/entity/types/OrderStatus.java)

The allowed order states are `NEW`, `FILLED`, `REJECTED`, and `CANCELLED`.

Logically, there is no partial-fill state in this sprint, so the order always ends in one of the terminal states above.

#### [src/main/java/com/team1/trading/domain/entity/types/OrderType.java](src/main/java/com/team1/trading/domain/entity/types/OrderType.java)

The order types are `POSITION` and `HOLDING`.

Logically, these drive the portfolio path the order belongs to.

### DTO

#### [src/main/java/com/team1/trading/domain/dto/PlaceOrderRequest.java](src/main/java/com/team1/trading/domain/dto/PlaceOrderRequest.java)

This is the order request object that carries validation rules.

Code-wise, it declares:

- `accountId` with `@NotNull` and `@Min(1)`
- `symbol` with `@NotBlank` and a length cap
- `side` with `@NotNull`
- `quantity` with `@NotNull` and `@Min(1)`
- `price` with `@NotNull`, `@DecimalMin("0.01")`, and `@Digits(..., fraction = 2)`
- `idempotencyKey` with `@NotBlank` and a length range

Logically, this is the request contract Sprint 6 will validate before it reaches the controller logic. The same business constraints are also enforced in the domain rule tests.

### Exceptions

#### [src/main/java/com/team1/trading/domain/exception/DomainException.java](src/main/java/com/team1/trading/domain/exception/DomainException.java)

This is the base class for all domain exceptions.

Code-wise, it carries a string code plus a message.

Logically, Sprint 6 can catch this base type once and map the catalogue code to an API response.

The concrete subclasses are:

- `AccountNotFoundException` with code `ACC-404`
- `AccountNotActiveException` with code `ACC-403`
- `InstrumentNotFoundException` with code `INS-404`
- `InsufficientFundsException` with code `ORD-400`
- `InsufficientHoldingsException` with code `ORD-409`
- `DuplicateOrderException` with code `ORD-409`

There is also `InvalidOrderException`, which is used for validation-style failures such as bad quantity, bad price, or a missing request field.

### Services

#### [src/main/java/com/team1/trading/domain/service/OrdersService.java](src/main/java/com/team1/trading/domain/service/OrdersService.java)

This class owns the idempotency-key claim set.

Code-wise, it uses a concurrent set and exposes:

- `claimIdempotencyKey(String idempotencyKey)`
- `claimedKeyCount()`

The important behavior is that `claimIdempotencyKey()` returns false if the same key is used a second time.

Logically, this is the in-memory seam for rule 8. In Sprint 6, the equivalent protection comes from the database unique constraint.

#### [src/main/java/com/team1/trading/domain/service/PortfolioService.java](src/main/java/com/team1/trading/domain/service/PortfolioService.java)

This is the main domain rule engine.

Code-wise, `placeOrder(PlaceOrderRequest request)` evaluates the rules in order:

1. request must not be null
2. account must exist
3. account must be active
4. instrument must exist and be tradable
5. quantity must be greater than zero
6. price must be greater than zero
7. BUY orders must be affordable
8. SELL orders must have enough holdings
9. idempotency key must be unique

If the request passes, it constructs a new `Order` with `NEW` status.

The service depends only on plain objects:

- a map of accounts
- a map of instruments
- a list of holdings
- the `OrdersService` idempotency seam

Logically, this is the heart of the sprint. It is where the domain refuses bad orders before anything else is allowed to react to them.

## Tests

#### [src/test/java/com/team1/trading/domain/entity/AccountTest.java](src/test/java/com/team1/trading/domain/entity/AccountTest.java)

This test class exercises the account behavior represented by `Client`.

It covers:

- status transitions
- trading eligibility
- credit and debit
- affordability checks
- money precision and non-drift
- profile updates and reconstruction from stored values

#### [src/test/java/com/team1/trading/domain/service/OrderLogicTest.java](src/test/java/com/team1/trading/domain/service/OrderLogicTest.java)

This is the main business-rule test file.

It verifies all eight rules and the evaluation order. The tests intentionally prove:

- the first failure wins
- each rule fires when it should
- each rule stays quiet when it should
- duplicate idempotency keys are rejected
- the atomic claim behavior is the seam for rule 8

#### [src/test/java/com/team1/trading/domain/dto/PlaceOrderRequestTest.java](src/test/java/com/team1/trading/domain/dto/PlaceOrderRequestTest.java)

This class verifies the validation annotations on the request DTO.

It checks:

- null handling for each required field
- lower and upper boundaries for account id, symbol length, quantity, price, and idempotency key
- the two-decimal-place price rule

## How the module works

The important shape is this:

1. `PlaceOrderRequest` carries the request constraints.
2. `PortfolioService.placeOrder()` checks the business rules in a fixed order.
3. `Client` owns the account state and wallet balance.
4. `Instrument` decides whether a symbol is still tradable.
5. `OrdersService` prevents duplicate order keys.
6. `Order` records the accepted order in `NEW` state.
7. The tests prove each of those steps in isolation.

The code is deliberately free of Spring, JPA, JDBC, or transport concerns. That is what makes it reusable in Sprint 6.

## How to run it

From the repository root:

### Build and test

```bash
cd sprint-05-domain-engine
mvn clean test-compile
mvn test
```

### Run the full validation path

```bash
cd sprint-05-domain-engine
mvn validate
mvn test
```

`mvn validate` is the command that trips the dependency ban, and `mvn test` is the command that proves the rules and DTO validation still hold.

### Useful inspection commands

```bash
cd sprint-05-domain-engine
mvn dependency:tree
```

That is how you verify the module still has no Spring, servlet, JDBC, MyBatis, or connection-pool dependency in its tree.

### Fresh-clone check

```bash
cd sprint-05-domain-engine
mvn clean test-compile
```

That is the cleanest way to confirm the module stands on its own before Sprint 6 reuses the package.

## Setup summary

For this sprint, the setup is intentionally short:

- install Java 21 and Maven 3.9+
- clone the repo
- change into `sprint-05-domain-engine`
- run `mvn clean test-compile` and `mvn test`

No Docker, no database, no external service, and no environment variables are required.

## What to read first

If you want the shortest useful path through the code, read these files in order:

1. [pom.xml](pom.xml)
2. [manifest.env](manifest.env)
3. [src/main/java/com/team1/trading/domain/service/PortfolioService.java](src/main/java/com/team1/trading/domain/service/PortfolioService.java)
4. [src/main/java/com/team1/trading/domain/entity/Client.java](src/main/java/com/team1/trading/domain/entity/Client.java)
5. [src/main/java/com/team1/trading/domain/entity/Order.java](src/main/java/com/team1/trading/domain/entity/Order.java)
6. [src/test/java/com/team1/trading/domain/service/OrderLogicTest.java](src/test/java/com/team1/trading/domain/service/OrderLogicTest.java)
7. [src/test/java/com/team1/trading/domain/dto/PlaceOrderRequestTest.java](src/test/java/com/team1/trading/domain/dto/PlaceOrderRequestTest.java)

That sequence gives you the build contract, the domain flow, and the proof that the flow works.