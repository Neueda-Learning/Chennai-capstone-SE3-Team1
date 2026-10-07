BEGIN;

-- Email is no longer a channel: nothing in the platform sends mail, and the in-app inbox (PUSH) is
-- the only delivery. Customers who had chosen EMAIL fall back to PUSH; queued EMAIL messages go back
-- to PENDING_CHANNEL so the 60 s scanner re-resolves them to the inbox.

UPDATE customer_preferences SET channel = 'PUSH', updated_at = now() WHERE channel = 'EMAIL';

UPDATE notifications SET status = 'PENDING_CHANNEL' WHERE channel = 'EMAIL' AND status = 'QUEUED';
UPDATE notifications SET channel = NULL, address = NULL WHERE channel = 'EMAIL';

ALTER TABLE customer_preferences DROP CONSTRAINT chk_customer_preferences_channel;
ALTER TABLE customer_preferences
    ADD CONSTRAINT chk_customer_preferences_channel CHECK (channel IS NULL OR channel = 'PUSH');

ALTER TABLE notifications DROP CONSTRAINT chk_notifications_channel;
ALTER TABLE notifications
    ADD CONSTRAINT chk_notifications_channel CHECK (channel IS NULL OR channel = 'PUSH');

COMMIT;
