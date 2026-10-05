# One build, two runtime images.
#
# The Trade REST API and the Trade Executor share three quarters of their build:
# the same base image, the same two locally-built libraries, the same empty
# Maven repository to warm. Building them from one file means those layers are
# built once and cached once, and the two services cannot drift onto different
# JDKs by accident.
#
# Pick which image you want with --target, as docker-compose.yml does:
#   docker build -f Application/Services/order-service/Dockerfile --target trade-api .
#   docker build -f Application/Services/order-service/Dockerfile --target executor .
#
# The build context is the repository root, not this folder, because the build
# needs libs/domain-engine, libs/eventbus and executor-service as well.

# ---- Stage 1: build ---------------------------------------------------------
# Maven + full JDK 21. Each project's pom is copied and resolved before its
# sources are, so changing a source file does not invalidate the dependency
# layer below it.
#
# libs/domain-engine and libs/eventbus are built inside the image
# because it starts with an empty local Maven repository and neither is
# published to a registry.
FROM maven:3.9.16-eclipse-temurin-21 AS build
WORKDIR /src

# Build libs/domain-engine first: both services depend on it.
COPY Application/Services/libs/domain-engine/pom.xml ./Application/Services/libs/domain-engine/pom.xml
COPY Application/Services/libs/domain-engine/src ./Application/Services/libs/domain-engine/src
RUN mvn -B -q -f ./Application/Services/libs/domain-engine/pom.xml clean install

# Build libs/eventbus: the shared Envelope, required by both services.
COPY Application/Services/libs/eventbus/pom.xml ./Application/Services/libs/eventbus/pom.xml
COPY Application/Services/libs/eventbus/src ./Application/Services/libs/eventbus/src
RUN mvn -B -q -f ./Application/Services/libs/eventbus/pom.xml clean install

# Build order-service
COPY Application/Services/order-service/pom.xml ./Application/Services/order-service/pom.xml
RUN mvn -B -q -f ./Application/Services/order-service/pom.xml dependency:go-offline
COPY Application/Services/order-service/src ./Application/Services/order-service/src
RUN mvn -B -q -f ./Application/Services/order-service/pom.xml clean package -DskipTests

# Build the executor-service, which carries the market-data poller inside it
COPY Application/Services/executor-service/pom.xml ./Application/Services/executor-service/pom.xml
RUN mvn -B -q -f ./Application/Services/executor-service/pom.xml dependency:go-offline
COPY Application/Services/executor-service/src ./Application/Services/executor-service/src
RUN mvn -B -q -f ./Application/Services/executor-service/pom.xml clean package -DskipTests

# ---- Stage 2: Trade REST API runtime ----------------------------------------
# Java 21 JRE only: neither Maven nor a JDK. Runs as a non-root user so nothing
# build-time (compiler, dependency cache, sources) is present at runtime.
FROM eclipse-temurin:21-jre AS trade-api
WORKDIR /app

RUN useradd --system --uid 10001 --shell /usr/sbin/nologin app
USER app

COPY --from=build /src/Application/Services/order-service/target/sprint-06-api-0.0.1-SNAPSHOT.jar /app/app.jar

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

COPY --from=build /src/Application/Services/executor-service/target/trade-executor-0.0.1-SNAPSHOT.jar /app/app.jar

EXPOSE 8083

# Longer start period than the API: this one waits on both Postgres and the
# broker before it reports healthy.
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=12 \
  CMD curl -fsS http://localhost:8083/actuator/health || exit 1

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
