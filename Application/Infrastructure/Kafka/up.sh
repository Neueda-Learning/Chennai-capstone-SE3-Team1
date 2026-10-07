#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
log() { printf '[kafka] %s\n' "$*"; }

# The repository's one .env, at its root.
ENV_FILE="$(cd ../../.. && pwd)/.env"
if [ ! -f "$ENV_FILE" ]; then
    cp "$(dirname "$ENV_FILE")/.env.example" "$ENV_FILE"
    log "$ENV_FILE created from .env.example"
fi

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

if docker compose version >/dev/null 2>&1; then
    docker compose --env-file "$ENV_FILE" up -d
elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose --env-file "$ENV_FILE" up -d
else
    echo "Neither 'docker compose' nor 'docker-compose' is available on PATH" >&2
    exit 1
fi
