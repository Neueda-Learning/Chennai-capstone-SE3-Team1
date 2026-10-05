package com.team1.trading.api.security;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.exceptions.JWTDecodeException;
import com.auth0.jwt.exceptions.JWTVerificationException;
import com.auth0.jwt.exceptions.SignatureVerificationException;
import com.auth0.jwt.exceptions.TokenExpiredException;
import com.auth0.jwt.interfaces.DecodedJWT;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;

@Component
public class JwtValidator {

    private final String secret;
    private final String expectedIssuer;

    public JwtValidator(
            @Value("${jwt.secret}") String secret,
            @Value("${jwt.issuer:auth-service}") String expectedIssuer) {
        this.secret = secret;
        this.expectedIssuer = expectedIssuer;
    }

    public JwtClaims verify(String bearerToken) throws JWTVerificationException {
        if (bearerToken == null || !bearerToken.startsWith("Bearer ")) {
            throw new JWTVerificationException("Missing or malformed Authorization header");
        }

        String token = bearerToken.substring("Bearer ".length());

        try {
            DecodedJWT decodedUnverified = JWT.decode(token);
            
            String algorithmName = decodedUnverified.getHeaderClaim("alg").asString();
            if (algorithmName == null || algorithmName.isEmpty()) {
                throw new JWTVerificationException("Missing algorithm in token header");
            }

            if (!"HS256".equals(algorithmName)) {
                throw new JWTVerificationException("Unsupported or mismatched algorithm");
            }

            Algorithm algorithm = Algorithm.HMAC256(secret);
            DecodedJWT verified = JWT.require(algorithm)
                    .build()
                    .verify(token);

            Instant expiresAt = verified.getExpiresAtAsInstant();
            if (expiresAt != null && expiresAt.isBefore(Instant.now())) {
                throw new TokenExpiredException("Token has expired", expiresAt);
            }

            String sub = verified.getSubject();
            Long accountId = verified.getClaim("accountId").asLong();
            List<String> roles = verified.getClaim("roles").asList(String.class);
            Instant issuedAt = verified.getIssuedAtAsInstant();
            String issuer = verified.getIssuer();

            if (sub == null || roles == null || roles.isEmpty()) {
                throw new JWTVerificationException("Missing or invalid claims in token");
            }

            return new JwtClaims(sub, accountId, roles, issuedAt, expiresAt, issuer);

        } catch (SignatureVerificationException e) {
            throw e;
        } catch (TokenExpiredException e) {
            throw e;
        } catch (JWTDecodeException e) {
            throw new JWTVerificationException("Invalid token format", e);
        } catch (JWTVerificationException e) {
            throw e;
        } catch (Exception e) {
            throw new JWTVerificationException("Token verification failed: " + e.getMessage(), e);
        }
    }
}
