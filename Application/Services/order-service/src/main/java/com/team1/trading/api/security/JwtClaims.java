package com.team1.trading.api.security;

import java.time.Instant;
import java.util.List;

public final class JwtClaims {

    private final String sub;
    private final Long accountId;
    private final List<String> roles;
    private final Instant issuedAt;
    private final Instant expiresAt;
    private final String issuer;

    public JwtClaims(String sub, Long accountId, List<String> roles,
                     Instant issuedAt, Instant expiresAt, String issuer) {
        this.sub = sub;
        this.accountId = accountId;
        this.roles = roles;
        this.issuedAt = issuedAt;
        this.expiresAt = expiresAt;
        this.issuer = issuer;
    }

    public String getSub() {
        return sub;
    }

    public Long getAccountId() {
        return accountId;
    }

    public List<String> getRoles() {
        return roles;
    }

    public Instant getIssuedAt() {
        return issuedAt;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public String getIssuer() {
        return issuer;
    }
}
