BEGIN;

ALTER TABLE users ADD CONSTRAINT uq_users_account_id UNIQUE (account_id);

COMMIT;
