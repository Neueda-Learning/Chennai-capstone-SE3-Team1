BEGIN;

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