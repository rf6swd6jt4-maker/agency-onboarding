-- Keep cold workspace launches to one narrow database operation after the
-- authenticated user has been verified. The result is deliberately limited to
-- shell identity and access data; record lists and modal choices load later.
create or replace function public.workspace_shell_bootstrap(
    p_workspace_slug text,
    p_user_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with shell_context as (
        select
            workspace.id as workspace_id,
            workspace.name as workspace_name,
            workspace.slug as workspace_slug,
            workspace.logo_path,
            membership.role,
            profile.username,
            profile.avatar_path
        from public.workspaces workspace
        join public.workspace_memberships membership
          on membership.workspace_id = workspace.id
         and membership.user_id = p_user_id
        left join public.user_profiles profile on profile.user_id = p_user_id
        where workspace.slug = p_workspace_slug
          and workspace.status = 'active'
        limit 1
    )
    select jsonb_build_object(
        'workspace_id', context.workspace_id,
        'workspace_name', context.workspace_name,
        'workspace_slug', context.workspace_slug,
        'logo_path', context.logo_path,
        'role', context.role,
        'username', coalesce(context.username, 'account'),
        'avatar_path', context.avatar_path,
        'allowed_service_ids', case
            when context.role in ('owner', 'admin') then '[]'::jsonb
            else coalesce((
                select jsonb_agg(access.service_id order by access.service_id)
                from public.workspace_member_service_access access
                where access.workspace_id = context.workspace_id
                  and access.user_id = p_user_id
            ), '[]'::jsonb)
        end,
        'capabilities', case
            when context.role in ('owner', 'admin') then to_jsonb(case when exists (
                select 1
                from public.onboarding_services service
                join public.onboarding_service_revisions revision
                  on revision.workspace_id = service.workspace_id
                 and revision.service_id = service.id
                where service.workspace_id = context.workspace_id
                  and service.state <> 'archived'
                  and coalesce(revision.definition->>'templateId', revision.definition->>'template_id') = 'appointment-setting'
            ) then array[
                'relationships.view', 'onboarding.manage', 'fulfilment.manage',
                'appointment_setting.manage', 'communications.manage', 'library.manage',
                'onboarding_builder.manage', 'leadgen.manage', 'admin.manage', 'settings.manage'
            ]::text[] else array[
                'relationships.view', 'onboarding.manage', 'fulfilment.manage',
                'communications.manage', 'library.manage', 'onboarding_builder.manage',
                'leadgen.manage', 'admin.manage', 'settings.manage'
            ]::text[] end)
            else coalesce((
                select jsonb_agg(grant_row.capability order by grant_row.capability)
                from (
                    select distinct capability.capability
                    from public.workspace_member_service_access access
                    join public.workspace_service_capabilities capability
                      on capability.workspace_id = access.workspace_id
                     and capability.service_id = access.service_id
                    where access.workspace_id = context.workspace_id
                      and access.user_id = p_user_id
                      and (
                          capability.capability <> 'appointment_setting.manage'
                          or exists (
                              select 1
                              from public.onboarding_services service
                              join public.onboarding_service_revisions revision
                                on revision.workspace_id = service.workspace_id
                               and revision.service_id = service.id
                              join public.workspace_member_service_access appointment_access
                                on appointment_access.workspace_id = service.workspace_id
                               and appointment_access.service_id = service.id
                               and appointment_access.user_id = p_user_id
                              where service.workspace_id = context.workspace_id
                                and service.state <> 'archived'
                                and coalesce(revision.definition->>'templateId', revision.definition->>'template_id') = 'appointment-setting'
                          )
                      )
                ) grant_row
            ), '[]'::jsonb)
        end,
        'service_access_schema_ready', true
    )
    from shell_context context
$$;

revoke all on function public.workspace_shell_bootstrap(text, uuid) from public, anon, authenticated;
grant execute on function public.workspace_shell_bootstrap(text, uuid) to service_role;

create table if not exists public.workspace_launch_metrics (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    launch_id uuid not null,
    route_section text not null,
    navigation_type text not null,
    display_mode text not null,
    connection_type text,
    device_class text not null,
    deployment_sha text,
    timings jsonb not null default '{}'::jsonb,
    frame_count integer not null default 0 check (frame_count between 0 and 8),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (workspace_id, launch_id)
);

create index if not exists workspace_launch_metrics_workspace_created_idx
on public.workspace_launch_metrics(workspace_id, created_at desc);

alter table public.workspace_launch_metrics enable row level security;

revoke all on table public.workspace_launch_metrics from public, anon, authenticated;
grant select, insert, update, delete on table public.workspace_launch_metrics to service_role;
