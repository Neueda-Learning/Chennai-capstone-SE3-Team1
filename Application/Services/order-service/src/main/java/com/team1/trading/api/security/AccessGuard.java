package com.team1.trading.api.security;

import com.team1.trading.domain.exception.AccountNotActiveException;
import org.springframework.stereotype.Component;

import java.util.Optional;

/**
 * Who may act on a client or bank account, decided from the claims {@link JwtVerificationFilter}
 * has already verified.
 *
 * <p>A {@code CUSTOMER} reaches only the client whose id is their token's {@code accountId}; an
 * {@code ADMIN} reaches every one. A refusal is {@code ACC-403}, the same answer the
 * {@code /api/v1} account routes give a token that cannot reach the account.
 */
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

    public void requireOwnerOrAdmin(Long clientId) {
        requireOwnerOrAdmin(Optional.ofNullable(clientId));
    }

    /**
     * @param ownerClientId the client that owns the thing being addressed, or empty if it does
     *                      not exist. A customer is refused either way, so an unknown account
     *                      number and someone else's look the same from outside.
     */
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
            // The filter guards every route that uses this; reaching here means it did not run.
            throw new JwtAuthenticationException("no verified token on the request");
        }
        return claims;
    }
}
