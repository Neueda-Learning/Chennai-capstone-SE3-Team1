#!/bin/bash

# Script to start all 4 containers: postgres, kafka, trade-api, and executor
# Run this from the repository root directory

set -e

echo "=========================================="
echo "Team 1 Trading Platform - Docker Startup"
echo "=========================================="
echo ""

# Check if docker-compose file exists
if [ ! -f "docker-compose.yml" ]; then
    echo "ERROR: docker-compose.yml not found in current directory"
    echo "Please run this script from the repository root directory"
    exit 1
fi

# Check if .env file exists, if not warn user
if [ ! -f ".env" ]; then
    echo "WARNING: .env file not found. Using default environment variables."
    echo "You may want to create a .env file with custom settings."
    echo ""
fi

echo "Starting Docker containers..."
echo ""

# Start postgres (always required)
echo "[1/4] Starting PostgreSQL database..."
docker-compose up -d postgres

# Wait for postgres to be healthy
echo "Waiting for PostgreSQL to be healthy..."
for i in {1..30}; do
    if docker-compose exec -T postgres pg_isready -U postgres -d trading_platform &>/dev/null; then
        echo "✓ PostgreSQL is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "✗ PostgreSQL failed to start"
        exit 1
    fi
    echo "  Waiting... ($i/30)"
    sleep 2
done

echo ""

# Start kafka
echo "[2/4] Starting Apache Kafka..."
docker-compose --profile kafka up -d kafka

# Wait for kafka to be healthy
echo "Waiting for Kafka to be healthy..."
for i in {1..40}; do
    if docker-compose exec -T kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list &>/dev/null; then
        echo "✓ Kafka is ready"
        break
    fi
    if [ $i -eq 40 ]; then
        echo "✗ Kafka failed to start"
        exit 1
    fi
    echo "  Waiting... ($i/40)"
    sleep 2
done

echo ""

# Start trade-api
echo "[3/4] Starting Trade REST API..."
docker-compose --profile platform up -d trade-api

# Wait for trade-api to be healthy
echo "Waiting for Trade API to be healthy..."
for i in {1..20}; do
    if docker-compose exec -T trade-api curl -fsS http://localhost:8080/actuator/health &>/dev/null; then
        echo "✓ Trade API is ready"
        break
    fi
    if [ $i -eq 20 ]; then
        echo "⚠ Trade API is starting but may not be fully ready yet (will continue anyway)"
        break
    fi
    echo "  Waiting... ($i/20)"
    sleep 2
done

echo ""

# Start executor
echo "[4/4] Starting Trade Executor..."
docker-compose --profile platform up -d executor

# Wait for executor to be healthy
echo "Waiting for Executor to be healthy..."
for i in {1..30}; do
    if docker-compose exec -T executor curl -fsS http://localhost:8083/actuator/health &>/dev/null; then
        echo "✓ Executor is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "⚠ Executor is starting but may not be fully ready yet (will continue anyway)"
        break
    fi
    echo "  Waiting... ($i/30)"
    sleep 2
done

echo ""
echo "=========================================="
echo "✓ All containers are starting/running!"
echo "=========================================="
echo ""
echo "Container Status:"
docker-compose ps
echo ""
echo "Services available at:"
echo "  - PostgreSQL:  localhost:5432"
echo "  - Kafka:       localhost:9092"
echo "  - Trade API:   http://localhost:8080"
echo "  - Executor:    http://localhost:8083"
echo ""
echo "Next step: Run 'bash infra/kafka/create-topics.sh' to create Kafka topics"
echo ""
