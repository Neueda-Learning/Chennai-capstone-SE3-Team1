#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
log() { printf '[kafka] %s\n' "$*"; }

if [ ! -f .env ]; then
    cp ../../../../.env.example .env
    log ".env created from .env.example"
fi

if ! grep -q '^KAFKA_ADVERTISED_HOST=' .env || grep -q '^KAFKA_ADVERTISED_HOST=localhost$' .env; then
    ip=""
    ip=$(curl -fsS --max-time 2 http://169.254.169.254/latest/meta-data/local-ipv4 2>/dev/null) || ip=""
    if [ -z "$ip" ]; then
        ip=$(hostname -I 2>/dev/null | awk '{print $1}') || ip=""
    fi
    if [ -n "$ip" ]; then
        if grep -q '^KAFKA_ADVERTISED_HOST=' .env; then
            sed -i.bak "s|^KAFKA_ADVERTISED_HOST=.*|KAFKA_ADVERTISED_HOST=${ip}|" .env && rm -f .env.bak
        else
            printf 'KAFKA_ADVERTISED_HOST=%s\n' "$ip" >> .env
        fi
        log "KAFKA_ADVERTISED_HOST set to detected address $ip"
    else
        log "could not auto-detect this host's IP - edit KAFKA_ADVERTISED_HOST in Application/Infrastructure/Kafka/.env by hand, then re-run"
    fi
else
    log "KAFKA_ADVERTISED_HOST already set in .env, leaving it alone"
fi

if docker compose version >/dev/null 2>&1; then
    docker compose up -d
elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose up -d
else
    echo "Neither 'docker compose' nor 'docker-compose' is available on PATH" >&2
    exit 1
fi
