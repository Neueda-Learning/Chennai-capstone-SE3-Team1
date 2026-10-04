# One build, two runtime images.
#
# The Trade REST API and the Trade Executor share three quarters of their build:
# the same base image, the same two locally-built libraries, the same empty
# Maven repository to warm. Building them from one file means those layers are
# built once and cached once, and the two services cannot drift onto different
# JDKs by accident.
#
# Pick which image you want with --target, as docker-compose.yml does:
#   docker build -f sprint-06-api/Dockerfile --target trade-api .
#   docker build -f sprint-06-api/Dockerfile --target executor .
#
# The build context is the repository root, not this folder, because the build
# needs sprint-05-domain-engine, sprint-07/eventbus and executor as well.

# ---- Stage 1: build ---------------------------------------------------------
# Maven + full JDK 21. Each project's pom is copied and resolved before its
# sources are, so changing a source file does not invalidate the dependency
# layer below it.
#
# sprint-05-domain-engine and sprint-07-eventbus are built inside the image
# because it starts with an empty local Maven repository and neither is
# published to a registry.
FROM maven:3.9.16-eclipse-temurin-21 AS build
WORKDIR /src

# Build sprint-05-domain-engine first: both services depend on it.
COPY sprint-05-domain-engine/pom.xml ./sprint-05-domain-engine/pom.xml
COPY sprint-05-domain-engine/src ./sprint-05-domain-engine/src
RUN mvn -B -q -f ./sprint-05-domain-engine/pom.xml clean install

# Build sprint-07-eventbus: the shared Envelope, required by both services.
COPY sprint-07/eventbus/pom.xml ./sprint-07/eventbus/pom.xml
COPY sprint-07/eventbus/src ./sprint-07/eventbus/src
RUN mvn -B -q -f ./sprint-07/eventbus/pom.xml clean install

# Build sprint-06-api
COPY sprint-06-api/pom.xml ./sprint-06-api/pom.xml
RUN mvn -B -q -f ./sprint-06-api/pom.xml dependency:go-offline
COPY sprint-06-api/src ./sprint-06-api/src
RUN mvn -B -q -f ./sprint-06-api/pom.xml clean package -DskipTests

# Build the executor, which carries the market-data poller inside it
COPY executor/pom.xml ./executor/pom.xml
RUN mvn -B -q -f ./executor/pom.xml dependency:go-offline
COPY executor/src ./executor/src
RUN mvn -B -q -f ./executor/pom.xml clean package -DskipTests

# ---- Stage 2: Trade REST API runtime ----------------------------------------
# Java 21 JRE only: neither Maven nor a JDK. Runs as a non-root user so nothing
# build-time (compiler, dependency cache, sources) is present at runtime.
FROM eclipse-temurin:21-jre AS trade-api
WORKDIR /app

RUN useradd --system --uid 10001 --shell /usr/sbin/nologin app
USER app

COPY --from=build /src/sprint-06-api/target/sprint-06-api-0.0.1-SNAPSHOT.jar /app/app.jar

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=12 \
  CMD curl -fsS http://localhost:8080/actuator/health || exit 1

ENTRYPOINT ["java", "-jar", "/app/app.jar"]

# ---- Stage 3: Trade Executor runtime ----------------------------------------
# Consumes orders, prices and settles them, and carries the scheduled
# market-data poller. The poller is a component inside this image, not a
# service of its own: one process holds the Fauxnance key and one process
# divides its 2000-request day.
FROM eclipse-temurin:21-jre AS executor
WORKDIR /app

RUN useradd --system --uid 10001 --shell /usr/sbin/nologin app
USER app

COPY --from=build /src/executor/target/trade-executor-0.0.1-SNAPSHOT.jar /app/app.jar

EXPOSE 8083

# Longer start period than the API: this one waits on both Postgres and the
# broker before it reports healthy.
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=12 \
  CMD curl -fsS http://localhost:8083/actuator/health || exit 1

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
