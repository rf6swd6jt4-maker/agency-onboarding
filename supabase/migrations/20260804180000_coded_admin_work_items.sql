create or replace function public.upsert_platform_failure_work_item(
    p_workspace_id uuid,
    p_category text,
    p_source text,
    p_operation text,
    p_fingerprint text,
    p_severity text,
    p_summary text,
    p_diagnostics jsonb,
    p_occurred_at timestamptz,
    p_source_href text
)
returns table(work_item_id uuid, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_error_code text := coalesce(nullif(p_diagnostics->>'error_code', ''), 'BGE-9006');
    v_error_name text := coalesce(nullif(p_diagnostics->>'error_name', ''), 'Platform operation failure');
begin
    return query
    insert into public.work_items (
        workspace_id, title, description, lifecycle_phase, status, priority, is_key_task,
        native_kind, native_href, area, kind, visibility, maintenance_category, severity,
        failure_fingerprint, occurrence_count, first_occurred_at, last_occurred_at, metadata
    ) values (
        p_workspace_id,
        format('Bug: %s - %s', v_error_code, v_error_name),
        'Admin work: ' || p_summary,
        null, 'todo',
        case when p_severity = 'critical' then 1 else 2 end, true,
        'platform_failure', p_source_href, 'admin', 'maintenance', 'admins_only', p_category,
        p_severity, p_fingerprint, 1, p_occurred_at, p_occurred_at,
        jsonb_build_object(
            'source', p_source,
            'operation', p_operation,
            'error_code', v_error_code,
            'error_name', v_error_name,
            'latest_diagnostics', coalesce(p_diagnostics, '{}'::jsonb),
            'latest_occurred_at', p_occurred_at
        )
    )
    on conflict (workspace_id, failure_fingerprint)
    where kind = 'maintenance' and failure_fingerprint is not null and status not in ('done', 'canceled')
    do update set
        title = excluded.title,
        description = excluded.description,
        severity = case when public.work_items.severity = 'critical' or excluded.severity = 'critical' then 'critical' else 'warning' end,
        priority = least(public.work_items.priority, excluded.priority),
        occurrence_count = public.work_items.occurrence_count + 1,
        last_occurred_at = excluded.last_occurred_at,
        native_href = coalesce(excluded.native_href, public.work_items.native_href),
        metadata = coalesce(public.work_items.metadata, '{}'::jsonb) || excluded.metadata
    returning id, (xmax = 0);
end;
$$;

revoke all on function public.upsert_platform_failure_work_item(uuid, text, text, text, text, text, text, jsonb, timestamptz, text) from public;
grant execute on function public.upsert_platform_failure_work_item(uuid, text, text, text, text, text, text, jsonb, timestamptz, text) to service_role;

update public.work_items
set
    title = 'Bug: BGE-9998 - Previously reported platform failure',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'error_code', 'BGE-9998',
        'error_name', 'Previously reported platform failure'
    )
where area = 'admin'
  and kind = 'maintenance'
  and title not like 'Bug: BGE-%';

update public.work_items
set description = 'Admin work: ' || coalesce(nullif(description, ''), title)
where area = 'admin'
  and coalesce(description, '') not like 'Admin work:%';
