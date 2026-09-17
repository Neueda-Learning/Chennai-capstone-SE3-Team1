# DLT Testing Commands for Bruno

Replace `YOUR_JWT_TOKEN` with a valid Bearer token before copy-pasting into Bruno.

---

## 1. INSTRUMENT_NOT_TRADABLE (Inactive Symbol)
**Why it goes to DLT:** Symbol exists but is inactive (active=false in DB).
```
POST http://localhost:8080/api/v1/orders
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "accountId": 1,
  "symbol": "LEGACYCORP",
  "side": "BUY",
  "quantity": 10,
  "price": 200.00,
  "idempotencyKey": "dlt-inactive-symbol-001"
}
```

---

## 2. ACCOUNT_NOT_FOUND (Non-Existent Account)
**Why it goes to DLT:** Order placed for accountId that doesn't exist.
```
POST http://localhost:8080/api/v1/orders
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "accountId": 99999,
  "symbol": "INFY",
  "side": "BUY",
  "quantity": 10,
  "price": 500.00,
  "idempotencyKey": "dlt-no-account-001"
}
```

---

## 3. INSTRUMENT_NOT_FOUND (Unknown Symbol)
**Why it goes to DLT:** Symbol is not in instruments table at all.
```
POST http://localhost:8080/api/v1/orders
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "accountId": 1,
  "symbol": "UNKNOWNSYM",
  "side": "BUY",
  "quantity": 10,
  "price": 200.00,
  "idempotencyKey": "dlt-unknown-symbol-001"
}
```

---

## 4. Malformed JSON (API Validation Fails)
**Note:** This fails at API layer, NOT in executor, so won't hit DLT.
```
POST http://localhost:8080/api/v1/orders
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "accountId": 1,
  "symbol": "INFY",
  "side": "BUY",
  "quantity": 1,
  "price": 100.00,
  "idempotencyKey": "bad-json",
}
```

---

## Verify DLT is Working (Legitimate Method)

### Method 1: Check orders.DLT Topic Exists
```bash
cd C:\Users\Administrator\Desktop\Capstone-Project\Chennai-capstone-SE3-Team1

# From Linux VM (via SSH or docker exec):
docker-compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic orders.DLT
```

### Method 2: Read DLT Messages
```bash
# Read last 10 messages from orders.DLT
docker-compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic orders.DLT \
  --from-beginning \
  --max-messages 10
```

### Method 3: Check Message Count & Offsets
```bash
# Get partition info (should show partition count, offset, etc.)
docker-compose exec kafka /opt/kafka/bin/kafka-run-class.sh kafka.tools.JmxTool \
  --object-name kafka.server:type=ReplicaManager,name=UnderReplicatedPartitions \
  --bootstrap-server localhost:9092 \
  --topic orders.DLT
```

### Method 4: SQL Cross-Check (If you add audit logging)
```sql
-- Check orders that were placed but have status = REJECTED or verify against Kafka lag
SELECT order_id, status, created_at FROM orders 
WHERE status = 'REJECTED' 
ORDER BY created_at DESC LIMIT 10;
```

### Method 5: Executor Logs (Simplest)
Look for these lines in executor output:
```
Retry budget exhausted for order ... Dead-lettering.
Sending message to DLT: topic=orders.DLT
Successfully published to DLT: topic=orders.DLT
```

---

## Summary Table

| Scenario | Bruno Command | API Accepts? | Goes to DLT? | Executor Log |
|----------|---------------|--------------|-------------|--------------|
| Inactive symbol | Command #1 | ✅ Yes | ✅ Yes | INSTRUMENT_NOT_TRADABLE |
| No account | Command #2 | ✅ Yes | ✅ Yes | ACCOUNT_NOT_FOUND |
| Unknown symbol | Command #3 | ✅ Yes | ✅ Yes | INSTRUMENT_NOT_FOUND |
| Bad JSON | Command #4 | ❌ No | ❌ No | API rejects, no Kafka publish |

---

## How to Use This File
1. Open Bruno on your machine
2. Create a new request in your collection
3. Copy one of the commands above (replace Bearer token)
4. Paste into Bruno request body
5. Send and check executor logs for DLT confirmation
6. Verify DLT topic using Method 1–5 above


