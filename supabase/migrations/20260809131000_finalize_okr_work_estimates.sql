-- The legacy OKR links have now been removed. Finish the transition from the
-- compatibility phase by validating the checks and making both forecast fields
-- structurally mandatory.
alter table public.workspace_okr_work_items
validate constraint workspace_okr_work_items_expected_movement_check;

alter table public.workspace_okr_work_items
validate constraint workspace_okr_work_items_impact_hypothesis_check;

alter table public.workspace_okr_work_items
alter column expected_movement set not null,
alter column impact_hypothesis set not null;
