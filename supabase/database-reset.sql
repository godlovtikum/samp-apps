-- SAMP APPS — Single-file database reset.
--
-- Run this ONE file in the Supabase SQL editor to (re)create the
-- entire database from scratch. It performs:
--
--   1. DESTRUCTIVE drop of every SAMP-owned object in `public`.
--   2. Re-creates the base schema.
--   3. Enables RLS + adds the deny-anon policies.
--   4. Re-creates every RPC the Edge Functions call.
--   5. Adds the strict-mode transparency tables, RPCs, and storage
--      bucket bootstrap.
--   6. Installs the 30-day retention sweeper (pg_cron when available).
--
-- WARNING: section 1 ERASES every existing user, session, project,
-- build, event, log, and report. This is the ONLY supported way to
-- (re)provision the database. There are intentionally NO companion
-- "incremental" files — keeping a single source of truth prevents
-- drift between what the schema actually looks like and what the
-- documentation claims.
--
-- Re-running this file is safe (idempotent within itself), but it will
-- always wipe data first.

/**
    see:
        samp-apps/supabase/SQL/0_reset.sql for database reset 
        samp-apps/supabase/SQL/1_schema.sql for tables setup 
        samp-apps/supabase/SQL/2_policies.sql for security policies 
        samp-apps/supabase/SQL/3_rpc.sql for triggers & RPCs 

*/

-- =========================================================================
-- DONE.
-- After running these files:
--   1. Deploy the Edge Functions in supabase/functions/{auth,jobs}/
--   2. Set the Edge Function env vars (GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN).
--   3. Create the storage bucket "build-reports" in the dashboard => storage.
-- =========================================================================
