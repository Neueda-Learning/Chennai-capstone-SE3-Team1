BEGIN;

-- =============================================================================
-- The polled universe grows from 7 instruments to 50.
--
-- The executor's poller fetches every active instrument (SymbolMapper.findPolledSymbols), so
-- widening the market is a data change: add the instruments, and quotes for them start flowing
-- on the next cycle. 50 symbols is two Fauxnance batches (25 each) per cycle, so at the 60s interval
-- the poller spends its daily request budget in about 12.5 hours and then pauses until 00:00 UTC.
--
-- TATAMOTORS never returned a quote from Fauxnance (every tick arrived with a null price), so it
-- is retired from the active set rather than polled for nothing. It is deactivated, not deleted:
-- fn_instruments_no_delete forbids deletion, and existing orders and positions still reference it.
--
-- Idempotent (ON CONFLICT DO NOTHING). The seed loader skips a table that already has rows, so
-- this migration inserts the original six as well: on a fresh database it runs before the seed
-- and must leave the full set behind.
-- =============================================================================

INSERT INTO instruments (instrument_id, instrument_name, active, updated_on) VALUES
    ('RELIANCE', 'Reliance Industries', TRUE, NULL),
    ('TCS', 'Tata Consultancy Services', TRUE, NULL),
    ('INFY', 'Infosys', TRUE, NULL),
    ('HDFCBANK', 'HDFC Bank', TRUE, NULL),
    ('ICICIBANK', 'ICICI Bank', TRUE, NULL),
    ('ITC', 'ITC', TRUE, NULL),
    ('HINDUNILVR', 'Hindustan Unilever', TRUE, NULL),
    ('SBIN', 'State Bank of India', TRUE, NULL),
    ('BHARTIARTL', 'Bharti Airtel', TRUE, NULL),
    ('BAJFINANCE', 'Bajaj Finance', TRUE, NULL),
    ('KOTAKBANK', 'Kotak Mahindra Bank', TRUE, NULL),
    ('LT', 'Larsen & Toubro', TRUE, NULL),
    ('HCLTECH', 'HCL Technologies', TRUE, NULL),
    ('ASIANPAINT', 'Asian Paints', TRUE, NULL),
    ('AXISBANK', 'Axis Bank', TRUE, NULL),
    ('MARUTI', 'Maruti Suzuki India', TRUE, NULL),
    ('SUNPHARMA', 'Sun Pharmaceutical Industries', TRUE, NULL),
    ('TITAN', 'Titan Company', TRUE, NULL),
    ('ULTRACEMCO', 'UltraTech Cement', TRUE, NULL),
    ('WIPRO', 'Wipro', TRUE, NULL),
    ('NESTLEIND', 'Nestle India', TRUE, NULL),
    ('ONGC', 'Oil and Natural Gas Corporation', TRUE, NULL),
    ('NTPC', 'NTPC', TRUE, NULL),
    ('POWERGRID', 'Power Grid Corporation of India', TRUE, NULL),
    ('TATASTEEL', 'Tata Steel', TRUE, NULL),
    ('JSWSTEEL', 'JSW Steel', TRUE, NULL),
    ('ADANIENT', 'Adani Enterprises', TRUE, NULL),
    ('ADANIPORTS', 'Adani Ports and SEZ', TRUE, NULL),
    ('GRASIM', 'Grasim Industries', TRUE, NULL),
    ('HINDALCO', 'Hindalco Industries', TRUE, NULL),
    ('INDUSINDBK', 'IndusInd Bank', TRUE, NULL),
    ('TECHM', 'Tech Mahindra', TRUE, NULL),
    ('CIPLA', 'Cipla', TRUE, NULL),
    ('DRREDDY', 'Dr. Reddy''s Laboratories', TRUE, NULL),
    ('BAJAJFINSV', 'Bajaj Finserv', TRUE, NULL),
    ('HEROMOTOCO', 'Hero MotoCorp', TRUE, NULL),
    ('EICHERMOT', 'Eicher Motors', TRUE, NULL),
    ('BRITANNIA', 'Britannia Industries', TRUE, NULL),
    ('COALINDIA', 'Coal India', TRUE, NULL),
    ('BPCL', 'Bharat Petroleum Corporation', TRUE, NULL),
    ('APOLLOHOSP', 'Apollo Hospitals Enterprise', TRUE, NULL),
    ('TATACONSUM', 'Tata Consumer Products', TRUE, NULL),
    ('SBILIFE', 'SBI Life Insurance Company', TRUE, NULL),
    ('HDFCLIFE', 'HDFC Life Insurance Company', TRUE, NULL),
    ('SHREECEM', 'Shree Cement', TRUE, NULL),
    ('DIVISLAB', 'Divi''s Laboratories', TRUE, NULL),
    ('LTIM', 'LTIMindtree', TRUE, NULL),
    ('BANKBARODA', 'Bank of Baroda', TRUE, NULL),
    ('PNB', 'Punjab National Bank', TRUE, NULL),
    ('CANBK', 'Canara Bank', TRUE, NULL)
ON CONFLICT (instrument_id) DO NOTHING;

-- Fresh database: the legacy row the seed would have carried (already inactive).
INSERT INTO instruments (instrument_id, instrument_name, active, updated_on) VALUES
    ('TATAMOTORS', 'Tata Motors', TRUE, NULL),
    ('LEGACYCORP', 'Legacy Corp', FALSE, '2025-11-14 15:30:00')
ON CONFLICT (instrument_id) DO NOTHING;

UPDATE instruments
   SET active = FALSE, updated_on = now()
 WHERE instrument_id = 'TATAMOTORS' AND active = TRUE;

COMMIT;
