BEGIN;

-- =============================================================================
-- Bank accounts exist before anyone owns them.
--
-- A bank_account row can now be loaded on its own, with no client: client_id
-- NULL means "unclaimed". Onboarding claims one - the Trade REST API creates the
-- client and sets this row's client_id in the same transaction - instead of
-- inserting a new bank account. Rows nobody claims simply stay unclaimed.
--
-- The rest of the link is unchanged: fk_bank_account_client still checks a set
-- client_id at insert or update, and uq_bank_account_client_id still gives a
-- client at most one bank account (NULLs do not collide under it).
-- =============================================================================

ALTER TABLE bank_account ALTER COLUMN client_id DROP NOT NULL;

COMMIT;
