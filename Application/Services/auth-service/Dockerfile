# ==============================================================================
# AUTH SERVICE  -  generic Dockerfile for any npm project (NestJS, Express, plain TypeScript/JS)
#
# HOW TO USE:  copy this file into your auth-service folder as `Dockerfile`.
#              Do NOT edit it; every setting comes from .env through docker-compose.yml.
#
# WHERE TO CHANGE:  nothing in this file. Every value below is a build arg that
# docker-compose.yml fills from .env (the AUTH_SERVICE_* keys):
#
#   build arg           .env key                 meaning                              default
#   NODE_VERSION        AUTH_SERVICE_NODE_VERSION    Node major version                   20
#   NEEDS_BUILD         AUTH_SERVICE_NEEDS_BUILD     true = run `npm run <BUILD_SCRIPT>`  true
#   BUILD_SCRIPT        AUTH_SERVICE_BUILD_SCRIPT    npm script that compiles             build
#   START_CMD           AUTH_SERVICE_START_CMD       command that starts the app          auto
#   APP_PORT            AUTH_SERVICE_PORT            port the app listens on              3000
#   WRITABLE_DIRS       AUTH_SERVICE_WRITABLE_DIRS   folders the app writes to at run time ""
#   NATIVE_BUILD_DEPS   AUTH_SERVICE_NATIVE_DEPS     true = install python3/make/g++      false
#                                                (also added automatically when the
#                                                install fails without them)
#   EXTRA_DEST          AUTH_SERVICE_EXTRA_DEST      see "FILES OUTSIDE THE SERVICE FOLDER" ""
#
# START_CMD=auto runs the first of dist/main.js, dist/src/main.js, dist/index.js,
# dist/src/index.js, dist/server.js that exists, else `npm start`.
#
# FILES OUTSIDE THE SERVICE FOLDER (needed at BUILD time, e.g. a shared contract):
#   AUTH_SERVICE_EXTRA_DIR  = that folder, relative to the repo root
#   AUTH_SERVICE_EXTRA_DEST = where the build expects it, counted from /app
# Files needed only at RUN time (a shared config file) use APP_CONFIG_DIR instead.
#
# Run-time settings (DB, JWT, CORS ...) are ENVIRONMENT VARIABLES, never baked in.
# Only npm is supported (package-lock.json). Needs BuildKit.
# ==============================================================================

ARG NODE_VERSION=20

# Empty stand-in so a plain `docker build` works; docker-compose replaces it with
# the folder named by AUTH_SERVICE_EXTRA_DIR (additional_contexts: extra).
FROM scratch AS extra

# ---------- Stage 1: install, build, drop dev dependencies --------------------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app

ARG NATIVE_BUILD_DEPS=false
RUN if [ "$NATIVE_BUILD_DEPS" = "true" ]; then apk add --no-cache python3 make g++; fi

# Everything is copied before the install because install scripts (postinstall,
# prepare) of some projects read files of the project or the outside folder.
COPY . .
ARG EXTRA_DEST=""
RUN --mount=type=bind,from=extra,target=/mnt/extra \
    if [ -n "$EXTRA_DEST" ]; then mkdir -p "$EXTRA_DEST" && cp -a /mnt/extra/. "$EXTRA_DEST"/; fi

# If a package has to compile native code (argon2, bcrypt ...) and no prebuilt binary
# fits, the install is retried once with the compiler toolchain.
RUN npm ci --no-fund --no-audit \
    || { echo ">>> retrying with native build tools (python3 make g++)"; \
         apk add --no-cache python3 make g++ \
         && (npm ci --no-fund --no-audit || npm install --no-fund --no-audit); }

ARG NEEDS_BUILD=true
ARG BUILD_SCRIPT=build
RUN if [ "$NEEDS_BUILD" = "true" ]; then npm run ${BUILD_SCRIPT}; fi

RUN npm prune --omit=dev --no-fund --no-audit

# ---------- Stage 2: run ------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# uid/gid 1000 = the image's built-in `node` user (numeric, so Kubernetes can
# enforce runAsNonRoot).
COPY --from=build --chown=1000:1000 /app /app

# /app itself and /app/logs are writable for the app user (log files, generated keys).
ARG WRITABLE_DIRS=""
RUN mkdir -p /app/logs && chown 1000:1000 /app /app/logs \
    && for d in $WRITABLE_DIRS; do mkdir -p "$d" && chown -R 1000:1000 "$d"; done

ARG APP_PORT=3000
ENV PORT=${APP_PORT}
EXPOSE ${APP_PORT}

USER 1000:1000

ARG START_CMD="auto"
ENV START_CMD=${START_CMD}
# `exec` makes the app PID 1 so it receives SIGTERM (clean shutdown).
ENTRYPOINT ["sh", "-c", "if [ \"$START_CMD\" != auto ]; then exec $START_CMD; fi; for f in dist/main.js dist/src/main.js dist/index.js dist/src/index.js dist/server.js; do if [ -f \"$f\" ]; then echo \"start: node $f\"; exec node \"$f\"; fi; done; exec npm start"]
