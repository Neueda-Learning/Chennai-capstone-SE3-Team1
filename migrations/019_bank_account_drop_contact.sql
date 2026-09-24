BEGIN;

-- =============================================================================
-- bank_account is only ever an unclaimed-or-claimed funding account, never a
-- contact record: it should not carry personal contact details in either state.
--
-- phone was copied into the new clients row at claim time
-- (BankAccountLinkService.link()); that no longer happens, so a claimed
-- client's phone starts NULL (clients.phone is nullable) until the client sets
-- it themselves. email was never used this way — the client's email has always
-- come from the registered user, not the bank account.
-- =============================================================================

ALTER TABLE bank_account
    DROP COLUMN phone,
    DROP COLUMN email;

COMMIT;
