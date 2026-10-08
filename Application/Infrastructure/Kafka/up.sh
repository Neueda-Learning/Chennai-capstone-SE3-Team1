#!/usr/bin/env bash
# Restarts Kafka from scratch and proves it is ready to be hit.
#
#   1. Uses the repository's one .env (created from .env.example if missing) and sets
#      KAFKA_ADVERTISED_HOST to this box's reachable address while it is still "localhost".
#   2. Always stops Kafka and discards its data (down -v), then starts a fresh container.
#   3. Waits for the container to report healthy.
#   4. Creates the six contracted topics (scripts/create-topics.sh).
#   5. Runs every check below and exits 1 if any fails, printing the broker log.
#
# Run it as:  bash Application/Infrastructure/Kafka/up.sh [--port PORT]
#   --port PORT  the port Kafka listens on, publishes and advertises to clients. Default: KAFKA_PORT
#                in .env, else 29092. The choice is saved to .env, so a later run keeps it.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
REPO_ROOT="$(cd ../../.. && pwd)"

log() { printf '[kafka] %s\n' "$*"; }
die() { printf '[kafka] ERROR: %s\n' "$*" >&2; exit 1; }

CONTAINER="team1_kafka"          # container_name in docker-compose.yml
KAFKA_BIN="/opt/kafka/bin"
EXTERNAL_PORT=29092              # PLAINTEXT listener: published to the host and advertised to clients (set below)
INTERNAL_PORT=19092              # INTERNAL listener: reachable only inside the container network
CONTROLLER_PORT=29093            # KRaft controller listener, also container-internal
INTERNAL_ADDR="kafka:$INTERNAL_PORT"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-240}"

usage() {
    cat <<'EOF'
Usage: bash Application/Infrastructure/Kafka/up.sh [--port PORT]

Restarts Kafka from scratch, creates the topics and checks that it works.

  --port PORT   The port Kafka listens on, is published on and advertises to clients,
                1024-65535. Default: KAFKA_PORT in the repository's .env, else 29092.
                The choice is saved to .env, so a later run without --port keeps it.
  -h, --help    Show this help.
EOF
}

REQUESTED_PORT=""
while [ $# -gt 0 ]; do
    case "$1" in
        --port)   [ $# -ge 2 ] || die "--port needs a value"; REQUESTED_PORT="$2"; shift 2 ;;
        --port=*) REQUESTED_PORT="${1#--port=}"; shift ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; die "unknown argument: $1" ;;
    esac
done

valid_port() { case "$1" in ''|*[!0-9]*) return 1 ;; esac; [ "$1" -ge 1024 ] && [ "$1" -le 65535 ]; }
if [ -n "$REQUESTED_PORT" ]; then
    valid_port "$REQUESTED_PORT" || die "--port must be a number from 1024 to 65535 (got '$REQUESTED_PORT')"
    case "$REQUESTED_PORT" in
        "$INTERNAL_PORT"|"$CONTROLLER_PORT") die "port $REQUESTED_PORT is used by Kafka's own internal/controller listeners; choose another with --port" ;;
    esac
fi

# ------------------------------------------------------------------ 1. environment
# The repository's one .env, at its root (ENV_FILE overrides the location).
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env}"
if [ ! -f "$ENV_FILE" ]; then
    cp "$REPO_ROOT/.env.example" "$ENV_FILE"
    log "$ENV_FILE created from .env.example"
fi

env_value() { { grep -E "^$1=" "$ENV_FILE" || true; } | tail -n 1 | cut -d= -f2- | tr -d '\r'; }

if ! grep -q '^KAFKA_ADVERTISED_HOST=' "$ENV_FILE" || grep -q '^KAFKA_ADVERTISED_HOST=localhost$' "$ENV_FILE"; then
    ip=""
    ip=$(curl -fsS --max-time 2 http://169.254.169.254/latest/meta-data/local-ipv4 2>/dev/null) || ip=""
    if [ -z "$ip" ]; then
        ip=$(hostname -I 2>/dev/null | awk '{print $1}') || ip=""
    fi
    if [ -n "$ip" ]; then
        if grep -q '^KAFKA_ADVERTISED_HOST=' "$ENV_FILE"; then
            sed -i.bak "s|^KAFKA_ADVERTISED_HOST=.*|KAFKA_ADVERTISED_HOST=${ip}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
        else
            printf 'KAFKA_ADVERTISED_HOST=%s\n' "$ip" >> "$ENV_FILE"
        fi
        log "KAFKA_ADVERTISED_HOST set to detected address $ip"
    else
        log "could not auto-detect this host's IP - edit KAFKA_ADVERTISED_HOST in $ENV_FILE by hand, then re-run"
    fi
else
    log "KAFKA_ADVERTISED_HOST already set in $ENV_FILE, leaving it alone"
fi

ADVERTISED_HOST="$(env_value KAFKA_ADVERTISED_HOST)"
ADVERTISED_HOST="${ADVERTISED_HOST:-localhost}"

# The port: --port, else KAFKA_PORT from .env, else the default. The compose file uses this one
# number for the listener, the advertised address, the published port and the healthcheck.
if [ -n "$REQUESTED_PORT" ]; then
    EXTERNAL_PORT="$REQUESTED_PORT"
else
    EXTERNAL_PORT="$(env_value KAFKA_PORT)"
    EXTERNAL_PORT="${EXTERNAL_PORT:-29092}"
    valid_port "$EXTERNAL_PORT" || die "KAFKA_PORT in $ENV_FILE is '$EXTERNAL_PORT', which is not a port number from 1024 to 65535"
fi
case "$EXTERNAL_PORT" in
    "$INTERNAL_PORT"|"$CONTROLLER_PORT") die "port $EXTERNAL_PORT is used by Kafka's own internal/controller listeners; choose another with --port" ;;
esac
if [ "$(env_value KAFKA_PORT)" != "$EXTERNAL_PORT" ]; then
    if grep -q '^KAFKA_PORT=' "$ENV_FILE"; then
        sed -i.bak "s|^KAFKA_PORT=.*|KAFKA_PORT=${EXTERNAL_PORT}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
    else
        printf 'KAFKA_PORT=%s\n' "$EXTERNAL_PORT" >> "$ENV_FILE"
    fi
    log "KAFKA_PORT set to $EXTERNAL_PORT in $ENV_FILE"
fi
# Compose lets an exported variable override --env-file, so make sure a stale one cannot.
export KAFKA_PORT="$EXTERNAL_PORT" KAFKA_ADVERTISED_HOST="$ADVERTISED_HOST"

# ------------------------------------------------------------------ 2. docker
command -v docker >/dev/null 2>&1 || die "docker is not on PATH"
if docker compose version >/dev/null 2>&1; then
    compose() { docker compose --env-file "$ENV_FILE" "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
    compose() { docker-compose --env-file "$ENV_FILE" "$@"; }
else
    die "neither 'docker compose' nor 'docker-compose' is available on PATH"
fi
docker info >/dev/null 2>&1 || die "cannot reach the Docker daemon (is it running, and is this user in the docker group?)"

# ------------------------------------------------------------------ 3. restart from scratch
log "stopping Kafka and discarding its data"
compose down -v --remove-orphans
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

# This Kafka was just removed, so anything still answering on the port is somebody else's.
if timeout 2 bash -c "exec 3<>/dev/tcp/127.0.0.1/$EXTERNAL_PORT" 2>/dev/null; then
    die "port $EXTERNAL_PORT on this machine is already in use by another process; stop it, or pick another port with --port"
fi

log "starting a fresh Kafka (advertising ${ADVERTISED_HOST}:${EXTERNAL_PORT})"
compose up -d

container_status() {
    docker inspect -f '{{if .State.Running}}{{if .State.Health}}{{.State.Health.Status}}{{else}}running{{end}}{{else}}exited{{end}}' \
        "$CONTAINER" 2>/dev/null || echo missing
}

broker_log() { docker logs --tail "${1:-40}" "$CONTAINER" 2>&1 | sed 's/^/[kafka log] /' >&2 || true; }

log "waiting for the container to become healthy (up to ${HEALTH_TIMEOUT}s)"
waited=0
status="starting"
while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    status="$(container_status)"
    case "$status" in
        healthy) break ;;
        exited|missing) broker_log; die "the Kafka container is $status" ;;
    esac
    sleep 3
    waited=$((waited + 3))
    if [ $((waited % 15)) -eq 0 ]; then log "  still $status after ${waited}s"; fi
done
if [ "$status" != "healthy" ]; then
    broker_log
    die "Kafka was not healthy after ${HEALTH_TIMEOUT}s (status: $status)"
fi
log "container is healthy after about ${waited}s"

# ------------------------------------------------------------------ 4. topics
log "creating the contracted topics"
if ! topics_out="$(KAFKA_CONTAINER="$CONTAINER" KAFKA_BOOTSTRAP_SERVERS="localhost:$EXTERNAL_PORT" bash "$SCRIPT_DIR/scripts/create-topics.sh" 2>&1)"; then
    printf '%s\n' "$topics_out" >&2
    broker_log
    die "topic creation failed; a timeout here usually means KAFKA_ADVERTISED_HOST ($ADVERTISED_HOST) is wrong or unreachable from inside the container - check $ENV_FILE"
fi

# ------------------------------------------------------------------ 5. checks
# No stdin is attached to docker exec here: it would swallow the input of the read loop below.
kx() { docker exec "$CONTAINER" "$@"; }
kafka_topics() { kx "$KAFKA_BIN/kafka-topics.sh" "$@"; }

PASSED=0
FAILED=0
run_check() {
    local name=$1 fn=$2 out
    if out="$("$fn" 2>&1)"; then
        printf '  PASS  %s\n' "$name"
        PASSED=$((PASSED + 1))
    else
        printf '  FAIL  %s\n' "$name"
        FAILED=$((FAILED + 1))
        if [ -n "$out" ]; then printf '%s\n' "$out" | tail -n 6 | sed 's/^/          /'; fi
    fi
}

check_external_listener() {
    kafka_topics --bootstrap-server "localhost:$EXTERNAL_PORT" --list >/dev/null || {
        echo "the broker is up but does not answer through its advertised address ${ADVERTISED_HOST}:${EXTERNAL_PORT} - check KAFKA_ADVERTISED_HOST in $ENV_FILE"
        return 1
    }
}

check_internal_listener() {
    kafka_topics --bootstrap-server "$INTERNAL_ADDR" --list >/dev/null
}

check_topics_match_contract() {
    local n=0 rc=0 name parts ret desc led
    while read -r _ name parts ret; do
        n=$((n + 1))
        if ! desc="$(kafka_topics --bootstrap-server "localhost:$EXTERNAL_PORT" --describe --topic "$name" 2>&1)"; then
            echo "$name: not found"
            rc=1
            continue
        fi
        printf '%s\n' "$desc" | grep -Eq "PartitionCount: ${parts}([[:space:]]|\$)" || { echo "$name: expected $parts partitions"; rc=1; }
        printf '%s\n' "$desc" | grep -q "retention.ms=${ret}" || { echo "$name: expected retention.ms=$ret"; rc=1; }
        led="$(printf '%s\n' "$desc" | grep -Ec 'Leader: 1[[:space:]].*Isr: 1' || true)"
        [ "$led" = "$parts" ] || { echo "$name: $led of $parts partitions have a leader with an in-sync replica"; rc=1; }
    done < <(tr -d '\r' < "$SCRIPT_DIR/scripts/create-topics.sh" | grep -E '^create_topic [^ ]+ [0-9]+ [0-9]+$')
    [ "$n" -ge 6 ] || { echo "read only $n topic definitions from scripts/create-topics.sh, expected 6"; rc=1; }
    return $rc
}

check_auto_create_disabled() {
    local cfg
    cfg="$(kx "$KAFKA_BIN/kafka-configs.sh" --bootstrap-server "localhost:$EXTERNAL_PORT" \
        --entity-type brokers --entity-name 1 --describe --all 2>&1)" || { echo "$cfg"; return 1; }
    printf '%s\n' "$cfg" | grep -q 'auto.create.topics.enable=false' || {
        echo "auto.create.topics.enable is not false, so a mistyped topic name would be created silently"
        return 1
    }
}

check_round_trip() {
    local topic="up-sh-smoke-$(date +%s)-$$" msg="up.sh-$(date +%s%N)" got="" rc=0
    kafka_topics --bootstrap-server "localhost:$EXTERNAL_PORT" --create --topic "$topic" \
        --partitions 1 --replication-factor 1 >/dev/null || return 1
    if printf '%s\n' "$msg" | docker exec -i "$CONTAINER" "$KAFKA_BIN/kafka-console-producer.sh" \
        --bootstrap-server "localhost:$EXTERNAL_PORT" --topic "$topic" >/dev/null; then
        got="$(kx "$KAFKA_BIN/kafka-console-consumer.sh" --bootstrap-server "localhost:$EXTERNAL_PORT" \
            --topic "$topic" --from-beginning --max-messages 1 --timeout-ms 20000 2>/dev/null)" || rc=1
        [ "$got" = "$msg" ] || rc=1
    else
        rc=1
    fi
    kafka_topics --bootstrap-server "localhost:$EXTERNAL_PORT" --delete --topic "$topic" >/dev/null 2>&1 || true
    if [ "$rc" -ne 0 ]; then
        echo "a message produced to a scratch topic did not come back (got: '${got}')"
        echo "if the other checks passed, the advertised address ${ADVERTISED_HOST}:${EXTERNAL_PORT} is not reachable from inside the container"
    fi
    return $rc
}

check_host_port() {
    timeout 5 bash -c "exec 3<>/dev/tcp/127.0.0.1/$EXTERNAL_PORT" || {
        echo "nothing accepts connections on 127.0.0.1:$EXTERNAL_PORT"
        return 1
    }
}

check_advertised_address() {
    timeout 5 bash -c "exec 3<>/dev/tcp/$ADVERTISED_HOST/$EXTERNAL_PORT" || {
        echo "${ADVERTISED_HOST}:${EXTERNAL_PORT} does not accept connections from this machine - fix KAFKA_ADVERTISED_HOST in $ENV_FILE"
        return 1
    }
}

echo
log "running checks"
run_check "broker answers on the external listener (localhost:$EXTERNAL_PORT)" check_external_listener
run_check "broker answers on the internal listener ($INTERNAL_ADDR)"           check_internal_listener
run_check "six topics exist with the contracted partitions, retention and leaders" check_topics_match_contract
run_check "automatic topic creation is off"                                     check_auto_create_disabled
run_check "a message produced to a scratch topic is consumed back"              check_round_trip
run_check "port $EXTERNAL_PORT is open on this machine (127.0.0.1)"             check_host_port
run_check "advertised address ${ADVERTISED_HOST}:${EXTERNAL_PORT} is reachable from this machine" check_advertised_address

echo
if [ "$FAILED" -gt 0 ]; then
    log "$FAILED of $((PASSED + FAILED)) checks FAILED - Kafka is NOT ready"
    broker_log
    exit 1
fi

log "all $PASSED checks passed - Kafka is ready at ${ADVERTISED_HOST}:${EXTERNAL_PORT}"
if [ "$ADVERTISED_HOST" = "localhost" ]; then
    log "WARNING: it advertises 'localhost', so only clients on this machine can use it; set KAFKA_ADVERTISED_HOST in $ENV_FILE and re-run"
else
    # run-local.ps1 probes 29092 then 9092 by itself; any other port has to be given.
    case "$EXTERNAL_PORT" in 29092|9092) port_arg="" ;; *) port_arg=" -KafkaPort $EXTERNAL_PORT" ;; esac
    log "open TCP $EXTERNAL_PORT in the security group / firewall for the Windows machines if it is not already"
    log "from each Windows machine:  Test-NetConnection $ADVERTISED_HOST -Port $EXTERNAL_PORT"
    log "then:                       .\\run-local.ps1 -KafkaHosted -KafkaHost $ADVERTISED_HOST$port_arg"
fi
