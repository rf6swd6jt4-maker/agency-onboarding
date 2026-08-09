-- One-time reset of the exact OKRs and linked OKR action observed on 2026-08-09.
-- Fixed IDs make this migration idempotent and prevent it from deleting OKRs
-- created after this reset was prepared.
do $$
declare
    target_okr_ids uuid[] := array[
        'b66092a6-eeaa-4c84-8648-e3813c9e38ff'::uuid,
        '16ebc25d-4fa9-4751-a89b-fd7c63b48f0a'::uuid,
        'a6041ac8-4a36-4e17-a6e0-b7f3a8c40890'::uuid,
        '823e2309-d1f0-425a-be79-9f5ee192af4b'::uuid
    ];
    target_work_item_ids uuid[] := array[
        '1692f2c3-3e55-4562-8e66-40875537386f'::uuid
    ];
begin
    -- Fail closed if more work has been linked to these OKRs since the reset
    -- was prepared. That work needs an explicit deletion decision of its own.
    if exists (
        select 1
        from public.workspace_okr_work_items link
        join public.workspace_okr_key_results result on result.id = link.key_result_id
        where result.okr_id = any(target_okr_ids)
          and not (link.work_item_id = any(target_work_item_ids))
    ) then
        raise exception 'The target OKRs now contain additional linked work; review the reset migration before running it';
    end if;

    -- The snapshotted work was a private Admin OKR action. Do not delete it if
    -- it has since been repurposed or connected to non-OKR workspace records.
    if exists (
        select 1
        from public.work_items item
        where item.id = any(target_work_item_ids)
          and (item.area is distinct from 'admin' or item.kind is distinct from 'okr_action' or item.visibility is distinct from 'admins_only')
    ) then
        raise exception 'A target work item is no longer a private Admin OKR action';
    end if;

    if exists (
        select 1 from public.work_item_relationships link
        where link.work_item_id = any(target_work_item_ids)
    ) or exists (
        select 1 from public.asset_work_items link
        where link.work_item_id = any(target_work_item_ids)
    ) then
        raise exception 'A target work item is now linked to a relationship or asset';
    end if;

    if exists (
        select 1
        from public.workspace_okr_work_items link
        join public.workspace_okr_key_results result on result.id = link.key_result_id
        where link.work_item_id = any(target_work_item_ids)
          and not (result.okr_id = any(target_okr_ids))
    ) then
        raise exception 'A target work item is now linked to an OKR outside this reset';
    end if;

    -- Committed KR definitions normally reject deletion. Suspend only that
    -- trigger for this atomic reset and restore it even if either delete fails.
    execute 'alter table public.workspace_okr_key_results disable trigger enforce_draft_okr_key_result_definition';
    begin
        -- Key Results, measurements, and OKR-work links cascade from the OKRs.
        delete from public.workspace_okrs
        where id = any(target_okr_ids);

        -- Work-item assignees, dependencies, and other work-owned rows cascade
        -- from the exact work item that was linked only to the deleted OKRs.
        delete from public.work_items
        where id = any(target_work_item_ids);
    exception when others then
        execute 'alter table public.workspace_okr_key_results enable trigger enforce_draft_okr_key_result_definition';
        raise;
    end;
    execute 'alter table public.workspace_okr_key_results enable trigger enforce_draft_okr_key_result_definition';

    if exists (select 1 from public.workspace_okrs where id = any(target_okr_ids))
       or exists (select 1 from public.work_items where id = any(target_work_item_ids)) then
        raise exception 'The OKR test-data reset did not complete';
    end if;
end;
$$;
