BEGIN;

-- SMS is no longer a channel: there is no provider, and email goes through the same SMTP account
-- the auth service uses for OTPs. Customers who had chosen SMS fall back to EMAIL; held or queued
-- messages for SMS go back to PENDING_CHANNEL so the 60 s scanner re-resolves them.

UPDATE customer_preferences SET channel = 'EMAIL', updated_at = now() WHERE channel = 'SMS';

UPDATE notifications SET status = 'PENDING_CHANNEL' WHERE channel = 'SMS' AND status = 'QUEUED';
UPDATE notifications SET channel = NULL, address = NULL WHERE channel = 'SMS';

ALTER TABLE customer_preferences DROP CONSTRAINT chk_customer_preferences_channel;
ALTER TABLE customer_preferences
    ADD CONSTRAINT chk_customer_preferences_channel CHECK (channel IS NULL OR channel IN ('EMAIL', 'PUSH'));

ALTER TABLE notifications DROP CONSTRAINT chk_notifications_channel;
ALTER TABLE notifications
    ADD CONSTRAINT chk_notifications_channel CHECK (channel IS NULL OR channel IN ('EMAIL', 'PUSH'));

COMMIT;
