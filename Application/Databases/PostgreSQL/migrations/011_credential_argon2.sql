BEGIN;

ALTER TABLE auth
    ADD COLUMN IF NOT EXISTS params_version INT NOT NULL DEFAULT 1;

UPDATE auth SET params_version = 1 WHERE params_version IS NULL;

COMMIT;