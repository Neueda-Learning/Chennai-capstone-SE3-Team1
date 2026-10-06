BEGIN;

-- Wallet transfers get an email (and an inbox entry) like orders do. The ledger's kind check has to
-- allow them first. event_id for these rows is 'transfer-<transfer_id>' (45 characters, inside the
-- 64 the column allows), so a retried record is a no-op just as it is for trade events.

ALTER TABLE notifications DROP CONSTRAINT chk_notifications_kind;
ALTER TABLE notifications ADD CONSTRAINT chk_notifications_kind
    CHECK (kind IN ('ORDER_FILLED', 'ORDER_REJECTED', 'ORDER_CANCELLED', 'PRICE_ALERT',
                    'TRANSFER_IN', 'TRANSFER_OUT'));

COMMIT;
