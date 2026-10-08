FROM maven:3.9.16-eclipse-temurin-21 AS build
WORKDIR /src

COPY Application/Services/libs/domain-engine/pom.xml ./Application/Services/libs/domain-engine/pom.xml
COPY Application/Services/libs/domain-engine/src ./Application/Services/libs/domain-engine/src
RUN mvn -B -q -f ./Application/Services/libs/domain-engine/pom.xml clean install

COPY Application/Services/libs/eventbus/pom.xml ./Application/Services/libs/eventbus/pom.xml
COPY Application/Services/libs/eventbus/src ./Application/Services/libs/eventbus/src
RUN mvn -B -q -f ./Application/Services/libs/eventbus/pom.xml clean install

COPY Application/Services/order-service/pom.xml ./Application/Services/order-service/pom.xml
RUN mvn -B -q -f ./Application/Services/order-service/pom.xml dependency:go-offline
COPY Application/Services/order-service/src ./Application/Services/order-service/src
RUN mvn -B -q -f ./Application/Services/order-service/pom.xml clean package -DskipTests

COPY Application/Services/executor-service/pom.xml ./Application/Services/executor-service/pom.xml
RUN mvn -B -q -f ./Application/Services/executor-service/pom.xml dependency:go-offline
COPY Application/Services/executor-service/src ./Application/Services/executor-service/src
RUN mvn -B -q -f ./Application/Services/executor-service/pom.xml clean package -DskipTests

FROM eclipse-temurin:21-jre AS trade-api
WORKDIR /app

RUN useradd --system --uid 10001 --shell /usr/sbin/nologin app
USER app

COPY --from=build /src/Application/Services/order-service/target/sprint-06-api-0.0.1-SNAPSHOT.jar /app/app.jar

# The port this service listens on inside the container is TRADE_API_CONTAINER_PORT in Application/Config/services.env.
# docker-compose passes it as a build argument; a bare "docker build" must be given it too.
ARG TRADE_API_CONTAINER_PORT
RUN test -n "$TRADE_API_CONTAINER_PORT" || { echo "build with --build-arg TRADE_API_CONTAINER_PORT=<the value in Application/Config/services.env>" >&2; exit 1; }
ENV SERVER_PORT=$TRADE_API_CONTAINER_PORT
EXPOSE $TRADE_API_CONTAINER_PORT

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=12 \
  CMD curl -fsS "http://localhost:${SERVER_PORT}/actuator/health" || exit 1

ENTRYPOINT ["java", "-jar", "/app/app.jar"]

FROM eclipse-temurin:21-jre AS executor
WORKDIR /app

RUN useradd --system --uid 10001 --shell /usr/sbin/nologin app
USER app

COPY --from=build /src/Application/Services/executor-service/target/trade-executor-0.0.1-SNAPSHOT.jar /app/app.jar

# The port this service listens on inside the container is EXECUTOR_PORT in Application/Config/services.env.
# docker-compose passes it as a build argument; a bare "docker build" must be given it too.
ARG EXECUTOR_PORT
RUN test -n "$EXECUTOR_PORT" || { echo "build with --build-arg EXECUTOR_PORT=<the value in Application/Config/services.env>" >&2; exit 1; }
ENV SERVER_PORT=$EXECUTOR_PORT
EXPOSE $EXECUTOR_PORT

HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=12 \
  CMD curl -fsS "http://localhost:${SERVER_PORT}/actuator/health" || exit 1

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
