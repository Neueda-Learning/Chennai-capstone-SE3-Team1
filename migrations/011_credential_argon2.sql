BEGIN;

-- Add params_version for algorithm parameter upgrades
-- All rows share the same version; current version lives in code constants
ALTER TABLE auth
    ADD COLUMN IF NOT EXISTS params_version INT NOT NULL DEFAULT 1;

-- Existing rows get version 1
UPDATE auth SET params_version = 1 WHERE params_version IS NULL;

COMMIT;