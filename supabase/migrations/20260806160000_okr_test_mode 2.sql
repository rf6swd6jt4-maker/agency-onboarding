alter table public.workspace_okrs
add column if not exists is_test boolean not null default false;

comment on column public.workspace_okrs.is_test is
'Display-only Test marker. It does not change OKR lifecycle or calculation behaviour.';

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
           or new.is_test is distinct from old.is_test
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
        or new.is_test is distinct from old.is_test
        or new.outcome_note is distinct from old.outcome_note
        or new.created_by is distinct from old.created_by
        or new.created_at is distinct from old.created_at
    ) then
        raise exception 'Closed OKRs are read-only';
    end if;

    return new;
end;
$$;
