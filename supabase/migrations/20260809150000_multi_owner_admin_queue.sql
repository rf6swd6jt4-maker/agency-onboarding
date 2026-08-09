alter table public.work_items
add column if not exists execution_owner_id uuid;

alter table public.work_items
drop constraint if exists work_items_execution_owner_id_fkey;

alter table public.work_items
add constraint work_items_execution_owner_id_fkey
foreign key (execution_owner_id) references auth.users(id) on delete set null;

comment on column public.work_items.execution_owner_id is
'Single accountable owner whose working capacity and history drive completion forecasts. Other work_item_assignees are collaborators.';

update public.work_items item
set execution_owner_id = (
    select assignee.user_id
    from public.work_item_assignees assignee
    where assignee.workspace_id = item.workspace_id
      and assignee.work_item_id = item.id
    order by assignee.assigned_at, assignee.user_id
    limit 1
)
where item.execution_owner_id is null
  and exists (
      select 1 from public.work_item_assignees assignee
      where assignee.workspace_id = item.workspace_id
        and assignee.work_item_id = item.id
  );

update public.work_items item
set execution_owner_id = coalesce(
    (
        select membership.user_id
        from public.workspace_memberships membership
        where membership.workspace_id = item.workspace_id
          and membership.user_id = item.created_by
        limit 1
    ),
    (
        select membership.user_id
        from public.workspace_memberships membership
        where membership.workspace_id = item.workspace_id
          and membership.role in ('owner', 'admin')
        order by case membership.role when 'owner' then 0 else 1 end, membership.created_at, membership.user_id
        limit 1
    )
)
where item.execution_owner_id is null
  and exists (
      select 1 from public.workspace_okr_work_items link
      where link.workspace_id = item.workspace_id
        and link.work_item_id = item.id
  );

do $$
begin
    if exists (
        select 1
        from public.workspace_okr_work_items link
        join public.work_items item on item.id = link.work_item_id and item.workspace_id = link.workspace_id
        where item.execution_owner_id is null
    ) then
        raise exception 'Every existing KR-linked work item must have an execution owner';
    end if;
end;
$$;

insert into public.work_item_assignees (workspace_id, work_item_id, user_id, assigned_by)
select item.workspace_id, item.id, item.execution_owner_id, item.created_by
from public.work_items item
where item.execution_owner_id is not null
on conflict (work_item_id, user_id) do nothing;

create index if not exists work_items_execution_owner_queue_idx
on public.work_items(workspace_id, execution_owner_id, status, priority)
where status not in ('done', 'canceled');

create or replace function public.validate_work_item_execution_owner()
returns trigger
language plpgsql
set search_path = public
as $$
declare owner_role text;
begin
    if new.execution_owner_id is null then
        if tg_op = 'UPDATE' and exists (
            select 1 from public.workspace_okr_work_items link
            where link.workspace_id = new.workspace_id and link.work_item_id = new.id
        ) then
            raise exception 'KR-linked work requires an execution owner';
        end if;
        return new;
    end if;

    select membership.role into owner_role
    from public.workspace_memberships membership
    where membership.workspace_id = new.workspace_id
      and membership.user_id = new.execution_owner_id;

    if owner_role is null then
        raise exception 'Execution owner must belong to the work item workspace';
    end if;
    if new.visibility = 'admins_only' and owner_role not in ('owner', 'admin') then
        raise exception 'Private Admin work must be owned by an Owner or Admin';
    end if;
    return new;
end;
$$;

drop trigger if exists validate_work_item_execution_owner on public.work_items;
create trigger validate_work_item_execution_owner
before insert or update of execution_owner_id, workspace_id, visibility
on public.work_items
for each row execute function public.validate_work_item_execution_owner();

create or replace function public.sync_work_item_execution_owner_assignment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.execution_owner_id is not null then
        insert into public.work_item_assignees (workspace_id, work_item_id, user_id, assigned_by)
        values (new.workspace_id, new.id, new.execution_owner_id, new.created_by)
        on conflict (work_item_id, user_id) do nothing;
    end if;
    return new;
end;
$$;

drop trigger if exists sync_work_item_execution_owner_assignment on public.work_items;
create trigger sync_work_item_execution_owner_assignment
after insert or update of execution_owner_id
on public.work_items
for each row execute function public.sync_work_item_execution_owner_assignment();

create or replace function public.clear_removed_work_item_execution_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    update public.work_items
    set execution_owner_id = null
    where id = old.work_item_id
      and workspace_id = old.workspace_id
      and execution_owner_id = old.user_id;
    return old;
end;
$$;

drop trigger if exists clear_removed_work_item_execution_owner on public.work_item_assignees;
create trigger clear_removed_work_item_execution_owner
after delete on public.work_item_assignees
for each row execute function public.clear_removed_work_item_execution_owner();

create or replace function public.validate_okr_work_execution_owner()
returns trigger
language plpgsql
set search_path = public
as $$
declare item_workspace_id uuid;
declare item_owner_id uuid;
begin
    select item.workspace_id, item.execution_owner_id
    into item_workspace_id, item_owner_id
    from public.work_items item
    where item.id = new.work_item_id;

    if item_workspace_id is null or item_workspace_id <> new.workspace_id then
        raise exception 'OKR work must belong to the same workspace';
    end if;
    if item_owner_id is null then
        raise exception 'KR-linked work requires an execution owner';
    end if;
    return new;
end;
$$;

drop trigger if exists validate_okr_work_execution_owner on public.workspace_okr_work_items;
create trigger validate_okr_work_execution_owner
before insert or update of work_item_id, workspace_id
on public.workspace_okr_work_items
for each row execute function public.validate_okr_work_execution_owner();
