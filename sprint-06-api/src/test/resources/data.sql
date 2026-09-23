-- Seed data for unit and integration tests.
-- Matches the seed CSV files under /seed/ and the test fixtures in the mapper tests.

-- Clients (matches seed/010_clients.csv)
INSERT INTO clients (client_id, name, email, phone, account_state, wallet_balance, version, updated_on)
VALUES (1, 'Aarav Mehta', 'aarav.mehta@example.com', '+919812345001', 'ACTIVE', 125000.00, 0, CURRENT_TIMESTAMP);
INSERT INTO clients (client_id, name, email, phone, account_state, wallet_balance, version, updated_on)
VALUES (2, 'Diya Sharma', 'diya.sharma@example.com', '+919812345002', 'ACTIVE', 48250.50, 0, CURRENT_TIMESTAMP);
INSERT INTO clients (client_id, name, email, phone, account_state, wallet_balance, version, updated_on)
VALUES (3, 'Rohan Iyer', 'rohan.iyer@example.com', '+919812345003', 'ACTIVE', 310400.75, 0, CURRENT_TIMESTAMP);
INSERT INTO clients (client_id, name, email, phone, account_state, wallet_balance, version, updated_on)
VALUES (4, 'Meera Nair', 'meera.nair@example.com', '+919812345004', 'SUSPENDED', 15000.00, 0, CURRENT_TIMESTAMP);
INSERT INTO clients (client_id, name, email, phone, account_state, wallet_balance, version, updated_on)
VALUES (5, 'Vikram Rao', 'vikram.rao@example.com', '+919812345005', 'ACTIVE', 92750.25, 0, CURRENT_TIMESTAMP);
INSERT INTO clients (client_id, name, email, phone, account_state, wallet_balance, version, updated_on)
VALUES (6, 'Sanya Kapoor', 'sanya.kapoor@example.com', '+919812345006', 'CLOSED', 0.00, 0, CURRENT_TIMESTAMP);

-- Move the identity past the explicit ids, as fn_resync_sequences() does after the real seed.
ALTER TABLE clients ALTER COLUMN client_id RESTART WITH 7;

-- Bank accounts (matches seed/020_bank_account.csv); each names its client.
INSERT INTO bank_account (account_number, client_id, name, account_balance, bank_name, ifsc_code)
VALUES ('IN45HDFC0000001234567', 1, 'Aarav Mehta', 0.00, 'HDFC Bank', 'HDFC0001234');
INSERT INTO bank_account (account_number, client_id, name, account_balance, bank_name, ifsc_code)
VALUES ('IN45ICIC0000002345678', 2, 'Diya Sharma', 0.00, 'ICICI Bank', 'ICIC0002345');
INSERT INTO bank_account (account_number, client_id, name, account_balance, bank_name, ifsc_code)
VALUES ('IN45SBIN0000003456789', 3, 'Rohan Iyer', 0.00, 'State Bank', 'SBIN0003456');
INSERT INTO bank_account (account_number, client_id, name, account_balance, bank_name, ifsc_code)
VALUES ('IN45AXIS0000004567890', 4, 'Meera Nair', 0.00, 'Axis Bank', 'UTIB0004567');
INSERT INTO bank_account (account_number, client_id, name, account_balance, bank_name, ifsc_code)
VALUES ('IN45KKBK0000005678901', 5, 'Vikram Rao', 0.00, 'Kotak Mahindra', 'KKBK0005678');
INSERT INTO bank_account (account_number, client_id, name, account_balance, bank_name, ifsc_code)
VALUES ('IN45YESB0000006789012', 6, 'Sanya Kapoor', 0.00, 'Yes Bank', 'YESB0006789');
-- Unclaimed bank accounts (client_id NULL), as in seed/020_bank_account.csv.
INSERT INTO bank_account (account_number, client_id, name, account_balance, bank_name, ifsc_code)
VALUES ('IN45HDFC0000007890123', NULL, 'Priya Menon', 150000.00, 'HDFC Bank', 'HDFC0007890');
INSERT INTO bank_account (account_number, client_id, name, account_balance, bank_name, ifsc_code)
VALUES ('IN45ICIC0000008901234', NULL, 'Arjun Reddy', 92500.00, 'ICICI Bank', 'ICIC0008901');

-- Users (matches seed/030_users.csv); each owns the client with the same id.
INSERT INTO users (username, email, account_id, password_hash)
VALUES ('aarav.mehta', 'aarav.mehta@example.com', 1, 'seed-placeholder-hash');
INSERT INTO users (username, email, account_id, password_hash)
VALUES ('diya.sharma', 'diya.sharma@example.com', 2, 'seed-placeholder-hash');
INSERT INTO users (username, email, account_id, password_hash)
VALUES ('rohan.iyer', 'rohan.iyer@example.com', 3, 'seed-placeholder-hash');
INSERT INTO users (username, email, account_id, password_hash)
VALUES ('meera.nair', 'meera.nair@example.com', 4, 'seed-placeholder-hash');
INSERT INTO users (username, email, account_id, password_hash)
VALUES ('vikram.rao', 'vikram.rao@example.com', 5, 'seed-placeholder-hash');
INSERT INTO users (username, email, account_id, password_hash)
VALUES ('sanya.kapoor', 'sanya.kapoor@example.com', 6, 'seed-placeholder-hash');

-- Instruments (matches seed/040_instruments.csv)
INSERT INTO instruments (instrument_id, instrument_name, active, updated_on)
VALUES ('RELIANCE', 'Reliance Industries', TRUE, NULL);
INSERT INTO instruments (instrument_id, instrument_name, active, updated_on)
VALUES ('TCS', 'Tata Consultancy Services', TRUE, NULL);
INSERT INTO instruments (instrument_id, instrument_name, active, updated_on)
VALUES ('INFY', 'Infosys', TRUE, NULL);
INSERT INTO instruments (instrument_id, instrument_name, active, updated_on)
VALUES ('HDFCBANK', 'HDFC Bank', TRUE, NULL);
INSERT INTO instruments (instrument_id, instrument_name, active, updated_on)
VALUES ('ICICIBANK', 'ICICI Bank', TRUE, NULL);
INSERT INTO instruments (instrument_id, instrument_name, active, updated_on)
VALUES ('ITC', 'ITC', TRUE, NULL);
INSERT INTO instruments (instrument_id, instrument_name, active, updated_on)
VALUES ('TATAMOTORS', 'Tata Motors', TRUE, NULL);
INSERT INTO instruments (instrument_id, instrument_name, active, updated_on)
VALUES ('LEGACYCORP', 'Legacy Corp', FALSE, TIMESTAMP '2025-11-14 15:30:00');
