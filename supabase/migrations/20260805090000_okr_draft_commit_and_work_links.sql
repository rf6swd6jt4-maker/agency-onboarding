alter table public.workspace_okrs
alter column objective_type drop not null;

alter table public.workspace_okrs
alter column objective_type drop default;

update public.workspace_okrs
set objective_type = null
where status = 'draft';

alter table public.workspace_okrs
drop constraint if exists workspace_okrs_draft_classification_check;

alter table public.workspace_okrs
add constraint workspace_okrs_draft_classification_check
check (
    (status = 'draft' and objective_type is null)
    or (status <> 'draft' and objective_type is not null)
);

create or replace function public.sync_workspace_okr_system_title()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    -- Keep the legacy title column as a system-owned compatibility mirror.
    if new.objective is null then new.objective := new.title; end if;
    if new.status = 'draft' or new.objective_type is null then
        new.title := 'Draft Objective: ' || new.objective || ' by ' || to_char(new.period_end, 'FMDD Mon YYYY');
    else
        new.title := initcap(new.objective_type) || ' Objective: ' || new.objective || ' by ' || to_char(new.period_end, 'FMDD Mon YYYY');
    end if;
    return new;
end;
$$;

drop trigger if exists sync_workspace_okr_system_title on public.workspace_okrs;
create trigger sync_workspace_okr_system_title
before insert or update of objective, objective_type, status, period_end, title on public.workspace_okrs
for each row execute function public.sync_workspace_okr_system_title();

update public.workspace_okrs
set title = title;

create or replace function public.enforce_workspace_okr_definition_lock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if old.status <> 'draft' and (
        new.objective is distinct from old.objective
        or new.description is distinct from old.description
        or new.period_start is distinct from old.period_start
        or new.period_end is distinct from old.period_end
        or new.owner_user_id is distinct from old.owner_user_id
        or new.objective_type is distinct from old.objective_type
    ) then
        raise exception 'Committed OKR definitions are locked';
    end if;
    if old.status <> 'draft' and new.status = 'draft' then
        raise exception 'Committed OKRs cannot return to draft';
    end if;
    return new;
end;
$$;

drop trigger if exists enforce_workspace_okr_definition_lock on public.workspace_okrs;
create trigger enforce_workspace_okr_definition_lock
before update on public.workspace_okrs
for each row execute function public.enforce_workspace_okr_definition_lock();

create or replace function public.enforce_draft_okr_key_result_definition()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    parent_okr_id uuid;
    parent_status text;
begin
    parent_okr_id := case when tg_op = 'DELETE' then old.okr_id else new.okr_id end;
    select status into parent_status from public.workspace_okrs where id = parent_okr_id;
    if parent_status is not null and parent_status <> 'draft' then
        raise exception 'Committed Key Result definitions are locked';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists enforce_draft_okr_key_result_definition on public.workspace_okr_key_results;
create trigger enforce_draft_okr_key_result_definition
before insert or update or delete on public.workspace_okr_key_results
for each row execute function public.enforce_draft_okr_key_result_definition();

create or replace function public.validate_workspace_okr_work_item()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    result_workspace_id uuid;
    item_workspace_id uuid;
begin
    select workspace_id into result_workspace_id
    from public.workspace_okr_key_results
    where id = new.key_result_id;

    select workspace_id into item_workspace_id
    from public.work_items
    where id = new.work_item_id;

    if result_workspace_id is null or item_workspace_id is null
       or result_workspace_id <> new.workspace_id
       or item_workspace_id <> new.workspace_id then
        raise exception 'OKR work links must stay inside one workspace';
    end if;

    return new;
end;
$$;
