alter table public.work_items
add column if not exists priority_override integer;

alter table public.work_items
drop constraint if exists work_items_priority_override_check;

alter table public.work_items
add constraint work_items_priority_override_check
check (priority_override is null or priority_override between 1 and 4);

comment on column public.work_items.priority_override is
'Optional user-set timing priority. Null means the queue uses its system-generated priority; values 1 through 4 are explicit manual overrides.';

create index if not exists work_items_admin_priority_override_idx
on public.work_items(workspace_id, area, visibility, priority_override)
where status not in ('done', 'canceled');
