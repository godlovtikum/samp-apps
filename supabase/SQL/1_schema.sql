-- =========================================================================
-- 2. EXTENSIONS
-- =========================================================================
create extension if not exists "pgcrypto";

-- =========================================================================
-- 3. SCHEMA — tables and indexes.
-- =========================================================================

-- USERS — custom auth (NOT supabase auth.users).
create table public.users (
    id              uuid primary key default gen_random_uuid(),
    email           text not null unique,
    full_name       text not null,
    password_hash   text not null,
    created_at      timestamptz not null default now()
);
create index users_email_idx on public.users(lower(email));

-- SESSIONS — server-side opaque tokens.
create table public.sessions (
    token       text primary key,
    user_id     uuid not null references public.users(id) on delete cascade,
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null,
    user_agent  text,
    ip          text
);
create index sessions_user_idx on public.sessions(user_id);
create index sessions_exp_idx  on public.sessions(expires_at);

-- PROJECTS — owned by a user; one row per (user, source URL).
-- `project_type` records the workflow the user picked the LAST time
-- this project was queued so the UI can pre-select it next time.
create table public.projects (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references public.users(id) on delete cascade,
    name         text not null,
    source_type  text not null check (source_type in ('git','zip')),
    source_url   text not null,
    default_ref  text default 'main',
    project_type text not null default 'bare_rn'
                 check (project_type in ('bare_rn','expo_managed','expo_prebuild')),
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (user_id, source_url)
);
create index projects_user_idx on public.projects(user_id);

-- BUILD_JOBS — one row per APK build attempt.
create table public.build_jobs (
    id                   uuid primary key default gen_random_uuid(),
    user_id              uuid not null references public.users(id)    on delete cascade,
    project_id           uuid not null references public.projects(id) on delete cascade,
    status               text not null default 'queued'
                         check (status in ('queued','running','succeeded','failed','cancelled')),
    ref                  text not null default 'main',
    project_type         text not null default 'bare_rn'
                         check (project_type in ('bare_rn','expo_managed','expo_prebuild')),
    dedup_hash           text not null,
    run_url              text,
    apk_url              text,
    apk_storage_path     text,
    error_message        text,
    profile_b64          text,
    current_stage        text,
    error_kind           text
                         check (error_kind is null or error_kind in ('project','system')),
    error_details        jsonb,
    project_spec         jsonb,
    -- Strict-mode columns:
    report_url           text,
    report_storage_path  text,
    retention_until      timestamptz,
    threat_summary       jsonb,
    created_at           timestamptz not null default now(),
    started_at           timestamptz,
    finished_at          timestamptz
);
create unique index build_jobs_dedup_active
    on public.build_jobs(dedup_hash)
    where status in ('queued','running');
create index build_jobs_user_idx      on public.build_jobs(user_id, created_at desc);
create index build_jobs_project_idx   on public.build_jobs(project_id);
create index build_jobs_retention_idx on public.build_jobs(retention_until)
    where retention_until is not null;

-- BUILD_EVENTS — append-only timeline per job.
create table public.build_events (
    id          bigserial primary key,
    job_id      uuid not null references public.build_jobs(id) on delete cascade,
    stage       text not null,
    status      text not null check (status in ('started','succeeded','failed','warned','info','progress')),
    message     text,
    details     jsonb,
    created_at  timestamptz not null default now()
);
create index build_events_job_idx on public.build_events(job_id, created_at);

-- CAPABILITY_MAPS / BUILD_LOGS / ARTIFACTS — archival, scoped to job.
create table public.capability_maps (
    id                uuid primary key default gen_random_uuid(),
    job_id            uuid not null references public.build_jobs(id) on delete cascade,
    permissions       jsonb not null default '[]'::jsonb,
    enabled_modules   jsonb not null default '[]'::jsonb,
    disabled_modules  jsonb not null default '[]'::jsonb,
    raw_report        jsonb,
    warnings          jsonb default '[]'::jsonb,
    created_at        timestamptz not null default now()
);
create index capability_maps_job_idx on public.capability_maps(job_id);

create table public.build_logs (
    id          bigserial primary key,
    job_id      uuid not null references public.build_jobs(id) on delete cascade,
    level       text not null default 'info' check (level in ('debug','info','warn','error')),
    message     text not null,
    created_at  timestamptz not null default now()
);
create index build_logs_job_idx on public.build_logs(job_id, created_at);

create table public.artifacts (
    id            uuid primary key default gen_random_uuid(),
    job_id        uuid not null references public.build_jobs(id) on delete cascade,
    kind          text not null default 'apk',
    size_bytes    bigint,
    sha256        text,
    download_url  text not null,
    storage_path  text,
    created_at    timestamptz not null default now()
);

-- BUILD_REPORTS — one canonical transparency report per build.
create table public.build_reports (
    id                  uuid primary key default gen_random_uuid(),
    job_id              uuid not null references public.build_jobs(id) on delete cascade,
    user_id             uuid not null references public.users(id)      on delete cascade,
    verdict             text not null
                        check (verdict in ('accepted','rejected','system_error','succeeded','failed')),
    project_spec        jsonb,
    threat_report       jsonb,
    gate_decision       jsonb,
    stage_timings       jsonb,
    storage_bucket      text not null default 'build-reports',
    storage_object_key  text,
    public_download_url text,
    retention_until     timestamptz not null default (now() + interval '30 days'),
    created_at          timestamptz not null default now()
);
create unique index build_reports_job_idx       on public.build_reports(job_id);
create index        build_reports_user_idx      on public.build_reports(user_id, created_at desc);
create index        build_reports_retention_idx on public.build_reports(retention_until);
