alter table public.workspace_okrs
add column if not exists is_test boolean not null default false;

comment on column public.workspace_okrs.is_test is
'Display-only Test marker. It does not change OKR lifecycle or calculation behaviour.';

create or replace function public.enforce_workspace_okr_test_mode_lock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if old.status <> 'draft' and new.is_test is distinct from old.is_test then
        raise exception 'Committed OKR Test mode is locked';
    end if;
    return new;
end;
$$;

drop trigger if exists enforce_workspace_okr_test_mode_lock on public.workspace_okrs;
create trigger enforce_workspace_okr_test_mode_lock
before update of is_test on public.workspace_okrs
for each row execute function public.enforce_workspace_okr_test_mode_lock();
