BEGIN;

-- =============================================================================
-- Users: the Sprint 8 identity model.
--
-- The contract in contracts/auth-api.yaml defines a username-keyed identity with
-- a UUID `sub`, a numeric trading account key (`ACCOUNTS.id` == clients.client_id)
-- and an authorisation role list. Registration links a NEW user to an EXISTING
-- trading account; it never creates a clients row. Accounts are owned by the
-- Sprint 3 schema, so registering against an unknown accountId fails validation.
--
-- This supersedes the email-keyed `auth` table (003_auth.sql) for the auth
-- service. The old table is left in place for the Sprint 3 seed.
-- =============================================================================
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

-- =============================================================================
-- Refresh tokens: opaque, stored as a SHA-256 digest (never the token itself),
-- so read access to this table is not session takeover. Every refresh rotates:
-- the presented token is revoked, a new one is stored. Presenting a consumed
-- token is treated as theft and revokes the whole chain for that user.
-- =============================================================================
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