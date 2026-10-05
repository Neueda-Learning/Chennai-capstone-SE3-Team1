\restrict 6FcH9VdoWZzsRWAdvYLkyxWGp0sFiQIIpCeydIyY2WdAqL93UM6kbv1rfCdkzjJ

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

INSERT INTO public.clients (client_id, name, created_on, account_state, wallet_balance, version, updated_on) VALUES (1, 'Aarav Mehta', '2026-10-04 13:21:42.804022', 'ACTIVE', 125000.00, 0, '2026-10-04 13:21:42.804022');
INSERT INTO public.clients (client_id, name, created_on, account_state, wallet_balance, version, updated_on) VALUES (2, 'Diya Sharma', '2026-10-04 13:21:42.804022', 'ACTIVE', 48250.50, 0, '2026-10-04 13:21:42.804022');
INSERT INTO public.clients (client_id, name, created_on, account_state, wallet_balance, version, updated_on) VALUES (3, 'Rohan Iyer', '2026-10-04 13:21:42.804022', 'ACTIVE', 310400.75, 0, '2026-10-04 13:21:42.804022');
INSERT INTO public.clients (client_id, name, created_on, account_state, wallet_balance, version, updated_on) VALUES (4, 'Meera Nair', '2026-10-04 13:21:42.804022', 'SUSPENDED', 15000.00, 0, '2026-10-04 13:21:42.804022');
INSERT INTO public.clients (client_id, name, created_on, account_state, wallet_balance, version, updated_on) VALUES (5, 'Vikram Rao', '2026-10-04 13:21:42.804022', 'ACTIVE', 92750.25, 0, '2026-10-04 13:21:42.804022');
INSERT INTO public.clients (client_id, name, created_on, account_state, wallet_balance, version, updated_on) VALUES (6, 'Sanya Kapoor', '2026-10-04 13:21:42.804022', 'CLOSED', 0.00, 0, '2026-10-04 13:21:42.804022');


INSERT INTO auth_db.users (id, username, account_id, roles, password_hash, params_version, version, created_on, updated, email, phone, status) VALUES ('dc46acc7-d534-4872-a8a8-d4cff58af0f6', 'aarav.mehta', 1, '{CUSTOMER}', '$argon2id$v=19$m=65536,t=3,p=4$j3mfIAIipurSnElhvqSpcw$5XeGea39WSmKJJf7yQLKj/tI+pTCo9Nc2tBibLIHnzg', 1, 0, '2026-10-04 13:21:42.804022', '2026-10-04 13:21:42.804022', 'aarav.mehta@example.com', NULL, 'ACTIVE');
INSERT INTO auth_db.users (id, username, account_id, roles, password_hash, params_version, version, created_on, updated, email, phone, status) VALUES ('dd2548a8-9fb3-47b6-9a7f-0059f72a8c67', 'diya.sharma', 2, '{CUSTOMER}', '$argon2id$v=19$m=65536,t=3,p=4$j3mfIAIipurSnElhvqSpcw$5XeGea39WSmKJJf7yQLKj/tI+pTCo9Nc2tBibLIHnzg', 1, 0, '2026-10-04 13:21:42.804022', '2026-10-04 13:21:42.804022', 'diya.sharma@example.com', NULL, 'ACTIVE');
INSERT INTO auth_db.users (id, username, account_id, roles, password_hash, params_version, version, created_on, updated, email, phone, status) VALUES ('cf707651-5b84-4882-a3ef-c1f631c8b3f7', 'rohan.iyer', 3, '{CUSTOMER}', '$argon2id$v=19$m=65536,t=3,p=4$j3mfIAIipurSnElhvqSpcw$5XeGea39WSmKJJf7yQLKj/tI+pTCo9Nc2tBibLIHnzg', 1, 0, '2026-10-04 13:21:42.804022', '2026-10-04 13:21:42.804022', 'rohan.iyer@example.com', NULL, 'ACTIVE');
INSERT INTO auth_db.users (id, username, account_id, roles, password_hash, params_version, version, created_on, updated, email, phone, status) VALUES ('cdd55909-e6b0-435c-91ab-e766cdb4728f', 'meera.nair', 4, '{CUSTOMER}', '$argon2id$v=19$m=65536,t=3,p=4$j3mfIAIipurSnElhvqSpcw$5XeGea39WSmKJJf7yQLKj/tI+pTCo9Nc2tBibLIHnzg', 1, 0, '2026-10-04 13:21:42.804022', '2026-10-04 13:21:42.804022', 'meera.nair@example.com', NULL, 'ACTIVE');
INSERT INTO auth_db.users (id, username, account_id, roles, password_hash, params_version, version, created_on, updated, email, phone, status) VALUES ('ab518f70-7c90-4ce2-a1d7-7632413ccfb4', 'vikram.rao', 5, '{CUSTOMER}', '$argon2id$v=19$m=65536,t=3,p=4$j3mfIAIipurSnElhvqSpcw$5XeGea39WSmKJJf7yQLKj/tI+pTCo9Nc2tBibLIHnzg', 1, 0, '2026-10-04 13:21:42.804022', '2026-10-04 13:21:42.804022', 'vikram.rao@example.com', NULL, 'ACTIVE');
INSERT INTO auth_db.users (id, username, account_id, roles, password_hash, params_version, version, created_on, updated, email, phone, status) VALUES ('cc578746-d8db-4e29-852d-23d863805119', 'sanya.kapoor', 6, '{CUSTOMER}', '$argon2id$v=19$m=65536,t=3,p=4$j3mfIAIipurSnElhvqSpcw$5XeGea39WSmKJJf7yQLKj/tI+pTCo9Nc2tBibLIHnzg', 1, 0, '2026-10-04 13:21:42.804022', '2026-10-04 13:21:42.804022', 'sanya.kapoor@example.com', NULL, 'ACTIVE');


INSERT INTO public.bank_account (account_number, client_id, account_balance, bank_name, ifsc_code) VALUES ('IN45HDFC0000001234567', 1, 485200.00, 'HDFC Bank', 'HDFC0001234');
INSERT INTO public.bank_account (account_number, client_id, account_balance, bank_name, ifsc_code) VALUES ('IN45ICIC0000002345678', 2, 129750.50, 'ICICI Bank', 'ICIC0002345');
INSERT INTO public.bank_account (account_number, client_id, account_balance, bank_name, ifsc_code) VALUES ('IN45SBIN0000003456789', 3, 873400.25, 'State Bank', 'SBIN0003456');
INSERT INTO public.bank_account (account_number, client_id, account_balance, bank_name, ifsc_code) VALUES ('IN45AXIS0000004567890', 4, 64300.00, 'Axis Bank', 'UTIB0004567');
INSERT INTO public.bank_account (account_number, client_id, account_balance, bank_name, ifsc_code) VALUES ('IN45KKBK0000005678901', 5, 251000.75, 'Kotak Mahindra', 'KKBK0005678');
INSERT INTO public.bank_account (account_number, client_id, account_balance, bank_name, ifsc_code) VALUES ('IN45YESB0000006789012', 6, 0.00, 'Yes Bank', 'YESB0006789');
INSERT INTO public.bank_account (account_number, client_id, account_balance, bank_name, ifsc_code) VALUES ('IN45HDFC0000007890123', NULL, 150000.00, 'HDFC Bank', 'HDFC0007890');
INSERT INTO public.bank_account (account_number, client_id, account_balance, bank_name, ifsc_code) VALUES ('IN45ICIC0000008901234', NULL, 92500.00, 'ICICI Bank', 'ICIC0008901');
INSERT INTO public.bank_account (account_number, client_id, account_balance, bank_name, ifsc_code) VALUES ('IN45SBIN0000009012345', NULL, 310000.00, 'State Bank', 'SBIN0009012');
INSERT INTO public.bank_account (account_number, client_id, account_balance, bank_name, ifsc_code) VALUES ('IN45AXIS0000010123456', NULL, 48000.50, 'Axis Bank', 'UTIB0010123');
INSERT INTO public.bank_account (account_number, client_id, account_balance, bank_name, ifsc_code) VALUES ('IN45KKBK0000011234567', NULL, 225750.00, 'Kotak Mahindra', 'KKBK0011234');
INSERT INTO public.bank_account (account_number, client_id, account_balance, bank_name, ifsc_code) VALUES ('IN45YESB0000012345678', NULL, 5000.00, 'Yes Bank', 'YESB0012345');


INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('RELIANCE', 'Reliance Industries', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('TCS', 'Tata Consultancy Services', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('INFY', 'Infosys', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('HDFCBANK', 'HDFC Bank', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('ICICIBANK', 'ICICI Bank', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('ITC', 'ITC', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('HINDUNILVR', 'Hindustan Unilever', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('SBIN', 'State Bank of India', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('BHARTIARTL', 'Bharti Airtel', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('BAJFINANCE', 'Bajaj Finance', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('KOTAKBANK', 'Kotak Mahindra Bank', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('LT', 'Larsen & Toubro', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('HCLTECH', 'HCL Technologies', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('ASIANPAINT', 'Asian Paints', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('AXISBANK', 'Axis Bank', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('MARUTI', 'Maruti Suzuki India', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('SUNPHARMA', 'Sun Pharmaceutical Industries', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('TITAN', 'Titan Company', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('ULTRACEMCO', 'UltraTech Cement', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('WIPRO', 'Wipro', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('NESTLEIND', 'Nestle India', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('ONGC', 'Oil and Natural Gas Corporation', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('NTPC', 'NTPC', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('POWERGRID', 'Power Grid Corporation of India', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('TATASTEEL', 'Tata Steel', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('JSWSTEEL', 'JSW Steel', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('ADANIENT', 'Adani Enterprises', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('ADANIPORTS', 'Adani Ports and SEZ', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('GRASIM', 'Grasim Industries', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('HINDALCO', 'Hindalco Industries', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('INDUSINDBK', 'IndusInd Bank', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('TECHM', 'Tech Mahindra', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('CIPLA', 'Cipla', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('DRREDDY', 'Dr. Reddy''s Laboratories', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('BAJAJFINSV', 'Bajaj Finserv', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('HEROMOTOCO', 'Hero MotoCorp', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('EICHERMOT', 'Eicher Motors', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('BRITANNIA', 'Britannia Industries', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('COALINDIA', 'Coal India', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('BPCL', 'Bharat Petroleum Corporation', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('APOLLOHOSP', 'Apollo Hospitals Enterprise', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('TATACONSUM', 'Tata Consumer Products', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('SBILIFE', 'SBI Life Insurance Company', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('HDFCLIFE', 'HDFC Life Insurance Company', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('SHREECEM', 'Shree Cement', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('DIVISLAB', 'Divi''s Laboratories', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('LTIM', 'LTIMindtree', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('BANKBARODA', 'Bank of Baroda', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('PNB', 'Punjab National Bank', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('CANBK', 'Canara Bank', true, NULL);
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('TATAMOTORS', 'Tata Motors', false, '2026-10-05 00:00:00');
INSERT INTO public.instruments (instrument_id, instrument_name, active, updated_on) VALUES ('LEGACYCORP', 'Legacy Corp', false, '2025-11-14 15:30:00');


SELECT pg_catalog.setval('public.clients_client_id_seq', 6, true);


\unrestrict 6FcH9VdoWZzsRWAdvYLkyxWGp0sFiQIIpCeydIyY2WdAqL93UM6kbv1rfCdkzjJ

