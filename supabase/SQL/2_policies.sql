-- =========================================================================
-- 4. RLS — defence in depth (Edge Functions use service_role to bypass).
-- =========================================================================
alter table public.users           enable row level security;
alter table public.sessions        enable row level security;
alter table public.projects        enable row level security;
alter table public.build_jobs      enable row level security;
alter table public.build_events    enable row level security;
alter table public.capability_maps enable row level security;
alter table public.build_logs      enable row level security;
alter table public.artifacts       enable row level security;
alter table public.build_reports   enable row level security;

do $$
declare
    table_name text;
begin
    for table_name in select unnest(array[
        'users','sessions','projects','build_jobs','build_events',
        'capability_maps','build_logs','artifacts','build_reports'
    ]) loop
        execute format('drop policy if exists %I_no_anon on public.%I',
                       table_name, table_name);
        execute format(
            'create policy %I_no_anon on public.%I for all to anon using (false) with check (false)',
            table_name, table_name
        );
    end loop;
end $$;
