BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(150);

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
