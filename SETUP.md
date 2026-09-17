# Docker Setup - Commands to Run

## Prerequisites

On your Linux VM, ensure you have:
- Docker installed
- Docker Compose installed
- Project files copied to the Linux VM

## Quick Start (3 Commands)

Run these commands from the project root on your Linux VM:

### 1. Make scripts executable (first time only)
```bash
chmod +x docker-up.sh
chmod +x infra/kafka/create-topics.sh
```

### 2. Start all 4 containers
```bash
./docker-up.sh
```

Wait for output: `✓ All containers are ready`

**Containers:**
- PostgreSQL (5432)
- Kafka (9092)
- Trade API (8080)
- Executor (8083)

### 3. Create Kafka topics
```bash
bash infra/kafka/create-topics.sh
```

**Topics created:**
- orders (3 partitions, 7 days retention)
- trade-events (3 partitions, 30 days retention)
- market-data (6 partitions, 1 day retention)

## Verify Everything Works

### Test from Linux VM
```bash
# API health
curl http://localhost:8080/actuator/health

# List Kafka topics
docker-compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list
```

### Test from Windows (replace 192.168.1.100 with your Linux VM's IP)
```powershell
curl http://192.168.1.100:8080/actuator/health
```

## Place an Order

```bash
curl -X POST http://localhost:8080/api/v1/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token" \
  -d '{
    "accountId": 1,
    "symbol": "INFY",
    "side": "BUY",
    "quantity": 10,
    "price": 100.00,
    "idempotencyKey": "order-1"
  }'
```

Expected response (HTTP 200):
```json
{
  "orderId": "ORD-...",
  "status": "NEW",
  "message": "Order accepted",
  "symbol": "INFY",
  "side": "BUY",
  "quantity": 10,
  "price": 100.00
}
```

## Useful Commands

### View logs
```bash
docker-compose logs -f                  # All services
docker-compose logs -f trade-api        # Specific service
docker-compose logs -f executor
```

### Check status
```bash
docker-compose ps
```

### Stop all
```bash
docker-compose stop
```

### Restart
```bash
docker-compose restart
```

### Stop and remove everything (WARNING: deletes database)
```bash
docker-compose down -v
```

### Connect to database
```bash
docker-compose exec postgres psql -U postgres -d trading_platform
```

### Monitor Kafka topics
```bash
# List topics
docker-compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list

# Consume from orders topic
docker-compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic orders \
  --from-beginning
```

## Environment Variables (.env)

Optional: Create `.env` file to customize settings:

```bash
cp .env.example .env
nano .env    # Edit if needed
```

Common variables:
- `POSTGRES_PORT=5432`
- `KAFKA_PORT=9092`
- `TRADE_API_PORT=8080`
- `EXECUTOR_PORT=8083`
- `FAUXNANCE_API_KEY=your-key`

## Troubleshooting

### Containers won't start
```bash
docker-compose logs <service-name>
```

### Can't access API from Windows
- Get Linux VM IP: On Linux VM run `hostname -I`
- Test: `curl http://<linux-ip>:8080/actuator/health`
- Check firewall: `sudo ufw allow 8080`

### Database issues
```bash
docker-compose exec postgres pg_isready -U postgres
```

### Kafka not working
```bash
docker-compose logs kafka
```

---

**That's it! Just 3 commands to get running.** 🚀
