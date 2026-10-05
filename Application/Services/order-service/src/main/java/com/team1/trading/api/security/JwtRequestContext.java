package com.team1.trading.api.security;

public final class JwtRequestContext {

    private static final ThreadLocal<JwtClaims> claims = new ThreadLocal<>();

    private JwtRequestContext() {
    }

    public static void setClaims(JwtClaims jwtClaims) {
        claims.set(jwtClaims);
    }

    public static JwtClaims getClaims() {
        return claims.get();
    }

    public static void clear() {
        claims.remove();
    }
}
