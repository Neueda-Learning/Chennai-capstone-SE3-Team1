# 0001 The four extension modules live as packages inside the Trade REST API, not as separate services

| Field | Value |
|---|---|
| Status | proposed |
| Date | 2026-10-06 |
| Decided by | drafted by SE ahead of the Monday scope review with the instructor |

## Context

Sprint 10 names four extensions this week: Customer Preferences, Customer Notifications, Watchlists and Price Alerts, and Portfolio and P&L. Team 1's Trade REST API is `Application/Services/order-service`, a Spring Boot service on 8080 that already verifies the bearer token on every `/api/v1/` route, holds the database connection, and runs under `run-local.ps1` alongside the auth service, the executor, Postgres and Kafka. The Sprint 10 brief fixes the deployment shape in one sentence: "All four are built inside the Trade REST API you wrote in Sprint 6 ... None of them has a Dockerfile, a port, a compose entry or a second copy of token verification." The decision to confirm is therefore the one the brief rules on, so that the reason it was taken is on the record.

## Options considered

| Option | For | Against |
|---|---|---|
| One package per extension inside `com.team1.trading.api` in order-service | No new container, no new JWT verifier, no new compose entry; the service already boots so each module starts producing on Monday afternoon; one dependency surface and one build | Package boundaries are social, not compiler-enforced; a module reaching into another's tables is one import away; a bad module in the same JVM can break order placement |
| A new Spring Boot service per extension | Clear service boundary that a network hop enforces; isolated failure domain per module | Four Dockerfiles, four port allocations, four compose entries, four JWT verifiers before a single feature exists; disallowed by the Sprint 10 brief; two more days of plumbing before any module touches a customer |

## Decision

One package per extension under `com.team1.trading.api` inside order-service: `preferences`, `notifications`, `watchlists`, `portfolio`. Package names are agreed on day one and treated as the module boundary — nothing outside a module imports anything inside it except the interface that module publishes. The brief rules out option 2, and the integration lesson separate services would have taught is already covered by the five services already in `Application/Services/`; option 1 is also the only one that leaves time this week for the chain to work end to end.

## Consequences

Nothing in Sprint 6 regresses: the six contract routes answer as they did and the service's tests stay green through four parallel branches of work. The application class, the security configuration and anything under `com.team1.trading.api.config` become shared files that four people cannot edit at once — one person at a time, one branch per module, review before merge, is the cheapest rule. The `pom.xml` grows by whichever dependencies the modules need, but no new Maven project is added. A later move to separate services remains possible only if each module keeps every cross-module call behind a published interface (see [0006](0006-watchlists-delivers-via-a-java-interface-not-an-http-route.md)), rather than reading another module's tables directly.
