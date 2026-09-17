# Trade Executor

Consumes `ORDER_PLACED` from Kafka `orders` topic, prices against Fauxnance, fills or rejects, settles in one transaction, publishes `ORDER_FILLED`/`ORDER_REJECTED` to `trade-events`.

## Build & Run

```bash
cd executor
mvn clean verify
```

## Configuration (via `.env` at repo root)

| Variable | Description | Default |
|---|---|---|
| `KAFKA_BOOTSTRAP_SERVERS` | Kafka broker | `localhost:9092` |
| `FAUXNANCE_BASE_URL` | Fauxnance API base URL | `http://localhost:8082` |
| `FAUXNANCE_API_KEY` | Fauxnance API key | (required) |
| `POSTGRES_*` | Database credentials via TrustMe key file | |

## Prerequisites

1. **Kafka topics** - create via infra script:
   ```bash
   bash infra/kafka/create-topics.sh
   ```
2. **Database** - run migrations:
   ```bash
   python scripts/apply_db.py
   ```
3. **TrustMe key file** - `leapcapstoneteam1-720d03.TM` at repo root

## Start Executor

```bash
cd executor
mvn spring-boot:run
```

Or as JAR:
```bash
mvn package
java -jar target/trade-executor-0.0.1-SNAPSHOT.jar
```

## Test Execution

### Unit Tests
```bash
mvn test
```

### Integration Test (mocked quote source)
```bash
mvn test -Dtest=OrderConsumerIntegrationTest
```

### Fill Rule Tests
```bash
mvn test -Dtest=FillRuleTest
```

### Settlement Tests
```bash
mvn test -Dtest=SettlementServiceTest
```

## Verify Duplicate Handling

1. Start stack and executor
2. Place an order via Trade REST API (`POST /api/v1/orders`)
3. Note account balance before
4. Replay the same message:
   ```bash
   kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic orders \
     --from-beginning --max-messages 1 --property print.key=true --property key.separator=$'\t' > order.txt
   kafka-console-producer.sh --bootstrap-server localhost:9092 --topic orders \
     --property parse.key=true --property key.separator=$'\t' < order.txt
   ```
5. Verify:
   - Balance unchanged (no double debit)
   - Log shows "ALREADY_SETTLED" detection
   - No second `ORDER_FILLED` on `trade-events`

## Architecture

```
orders topic (partitioned by accountId)
    │
    ▼
OrderConsumer (group: trade-executor)
    │
    ├── Load order from Postgres (status must be NEW)
    ├── Check instrument tradable
    ├── Fetch quote from Fauxnance (GET /quotes/{symbol})
    ├── Apply FillRule (limit vs bid/ask)
    │
    ├── SettlementService @Transactional
    │   ├── Guarded state transition: UPDATE orders SET status=FILLED WHERE id=? AND status='NEW'
    │   ├── Optimistic lock on account version (bounded retries)
    │   ├── Update wallet_balance
    │   └── Update portfolio_holding
    │
    ├── Publish ORDER_FILLED / ORDER_REJECTED to trade-events (keyed by accountId)
    └── Acknowledge offset
```

## The market-data poller

A second, independent path through the same process. It shares the Fauxnance
credential and the quota ledger with the fill path above, and nothing else.

```
@Scheduled(POLL_INTERVAL_SECONDS, floor 58s enforced in PollerProperties)
    |
    v
MarketDataPoller.pollOnce()
    |
    +-- SymbolUniverse: active instruments somebody holds (4 in seeded data)
    +-- Split into batches of 25            <- one batch is one HTTP request
    +-- QuotaLedger.pollerMaySpend(batches) <- skip the cycle rather than eat
    |                                          the fill path's 500 reserve
    +-- For each batch: GET /quotes?symbols=A,B,C
    |       |
    |       +-- For each quote: send to market-data, KEYED BY SYMBOL
    |                           one message per symbol, never one per batch
    |
    +-- catch Exception: a failed cycle costs one cycle, never the schedule
```

It is not on the order path. It does not start a poll because an order arrived,
and `OrderConsumer` does not wait for a poll to finish.

The quota arithmetic, the derivation of the 58-second floor and the reasoning
behind the budget split are in [`../design/kafka.md`](../design/kafka.md).

## Key Design Decisions

| Decision | Rationale |
|---|---|
| `trade-executor` consumer group | Contract-fixed; `orders` is a work queue with exactly one logical consumer group |
| Fill at bid/ask (not mid) | Charges spread on every round-trip; prevents free-looking strategies |
| Price rounded to 2dp before compare | Column holds 2dp; quote has more; round first so check matches stored value |
| Re-check rules 6 & 7 at execution | Cash/holdings and limit price may have changed since acceptance |
| Suspended account blocks execution | Account suspended after acceptance must not trade |
| No price → reject (not leave NEW) | Leaving at NEW forever is worse than explicit rejection |
| Guarded state transition first | Prevents duplicate execution under at-least-once delivery |
| Optimistic lock with bounded retry | Handles concurrent cash updates from API and executor |
| Publish after commit, ack after publish | Recoverable failure model: committed-unpublished replayable; published-unacked reprocessable |

## Project Structure

```
executor/
├── src/main/java/com/team1/executor/
│   ├── TradeExecutorApplication.java
│   ├── config/
│   │   └── KafkaConfig.java
│   ├── consumer/
│   │   └── OrderConsumer.java
│   ├── quote/
│   │   └── FauxnanceQuoteClient.java
│   ├── rule/
│   │   ├── FillDecision.java
│   │   ├── FillRule.java
│   │   └── FillRuleResult.java
│   ├── settlement/
│   │   └── SettlementService.java
│   ├── model/          # DTOs for Kafka, mappers, API
│   └── mapper/         # MyBatis mappers
├── src/main/resources/
│   ├── application.yml
│   └── mapper/         # MyBatis XML
└── src/test/java/
    ├── FillRuleTest.java
    ├── SettlementServiceTest.java
    └── OrderConsumerIntegrationTest.java
```