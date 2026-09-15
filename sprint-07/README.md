# Sprint 7 — Trade Order API, Asynchronous Execution

Sprint 7 turns the Sprint 6 order placement from a synchronous fill into
`NEW` + Kafka publish.

## Characterisation tests for the Sprint 6 order placement path

Characterisation tests pin the order placement behaviour **as it works today
in Sprint 6** — the synchronous fill that returns `FILLED`, the exact response
fields, the failure codes, and what is written to the order row, the cash
balance and the position tables.

They live in one package of their own:

```
src/test/java/com/team1/trading/api/characterisation/
```

`OrderPlacementCharacterisationTest` records the behaviour the Sprint 6
service exhibits **before** the Sprint 7 change touches it, including the
parts the Sprint 6 behaviour disagrees with (recorded, not "fixed"). When the
Sprint 7 change deliberately alters a pinned behaviour, that test is updated
in the **same commit** as the source change and the commit message says so.

## Build

The module compiles the Sprint 6 API sources (`sprint-06-api`) into its test
classpath via `build-helper-maven-plugin`, so the characterisation tests run
against the real controller, service, mappers and exception handler.

```bash
mvn -f sprint-07/pom.xml clean verify
```