alter table public.workspace_okr_key_results
add column if not exists reporting_cadence text;

alter table public.workspace_okr_key_results
add column if not exists reporting_started_on date;

alter table public.workspace_okr_key_results
drop constraint if exists workspace_okr_key_results_reporting_cadence_check;

alter table public.workspace_okr_key_results
add constraint workspace_okr_key_results_reporting_cadence_check
check (reporting_cadence is null or reporting_cadence in ('daily', 'weekly', 'manual'));

alter table public.workspace_okr_key_results
drop constraint if exists workspace_okr_key_results_reporting_start_check;

alter table public.workspace_okr_key_results
add constraint workspace_okr_key_results_reporting_start_check
check (reporting_started_on is null or reporting_cadence is not null);

alter table public.workspace_okr_measurements
add column if not exists reported_on date;

update public.workspace_okr_measurements
set reported_on = (measured_at at time zone 'UTC')::date
where reported_on is null;

alter table public.workspace_okr_measurements
alter column reported_on set default current_date;

alter table public.workspace_okr_measurements
alter column reported_on set not null;

update public.workspace_okr_key_results as key_result
set reporting_cadence = 'manual',
    reporting_started_on = greatest(okr.period_start, key_result.created_at::date)
from public.workspace_okrs as okr
where okr.id = key_result.okr_id
  and okr.status in ('completed', 'cancelled')
  and key_result.reporting_cadence is null;

create index if not exists workspace_okr_measurements_reported_on_idx
on public.workspace_okr_measurements(key_result_id, reported_on desc, created_at desc);

create or replace function public.enforce_workspace_okr_definition_lock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if old.status = 'draft' and new.status <> 'draft' then
        if new.status <> 'active' or new.objective_type <> 'committed' then
            raise exception 'Draft OKRs must be committed before they can be closed';
        end if;
        if not exists (
            select 1 from public.workspace_okr_key_results
            where workspace_id = new.workspace_id and okr_id = new.id
        ) then
            raise exception 'Add at least one Key Result before committing';
        end if;
        if exists (
            select 1 from public.workspace_okr_key_results
            where workspace_id = new.workspace_id
              and okr_id = new.id
              and reporting_cadence is null
        ) then
            raise exception 'Choose a reporting cadence for every Key Result before committing';
        end if;
        update public.workspace_okr_key_results
        set reporting_started_on = greatest(new.period_start, current_date)
        where workspace_id = new.workspace_id and okr_id = new.id;
    end if;

    if old.status = 'active' then
        if new.status not in ('active', 'completed', 'cancelled') then
            raise exception 'Committed OKRs cannot return to draft';
        end if;
        if new.workspace_id is distinct from old.workspace_id
           or new.objective is distinct from old.objective
           or new.period_start is distinct from old.period_start
           or new.period_end is distinct from old.period_end
           or new.objective_type is distinct from old.objective_type
           or new.created_by is distinct from old.created_by
           or new.created_at is distinct from old.created_at
           or (new.status = 'active' and new.outcome_note is distinct from old.outcome_note) then
            raise exception 'Committed OKR definitions are locked';
        end if;
    end if;

    if old.status in ('completed', 'cancelled') and (
        new.workspace_id is distinct from old.workspace_id
        or new.status is distinct from old.status
        or new.objective is distinct from old.objective
        or new.description is distinct from old.description
        or new.period_start is distinct from old.period_start
        or new.period_end is distinct from old.period_end
        or new.owner_user_id is distinct from old.owner_user_id
        or new.objective_type is distinct from old.objective_type
        or new.outcome_note is distinct from old.outcome_note
        or new.created_by is distinct from old.created_by
        or new.created_at is distinct from old.created_at
    ) then
        raise exception 'Closed OKRs are read-only';
    end if;

    return new;
end;
$$;

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

    if parent_status = 'draft' then
        if tg_op <> 'DELETE' and new.reporting_cadence is null then
            raise exception 'Choose a reporting cadence for every Key Result';
        end if;
        return case when tg_op = 'DELETE' then old else new end;
    end if;

    if parent_status = 'active' and tg_op = 'UPDATE' then
        if new.workspace_id is distinct from old.workspace_id
           or new.okr_id is distinct from old.okr_id
           or new.name is distinct from old.name
           or new.unit is distinct from old.unit
           or new.currency_code is distinct from old.currency_code
           or new.comparator is distinct from old.comparator
           or new.baseline_value is distinct from old.baseline_value
           or new.target_value is distinct from old.target_value
           or new.sort_order is distinct from old.sort_order then
            raise exception 'Committed Key Result definitions are locked';
        end if;

        if old.reporting_cadence is null and new.reporting_cadence is not null then
            new.reporting_started_on := current_date;
        elsif new.reporting_cadence is distinct from old.reporting_cadence
           or new.reporting_started_on is distinct from old.reporting_started_on then
            raise exception 'Committed Key Result cadence is locked';
        end if;

        return new;
    end if;

    raise exception 'Committed Key Result definitions are locked';
end;
$$;
