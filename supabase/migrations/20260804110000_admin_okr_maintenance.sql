alter table public.work_items
    add column if not exists area text not null default 'workspace',
    add column if not exists kind text not null default 'standard',
    add column if not exists visibility text not null default 'workspace',
    add column if not exists maintenance_category text,
    add column if not exists severity text,
    add column if not exists failure_fingerprint text,
    add column if not exists occurrence_count integer not null default 1,
    add column if not exists first_occurred_at timestamptz,
    add column if not exists last_occurred_at timestamptz;

alter table public.work_items drop constraint if exists work_items_area_check;
alter table public.work_items add constraint work_items_area_check
check (area in ('workspace', 'admin'));

alter table public.work_items drop constraint if exists work_items_kind_check;
alter table public.work_items add constraint work_items_kind_check
check (kind in ('standard', 'okr_action', 'maintenance'));

alter table public.work_items drop constraint if exists work_items_visibility_check;
alter table public.work_items add constraint work_items_visibility_check
check (visibility in ('workspace', 'admins_only'));

alter table public.work_items drop constraint if exists work_items_maintenance_category_check;
alter table public.work_items add constraint work_items_maintenance_category_check
check (maintenance_category is null or maintenance_category in ('leadgen', 'onboarding', 'billing', 'communications', 'integrations', 'system_health'));

alter table public.work_items drop constraint if exists work_items_severity_check;
alter table public.work_items add constraint work_items_severity_check
check (severity is null or severity in ('warning', 'critical'));

alter table public.work_items drop constraint if exists work_items_occurrence_count_check;
alter table public.work_items add constraint work_items_occurrence_count_check
check (occurrence_count >= 1);

alter table public.work_items drop constraint if exists work_items_lifecycle_phase_check;
alter table public.work_items alter column lifecycle_phase drop not null;
alter table public.work_items add constraint work_items_lifecycle_phase_check
check (
    (area = 'admin' and lifecycle_phase is null)
    or
    (area = 'workspace' and lifecycle_phase in ('lead', 'nurturing', 'potential_client', 'invoiced', 'onboarding', 'onboarding_review', 'fulfilment', 'retention', 'completed_lost'))
);

create unique index if not exists work_items_open_failure_fingerprint_unique
on public.work_items(workspace_id, failure_fingerprint)
where kind = 'maintenance'
  and failure_fingerprint is not null
  and status not in ('done', 'canceled');

create index if not exists work_items_admin_queue_idx
on public.work_items(workspace_id, area, kind, status, priority, last_occurred_at desc);

create or replace function public.upsert_platform_failure_work_item(
    p_workspace_id uuid,
    p_category text,
    p_source text,
    p_operation text,
    p_fingerprint text,
    p_severity text,
    p_summary text,
    p_diagnostics jsonb,
    p_occurred_at timestamptz,
    p_source_href text
)
returns table(work_item_id uuid, created boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
    return query
    insert into public.work_items (
        workspace_id, title, description, lifecycle_phase, status, priority, is_key_task,
        native_kind, native_href, area, kind, visibility, maintenance_category, severity,
        failure_fingerprint, occurrence_count, first_occurred_at, last_occurred_at, metadata
    ) values (
        p_workspace_id, p_summary, p_summary, null, 'todo',
        case when p_severity = 'critical' then 1 else 2 end, true,
        'platform_failure', p_source_href, 'admin', 'maintenance', 'admins_only', p_category,
        p_severity, p_fingerprint, 1, p_occurred_at, p_occurred_at,
        jsonb_build_object('source', p_source, 'operation', p_operation, 'latest_diagnostics', coalesce(p_diagnostics, '{}'::jsonb), 'latest_occurred_at', p_occurred_at)
    )
    on conflict (workspace_id, failure_fingerprint)
    where kind = 'maintenance' and failure_fingerprint is not null and status not in ('done', 'canceled')
    do update set
        title = excluded.title,
        description = excluded.description,
        severity = case when public.work_items.severity = 'critical' or excluded.severity = 'critical' then 'critical' else 'warning' end,
        priority = least(public.work_items.priority, excluded.priority),
        occurrence_count = public.work_items.occurrence_count + 1,
        last_occurred_at = excluded.last_occurred_at,
        native_href = coalesce(excluded.native_href, public.work_items.native_href),
        metadata = coalesce(public.work_items.metadata, '{}'::jsonb) || excluded.metadata
    returning id, (xmax = 0);
end;
$$;

revoke all on function public.upsert_platform_failure_work_item(uuid, text, text, text, text, text, text, jsonb, timestamptz, text) from public;
grant execute on function public.upsert_platform_failure_work_item(uuid, text, text, text, text, text, text, jsonb, timestamptz, text) to service_role;

create table if not exists public.workspace_okrs (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    title text not null,
    description text,
    period_start date not null,
    period_end date not null,
    owner_user_id uuid not null references auth.users(id) on delete restrict,
    status text not null default 'draft' check (status in ('draft', 'active', 'completed', 'cancelled')),
    outcome_note text,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (period_end >= period_start)
);

create table if not exists public.workspace_okr_key_results (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    okr_id uuid not null references public.workspace_okrs(id) on delete cascade,
    name text not null,
    description text,
    unit text not null default 'number' check (unit in ('number', 'percentage', 'currency', 'duration')),
    currency_code text,
    comparator text not null default 'at_least' check (comparator in ('at_least', 'at_most')),
    baseline_value numeric not null,
    target_value numeric not null,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check ((unit = 'currency' and currency_code is not null) or unit <> 'currency')
);

create table if not exists public.workspace_okr_measurements (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    key_result_id uuid not null references public.workspace_okr_key_results(id) on delete cascade,
    value numeric not null,
    measured_at timestamptz not null default now(),
    note text,
    provenance text not null default 'manual' check (provenance in ('manual')),
    recorded_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

create table if not exists public.workspace_okr_work_items (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    key_result_id uuid not null references public.workspace_okr_key_results(id) on delete cascade,
    work_item_id uuid not null references public.work_items(id) on delete cascade,
    linked_by uuid references auth.users(id) on delete set null,
    linked_at timestamptz not null default now(),
    primary key (key_result_id, work_item_id)
);

create table if not exists public.workspace_maintenance_routing (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    category text not null check (category in ('leadgen', 'onboarding', 'billing', 'communications', 'integrations', 'system_health')),
    responsible_user_id uuid not null references auth.users(id) on delete cascade,
    updated_by uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default now(),
    primary key (workspace_id, category)
);

create index if not exists workspace_okrs_workspace_status_idx
on public.workspace_okrs(workspace_id, status, period_end desc);
create index if not exists workspace_okr_key_results_okr_idx
on public.workspace_okr_key_results(okr_id, sort_order, created_at);
create index if not exists workspace_okr_measurements_key_result_idx
on public.workspace_okr_measurements(key_result_id, measured_at desc, created_at desc);
create index if not exists workspace_okr_work_items_work_item_idx
on public.workspace_okr_work_items(work_item_id);

drop trigger if exists workspace_okrs_updated_at on public.workspace_okrs;
create trigger workspace_okrs_updated_at before update on public.workspace_okrs
for each row execute function public.set_updated_at();
drop trigger if exists workspace_okr_key_results_updated_at on public.workspace_okr_key_results;
create trigger workspace_okr_key_results_updated_at before update on public.workspace_okr_key_results
for each row execute function public.set_updated_at();

create or replace function public.validate_admin_workspace_user()
returns trigger
language plpgsql
set search_path = public
as $$
declare target_user_id uuid;
begin
    target_user_id := case
        when tg_table_name = 'workspace_okrs' then new.owner_user_id
        else new.responsible_user_id
    end;
    if not exists (
        select 1 from public.workspace_memberships
        where workspace_id = new.workspace_id
          and user_id = target_user_id
          and role in ('owner', 'admin')
    ) then raise exception 'Responsible user must be a workspace owner or admin'; end if;
    return new;
end;
$$;

drop trigger if exists validate_workspace_okr_owner on public.workspace_okrs;
create trigger validate_workspace_okr_owner before insert or update of workspace_id, owner_user_id on public.workspace_okrs
for each row execute function public.validate_admin_workspace_user();
drop trigger if exists validate_workspace_maintenance_routing on public.workspace_maintenance_routing;
create trigger validate_workspace_maintenance_routing before insert or update of workspace_id, responsible_user_id on public.workspace_maintenance_routing
for each row execute function public.validate_admin_workspace_user();

create or replace function public.validate_workspace_okr_child()
returns trigger
language plpgsql
set search_path = public
as $$
declare parent_workspace_id uuid;
begin
    if tg_table_name = 'workspace_okr_key_results' then
        select workspace_id into parent_workspace_id from public.workspace_okrs where id = new.okr_id;
    else
        select workspace_id into parent_workspace_id from public.workspace_okr_key_results where id = new.key_result_id;
    end if;
    if parent_workspace_id is null or parent_workspace_id <> new.workspace_id then
        raise exception 'OKR records must belong to the same workspace';
    end if;
    return new;
end;
$$;

drop trigger if exists validate_workspace_okr_key_result on public.workspace_okr_key_results;
create trigger validate_workspace_okr_key_result before insert or update of workspace_id, okr_id on public.workspace_okr_key_results
for each row execute function public.validate_workspace_okr_child();
drop trigger if exists validate_workspace_okr_measurement on public.workspace_okr_measurements;
create trigger validate_workspace_okr_measurement before insert or update of workspace_id, key_result_id on public.workspace_okr_measurements
for each row execute function public.validate_workspace_okr_child();

create or replace function public.validate_workspace_okr_work_item()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if not exists (
        select 1 from public.workspace_okr_key_results
        where id = new.key_result_id and workspace_id = new.workspace_id
    ) then raise exception 'Key Result must belong to the same workspace'; end if;
    if not exists (
        select 1 from public.work_items
        where id = new.work_item_id
          and workspace_id = new.workspace_id
          and area = 'admin'
          and visibility = 'admins_only'
    ) then raise exception 'OKR actions must be private Admin work items'; end if;
    return new;
end;
$$;

drop trigger if exists validate_workspace_okr_work_item on public.workspace_okr_work_items;
create trigger validate_workspace_okr_work_item before insert or update on public.workspace_okr_work_items
for each row execute function public.validate_workspace_okr_work_item();

create or replace function public.validate_private_work_item_links()
returns trigger
language plpgsql
set search_path = public
as $$
declare item_visibility text;
declare linked_visibility text;
begin
    if tg_table_name = 'work_items' then
        if new.parent_work_item_id is null then return new; end if;
        select visibility into linked_visibility from public.work_items
        where id = new.parent_work_item_id and workspace_id = new.workspace_id;
        if linked_visibility is null or linked_visibility <> new.visibility then
            raise exception 'Parent and child work items must have the same visibility';
        end if;
        return new;
    end if;

    select visibility into item_visibility from public.work_items
    where id = new.work_item_id and workspace_id = new.workspace_id;
    if item_visibility is null then raise exception 'Work item must belong to the link workspace'; end if;

    if tg_table_name in ('work_item_relationships', 'asset_work_items') and item_visibility <> 'workspace' then
        raise exception 'Private Admin work items cannot be linked to workspace relationships or assets';
    end if;
    if tg_table_name = 'work_item_dependencies' then
        select visibility into linked_visibility from public.work_items
        where id = new.depends_on_work_item_id and workspace_id = new.workspace_id;
        if linked_visibility is null or linked_visibility <> item_visibility then
            raise exception 'Work item dependencies must have the same visibility';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists validate_private_work_item_parent on public.work_items;
create trigger validate_private_work_item_parent before insert or update of workspace_id, visibility, parent_work_item_id on public.work_items
for each row execute function public.validate_private_work_item_links();
drop trigger if exists validate_private_work_item_relationship on public.work_item_relationships;
create trigger validate_private_work_item_relationship before insert or update on public.work_item_relationships
for each row execute function public.validate_private_work_item_links();
drop trigger if exists validate_private_asset_work_item on public.asset_work_items;
create trigger validate_private_asset_work_item before insert or update on public.asset_work_items
for each row execute function public.validate_private_work_item_links();
drop trigger if exists validate_private_work_item_dependency on public.work_item_dependencies;
create trigger validate_private_work_item_dependency before insert or update on public.work_item_dependencies
for each row execute function public.validate_private_work_item_links();

create or replace function public.validate_work_item_assignee()
returns trigger
language plpgsql
set search_path = public
as $$
declare item_visibility text;
begin
    select visibility into item_visibility from public.work_items
    where id = new.work_item_id and workspace_id = new.workspace_id;
    if item_visibility is null then raise exception 'Work item must belong to the assignee workspace'; end if;
    if not exists (
        select 1 from public.workspace_memberships
        where workspace_id = new.workspace_id
          and user_id = new.user_id
          and (item_visibility = 'workspace' or role in ('owner', 'admin'))
    ) then raise exception 'Assignee does not have access to this work item'; end if;
    return new;
end;
$$;

alter table public.workspace_okrs enable row level security;
alter table public.workspace_okr_key_results enable row level security;
alter table public.workspace_okr_measurements enable row level security;
alter table public.workspace_okr_work_items enable row level security;
alter table public.workspace_maintenance_routing enable row level security;

create policy "workspace admins manage okrs" on public.workspace_okrs
for all using (public.is_workspace_member(workspace_id, array['owner','admin']))
with check (public.is_workspace_member(workspace_id, array['owner','admin']));
create policy "workspace admins manage okr key results" on public.workspace_okr_key_results
for all using (public.is_workspace_member(workspace_id, array['owner','admin']))
with check (public.is_workspace_member(workspace_id, array['owner','admin']));
create policy "workspace admins read okr measurements" on public.workspace_okr_measurements
for select using (public.is_workspace_member(workspace_id, array['owner','admin']));
create policy "workspace admins append okr measurements" on public.workspace_okr_measurements
for insert with check (public.is_workspace_member(workspace_id, array['owner','admin']));
create policy "workspace admins manage okr work items" on public.workspace_okr_work_items
for all using (public.is_workspace_member(workspace_id, array['owner','admin']))
with check (public.is_workspace_member(workspace_id, array['owner','admin']));
create policy "workspace admins manage maintenance routing" on public.workspace_maintenance_routing
for all using (public.is_workspace_member(workspace_id, array['owner','admin']))
with check (public.is_workspace_member(workspace_id, array['owner','admin']));

drop policy if exists workspace_members_can_read_work_items on public.work_items;
create policy workspace_members_can_read_work_items on public.work_items
for select using (
    public.is_workspace_member(workspace_id)
    and (visibility = 'workspace' or public.is_workspace_member(workspace_id, array['owner','admin']))
);

drop policy if exists "workspace members can read work item assignees" on public.work_item_assignees;
create policy "workspace members can read work item assignees" on public.work_item_assignees
for select using (
    public.is_workspace_member(workspace_id)
    and exists (
        select 1 from public.work_items item
        where item.id = public.work_item_assignees.work_item_id
          and item.workspace_id = public.work_item_assignees.workspace_id
          and (item.visibility = 'workspace' or public.is_workspace_member(public.work_item_assignees.workspace_id, array['owner','admin']))
    )
);

drop policy if exists "workspace members can read work item dependencies" on public.work_item_dependencies;
create policy "workspace members can read work item dependencies" on public.work_item_dependencies
for select using (
    public.is_workspace_member(workspace_id)
    and exists (
        select 1 from public.work_items item
        where item.id = public.work_item_dependencies.work_item_id
          and item.workspace_id = public.work_item_dependencies.workspace_id
          and (item.visibility = 'workspace' or public.is_workspace_member(public.work_item_dependencies.workspace_id, array['owner','admin']))
    )
    and exists (
        select 1 from public.work_items prerequisite
        where prerequisite.id = public.work_item_dependencies.depends_on_work_item_id
          and prerequisite.workspace_id = public.work_item_dependencies.workspace_id
          and (prerequisite.visibility = 'workspace' or public.is_workspace_member(public.work_item_dependencies.workspace_id, array['owner','admin']))
    )
);

drop policy if exists workspace_members_can_read_work_item_relationships on public.work_item_relationships;
create policy workspace_members_can_read_work_item_relationships on public.work_item_relationships
for select using (
    public.is_workspace_member(workspace_id)
    and exists (
        select 1 from public.work_items item
        where item.id = public.work_item_relationships.work_item_id
          and item.workspace_id = public.work_item_relationships.workspace_id
          and (item.visibility = 'workspace' or public.is_workspace_member(public.work_item_relationships.workspace_id, array['owner','admin']))
    )
);

drop policy if exists workspace_members_can_read_asset_work_items on public.asset_work_items;
create policy workspace_members_can_read_asset_work_items on public.asset_work_items
for select using (
    public.is_workspace_member(workspace_id)
    and exists (
        select 1 from public.work_items item
        where item.id = public.asset_work_items.work_item_id
          and item.workspace_id = public.asset_work_items.workspace_id
          and (item.visibility = 'workspace' or public.is_workspace_member(public.asset_work_items.workspace_id, array['owner','admin']))
    )
);
