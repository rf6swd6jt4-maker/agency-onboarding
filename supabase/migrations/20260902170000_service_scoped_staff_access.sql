-- Staff remains one workspace role. Its usable panels and records are derived
-- from the services explicitly assigned to the member.

create table if not exists public.workspace_service_capabilities (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    service_id uuid not null,
    capability text not null check (capability in (
        'relationships.view', 'onboarding.manage', 'fulfilment.manage',
        'appointment_setting.manage', 'communications.manage', 'library.manage',
        'onboarding_builder.manage', 'leadgen.manage', 'admin.manage', 'settings.manage'
    )),
    created_at timestamptz not null default now(),
    foreign key (workspace_id, service_id)
        references public.onboarding_services(workspace_id, id) on delete cascade,
    primary key (service_id, capability)
);

create index if not exists workspace_service_capabilities_workspace_idx
on public.workspace_service_capabilities(workspace_id, capability, service_id);

create table if not exists public.workspace_member_service_access (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    service_id uuid not null,
    granted_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    foreign key (workspace_id, user_id)
        references public.workspace_memberships(workspace_id, user_id) on delete cascade,
    foreign key (workspace_id, service_id)
        references public.onboarding_services(workspace_id, id) on delete cascade,
    primary key (workspace_id, user_id, service_id)
);

create index if not exists workspace_member_service_access_service_idx
on public.workspace_member_service_access(workspace_id, service_id, user_id);

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.workspace_invitations'::regclass
          and conname = 'workspace_invitations_workspace_id_id_unique'
    ) then
        alter table public.workspace_invitations
            add constraint workspace_invitations_workspace_id_id_unique unique (workspace_id, id);
    end if;
end;
$$;

create table if not exists public.workspace_invitation_service_access (
    invitation_id uuid not null references public.workspace_invitations(id) on delete cascade,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    service_id uuid not null,
    created_at timestamptz not null default now(),
    foreign key (workspace_id, invitation_id)
        references public.workspace_invitations(workspace_id, id) on delete cascade,
    foreign key (workspace_id, service_id)
        references public.onboarding_services(workspace_id, id) on delete cascade,
    primary key (invitation_id, service_id)
);

create index if not exists workspace_invitation_service_access_workspace_idx
on public.workspace_invitation_service_access(workspace_id, invitation_id);

-- Every ordinary service enables its operational onboarding and fulfilment
-- surfaces. Templates can add narrower product capabilities without creating
-- another workspace role.
insert into public.workspace_service_capabilities (workspace_id, service_id, capability)
select service.workspace_id, service.id, capability
from public.onboarding_services service
cross join (values ('onboarding.manage'), ('fulfilment.manage')) as defaults(capability)
on conflict do nothing;

create or replace function public.add_default_workspace_service_capabilities()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.workspace_service_capabilities (workspace_id, service_id, capability)
    values
        (new.workspace_id, new.id, 'onboarding.manage'),
        (new.workspace_id, new.id, 'fulfilment.manage')
    on conflict do nothing;
    return new;
end;
$$;

drop trigger if exists add_default_workspace_service_capabilities on public.onboarding_services;
create trigger add_default_workspace_service_capabilities
after insert on public.onboarding_services
for each row execute function public.add_default_workspace_service_capabilities();

create or replace function public.sync_template_workspace_service_capabilities()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if coalesce(new.definition->>'templateId', new.definition->>'template_id') = 'appointment-setting' then
        insert into public.workspace_service_capabilities (workspace_id, service_id, capability)
        values (new.workspace_id, new.service_id, 'appointment_setting.manage')
        on conflict do nothing;
    end if;
    return new;
end;
$$;

drop trigger if exists sync_template_workspace_service_capabilities on public.onboarding_service_revisions;
create trigger sync_template_workspace_service_capabilities
after insert or update of definition on public.onboarding_service_revisions
for each row execute function public.sync_template_workspace_service_capabilities();

insert into public.workspace_service_capabilities (workspace_id, service_id, capability)
select distinct service.workspace_id, service.id, 'appointment_setting.manage'
from public.onboarding_services service
join public.onboarding_service_revisions revision
  on revision.workspace_id = service.workspace_id and revision.service_id = service.id
where coalesce(revision.definition->>'templateId', revision.definition->>'template_id') = 'appointment-setting'
on conflict do nothing;

-- Existing Staff members receive every existing service as an explicit
-- compatibility grant. Administrators can narrow these grants in Settings.
insert into public.workspace_member_service_access (workspace_id, user_id, service_id)
select membership.workspace_id, membership.user_id, service.id
from public.workspace_memberships membership
join public.onboarding_services service on service.workspace_id = membership.workspace_id
where membership.role = 'staff'
on conflict do nothing;

alter table public.work_items add column if not exists service_id uuid;
do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.work_items'::regclass
          and conname = 'work_items_service_workspace_fkey'
    ) then
        alter table public.work_items
            add constraint work_items_service_workspace_fkey
            foreign key (workspace_id, service_id)
            references public.onboarding_services(workspace_id, id) on delete restrict;
    end if;
end;
$$;
create index if not exists work_items_workspace_service_idx
on public.work_items(workspace_id, service_id, status);

update public.work_items item
set service_id = (item.metadata->>'service_id')::uuid
where item.service_id is null
  and item.metadata->>'service_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
      select 1 from public.onboarding_services service
      where service.workspace_id = item.workspace_id
        and service.id = (item.metadata->>'service_id')::uuid
  );

-- Normalized onboarding steps already know the immutable service revision that
-- produced them. Use that source to keep mixed-service client work separated.
update public.work_items item
set service_id = revision.service_id
from public.relationship_onboarding_session_steps step
join public.relationship_onboarding_session_modules module
  on module.workspace_id = step.workspace_id and module.id = step.session_module_id
join public.onboarding_service_revisions revision
  on revision.workspace_id = module.workspace_id and revision.id = module.source_service_revision_id
where item.workspace_id = step.workspace_id
  and item.service_id is null
  and item.native_kind = 'onboarding_step'
  and item.metadata->>'session_step_id' = step.id::text;

with single_service_work_items as (
    select link.work_item_id, min(relationship_service.service_id::text)::uuid as service_id
    from public.work_item_relationships link
    join public.relationship_services relationship_service
      on relationship_service.workspace_id = link.workspace_id
     and relationship_service.relationship_id = link.relationship_id
    where relationship_service.service_id is not null
    group by link.work_item_id
    having count(distinct relationship_service.service_id) = 1
)
update public.work_items item
set service_id = scoped.service_id
from single_service_work_items scoped
where item.id = scoped.work_item_id and item.service_id is null;

create or replace function public.infer_work_item_service_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_session_step_id uuid;
begin
    if new.service_id is not null then return new; end if;
    if coalesce(new.metadata->>'service_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        select service.id into new.service_id
        from public.onboarding_services service
        where service.workspace_id = new.workspace_id
          and service.id = (new.metadata->>'service_id')::uuid;
        if new.service_id is not null then return new; end if;
    end if;
    if new.native_kind <> 'onboarding_step'
       or coalesce(new.metadata->>'session_step_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        return new;
    end if;
    v_session_step_id := (new.metadata->>'session_step_id')::uuid;
    select revision.service_id into new.service_id
    from public.relationship_onboarding_session_steps step
    join public.relationship_onboarding_session_modules module
      on module.workspace_id = step.workspace_id and module.id = step.session_module_id
    join public.onboarding_service_revisions revision
      on revision.workspace_id = module.workspace_id and revision.id = module.source_service_revision_id
    where step.workspace_id = new.workspace_id and step.id = v_session_step_id;
    return new;
end;
$$;

drop trigger if exists infer_work_item_service_scope on public.work_items;
create trigger infer_work_item_service_scope
before insert or update of workspace_id, service_id, metadata, native_kind on public.work_items
for each row execute function public.infer_work_item_service_scope();

create or replace function public.workspace_role_for_user(p_workspace_id uuid, p_user_id uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = public
as $$
    select membership.role
    from public.workspace_memberships membership
    where membership.workspace_id = p_workspace_id and membership.user_id = p_user_id
$$;

create or replace function public.workspace_user_has_capability(
    p_workspace_id uuid,
    p_capability text,
    p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select case
        when public.workspace_role_for_user(p_workspace_id, p_user_id) in ('owner', 'admin') then true
        when public.workspace_role_for_user(p_workspace_id, p_user_id) <> 'staff' then false
        else exists (
            select 1
            from public.workspace_member_service_access member_access
            join public.workspace_service_capabilities capability
              on capability.workspace_id = member_access.workspace_id
             and capability.service_id = member_access.service_id
            where member_access.workspace_id = p_workspace_id
              and member_access.user_id = p_user_id
              and capability.capability = p_capability
        )
    end
$$;

create or replace function public.workspace_user_can_access_relationship(
    p_workspace_id uuid,
    p_relationship_id uuid,
    p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select case
        when public.workspace_role_for_user(p_workspace_id, p_user_id) in ('owner', 'admin') then true
        when public.workspace_role_for_user(p_workspace_id, p_user_id) <> 'staff' then false
        else exists (
            select 1
            from public.relationship_services relationship_service
            join public.workspace_member_service_access member_access
              on member_access.workspace_id = relationship_service.workspace_id
             and member_access.service_id = relationship_service.service_id
             and member_access.user_id = p_user_id
            where relationship_service.workspace_id = p_workspace_id
              and relationship_service.relationship_id = p_relationship_id
        )
    end
$$;

create or replace function public.workspace_user_has_service(
    p_workspace_id uuid,
    p_service_id uuid,
    p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select case
        when public.workspace_role_for_user(p_workspace_id, p_user_id) in ('owner', 'admin') then true
        when public.workspace_role_for_user(p_workspace_id, p_user_id) <> 'staff' then false
        else exists (
            select 1 from public.workspace_member_service_access member_access
            where member_access.workspace_id = p_workspace_id
              and member_access.user_id = p_user_id
              and member_access.service_id = p_service_id
        )
    end
$$;

create or replace function public.workspace_user_fully_covers_relationship(
    p_workspace_id uuid,
    p_relationship_id uuid,
    p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select case
        when public.workspace_role_for_user(p_workspace_id, p_user_id) in ('owner', 'admin') then true
        when public.workspace_role_for_user(p_workspace_id, p_user_id) <> 'staff' then false
        else exists (
            select 1 from public.relationship_services relationship_service
            where relationship_service.workspace_id = p_workspace_id
              and relationship_service.relationship_id = p_relationship_id
              and relationship_service.service_id is not null
        ) and not exists (
            select 1 from public.relationship_services relationship_service
            where relationship_service.workspace_id = p_workspace_id
              and relationship_service.relationship_id = p_relationship_id
              and (
                  relationship_service.service_id is null
                  or not public.workspace_user_has_service(p_workspace_id, relationship_service.service_id, p_user_id)
              )
        )
    end
$$;

create or replace function public.workspace_user_can_access_session_module(
    p_workspace_id uuid,
    p_session_module_id uuid,
    p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select case
        when public.workspace_role_for_user(p_workspace_id, p_user_id) in ('owner', 'admin') then true
        when public.workspace_role_for_user(p_workspace_id, p_user_id) <> 'staff' then false
        else exists (
            select 1
            from public.relationship_onboarding_session_modules module
            join public.relationship_onboarding_sessions session
              on session.workspace_id = module.workspace_id and session.id = module.session_id
            left join public.onboarding_service_revisions revision
              on revision.workspace_id = module.workspace_id and revision.id = module.source_service_revision_id
            where module.workspace_id = p_workspace_id
              and module.id = p_session_module_id
              and public.workspace_user_can_access_relationship(p_workspace_id, session.relationship_id, p_user_id)
              and (
                  module.source_kind = 'mandatory'
                  or public.workspace_user_has_service(p_workspace_id, revision.service_id, p_user_id)
              )
        )
    end
$$;

create or replace function public.workspace_user_can_access_session_step(
    p_workspace_id uuid,
    p_session_step_id uuid,
    p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select case
        when public.workspace_role_for_user(p_workspace_id, p_user_id) in ('owner', 'admin') then true
        when public.workspace_role_for_user(p_workspace_id, p_user_id) <> 'staff' then false
        else exists (
            select 1
            from public.relationship_onboarding_session_steps step
            join public.relationship_onboarding_sessions session
              on session.workspace_id = step.workspace_id and session.id = step.session_id
            where step.workspace_id = p_workspace_id
              and step.id = p_session_step_id
              and public.workspace_user_can_access_relationship(p_workspace_id, session.relationship_id, p_user_id)
              and (
                  step.session_module_id is null
                  or public.workspace_user_can_access_session_module(p_workspace_id, step.session_module_id, p_user_id)
              )
        )
    end
$$;

create or replace function public.workspace_user_can_access_work_item(
    p_workspace_id uuid,
    p_work_item_id uuid,
    p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select case
        when public.workspace_role_for_user(p_workspace_id, p_user_id) in ('owner', 'admin') then true
        when public.workspace_role_for_user(p_workspace_id, p_user_id) <> 'staff' then false
        else exists (
            select 1
            from public.work_items item
            where item.workspace_id = p_workspace_id
              and item.id = p_work_item_id
              and (
                  (item.service_id is not null and public.workspace_user_has_service(p_workspace_id, item.service_id, p_user_id))
                  or (
                      item.service_id is null
                      and item.native_kind = 'onboarding_step'
                      and coalesce(item.metadata->>'session_step_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                      and public.workspace_user_can_access_session_step(p_workspace_id, (item.metadata->>'session_step_id')::uuid, p_user_id)
                  )
                  or (
                      item.service_id is null
                      and exists (
                          select 1 from public.work_item_relationships link
                          where link.workspace_id = p_workspace_id
                            and link.work_item_id = item.id
                            and public.workspace_user_fully_covers_relationship(p_workspace_id, link.relationship_id, p_user_id)
                      )
                  )
              )
              and (
                  not exists (
                      select 1 from public.work_item_relationships link
                      where link.workspace_id = p_workspace_id and link.work_item_id = item.id
                  )
                  or exists (
                      select 1 from public.work_item_relationships link
                      where link.workspace_id = p_workspace_id
                        and link.work_item_id = item.id
                        and public.workspace_user_can_access_relationship(p_workspace_id, link.relationship_id, p_user_id)
                  )
              )
        )
    end
$$;

create or replace function public.workspace_user_can_access_asset(
    p_workspace_id uuid,
    p_asset_id uuid,
    p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select case
        when public.workspace_role_for_user(p_workspace_id, p_user_id) in ('owner', 'admin') then true
        when public.workspace_role_for_user(p_workspace_id, p_user_id) <> 'staff' then false
        else exists (
            select 1 from public.asset_relationships link
            where link.workspace_id = p_workspace_id and link.asset_id = p_asset_id
              and public.workspace_user_fully_covers_relationship(p_workspace_id, link.relationship_id, p_user_id)
        ) or exists (
            select 1 from public.asset_work_items link
            where link.workspace_id = p_workspace_id and link.asset_id = p_asset_id
              and public.workspace_user_can_access_work_item(p_workspace_id, link.work_item_id, p_user_id)
        )
    end
$$;

revoke all on function public.workspace_role_for_user(uuid, uuid) from public, anon;
revoke all on function public.workspace_user_has_capability(uuid, text, uuid) from public, anon;
revoke all on function public.workspace_user_can_access_relationship(uuid, uuid, uuid) from public, anon;
revoke all on function public.workspace_user_has_service(uuid, uuid, uuid) from public, anon;
revoke all on function public.workspace_user_fully_covers_relationship(uuid, uuid, uuid) from public, anon;
revoke all on function public.workspace_user_can_access_session_module(uuid, uuid, uuid) from public, anon;
revoke all on function public.workspace_user_can_access_session_step(uuid, uuid, uuid) from public, anon;
revoke all on function public.workspace_user_can_access_work_item(uuid, uuid, uuid) from public, anon;
revoke all on function public.workspace_user_can_access_asset(uuid, uuid, uuid) from public, anon;
grant execute on function public.workspace_role_for_user(uuid, uuid) to authenticated, service_role;
grant execute on function public.workspace_user_has_capability(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.workspace_user_can_access_relationship(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.workspace_user_has_service(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.workspace_user_fully_covers_relationship(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.workspace_user_can_access_session_module(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.workspace_user_can_access_session_step(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.workspace_user_can_access_work_item(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.workspace_user_can_access_asset(uuid, uuid, uuid) to authenticated, service_role;

alter table public.workspace_service_capabilities enable row level security;
alter table public.workspace_member_service_access enable row level security;
alter table public.workspace_invitation_service_access enable row level security;
alter table public.workspace_integrations enable row level security;

create policy "workspace members read service capabilities"
on public.workspace_service_capabilities for select to authenticated
using (public.workspace_role_for_user(workspace_id) is not null);

create policy "members read their service access"
on public.workspace_member_service_access for select to authenticated
using (user_id = auth.uid() or public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "admins manage member service access"
on public.workspace_member_service_access for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "admins read invitation service access"
on public.workspace_invitation_service_access for select to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "admins manage invitation service access"
on public.workspace_invitation_service_access for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "workspace admins read integrations"
on public.workspace_integrations for select to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "workspace admins manage integrations"
on public.workspace_integrations for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

-- Restrictive policies close the former workspace-wide Staff reads while
-- preserving all existing Owner/Admin policies.
create policy "service scoped staff relationships" on public.relationships
as restrictive for select to authenticated
using (public.workspace_user_can_access_relationship(workspace_id, id));

create policy "service scoped staff relationship services" on public.relationship_services
as restrictive for select to authenticated
using (public.workspace_user_has_service(workspace_id, service_id));

create policy "service scoped staff work items" on public.work_items
as restrictive for select to authenticated
using (public.workspace_user_can_access_work_item(workspace_id, id));

create policy "service scoped staff work item relationships" on public.work_item_relationships
as restrictive for select to authenticated
using (
    public.workspace_user_can_access_work_item(workspace_id, work_item_id)
    and public.workspace_user_can_access_relationship(workspace_id, relationship_id)
);

create policy "service scoped staff work item assignees" on public.work_item_assignees
as restrictive for select to authenticated
using (public.workspace_user_can_access_work_item(workspace_id, work_item_id));

create policy "service scoped staff work item dependencies" on public.work_item_dependencies
as restrictive for select to authenticated
using (
    public.workspace_user_can_access_work_item(workspace_id, work_item_id)
    and public.workspace_user_can_access_work_item(workspace_id, depends_on_work_item_id)
);

create policy "service scoped staff assets" on public.assets
as restrictive for select to authenticated
using (public.workspace_user_can_access_asset(workspace_id, id));

create policy "service scoped staff asset relationships" on public.asset_relationships
as restrictive for select to authenticated
using (
    public.workspace_user_can_access_asset(workspace_id, asset_id)
    and public.workspace_user_can_access_relationship(workspace_id, relationship_id)
);

create policy "service scoped staff asset work items" on public.asset_work_items
as restrictive for select to authenticated
using (
    public.workspace_user_can_access_asset(workspace_id, asset_id)
    and public.workspace_user_can_access_work_item(workspace_id, work_item_id)
);

create policy "service scoped staff onboarding sessions" on public.relationship_onboarding_sessions
as restrictive for select to authenticated
using (public.workspace_user_fully_covers_relationship(workspace_id, relationship_id));

create policy "service scoped staff onboarding modules" on public.relationship_onboarding_modules
as restrictive for select to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "service scoped staff normalized onboarding modules" on public.relationship_onboarding_session_modules
as restrictive for select to authenticated
using (public.workspace_user_can_access_session_module(workspace_id, id));

create policy "service scoped staff normalized onboarding steps" on public.relationship_onboarding_session_steps
as restrictive for select to authenticated
using (public.workspace_user_can_access_session_step(workspace_id, id));

create policy "service scoped staff normalized onboarding fields" on public.relationship_onboarding_session_fields
as restrictive for select to authenticated
using (public.workspace_user_can_access_session_step(workspace_id, session_step_id));

create policy "service scoped staff onboarding blocks" on public.relationship_onboarding_session_blocks
as restrictive for select to authenticated
using (public.workspace_user_can_access_session_step(workspace_id, session_step_id));

create policy "service scoped staff onboarding edit requests" on public.onboarding_edit_requests
as restrictive for select to authenticated
using (public.workspace_user_can_access_session_step(workspace_id, session_step_id));

create policy "service scoped staff onboarding work items" on public.relationship_work_items
as restrictive for select to authenticated
using (public.workspace_user_fully_covers_relationship(workspace_id, relationship_id));

create policy "staff cannot access legacy relationship assets" on public.relationship_assets
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

-- Staff does not receive these panels through a service. Restrictive policies
-- also close direct PostgREST and Realtime access, not only page navigation.
create policy "staff cannot access workspace teams" on public.workspace_teams
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access workspace team members" on public.workspace_team_members
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access workspace team service responsibilities" on public.workspace_team_service_responsibilities
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access native conversations" on public.workspace_native_conversations
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access native conversation participants" on public.workspace_native_conversation_participants
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access native messages" on public.workspace_native_messages
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access native reactions" on public.workspace_native_reactions
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access native read cursors" on public.workspace_native_read_cursors
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access legacy clients" on public.clients
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access legacy client progress" on public.client_progress
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access legacy client modules" on public.client_modules
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access legacy client notes" on public.client_notes
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access legacy client activity" on public.client_activity
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access legacy client form responses" on public.client_form_responses
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access legacy client services" on public.client_services
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access legacy clickup items" on public.client_clickup_items
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access stripe events" on public.stripe_events
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access client sales" on public.client_sales
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access client sale items" on public.client_sale_items
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access client sale composition" on public.client_sale_composition_items
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access client channels" on public.client_communication_channels
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access client messages" on public.client_messages
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access communication cursors" on public.communication_read_cursors
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access communication reactions" on public.communication_reactions
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access communication stickers" on public.communication_stickers
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access communication deliveries" on public.communication_message_deliveries
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create policy "staff cannot access client portal sessions" on public.client_portal_sessions
as restrictive for all to authenticated
using (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'))
with check (public.workspace_role_for_user(workspace_id) in ('owner', 'admin'));

create or replace function public.can_access_communications_realtime(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select p_topic ~ '^communications:[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'
       and exists (
           select 1
           from public.workspaces workspace
           join public.workspace_memberships membership on membership.workspace_id = workspace.id
           where workspace.slug = split_part(p_topic, ':', 2)
             and membership.user_id = auth.uid()
             and membership.role in ('owner', 'admin')
             and workspace.status = 'active'
       );
$$;

drop function if exists public.rotate_workspace_invitation(uuid, uuid, text, text, uuid, timestamptz, text);
create function public.rotate_workspace_invitation(
    p_invitation_id uuid,
    p_workspace_id uuid,
    p_email text,
    p_role text,
    p_invited_by uuid,
    p_expires_at timestamptz,
    p_token_hash text,
    p_service_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_invitation_id uuid;
    v_attempt_count integer;
    v_service_ids uuid[] := coalesce(p_service_ids, '{}'::uuid[]);
begin
    if p_invitation_id is null or p_workspace_id is null or p_invited_by is null
       or p_role not in ('admin', 'staff')
       or p_email is null or position('@' in p_email) <= 1
       or p_expires_at <= now()
       or p_token_hash !~ '^[a-f0-9]{64}$' then
        raise exception 'INVALID_INVITATION_ROTATION' using errcode = 'P0001';
    end if;
    if p_role = 'staff' and cardinality(v_service_ids) = 0 then
        raise exception 'STAFF_SERVICE_ACCESS_REQUIRED' using errcode = 'P0001';
    end if;
    if exists (
        select 1 from unnest(v_service_ids) requested(service_id)
        left join public.onboarding_services service
          on service.id = requested.service_id and service.workspace_id = p_workspace_id
        where service.id is null or service.state <> 'active'
    ) then
        raise exception 'INVALID_STAFF_SERVICE_ACCESS' using errcode = 'P0001';
    end if;

    insert into public.workspace_invitations as existing_invitation (
        id, workspace_id, email, role, invited_by, expires_at,
        accepted_at, accepted_by, revoked_at, token_hash, token_exchanged_at,
        delivery_status, provider_message_id, delivery_attempt_count,
        sent_at, delivered_at, delivery_failed_at, delivery_failure_code
    ) values (
        p_invitation_id, p_workspace_id, lower(p_email), p_role, p_invited_by, p_expires_at,
        null, null, null, p_token_hash, null,
        'queued', null, 1,
        null, null, null, null
    )
    on conflict (workspace_id, email) do update
    set role = excluded.role,
        invited_by = excluded.invited_by,
        expires_at = excluded.expires_at,
        accepted_at = null,
        accepted_by = null,
        revoked_at = null,
        token_hash = excluded.token_hash,
        token_exchanged_at = null,
        delivery_status = 'queued',
        provider_message_id = null,
        delivery_attempt_count = existing_invitation.delivery_attempt_count + 1,
        sent_at = null,
        delivered_at = null,
        delivery_failed_at = null,
        delivery_failure_code = null
    returning id, delivery_attempt_count into v_invitation_id, v_attempt_count;

    delete from public.workspace_invitation_service_access where invitation_id = v_invitation_id;
    if p_role = 'staff' then
        insert into public.workspace_invitation_service_access (invitation_id, workspace_id, service_id)
        select v_invitation_id, p_workspace_id, requested.service_id
        from (select distinct unnest(v_service_ids) as service_id) requested;
    end if;

    delete from public.account_onboarding_sessions where invitation_id = v_invitation_id;
    return jsonb_build_object('invitation_id', v_invitation_id, 'delivery_attempt_count', v_attempt_count);
end;
$$;

revoke all on function public.rotate_workspace_invitation(uuid, uuid, text, text, uuid, timestamptz, text, uuid[]) from public, anon, authenticated;
grant execute on function public.rotate_workspace_invitation(uuid, uuid, text, text, uuid, timestamptz, text, uuid[]) to service_role;

create or replace function public.apply_workspace_invitation_service_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.accepted_at is null or new.accepted_by is null
       or (old.accepted_at is not null and old.accepted_by is not distinct from new.accepted_by) then
        return new;
    end if;
    delete from public.workspace_member_service_access
    where workspace_id = new.workspace_id and user_id = new.accepted_by;
    if exists (
        select 1 from public.workspace_memberships
        where workspace_id = new.workspace_id and user_id = new.accepted_by and role = 'staff'
    ) then
        insert into public.workspace_member_service_access (workspace_id, user_id, service_id, granted_by)
        select access.workspace_id, new.accepted_by, access.service_id, new.invited_by
        from public.workspace_invitation_service_access access
        where access.invitation_id = new.id
        on conflict do nothing;
    end if;
    return new;
end;
$$;

drop trigger if exists apply_workspace_invitation_service_access on public.workspace_invitations;
create trigger apply_workspace_invitation_service_access
after update of accepted_at, accepted_by on public.workspace_invitations
for each row execute function public.apply_workspace_invitation_service_access();

create or replace function public.set_workspace_member_service_access(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_target_user_id uuid,
    p_role text,
    p_service_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_role text;
    v_target_role text;
    v_service_ids uuid[] := coalesce(p_service_ids, '{}'::uuid[]);
begin
    select role into v_actor_role from public.workspace_memberships
    where workspace_id = p_workspace_id and user_id = p_actor_user_id;
    select role into v_target_role from public.workspace_memberships
    where workspace_id = p_workspace_id and user_id = p_target_user_id for update;
    if v_actor_role not in ('owner', 'admin') or v_target_role is null or v_target_role = 'owner' then
        raise exception 'WORKSPACE_ACCESS_CHANGE_FORBIDDEN' using errcode = 'P0001';
    end if;
    if p_role not in ('admin', 'staff') then
        raise exception 'INVALID_WORKSPACE_ROLE' using errcode = 'P0001';
    end if;
    if v_actor_role <> 'owner' and (v_target_role <> 'staff' or p_role <> 'staff') then
        raise exception 'OWNER_REQUIRED_FOR_ROLE_CHANGE' using errcode = 'P0001';
    end if;
    if p_role = 'staff' and cardinality(v_service_ids) = 0 then
        raise exception 'STAFF_SERVICE_ACCESS_REQUIRED' using errcode = 'P0001';
    end if;
    if exists (
        select 1 from unnest(v_service_ids) requested(service_id)
        left join public.onboarding_services service
          on service.id = requested.service_id and service.workspace_id = p_workspace_id
        where service.id is null
    ) then
        raise exception 'INVALID_STAFF_SERVICE_ACCESS' using errcode = 'P0001';
    end if;

    update public.workspace_memberships set role = p_role
    where workspace_id = p_workspace_id and user_id = p_target_user_id;
    delete from public.workspace_member_service_access
    where workspace_id = p_workspace_id and user_id = p_target_user_id;
    if p_role = 'staff' then
        insert into public.workspace_member_service_access (workspace_id, user_id, service_id, granted_by)
        select p_workspace_id, p_target_user_id, requested.service_id, p_actor_user_id
        from (select distinct unnest(v_service_ids) as service_id) requested;
    end if;
    return jsonb_build_object('user_id', p_target_user_id, 'role', p_role, 'service_count', cardinality(v_service_ids));
end;
$$;

revoke all on function public.set_workspace_member_service_access(uuid, uuid, uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.set_workspace_member_service_access(uuid, uuid, uuid, text, uuid[]) to service_role;
