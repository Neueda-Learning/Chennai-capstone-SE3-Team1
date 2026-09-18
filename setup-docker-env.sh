#!/usr/bin/env bash
set -Eeuo pipefail

# One-time setup after cloning, before the first `docker-compose ... up`. Creates the three
# files docker-compose.yml needs that are deliberately not in git (two are host-specific,
# one is a secret) and fills in everything that can be generated or detected automatically,
# so the only thing a teammate has to actually know is the TrustMe vault password - the
# Fauxnance key, DB credentials, JWT secret etc. all come from the vault it decrypts, not
# from anything typed in here. Safe to re-run - every step is skipped if its file/value
# already exists.
#
# Run from the repository root:
#   bash setup-docker-env.sh

log() { printf '[setup] %s\n' "$*"; }

cd "$(dirname "${BASH_SOURCE[0]}")"

# ---------------------------------------------------------------- 1. .env
if [ ! -f .env ]; then
    cp .env.example .env
    log ".env created from .env.example"
else
    log ".env already exists, leaving it alone"
fi

# JWT_SECRET: per-host only (trade-api and services/auth-stub on THIS host just need to
# agree with each other), so generate one rather than ask anyone to type or share it.
if grep -q '^JWT_SECRET=$' .env; then
    secret=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
    sed -i.bak "s|^JWT_SECRET=\$|JWT_SECRET=${secret}|" .env && rm -f .env.bak
    log "JWT_SECRET generated"
else
    log "JWT_SECRET already set"
fi

# KAFKA_ADVERTISED_HOST: the address this host's own containers and any host-side tool
# reconnect to after the initial Kafka bootstrap. Auto-detect the private IP; only touches
# the file if it's still at the .env.example default, so a deliberate override survives.
# Every detection attempt is allowed to fail without killing the script (set -e would
# otherwise abort on `var=$(cmd)` the moment cmd is missing, e.g. no `hostname -I` on a
# minimal image or off EC2) - "||true" on each assignment, never on a bare pipeline.
if grep -q '^KAFKA_ADVERTISED_HOST=localhost$' .env; then
    ip=""
    ip=$(curl -fsS --max-time 2 http://169.254.169.254/latest/meta-data/local-ipv4 2>/dev/null) || ip=""
    if [ -z "$ip" ]; then
        ip=$(hostname -I 2>/dev/null | awk '{print $1}') || ip=""
    fi
    if [ -n "$ip" ]; then
        sed -i.bak "s|^KAFKA_ADVERTISED_HOST=localhost\$|KAFKA_ADVERTISED_HOST=${ip}|" .env && rm -f .env.bak
        log "KAFKA_ADVERTISED_HOST set to detected address $ip"
    else
        log "could not auto-detect this host's IP; KAFKA_ADVERTISED_HOST stays 'localhost' - edit .env by hand if this isn't a single-machine setup"
    fi
else
    log "KAFKA_ADVERTISED_HOST already set"
fi

# ---------------------------------------------------------------- 2. docker-compose.override.yml
if [ ! -f docker-compose.override.yml ]; then
    cp docker-compose.override.yml.example docker-compose.override.yml
    log "docker-compose.override.yml created from the .example (heap caps + TrustMe/JWT wiring; trim it if this host has RAM to spare)"
else
    log "docker-compose.override.yml already exists, leaving it alone"
fi

# ---------------------------------------------------------------- 3. .trustme-password
if [ ! -f .trustme-password ]; then
    read -r -s -p "TrustMe vault password (ask your team if you don't have it): " tm_password
    echo
    if [ -n "$tm_password" ]; then
        printf '%s' "$tm_password" > .trustme-password
        chmod 600 .trustme-password
        log ".trustme-password written"
    else
        log "no password entered; trade-api/executor will fail to start with 'No password available' until .trustme-password exists"
    fi
else
    log ".trustme-password already exists, leaving it alone"
fi

log "done - next: docker-compose --profile platform up -d --build"
log "then, once healthy:                bash infra/kafka/create-topics.sh"
