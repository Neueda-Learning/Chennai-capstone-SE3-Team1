BEGIN;

-- Email is a channel again (decision-log 0017): the order service sends EMAIL notifications through
-- the same SMTP account the auth service uses for OTP codes. 031 narrowed both checks to PUSH only;
-- this puts back the 028 definition. Nobody is moved to EMAIL: customers choose it in Settings.
-- 032's activation of PENDING users stands; only new registrations wait for their emailed code.

ALTER TABLE customer_preferences DROP CONSTRAINT chk_customer_preferences_channel;
ALTER TABLE customer_preferences
    ADD CONSTRAINT chk_customer_preferences_channel CHECK (channel IS NULL OR channel IN ('EMAIL', 'PUSH'));

ALTER TABLE notifications DROP CONSTRAINT chk_notifications_channel;
ALTER TABLE notifications
    ADD CONSTRAINT chk_notifications_channel CHECK (channel IS NULL OR channel IN ('EMAIL', 'PUSH'));

COMMIT;
