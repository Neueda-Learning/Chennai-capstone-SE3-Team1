BEGIN;

-- =============================================================================
-- Moves the credential store (users, refresh_tokens) out of public into its own
-- schema, auth_db, structurally separating it from the Sprint 3 trading tables.
--
-- Nothing that reads or writes these tables unqualified needs to change: every
-- caller (the NestJS auth service, sprint-06-api's UserMapper, verify_db.py's
-- behavioral checks, apply_db.py's seed \copy/TRUNCATE) relies on the connection's
-- default search_path, which this migration extends to include auth_db.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS auth_db;

ALTER TABLE users SET SCHEMA auth_db;
ALTER TABLE refresh_tokens SET SCHEMA auth_db;

-- Uses the actual connected database name (trading_platform, trading_platform_test, or
-- any --dbname override) rather than hardcoding one, so this works the same whichever
-- database apply_db.py runs it against.
DO $$
BEGIN
    EXECUTE format('ALTER DATABASE %I SET search_path = public, auth_db', current_database());
END $$;

-- fn_resync_sequences() (008_maintenance.sql) walks information_schema hardcoded to
-- table_schema = 'public' to find serial/identity columns to resync. Neither moved table
-- has one today (both use gen_random_uuid()), so this is currently a no-op fix, but it
-- keeps the function meaning "every app table" after the split, not just public's.
CREATE OR REPLACE FUNCTION fn_resync_sequences()
RETURNS TABLE (sequence_name TEXT, set_to BIGINT) AS $$
DECLARE
    r   RECORD;
    seq TEXT;
    mx  BIGINT;
BEGIN
    FOR r IN
        SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        JOIN information_schema.tables  t
          ON t.table_schema = c.table_schema
         AND t.table_name   = c.table_name
        WHERE c.table_schema IN ('public', 'auth_db')
          AND t.table_type   = 'BASE TABLE'
          AND (c.column_default LIKE 'nextval(%' OR c.is_identity = 'YES')
        ORDER BY c.table_name, c.column_name
    LOOP
        seq := pg_get_serial_sequence(quote_ident(r.table_name), r.column_name);
        CONTINUE WHEN seq IS NULL;

        EXECUTE format('SELECT COALESCE(MAX(%I), 0) FROM %I', r.column_name, r.table_name)
           INTO mx;

        PERFORM setval(seq, GREATEST(mx, 1), mx > 0);

        sequence_name := seq;
        set_to        := GREATEST(mx, 1);
        RETURN NEXT;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMIT;
