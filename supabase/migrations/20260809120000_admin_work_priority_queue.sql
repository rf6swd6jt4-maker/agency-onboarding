alter table public.workspace_okr_work_items
add column if not exists expected_movement numeric,
add column if not exists impact_hypothesis text;

comment on column public.workspace_okr_work_items.expected_movement is
'Positive expected movement toward the linked Key Result target. This is a forecast and never updates actual measurements.';

comment on column public.workspace_okr_work_items.impact_hypothesis is
'Short explanation of why completing the work is expected to move the linked Key Result.';

alter table public.workspace_okr_work_items
drop constraint if exists workspace_okr_work_items_expected_movement_check;
alter table public.workspace_okr_work_items
add constraint workspace_okr_work_items_expected_movement_check
check (expected_movement is not null and expected_movement > 0) not valid;

alter table public.workspace_okr_work_items
drop constraint if exists workspace_okr_work_items_impact_hypothesis_check;
alter table public.workspace_okr_work_items
add constraint workspace_okr_work_items_impact_hypothesis_check
check (impact_hypothesis is not null and nullif(btrim(impact_hypothesis), '') is not null) not valid;

create or replace function public.validate_workspace_okr_work_estimate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.expected_movement is null or new.expected_movement <= 0 then
        raise exception 'Linked OKR work requires a positive expected movement';
    end if;
    if nullif(btrim(new.impact_hypothesis), '') is null then
        raise exception 'Linked OKR work requires an impact hypothesis';
    end if;
    new.impact_hypothesis := btrim(new.impact_hypothesis);
    return new;
end;
$$;

drop trigger if exists validate_workspace_okr_work_estimate on public.workspace_okr_work_items;
create trigger validate_workspace_okr_work_estimate
before insert or update of expected_movement, impact_hypothesis
on public.workspace_okr_work_items
for each row execute function public.validate_workspace_okr_work_estimate();

create index if not exists workspace_okr_work_items_queue_idx
on public.workspace_okr_work_items(workspace_id, work_item_id, key_result_id);
