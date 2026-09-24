BEGIN;

-- =============================================================================
-- bank_account.name duplicated clients.name once an account was claimed, and
-- meant nothing before that: an unclaimed account is not tied to any person's
-- name yet. client_id is the only identity a bank account needs to carry -
-- joining to clients gets the name when one is linked.
--
-- The claim flow (BankAccountLinkService.link()) no longer reads this column
-- to name the new client; it now names it from the claiming user's username
-- (users.username, migration-adjacent change in UserMapper).
-- =============================================================================

ALTER TABLE bank_account
    DROP COLUMN name;

COMMIT;
