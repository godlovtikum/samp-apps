-- =========================================================================
-- 1. DESTRUCTIVE RESET — drop SAMP-owned objects in `public`.
-- =========================================================================
drop function if exists public.retention_sweep()                                  cascade;
drop function if exists public.reports_get_one(uuid, uuid)                        cascade;
drop function if exists public.reports_create(uuid, uuid, text, jsonb, jsonb,
                                              jsonb, jsonb, text, text, int)     cascade;
drop function if exists public.jobs_get_events(uuid, uuid)                        cascade;
drop function if exists public.jobs_log_event(uuid, text, text, text, jsonb)      cascade;
drop function if exists public.projects_get_by_user(uuid)                         cascade;
drop function if exists public.jobs_get_one(uuid, uuid)                           cascade;
drop function if exists public.jobs_get_by_user(uuid, uuid, int)                  cascade;
drop function if exists public.jobs_create(uuid, uuid, text, text, text)          cascade;
drop function if exists public.projects_upsert(uuid, text, text, text, text)      cascade;
drop function if exists public.auth_logout(text)                                  cascade;
drop function if exists public.auth_validate_session(text)                        cascade;
drop function if exists public.auth_create_session(uuid, text, text, int)         cascade;
drop function if exists public.auth_verify_password(text, text)                   cascade;
drop function if exists public.auth_signup(text, text, text)                      cascade;
drop function if exists public.auth_get_user_by_email(text)                       cascade;
drop function if exists public.touch_updated_at()                                 cascade;

drop table if exists public.build_reports   cascade;
drop table if exists public.artifacts       cascade;
drop table if exists public.build_logs      cascade;
drop table if exists public.capability_maps cascade;
drop table if exists public.build_events    cascade;
drop table if exists public.build_jobs      cascade;
drop table if exists public.projects        cascade;
drop table if exists public.sessions        cascade;
drop table if exists public.users           cascade;

-- pg_cron schedule, if any prior install left one behind.
do $$
begin
    if exists (select 1 from pg_namespace where nspname = 'cron') then
        perform cron.unschedule(jobid)
           from cron.job
          where jobname = 'samp_apps_retention_sweep';
    end if;
end $$;