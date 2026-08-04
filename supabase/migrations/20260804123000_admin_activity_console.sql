create table if not exists public.workspace_admin_activity (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    category text not null check (category in ('onboarding', 'leadgen', 'billing', 'communications', 'gantt', 'integrations', 'maintenance', 'system')),
    level text not null default 'info' check (level in ('info', 'warning', 'error')),
    event_key text not null,
    summary text not null,
    entity_type text,
    entity_id text,
    source_href text,
    actor_user_id uuid references auth.users(id) on delete set null,
    metadata jsonb not null default '{}'::jsonb,
    occurred_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);

create index if not exists workspace_admin_activity_feed_idx
on public.workspace_admin_activity(workspace_id, occurred_at desc, id desc);

create index if not exists workspace_admin_activity_category_idx
on public.workspace_admin_activity(workspace_id, category, level, occurred_at desc);

alter table public.workspace_admin_activity enable row level security;

drop policy if exists "workspace admins read activity console" on public.workspace_admin_activity;
create policy "workspace admins read activity console" on public.workspace_admin_activity
for select using (public.is_workspace_member(workspace_id, array['owner','admin']));
