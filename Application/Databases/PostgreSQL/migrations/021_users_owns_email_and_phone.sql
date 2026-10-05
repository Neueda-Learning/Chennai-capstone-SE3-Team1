BEGIN;

ALTER TABLE auth_db.users ADD COLUMN phone VARCHAR(20);

ALTER TABLE clients
    DROP COLUMN email,
    DROP COLUMN phone;

COMMIT;
