#!/usr/bin/env bash
set -Eeuo pipefail

# Creates the six contracted topics (three source + three dead-letter) on the
# team's broker. Idempotent: safe to run as many times as you like.
#
# Run from the repository root:
#   docker compose -f infra/kafka/docker-compose.yml up -d
#   wsl bash infra/kafka/create-topics.sh        (or bash in Git Bash/WSL)

KAFKA_BOOTSTRAP_SERVERS="${KAFKA_BOOTSTRAP_SERVERS:-localhost:9092}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/kafka/docker-compose.yml}"

if command -v docker >/dev/null 2>&1; then
    DOCKER=docker
elif [ -x "/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe" ]; then
    DOCKER="/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe"
elif command -v docker.exe >/dev/null 2>&1; then
    DOCKER=docker.exe
else
    echo "docker not found on PATH" >&2
    exit 1
fi

kafka_topics() {
    if "$DOCKER" compose -f "$COMPOSE_FILE" ps -q kafka >/dev/null 2>&1; then
        "$DOCKER" compose -f "$COMPOSE_FILE" exec -T kafka \
            /opt/kafka/bin/kafka-topics.sh "$@"
    else
        /opt/kafka/bin/kafka-topics.sh "$@"
    fi
}

create_topic() {
    name=$1
    partitions=$2
    retention_ms=$3
    kafka_topics --bootstrap-server "$KAFKA_BOOTSTRAP_SERVERS" --create \
        --if-not-exists \
        --topic "$name" \
        --partitions "$partitions" \
        --replication-factor 1 \
        --config "retention.ms=$retention_ms"
}

create_topic orders 3 604800000
create_topic trade-events 3 2592000000
create_topic market-data 6 86400000

create_topic orders.DLT 3 604800000
create_topic trade-events.DLT 3 2592000000
create_topic market-data.DLT 6 86400000

echo "--- catalogue ---"
kafka_topics --bootstrap-server "$KAFKA_BOOTSTRAP_SERVERS" --list
echo "--- detail ---"
kafka_topics --bootstrap-server "$KAFKA_BOOTSTRAP_SERVERS" --describe