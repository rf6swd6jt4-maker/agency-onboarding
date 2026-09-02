-- Services own Staff panel permissions. Staff membership remains valid only
-- while at least one service is assigned; multiple assignments combine grants.

create or replace function public.sync_template_workspace_service_capabilities()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Template permissions are initial defaults. Later service revisions must
    -- not overwrite the administrator's explicit Staff permission choices.
    if coalesce(new.definition->>'templateId', new.definition->>'template_id') = 'appointment-setting'
       and not exists (
           select 1
           from public.onboarding_service_revisions revision
           where revision.workspace_id = new.workspace_id
             and revision.service_id = new.service_id
             and revision.id <> new.id
       ) then
        insert into public.workspace_service_capabilities (workspace_id, service_id, capability)
        values (new.workspace_id, new.service_id, 'appointment_setting.manage')
        on conflict do nothing;
    end if;
    return new;
end;
$$;

drop trigger if exists sync_template_workspace_service_capabilities on public.onboarding_service_revisions;
create trigger sync_template_workspace_service_capabilities
after insert on public.onboarding_service_revisions
for each row execute function public.sync_template_workspace_service_capabilities();

create or replace function public.set_workspace_service_capabilities(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_service_id uuid,
    p_capabilities text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_role text;
    v_capabilities text[] := coalesce(p_capabilities, '{}'::text[]);
    v_capability_count integer := 0;
begin
    select membership.role into v_actor_role
    from public.workspace_memberships membership
    where membership.workspace_id = p_workspace_id
      and membership.user_id = p_actor_user_id;

    if v_actor_role not in ('owner', 'admin') then
        raise exception 'WORKSPACE_SERVICE_PERMISSION_CHANGE_FORBIDDEN' using errcode = 'P0001';
    end if;
    if not exists (
        select 1 from public.onboarding_services service
        where service.workspace_id = p_workspace_id and service.id = p_service_id
        for update
    ) then
        raise exception 'WORKSPACE_SERVICE_NOT_FOUND' using errcode = 'P0002';
    end if;
    if exists (
        select 1
        from unnest(v_capabilities) requested(capability)
        where requested.capability not in (
            'communications.manage',
            'onboarding.manage',
            'fulfilment.manage',
            'appointment_setting.manage'
        )
    ) then
        raise exception 'INVALID_STAFF_SERVICE_PERMISSION' using errcode = '22023';
    end if;

    delete from public.workspace_service_capabilities
    where workspace_id = p_workspace_id and service_id = p_service_id;

    insert into public.workspace_service_capabilities (workspace_id, service_id, capability)
    select p_workspace_id, p_service_id, requested.capability
    from (select distinct unnest(v_capabilities) as capability) requested;
    get diagnostics v_capability_count = row_count;

    return jsonb_build_object(
        'service_id', p_service_id,
        'capability_count', v_capability_count
    );
end;
$$;

revoke all on function public.set_workspace_service_capabilities(uuid, uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.set_workspace_service_capabilities(uuid, uuid, uuid, text[]) to service_role;

-- Repair any legacy Staff membership that has a service available but no
-- explicit assignment before enabling the deferred invariant.
insert into public.workspace_member_service_access (workspace_id, user_id, service_id, granted_by)
select membership.workspace_id, membership.user_id, fallback_service.id, null
from public.workspace_memberships membership
cross join lateral (
    select service.id
    from public.onboarding_services service
    where service.workspace_id = membership.workspace_id
    order by case service.state when 'active' then 0 when 'retired' then 1 else 2 end, service.id
    limit 1
) fallback_service
where membership.role = 'staff'
  and not exists (
      select 1
      from public.workspace_member_service_access access
      where access.workspace_id = membership.workspace_id
        and access.user_id = membership.user_id
  )
on conflict do nothing;

do $$
begin
    if exists (
        select 1
        from public.workspace_memberships membership
        where membership.role = 'staff'
          and not exists (
              select 1
              from public.workspace_member_service_access access
              where access.workspace_id = membership.workspace_id
                and access.user_id = membership.user_id
          )
    ) then
        raise exception 'Every Staff member must be assigned at least one service before this migration can finish.';
    end if;
end;
$$;

create or replace function public.enforce_workspace_staff_service_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_workspace_id uuid;
    v_user_id uuid;
begin
    if tg_op = 'DELETE' then
        v_workspace_id := old.workspace_id;
        v_user_id := old.user_id;
    else
        v_workspace_id := new.workspace_id;
        v_user_id := new.user_id;
    end if;

    if exists (
        select 1
        from public.workspace_memberships membership
        where membership.workspace_id = v_workspace_id
          and membership.user_id = v_user_id
          and membership.role = 'staff'
    ) and not exists (
        select 1
        from public.workspace_member_service_access access
        where access.workspace_id = v_workspace_id
          and access.user_id = v_user_id
    ) then
        raise exception 'STAFF_SERVICE_ACCESS_REQUIRED' using errcode = '23514';
    end if;

    if tg_op = 'UPDATE'
       and (old.workspace_id, old.user_id) is distinct from (new.workspace_id, new.user_id)
       and exists (
           select 1
           from public.workspace_memberships membership
           where membership.workspace_id = old.workspace_id
             and membership.user_id = old.user_id
             and membership.role = 'staff'
       ) and not exists (
           select 1
           from public.workspace_member_service_access access
           where access.workspace_id = old.workspace_id
             and access.user_id = old.user_id
       ) then
        raise exception 'STAFF_SERVICE_ACCESS_REQUIRED' using errcode = '23514';
    end if;

    if tg_op = 'DELETE' then return old; end if;
    return new;
end;
$$;

drop trigger if exists workspace_memberships_require_staff_service on public.workspace_memberships;
create constraint trigger workspace_memberships_require_staff_service
after insert or update or delete on public.workspace_memberships
deferrable initially deferred
for each row execute function public.enforce_workspace_staff_service_assignment();

drop trigger if exists workspace_member_service_access_requires_one on public.workspace_member_service_access;
create constraint trigger workspace_member_service_access_requires_one
after insert or update or delete on public.workspace_member_service_access
deferrable initially deferred
for each row execute function public.enforce_workspace_staff_service_assignment();
