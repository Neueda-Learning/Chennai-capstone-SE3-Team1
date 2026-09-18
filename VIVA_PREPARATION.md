# Sprint 6 Viva Preparation Guide
## Executor, Docker Containerization & Fact-Trades Workflow

---

## PART 1: COMPLETE EXECUTOR WORKFLOW

### **Overview**
The Trade Executor is an event-driven, asynchronous order processing engine that:
- Consumes order placement events from Kafka
- Prices orders against a real/mock exchange (Fauxnance)
- Executes fill/reject logic based on limit price rules
- Settles trades atomically with idempotency guarantee
- Publishes execution results back to Kafka for downstream consumers

---

## **STEP-BY-STEP WORKFLOW WITH BUSINESS & TECHNICAL DETAILS**

### **STEP 1: Order Arrives on Kafka `orders` Topic**

**Business Step:**
- A customer places an order via the Trade REST API
- API validates basic constraints (account active, funds available, instrument exists)
- API publishes `ORDER_PLACED` event to Kafka `orders` topic
- Order status is `NEW` in database

**Technical Step:**
```
Topic: orders
Partitions: 3 (one per account for ordering guarantee)
Key: accountId (ensures all orders for same account go to same partition)
Message: Envelope{eventId, eventType=ORDER_PLACED, source=trade-api, payload}

Payload Fields:
- orderId: UUID from orders.id
- accountId: numeric client id
- symbol: instrument symbol (e.g., "INFY.NS")
- side: BUY or SELL
- quantity: units to trade
- price: limit price per unit
- idempotencyKey: for REST API deduplication
```

**Code Entry Point:**
```java
OrderConsumer.consume(ConsumerRecord<String, Envelope>)
  - groupId: "trade-executor"
  - Manual acknowledgment (acknowledges only after all retries)
```

---

### **STEP 2: Deserialize & Validate Envelope**

**Business Step:**
- Order message structure is verified
- Payload is extracted from envelope wrapper
- Order data is parsed into domain objects

**Technical Step:**
```java
// Stage 1: Null checks
if (envelope == null) → skip, ack
if (envelope.payload() == null) → send to DLT, ack

// Stage 2: Deserialization
try {
  OrderPlacedPayload payload = deserializePayload(envelope.payload(), OrderPlacedPayload.class)
} catch (Exception e) {
  // Malformed JSON → immediately dead-letter
  ErrorContext errorContext = errorClassifier.classify(e)
  deadLetterService.sendToDLT(key, envelope, errorContext)
  ack.acknowledge()
  return
}
```

**Error Category:**
- **Malformed Message** (poison): Invalid JSON, missing fields → Dead-letter immediately
- No retry for these errors (they'll never become valid)

---

### **STEP 3: Validate Instrument & Check if Tradable**

**Business Step:**
- Check if the symbol (INFY, TCS, RELIANCE, etc.) exists in the system
- Verify instrument is tradable (not delisted)
- Fail gracefully if instrument unknown or delisted

**Technical Step:**
```java
// Load instrument from database
var instrumentOpt = instrumentMapper.findBySymbol(payload.symbol());

if (instrumentOpt.isEmpty()) {
  // Reject order - instrument doesn't exist
  publishRejected(payload, eventId, "INSTRUMENT_NOT_FOUND")
  return
}

InstrumentRow instrument = instrumentOpt.get();
if (!instrument.tradable()) {
  // Reject order - instrument delisted
  publishRejected(payload, eventId, "INSTRUMENT_DELISTED")
  return
}
```

**Why it matters:**
- Prevents trading on non-existent or delisted symbols
- This is part of the *fill path*, not the *poller path*
- Transactional consistency: instrument must be consistent from quote time to settlement

---

### **STEP 4: Fetch Current Market Quote from Fauxnance**

**Business Step:**
- Real-time or near-real-time stock price is fetched
- Bid-ask spread tells us the current market
- This determines whether the order can be filled

**Technical Step:**
```java
QuoteResponse quote = quoteClient.getQuote(payload.symbol());
// Returns: { symbol, bid, ask, asOf (timestamp) }

// Fauxnance wire format (hidden by client):
// - API key in x-api-key header (Bearer won't work!)
// - Symbol with exchange suffix: "INFY.NS" (we translate to/from bare "INFY")
// - Response wrapped in {"data": {...}, "meta": {...}}
// - Quote fields: bid, ask, asOf
```

**Error Handling Strategy:**

| Error | HTTP Code | Retry? | Dead-letter? | Action |
|-------|-----------|--------|--------------|--------|
| Quota exhausted | 429 | ❌ No | ❌ No | Reject order (publish REJECTED) |
| Bad request | 4xx (not 429) | ❌ No | ❌ No | Reject order (publish REJECTED) |
| Server error | 5xx | ✓ Yes (3x) | ✓ Yes | Exponential backoff, then DLT |
| Network timeout | - | ✓ Yes (3x) | ✓ Yes | Exponential backoff, then DLT |

**Retry Loop in ErrorClassifier:**
```java
ErrorContext errorContext = null; // First attempt, classify error

while (true) {
  try {
    processMessage(payload, envelope);
    ack.acknowledge(); // Success
    return;
  } catch (Exception e) {
    if (errorContext == null) {
      errorContext = errorClassifier.classify(e);
    }
    
    if (errorContext.category() == QUOTE_FETCH_PERMANENT) {
      // Quota/bad request: reject, don't retry
      publishRejected(payload, ...);
      ack.acknowledge();
      return;
    }
    
    if (retryHandler.shouldRetry(errorContext)) {
      // Transient error: sleep and retry (max 3 attempts)
      retryHandler.sleepBeforeRetry(errorContext);
      errorContext = errorContext.nextAttempt();
      continue;
    }
    
    // Retry budget exhausted
    break; // Fall through to DLT
  }
}

// Dead-letter with full error context
deadLetterService.sendToDLT(key, envelope, errorContext);
ack.acknowledge();
```

**Quota Management (Market Data Poller):**
```
Daily budget: 2000 API calls
Reserve for fill path: 400 requests (for ~400 orders/day)
Poller budget: 1600 requests

Poller can batch up to 25 symbols per request (cost = 1 request)
→ Can poll 25×64 = 1600 symbols with poller budget

QuotaLedger tracks both callers (fill-path vs market-poller)
Poller checks ledger before polling:
  if (quotaLedger.pollerMaySpend(batchCount)) {
    // Proceed
  } else {
    // Skip this cycle, wait for next scheduled interval
  }
```

---

### **STEP 5: Apply Fill Rule (Limit Price Logic)**

**Business Step:**
- Order's limit price is compared against current market (bid-ask)
- Decision: **FILL** (executable) or **REJECT** (cannot execute)
- Executed price determined by market (not the limit)

**Technical Step:**
```java
FillRuleResult fillResult = FillRule.evaluate(order, quote);

// Fill Rule Logic (deterministic):

for (BUY order):
  if (order.limitPrice >= quote.ask) {
    → FILL at quote.ask price
  } else {
    → REJECT with reason: "BUY_LIMIT_BELOW_ASK"
  }

for (SELL order):
  if (order.limitPrice <= quote.bid) {
    → FILL at quote.bid price
  } else {
    → REJECT with reason: "SELL_LIMIT_ABOVE_BID"
  }

// Example:
Order: BUY 100 units @ $500 limit
Quote: bid=$495, ask=$505
→ FILL at $505 (not at the customer's $500 limit)
  (Order pays $505, not $500, because that's the ask)

Order: BUY 100 units @ $495 limit
Quote: bid=$495, ask=$505
→ REJECT: limit $495 is below ask $505
  (If we filled at ask, customer pays $505 > limit)
```

**Why Bid-Ask Separation:**
- **BUY** orders get filled at the **ask** (seller's asking price)
- **SELL** orders filled at the **bid** (buyer's bidding price)
- This is market microstructure: we're a taker, not a maker
- The quote is **stale** (fetched ~1-5 seconds ago), so there's **slippage risk**

**Pricing Logic Code:**
```java
public static FillRuleResult evaluate(Order order, QuoteResponse quote) {
  if (quote == null || quote.bid() == null || quote.ask() == null) {
    return FillRuleResult.REJECT("NO_PRICE_AVAILABLE");
  }
  
  BigDecimal limitPrice = order.getPrice();
  BigDecimal bid = round(quote.bid(), 2);  // Round to 2 decimals
  BigDecimal ask = round(quote.ask(), 2);
  
  if (order.getSide() == BUY) {
    if (limitPrice.compareTo(ask) >= 0) {
      return FillRuleResult.FILL(ask);  // Filled at ask price
    }
    return FillRuleResult.REJECT("BUY_LIMIT_BELOW_ASK");
  } else { // SELL
    if (limitPrice.compareTo(bid) <= 0) {
      return FillRuleResult.FILL(bid);  // Filled at bid price
    }
    return FillRuleResult.REJECT("SELL_LIMIT_ABOVE_BID");
  }
}
```

---

### **STEP 6: Settlement (Atomic Transaction)**

**Business Step:**
1. Update order status from `NEW` to `FILLED` or `REJECTED`
2. Adjust account balance (cash in/out)
3. Update portfolio holdings (shares owned)
4. Record audit trail (order_history event)
5. All succeed together or all fail together (atomicity)

**Technical Step:**
```java
@Transactional  // Spring transaction boundaries
public SettlementResult settle(Order order, FillRuleResult fillResult, QuoteSnapshot quote) {
  
  // 6.1: Verify order still in NEW status (idempotency check)
  OrderRow orderRow = orderMapper.findByOrderId(order.getOrderId());
  if (!orderRow.status().equals("NEW")) {
    return SettlementResult.ALREADY_SETTLED(orderRow.status());
  }
  
  // 6.2: Lock account for update (pessimistic lock in Postgres)
  AccountRow account = accountMapper.findByClientIdForUpdate(order.getClientId());
  // ^ FOR UPDATE acquires row lock, blocking concurrent updates
  
  if (!account.isActive()) {
    return SettlementResult.ACCOUNT_NOT_ACTIVE();
  }
  
  // 6.3A: FILL branch
  if (fillResult.decision() == FILL) {
    BigDecimal executedPrice = fillResult.executedPrice();
    BigDecimal cashDelta = calculateCashDelta(order, executedPrice);
    // BUY: cashDelta is negative (money out)
    // SELL: cashDelta is positive (money in)
    
    BigDecimal newBalance = account.walletBalance().add(cashDelta);
    if (newBalance < 0) {
      throw new InsufficientFundsException(...);
    }
    
    // Guarded state transition (idempotency):
    // Only succeeds if status is still NEW
    int rowsDeleted = orderMapper.deleteIfNew(order.getOrderId());
    if (rowsDeleted == 0) {
      // Someone else already settled this order
      return SettlementResult.ALREADY_SETTLED(...);
    }
    
    // Record terminal state in audit trail
    orderHistoryMapper.insertTerminal(
      orderRow, 
      "FILLED",           // new_status
      "FILLED",           // event_code
      executedPrice,      // filled_price
      null,               // failure_code
      null                // failure_reason
    );
    
    // Update account balance with optimistic lock
    boolean updated = updateAccountBalanceWithRetry(
      account.clientId(),
      cashDelta,
      account.version()  // Optimistic lock version
    );
    if (!updated) {
      throw new OptimisticLockingFailureException(...);
    }
    
    // Update portfolio holdings
    updatePosition(order, executedPrice);
    
  } else {
    // 6.3B: REJECT branch
    int rowsDeleted = orderMapper.deleteIfNew(order.getOrderId());
    if (rowsDeleted == 0) {
      return SettlementResult.ALREADY_SETTLED(...);
    }
    
    orderHistoryMapper.insertTerminal(
      orderRow,
      "REJECTED",
      "REJECTED",
      null,
      fillResult.reason(),  // e.g., "BUY_LIMIT_BELOW_ASK"
      describeReason(fillResult.reason())
    );
  }
  
  return SettlementResult.SUCCESS(...);
}
```

**Concurrency Control: Three Layers**

1. **Idempotency via Guarded State Transition:**
   ```sql
   -- Only succeeds if order is still NEW
   DELETE FROM orders WHERE id = ? AND status = 'NEW'
   -- Returns: 0 rows (already settled) or 1 row (settled now)
   ```
   - Replayed messages find order already gone → 0 rows affected
   - Message is acknowledged, partition advances (no infinite loop)

2. **Pessimistic Lock on Account:**
   ```sql
   SELECT ... FROM account WHERE client_id = ? FOR UPDATE
   ```
   - Blocks concurrent transactions trying to update same account
   - Serializes all updates to one account's balance
   - Held until transaction commits

3. **Optimistic Lock on Balance:**
   ```java
   // UPDATE account SET wallet_balance = ?, version = version + 1
   // WHERE client_id = ? AND version = ?
   
   if (rowsUpdated == 0) {
     // Version mismatch: someone else updated in between
     // Retry the entire settlement (max 3 times)
     throw new OptimisticLockingFailureException(...)
   }
   ```
   - Allows read-heavy workloads (reading quote doesn't block)
   - Detects write-write conflicts cheaply
   - Bounded retries (default 3) prevent infinite loops

**Why Both Locks?**
- Pessimistic: Serializes all balance updates for one account (simple, predictable)
- Optimistic on version: Handles the case where quote-fetch took 5 seconds, account balance changed, and we need to re-read before writing

**Transaction Isolation:**
```
Isolation Level: READ_COMMITTED (Spring default)
- Dirty reads: prevented ✓
- Lost updates: prevented by pessimistic + optimistic lock ✓
- Phantom reads: not a concern (single-row updates) ✓
```

---

### **STEP 7: Publish ORDER_FILLED or ORDER_REJECTED Event**

**Business Step:**
- Result communicated to all downstream systems
- Customers can be notified
- Analytics pipeline can measure fill rate
- Dashboard reflects updated portfolio

**Technical Step:**
```java
// Topic: trade-events
// Partitions: 3
// Key: accountId (same as orders topic, preserves ordering)
// Message: Envelope{eventId, eventType, source=trade-executor, payload}

if (fillResult.decision() == FILL) {
  publishFilled(payload, envelope.eventId(), executedPrice, quantityAfter, avgCostAfter);
} else {
  publishRejected(payload, envelope.eventId(), fillResult.reason());
}

// Filled payload:
{
  "eventId": "<new-uuid>",
  "eventType": "ORDER_FILLED",
  "eventTime": "<iso-timestamp>",
  "source": "trade-executor",
  "schemaVersion": 1,
  "payload": {
    "orderId": "<order-uuid>",
    "accountId": 1,
    "symbol": "INFY",
    "side": "BUY",
    "quantity": 100,
    "price": 2000.00,
    "executedPrice": 2005.50,
    "quantityAfter": 250,
    "averageCostAfter": 2000.50,
    "filledAt": "2026-09-28T10:15:30Z"
  }
}

// Rejected payload:
{
  "eventId": "<new-uuid>",
  "eventType": "ORDER_REJECTED",
  "eventTime": "<iso-timestamp>",
  "source": "trade-executor",
  "schemaVersion": 1,
  "payload": {
    "orderId": "<order-uuid>",
    "accountId": 1,
    "symbol": "INFY",
    "side": "BUY",
    "quantity": 100,
    "price": 2000.00,
    "failureCode": "BUY_LIMIT_BELOW_ASK",
    "failureReason": "Limit price is below the current ask, so the buy cannot be filled",
    "rejectedAt": "2026-09-28T10:15:30Z"
  }
}
```

**Why `accountId` is the key:**
- `trade-events` is partitioned by account (same as `orders`)
- Guarantees all events for one account land on same partition
- Downstream consumers see account's events in order
- (e.g., BUY fills before SELL, no phantom SELL with no preceding BUY)

---

### **STEP 8: Acknowledge Offset & Complete**

**Business Step:**
- Processing complete; message successfully handled
- Consumer group advances to next message

**Technical Step:**
```java
// Manual acknowledgment (configured in spring-kafka)
// Offset only advances after all processing (including publishes) complete

ack.acknowledge();
// Now the next consumer.poll() will start with the next message
```

**Why Manual Ack?**
- If exception thrown before ack, message stays in partition
- Next poll() retrieves it again (at-least-once guarantee)
- Prevents message loss if crash occurs mid-processing
- Also allows selective nack/retry for specific errors

---

## **PART 2: DOCKER CONTAINERIZATION**

### **Architecture: Multi-Stage Dockerfile**

Your implementation uses **multi-stage builds** to optimize image size and security:

```dockerfile
# Stage 1: Build stage
FROM maven:3.9.16-eclipse-temurin-21 AS build
  # Compile all three modules
  # sprint-05-domain-engine (shared library)
  # sprint-07-eventbus (Envelope, shared library)
  # sprint-06-api (Trade REST API)
  # executor (Trade Executor + Market Data Poller)

# Stage 2: Trade REST API runtime
FROM eclipse-temurin:21-jre AS trade-api
  # Copy only JAR from Stage 1
  # JRE only (no Maven, no sources, no compiler)
  # Non-root user for security
  # Exposes port 8080

# Stage 3: Trade Executor runtime
FROM eclipse-temurin:21-jre AS executor
  # Copy only JAR from Stage 1
  # JRE only (no Maven, no sources)
  # Non-root user for security
  # Exposes port 8083
  # Longer health check (waits for Postgres + Kafka ready)
```

**Benefits of Multi-Stage Builds:**
1. **Build artifacts not shipped**: Maven cache, pom.xml, source code stay in Stage 1
2. **Smaller runtime images**: Only JRE + JAR (~300 MB vs 900 MB with Maven)
3. **Security**: No compiler or build tools in production image (reduced attack surface)
4. **Build cache reuse**: One `docker build` produces both API and Executor images

**Build Order (Why It Matters):**
```
1. Build domain-engine first
   ↓ (both services depend on it)
2. Build eventbus
   ↓ (both services depend on it)
3. Build trade-api
   ↓ (independent, runs in parallel conceptually)
4. Build executor
   ↓ (includes market-data poller inside)
```

---

### **docker-compose.yml Services**

Your `docker-compose.yml` orchestrates 4 services (5 with Kafka):

```yaml
# Service 1: PostgreSQL Database
postgres:
  image: postgres:17
  container_name: team1_trade_db
  environment:
    POSTGRES_USER: ${POSTGRES_USER:-postgres}
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
    POSTGRES_DB: ${POSTGRES_DB:-trading_platform}
  ports:
    - "5432:5432"
  volumes:
    # Mount migrations and seed from host
    - ./migrations:/migrations:ro        # Read-only
    - ./seed:/seed:ro                   # Read-only
    - ./infra/postgres/initdb:/docker-entrypoint-initdb.d:ro
    - pgdata:/var/lib/postgresql/data   # Persist data across restarts
  healthcheck:
    # Custom health check: runs migrations, checks schema_migrations table
    test: pg_isready && psql ... SELECT 1 FROM schema_migrations LIMIT 1
    interval: 5s
    retries: 24
    start_period: 20s

# Service 2: Apache Kafka
kafka:
  image: apache/kafka:3.8.0
  container_name: team1_kafka
  profiles: [kafka]                      # Only run with --profile kafka
  environment:
    KAFKA_PROCESS_ROLES: broker,controller
    KAFKA_NODE_ID: 1
    KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:29093
    KAFKA_LISTENERS:                     # Three listeners
      - PLAINTEXT://0.0.0.0:9092         # External (host machine)
      - INTERNAL://0.0.0.0:29092         # Internal (container network)
      - CONTROLLER://0.0.0.0:29093       # Raft
    KAFKA_ADVERTISED_LISTENERS:
      - PLAINTEXT://<your_private_ip>:9092    # External clients
      - INTERNAL://kafka:29092                 # Internal containers
  ports:
    - "9092:9092"
  healthcheck:
    test: /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list
    interval: 10s
    retries: 30
    start_period: 30s

# Service 3: Trade REST API
trade-api:
  build:
    context: .                           # Root of repo
    dockerfile: sprint-06-api/Dockerfile # Uses Stage 2: trade-api
    target: trade-api                    # Multi-stage target
  container_name: team1_trade_api
  profiles: [platform]                   # Only with --profile platform
  depends_on:
    postgres:
      condition: service_healthy         # Wait for Postgres health check
  environment:
    SERVER_PORT: 8080
    KAFKA_BOOTSTRAP_SERVERS: kafka:29092 # Internal network address
    TRUSTME_KEY_FILE: /app/...TM         # Copied into image
  ports:
    - "8080:8080"
  volumes:
    - ./leapcapstoneteam1-720d03.TM:/app/...TM:ro
  healthcheck:
    test: curl -fsS http://localhost:8080/actuator/health
    start_period: 30s

# Service 4: Trade Executor
executor:
  build:
    context: .
    dockerfile: sprint-06-api/Dockerfile
    target: executor                     # Multi-stage target
  container_name: team1_trade_executor
  profiles: [platform]
  depends_on:
    postgres:
      condition: service_healthy
  environment:
    SERVER_PORT: 8083
    KAFKA_BOOTSTRAP_SERVERS: kafka:29092 # IMPORTANT: not localhost:9092
    FAUXNANCE_BASE_URL: ${FAUXNANCE_BASE_URL}
    FAUXNANCE_API_KEY: ${FAUXNANCE_API_KEY}
    POLL_INTERVAL_SECONDS: ${POLL_INTERVAL_SECONDS:-60}
  ports:
    - "8083:8083"
  volumes:
    - ./leapcapstoneteam1-720d03.TM:/app/...TM:ro
  healthcheck:
    test: curl -fsS http://localhost:8083/actuator/health
    start_period: 40s  # Longer: waits on Postgres + Kafka
```

**Network Configuration:**
```
Host Machine:
  localhost:9092 → Kafka PLAINTEXT listener
  localhost:5432 → PostgreSQL
  localhost:8080 → Trade API
  localhost:8083 → Trade Executor

Docker Network (trading_platform_net):
  kafka:29092 → Kafka INTERNAL listener (containers talk to this)
  postgres:5432 → PostgreSQL (containers talk to this)
  trade-api:8080
  executor:8083
```

**Why kafka:29092 Inside Container?**
- Host machine must use `localhost:9092` (external listener, routable from outside Docker)
- Containers inside Docker network must use `kafka:29092` (internal listener, DNS name resolved within network)
- `KAFKA_ADVERTISED_LISTENERS` tells clients which address to use based on which listener they connected to
- **Pitfall**: If executor tries to use `localhost:9092` from inside container, it gets "connection refused" (localhost inside container is the executor, not the host)

---

### **Profiles & Startup Modes**

Your compose file supports three profiles:

```bash
# Mode 1: Just database (for local development, no Docker)
docker-compose up postgres

# Mode 2: Full stack (database + Kafka + API + Executor)
docker-compose --profile kafka --profile platform up

# Mode 3: Database + Services without Kafka (in-memory testing)
docker-compose --profile platform up
# (Kafka not created, API/Executor may run without it)
```

**Order of Startup (depends_on):**
```
postgres → becomes healthy
  ├→ trade-api → becomes healthy
  └→ executor → becomes healthy
```

**Health Check Flow:**
1. `postgres` runs custom init script (applies migrations, seeds data)
2. `postgres` health check: `pg_isready && SELECT 1 FROM schema_migrations`
3. Only when `service_healthy`, Docker starts `trade-api` and `executor`
4. Those two run their own health checks (curl to /actuator/health)

---

### **Volumes & Persistence**

```yaml
volumes:
  pgdata:                              # Named volume
    # Created by Docker, persists data across restarts
    # Location: /var/lib/docker/volumes/pgdata/_data

Mounts:
  ./migrations:/migrations:ro          # Bind mount, read-only
  ./seed:/seed:ro                      # Bind mount, read-only
  ./leapcapstoneteam1-720d03.TM:/app/...TM:ro
  # Postgres init script runs these on first startup
```

**Persistence Strategy:**
- `pgdata` volume: Data survives `docker-compose down`
- Bind mounts: Migrations/seed on host machine pulled into container
- Read-only flags prevent accidental overwrite

---

## **PART 3: FACT-TRADES PIPELINE**

### **Purpose**
Moves every order that reached a **terminal state** (FILLED, REJECTED, CANCELLED) from operational PostgreSQL into a **DuckDB star schema** for analytics.

```
PostgreSQL (operational)           DuckDB (warehouse)
├─ orders                          ├─ fact_trades
├─ order_history                   ├─ dead_letter_trades
└─ (live data, normalized form)    └─ dim_date, dim_instrument, dim_account
                                      (star schema, denormalized for analytics)
```

### **Three Pipeline Stages**

**Stage 1: Schema Creation**
```python
python fact-trades/load_fact_trades.py schema

# Creates in DuckDB:
# - dim_date: 2026-01-01 to 2026-12-31
# - dim_instrument: all symbols + properties
# - dim_account: all accounts + properties
# - fact_trades: grain is one row per order
# - dead_letter_trades: quarantine for bad rows
# - load_watermark: tracks last watermark for each table
```

**Stage 2: Dimension Load**
```python
python fact-trades/load_fact_trades.py dims

# Loads:
# 1. dim_date: all dates in range (idempotent, can re-run)
# 2. dim_instrument: natural key is symbol (upsert on symbol)
# 3. dim_account: natural key is account_id (upsert on account_id)

# Idempotency: second run sees same dates/instruments/accounts, skips
```

**Stage 3: Fact Load**
```python
python fact-trades/load_fact_trades.py facts

# Watermarked extraction:
# 1. Read load_watermark.last_watermark for fact_trades
# 2. Extract terminal orders with orders.created_at > watermark
# 3. Run 8 quality checks on every row (validate, then insert)
# 4. If row fails check: INSERT into dead_letter_trades (quarantine)
# 5. If row passes: UPSERT into fact_trades
# 6. Advance watermark to newest extracted created_at

# Idempotency: second run extracts nothing (nothing after watermark)
```

### **Quality Checks (8 stages)**

| Check | Fails When | Consequence |
|-------|-----------|------------|
| `invalid_order_id` | order_id missing or not UUID | Dead-letter |
| `null_<field>` | Required field is null | Dead-letter |
| `type_<field>` | Field wrong type (not numeric, not int, etc.) | Dead-letter |
| `fk_instrument` | symbol not in dim_instrument | Dead-letter |
| `fk_account` | account not in dim_account | Dead-letter |
| `fk_date` | created_at date not in dim_date | Dead-letter |
| `valid_order_type` | Not POSITION or HOLDING | Dead-letter |
| `valid_side` | Not BUY or SELL | Dead-letter |
| `valid_status` | Not FILLED, REJECTED, or CANCELLED | Dead-letter |
| `positive_quantity` | quantity ≤ 0 | Dead-letter |
| `positive_price` | price ≤ 0 | Dead-letter |
| `filled_has_executed_price` | FILLED but no executed_price | Dead-letter |
| `terminal_after_created` | terminal_at < created_at (event before order!) | Dead-letter |

**Example: Why Check Order**
```
Problem: Seed data had orders.created_at = current timestamp
But orders.order_history had event_timestamp = 2026-01-05 (months earlier)

Result: terminal_after_created check caught ~1000 rows
  → Quarantined as bad, visible in dead_letter_trades
  → Showed root cause immediately (timestamp bug in seed)
  → Fixed in make_seed.py (now uses same clock for both)

Without the quarantine, rows would silently drop and report succeeded with 0 rows loaded.
```

### **Watermark & Idempotence**

```python
# First run (orders created before 2026-01-15 already exist)
SELECT created_at FROM load_watermark WHERE table_name = 'fact_trades'
# Result: NULL (first run, no watermark yet)

# Extract all terminal orders, load them
# Update watermark to 2026-01-15 12:00:00 (newest created_at extracted)

# Second run (no new orders created)
SELECT created_at FROM load_watermark
# Result: 2026-01-15 12:00:00

# Extract terminal orders with created_at > 2026-01-15 12:00:00
# Result: empty (nothing newer)

# Load nothing, advance watermark (optional), return "0 rows loaded"

# Third run (customer places new order on 2026-01-16)
# Extract terminal orders with created_at > 2026-01-15 12:00:00
# Result: 1 order from 2026-01-16
# Load it (or quarantine if it fails checks)
```

**Forced Replay (Bug Fixes):**
```bash
# Date range had 10 orders, 8 loaded, 2 dead-lettered
# Root cause: bug in instrument creation timestamp logic
# Fixed bug in ETL_Analysis

# Re-run facts for the problematic date range:
python fact-trades/load_fact_trades.py facts --since '2026-01-15 00:00:00'

# Extracts orders.created_at >= 2026-01-15 (ignores stored watermark)
# Re-validates the 2 previously dead-lettered rows
# If they now pass: they UPSERT (merge in) because order_id is unique key
# If they still fail: dead_letter_trades row updated with new error context
```

---

## **PART 4: COMMON VIVA QUESTIONS & ANSWERS**

### **Q1: Why does the executor consume from a Kafka topic instead of calling a REST API synchronously?**

**Answer:**
- **Asynchrony**: API responds to customer immediately (order accepted), execution happens later
- **Resilience**: If executor is down, orders queue in Kafka, don't fail
- **Scalability**: Multiple executor instances consume in parallel (consumer group)
- **Audit Trail**: Every accepted order is a permanent message in Kafka before execution starts
- **Integration**: Analytics, notifications, other systems subscribe to results on `trade-events` topic

**Technical**: 
```
Sync (wrong):
  POST /orders → API validates → API calls Fauxnance → API updates DB → returns
  (Fauxnance down? API can't respond)

Async (right):
  POST /orders → API validates → API publishes to Kafka → returns 200 immediately
  [separate process: Executor consumes, prices, settles, publishes result]
```

---

### **Q2: Why do you use manual acknowledgment instead of auto-ack in Kafka?**

**Answer:**
- **Auto-ack**: Offset advances immediately after poll() (even if processing crashes)
  - Message lost if executor dies mid-processing
- **Manual ack**: Offset advances only after all processing + publishing complete
  - If executor crashes before ack, message replayed on restart
  - Guarantees at-least-once delivery

**Trade-off**: Messages may be processed twice (idempotent design required)

**Our idempotency**: "Guarded state transition" - DELETE IF status = NEW
```java
int rowsDeleted = orderMapper.deleteIfNew(order.getOrderId());
if (rowsDeleted == 0) {
  // Already settled, replayed message has no effect
  return ALREADY_SETTLED;
}
// First time: deleted 1 row, proceed with settlement
```

---

### **Q3: Why fetch a fresh quote on every order instead of using the market-data poller's last published quote?**

**Answer:**
- **Fill path quote** (on-demand, fresh): Customer places order → we fetch latest price → fill at that price
- **Market-data poller quote** (background polling): Updated every 1-2 minutes, uses poller's budget reserve

Scenario:
```
14:00:00 - Poller publishes INFY bid=2000, ask=2010
14:00:30 - Customer places order: BUY INFY @ 2005
           - We fetch fresh quote: bid=2000, ask=2008 (spread narrowed)
           - Fill at ask=2008, not the stale ask=2010
           
Stale quote would give worse price to customer (pay 2010 vs 2008)
```

**Quota** is divided to allow this:
- Poller: 1600 requests/day (background)
- Fill path: 400 requests/day (on-demand)

---

### **Q4: Explain the idempotency key flow from REST API to executor.**

**Answer:**

REST API side:
```
Customer submits: POST /orders with idempotencyKey = "abc123"
API checks: is there an existing order with this key?
  YES → return existing order (409 Conflict)
  NO → create new order, store idempotencyKey, publish ORDER_PLACED
```

Executor side:
```
Receive ORDER_PLACED with orderId = "uuid-xyz"
Process and settle: UPDATE orders SET status='FILLED' WHERE id='uuid-xyz'
Publish ORDER_FILLED event with eventId = "new-uuid"
Acknowledge offset

[Network hiccup, message replayed]

Receive same ORDER_PLACED with same orderId = "uuid-xyz"
Check: SELECT * FROM orders WHERE id = 'uuid-xyz' AND status = 'NEW'
  → Result: 0 rows (already FILLED)
  → Log: "Order already settled"
  → Publish: orderFound=false, no duplicate ORDER_FILLED
  → Ack offset, advance
```

**Two layers of idempotency:**
1. API deduplicates on REST request (idempotencyKey, returns cached response)
2. Executor deduplicates on message replay (status != NEW check, no re-settlement)

---

### **Q5: Why does the executor have TWO locks on the account balance (pessimistic + optimistic)?**

**Answer:**

**Pessimistic Lock (FOR UPDATE):**
```sql
SELECT wallet_balance, version FROM accounts 
WHERE client_id = ? FOR UPDATE;
```
- Blocks other transactions updating same account
- Simple: all updates serialize (no concurrent balance changes)
- Cost: if many orders for same account, they queue

**Optimistic Lock (on version):**
```sql
UPDATE accounts SET wallet_balance = ?, version = version + 1
WHERE client_id = ? AND version = ?;
-- Returns: 0 rows (version changed) or 1 row (success)
```
- Allows reading quote without holding lock (quotes take 1-5 seconds)
- Detects if someone else updated balance while we were quoting
- If version mismatch: retry entire settlement (bounded)

**Why both?**
1. Pessimistic ensures no concurrent updates mid-settlement
2. Optimistic handles the case:
   - Thread A acquires pessimistic lock, fetches quote (quote is slow)
   - Thread B finishes, releases pessimistic lock
   - Thread A tries to update, version has changed
   - Optimistic lock detects this, retries

**Result**: Balanced approach - simple semantics + handles long-running operations

---

### **Q6: What happens if Fauxnance is down? Walk through the error handling.**

**Answer:**

**Scenario: Fauxnance HTTP 500 (server error)**

```java
// ErrorClassifier.classify(exception)
if (exception instanceof WebClientResponseException) {
  HttpStatus status = ((WebClientResponseException) exception).getStatusCode();
  
  if (status.value() == 429) {
    return ErrorContext(category=QUOTE_FETCH_PERMANENT, ...)
    // → OrderConsumer handles: publish REJECTED, ack, no retry
  }
  
  if (status.is4xxClientError()) {
    return ErrorContext(category=QUOTE_FETCH_PERMANENT, ...)
    // → OrderConsumer handles: publish REJECTED, ack, no retry
  }
  
  if (status.is5xxServerError()) {
    return ErrorContext(category=QUOTE_FETCH_TRANSIENT, retryable=true, ...)
    // → OrderConsumer handles: retry with backoff
  }
}

// In retry loop:
if (errorContext.category() == QUOTE_FETCH_TRANSIENT) {
  if (retryHandler.shouldRetry(errorContext)) {
    // Retry up to 3 times (default)
    // Sleep: 100ms * 2^attempt (100ms, 200ms, 400ms)
    retryHandler.sleepBeforeRetry(errorContext);
    errorContext = errorContext.nextAttempt();
    continue;  // Loop back, try again
  }
}

// If 3 retries exhausted:
deadLetterService.sendToDLT(key, envelope, errorContext);
// Message goes to orders.DLT (Kafka topic)
// Can be replayed later after Fauxnance recovers
ack.acknowledge();
```

**Result**:
- Order not settled (stays in orders topic if retries exhausted)
- Message dead-lettered for manual replay
- Customer not notified of rejection (because it's transient, not permanent)
- Operations team investigates DLT, replays when Fauxnance recovers

---

### **Q7: What is the `QuotaLedger` and why is it needed?**

**Answer:**

Fauxnance gives you 2000 API calls per day. You have two competing callers:

1. **Fill path** (on-demand): When customer places order, fetch fresh quote (takes 1 request)
2. **Market-data poller** (background): Every 60 seconds, batch-fetch all held symbols (takes 1 request per 25 symbols)

**QuotaLedger tracks usage by caller:**
```
Ledger.record("fill-path")  → fillPathCount++
Ledger.record("market-poller") → pollerCount++

Ledger.spentToday() → fillPathCount + pollerCount

PollingSchedule.FILL_PATH_RESERVE = 400 requests (for ~400 orders/day)
PollingSchedule.POLLER_DAILY_BUDGET = 1600 requests (remaining)
PollingSchedule.TOTAL_DAILY_BUDGET = 2000 requests
```

**Poller decision logic:**
```java
@Scheduled(fixedDelayString = "#{@pollerProperties.effectiveIntervalMillis}")
public void pollOnce() {
  List<String> symbols = symbolUniverse.symbolsToPoll();  // 100 symbols
  List<List<String>> batches = batch(symbols, 25);        // 4 batches
  
  if (!quotaLedger.pollerMaySpend(4)) {
    // 4 requests would exceed budget (might use fill-path reserve)
    log.warn("Skipping poll: budget exhausted");
    return;  // Skip this cycle, wait for next @Scheduled call
  }
  
  // Safe to proceed
  for (List<String> batch : batches) {
    quoteClient.getQuotes(batch);  // 1 request per batch
  }
}
```

**Why it matters:**
- Without ledger: poller might spend all 2000 calls in morning, fill-path starves afternoon
- With ledger: poller reserves 400 for fill-path, uses only 1600

---

### **Q8: Walk through a settlement failure (insufficient funds). What happens?**

**Answer:**

```
Customer: BUY 100 INFY @ 2000 limit
  → Order published to Kafka orders topic
  
Executor:
  1. Receive ORDER_PLACED
  2. Fetch quote: bid=1995, ask=2005
  3. Apply fill rule: BUY order, ask (2005) >= limit (2000) → FILL at 2005
  4. Settlement transaction:
     
     @Transactional
     settle(order, fillResult, quote):
       
       accountRow = findByClientIdForUpdate(123)  // Pessimistic lock
       walletBefore = 50000.00
       
       cashDelta = -100 * 2005 = -200500  (money out)
       walletAfter = 50000 - 200500 = -150500
       
       if (walletAfter < 0) {
         throw new InsufficientFundsException(
           clientId=123,
           required=200500,
           available=50000
         )
       }
       
       // Never reaches settlement code
```

**Error handling:**
```java
// In OrderConsumer.consume():
try {
  processMessage(payload, envelope);  // Calls settle()
  ack.acknowledge();
  return;
} catch (InsufficientFundsException e) {
  // ErrorClassifier.classify(e)
  errorContext = new ErrorContext(
    category=DOMAIN_ERROR,  // Not transient, not poison
    retryable=false,
    failureReason="Insufficient funds: " + e.getMessage()
  )
  
  // Domain error (known business rule violation)
  // → Reject order, don't retry, don't dead-letter
  publishRejected(payload, eventId, "INSUFFICIENT_FUNDS", e.getMessage());
  ack.acknowledge();
  return;
}
```

**Result:**
- ORDER_REJECTED event published to trade-events
- Customer sees rejection reason: "Insufficient funds"
- No retry, no dead-letter (it's not a transient error)
- Account balance untouched

---

### **Q9: How does the executor guarantee settlement atomicity even if it crashes mid-way?**

**Answer:**

Settlement is one `@Transactional` method. Either all succeeds or all rolls back:

```java
@Transactional  // Spring creates transaction on entry, commits on exit
public SettlementResult settle(...) {
  // Step 1: Verify status still NEW
  orderRow = orderMapper.findByOrderId(...);
  if (!"NEW".equals(orderRow.status())) {
    return ALREADY_SETTLED;  // Implicit rollback doesn't matter (no writes)
  }
  
  // Step 2: Lock account
  accountRow = accountMapper.findByClientIdForUpdate(clientId);
  
  // Step 3: Fill branch
  int rows = orderMapper.deleteIfNew(orderId);  // Guarded update
  if (rows == 0) {
    return ALREADY_SETTLED;  // Rollback doesn't matter
  }
  
  orderHistoryMapper.insertTerminal(...);  // Audit trail
  updateAccountBalance(...);  // Optimistic lock
  updatePosition(...);  // Portfolio update
  
  return SUCCESS;
  // ← Method exits here
  // ← Spring commits transaction (all 4 writes committed atomically)
  // OR if exception thrown:
  // ← Spring rolls back transaction (none of the 4 writes persist)
}
```

**Example: What if executor dies after insert to order_history but before updateAccountBalance?**
```
Postgres
  Step 1: DELETE orders WHERE id='xyz' AND status='NEW'  ✓ Executed
  Step 2: INSERT INTO order_history ...                  ✓ Executed
  Step 3: UPDATE accounts SET balance = ...              ✗ Not yet executed
  
Executor process dies (OOM, network cable unplugged, power failure)

Postgres transaction: STILL OPEN, not committed
  → On executor restart, connection to Postgres drops
  → Postgres automatically rolls back open transaction
  → Result: DELETE and INSERT are UNDONE
  → Order status goes back to NEW
  → Account balance stays at original value
```

**On restart:**
- Kafka consumer rejoin consumer group
- Fetch same message from offset (at-least-once)
- Settlement transaction retried
- Same guarded checks run: order is NEW again
- Settlement proceeds normally

**Idempotency ensures no double-debit**: DELETE IF status = NEW succeeds exactly once

---

### **Q10: Explain the Kafka network topology inside Docker. Why kafka:29092 and not localhost:9092?**

**Answer:**

```
Outside Docker (Host Machine):
  Client Program (e.g., Kafka console tool on laptop)
    ↓ connects to
  Kafka PLAINTEXT listener: localhost:9092
  
Inside Docker Network:
  Executor Container
    ↓ connects to
  Kafka INTERNAL listener: kafka:29092 (DNS resolved within docker network)
```

**Why two listeners?**

Kafka publishes `ADVERTISED_LISTENERS` which tells clients:
- "I see you coming from the PLAINTEXT listener, so connect to localhost:9092 for future messages"
- "I see you coming from the INTERNAL listener, so connect to kafka:29092 for future messages"

```yaml
# docker-compose.yml
kafka:
  environment:
    KAFKA_LISTENERS:
      PLAINTEXT://0.0.0.0:9092      # Listen on 9092 (all interfaces)
      INTERNAL://0.0.0.0:29092       # Listen on 29092 (all interfaces)
      CONTROLLER://0.0.0.0:29093     # Raft consensus
    
    KAFKA_ADVERTISED_LISTENERS:
      PLAINTEXT://<your_private_ip>:9092   # Tell external clients use this
      INTERNAL://kafka:29092              # Tell docker clients use this
```

**Executor configuration:**
```yaml
executor:
  environment:
    KAFKA_BOOTSTRAP_SERVERS: kafka:29092
    # NOT localhost:9092 (that's the host machine's loopback)
    # NOT <your_private_ip>:9092 (wrong listener, executor isn't on that network)
    # kafka:29092 = DNS name within docker network
```

**If executor used localhost:9092:**
- localhost inside executor container = the executor itself (not Kafka)
- Connection refused immediately
- Executor starts but can't connect to Kafka

---

### **Q11: What are the three failure modes in error handling, and how does each get handled?**

**Answer:**

**1. Poison Message (Malformed JSON, missing fields)**
```
Category: MALFORMED_MESSAGE
Example: {"eventType": "ORDER_PLACED", "payload": {null}}
         (Missing orderId, accountId, symbol fields)

Handling:
  → Immediately dead-letter to orders.DLT
  → No retry (will never become valid)
  → Operator must fix source (API is sending bad data)
```

**2. Transient Failure (Network, service temporary down)**
```
Category: QUOTE_FETCH_TRANSIENT, DB_CONNECTION_ERROR
Example: Fauxnance returns HTTP 503, network timeout

Handling:
  → Retry up to 3 times with exponential backoff
  → Sleep: 100ms → 200ms → 400ms between attempts
  → If all 3 fail: dead-letter to orders.DLT
  → Message can be replayed manually after service recovers
```

**3. Permanent Business Rule Failure (Insufficient funds, bad limit price)**
```
Category: DOMAIN_ERROR, QUOTE_FETCH_PERMANENT (Quota, HTTP 4xx)
Example: Account has $1000 but order requires $2000
         OR Fauxnance returns HTTP 429 (quota exceeded)

Handling:
  → No retry (will never succeed)
  → Publish ORDER_REJECTED to trade-events topic
  → Customer sees rejection reason
  → Order never settles (stays in orders table with REJECTED status)
  → Do NOT dead-letter (it's an expected business outcome, not an error)
```

**Error Decision Tree:**
```
┌─ Malformed Message?
│  YES → Dead-letter immediately, ack
│  NO ↓
├─ Transient Error (network, 5xx)?
│  YES → Retry with backoff (3 attempts)
│       ├─ Success? → ack, done
│       └─ Exhausted? → Dead-letter, ack
│  NO ↓
└─ Permanent Error (quota, business rule)?
   YES → Publish REJECTED, ack
   NO → Panic (shouldn't reach here)
```

---

### **Q12: Why is fact-trades a separate Python pipeline instead of integrated in the executor?**

**Answer:**

**Operational database (Postgres) ≠ Analytics warehouse (DuckDB)**

Separation allows:

1. **Different consistency requirements:**
   - Postgres: Transactions, strong consistency (orders must be right)
   - DuckDB: Analytics, eventual consistency (can be 5 minutes old)

2. **Different write patterns:**
   - Postgres: Random writes (one order at a time)
   - DuckDB: Batch writes (1000 orders per load)

3. **Different schema:**
   - Postgres: Normalized (orders, order_history, accounts, positions)
   - DuckDB: Star schema (fact_trades + dimensions for reporting)

4. **Different audiences:**
   - API consumes Postgres (real-time order status)
   - Dashboard consumes DuckDB (historical trends)

5. **Replay & Corrections:**
   - If a date's data is wrong: `--since` flag replays just that date
   - Doesn't touch operational orders (safe to rebuild warehouse)

**Architecture:**
```
Trade REST API
  ↓ (publishes)
Kafka: trade-events
  ↓ (consumed by)
Executor (processes orders)
  ↓ (writes to)
Postgres (orders, order_history, accounts)
  ↓ (extracted by)
fact-trades Pipeline
  ↓ (loads to)
DuckDB Warehouse (fact_trades star schema)
  ↓ (queried by)
ETL_Analysis Dashboard
```

---

### **Q13: How does the watermark prevent re-processing of old orders in fact-trades?**

**Answer:**

**First Run (Monday, 2026-01-15):**
```
SELECT last_watermark FROM load_watermark WHERE table_name='fact_trades'
→ Result: NULL (no prior runs)

Extract all terminal orders: 1000 rows
Load them into fact_trades
Update watermark: last_watermark = 2026-01-15 12:00:00 (latest created_at)
```

**Second Run (Tuesday morning, 2026-01-16):**
```
SELECT last_watermark FROM load_watermark WHERE table_name='fact_trades'
→ Result: 2026-01-15 12:00:00

Extract terminal orders WHERE orders.created_at > 2026-01-15 12:00:00
→ Result: 50 rows (created since Monday noon)

Load them into fact_trades
Update watermark: last_watermark = 2026-01-16 08:00:00 (new latest)
```

**Third Run (Tuesday evening, 2026-01-16, no new orders):**
```
SELECT last_watermark FROM load_watermark WHERE table_name='fact_trades'
→ Result: 2026-01-16 08:00:00

Extract terminal orders WHERE orders.created_at > 2026-01-16 08:00:00
→ Result: 0 rows (nothing new since morning)

Return: "0 rows loaded", advance watermark (no-op)
```

**Idempotence**: Running the same load twice extracts nothing second time (same watermark)

**Forced Replay (for bug fixes):**
```bash
# Monday's data had quality check failures, fixed the bug
# Re-run Monday's window:
python fact-trades/load_fact_trades.py facts --since '2026-01-15 00:00:00'

# Ignores stored watermark, re-extracts from 2026-01-15 00:00:00 forward
# All orders.created_at >= that time are re-extracted and re-validated
# Orders that now pass: UPSERT (merge in via unique key)
# Orders that still fail: updated in dead_letter_trades
```

---

### **Q14: What does "grain" mean in the fact-trades table, and why is order_id the unique key?**

**Answer:**

**Grain**: The level of detail. "One row per ___"

**For fact_trades:**
```
Grain: One row per order (not one row per fill, not per account)

order_id (unique key) ensures:
  - BUY 100 INFY filled at 2000 → 1 row
  - SELL 50 INFY rejected → 1 row
  - BUY 200 TCS filled in 2 tranches → 2 rows (2 separate orders)
```

**Why order_id is the unique key:**
```sql
CREATE TABLE fact_trades (
  order_id UUID UNIQUE NOT NULL,  -- Natural key (business identifier)
  ...
);

-- UPSERT on replay:
INSERT INTO fact_trades (order_id, quantity, price, ...)
VALUES (?, ?, ?, ...)
ON CONFLICT (order_id)
DO UPDATE SET
  quantity = EXCLUDED.quantity,
  status = EXCLUDED.status,
  ...
WHERE fact_trades.updated_at < EXCLUDED.updated_at;
```

**Example replay scenario:**
```
First load (Monday): BUY 100 INFY filled at 2000
  → Inserted into fact_trades

Data correction: Actually filled at 1999 (bug in legacy system)

Second load (Friday, --since Monday):
  → Extract same order_id, new price=1999
  → UPSERT: UPDATE existing row (don't insert duplicate)
  → Result: 1 row with corrected price
```

---

### **Q15: Why does fact-trades dead-letter rows instead of just logging and skipping?**

**Answer:**

**Comparison:**

```
Approach 1: Skip Bad Rows (log and continue)
✓ Load completes faster
✗ No record of what was skipped
✗ Operator doesn't know data quality is bad
✗ Same row silently skipped on every run
→ Result: Undercount in analytics (missing orders)

Approach 2: Dead-Letter Bad Rows (quarantine in table)
✓ Every bad row visible with root cause
✓ Operator can investigate
✓ Can fix cause and replay (--since)
✓ Audit trail of data quality issues
→ Result: Analytics accurate (know what's missing and why)
```

**Example: The Real Bug That Was Caught**

Seed data had orders with:
- orders.created_at = seed timestamp (e.g., 2026-01-15 14:00:00)
- order_history.event_timestamp = 2026-01-05 (from CSV file, months old)

**With skipping**: Would've reported "loaded 0 rows" (empty fact_trades, looks like success)
**With dead-lettering**: Showed 1000 rows failed `terminal_after_created` check, pointed to exact bug

Fix: `make_seed.py` now uses same clock for orders.created_at and order_history.event_timestamp

---

### **Q16: How many times can a message be processed in this system? (At-least-once guarantee)**

**Answer:**

**Lower Bound: At Least 1**
```
Success path: Message processed once, ack sent → Done (1 time)
Failure path: Message processed, exception thrown, no ack → Redelivered (≥1 time)
```

**Upper Bound: Bounded by Idempotency**

```
Message 1 arrives, orderId=uuid-123
Scenario 1: Processed successfully
  → Delete from orders, insert to order_history
  → Publish ORDER_FILLED
  → Ack
  → Message never replayed (1 time)

Scenario 2: Published ORDER_FILLED, but crashed before ack
  → Message replayed (at least 2 times)
  → Try to delete from orders again: 0 rows (already deleted)
  → Detect: ALREADY_SETTLED
  → Don't insert duplicate to order_history
  → Don't publish duplicate ORDER_FILLED
  → Ack
  → Message won't replay again (2 times)

Scenario 3: Crashed after failed publish to trade-events (network error)
  → Message replayed
  → Try to delete from orders: 0 rows (already deleted)
  → Detect: ALREADY_SETTLED
  → Don't settle again
  → Ack
  → Message won't replay (2 times)
```

**Idempotency**: Guarded state transition makes operation repeatable
```sql
-- First execution: deletes 1 row
DELETE FROM orders WHERE id='uuid-123' AND status='NEW'

-- Replay: deletes 0 rows (status is now 'FILLED')
DELETE FROM orders WHERE id='uuid-123' AND status='NEW'

-- Result: settlement succeeds or no-ops, never breaks invariants
```

---

## **PART 5: DOCKER CONTAINERIZATION Q&A**

### **Q17: What are the benefits and trade-offs of multi-stage Docker builds?**

**Answer:**

**Benefits:**
1. **Smaller runtime image**: Only JRE + compiled JAR (~300 MB)
   - Without multi-stage: JRE + Maven + pom.xml + sources + cache (~900 MB+)
2. **Faster deployments**: Smaller image pushes/pulls faster
3. **Security**: No build tools (compiler, Maven) in production
   - Reduces attack surface (no build tools an attacker could exploit)
4. **Build cache reuse**: Maven dependency layer cached once, used by both API and Executor

**Trade-offs:**
1. **Complexity**: Requires understanding multi-stage syntax
2. **Build time**: First build slower (Maven downloads all dependencies)
   - Subsequent builds cached (fast)
3. **Debugging harder**: Can't SSH into production image and run Maven (by design)

**Your architecture:**
```dockerfile
FROM maven:3.9.16-eclipse-temurin-21 AS build
  # All compilation happens here
  # Slow, heavy, includes sources

FROM eclipse-temurin:21-jre AS trade-api
  # Copy ONLY JAR from Stage 1
  # Fast, light, no sources
  
FROM eclipse-temurin:21-jre AS executor
  # Copy ONLY JAR from Stage 1
  # Fast, light, no sources
```

---

### **Q18: Why is the executor's health check longer (40s start_period) than the API's (30s)?**

**Answer:**

```yaml
trade-api:
  healthcheck:
    test: curl -fsS http://localhost:8080/actuator/health
    start_period: 30s    # Assumes Postgres is ready

executor:
  healthcheck:
    test: curl -fsS http://localhost:8083/actuator/health
    start_period: 40s    # Waits for Postgres + Kafka ready
```

**Why executor is longer:**

Executor startup sequence:
```
1. JVM starts (5s)
2. Spring context loads (10s)
3. Connect to Postgres (5s)
4. Connect to Kafka broker (5s)
5. Join consumer group (5s)
6. Fetch consumer group offset (5s)
→ Total: ~35-40s

API startup:
1. JVM starts (5s)
2. Spring context loads (10s)
3. Connect to Postgres (5s)
→ Total: ~20-30s
```

**Consequence:**
```yaml
depends_on:
  postgres:
    condition: service_healthy

# Docker waits:
# 1. postgres health check passes (typically 20-30s)
# 2. THEN starts trade-api + executor
# 3. start_period timer begins for each
# 4. After start_period expires, healthcheck starts running
# 5. If healthcheck fails 3+ times: container marked unhealthy, stopped
```

If executor has 30s start_period but needs 40s to startup:
- Health check starts at 30s mark
- Executor still initializing Kafka (not ready)
- Curl to /health returns 503 (service unavailable)
- Healthcheck fails 3x, container marked unhealthy
- Docker stops container

**Solution**: 40s start_period gives executor time to fully initialize

---

### **Q19: What does `depends_on: { postgres: { condition: service_healthy } }` mean?**

**Answer:**

```yaml
depends_on:
  postgres:
    condition: service_healthy
```

**Means:**
- Don't start `trade-api` or `executor` until `postgres` healthcheck passes
- A mere `depends_on: [postgres]` would start immediately (wrong!)
  - Postgres container exists but not ready yet
  - API/Executor connection attempts would fail

**How health check works:**
```yaml
postgres:
  healthcheck:
    test:
      - CMD-SHELL
      - >-
        pg_isready -U "$$POSTGRES_USER" -q &&
        psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -tAc
        "SELECT 1 FROM schema_migrations LIMIT 1" | grep -q 1
    interval: 5s         # Check every 5 seconds
    timeout: 5s          # Wait max 5s for check to return
    retries: 24          # Allow 24 failures (2 minutes max)
    start_period: 20s    # Don't start checking until 20s after container starts
```

**Sequence:**
```
1. docker-compose up
2. Start postgres container
3. Postgres PID 1 starts, listens on :5432
4. Wait 20s (start_period)
5. Run health check: pg_isready && SELECT 1 FROM schema_migrations
   - 1st attempt fails (migrations not applied yet)
6. Wait 5s (interval), try again
   - Eventually succeeds (migrations applied by init script)
7. Health check passes
8. Docker sees service_healthy condition met
9. Start trade-api, executor
10. Their health checks run after their start_periods
```

---

### **Q20: Why bind-mount migrations and seed files instead of baking them into the image?**

**Answer:**

**Bind Mount (Current Approach):**
```yaml
volumes:
  - ./migrations:/migrations:ro      # Host's ./migrations → Container's /migrations
  - ./seed:/seed:ro                 # Host's ./seed → Container's /seed
```

**Benefits:**
1. **Migrations are mutable**: Can update migrations on host, restart container sees new ones
2. **Faster development**: Change schema, `docker-compose restart postgres`, instant effect
3. **Read-only** safety: `:ro` flag prevents container from modifying host files
4. **Image stays small**: Migrations (~500 KB) not copied into Docker image

**Alternative: Bake into Image**
```dockerfile
COPY ./migrations /migrations
COPY ./seed /seed
```

**Drawbacks:**
1. **Schema locked in image**: To change migrations, must rebuild image (~5 minutes)
2. **Larger image**: Image now includes all migrations + seed data
3. **Development slow**: Change schema → rebuild image → restart container

**Decision**: Bind-mount makes sense for development/local, might differ in production

---

## **FINAL TIPS FOR VIVA**

### **Talking Points to Emphasize:**

1. **Event-Driven Architecture**
   - Why Kafka? (Resilience, scalability, audit trail)
   - How at-least-once is guaranteed (manual ack, idempotent settlement)

2. **Concurrency & Atomicity**
   - Guarded state transitions (DELETE IF status = NEW)
   - Pessimistic + optimistic locks
   - Why transaction boundaries matter

3. **Error Handling Strategy**
   - Poison vs transient vs domain errors
   - Retry budgets and backoff
   - Dead-lettering for observability

4. **Quote Pricing**
   - Why fresh quote every time (vs stale poller quote)
   - Bid-ask separation (BUY at ask, SELL at bid)
   - Quota management (fill-path reserve)

5. **Docker Containerization**
   - Multi-stage builds (smaller, safer images)
   - Service dependencies and health checks
   - Network topology (kafka:29092 vs localhost:9092)

6. **Analytics Pipeline**
   - Watermark for idempotency
   - Dead-lettering for data quality
   - Star schema for reporting

### **Common Follow-Up Questions:**

- *"What if a customer places an order for a delisted instrument?"* → Reject in settlement, don't publish ORDER_FILLED
- *"Why not just use a schedule task instead of Kafka?"* → No resilience, no audit trail, all-or-nothing
- *"How do you handle duplicate message keys?"* → Partition-keyed by accountId, all orders for same account go same partition, ordered
- *"What's the latency from order placement to settlement?"* → Typically <1 second (quote fetch + DB updates), bounded by Fauxnance SLA

---

Good luck with your viva! 🚀
