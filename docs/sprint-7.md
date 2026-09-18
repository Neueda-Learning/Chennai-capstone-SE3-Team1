# Sprint 7 Documentation (JIRA 1 to JIRA 9)

> Scope note: this document covers Sprint 7 JIRAs **1 to 9** and intentionally excludes **JIRA-10**.

## 1) What this sprint is about

Sprint 7 turns the trading platform into a reliable event-driven flow:

- API accepts orders and publishes `ORDER_PLACED`.
- Executor consumes, prices, settles, and publishes terminal trade events.
- Failure handling is explicit (retry vs reject vs dead-letter).
- Market-data is polled and published as a stream.
- Incremental analytics load moves terminal orders into `analytics.fact_trades` safely.

In simple terms: this sprint makes sure an order is processed **asynchronously, safely, and auditable end-to-end**.

---

## 2) Current workflow (end-to-end)

1. Client calls `POST /api/v1/orders`.
2. Trade API validates rules and writes an `orders` row with status `NEW`.
3. Trade API appends an order history row for acceptance (`CREATED -> NEW`).
4. After DB commit, API publishes `ORDER_PLACED` to Kafka topic `orders` (keyed by account).
5. Executor consumer reads `ORDER_PLACED`, validates instrument/account state, fetches quote, runs pure fill rule.
6. Executor settles inside one DB transaction:
   - guarded status transition (`NEW -> FILLED` or `NEW -> REJECTED`),
   - wallet update with optimistic-lock retry,
   - position update,
   - terminal `order_history` row append.
7. Executor publishes `ORDER_FILLED` or `ORDER_REJECTED` to `trade-events` and then acknowledges Kafka offset.
8. In parallel, market-data poller fetches batch quotes and publishes one message per symbol to `market-data`.
9. Fact-trades loader incrementally extracts terminal orders (`orders` + terminal `order_history`), validates quality, merges into dimensions and `fact_trades`, and dead-letters bad rows.

---

## 3) JIRA summary (simple acceptance criteria + what each JIRA is about)

## JIRA-1: Three Kafka topics and message envelope

**What it is about:**
Create and standardize core Kafka topics and dead-letter topics with correct keys/partitions and envelope.

**Acceptance criteria in simple terms:**
- `orders`, `trade-events`, `market-data` topics exist with agreed partition counts and keys.
- Dead-letter topics also exist explicitly.
- All messages use the common envelope.
- Team can explain why key -> partition -> ordering matters.

**What we implemented / maintained:**
- Topic naming and envelope usage across producer/consumer paths.
- Defensive consumer behavior for unknown fields and bad shapes.
- Topic creation and DLT verification commands documented in `DLT_TEST_COMMANDS.md`.

---

## JIRA-2: Characterisation tests on Sprint 6 code

**What it is about:**
Pin current behavior before changing order placement logic.

**Acceptance criteria in simple terms:**
- Baseline tests for existing behavior are added before refactor.
- Git history shows tests were introduced before source behavior changes.

**What we implemented / maintained:**
- Characterisation test package and baseline behavior checks for order placement path.
- Continued compatibility while moving to async execution path.

---

## JIRA-3: Trade API publishes `ORDER_PLACED`, responds `NEW`

**What it is about:**
API should only accept and file order at `NEW`; executor does pricing/fill asynchronously.

**Acceptance criteria in simple terms:**
- `POST /orders` writes `NEW`, returns `NEW`, publishes `ORDER_PLACED` keyed by account.
- Event publish occurs after transaction commit.
- Existing validation/error behavior is preserved.

**What we implemented / maintained:**
- API order acceptance flow remains validation-first.
- Publish-after-commit event pattern retained.
- Added acceptance audit row (`CREATED -> NEW`) in `order_history` from API path.

---

## JIRA-4: Executor consume, price, decide

**What it is about:**
Executor consumes `ORDER_PLACED`, gets live quote, applies pure fill rule, resolves every order.

**Acceptance criteria in simple terms:**
- Executor reads from fixed consumer group.
- Fill rule is deterministic and side-effect-free.
- Unpriceable orders are resolved (not stuck at `NEW`).

**What we implemented:**
- Fill/reject decision from order + quote.
- `ORDER_FILLED` payload now includes real `positionQuantityAfter` and `averageCostAfter` from settlement result.
- Insufficient funds/holdings classified as business rejects (not retry/DLT).
- Listener concurrency set to 3 to match multi-partition consumption.

---

## JIRA-5: One-transaction settlement with two guards

**What it is about:**
Make status, cash, and position updates atomic with guarded writes.

**Acceptance criteria in simple terms:**
- Status change + cash + position happen together or not at all.
- First write is guarded `status='NEW'` transition.
- Publish after commit, ack after publish.

**What we implemented:**
- Settlement transaction keeps guarded `NEW` transition and optimistic-lock retry.
- Added terminal `order_history` writes from executor settlement path.
- Added `OrderHistoryMapper` for executor DB writes.
- Added migration `migrations/011_order_history_add_client_id.sql` to include `client_id` in `order_history` and backfill it.
- Fixed weighted average cost formula in `PositionMapper` buy update.

---

## JIRA-6: Duplicate delivery proof (no double debit)

**What it is about:**
Demonstrate replayed Kafka message does not settle twice.

**Acceptance criteria in simple terms:**
- Duplicate delivery does not move balance again.
- No duplicate event on `trade-events`.
- Team can demo on demand.

**What we implemented / maintained:**
- Replay detection through guarded writes + already-settled handling.
- Test coverage and demo commands kept for repeatable evidence.

---

## JIRA-7: Failure handling and dead letters

**What it is about:**
Route permanent failures immediately to DLT, retry transient failures with backoff.

**Acceptance criteria in simple terms:**
- Poison messages are not retried forever.
- Transient failures retry and then either succeed or DLT after budget.
- DLT message keeps original payload and failure metadata in headers.

**What we implemented:**
- Added explicit unexpected event-type guard (`eventType` must be `ORDER_PLACED`) -> immediate DLT.
- Added classifier categories for:
  - `REJECT_ORDER` (`INSUFFICIENT_FUNDS`, `INSUFFICIENT_HOLDINGS`) -> immediate `ORDER_REJECTED`, no DLT.
  - `ACCOUNT_NOT_ACTIVE` -> deterministic failure handling path.
- Expanded retry/DLT tests and documented SIT commands in `DLT_TEST_COMMANDS.md`.

---

## JIRA-8: Market-data poller inside executor

**What it is about:**
Scheduled poller in executor fetches batched quotes and publishes per symbol.

**Acceptance criteria in simple terms:**
- Polling happens on schedule in executor (not separate app).
- Batch quote calls are quota-efficient.
- One Kafka message per symbol keyed by symbol.
- Interval respects daily quota and minimum floor.

**What we implemented / maintained:**
- Poller remains integrated in executor runtime.
- Symbol-based keying and per-symbol publish behavior retained.
- Interval guard/floor and quota-oriented batching behavior retained.

---

## JIRA-9: Incremental load into `FACT_TRADES`

**What it is about:**
Incremental analytics load from trading DB to `analytics.fact_trades` with DQ checks and dead-lettering.

**Acceptance criteria in simple terms:**
- Watermark-based incremental loads.
- Re-runs do not double-count.
- Invalid rows are dead-lettered with reason and load id.

**What we implemented / unblocked:**
- Main blocker removed by writing real terminal `order_history` rows in live flow.
- Loader already extracts terminal states from `orders` + terminal `order_history`.
- Existing merge-on-natural-key and dead-letter path remain aligned with acceptance intent.

---

## 4) Additional work done beyond core acceptance

- Added `order_history.client_id` migration + backfill for stronger audit/reporting and simpler filtering.
- Added API-side acceptance audit write (`CREATED -> NEW`) so history becomes complete from order creation to terminal state.
- Improved event payload quality by publishing real post-settlement position values.
- Added stronger event validation guard (unexpected `eventType` routed safely).
- Improved test coverage in executor and API for new behavior.
- Filled previously empty `DLT_TEST_COMMANDS.md` with reproducible SIT steps.

---

## 5) Evidence and key files

- API acceptance and event publish:
  - `sprint-06-api/src/main/java/com/team1/trading/api/service/OrderService.java`
  - `sprint-06-api/src/main/java/com/team1/trading/api/mapper/OrderHistoryMapper.java`
- Executor consume/classify/settle:
  - `executor/src/main/java/com/team1/executor/consumer/OrderConsumer.java`
  - `executor/src/main/java/com/team1/executor/error/ErrorClassifier.java`
  - `executor/src/main/java/com/team1/executor/error/ErrorCategory.java`
  - `executor/src/main/java/com/team1/executor/settlement/SettlementService.java`
  - `executor/src/main/java/com/team1/executor/mapper/OrderHistoryMapper.java`
  - `executor/src/main/resources/mapper/OrderHistoryMapper.xml`
  - `executor/src/main/resources/mapper/PositionMapper.xml`
- Infra and migration:
  - `executor/src/main/java/com/team1/executor/config/KafkaConfig.java`
  - `migrations/011_order_history_add_client_id.sql`
- DLT runbook:
  - `DLT_TEST_COMMANDS.md`
- Representative tests:
  - `executor/src/test/java/com/team1/executor/SettlementServiceTest.java`
  - `executor/src/test/java/com/team1/executor/OrderConsumerIntegrationTest.java`
  - `executor/src/test/java/com/team1/executor/OrderConsumerRetryAndDLTTest.java`
  - `sprint-06-api/src/test/java/com/team1/trading/api/service/OrderServiceTest.java`

---

## 6) Sprint 7 outcome in one line

Sprint 7 delivers a complete asynchronous order execution backbone with atomic settlement, auditable history, resilient failure routing, market-data streaming, and incremental analytics loading readiness.

