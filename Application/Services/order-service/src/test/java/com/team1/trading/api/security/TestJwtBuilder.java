package com.team1.trading.api.security;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

public final class TestJwtBuilder {

    public static final String TEST_ISSUER = "auth-service";
    public static final String TEST_SECRET = "test-secret-key-for-sprint-6-jwt-verification-not-for-production";

    private final Long accountId;
    private String sub;
    private List<String> roles = List.of("CUSTOMER");
    private Instant issuedAt = Instant.now();
    private Instant expiresAt = Instant.now().plus(15, ChronoUnit.MINUTES);

    private TestJwtBuilder(Long accountId) {
        this.accountId = accountId;
        this.sub = "test-user-" + accountId;
    }

    public static TestJwtBuilder forAccount(Long accountId) {
        return new TestJwtBuilder(accountId);
    }

    public TestJwtBuilder withSub(String sub) {
        this.sub = sub;
        return this;
    }

    public TestJwtBuilder withRoles(String... roles) {
        this.roles = List.of(roles);
        if (this.roles.isEmpty()) {
            throw new IllegalArgumentException("roles must not be empty");
        }
        return this;
    }

    public TestJwtBuilder withRoles(List<String> roles) {
        if (roles.isEmpty()) {
            throw new IllegalArgumentException("roles must not be empty");
        }
        this.roles = roles;
        return this;
    }

    public TestJwtBuilder issuedAt(Instant issuedAt) {
        this.issuedAt = issuedAt;
        return this;
    }

    public TestJwtBuilder expiresAt(Instant expiresAt) {
        this.expiresAt = expiresAt;
        return this;
    }

    public TestJwtBuilder expiresIn(long amount, ChronoUnit unit) {
        this.expiresAt = Instant.now().plus(amount, unit);
        return this;
    }

    public String build(String secret) {
        String token = JWT.create()
                .withSubject(sub)
                .withClaim("accountId", accountId)
                .withClaim("roles", roles)
                .withIssuedAt(issuedAt)
                .withExpiresAt(expiresAt)
                .sign(Algorithm.HMAC256(secret));
        return "Bearer " + token;
    }

    public String buildWithTestSecret() {
        return build(TEST_SECRET);
    }

    public String buildForged() {
        String token = JWT.create()
                .withSubject(sub)
                .withClaim("accountId", accountId)
                .withClaim("roles", roles)
                .withIssuedAt(issuedAt)
                .withExpiresAt(expiresAt)
                .sign(Algorithm.HMAC256("wrong-secret"));
        return "Bearer " + token;
    }

    public String buildExpired() {
        return issuedAt(Instant.now().minus(30, ChronoUnit.MINUTES))
                .expiresAt(Instant.now().minus(15, ChronoUnit.MINUTES))
                .buildWithTestSecret();
    }
}
