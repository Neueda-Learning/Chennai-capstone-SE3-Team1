BEGIN;

-- Email verification is gone: registration creates users ACTIVE and there is no route that turns a
-- PENDING user ACTIVE any more. Anyone who registered but never entered their code is activated so
-- they can sign in. The status column and otp_codes table stay; nothing writes to them.

UPDATE auth_db.users SET status = 'ACTIVE', updated = now() WHERE status = 'PENDING';

COMMIT;
