BEGIN;

ALTER TABLE bank_account
    DROP COLUMN name;

COMMIT;
