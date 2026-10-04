BEGIN;

-- =============================================================================
-- auth_db.users becomes the single stored copy of both contact fields.
--
-- email was already duplicated between auth_db.users and clients, kept in sync only by
-- application code (ClientService.updateClientProfile() pushing changes into users via
-- UserMapper). The one thing that justified clients.email existing independently -
-- ClientService.createClient() (POST /api/clients, admin-only) creating a clients row with no
-- linked user - is dead: absent from the v1 contract, no seed/script caller, and there is no
-- way to legitimately obtain an admin token in the running system. Removed alongside this
-- migration (see ClientController.java/ClientService.java).
--
-- phone was never duplicated - it only ever lived on clients, set post-creation via profile
-- update, never collected at registration. Moved here anyway so both contact fields live with
-- the person's identity (auth_db.users), leaving clients a pure trading-account record.
-- =============================================================================

ALTER TABLE auth_db.users ADD COLUMN phone VARCHAR(20);

ALTER TABLE clients
    DROP COLUMN email,
    DROP COLUMN phone;

COMMIT;
