#!/usr/bin/env bash
# One-shot local bring-up of the trading platform on Linux/Ubuntu:
# Kafka, Postgres schema, auth service, Trade API, Trade Executor, merged log tail.
#
# Usage:
#   ./run-local.sh                          # prompts for TrustMe password; Kafka runs locally
#   ./run-local.sh --no-vault               # secrets from .env
#   ./run-local.sh --skip-build             # fast restart
#   ./run-local.sh --kafka-hosted --kafka-host 10.8.65.2
#   ./run-local.sh --tail-only
#   ./run-local.sh --stop

set -euo pipefail

# ------------------------------------------------------------------ defaults
TRUSTME_PASSWORD=""
NO_VAULT=false
KAFKA_HOSTED=false
KAFKA_HOST_ARG=""
KAFKA_PORT_ARG=0
KAFKA_HOME="${KAFKA_HOME:-/opt/kafka}"
SKIP_BUILD=false
RESET_DB=false
NO_TAIL=false
TAIL_ONLY=false
STOP=false

# ------------------------------------------------------------------ argument parsing
while [[ $# -gt 0 ]]; do
    case "$1" in
        --trustme-password) TRUSTME_PASSWORD="$2"; shift 2 ;;
        --no-vault)         NO_VAULT=true;          shift ;;
        --kafka-hosted)     KAFKA_HOSTED=true;      shift ;;
        --kafka-host)       KAFKA_HOST_ARG="$2";    shift 2 ;;
        --kafka-port)       KAFKA_PORT_ARG="$2";    shift 2 ;;
        --kafka-home)       KAFKA_HOME="$2";        shift 2 ;;
        --skip-build)       SKIP_BUILD=true;        shift ;;
        --reset-db)         RESET_DB=true;          shift ;;
        --no-tail)          NO_TAIL=true;           shift ;;
        --tail-only)        TAIL_ONLY=true;         shift ;;
        --stop)             STOP=true;              shift ;;
        *) echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY_FILE="$REPO_ROOT/leapcapstoneteam1-720d03.TM"
LOG_DIR="$REPO_ROOT/logs/local"
PID_FILE="$LOG_DIR/pids.json"
AUTH_DIR="$REPO_ROOT/Application/Services/auth-service"
AUTH_MAIN="$AUTH_DIR/dist/main.js"

declare -A TOPICS=(
    [orders]=3
    [trade-events]=3
    [market-data]=6
    [orders.DLT]=3
    [trade-events.DLT]=3
    [market-data.DLT]=6
)

mkdir -p "$LOG_DIR"

say()  { echo ""; echo "==> $1"; }
fail() { echo "ERROR: $1" >&2; exit 1; }

test_port() {
    local host="$1" port="$2"
    timeout 2 bash -c ">/dev/tcp/$host/$port" 2>/dev/null
}

find_kafka_port() {
    local host="$1"; shift
    for p in "$@"; do
        if test_port "$host" "$p" 2>/dev/null; then echo "$p"; return 0; fi
    done
    return 1
}

# ------------------------------------------------------------------ env file reader
read_env_file() {
    local path="$1"
    [[ -f "$path" ]] || return 0
    while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line#"${line%%[![:space:]]*}"}"   # ltrim
        [[ -z "$line" || "$line" == \#* ]] && continue
        local eq_pos="${line%%=*}"
        [[ "$eq_pos" == "$line" ]] && continue
        local key="${eq_pos}"
        local val="${line#*=}"
        # strip surrounding quotes
        if [[ ( "${val:0:1}" == '"' && "${val: -1}" == '"' ) || \
              ( "${val:0:1}" == "'" && "${val: -1}" == "'" ) ]]; then
            val="${val:1:${#val}-2}"
        fi
        # only set if not already in environment
        [[ -z "${!key+x}" ]] && export "$key=$val"
    done < "$path"
}

# Load services.env then .env (both override by real env vars already set)
read_env_file "$REPO_ROOT/Application/Config/services.env"
read_env_file "$REPO_ROOT/.env"

get_svc() {
    local name="$1"
    local val="${!name:-}"
    [[ -n "$val" ]] || fail "$name is not set. It belongs in Application/Config/services.env."
    echo "$val"
}

KAFKA_VER="$(get_svc KAFKA_VERSION)"
KAFKA_DOWNLOAD_BASE="$(get_svc KAFKA_DOWNLOAD_BASE_URL)"
KAFKA_URL="${KAFKA_DOWNLOAD_BASE}/${KAFKA_VER}/kafka_2.13-${KAFKA_VER}.tgz"
API_HOST="$(get_svc TRADE_API_HOST)"
API_PORT="$(get_svc TRADE_API_PORT)"
EXEC_HOST="$(get_svc EXECUTOR_HOST)"
EXEC_PORT="$(get_svc EXECUTOR_PORT)"
AUTH_HOST_SVC="$(get_svc AUTH_SERVICE_HOST)"
AUTH_PORT="$(get_svc AUTH_SERVICE_PORT)"
POSTGRES_PORT="$(get_svc POSTGRES_PORT)"
KAFKA_CONTROLLER_PORT="$(get_svc KAFKA_CONTROLLER_PORT)"

if [[ $KAFKA_PORT_ARG -ne 0 ]]; then
    KAFKA_PORT_LIST=("$KAFKA_PORT_ARG")
else
    KAFKA_PORT_LIST=("$(get_svc KAFKA_PORT)" "$(get_svc KAFKA_LEGACY_PORT)")
fi
KAFKA_PORT="${KAFKA_PORT_LIST[0]}"

wait_until() {
    local label="$1" test_cmd="$2" seconds="${3:-120}"
    local start=$SECONDS
    while (( SECONDS - start < seconds )); do
        if eval "$test_cmd" 2>/dev/null; then
            echo "    $label ready ($((SECONDS - start))s)"
            return 0
        fi
        sleep 2
    done
    echo "    $label NOT ready after ${seconds}s"
    return 1
}

get_health() {
    local host="$1" port="$2"
    local status
    status=$(curl -sf --max-time 5 "http://${host}:${port}/actuator/health" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null) || return 1
    [[ "$status" == "UP" ]]
}

get_auth_health() {
    local status
    status=$(curl -sf --max-time 5 "http://${AUTH_HOST_SVC}:${AUTH_PORT}/health" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null) || return 1
    [[ "$status" == "ok" ]]
}

read_pids() {
    [[ -f "$PID_FILE" ]] || return 0
    cat "$PID_FILE"
}

stop_tracked() {
    local name="$1" pid="$2"
    [[ -z "$pid" || "$pid" == "null" ]] && return 0
    if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null && echo "    stopped $name (pid $pid)"
    else
        echo "    $name (pid $pid) already gone"
    fi
}

# ------------------------------------------------------------------ --stop
if $STOP; then
    say "Stopping services"
    if [[ ! -f "$PID_FILE" ]]; then echo "    nothing tracked in $PID_FILE"; exit 0; fi
    executor_pid=$(python3 -c "import json,sys; d=json.load(open('$PID_FILE')); print(d.get('executor',''))" 2>/dev/null)
    api_pid=$(python3      -c "import json,sys; d=json.load(open('$PID_FILE')); print(d.get('api',''))"      2>/dev/null)
    auth_pid=$(python3     -c "import json,sys; d=json.load(open('$PID_FILE')); print(d.get('auth',''))"     2>/dev/null)
    kafka_pid=$(python3    -c "import json,sys; d=json.load(open('$PID_FILE')); print(d.get('kafka',''))"    2>/dev/null)
    stop_tracked "executor"  "$executor_pid"
    stop_tracked "trade-api" "$api_pid"
    stop_tracked "auth"      "$auth_pid"
    if [[ -n "$kafka_pid" && "$kafka_pid" != "None" ]]; then
        stop_tracked "kafka" "$kafka_pid"
    else
        echo "    kafka: nothing tracked locally"
    fi
    rm -f "$PID_FILE"
    exit 0
fi

if $TAIL_ONLY; then
    KAFKA_LIBS="$KAFKA_HOME/libs/*"
    say "Attached to running services (PIDs in $PID_FILE)"
else

# ------------------------------------------------------------------ 1. prerequisites
say "Checking prerequisites"
for tool in java mvn python3 node npm psql; do
    command -v "$tool" >/dev/null 2>&1 || fail "$tool not on PATH"
done
[[ -f "$AUTH_DIR/package.json" ]] || fail "auth service missing: $AUTH_DIR"
test_port "127.0.0.1" "$POSTGRES_PORT" || fail "Postgres is not listening on $POSTGRES_PORT (start postgresql)"

USE_VAULT=false
if ! $NO_VAULT && [[ -f "$KEY_FILE" ]]; then
    USE_VAULT=true
fi
if $USE_VAULT && [[ -z "$TRUSTME_PASSWORD" ]]; then
    read -rsp "TrustMe key file password (Enter to use .env instead): " TRUSTME_PASSWORD
    echo ""
fi
[[ -z "$TRUSTME_PASSWORD" ]] && USE_VAULT=false

if $USE_VAULT; then
    python3 -c "import trustme_secrets" 2>/dev/null \
        || fail "python module trustme_secrets missing (pip install trustme-secrets), or run with --no-vault"
    unset TRUSTME_KEY_FILE
    SECRET_SOURCE="the TrustMe vault"
else
    [[ -f "$REPO_ROOT/.env" ]] || fail "no TrustMe vault in use and no .env: copy .env.example to .env and fill it in"
    export TRUSTME_KEY_FILE="vault-disabled-by-run-local"
    SECRET_SOURCE=".env"
fi

if $KAFKA_HOSTED && [[ -z "$KAFKA_HOST_ARG" ]]; then
    read -rp "Kafka host (the box running Application/Infrastructure/Kafka/up.sh): " KAFKA_HOST_ARG
fi
$KAFKA_HOSTED && [[ -z "$KAFKA_HOST_ARG" ]] && fail "Kafka host required with --kafka-hosted"

echo "    java: $(java -version 2>&1 | head -1)"
echo "    psql, python3, postgres: ok; secrets from $SECRET_SOURCE"

PY_TRUST=()
if $USE_VAULT; then
    PY_TRUST=("-X" "trustme_password=$TRUSTME_PASSWORD" "-X" "trustme_keyfile=$KEY_FILE")
fi

db_lines=$(python3 "${PY_TRUST[@]}" -c "
import sys; sys.path.insert(0, 'scripts')
from db_config import DbConfig
c = DbConfig.resolve()
print(c.host); print(c.port); print(c.dbname); print(c.user); print(c.password)
" 2>/dev/null) || fail "could not read database settings from $SECRET_SOURCE"

mapfile -t DB_FIELDS <<< "$db_lines"
[[ ${#DB_FIELDS[@]} -ge 5 ]] || fail "could not parse database settings"
DB_HOST="${DB_FIELDS[0]}"; DB_PORT="${DB_FIELDS[1]}"; DB_NAME="${DB_FIELDS[2]}"
DB_USER="${DB_FIELDS[3]}"; DB_PASS="${DB_FIELDS[4]}"
echo "    database settings: ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME} (from $SECRET_SOURCE)"

JWT_SECRET=$(python3 "${PY_TRUST[@]}" -c "
import sys; sys.path.insert(0, 'scripts')
from vault_env import secret
print(secret('JWT_SECRET') or '')
" 2>/dev/null) || fail "could not read JWT_SECRET from $SECRET_SOURCE"
[[ -n "$JWT_SECRET" ]] || fail "could not read JWT_SECRET from $SECRET_SOURCE"
[[ ${#JWT_SECRET} -ge 32 ]] || fail "JWT_SECRET ($SECRET_SOURCE) must be at least 32 characters"

# ------------------------------------------------------------------ 2. kafka
KAFKA_LIBS="$KAFKA_HOME/libs/*"
KAFKA_CFG="$KAFKA_HOME/config/kraft/server.properties"
KAFKA_LOG4J="file:$KAFKA_HOME/config/log4j.properties"
TOOLS_LOG4J="file:$KAFKA_HOME/config/tools-log4j.properties"

if $KAFKA_HOSTED; then
    say "Kafka CLI tools ($KAFKA_VER, cached at $KAFKA_HOME) -> broker at ${KAFKA_HOST_ARG}, port ${KAFKA_PORT_LIST[*]}"
else
    say "Kafka $KAFKA_VER at $KAFKA_HOME"
fi

if [[ ! -f "$KAFKA_CFG" ]]; then
    echo "    downloading $KAFKA_URL"
    mkdir -p "$KAFKA_HOME"
    curl -L "$KAFKA_URL" -o "$KAFKA_HOME/kafka.tgz"
    tar -xzf "$KAFKA_HOME/kafka.tgz" -C "$KAFKA_HOME" --strip-components=1
    rm "$KAFKA_HOME/kafka.tgz"
fi

KAFKA_PID=""
if $KAFKA_HOSTED; then
    found_port=""
    start_ts=$SECONDS
    while [[ -z "$found_port" ]] && (( SECONDS - start_ts < 30 )); do
        for p in "${KAFKA_PORT_LIST[@]}"; do
            if test_port "$KAFKA_HOST_ARG" "$p" 2>/dev/null; then found_port="$p"; break; fi
        done
        [[ -z "$found_port" ]] && sleep 2
    done
    [[ -n "$found_port" ]] || fail "Can't reach Kafka at ${KAFKA_HOST_ARG} on port ${KAFKA_PORT_LIST[*]}"
    KAFKA_PORT="$found_port"
    echo "    kafka ${KAFKA_HOST_ARG}:${KAFKA_PORT} ready ($((SECONDS - start_ts))s)"
    KAFKA_BOOTSTRAP="${KAFKA_HOST_ARG}:${KAFKA_PORT}"
else
    KAFKA_DATA_DIR="/tmp/kraft-combined-logs"
    existing_kafka_pid=""
    if [[ -f "$PID_FILE" ]]; then
        existing_kafka_pid=$(python3 -c "import json; d=json.load(open('$PID_FILE')); print(d.get('kafka') or '')" 2>/dev/null)
    fi

    listening_port=""
    for p in "${KAFKA_PORT_LIST[@]}"; do
        if test_port "127.0.0.1" "$p" 2>/dev/null; then listening_port="$p"; break; fi
    done

    if [[ -n "$existing_kafka_pid" && -n "$listening_port" ]] && kill -0 "$existing_kafka_pid" 2>/dev/null; then
        KAFKA_PORT="$listening_port"
        echo "    broker already running (pid $existing_kafka_pid) on $KAFKA_PORT"
        KAFKA_PID="$existing_kafka_pid"
    elif [[ -n "$listening_port" ]]; then
        KAFKA_PORT="$listening_port"
        echo "    something else already listens on $KAFKA_PORT; using it"
    else
        # Wipe and reformat KRaft storage (fresh start every time, DB is source of truth)
        rm -rf "$KAFKA_DATA_DIR"
        echo "    formatting KRaft storage"
        STORAGE_ID=$(java "-Dlog4j.configuration=$TOOLS_LOG4J" -cp "$KAFKA_LIBS" \
            kafka.tools.StorageTool random-uuid 2>/dev/null | tail -1 | tr -d '[:space:]')
        java "-Dlog4j.configuration=$TOOLS_LOG4J" -cp "$KAFKA_LIBS" \
            kafka.tools.StorageTool format -t "$STORAGE_ID" -c "$KAFKA_CFG" >/dev/null

        java -Xms256m -Xmx512m \
            "-Dlog4j.configuration=$KAFKA_LOG4J" \
            "-Dkafka.logs.dir=$LOG_DIR" \
            -cp "$KAFKA_LIBS" kafka.Kafka "$KAFKA_CFG" \
            --override log.cleaner.enable=false \
            --override log.retention.hours=876000 \
            --override "listeners=PLAINTEXT://:${KAFKA_PORT},CONTROLLER://:${KAFKA_CONTROLLER_PORT}" \
            --override "controller.quorum.voters=1@localhost:${KAFKA_CONTROLLER_PORT}" \
            --override "advertised.listeners=PLAINTEXT://localhost:${KAFKA_PORT}" \
            >"$LOG_DIR/kafka.log" 2>"$LOG_DIR/kafka.err" &
        KAFKA_PID=$!
        echo "    broker starting (pid $KAFKA_PID)"
        wait_until "kafka :$KAFKA_PORT" "test_port 127.0.0.1 $KAFKA_PORT" 90 || fail "see $LOG_DIR/kafka.log"
    fi
    KAFKA_BOOTSTRAP="$(get_svc KAFKA_HOST):$KAFKA_PORT"
fi

echo "    ensuring topics"
for topic in "${!TOPICS[@]}"; do
    partitions="${TOPICS[$topic]}"
    java "-Dlog4j.configuration=$TOOLS_LOG4J" -cp "$KAFKA_LIBS" \
        org.apache.kafka.tools.TopicCommand \
        --bootstrap-server "$KAFKA_BOOTSTRAP" --create --if-not-exists \
        --topic "$topic" --partitions "$partitions" --replication-factor 1 2>/dev/null \
        | grep "Created" | while IFS= read -r line; do echo "    $line"; done || true
done

# ------------------------------------------------------------------ 3. database
say "Database (scripts/apply_db.py)"
db_args=("scripts/apply_db.py")
$RESET_DB && db_args+=("--reset")
python3 "${PY_TRUST[@]}" "${db_args[@]}" 2>&1 \
    | grep -E "migrations :|seed       :|Database ready|FAILED|EDITED|ERROR" \
    | while IFS= read -r line; do echo "    $line"; done || fail "apply_db.py failed (try --reset-db)"

# ------------------------------------------------------------------ 4. build
API_JAR="$REPO_ROOT/Application/Services/order-service/target/sprint-06-api-0.0.1-SNAPSHOT.jar"
EXEC_JAR="$REPO_ROOT/Application/Services/executor-service/target/trade-executor-0.0.1-SNAPSHOT.jar"

if $SKIP_BUILD && [[ -f "$API_JAR" && -f "$EXEC_JAR" ]]; then
    say "Build skipped (--skip-build)"
else
    say "Building (domain-engine -> eventbus -> api -> executor)"
    steps=(
        "Application/Services/libs/domain-engine/pom.xml:install"
        "Application/Services/libs/eventbus/pom.xml:install"
        "Application/Services/order-service/pom.xml:package"
        "Application/Services/executor-service/pom.xml:package"
    )
    for step in "${steps[@]}"; do
        pom="${step%%:*}"; goal="${step##*:}"
        echo "    mvn -f $pom $goal"
        mvn -q -f "$pom" "$goal" -DskipTests 2>&1 \
            | grep -E "ERROR|BUILD FAILURE" \
            | while IFS= read -r line; do echo "    $line"; done || true
        # check exit status of mvn
        mvn -q -f "$pom" "$goal" -DskipTests 2>/dev/null || fail "build failed in $pom"
    done
fi

say "Auth service (Application/Services/auth-service)"
cd "$AUTH_DIR"
LOCK="$AUTH_DIR/package-lock.json"
HIDDEN_LOCK="$AUTH_DIR/node_modules/.package-lock.json"
NEED_CI=true
if [[ -f "$HIDDEN_LOCK" && -f "$LOCK" ]]; then
    if [[ "$LOCK" -ot "$HIDDEN_LOCK" ]]; then NEED_CI=false; fi
fi
if $NEED_CI; then
    echo "    npm ci (node_modules missing or older than package-lock.json)"
    npm ci --no-audit --no-fund 2>&1 \
        | grep -iE "error|ERR!" | while IFS= read -r line; do echo "    $line"; done || true
    [[ $? -eq 0 ]] || fail "npm ci failed in $AUTH_DIR"
else
    echo "    node_modules up to date with package-lock.json, skipping npm ci"
fi

if $SKIP_BUILD && [[ -f "$AUTH_MAIN" ]]; then
    echo "    build skipped (--skip-build), using dist/main.js"
else
    echo "    npm run build"
    npm run build 2>&1 \
        | grep -i "error" | while IFS= read -r line; do echo "    $line"; done || true
    [[ -f "$AUTH_MAIN" ]] || fail "auth service build failed in $AUTH_DIR"
fi
cd "$REPO_ROOT"

# ------------------------------------------------------------------ 5. services
say "Starting services"
if [[ -f "$PID_FILE" ]]; then
    old_executor=$(python3 -c "import json; d=json.load(open('$PID_FILE')); print(d.get('executor') or '')" 2>/dev/null)
    old_api=$(python3      -c "import json; d=json.load(open('$PID_FILE')); print(d.get('api') or '')"      2>/dev/null)
    old_auth=$(python3     -c "import json; d=json.load(open('$PID_FILE')); print(d.get('auth') or '')"     2>/dev/null)
    stop_tracked "old executor"  "$old_executor"
    stop_tracked "old trade-api" "$old_api"
    stop_tracked "old auth"      "$old_auth"
    wait_until "ports $API_PORT/$EXEC_PORT/$AUTH_PORT released" \
        "! test_port 127.0.0.1 $API_PORT && ! test_port 127.0.0.1 $EXEC_PORT && ! test_port 127.0.0.1 $AUTH_PORT" 20 || true
fi
for p in "$API_PORT" "$EXEC_PORT" "$AUTH_PORT"; do
    test_port "127.0.0.1" "$p" 2>/dev/null && fail "port $p is already in use"
done

JVM_COMMON=("-Xmx512m")
if $USE_VAULT; then
    JVM_COMMON+=("-Dtrustme.password=$TRUSTME_PASSWORD" "-Dtrustme.key-file=$KEY_FILE")
fi

export KAFKA_BOOTSTRAP_SERVERS="$KAFKA_BOOTSTRAP"

# Start auth service
AUTH_ENV_VARS=(NODE_ENV=development "KAFKA_BROKER=$KAFKA_BOOTSTRAP")
AUTH_ARGS=("$AUTH_MAIN")
if $USE_VAULT; then
    AUTH_ARGS+=("--trustme-key-file=$KEY_FILE" "--trustme-password=$TRUSTME_PASSWORD")
fi

env NODE_ENV=development KAFKA_BROKER="$KAFKA_BOOTSTRAP" \
    node "${AUTH_ARGS[@]}" \
    >"$LOG_DIR/auth.log" 2>"$LOG_DIR/auth.err" &
AUTH_PID=$!
echo "    auth       pid $AUTH_PID  -> http://${AUTH_HOST_SVC}:${AUTH_PORT}  (OpenAPI docs: /docs)"

java "${JVM_COMMON[@]}" "-Detl.daily.workdir=$REPO_ROOT" -jar "$API_JAR" \
    >"$LOG_DIR/api.log" 2>"$LOG_DIR/api.err" &
API_PID=$!
echo "    trade-api  pid $API_PID  -> http://${API_HOST}:${API_PORT}"

java "${JVM_COMMON[@]}" -jar "$EXEC_JAR" \
    >"$LOG_DIR/executor.log" 2>"$LOG_DIR/executor.err" &
EXEC_PID=$!
echo "    executor   pid $EXEC_PID  -> http://${EXEC_HOST}:${EXEC_PORT}"

python3 -c "
import json
print(json.dumps({'kafka': $KAFKA_PID or None if '$KAFKA_PID' else None,
                  'api': $API_PID, 'executor': $EXEC_PID, 'auth': $AUTH_PID}))
" 2>/dev/null || echo "{}" > "$PID_FILE"
# simpler pid file write:
cat > "$PID_FILE" <<EOF
{"kafka": ${KAFKA_PID:-null}, "api": ${API_PID}, "executor": ${EXEC_PID}, "auth": ${AUTH_PID}}
EOF

wait_until "auth      /health"        "get_auth_health"                         60  || true
wait_until "trade-api /actuator/health" "get_health $API_HOST $API_PORT"        150 || true
wait_until "executor  /actuator/health" "get_health $EXEC_HOST $EXEC_PORT"      150 || true

# ------------------------------------------------------------------ 6. token + cheat sheet
new_jwt() {
    local secret="$1" account_id="$2" ttl="${3:-3600}"
    python3 -c "
import base64, hashlib, hmac, json, time, sys
secret = sys.argv[1].encode()
account_id = int(sys.argv[2])
ttl = int(sys.argv[3])
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b'=').decode()
now = int(time.time())
h = b64(json.dumps({'alg':'HS256','typ':'JWT'}).encode())
p = b64(json.dumps({'sub':f'client-{account_id}','accountId':account_id,'roles':['CLIENT'],'iss':'auth-service','iat':now,'exp':now+ttl}).encode())
sig = b64(hmac.new(secret, f'{h}.{p}'.encode(), hashlib.sha256).digest())
print(f'{h}.{p}.{sig}')
" "$secret" "$account_id" "$ttl"
}
TOKEN=$(new_jwt "$JWT_SECRET" 1)
echo "$TOKEN" > "$LOG_DIR/token.txt"

LOGS_LIST="api,executor,auth$( $KAFKA_HOSTED || echo ",kafka" )"
say "Ready"
cat <<EOF

  Trade API   http://${API_HOST}:${API_PORT}      Executor  http://${EXEC_HOST}:${EXEC_PORT}      Kafka $KAFKA_BOOTSTRAP$( $KAFKA_HOSTED && echo " (remote)" || true )
  Auth        http://${AUTH_HOST_SVC}:${AUTH_PORT}      (OpenAPI docs http://${AUTH_HOST_SVC}:${AUTH_PORT}/docs)
  Logs        $LOG_DIR/{$LOGS_LIST}.log        PIDs  $PID_FILE
  JWT (acct 1, 1h)  saved to $LOG_DIR/token.txt

  # place an order
  T=\$(cat '$LOG_DIR/token.txt')
  BODY='{"accountId":1,"symbol":"RELIANCE","side":"BUY","quantity":1,"price":1300.00,"idempotencyKey":"k-'"\$(date +%s)'"'}'
  curl -s -X POST ${API_HOST}:${API_PORT}/api/v1/orders -H "Authorization: Bearer \$T" -H "Content-Type: application/json" -d "\$BODY"
  curl -s ${API_HOST}:${API_PORT}/api/v1/accounts/1/orders  -H "Authorization: Bearer \$T"
  curl -s ${API_HOST}:${API_PORT}/api/v1/accounts/1/balance -H "Authorization: Bearer \$T"

  # onboard a new user (register, login, link bank, refresh, fund wallet)
  A='http://${AUTH_HOST_SVC}:${AUTH_PORT}'; API='http://${API_HOST}:${API_PORT}'
  python3 scripts/auth_post.py register '{"username":"priya.menon","email":"priya.menon@example.com","password":"Correct-Horse-Battery-9"}'
  S=\$(python3 scripts/auth_post.py login '{"username":"priya.menon","password":"Correct-Horse-Battery-9"}')
  ACCESS=\$(echo "\$S" | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
  REFRESH=\$(echo "\$S" | python3 -c "import sys,json; print(json.load(sys.stdin)['refreshToken'])")
  L=\$(curl -s -X POST "\$API/api/v1/bank-accounts" -H "Authorization: Bearer \$ACCESS" -H "Content-Type: application/json" -d '{"accountNumber":"IN45HDFC0000007890123"}')
  ACCT=\$(echo "\$L" | python3 -c "import sys,json; print(json.load(sys.stdin)['accountId'])")
  S2=\$(python3 scripts/auth_post.py refresh "{\"refreshToken\":\"\$REFRESH\"}")
  ACCESS2=\$(echo "\$S2" | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
  curl -s -X POST "\$API/api/v1/accounts/\$ACCT/transfers" -H "Authorization: Bearer \$ACCESS2" -H "Content-Type: application/json" -d "{\"direction\":\"BANK_TO_WALLET\",\"amount\":10000,\"idempotencyKey\":\"\$(uuidgen)\"}"
  curl -s "\$API/api/v1/accounts/\$ACCT/balance" -H "Authorization: Bearer \$ACCESS2"

  # watch a topic
  java -cp "$KAFKA_LIBS" org.apache.kafka.tools.consumer.ConsoleConsumer --bootstrap-server $KAFKA_BOOTSTRAP --topic trade-events --from-beginning

  # stop everything$( $KAFKA_HOSTED && echo " (Kafka is remote - manage it on that box separately)" || true )
  ./run-local.sh --stop
EOF

$NO_TAIL && exit 0
fi  # end of setup block (skipped by --tail-only)

# ------------------------------------------------------------------ 7. merged log tail
say "Tailing logs (Ctrl+C stops the tail only; services keep running)"

declare -A SOURCES=(
    [API]="$LOG_DIR/api.log"
    [API!]="$LOG_DIR/api.err"
    [EXEC]="$LOG_DIR/executor.log"
    [EXEC!]="$LOG_DIR/executor.err"
    [AUTH]="$LOG_DIR/auth.log"
    [AUTH!]="$LOG_DIR/auth.err"
    [KAFKA]="$LOG_DIR/kafka.log"
    [KAFKA!]="$LOG_DIR/kafka.err"
)

SKIP_RE='^(WARNING: (Use --enable-native|Restricted methods|A restricted method|sun\.misc|Please consider))'

# Build tail args from existing files, skipping to current end
tail_args=()
for tag in "${!SOURCES[@]}"; do
    f="${SOURCES[$tag]}"
    [[ -f "$f" ]] && tail_args+=(-F "$f")
done

# Use multitail if available, otherwise interleave with tail -F + awk prefix
if command -v multitail >/dev/null 2>&1; then
    mt_args=()
    for tag in "${!SOURCES[@]}"; do
        f="${SOURCES[$tag]}"
        [[ -f "$f" ]] && mt_args+=(-l "tail -F -n0 '$f' | awk '{print \"[$tag] \" \$0}' | grep -Ev '$SKIP_RE'")
    done
    eval multitail "${mt_args[@]}"
else
    # Simple interleaved tail using background subshells and a named pipe
    TAIL_PIPE=$(mktemp -u)
    mkfifo "$TAIL_PIPE"
    trap 'rm -f "$TAIL_PIPE"; echo ""; echo "Tail stopped. Services still running; ./run-local.sh --stop to shut down."' EXIT INT TERM

    for tag in "${!SOURCES[@]}"; do
        f="${SOURCES[$tag]}"
        touch "$f"
        tail -F -n0 "$f" 2>/dev/null | while IFS= read -r line; do
            [[ "$line" =~ $SKIP_RE ]] && continue
            echo "[$tag] $line"
        done > "$TAIL_PIPE" &
    done

    cat "$TAIL_PIPE"
fi
