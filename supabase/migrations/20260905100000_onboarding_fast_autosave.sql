create or replace function public.save_onboarding_step_draft(
    p_token text,
    p_session_step_id uuid,
    p_response jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_session public.relationship_onboarding_sessions%rowtype;
    v_step public.relationship_onboarding_session_steps%rowtype;
    v_lock_version integer;
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Client onboarding mutations require trusted server access';
    end if;
    if p_response is null or jsonb_typeof(p_response) <> 'object' or pg_column_size(p_response) > 2097152 then
        raise exception using errcode = '22023', message = 'The onboarding draft is invalid or too large';
    end if;

    select * into v_session
    from public.relationship_onboarding_sessions session
    where session.session_token = p_token
      and session.token_revoked_at is null
      and session.status = 'active'
    for key share;
    if v_session.id is null then
        raise exception using errcode = 'P0001', message = 'This onboarding session is no longer writable';
    end if;

    select * into v_step
    from public.relationship_onboarding_session_steps step
    where step.workspace_id = v_session.workspace_id
      and step.session_id = v_session.id
      and step.id = p_session_step_id
      and step.kind = 'form'
      and step.is_actionable
      and step.superseded_at is null
    for key share;
    if v_step.id is null then
        raise exception using errcode = 'P0001', message = 'Your onboarding session was updated. Reload this page to continue.';
    end if;

    if exists (
        select 1
        from jsonb_object_keys(p_response) response_key
        where not exists (
            select 1
            from public.relationship_onboarding_session_fields field
            where field.workspace_id = v_session.workspace_id
              and field.session_step_id = v_step.id
              and (field.id::text = response_key or field.legacy_field_name = response_key)
        )
    ) or exists (
        select 1
        from jsonb_each(p_response) response_field(key, value)
        join public.relationship_onboarding_session_fields field
          on field.workspace_id = v_session.workspace_id
         and field.session_step_id = v_step.id
         and (field.id::text = response_field.key or field.legacy_field_name = response_field.key)
        where (field.type = 'file' and case
                  when jsonb_typeof(response_field.value) <> 'array' then true
                  else jsonb_array_length(response_field.value) > 100
              end)
           or (field.type <> 'file' and (
                  jsonb_typeof(response_field.value) <> 'string'
                  or length(response_field.value #>> '{}') > 100000
              ))
    ) then
        raise exception using errcode = '22023', message = 'The onboarding draft contains invalid fields';
    end if;

    if exists (
        select 1
        from public.work_items item
        where item.workspace_id = v_session.workspace_id
          and item.native_kind = 'onboarding_step'
          and item.status = 'done'
          and (
              item.native_key = v_session.id::text || ':step:' || v_step.id::text
              or (
                  item.metadata->>'session_id' = v_session.id::text
                  and item.metadata->>'session_step_id' = v_step.id::text
              )
          )
    ) then
        raise exception using errcode = 'P0001', message = 'Submitted steps are locked';
    end if;

    if exists (
        select 1
        from public.relationship_onboarding_session_steps earlier_step
        where earlier_step.workspace_id = v_session.workspace_id
          and earlier_step.session_id = v_session.id
          and earlier_step.is_actionable
          and earlier_step.superseded_at is null
          and earlier_step.kind <> 'completion'
          and earlier_step.sort_order < v_step.sort_order
          and not exists (
              select 1
              from public.work_items earlier_work
              where earlier_work.workspace_id = v_session.workspace_id
                and earlier_work.native_kind = 'onboarding_step'
                and earlier_work.status = 'done'
                and (
                    earlier_work.native_key = v_session.id::text || ':step:' || earlier_step.id::text
                    or (
                        earlier_work.metadata->>'session_id' = v_session.id::text
                        and earlier_work.metadata->>'session_step_id' = earlier_step.id::text
                    )
                )
          )
    ) then
        raise exception using errcode = 'P0001', message = 'Complete the earlier onboarding step first.';
    end if;

    insert into public.onboarding_step_drafts (
        workspace_id,
        session_id,
        session_step_id,
        response,
        lock_version
    ) values (
        v_session.workspace_id,
        v_session.id,
        v_step.id,
        p_response,
        1
    )
    on conflict (session_step_id) do update
    set response = excluded.response,
        lock_version = public.onboarding_step_drafts.lock_version + 1,
        updated_at = now()
    returning lock_version into v_lock_version;

    return jsonb_build_object('saved', true, 'lock_version', v_lock_version);
end;
$$;

revoke all on function public.save_onboarding_step_draft(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_onboarding_step_draft(text, uuid, jsonb) to service_role;
