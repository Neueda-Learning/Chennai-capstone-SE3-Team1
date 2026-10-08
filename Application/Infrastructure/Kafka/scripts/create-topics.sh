#!/usr/bin/env bash
# Creates the six contracted topics on the running Kafka container (idempotent), then lists and
# describes everything. up.sh calls this after every restart and reads the create_topic lines
# below as the definition it verifies, so keep them in the form: create_topic <name> <partitions> <retention-ms>
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KAFKA_CONTAINER="${KAFKA_CONTAINER:-team1_kafka}"

# Unless told otherwise, use the port up.sh last started Kafka on (KAFKA_PORT in the repo-root .env).
if [ -z "${KAFKA_BOOTSTRAP_SERVERS:-}" ]; then
    port=""
    if [ -f "$SCRIPT_DIR/../../../../.env" ]; then
        port="$({ grep -E '^KAFKA_PORT=' "$SCRIPT_DIR/../../../../.env" || true; } | tail -n 1 | cut -d= -f2- | tr -d '\r')"
    fi
    KAFKA_BOOTSTRAP_SERVERS="localhost:${port:-29092}"
fi

if ! command -v docker >/dev/null 2>&1; then
    echo "docker is not on PATH" >&2
    exit 1
fi
if ! docker inspect -f '{{.State.Running}}' "$KAFKA_CONTAINER" 2>/dev/null | grep -q true; then
    echo "container $KAFKA_CONTAINER is not running - start it with: bash Application/Infrastructure/Kafka/up.sh" >&2
    exit 1
fi

kafka_topics() {
    docker exec "$KAFKA_CONTAINER" /opt/kafka/bin/kafka-topics.sh "$@"
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
