BEGIN;

ALTER TABLE clients DROP COLUMN account_number;

ALTER TABLE bank_account DROP CONSTRAINT fk_bank_account_client;
ALTER TABLE bank_account
    ADD CONSTRAINT fk_bank_account_client
    FOREIGN KEY (client_id) REFERENCES clients(client_id);

DROP INDEX idx_bank_account_client_id;
ALTER TABLE bank_account ADD CONSTRAINT uq_bank_account_client_id UNIQUE (client_id);

COMMIT;
