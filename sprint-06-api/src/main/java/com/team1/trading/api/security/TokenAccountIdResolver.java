package com.team1.trading.api.security;

/**
 * Resolves the numeric {@code accountId} claim a token bears, so the service can enforce the
 * contract's reach rule: a valid token whose {@code accountId} claim does not match the account
 * being addressed is {@code ACC-403}.
 *
 * <p>{@code JwtVerificationFilter} has already rejected a missing or invalid token
 * ({@code AUTH-401}) before any {@code /api/v1/} controller runs, so this only reads the claim
 * from a verified header. {@code null} means the token carries no account: the user has
 * registered but not linked a bank account. The services answer that with {@code ACC-403} on
 * every account and order route; only {@code POST /api/v1/bank-accounts} serves such a token.
 */
public interface TokenAccountIdResolver {

    Long resolve(String authorizationHeader);
}