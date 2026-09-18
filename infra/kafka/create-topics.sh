#!/usr/bin/env bash
set -Eeuo pipefail

# Creates the six contracted topics (three source + three dead-letter) on the
# broker. Idempotent: safe to run as many times as you like. run-local.ps1 on
# Windows does this too (against this same broker, from the other side of the
# network) - this script is the Linux-side equivalent, for testing Kafka on
# its own without the rest of the stack running.
#
# This script itself can be run from anywhere (it resolves the compose file relative to
# its own location, not the caller's working directory) - but starting Kafka in the first
# place needs `.env` next to docker-compose.yml, so that part has to run from there:
#   cd infra/kafka && docker-compose up -d
#   bash infra/kafka/create-topics.sh   # from anywhere

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
KAFKA_BOOTSTRAP_SERVERS="${KAFKA_BOOTSTRAP_SERVERS:-localhost:9092}"
KAFKA_SERVICE="${KAFKA_SERVICE:-kafka}"

if docker compose version >/dev/null 2>&1; then
    compose_cmd() {
        docker compose -f "$COMPOSE_FILE" "$@"
    }
elif command -v docker-compose >/dev/null 2>&1; then
    compose_cmd() {
        docker-compose -f "$COMPOSE_FILE" "$@"
    }
else
    echo "Neither 'docker compose' nor 'docker-compose' is available on PATH" >&2
    exit 1
fi

kafka_topics() {
    compose_cmd exec -T "$KAFKA_SERVICE" \
        /opt/kafka/bin/kafka-topics.sh "$@"
}

create_topic() {
    local name=$1
    local partitions=$2
    local retention_ms=$3

    kafka_topics \
        --bootstrap-server "$KAFKA_BOOTSTRAP_SERVERS" \
        --create \
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