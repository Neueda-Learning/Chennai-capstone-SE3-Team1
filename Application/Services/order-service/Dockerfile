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

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=12 \
  CMD curl -fsS http://localhost:8080/actuator/health || exit 1

ENTRYPOINT ["java", "-jar", "/app/app.jar"]

FROM eclipse-temurin:21-jre AS executor
WORKDIR /app

RUN useradd --system --uid 10001 --shell /usr/sbin/nologin app
USER app

COPY --from=build /src/Application/Services/executor-service/target/trade-executor-0.0.1-SNAPSHOT.jar /app/app.jar

EXPOSE 8083

HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=12 \
  CMD curl -fsS http://localhost:8083/actuator/health || exit 1

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
