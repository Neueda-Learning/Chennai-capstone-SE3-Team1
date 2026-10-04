BEGIN;

-- =============================================================================
-- Enforce one user per account: each trading account can only have one
-- registered user. This prevents multiple identities from using the same
-- account ID simultaneously.
-- =============================================================================

ALTER TABLE users ADD CONSTRAINT uq_users_account_id UNIQUE (account_id);

COMMIT;
