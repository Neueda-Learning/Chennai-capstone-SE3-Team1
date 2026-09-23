BEGIN;

-- =============================================================================
-- One direction of ownership between clients and bank_account.
--
-- clients.account_number pointed at bank_account while bank_account.client_id
-- pointed back at clients. The pair said the same thing twice, could disagree,
-- and forced one of the two foreign keys to be deferred so either row could be
-- written at all. bank_account.client_id alone is the link now: a client's bank
-- account is the bank_account row that names it.
--
-- A client links one bank account (the Trade REST API's link endpoint refuses a
-- second), so client_id is unique in bank_account, and the lookup from a client
-- to its account number is a single row.
-- =============================================================================

-- Drops clients_account_number_fkey and idx_clients_account_number with it.
ALTER TABLE clients DROP COLUMN account_number;

-- With nothing pointing the other way, the key no longer needs to wait for COMMIT:
-- the client row is always written first.
ALTER TABLE bank_account DROP CONSTRAINT fk_bank_account_client;
ALTER TABLE bank_account
    ADD CONSTRAINT fk_bank_account_client
    FOREIGN KEY (client_id) REFERENCES clients(client_id);

-- The unique constraint's index replaces the plain one.
DROP INDEX idx_bank_account_client_id;
ALTER TABLE bank_account ADD CONSTRAINT uq_bank_account_client_id UNIQUE (client_id);

COMMIT;
