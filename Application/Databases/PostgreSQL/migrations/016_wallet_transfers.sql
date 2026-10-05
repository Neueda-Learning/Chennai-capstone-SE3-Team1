BEGIN;

CREATE TABLE wallet_transfers (
    transfer_id      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id        BIGINT          NOT NULL REFERENCES clients(client_id),
    account_number   VARCHAR(34)     NOT NULL REFERENCES bank_account(account_number),
    direction        VARCHAR(16)     NOT NULL,
    amount           DECIMAL(18,2)   NOT NULL,
    idempotency_key  VARCHAR(100)    NOT NULL,
    created_at       TIMESTAMP       NOT NULL DEFAULT now(),
    CONSTRAINT chk_wallet_transfers_direction
        CHECK (direction IN ('BANK_TO_WALLET', 'WALLET_TO_BANK')),
    CONSTRAINT chk_wallet_transfers_amount_positive CHECK (amount > 0),
    CONSTRAINT uq_wallet_transfers_idempotency_key UNIQUE (idempotency_key)
);

CREATE INDEX idx_wallet_transfers_client_id ON wallet_transfers(client_id);

COMMIT;
