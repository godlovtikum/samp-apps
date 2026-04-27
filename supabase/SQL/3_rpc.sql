-- =========================================================================
-- 5. TRIGGERS
-- =========================================================================
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end $$;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch
before update on public.projects
for each row execute function public.touch_updated_at();



-- =========================================================================
-- 6. RPCs — auth
-- =========================================================================

create or replace function public.auth_get_user_by_email(p_email text)
returns table (id uuid, email text, full_name text, password_hash text)
language sql stable as $$
    select u.id, u.email, u.full_name, u.password_hash
      from public.users u
     where lower(u.email) = lower(p_email)
     limit 1
$$;

create or replace function public.auth_signup(
    p_email text, p_password text, p_full_name text
) returns table (id uuid, email text, full_name text)
language plpgsql as $$
declare
    v_id uuid;
begin
    if exists (select 1 from public.users u where lower(u.email) = lower(p_email)) then
        raise exception 'auth.user_exists' using errcode = 'P0001';
    end if;
    insert into public.users(email, full_name, password_hash)
        values (lower(p_email), p_full_name, crypt(p_password, gen_salt('bf', 10)))
        returning users.id into v_id;
    return query
        select u.id, u.email, u.full_name from public.users u where u.id = v_id;
end $$;

create or replace function public.auth_verify_password(
    p_email text, p_password text
) returns table (id uuid, email text, full_name text)
language sql stable as $$
    select u.id, u.email, u.full_name
      from public.users u
     where lower(u.email) = lower(p_email)
       and u.password_hash = crypt(p_password, u.password_hash)
     limit 1
$$;

create or replace function public.auth_create_session(
    p_user_id uuid, p_user_agent text, p_ip text, p_ttl_seconds int
) returns table (token text, expires_at timestamptz)
language plpgsql as $$
declare
    v_token text;
    v_exp   timestamptz := now() + make_interval(secs => p_ttl_seconds);
begin
    v_token := encode(gen_random_bytes(32), 'hex');
    insert into public.sessions(token, user_id, expires_at, user_agent, ip)
        values (v_token, p_user_id, v_exp, p_user_agent, p_ip);
    return query select v_token, v_exp;
end $$;

create or replace function public.auth_validate_session(p_token text)
returns table (user_id uuid, email text, full_name text, expires_at timestamptz)
language sql stable as $$
    select s.user_id, u.email, u.full_name, s.expires_at
      from public.sessions s
      join public.users u on u.id = s.user_id
     where s.token = p_token
       and s.expires_at > now()
     limit 1
$$;

create or replace function public.auth_logout(p_token text)
returns boolean language plpgsql as $$
begin
    delete from public.sessions s where s.token = p_token;
    return true;
end $$;

-- =========================================================================
-- 7. RPCs — projects / jobs
-- =========================================================================

create or replace function public.projects_upsert(
    p_user_id      uuid,
    p_name         text,
    p_source_url   text,
    p_default_ref  text,
    p_project_type text
) returns table (id uuid, name text, source_url text, default_ref text, project_type text)
language plpgsql as $$
declare
    v_id   uuid;
    v_type text := coalesce(p_project_type, 'bare_rn');
begin
    if v_type not in ('bare_rn','expo_managed','expo_prebuild') then
        raise exception 'build.invalid_project_type' using errcode = 'P0001';
    end if;
    insert into public.projects(user_id, name, source_type, source_url, default_ref, project_type)
        values (p_user_id, p_name, 'git', p_source_url, coalesce(p_default_ref,'main'), v_type)
        on conflict (user_id, source_url)
        do update set
            name         = excluded.name,
            default_ref  = excluded.default_ref,
            project_type = excluded.project_type
        returning projects.id into v_id;
    return query
        select p.id, p.name, p.source_url, p.default_ref, p.project_type
          from public.projects p where p.id = v_id;
end $$;

create or replace function public.jobs_create(
    p_user_id      uuid,
    p_project_id   uuid,
    p_ref          text,
    p_dedup_hash   text,
    p_project_type text
) returns table (id uuid, status text, dedup_hash text, was_existing boolean)
language plpgsql as $$
declare
    v_existing uuid;
    v_status   text;
    v_id       uuid;
    v_type     text := coalesce(p_project_type, 'bare_rn');
begin
    if v_type not in ('bare_rn','expo_managed','expo_prebuild') then
        raise exception 'build.invalid_project_type' using errcode = 'P0001';
    end if;

    select bj.id, bj.status into v_existing, v_status
      from public.build_jobs bj
     where bj.dedup_hash = p_dedup_hash
       and bj.status in ('queued','running')
     limit 1;

    if v_existing is not null then
        return query select v_existing, v_status, p_dedup_hash, true;
        return;
    end if;

    insert into public.build_jobs(
        user_id, project_id, ref, dedup_hash, status, project_type
    ) values (
        p_user_id, p_project_id, p_ref, p_dedup_hash, 'queued', v_type
    ) returning build_jobs.id into v_id;

    return query select v_id, 'queued'::text, p_dedup_hash, false;
end $$;

create or replace function public.jobs_get_by_user(
    p_user_id uuid, p_project_id uuid default null, p_limit int default 50
)
returns table (
    id uuid, project_id uuid, project_name text, status text, ref text,
    apk_url text, run_url text, error_message text, created_at timestamptz,
    current_stage text, error_kind text, project_type text
)
language sql stable as $$
    select bj.id, bj.project_id, p.name, bj.status, bj.ref,
           bj.apk_url, bj.run_url, bj.error_message, bj.created_at,
           bj.current_stage, bj.error_kind, bj.project_type
      from public.build_jobs bj
      join public.projects p on p.id = bj.project_id
     where bj.user_id = p_user_id
       and (p_project_id is null or bj.project_id = p_project_id)
     order by bj.created_at desc
     limit coalesce(p_limit, 50)
$$;

create or replace function public.jobs_get_one(p_user_id uuid, p_job_id uuid)
returns table (
    id uuid, project_id uuid, project_name text, status text, ref text,
    apk_url text, run_url text, error_message text, profile_b64 text,
    created_at timestamptz, started_at timestamptz, finished_at timestamptz,
    current_stage text, error_kind text, error_details jsonb, project_spec jsonb,
    project_type text
)
language sql stable as $$
    select bj.id, bj.project_id, p.name, bj.status, bj.ref,
           bj.apk_url, bj.run_url, bj.error_message, bj.profile_b64,
           bj.created_at, bj.started_at, bj.finished_at,
           bj.current_stage, bj.error_kind, bj.error_details, bj.project_spec,
           bj.project_type
      from public.build_jobs bj
      join public.projects p on p.id = bj.project_id
     where bj.user_id = p_user_id and bj.id = p_job_id
     limit 1
$$;

create or replace function public.projects_get_by_user(p_user_id uuid)
returns table (
    id uuid, name text, source_url text, default_ref text, project_type text,
    created_at timestamptz, build_count bigint, last_build_at timestamptz, last_status text
)
language sql stable as $$
    select p.id, p.name, p.source_url, p.default_ref, p.project_type, p.created_at,
           coalesce(c.cnt, 0) as build_count,
           c.last_at as last_build_at,
           c.last_status
      from public.projects p
      left join lateral (
          select count(*) as cnt,
                 max(bj.created_at) as last_at,
                 (select bj2.status from public.build_jobs bj2
                    where bj2.project_id = p.id
                    order by bj2.created_at desc limit 1) as last_status
            from public.build_jobs bj
           where bj.project_id = p.id
      ) c on true
     where p.user_id = p_user_id
     order by p.created_at desc
$$;

-- =========================================================================
-- 8. RPCs — build events (timeline)
-- =========================================================================

create or replace function public.jobs_log_event(
    p_job_id uuid, p_stage text, p_status text,
    p_message text default null, p_details jsonb default null
) returns bigint
language plpgsql as $$
declare
    v_id bigint;
begin
    insert into public.build_events(job_id, stage, status, message, details)
        values (p_job_id, p_stage, p_status, p_message, p_details)
        returning id into v_id;

    if p_status = 'started' then
        update public.build_jobs set current_stage = p_stage where id = p_job_id;
    end if;
    return v_id;
end $$;

create or replace function public.jobs_get_events(p_user_id uuid, p_job_id uuid)
returns table (
    id bigint, stage text, status text, message text, details jsonb, created_at timestamptz
)
language sql stable as $$
    select e.id, e.stage, e.status, e.message, e.details, e.created_at
      from public.build_events e
      join public.build_jobs bj on bj.id = e.job_id
     where bj.user_id = p_user_id and e.job_id = p_job_id
     order by e.created_at asc, e.id asc
$$;

-- =========================================================================
-- 9. RPCs — transparency reports
-- =========================================================================

create or replace function public.reports_create(
    p_job_id              uuid,
    p_user_id             uuid,
    p_verdict             text,
    p_project_spec        jsonb,
    p_threat_report       jsonb,
    p_gate_decision       jsonb,
    p_stage_timings       jsonb,
    p_storage_object_key  text,
    p_public_download_url text,
    p_retention_days      int default 30
) returns uuid
language plpgsql as $$
declare
    v_id uuid;
    v_retention timestamptz := now() + make_interval(days => greatest(coalesce(p_retention_days, 30), 1));
begin
    insert into public.build_reports(
        job_id, user_id, verdict,
        project_spec, threat_report, gate_decision, stage_timings,
        storage_object_key, public_download_url, retention_until
    ) values (
        p_job_id, p_user_id, p_verdict,
        p_project_spec, p_threat_report, p_gate_decision, p_stage_timings,
        p_storage_object_key, p_public_download_url, v_retention
    )
    on conflict (job_id) do update set
        verdict             = excluded.verdict,
        project_spec        = excluded.project_spec,
        threat_report       = excluded.threat_report,
        gate_decision       = excluded.gate_decision,
        stage_timings       = excluded.stage_timings,
        storage_object_key  = excluded.storage_object_key,
        public_download_url = excluded.public_download_url,
        retention_until     = excluded.retention_until
    returning build_reports.id into v_id;

    update public.build_jobs
       set report_url           = p_public_download_url,
           report_storage_path  = p_storage_object_key,
           retention_until      = v_retention,
           threat_summary       = jsonb_build_object(
               'critical_count', coalesce((p_threat_report->>'critical_count')::int, 0),
               'warn_count',     coalesce((p_threat_report->>'warn_count')::int, 0),
               'scanned_files',  coalesce((p_threat_report->>'scanned_files')::int, 0)
           )
     where id = p_job_id;

    return v_id;
end $$;

create or replace function public.reports_get_one(
    p_user_id uuid, p_job_id uuid
) returns table (
    id uuid, job_id uuid, verdict text,
    project_spec jsonb, threat_report jsonb, gate_decision jsonb,
    stage_timings jsonb, storage_object_key text,
    public_download_url text, retention_until timestamptz, created_at timestamptz
)
language sql stable as $$
    select r.id, r.job_id, r.verdict,
           r.project_spec, r.threat_report, r.gate_decision,
           r.stage_timings, r.storage_object_key,
           r.public_download_url, r.retention_until, r.created_at
      from public.build_reports r
     where r.user_id = p_user_id
       and r.job_id  = p_job_id
     limit 1
$$;

-- =========================================================================
-- 10. STORAGE BUCKET BOOTSTRAP
-- =========================================================================
-- The pipeline writes objects at:
--     build-reports/{JOB_ID}/report.json
--     build-reports/{JOB_ID}/logs/{stage}.log
do $$
begin
    if exists (select 1 from pg_namespace where nspname = 'storage')
       and exists (select 1 from pg_class
                    where relname = 'buckets'
                      and relnamespace = (select oid from pg_namespace where nspname = 'storage'))
    then
        insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
             values ('build-reports', 'build-reports', true, 26214400,
                     array['application/json','text/plain']::text[])
        on conflict (id) do update set
            public             = true,
            file_size_limit    = 26214400,
            allowed_mime_types = array['application/json','text/plain']::text[];
    end if;
end $$;

-- =========================================================================
-- 11. RETENTION SWEEPER (30 days)
-- =========================================================================
create extension if not exists pg_cron;

create or replace function public.retention_sweep()
returns table (
    reports_deleted        bigint,
    storage_objects_deleted bigint,
    jobs_scrubbed          bigint
)
language plpgsql security definer as $$
declare
    v_reports_deleted bigint := 0;
    v_storage_deleted bigint := 0;
    v_jobs_scrubbed   bigint := 0;
    v_now             timestamptz := now();
begin
    -- 1. Delete expired build_reports rows.
    with deleted as (
        delete from public.build_reports
              where retention_until < v_now
        returning storage_object_key, job_id
    )
    select count(*) into v_reports_deleted from deleted;

    -- 2. Delete orphaned storage objects (whose owning report is gone).
    if exists (select 1 from pg_namespace where nspname = 'storage')
       and exists (select 1 from pg_class
                    where relname = 'objects'
                      and relnamespace = (select oid from pg_namespace where nspname = 'storage'))
    then
        with object_deleted as (
            delete from storage.objects
                  where bucket_id = 'build-reports'
                    and not exists (
                        select 1 from public.build_reports r
                         where r.storage_object_key is not null
                           and storage.objects.name like r.job_id::text || '/%'
                    )
            returning name
        )
        select count(*) into v_storage_deleted from object_deleted;
    end if;

    -- 3. Scrub expired build_jobs sensitive fields without deleting history.
    with scrubbed as (
        update public.build_jobs
           set error_details        = null,
               project_spec         = null,
               profile_b64          = null,
               report_url           = null,
               report_storage_path  = null
         where retention_until is not null
           and retention_until < v_now
         returning id
    )
    select count(*) into v_jobs_scrubbed from scrubbed;

    return query select v_reports_deleted, v_storage_deleted, v_jobs_scrubbed;
end $$;

-- Schedule the sweep daily at 03:15 UTC (idempotent).
do $$
begin
    if exists (select 1 from pg_namespace where nspname = 'cron') then
        perform cron.schedule(
            'samp_apps_retention_sweep',
            '15 3 * * *',
            $cron$ select public.retention_sweep(); $cron$
        );
    end if;
end $$;
