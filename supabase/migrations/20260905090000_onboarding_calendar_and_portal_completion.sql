-- Add a reusable date-and-time response block to visual onboarding and keep
-- portal provisioning in the trusted service-role context that completes the
-- public onboarding session.

alter table public.relationship_onboarding_session_blocks
    drop constraint if exists relationship_onboarding_session_blocks_kind_check;
alter table public.relationship_onboarding_session_blocks
    add constraint relationship_onboarding_session_blocks_kind_check
    check (kind in ('header', 'estimate', 'form', 'video', 'button', 'checklist', 'calendar', 'connection', 'appointment_medium', 'appointment_fields'));

alter table public.onboarding_block_requirements
    drop constraint if exists onboarding_block_requirements_requirement_kind_check;
alter table public.onboarding_block_requirements
    add constraint onboarding_block_requirements_requirement_kind_check
    check (requirement_kind in ('button_opened', 'video_finished', 'calendar_scheduled', 'meta_ads_connected', 'appointment_medium_configured', 'appointment_fields_configured'));

create or replace function public.require_connection_onboarding_block()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
    if new.kind in ('calendar', 'connection', 'appointment_medium', 'appointment_fields') then new.required := true; end if;
    return new;
end;
$$;

create or replace function public.validate_onboarding_module_definition(p_definition jsonb)
returns void
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
    v_step jsonb;
    v_field jsonb;
    v_block jsonb;
    v_step_ids uuid[] := '{}'::uuid[];
    v_block_ids uuid[];
    v_field_ids uuid[];
    v_id uuid;
    v_header_count integer;
    v_estimate_count integer;
    v_form_count integer;
    v_checklist_count integer;
    v_video_count integer;
    v_button_count integer;
    v_calendar_count integer;
    v_connection_count integer;
    v_medium_count integer;
    v_appointment_fields_count integer;
begin
    if jsonb_typeof(p_definition) <> 'object' or nullif(trim(p_definition->>'name'), '') is null then raise exception 'Give this module a name before publishing'; end if;
    if jsonb_typeof(p_definition->'steps') <> 'array' or jsonb_array_length(p_definition->'steps') = 0 then raise exception 'A module must contain at least one step'; end if;
    for v_step in select value from jsonb_array_elements(p_definition->'steps') loop
        begin v_id := (v_step->>'id')::uuid; exception when others then raise exception 'Every step requires a stable UUID'; end;
        if v_id = any(v_step_ids) then raise exception 'Step IDs must be unique within a module'; end if;
        v_step_ids := array_append(v_step_ids, v_id);
        if coalesce((p_definition->>'schemaVersion')::integer, 1) = 2 then
            if jsonb_typeof(v_step->'blocks') <> 'array' or jsonb_array_length(v_step->'blocks') = 0 then raise exception 'Every visual onboarding step requires blocks'; end if;
            v_header_count := 0; v_estimate_count := 0; v_form_count := 0; v_checklist_count := 0;
            v_video_count := 0; v_button_count := 0; v_calendar_count := 0; v_connection_count := 0; v_medium_count := 0;
            v_appointment_fields_count := 0; v_block_ids := '{}'::uuid[];
            for v_block in select value from jsonb_array_elements(v_step->'blocks') with ordinality order by ordinality loop
                begin v_id := (v_block->>'id')::uuid; exception when others then raise exception 'Every onboarding block requires a stable UUID'; end;
                if v_id = any(v_block_ids) then raise exception 'Block IDs must be unique within a step'; end if;
                v_block_ids := array_append(v_block_ids, v_id);
                if v_block->>'kind' not in ('header', 'estimate', 'form', 'checklist', 'video', 'button', 'calendar', 'connection', 'appointment_medium', 'appointment_fields') then raise exception 'Unknown onboarding block type'; end if;
                if v_block->>'kind' = 'header' then
                    v_header_count := v_header_count + 1;
                    if v_header_count <> 1 or v_block <> (v_step->'blocks')->0 then raise exception 'The Header must be the first block in every step'; end if;
                    if nullif(trim(v_block->>'title'), '') is null then raise exception 'Every step requires a title'; end if;
                elsif v_block->>'kind' = 'estimate' then
                    v_estimate_count := v_estimate_count + 1;
                    if v_estimate_count > 1 then raise exception 'A step may contain only one Estimated time block'; end if;
                elsif v_block->>'kind' = 'form' then
                    v_form_count := v_form_count + 1;
                    if v_form_count > 1 then raise exception 'A step may contain only one Form block'; end if;
                    if jsonb_typeof(v_block->'fields') <> 'array' then raise exception 'Form blocks require a fields array'; end if;
                    v_field_ids := '{}'::uuid[];
                    for v_field in select value from jsonb_array_elements(v_block->'fields') loop
                        begin v_id := (v_field->>'id')::uuid; exception when others then raise exception 'Every field requires a stable UUID'; end;
                        if v_id = any(v_field_ids) then raise exception 'Field IDs must be unique within a Form block'; end if;
                        v_field_ids := array_append(v_field_ids, v_id);
                        if nullif(trim(v_field->>'label'), '') is null then raise exception 'Every field requires a label'; end if;
                        if v_field->>'type' not in ('text','email','tel','url','textarea','file') then raise exception 'Unknown onboarding field type'; end if;
                    end loop;
                elsif v_block->>'kind' = 'checklist' then
                    v_checklist_count := v_checklist_count + 1;
                    if v_checklist_count > 1 then raise exception 'A step may contain only one Checklist block'; end if;
                    if coalesce(v_block->>'source', 'custom') not in ('custom', 'modules') then raise exception 'Unknown checklist source'; end if;
                    if jsonb_typeof(coalesce(v_block->'items', '[]'::jsonb)) <> 'array' then raise exception 'Checklist blocks require an items array'; end if;
                elsif v_block->>'kind' = 'video' then
                    v_video_count := v_video_count + 1;
                    if v_video_count > 1 then raise exception 'A step may contain only one Video block'; end if;
                    if nullif(v_block#>>'{upload,path}', '') is null then raise exception 'Upload every video before publishing'; end if;
                    if nullif(v_block->>'legacyEmbedUrl', '') is not null then raise exception 'Replace embedded videos with workspace uploads before publishing'; end if;
                    if coalesce(v_block->>'requirement', 'none') not in ('none','finish') then raise exception 'Unknown video requirement'; end if;
                elsif v_block->>'kind' = 'button' then
                    v_button_count := v_button_count + 1;
                    if v_button_count > 1 then raise exception 'A step may contain only one Button block'; end if;
                    if nullif(trim(v_block->>'label'), '') is null then raise exception 'Every button requires a label'; end if;
                    if coalesce(v_block->>'url', '') !~ '^https://' then raise exception 'Buttons require a secure HTTPS URL'; end if;
                elsif v_block->>'kind' = 'calendar' then
                    v_calendar_count := v_calendar_count + 1;
                    if v_calendar_count > 1 then raise exception 'A step may contain only one Calendar block'; end if;
                    if nullif(trim(v_block->>'title'), '') is null then raise exception 'Every Calendar block requires a heading'; end if;
                    if nullif(trim(v_block->>'timeLabel'), '') is null then raise exception 'Every Calendar block requires a time label'; end if;
                    if coalesce((v_block->>'required')::boolean, false) is not true then raise exception 'Calendar blocks must be required'; end if;
                elsif v_block->>'kind' = 'connection' then
                    v_connection_count := v_connection_count + 1;
                    if v_connection_count > 1 then raise exception 'A step may contain only one Connection block'; end if;
                    if v_block->>'provider' <> 'meta_ads' then raise exception 'Unknown onboarding connection provider'; end if;
                    if nullif(trim(v_block->>'label'), '') is null then raise exception 'Every connection requires a button label'; end if;
                elsif v_block->>'kind' = 'appointment_medium' then
                    v_medium_count := v_medium_count + 1;
                    if v_medium_count > 1 then raise exception 'A step may contain only one Appointment medium block'; end if;
                    if jsonb_typeof(v_block->'options') <> 'array' or jsonb_array_length(v_block->'options') = 0 then raise exception 'Appointment medium requires at least one option'; end if;
                    if exists (select 1 from jsonb_array_elements_text(v_block->'options') option where option not in ('phone', 'google_meet', 'zoom')) then raise exception 'Unknown appointment medium'; end if;
                elsif v_block->>'kind' = 'appointment_fields' then
                    v_appointment_fields_count := v_appointment_fields_count + 1;
                    if v_appointment_fields_count > 1 then raise exception 'A step may contain only one Appointment information block'; end if;
                    if jsonb_typeof(v_block->'options') <> 'array' then raise exception 'Appointment information requires an options array'; end if;
                    if coalesce((v_block->>'maximumFields')::integer, 0) not between 1 and 4 then raise exception 'Appointment information supports one to four extra fields'; end if;
                    if exists (select 1 from jsonb_array_elements_text(v_block->'options') option where option not in ('phone', 'email', 'service', 'address', 'notes')) then raise exception 'Unknown appointment information field'; end if;
                end if;
            end loop;
            if v_header_count <> 1 then raise exception 'Every step requires exactly one Header block'; end if;
            if v_estimate_count <> 1 then raise exception 'Every step requires exactly one Estimated time block'; end if;
        else
            if nullif(trim(v_step->>'title'), '') is null then raise exception 'Every step requires a title'; end if;
            if coalesce(v_step->>'kind', '') not in ('form', 'video') then raise exception 'Unknown onboarding step type'; end if;
        end if;
        if coalesce(v_step->>'kind', '') not in ('form', 'video') then raise exception 'Every step requires a compatibility kind'; end if;
        if v_step->>'kind' = 'form' and jsonb_typeof(v_step->'fields') <> 'array' then raise exception 'Form steps require a fields array'; end if;
    end loop;
end;
$$;

create or replace function public.submit_onboarding_calendar_block(
    p_token text,
    p_session_block_id uuid,
    p_local_date date,
    p_local_time time without time zone,
    p_timezone text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_block public.relationship_onboarding_session_blocks%rowtype;
    v_starts_at timestamptz;
    v_response jsonb;
begin
    if current_user <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted onboarding runtime required'; end if;
    if p_local_date is null or p_local_time is null then raise exception using errcode = '22023', message = 'Choose a date and time.'; end if;
    if nullif(trim(p_timezone), '') is null or char_length(p_timezone) > 100 or not exists (
        select 1 from pg_timezone_names where name = p_timezone
    ) then raise exception using errcode = '22023', message = 'Your timezone could not be recognised. Refresh the page and try again.'; end if;

    select block.* into v_block
    from public.relationship_onboarding_session_blocks block
    join public.relationship_onboarding_sessions session
      on session.id = block.session_id and session.workspace_id = block.workspace_id
    where block.id = p_session_block_id
      and session.session_token = p_token
      and session.status = 'active'
    for update of block;

    if v_block.id is null or v_block.kind <> 'calendar' or not v_block.required then
        raise exception using errcode = 'P0001', message = 'Calendar block not found.';
    end if;
    if exists (
        select 1 from public.work_items item
        where item.workspace_id = v_block.workspace_id
          and item.native_kind = 'onboarding_step'
          and item.metadata->>'session_step_id' = v_block.session_step_id::text
          and item.status = 'done'
    ) then raise exception using errcode = 'P0001', message = 'Submitted steps are locked'; end if;

    v_starts_at := (p_local_date + p_local_time) at time zone p_timezone;
    if v_starts_at <= now() then raise exception using errcode = '22023', message = 'Choose a future date and time.'; end if;
    v_response := jsonb_build_object(
        'date', to_char(p_local_date, 'YYYY-MM-DD'),
        'time', to_char(p_local_time, 'HH24:MI'),
        'timezone', p_timezone,
        'startsAt', v_starts_at
    );

    insert into public.onboarding_block_requirements (
        workspace_id, session_id, session_step_id, session_block_id, requirement_kind, response, satisfied_at
    ) values (
        v_block.workspace_id, v_block.session_id, v_block.session_step_id, v_block.id, 'calendar_scheduled', v_response, now()
    )
    on conflict (session_block_id) do update set
        requirement_kind = excluded.requirement_kind,
        response = excluded.response,
        satisfied_at = now();

    return jsonb_build_object('session_block_id', v_block.id, 'satisfied', true, 'response', v_response);
end;
$$;

revoke all on function public.submit_onboarding_calendar_block(text, uuid, date, time without time zone, text) from public, anon, authenticated;
grant execute on function public.submit_onboarding_calendar_block(text, uuid, date, time without time zone, text) to service_role;

create or replace function public.provision_client_portal_after_onboarding()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
    portal_session public.client_portal_sessions%rowtype;
    relationship_record public.relationships%rowtype;
    delivery_outbox_id uuid;
begin
    if new.status <> 'completed' or old.status = 'completed' then return new; end if;

    insert into public.client_portal_sessions (
        workspace_id, relationship_id, onboarding_session_id, session_token
    ) values (
        new.workspace_id,
        new.relationship_id,
        new.id,
        encode(extensions.gen_random_bytes(32), 'hex')
    )
    on conflict (workspace_id, relationship_id) do update set
        onboarding_session_id = excluded.onboarding_session_id,
        session_token = case
            when public.client_portal_sessions.status = 'revoked' then excluded.session_token
            else public.client_portal_sessions.session_token
        end,
        status = 'active',
        token_revoked_at = null,
        updated_at = now()
    returning * into portal_session;

    select * into relationship_record
    from public.relationships
    where workspace_id = new.workspace_id and id = new.relationship_id;

    insert into public.onboarding_delivery_outbox (
        workspace_id,
        relationship_id,
        session_id,
        portal_session_id,
        correlation_id,
        kind,
        destination,
        payload,
        idempotency_key
    ) values (
        new.workspace_id,
        new.relationship_id,
        new.id,
        portal_session.id,
        coalesce(new.source_sale_id, new.id),
        'client_portal_link',
        coalesce(nullif(trim(relationship_record.primary_phone), ''), 'relationship:' || new.relationship_id::text),
        jsonb_build_object(
            'client_id', relationship_record.client_id,
            'message', 'Your client portal is ready.'
        ),
        'client-portal-link:' || new.id::text
    )
    on conflict (workspace_id, idempotency_key) do nothing
    returning id into delivery_outbox_id;

    if delivery_outbox_id is not null then
        perform public.record_workspace_admin_activity(
            new.workspace_id,
            'communications',
            'client_portal.link.queued',
            'Client portal link queued for delivery',
            p_entity_type => 'client_portal_session',
            p_entity_id => portal_session.id::text,
            p_actor_kind => 'automation',
            p_correlation_id => coalesce(new.source_sale_id, new.id),
            p_idempotency_key => 'client_portal.link.queued:' || delivery_outbox_id::text,
            p_metadata => jsonb_build_object(
                'outbox_id', delivery_outbox_id,
                'relationship_id', new.relationship_id,
                'onboarding_session_id', new.id,
                'portal_session_id', portal_session.id
            )
        );
    end if;

    return new;
end;
$$;
