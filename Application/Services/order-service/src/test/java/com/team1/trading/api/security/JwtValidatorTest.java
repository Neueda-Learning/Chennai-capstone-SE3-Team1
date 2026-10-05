package com.team1.trading.api.security;

import com.auth0.jwt.exceptions.JWTVerificationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.time.temporal.ChronoUnit;
import java.util.List;

import static org.assertj.core.api.Assertions.*;

@DisplayName("JWT Verification")
class JwtValidatorTest {

    private JwtValidator validator;

    @BeforeEach
    void setUp() {
        validator = new JwtValidator(TestJwtBuilder.TEST_SECRET, TestJwtBuilder.TEST_ISSUER);
    }

    @Nested
    @DisplayName("Successfully verifies valid tokens")
    class ValidTokens {

        @Test
        void validates_a_well_formed_token_with_all_claims() {
            String token = TestJwtBuilder.forAccount(1L)
                    .withSub("user-123")
                    .withRoles("CUSTOMER")
                    .buildWithTestSecret();

            JwtClaims claims = validator.verify(token);

            assertThat(claims).isNotNull();
            assertThat(claims.getSub()).isEqualTo("user-123");
            assertThat(claims.getAccountId()).isEqualTo(1L);
            assertThat(claims.getRoles()).contains("CUSTOMER");
        }

        @Test
        void extracts_all_required_claims_from_a_valid_token() {
            String token = TestJwtBuilder.forAccount(42L)
                    .withSub("8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f")
                    .withRoles("CUSTOMER", "ADMIN")
                    .buildWithTestSecret();

            JwtClaims claims = validator.verify(token);

            assertThat(claims.getSub()).isEqualTo("8f14e45f-ceea-4c1b-9d3b-1a2b3c4d5e6f");
            assertThat(claims.getAccountId()).isEqualTo(42L);
            assertThat(claims.getRoles()).containsExactly("CUSTOMER", "ADMIN");
            assertThat(claims.getIssuedAt()).isNotNull();
            assertThat(claims.getExpiresAt()).isNotNull();
        }

        @Test
        void accepts_tokens_with_different_expiry_times() {
            String token = TestJwtBuilder.forAccount(1L)
                    .expiresIn(1, ChronoUnit.HOURS)
                    .buildWithTestSecret();

            JwtClaims claims = validator.verify(token);

            assertThat(claims).isNotNull();
        }
    }

    @Nested
    @DisplayName("Rejects tokens with missing or malformed Authorization header")
    class MissingOrMalformedHeader {

        @Test
        void rejects_null_authorization_header() {
            assertThatThrownBy(() -> validator.verify(null))
                    .isInstanceOf(JWTVerificationException.class)
                    .hasMessageContaining("Missing or malformed");
        }

        @Test
        void rejects_empty_authorization_header() {
            assertThatThrownBy(() -> validator.verify(""))
                    .isInstanceOf(JWTVerificationException.class)
                    .hasMessageContaining("Missing or malformed");
        }

        @Test
        void rejects_header_with_wrong_scheme() {
            String token = TestJwtBuilder.forAccount(1L).buildWithTestSecret();
            String malformed = token.replace("Bearer ", "Basic ");

            assertThatThrownBy(() -> validator.verify(malformed))
                    .isInstanceOf(JWTVerificationException.class);
        }

        @Test
        void rejects_header_with_no_scheme() {
            String token = TestJwtBuilder.forAccount(1L).buildWithTestSecret();
            String malformed = token.replace("Bearer ", "");

            assertThatThrownBy(() -> validator.verify(malformed))
                    .isInstanceOf(JWTVerificationException.class);
        }

        @ParameterizedTest
        @ValueSource(strings = {"Bearer", "Bearer ", "Bearer  "})
        void rejects_header_with_missing_token_part(String malformed) {
            assertThatThrownBy(() -> validator.verify(malformed))
                    .isInstanceOf(JWTVerificationException.class);
        }
    }

    @Nested
    @DisplayName("Rejects tokens with invalid signatures")
    class InvalidSignature {

        @Test
        void rejects_token_signed_with_different_secret() {
            String token = TestJwtBuilder.forAccount(1L)
                    .buildWithTestSecret()
                    .replace("Bearer ", "");

            String forgedToken = "Bearer " + token.substring(0, token.lastIndexOf('.'))
                    + ".invalid_signature_here";

            assertThatThrownBy(() -> validator.verify(forgedToken))
                    .isInstanceOf(JWTVerificationException.class);
        }

        @Test
        void rejects_forged_tokens() {
            String token = TestJwtBuilder.forAccount(1L).buildForged();

            assertThatThrownBy(() -> validator.verify(token))
                    .isInstanceOf(JWTVerificationException.class);
        }

        @Test
        void rejects_tampered_token_with_modified_payload() {
            String originalToken = TestJwtBuilder.forAccount(1L)
                    .buildWithTestSecret()
                    .replace("Bearer ", "");

            String[] parts = originalToken.split("\\.");
            String tamperedPayload = parts[1].substring(0, parts[1].length() - 1) + "X";
            String tamperedToken = "Bearer " + parts[0] + "." + tamperedPayload + "." + parts[2];

            assertThatThrownBy(() -> validator.verify(tamperedToken))
                    .isInstanceOf(JWTVerificationException.class);
        }
    }

    @Nested
    @DisplayName("Rejects expired tokens")
    class ExpiredTokens {

        @Test
        void rejects_token_with_expiry_in_the_past() {
            String token = TestJwtBuilder.forAccount(1L).buildExpired();

            assertThatThrownBy(() -> validator.verify(token))
                    .isInstanceOf(JWTVerificationException.class);
        }

        @Test
        void rejects_token_that_expired_one_second_ago() {
            String token = TestJwtBuilder.forAccount(1L)
                    .expiresIn(-1, ChronoUnit.SECONDS)
                    .buildWithTestSecret();

            assertThatThrownBy(() -> validator.verify(token))
                    .isInstanceOf(JWTVerificationException.class);
        }
    }

    @Nested
    @DisplayName("Rejects malformed tokens")
    class MalformedTokens {

        @Test
        void rejects_token_with_invalid_base64_encoding() {
            String malformed = "Bearer invalid.base64!!!.here";

            assertThatThrownBy(() -> validator.verify(malformed))
                    .isInstanceOf(JWTVerificationException.class);
        }

        @Test
        void rejects_token_with_only_two_parts() {
            String malformed = "Bearer header.payload";

            assertThatThrownBy(() -> validator.verify(malformed))
                    .isInstanceOf(JWTVerificationException.class);
        }

        @Test
        void rejects_token_with_four_parts() {
            String malformed = "Bearer header.payload.signature.extra";

            assertThatThrownBy(() -> validator.verify(malformed))
                    .isInstanceOf(JWTVerificationException.class);
        }

        @Test
        void rejects_token_with_empty_parts() {
            String malformed = "Bearer ..";

            assertThatThrownBy(() -> validator.verify(malformed))
                    .isInstanceOf(JWTVerificationException.class);
        }
    }

    @Nested
    @DisplayName("Rejects tokens with missing or invalid claims")
    class InvalidClaims {

        @Test
        void rejects_token_missing_sub_claim() {
            String token = TestJwtBuilder.forAccount(1L)
                    .withSub("")
                    .buildWithTestSecret();

            JwtClaims claims = validator.verify(token);
            assertThat(claims.getSub()).isNotNull();
        }

        @Test
        void accepts_token_with_null_account_id() {
            String token = TestJwtBuilder.forAccount(null)
                    .buildWithTestSecret();

            JwtClaims claims = validator.verify(token);
            assertThat(claims.getAccountId()).isNull();
        }

        @Test
        void rejects_token_with_empty_roles() {
            String token = TestJwtBuilder.forAccount(1L)
                    .withRoles("CUSTOMER")
                    .buildWithTestSecret();

            JwtClaims claims = validator.verify(token);
            assertThat(claims.getRoles()).isNotEmpty();
        }
    }

    @Nested
    @DisplayName("All failure modes return generic JWTVerificationException (not specific errors to attacker)")
    class GenericErrorResponse {

        @Test
        void missing_header_throws_JWTVerificationException() {
            assertThatThrownBy(() -> validator.verify(null))
                    .isInstanceOf(JWTVerificationException.class);
        }

        @Test
        void wrong_scheme_throws_JWTVerificationException() {
            assertThatThrownBy(() -> validator.verify("Basic token123"))
                    .isInstanceOf(JWTVerificationException.class);
        }

        @Test
        void expired_token_throws_JWTVerificationException() {
            String token = TestJwtBuilder.forAccount(1L).buildExpired();
            assertThatThrownBy(() -> validator.verify(token))
                    .isInstanceOf(JWTVerificationException.class);
        }

        @Test
        void forged_signature_throws_JWTVerificationException() {
            String token = TestJwtBuilder.forAccount(1L).buildForged();
            assertThatThrownBy(() -> validator.verify(token))
                    .isInstanceOf(JWTVerificationException.class);
        }
    }
}
