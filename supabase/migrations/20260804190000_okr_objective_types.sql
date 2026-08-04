alter table public.workspace_okrs
add column if not exists objective text;

alter table public.workspace_okrs
add column if not exists objective_type text not null default 'committed';

update public.workspace_okrs
set objective = title
where objective is null;

alter table public.workspace_okrs
alter column objective set not null;

alter table public.workspace_okrs
drop constraint if exists workspace_okrs_objective_type_check;

alter table public.workspace_okrs
add constraint workspace_okrs_objective_type_check
check (objective_type in ('aspirational', 'committed'));

create or replace function public.sync_workspace_okr_system_title()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    -- Keep the pre-objective column as a compatibility mirror while older builds drain.
    if new.objective is null then new.objective := new.title; end if;
    new.title := initcap(new.objective_type) || ' Objective: ' || new.objective || ' by ' || to_char(new.period_end, 'FMDD Mon YYYY');
    return new;
end;
$$;

drop trigger if exists sync_workspace_okr_system_title on public.workspace_okrs;
create trigger sync_workspace_okr_system_title
before insert or update of objective, objective_type, period_end, title on public.workspace_okrs
for each row execute function public.sync_workspace_okr_system_title();

update public.workspace_okrs
set title = title;

