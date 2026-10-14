# ==============================================================================
# EXECUTOR SERVICE  -  generic Dockerfile for Spring Boot (or any runnable jar), Maven or Gradle wrapper
#
# HOW TO USE:  copy this file into your executor-service (the one with pom.xml or gradlew) folder as `Dockerfile`.
#              Do NOT edit it; every setting comes from .env through docker-compose.yml.
#
# WHERE TO CHANGE:  nothing in this file. Every value below is a build arg that
# docker-compose.yml fills from .env (EXECUTOR_SERVICE_* keys):
#
#   build arg         .env key                    meaning                               default
#   JAVA_VERSION      EXECUTOR_SERVICE_JAVA_VERSION       must match the project's java.version 21
#   MAVEN_VERSION     MAVEN_VERSION               Maven used to build                   3.9.9
#   APP_PORT          EXECUTOR_SERVICE_PORT               port the app listens on (SERVER_PORT) 8080
#   RUNTIME_IMAGE     EXECUTOR_SERVICE_RUNTIME_IMAGE      image the jar runs on                 temurin jre-alpine
#   RUNTIME_APK       EXECUTOR_SERVICE_RUNTIME_APK        extra packages at run time,           ""
#                                                 e.g. "python3" when the app starts a
#                                                 Python subprocess
#   --- only for the three special layouts below ---
#   APP_DIR           EXECUTOR_SERVICE_APP_DIR            folder of the app's pom, inside *_DIR "."
#   PRE_INSTALL_DIRS  EXECUTOR_SERVICE_PRE_INSTALL_DIRS   library folders to `mvn install` first ""
#   MODULE            EXECUTOR_SERVICE_MODULE             module of an aggregator pom to build  ""
#   EXTRA_DEST        EXECUTOR_SERVICE_EXTRA_DEST         where an outside folder is copied to  ""
#
# SPECIAL LAYOUT 1 - the service depends on a LIBRARY in a sibling folder
#   (pom.xml has a <dependency> on e.g. domain-engine that lives in the repo):
#       EXECUTOR_SERVICE_DIR              = the folder that contains BOTH (e.g. ./Services)
#       EXECUTOR_SERVICE_PRE_INSTALL_DIRS = the library folder(s), space-separated, inside it
#       EXECUTOR_SERVICE_APP_DIR          = the service folder inside it (e.g. executor-service)
#   Put the Dockerfile in EXECUTOR_SERVICE_DIR and name it with EXECUTOR_SERVICE_DOCKERFILE.
#
# SPECIAL LAYOUT 2 - an AGGREGATOR pom lists the services as <modules>:
#       EXECUTOR_SERVICE_DIR    = the folder of the aggregator pom
#       EXECUTOR_SERVICE_MODULE = the module path as written in <module>
#
# SPECIAL LAYOUT 3 - pom.xml reads a folder OUTSIDE the service folder
#   (e.g. <directory>../../databases/postgresql/liquibase</directory>):
#       EXECUTOR_SERVICE_EXTRA_DIR  = that folder, relative to the repo root
#       EXECUTOR_SERVICE_EXTRA_DEST = where the build expects it, counted from /app
#                             (/app/../../databases/postgresql = /databases/postgresql)
#
# Run-time settings (DB, Kafka, JWT ...) are ENVIRONMENT VARIABLES, never baked in.
# Needs BuildKit.
# ==============================================================================

ARG JAVA_VERSION=21
ARG MAVEN_VERSION=3.9.9
ARG RUNTIME_IMAGE=eclipse-temurin:${JAVA_VERSION}-jre-alpine

# Empty stand-in so a plain `docker build` works; docker-compose replaces it with
# the folder named by *_EXTRA_DIR (additional_contexts: extra).
FROM scratch AS extra

# ---------- Stage 1: compile --------------------------------------------------
FROM maven:${MAVEN_VERSION}-eclipse-temurin-${JAVA_VERSION} AS build
WORKDIR /app

COPY . .

ARG EXTRA_DEST=""
RUN --mount=type=bind,from=extra,target=/mnt/extra \
    if [ -n "$EXTRA_DEST" ]; then mkdir -p "$EXTRA_DEST" && cp -a /mnt/extra/. "$EXTRA_DEST"/; fi

ARG PRE_INSTALL_DIRS=""
ARG APP_DIR="."
ARG MODULE=""
RUN --mount=type=cache,target=/root/.m2 --mount=type=cache,target=/root/.gradle \
    set -eu; \
    for d in $PRE_INSTALL_DIRS; do \
        echo ">>> installing library $d"; (cd "$d" && mvn -B -q install -DskipTests); \
    done; \
    cd "$APP_DIR"; \
    if [ -f pom.xml ]; then \
        mvn -B -q package -DskipTests ${MODULE:+-pl "$MODULE" -am}; \
    elif [ -f gradlew ]; then \
        chmod +x gradlew && ./gradlew --no-daemon -q assemble -x test; \
    else \
        echo "Neither pom.xml nor gradlew found in $APP_DIR" >&2; exit 1; \
    fi

# Pick the runnable jar: the biggest one that is not plain/sources/javadoc/original.
# A Spring Boot project whose pom does not run the repackage goal produces a jar that
# `java -jar` cannot start; in that case the goal is run here, without a pom change.
RUN --mount=type=cache,target=/root/.m2 \
    set -eu; \
    pick() { find "$APP_DIR/${MODULE:-.}" -maxdepth 6 \( -path '*/target/*.jar' -o -path '*/build/libs/*.jar' \) \
          ! -name '*-plain.jar' ! -name 'original-*.jar' ! -name '*.jar.original' ! -name '*-sources.jar' \
          ! -name '*-javadoc.jar' ! -name '*-tests.jar' \
          -printf '%s %p\n' | sort -rn | head -n 1 | cut -d' ' -f2-; }; \
    runnable() { rm -rf /tmp/mf && mkdir -p /tmp/mf && (cd /tmp/mf && jar xf "/app/$1" META-INF/MANIFEST.MF) && grep -q '^Main-Class:' /tmp/mf/META-INF/MANIFEST.MF; }; \
    jar="$(pick)"; [ -n "$jar" ] || { echo "No jar found after the build" >&2; exit 1; }; \
    if ! runnable "$jar" && [ -f "$APP_DIR/${MODULE:-.}/pom.xml" ]; then \
        echo ">>> $jar is not runnable; running spring-boot repackage"; \
        (cd "$APP_DIR/${MODULE:-.}" && mvn -B -q -DskipTests package org.springframework.boot:spring-boot-maven-plugin:repackage) || true; \
        jar="$(pick)"; \
    fi; \
    runnable "$jar" || { echo "NOT RUNNABLE: $jar has no Main-Class. Add spring-boot-maven-plugin (repackage) to the pom." >&2; exit 1; }; \
    echo "Using $jar"; \
    mkdir -p /out && cp "$jar" /out/app.jar

# ---------- Stage 2: run ------------------------------------------------------
FROM ${RUNTIME_IMAGE} AS runtime
WORKDIR /app

# Extra run-time packages. On a non-Alpine RUNTIME_IMAGE (needed when the app loads
# glibc native libraries, e.g. onnxruntime) apt is used and the health-check tools
# (wget, nc) are added.
ARG RUNTIME_APK=""
RUN if command -v apk >/dev/null 2>&1; then \
        if [ -n "$RUNTIME_APK" ]; then apk add --no-cache $RUNTIME_APK; fi; \
    else \
        apt-get update && apt-get install -y --no-install-recommends wget netcat-openbsd $RUNTIME_APK \
        && rm -rf /var/lib/apt/lists/*; \
    fi

# Numeric uid so Kubernetes can enforce runAsNonRoot. Works on Alpine and Debian/Ubuntu.
RUN (addgroup -S -g 10001 app && adduser -S -u 10001 -G app app) 2>/dev/null \
    || (groupadd -r -g 10001 app && useradd -r -u 10001 -g app app)

COPY --from=build --chown=10001:10001 /out/app.jar /app/app.jar
# The app may write relative to its working folder (logs/app.log is common).
RUN mkdir -p /app/logs && chown 10001:10001 /app /app/logs

ARG APP_PORT=8080
# MaxRAMPercentage sizes the heap from the container's memory limit, not the host's.
ENV SERVER_PORT=${APP_PORT} \
    JAVA_OPTS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"
EXPOSE ${APP_PORT}

USER 10001:10001
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
