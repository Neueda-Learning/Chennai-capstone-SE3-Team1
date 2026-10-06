BEGIN;

-- The notification ledger (ADR 0004). event_id is the idempotency key: the Kafka event id for
-- trade events, the delivery id for price alerts. UNIQUE(event_id) makes a replay a no-op.
-- address is the resolved destination, kept on the row for audit and never returned by any route.
-- payload is a small JSON document of order or alert facts as text; it holds no credentials.

CREATE TABLE notifications (
    id           UUID          PRIMARY KEY,
    event_id     VARCHAR(64)   NOT NULL,
    account_id   BIGINT        NOT NULL REFERENCES clients(client_id),
    kind         VARCHAR(20)   NOT NULL,
    channel      VARCHAR(10),
    address      VARCHAR(150),
    status       VARCHAR(20)   NOT NULL,
    failure_code VARCHAR(40),
    payload      TEXT          NOT NULL,
    created_at   TIMESTAMP     NOT NULL DEFAULT now(),
    delivered_at TIMESTAMP,
    CONSTRAINT uq_notifications_event_id UNIQUE (event_id),
    CONSTRAINT chk_notifications_kind
        CHECK (kind IN ('ORDER_FILLED', 'ORDER_REJECTED', 'ORDER_CANCELLED', 'PRICE_ALERT')),
    CONSTRAINT chk_notifications_channel
        CHECK (channel IS NULL OR channel IN ('EMAIL', 'SMS', 'PUSH')),
    CONSTRAINT chk_notifications_status
        CHECK (status IN ('PENDING_CHANNEL', 'QUEUED', 'SENT', 'FAILED'))
);

CREATE INDEX idx_notifications_account_created ON notifications (account_id, created_at DESC);
CREATE INDEX idx_notifications_status_created ON notifications (status, created_at)
    WHERE status IN ('PENDING_CHANNEL', 'QUEUED');

COMMIT;
