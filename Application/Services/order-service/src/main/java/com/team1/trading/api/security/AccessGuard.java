package com.team1.trading.api.security;

import com.team1.trading.domain.exception.AccountNotActiveException;
import org.springframework.stereotype.Component;

import java.util.Optional;

@Component
public class AccessGuard {

    static final String ADMIN = "ADMIN";

    public boolean isAdmin() {
        return claims().getRoles().contains(ADMIN);
    }

    public void requireAdmin() {
        if (!isAdmin()) {
            throw new AccountNotActiveException(null, "ROLE");
        }
    }

    public void requireOwner(Long accountId) {
        Long tokenAccountId = claims().getAccountId();
        if (tokenAccountId == null || accountId == null || !tokenAccountId.equals(accountId)) {
            throw new AccountNotActiveException(accountId, "TOKEN");
        }
    }

    public void requireOwnerOrAdmin(Long clientId) {
        requireOwnerOrAdmin(Optional.ofNullable(clientId));
    }

    public void requireOwnerOrAdmin(Optional<Long> ownerClientId) {
        if (isAdmin()) {
            return;
        }
        Long tokenAccountId = claims().getAccountId();
        if (tokenAccountId == null || ownerClientId.isEmpty() || !tokenAccountId.equals(ownerClientId.get())) {
            throw new AccountNotActiveException(ownerClientId.orElse(null), "TOKEN");
        }
    }

    private static JwtClaims claims() {
        JwtClaims claims = JwtRequestContext.getClaims();
        if (claims == null) {
            throw new JwtAuthenticationException("no verified token on the request");
        }
        return claims;
    }
}
