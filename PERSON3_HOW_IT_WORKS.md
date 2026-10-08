# HOW IT ACTUALLY WORKS: Person 3 Technical Deep Dive
## No code. Just theory and process.

---

## PART 1: THE DISTRIBUTED ARCHITECTURE

### Why Kafka?

When you place an order, the server can't wait around for the executor to finish filling it. That would mean your HTTP request is blocked for potentially seconds while we fetch market quotes, evaluate fill rules, update the wallet, etc. Bad UX, poor scalability. Instead, we use Kafka as an event broker.

Kafka is a distributed, append-only log. When we publish an event, it's written to disk on the broker (and replicated to follower brokers for durability). The event sits there forever (or until retention expires). Multiple consumers can independently read from that log at their own pace, without affecting each other. This is fundamentally different from traditional message queues where consuming a message removes it.

Why does that matter? Because it means if the executor crashes mid-processing, the message is still in Kafka. When the executor comes back online, it re-reads the message and retries. No message loss.

### The Consumer Model

The executor service runs an OrderConsumer. It subscribes to the `orders` topic with consumer group ID `trade-executor`. Kafka assigns partitions to this consumer group. In our case, we partition by accountId, so all orders from account-123 go to partition 0, orders from account-456 go to partition 1, etc.

When the consumer is running:
1. It polls Kafka: "Give me the next batch of messages from my assigned partitions"
2. Kafka returns messages (e.g., OrderPlaced events)
3. The consumer deserializes and processes each message
4. After processing, it commits the offset: "I've successfully processed up to message #4523"
5. Kafka records this offset in an internal topic (__consumer_offsets)

If the consumer crashes before committing, Kafka forgets where it was. Next time it starts, it resets to the last committed offset and reprocesses messages. This is intentional for exactly-once semantics.

### Manual Offset Management

In our setup, we use MANUAL_IMMEDIATE offset commit mode. This means:
- The consumer does NOT automatically commit after processing
- The consumer must explicitly call commit() after successfully processing a message
- If processing fails, the consumer can exit without committing, and Kafka will redeliver

So the workflow is:
```
1. Poll and receive OrderPlaced event
2. Execute settlement logic
3. If settlement succeeds: commit offset
4. If settlement fails: exit, Kafka redelivers on restart
```

This gives us a way to handle failures gracefully. If the executor crashes mid-settlement, the message comes back and we retry.

---

## PART 2: THE SAGA PATTERN FOR DISTRIBUTED TRANSACTIONS

### The Problem

In a monolithic system with a single database, we'd just do:
```
BEGIN TRANSACTION
  INSERT order
  UPDATE wallet
  INSERT to order_history
COMMIT
```

All-or-nothing atomicity. If any step fails, everything rolls back.

But we have two services: order-service and executor-service. They have separate databases (or logical isolation). We can't wrap them in a single transaction across network boundaries. 2-phase commit exists but it's slow and fragile.

### The Saga Solution

A saga is a sequence of local transactions, each managed by one service, coordinated through events. Our saga looks like:

**Order-Service Transaction:**
1. Validate order (check account, balance, instrument)
2. INSERT into orders table with status=NEW
3. Publish OrderPlaced event to Kafka
4. Commit transaction
5. Return HTTP 201 to client

**Executor-Service Transaction (when event arrives):**
1. Deserialize event
2. Fetch current market quote
3. Evaluate fill rule
4. If fill: DELETE order, INSERT to order_history with status=FILLED, UPDATE wallet, UPDATE holdings
5. If reject: DELETE order, INSERT to order_history with status=REJECTED
6. Publish OrderFilled or OrderRejected event
7. Commit transaction
8. Acknowledge offset to Kafka

Each step is local and ACID. But together, they form a distributed workflow with guaranteed progress:
- Order-service must successfully insert or client gets an error
- Executor-service consumes the event and settles
- If executor crashes, Kafka redelivers and it retries

The key insight: we're not trying to undo if something fails mid-saga. We're designing the flow so partial states are tolerable and can be retried.

---

## PART 3: IDEMPOTENCY - THE THREE LAYERS

### Why Idempotency Matters

In a distributed system, failures are inevitable. Network goes down. Service crashes. Timeouts occur. When these happen, the client doesn't know if the request succeeded or failed. So it retries. Now you might receive the same logical request twice.

If you process it twice naively, you get duplicates: two fills of the same order, two wallet withdrawals, etc.

Idempotency means: same input, same output, no matter how many times you execute it. Retries don't create duplicates.

### Layer 1: Application-Level Idempotency Key Detection

When the OrderController receives a PlaceOrderRequest, it includes an idempotencyKey (a UUID). The OrderService does:

```
idempotencyKeyCount = query order_history where idempotency_key = request.idempotencyKey
if (idempotencyKeyCount > 0) {
    return cached result (or 409 Conflict)
}
```

This checks: have we ever settled an order with this key before? If yes, we reject with conflict. This is pre-insert validation. It's fast (indexed query) and catches the obvious case of immediate retries.

### Layer 2: Database UNIQUE Constraint

We also have a UNIQUE constraint on the idempotency_key column. So if somehow two concurrent requests bypass the application check and both try to INSERT, only one succeeds. The other gets a constraint violation exception (likely a DataIntegrityViolationException).

This is the database enforcing atomicity. It's the last line of defense if application logic fails.

### Layer 3: Guarded Settlement Update

This is the most subtle but most important for distributed resilience.

When the executor settles an order, it doesn't just UPDATE status from NEW to FILLED. Instead:

```
DELETE FROM orders WHERE order_id = X AND status = 'NEW'
if (rows_deleted == 0) {
    return ALREADY_SETTLED
}
```

The DELETE has a WHERE clause guarding the condition status = 'NEW'. This is a guarded operation.

Now imagine: the executor processes OrderPlaced event, fills the order, deletes it from `orders`, archives it to `order_history`, updates the wallet. Then it crashes before committing the transaction. Kafka sees no offset commit, so it assumes processing failed. It redelivers the event to a new executor instance.

The new instance queries: is there an order with order_id=X and status=NEW? No. It's gone (we deleted it in the previous attempt). So the DELETE returns zero rows. The new instance detects this condition immediately and exits with ALREADY_SETTLED. No retry logic needed, no double-execution.

This works because we've designed the data structure to be self-documenting about state. If the order is still in `orders` table with status NEW, it hasn't been settled. If it's not there, it has been.

### Why Three Layers?

Because each layer protects against different failure modes:
- **Layer 1**: Catches immediate retries from the same HTTP client
- **Layer 2**: Catches concurrent requests that bypass Layer 1 logic
- **Layer 3**: Catches message redeliveries after service crash/restart

If any one fails, the others still protect you.

---

## PART 4: OPTIMISTIC LOCKING FOR CONCURRENT UPDATES

### The Problem

Multiple orders from the same account can arrive simultaneously. Each one needs to update the wallet_balance. If we use pessimistic locks (SELECT FOR UPDATE), the first order locks the row, the others queue up waiting, and we serialize everything. Slow.

But if we don't lock at all, we risk lost updates:
```
Order 1: reads wallet_balance = 50000
Order 2: reads wallet_balance = 50000

Order 1: buys 10 shares at $150 → new balance = 50000 - 1500 = 48500
Order 2: buys 5 shares at $160 → new balance = 50000 - 800 = 49200

Order 1: UPDATE accounts SET wallet_balance = 48500
Order 2: UPDATE accounts SET wallet_balance = 49200

Final balance = 49200 (should be 49200 - 1500 = 47700)
```

Order 1's withdrawal is lost. The wallet doesn't reflect both orders.

### Optimistic Locking Solution

We add a `version` column to the accounts table. When we read an account, we get the version:

```
Account read:
  wallet_balance = 50000
  version = 47
```

When we update, we include the version in the WHERE clause:

```
UPDATE accounts 
SET wallet_balance = 48500, version = 48
WHERE account_id = 123 AND version = 47
```

If another order updated the account first (incrementing version to 48), our WHERE clause matches zero rows. The update fails. We detect this failure:

```
if (rows_updated == 0) {
    // Version mismatch, someone else updated it
    re-fetch account (version is now 48)
    re-execute settlement logic
    retry update with new version
}
```

With retries, both orders eventually succeed:
```
Order 1: version 47 → 48, balance 50000 → 48500 ✓
Order 2: version 48 → 49 (after retry), balance 48500 → 47700 ✓
```

No lost updates, no deadlocks, no long waits. Concurrent orders execute with minimal contention.

---

## PART 5: THE SETTLEMENT WORKFLOW IN DETAIL

### Step-by-Step

**1. Message Arrives**
The executor polls Kafka and receives an OrderPlaced event. It deserializes the Envelope wrapper and extracts the payload.

**2. Validation**
It fetches the order from the database to confirm it exists and has status=NEW. If not found, it returns ALREADY_SETTLED (the order was already settled in a previous execution).

**3. Quote Fetch**
It makes an RPC call to Fauxnance API: "Give me the current bid/ask for AAPL". The Fauxnance service responds with market data.

**4. Fill Rule Evaluation**
It applies deterministic logic:
- For BUY: Is order.limitPrice ≥ market.ask? If yes, fill at ask price.
- For SELL: Is order.limitPrice ≤ market.bid? If yes, fill at bid price.
- Result is either FillDecision.FILL or FillDecision.REJECT

**5. Settlement (if FILL)**
- **Guarded Delete**: DELETE FROM orders WHERE order_id = X AND status = 'NEW'
  - If 0 rows: another instance already settled, return ALREADY_SETTLED
  - If 1 row: we are the settler, proceed
  
- **Archive**: INSERT INTO order_history (order_id, status='FILLED', executed_price, timestamp)
  - Immutable record of what happened
  
- **Wallet Update (Optimistic Lock)**:
  - Read current account (version=V, balance=B)
  - Calculate new balance: B_new = B - (quantity × executed_price)
  - UPDATE accounts SET balance=B_new, version=V+1 WHERE account_id=X AND version=V
  - If 0 rows: retry with fresh read
  
- **Holdings Update**: INSERT or UPDATE holdings table to add/subtract shares
  
- **Event Publish**: Publish OrderFilled event to trade-events topic
  
- **Offset Commit**: Tell Kafka this message was successfully processed

**6. Settlement (if REJECT)**
Same process but with status='REJECTED', no wallet update, publish OrderRejected event.

### Error Handling During Settlement

If any step fails:

**Transient Error** (network timeout, service temporarily down):
- The exception is classified as retryable
- The executor exits the settlement without committing the offset
- Kafka redelivers the message
- On restart, the executor retries

**Permanent Error** (invalid symbol, quota exceeded):
- The exception is classified as non-retryable
- The executor publishes OrderRejected event with the reason
- The executor commits the offset (acknowledging "we handled this, don't redeliver")
- The order is marked as REJECTED in order_history

**Optimistic Lock Collision**:
- Detected when wallet UPDATE returns 0 rows
- Re-fetch the account with fresh version
- Recalculate and retry
- Bounded to max_retries (e.g., 10)

---

## PART 6: EVENTUAL CONSISTENCY AND CAP THEOREM

### The Trade-off

Our system prioritizes Availability and Partition tolerance over immediate Consistency (the CAP theorem).

When you place an order, you get HTTP 201 immediately. But your balance update isn't guaranteed yet. It's in progress in the executor. There's a window (microseconds to milliseconds) where the balance shown in your account view might not yet reflect the order you just placed.

This is acceptable in trading because:
1. The settlement is deterministic and will eventually complete
2. The order_history provides an immutable record
3. Users understand there's a brief lag between order and execution

### Final Consistency Guarantees

By the time the executor publishes OrderFilled event:
- The order is removed from active orders
- The wallet balance reflects the transaction
- The holdings are updated
- The audit trail is immutable in order_history

Person 4's portfolio service consumes the OrderFilled event and updates positions. The notification service sends an alert. Everything cascades from that one authoritative event.

---

## PART 7: WHY THIS DESIGN

### Production Readiness

- **Durability**: Kafka persists events. No order is lost to crashes.
- **Idempotency**: Three layers ensure retries don't create duplicates.
- **Concurrency**: Optimistic locking allows parallel orders without contention.
- **Auditability**: order_history is immutable for regulatory compliance.
- **Resilience**: Failures in one service don't cascade due to asynchronous decoupling.

### Scalability

- Partitioning by accountId allows horizontal scaling of executors
- Each partition has one consumer, so ordering within an account is preserved
- Add more executor instances, Kafka automatically rebalances partitions
- No shared locks, no database contention

### Debuggability

If something goes wrong:
- Check order_history for the full audit trail of state transitions
- Check Kafka offset for how far the consumer processed
- Check dead letter topic for messages that failed permanently
- Replay messages by resetting the offset

---

## SUMMARY

The order placement and settlement system is a carefully orchestrated distributed transaction using:
1. **Kafka** for durable, ordered, decoupled event flow
2. **Saga pattern** for coordinating multiple services without ACID transactions across networks
3. **Three-layer idempotency** to guarantee exactly-once semantics despite failures and retries
4. **Guarded updates** to self-document state and enable idempotency detection
5. **Optimistic locking** for high-concurrency wallet updates
6. **Immutable audit trails** for compliance and debuggability

Each layer is independently valuable but together they form a resilient, production-grade settlement engine.

