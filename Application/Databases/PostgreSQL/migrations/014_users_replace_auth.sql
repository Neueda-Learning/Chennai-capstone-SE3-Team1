BEGIN;

-- =============================================================================
-- users replaces auth as the only credential store.
--
-- auth (003, 011) was the email-keyed credential table from Sprint 3; users (012)
-- is the Sprint 8 identity model the auth service actually reads. Keeping both
-- meant two password hashes per person with nothing to keep them in step, so
-- auth goes and users takes over its one extra column, email.
--
-- Registration now creates a user before any trading account exists. The user
-- can log in straight away, but trades nothing until they link a bank account
-- through the Trade REST API, which creates the bank_account and clients rows
-- and fills in users.account_id in the same transaction. account_id is
-- therefore nullable: NULL means "registered, no bank account linked yet".
-- uq_users_account_id (013) still holds, and NULLs do not collide under it.
-- =============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(150);

-- A database built before this migration has users that were registered against
-- an existing client; their email is the client's.
UPDATE users u
SET    email = c.email
FROM   clients c
WHERE  c.client_id = u.account_id
  AND  u.email IS NULL;

ALTER TABLE users
    ALTER COLUMN email SET NOT NULL,
    ADD CONSTRAINT uq_users_email UNIQUE (email),
    ADD CONSTRAINT chk_users_email_not_blank CHECK (length(btrim(email)) > 0),
    ALTER COLUMN account_id DROP NOT NULL;

DROP TABLE auth;

COMMIT;
