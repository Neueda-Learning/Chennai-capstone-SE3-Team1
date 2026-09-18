# DLT SIT Commands

Use this script to prove immediate DLT, retry-then-DLT, and header metadata on `orders.DLT`.

## 1) Bring stack up and create topics

```bash
docker compose up -d

docker compose exec kafka kafka-topics --bootstrap-server kafka:9092 --create --if-not-exists --topic orders --partitions 3 --replication-factor 1

docker compose exec kafka kafka-topics --bootstrap-server kafka:9092 --create --if-not-exists --topic trade-events --partitions 3 --replication-factor 1

docker compose exec kafka kafka-topics --bootstrap-server kafka:9092 --create --if-not-exists --topic orders.DLT --partitions 3 --replication-factor 1
```

## 2) Case A: malformed payload -> immediate DLT

```bash
docker compose exec kafka kafka-console-producer --bootstrap-server kafka:9092 --topic orders --property parse.key=true --property key.separator=: <<'EOF'
1:{"eventId":"bad-1","eventType":"ORDER_PLACED","occurredAt":"2026-09-17T10:00:00Z","source":"trade-api","schemaVersion":1,"payload":null}
EOF
```

## 3) Case B: unexpected eventType -> immediate DLT

```bash
docker compose exec kafka kafka-console-producer --bootstrap-server kafka:9092 --topic orders --property parse.key=true --property key.separator=: <<'EOF'
1:{"eventId":"bad-2","eventType":"ORDER_CANCELLED","occurredAt":"2026-09-17T10:01:00Z","source":"trade-api","schemaVersion":1,"payload":{"orderId":"79cb25de-7db1-495a-a321-8d34171155db","accountId":1,"symbol":"INFY","side":"BUY","quantity":10,"price":100.00,"idempotencyKey":"idem-evt-type","createdAt":"2026-09-17T10:01:00Z"}}
EOF
```

## 4) Case C: transient DB failure -> retry/backoff -> DLT

1. Stop Postgres (or make DB unreachable).
2. Publish a valid order message.
3. Watch executor logs for retry/backoff and budget exhaustion.

```bash
docker compose stop postgres

docker compose exec kafka kafka-console-producer --bootstrap-server kafka:9092 --topic orders --property parse.key=true --property key.separator=: <<'EOF'
1:{"eventId":"bad-3","eventType":"ORDER_PLACED","occurredAt":"2026-09-17T10:02:00Z","source":"trade-api","schemaVersion":1,"payload":{"orderId":"69cb25de-7db1-495a-a321-8d34171155aa","accountId":1,"symbol":"INFY","side":"BUY","quantity":10,"price":100.00,"idempotencyKey":"idem-transient","createdAt":"2026-09-17T10:02:00Z"}}
EOF

docker compose logs -f executor
```

Bring Postgres back after the test:

```bash
docker compose start postgres
```

## 5) Prove DLT message + headers

```bash
docker compose exec kafka kafka-console-consumer --bootstrap-server kafka:9092 --topic orders.DLT --from-beginning --property print.headers=true --property print.key=true --max-messages 20
```

Expected headers include:

- `failure-reason`
- `failure-details`
- `error-category`
- `attempt-count`
- `first-failure-time`

