BEGIN;

-- Holds the channel choice and default account only. No email or phone is stored here:
-- the contact detail is read from auth_db.users when a message is sent (ADR 0003).
-- channel_contact_override is reserved and not written by any Sprint 10 route.

CREATE TABLE customer_preferences (
    account_id               BIGINT        PRIMARY KEY REFERENCES clients(client_id),
    default_account_id       BIGINT        NOT NULL REFERENCES clients(client_id),
    channel                  VARCHAR(10),
    channel_contact_override VARCHAR(150),
    created_at               TIMESTAMP     NOT NULL DEFAULT now(),
    updated_at               TIMESTAMP     NOT NULL DEFAULT now(),
    CONSTRAINT chk_customer_preferences_channel
        CHECK (channel IS NULL OR channel IN ('EMAIL', 'SMS', 'PUSH'))
);

COMMIT;
