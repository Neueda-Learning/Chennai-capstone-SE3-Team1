# Provided artifacts (built outside this project)

`domain-engine-1.0-SNAPSHOT.jar` — the Sprint 5 domain engine. Not built here:
generate it from `Application/Services/libs/domain-engine` and place it in this folder so the
Docker build can install it.

```bash
mvn -f Application/Services/libs/domain-engine/pom.xml clean install
cp Application/Services/libs/domain-engine/target/domain-engine-1.0-SNAPSHOT.jar Application/Services/order-service/lib/
```

Expected file: `domain-engine-1.0-SNAPSHOT.jar` (the Dockerfile
copies this exact name and `pom.xml` depends on
`com.team1.trading:domain-engine:1.0-SNAPSHOT`).