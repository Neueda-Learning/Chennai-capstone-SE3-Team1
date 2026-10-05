BEGIN;

ALTER TABLE bank_account
    DROP COLUMN phone,
    DROP COLUMN email;

COMMIT;
