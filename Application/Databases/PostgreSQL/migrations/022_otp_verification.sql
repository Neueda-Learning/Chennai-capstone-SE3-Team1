BEGIN;

-- =============================================================================
-- OTP email verification, used both to complete a first-time registration and
-- to reset a forgotten password.
--
-- users.status gates sign-in. PENDING users have registered but not yet proven
-- the email address; the OTP issued at registration activates them. Every
-- existing row (including seeded users) takes the DEFAULT, ACTIVE, and keeps
-- working exactly as before.
--
-- otp_codes stores only a SHA-256 digest of each one-time code, never the code
-- itself, mirroring how refresh_tokens are stored: read access to this table
-- is not an OTP oracle. A new code for the same email+purpose burns any code
-- the previous request left waiting.
-- =============================================================================

ALTER TABLE auth_db.users ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE auth_db.users ADD CONSTRAINT chk_users_status CHECK (status IN ('PENDING', 'ACTIVE'));

CREATE TABLE auth_db.otp_codes (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    email        VARCHAR(150) NOT NULL,
    purpose      VARCHAR(16)  NOT NULL,
    code_hash    CHAR(64)     NOT NULL,
    expires_at   TIMESTAMP    NOT NULL,
    consumed_at  TIMESTAMP,
    attempts     INT          NOT NULL DEFAULT 0,
    created_at   TIMESTAMP    NOT NULL DEFAULT now(),
    CONSTRAINT chk_otp_purpose
        CHECK (purpose IN ('REGISTER', 'RESET')),
    CONSTRAINT chk_otp_expires_after_created CHECK (expires_at > created_at),
    CONSTRAINT chk_otp_attempts_non_negative  CHECK (attempts >= 0)
);

CREATE INDEX idx_otp_codes_email_purpose ON auth_db.otp_codes(email, purpose);

COMMIT;