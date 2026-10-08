# PERSON 3 - 5 MIN PRESENTATION SCRIPT
## Order Placement, Execution, Accounts, Wallet

---

## OPENING (30 seconds)

"Alright, so Person 3. I own the core trading flow—order placement through settlement, accounts, wallet operations. Now, I know what you're thinking: 'Oh great, another guy placing a trade.' Yeah, we all built the same thing, I get it. But here's the thing—it's not actually as simple as it looks. There's this distributed saga pattern running behind the scenes that enforces exactly-once semantics, ensures proper ACID compliance on the settlement, prevents wallet balance violations through optimistic locking, and maintains idempotency across three independent layers even if the network completely fails mid-transaction."

Let me show you the boring thing first—placing a trade—and then I'll explain why it's actually kinda clever."

**[Action: Open website, navigate to Orders page]**

---

## THE DEMO SETUP (15 seconds)

"So here's the order form. Nothing fancy—symbol, quantity, side, price. But look: there's an idempotency key being generated. This little UUID is the first of three layers that'll keep this trade safe, even if the internet explodes mid-way. Let me actually place a trade and talk you through what happens."

**[Action: Fill form - Symbol: AAPL, Qty: 10, Side: BUY, Price: 151.50]**

"Alright, hitting submit."

**[Action: Click "Place Order"]**

---

## THE PLACEMENT (1 minute)

"So I just sent that to the backend. Here's what happens in roughly 200 milliseconds:

First, the @Transactional validation chain executes. We're running domain-driven validation checks: Is this account entity active? Does the instrument exist and have tradable=true? Is quantity and price within acceptable ranges? For a BUY operation, does wallet_balance exceed the required cash outlay of $1,515? Once all preconditions pass, we proceed to persistence.

Then we INSERT into the orders table with status=NEW and the idempotency_key. There's a UNIQUE constraint at the database level on this column. So if your browser retries the request after a network failure, the application layer first queries order_history to detect settlement idempotency—that's *Layer 1 idempotency detection*. But if somehow two requests execute concurrently and bypass that check, the database's UNIQUE constraint on the idempotency_key enforces it atomically. *Layer 2 idempotency enforcement*.

We return HTTP 201 with the order in status=NEW. The key thing here—the response is immediate. We're not blocking the HTTP request waiting for the executor to fill the order. That's the whole architecture—the service layer publishes a domain event via @TransactionalEventListener with phase=AFTER_COMMIT, ensuring the Kafka event is only published if the database transaction commits. Asynchronous settlement via event-driven architecture."

**[Action: Show response in browser - {orderId: "order-123", status: "NEW", symbol: "AAPL"}]**

---

## THE ASYNC PART (1 minute 15 seconds)

"Here's where it gets sophisticated. The moment that database transaction commits, a @TransactionalEventListener with phase=AFTER_COMMIT publishes an Envelope object to the Kafka topic `orders`. The envelope wraps the OrderPlacedEvent with metadata—eventId, schemaVersion, timestamp—for schema evolution and traceability. Kafka partitions by accountId, which ensures all orders from a single account are routed to the same partition, guaranteeing ordering guarantees within that partition.

Now there's a separate microservice—executor-service—running an OrderConsumer with @KafkaListener. It subscribes to the orders topic in consumer group `trade-executor`. When the event arrives, the consumer deserializes the Envelope and begins the settlement workflow. It makes an RPC call to the Fauxnance API—let's say the current market state is bid 151.45, ask 151.55.

Then it evaluates the fill rule using deterministic logic. For a BUY order with my limit price of $151.50: Is limit_price ≥ market_ask? That's 151.50 ≥ 151.55? False. So we classify this as REJECTED with reason code BUY_LIMIT_BELOW_ASK.

Here's the critical resilience pattern: The settlement doesn't just UPDATE the order status to REJECTED. It executes a guarded DELETE: DELETE FROM orders WHERE order_id=X AND status='NEW'. This is idempotency through data structure design. If Kafka redelivers this message after a crash, the executor queries for an order with status=NEW and order_id=X. It doesn't exist (we already deleted it). The DELETE returns zero rows affected. The executor recognizes this as ALREADY_SETTLED and terminates the settlement workflow without re-execution. *Layer 3 idempotency guarantee*.

The architecture is intentionally event-sourced and eventually consistent. Order-service maintains the source of truth for placement and publishes immutable events. Executor-service consumes those events and applies settlement logic idempotently. If either service crashes, Kafka's durability and manual offset management ensure messages are never lost or reprocessed incorrectly."

**[Action: Wait 2-3 seconds, refresh page or check blotter]**

**[Action: Show order now has status REJECTED in the blotter]**

"Okay, so that one got rejected because the market moved against us. Let me place one that'll actually fill."

**[Action: Fill new form - Symbol: AAPL, Qty: 5, Side: BUY, Price: 152.00]**

"This time, limit price is higher, so it should fill immediately at the ask."

**[Action: Click "Place Order"]**

**[Action: Wait 2 seconds, refresh]**

**[Action: Show order now has status FILLED, wallet_balance decreased by ~760]**

"There we go. FILLED. Wallet went from $50,000 down to $49,240. We're holding 5 shares of AAPL at execution price $151.55.

"Notice the settlement flow: same validation chain, same Kafka event publishing, same executor. This time the fill rule evaluates to TRUE: limit_price ($152) ≥ market_ask ($151.55), so we execute the fill. The executor then performs atomic settlement: it deletes the order from `orders`, inserts an OrderHistory record with status=FILLED and executed_price=$151.55, updates the holdings by adding 5 shares of AAPL to the position, and critically, it updates the wallet_balance using optimistic locking.

Optimistic locking works like this: the Account entity has a version field. When we read the account, we get version=47. We calculate the new wallet_balance ($49,240) and execute: UPDATE accounts SET wallet_balance=49240, version=48 WHERE account_id=123 AND version=47. If another order from the same account updated it first, version is now 48, so our query matches zero rows. We catch that condition, fetch the account again (now version=48), recalculate, and retry: UPDATE accounts SET wallet_balance=..., version=49 WHERE account_id=123 AND version=48. This succeeds.

Why not pessimistic locking? Because that would serialize all orders from the same account, creating contention. Optimistic locking allows multiple orders to execute concurrently and race to update the wallet. Retries are rare, fast, and bounded. This is production-grade concurrency handling—high throughput, no deadlocks, guaranteed eventual consistency."

---

## ACCOUNT & WALLET (1 minute)

**[Action: Click on Account/Balance view]**

"So this is the account view. Your current balance, holdings value, portfolio P&L. Nothing shocking here, but it's all built on the same ideas—guarded updates, validation, atomicity.

If you wanted to deposit money, you'd hit the wallet transfer endpoint. Same three-layer idempotency. If you retry a $1000 deposit with the same key, the database's UNIQUE constraint catches it. No double-deposit.

Account reads are straightforward—no state changes, just querying. But orders, wallet transfers, everything state-changing? Idempotent by design."

---

## CLOSING (30 seconds)

"So yeah, placing a trade looks simple on the surface. Form submission, HTTP 201, order in status=NEW. But the distributed transaction machinery is sophisticated. Three independent idempotency layers—application-level history queries, database-level UNIQUE constraints, and settlement-level guarded updates—ensure that transient failures and message redeliveries never cause duplicate executions or partial state corruption. Kafka as the event backbone provides durability, ordering guarantees via partitioning, and decouples order-service from executor-service so failures in one don't cascade. Optimistic locking on the wallet allows concurrent orders to execute with minimal contention while maintaining invariants. And order_history as an immutable, append-only audit trail satisfies compliance requirements.

This is just the order settlement layer though. Once an order fills and we publish OrderFilledEvent, Person 4's services take over—portfolio position updates via event consumption, real-time price alerts via Kafka listeners, notification delivery through multiple channels. A whole different distributed workflow spins up. But the foundation is here: a settlement engine that actually works under failure and concurrency. That's where we hand off."

---

## PROBABLE QUESTIONS & ANSWERS

**Q1: "Why three layers of idempotency? Isn't that overkill?"**

A: "Not really. Think about it—if your browser crashes after you click submit but before the response comes back, you'll retry. That's Layer 1, the application catches it. But what if the database is unavailable and your app server restarts without storing that check? You retry, two requests hit simultaneously. That's Layer 2, the UNIQUE constraint. And what if the executor crashes after settling but before ACKing Kafka? The message gets redelivered. That's Layer 3, the guarded DELETE. Three independent systems, any one can fail, the others still catch it. That's resilience."

**Q2: "Why DELETE from orders instead of just UPDATE status?"**

A: "Because we want orders to move from active to archive. The `orders` table is for unsettled trades. Once settled, they go to `order_history`, which is immutable. On redelivery, the executor queries for status NEW. It doesn't exist (we deleted it). Executor knows immediately: already handled. If we just updated to REJECTED, we'd have extra logic to check 'have I processed this before?' Deletion is simpler and forces us to use the right table for the right data."

**Q3: "What if the wallet goes negative? Someone could SELL shares they don't have."**

A: "We validate before INSERT. For SELL, we check: do you actually hold this many shares? If not, we reject before even touching the database. And even if somehow the validation slipped, the settlement can't execute a SELL that would make holdings negative because the database has a CHECK constraint. It's belts and suspenders—validation in the app, constraints in the database."

**Q4: "Why partition Kafka by accountId?"**

A: "Because all orders from one account go to the same partition, which guarantees sequential processing. No race conditions on the wallet. If I place three orders from account-123 simultaneously, they'll queue up in the same partition and the executor processes them one at a time for that account. No locks needed, ordering is free from Kafka."

**Q5: "What if Fauxnance API times out when fetching the quote?"**

A: "We classify errors. Network timeout? That's transient, we retry with exponential backoff. 'Symbol not found?' That's permanent, we reject immediately and don't waste retries. After max retries, we send the message to a Dead Letter Topic for manual review. No order magically disappears, humans can decide what to do."

**Q6: "How do you know when the order actually fills?"**

A: "The executor publishes an OrderFilled event to trade-events topic when settlement completes. Person 4's portfolio service listens to that and updates holdings. Person 4's notification service listens and sends the user an alert. We publish an event, let whoever cares subscribe to it. Clean separation of concerns."

**Q7: "Can you place the same order twice intentionally?"**

A: "You'd have to generate a new idempotency key. That's the whole point of the key—it's the semantic identity of the order. Different key = different order. Same key = same order, and you'll get a conflict. It's enforced at every layer, so you can't accidentally or deliberately create duplicates."

**Q8: "What about conditional orders? Like 'fill this only if price goes above X'?"**

A: "Those sit in status PENDING instead of NEW. A poller runs every 60 seconds, checks all PENDING orders, evaluates conditions. When the condition is met, it updates status to NEW and publishes the same OrderPlaced event. Then they flow into the normal executor pipeline. Same guarded logic, just delayed until the condition triggers."

