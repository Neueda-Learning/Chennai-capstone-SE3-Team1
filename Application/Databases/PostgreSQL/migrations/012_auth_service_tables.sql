BEGIN;

CREATE TABLE IF NOT EXISTS users (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    username       VARCHAR(64)  NOT NULL UNIQUE,
    account_id     BIGINT       NOT NULL REFERENCES clients(client_id),
    roles          TEXT[]       NOT NULL DEFAULT ARRAY['CUSTOMER'],
    password_hash  VARCHAR(255) NOT NULL,
    params_version INT          NOT NULL DEFAULT 1,
    version        INT          NOT NULL DEFAULT 0,
    created_on     TIMESTAMP    NOT NULL DEFAULT now(),
    updated        TIMESTAMP    NOT NULL DEFAULT now(),
    CONSTRAINT chk_users_username_format
        CHECK (
            username ~ '^[a-zA-Z0-9._-]+$'
            AND char_length(username) BETWEEN 3 AND 64
        ),
    CONSTRAINT chk_users_password_not_blank   CHECK (length(btrim(password_hash)) > 0),
    CONSTRAINT chk_users_roles_not_empty      CHECK (cardinality(roles) > 0),
    CONSTRAINT chk_users_version_non_negative CHECK (version >= 0)
);

CREATE INDEX idx_users_account_id ON users(account_id);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64)  NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_refresh_expires_after_created CHECK (expires_at > created_at)
);

CREATE INDEX idx_refresh_tokens_user_id    ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);

COMMIT;