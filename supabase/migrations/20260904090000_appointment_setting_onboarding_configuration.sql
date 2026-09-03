-- Relationship-specific Appointment Setting preferences are collected during
-- onboarding and become the schema enforced by the native setter table.

alter table public.relationship_onboarding_session_blocks
    drop constraint if exists relationship_onboarding_session_blocks_kind_check;
alter table public.relationship_onboarding_session_blocks
    add constraint relationship_onboarding_session_blocks_kind_check
    check (kind in ('header', 'estimate', 'form', 'video', 'button', 'checklist', 'connection', 'appointment_medium', 'appointment_fields'));

alter table public.onboarding_block_requirements
    add column if not exists response jsonb not null default '{}'::jsonb
        check (jsonb_typeof(response) = 'object');
alter table public.onboarding_block_requirements
    drop constraint if exists onboarding_block_requirements_requirement_kind_check;
alter table public.onboarding_block_requirements
    add constraint onboarding_block_requirements_requirement_kind_check
    check (requirement_kind in ('button_opened', 'video_finished', 'meta_ads_connected', 'appointment_medium_configured', 'appointment_fields_configured'));

create or replace function public.require_connection_onboarding_block()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
    if new.kind in ('connection', 'appointment_medium', 'appointment_fields') then new.required := true; end if;
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
            v_video_count := 0; v_button_count := 0; v_connection_count := 0; v_medium_count := 0;
            v_appointment_fields_count := 0; v_block_ids := '{}'::uuid[];
            for v_block in select value from jsonb_array_elements(v_step->'blocks') with ordinality order by ordinality loop
                begin v_id := (v_block->>'id')::uuid; exception when others then raise exception 'Every onboarding block requires a stable UUID'; end;
                if v_id = any(v_block_ids) then raise exception 'Block IDs must be unique within a step'; end if;
                v_block_ids := array_append(v_block_ids, v_id);
                if v_block->>'kind' not in ('header', 'estimate', 'form', 'checklist', 'video', 'button', 'connection', 'appointment_medium', 'appointment_fields') then raise exception 'Unknown onboarding block type'; end if;
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

create table if not exists public.relationship_appointment_setting_configs (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null,
    service_id uuid not null,
    mediums text[] not null default array['phone']::text[] check (cardinality(mediums) between 1 and 3 and mediums <@ array['phone','google_meet','zoom']::text[]),
    requested_fields jsonb not null default '[{"key":"phone","required":true}]'::jsonb check (jsonb_typeof(requested_fields) = 'array' and jsonb_array_length(requested_fields) <= 4),
    source_medium_block_id uuid,
    source_fields_block_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (workspace_id, relationship_id, service_id),
    foreign key (workspace_id, relationship_id) references public.relationships(workspace_id, id) on delete cascade,
    foreign key (workspace_id, service_id) references public.onboarding_services(workspace_id, id) on delete cascade,
    foreign key (source_medium_block_id) references public.relationship_onboarding_session_blocks(id) on delete set null,
    foreign key (source_fields_block_id) references public.relationship_onboarding_session_blocks(id) on delete set null
);

drop trigger if exists relationship_appointment_setting_configs_updated_at on public.relationship_appointment_setting_configs;
create trigger relationship_appointment_setting_configs_updated_at before update on public.relationship_appointment_setting_configs
for each row execute function public.set_updated_at();

alter table public.relationship_appointment_setting_configs enable row level security;
drop policy if exists "assigned appointment setting users read configuration" on public.relationship_appointment_setting_configs;
create policy "assigned appointment setting users read configuration"
on public.relationship_appointment_setting_configs for select to authenticated
using (public.workspace_user_can_manage_appointment_setting(workspace_id, relationship_id, service_id));

alter table public.appointment_setting_appointments
    alter column phone drop not null,
    add column if not exists meeting_medium text not null default 'phone',
    add column if not exists meeting_link text,
    add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.appointment_setting_appointments drop constraint if exists appointment_setting_appointments_phone_check;
alter table public.appointment_setting_appointments add constraint appointment_setting_appointments_phone_check check (phone is null or char_length(btrim(phone)) between 1 and 64);
alter table public.appointment_setting_appointments add constraint appointment_setting_appointments_meeting_medium_check check (meeting_medium in ('phone', 'google_meet', 'zoom'));
alter table public.appointment_setting_appointments add constraint appointment_setting_appointments_meeting_link_check check (meeting_link is null or meeting_link ~ '^https://');
alter table public.appointment_setting_appointments add constraint appointment_setting_appointments_remote_link_check check (meeting_medium = 'phone' or meeting_link is not null);
alter table public.appointment_setting_appointments add constraint appointment_setting_appointments_details_check check (jsonb_typeof(details) = 'object');

create or replace function public.validate_appointment_setting_appointment_configuration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_config public.relationship_appointment_setting_configs%rowtype;
    v_field jsonb;
    v_value text;
begin
    select config.* into v_config from public.relationship_appointment_setting_configs config
    where config.workspace_id = new.workspace_id and config.relationship_id = new.relationship_id and config.service_id = new.service_id;
    if v_config.workspace_id is null then
        if new.meeting_medium <> 'phone' or nullif(btrim(coalesce(new.phone, '')), '') is null then
            raise exception using errcode = '23514', message = 'Appointment does not match the client configuration.';
        end if;
        return new;
    end if;
    if not (new.meeting_medium = any(v_config.mediums)) then raise exception using errcode = '23514', message = 'Appointment medium is not available for this client.'; end if;
    for v_field in select value from jsonb_array_elements(v_config.requested_fields) loop
        if coalesce((v_field->>'required')::boolean, false) then
            v_value := case when v_field->>'key' = 'phone' then new.phone else new.details->>(v_field->>'key') end;
            if nullif(btrim(coalesce(v_value, '')), '') is null then raise exception using errcode = '23514', message = 'Appointment is missing required client information.'; end if;
        end if;
    end loop;
    return new;
end;
$$;

drop trigger if exists validate_appointment_setting_appointment_configuration on public.appointment_setting_appointments;
create trigger validate_appointment_setting_appointment_configuration
before insert or update of workspace_id, relationship_id, service_id, phone, meeting_medium, meeting_link, details
on public.appointment_setting_appointments
for each row execute function public.validate_appointment_setting_appointment_configuration();

create or replace function public.configure_appointment_setting_onboarding_block(
    p_token text,
    p_session_block_id uuid,
    p_configuration jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_block public.relationship_onboarding_session_blocks%rowtype;
    v_session public.relationship_onboarding_sessions%rowtype;
    v_service_id uuid;
    v_item jsonb;
    v_key text;
    v_seen text[] := '{}'::text[];
    v_values text[] := '{}'::text[];
    v_requirement_kind text;
begin
    if current_user <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted onboarding runtime required'; end if;
    select block.* into v_block
    from public.relationship_onboarding_session_blocks block
    join public.relationship_onboarding_sessions session on session.id = block.session_id and session.workspace_id = block.workspace_id
    where block.id = p_session_block_id and session.session_token = p_token and session.status = 'active'
    for update of block;
    if v_block.id is null or v_block.kind not in ('appointment_medium', 'appointment_fields') then raise exception using errcode = 'P0001', message = 'Appointment Setting onboarding block not found.'; end if;
    select session.* into v_session from public.relationship_onboarding_sessions session where session.workspace_id = v_block.workspace_id and session.id = v_block.session_id;
    if exists (select 1 from public.work_items item where item.workspace_id = v_block.workspace_id and item.native_kind = 'onboarding_step' and item.metadata->>'session_step_id' = v_block.session_step_id::text and item.status = 'done') then raise exception using errcode = 'P0001', message = 'Submitted steps are locked.'; end if;
    select relationship_service.service_id into v_service_id
    from public.relationship_services relationship_service
    join public.onboarding_service_revisions revision on revision.workspace_id = relationship_service.workspace_id and revision.id = relationship_service.service_revision_id
    where relationship_service.workspace_id = v_block.workspace_id
      and relationship_service.relationship_id = v_session.relationship_id
      and coalesce(revision.definition->>'templateId', revision.definition->>'template_id') = 'appointment-setting'
    order by relationship_service.created_at
    limit 1;
    if v_service_id is null then raise exception using errcode = 'P0001', message = 'This relationship does not include Appointment Setting.'; end if;

    if v_block.kind = 'appointment_medium' then
        if jsonb_typeof(p_configuration->'mediums') <> 'array' or jsonb_array_length(p_configuration->'mediums') not between 1 and 3 then raise exception using errcode = '22023', message = 'Choose at least one appointment option.'; end if;
        for v_key in select value from jsonb_array_elements_text(p_configuration->'mediums') loop
            if v_key not in ('phone', 'google_meet', 'zoom') or not coalesce(v_block.definition->'options' ? v_key, false) or v_key = any(v_seen) then raise exception using errcode = '22023', message = 'Choose valid appointment options.'; end if;
            v_seen := array_append(v_seen, v_key); v_values := array_append(v_values, v_key);
        end loop;
        insert into public.relationship_appointment_setting_configs (workspace_id, relationship_id, service_id, mediums, source_medium_block_id)
        values (v_block.workspace_id, v_session.relationship_id, v_service_id, v_values, v_block.id)
        on conflict (workspace_id, relationship_id, service_id) do update set mediums = excluded.mediums, source_medium_block_id = excluded.source_medium_block_id;
        v_requirement_kind := 'appointment_medium_configured';
    else
        if jsonb_typeof(p_configuration->'fields') <> 'array' or jsonb_array_length(p_configuration->'fields') > least(4, coalesce((v_block.definition->>'maximumFields')::integer, 4)) then raise exception using errcode = '22023', message = 'Choose fewer extra fields.'; end if;
        for v_item in select value from jsonb_array_elements(p_configuration->'fields') loop
            v_key := v_item->>'key';
            if jsonb_typeof(v_item) <> 'object' or v_key is null or v_key not in ('phone', 'email', 'service', 'address', 'notes') or not coalesce(v_block.definition->'options' ? v_key, false) or v_key = any(v_seen) or jsonb_typeof(v_item->'required') <> 'boolean' then raise exception using errcode = '22023', message = 'Choose valid appointment fields.'; end if;
            v_seen := array_append(v_seen, v_key);
        end loop;
        insert into public.relationship_appointment_setting_configs (workspace_id, relationship_id, service_id, requested_fields, source_fields_block_id)
        values (v_block.workspace_id, v_session.relationship_id, v_service_id, p_configuration->'fields', v_block.id)
        on conflict (workspace_id, relationship_id, service_id) do update set requested_fields = excluded.requested_fields, source_fields_block_id = excluded.source_fields_block_id;
        v_requirement_kind := 'appointment_fields_configured';
    end if;

    insert into public.onboarding_block_requirements (workspace_id, session_id, session_step_id, session_block_id, requirement_kind, response, satisfied_at)
    values (v_block.workspace_id, v_block.session_id, v_block.session_step_id, v_block.id, v_requirement_kind, p_configuration, now())
    on conflict (session_block_id) do update set requirement_kind = excluded.requirement_kind, response = excluded.response, satisfied_at = now();
    return jsonb_build_object('session_block_id', v_block.id, 'satisfied', true, 'response', p_configuration);
end;
$$;

create or replace function public.satisfy_onboarding_block_requirement(
    p_token text,
    p_session_block_id uuid,
    p_requirement_kind text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare v_block public.relationship_onboarding_session_blocks%rowtype;
begin
    if current_user <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted onboarding runtime required'; end if;
    select block.* into v_block
    from public.relationship_onboarding_session_blocks block
    join public.relationship_onboarding_sessions session on session.id = block.session_id and session.workspace_id = block.workspace_id
    where block.id = p_session_block_id and session.session_token = p_token and session.status = 'active'
    for update of block;
    if v_block.id is null or not v_block.required then raise exception using errcode = 'P0001', message = 'Required onboarding block not found.'; end if;
    if not ((v_block.kind = 'video' and p_requirement_kind = 'video_finished') or (v_block.kind = 'button' and p_requirement_kind = 'button_opened')) then
        raise exception using errcode = 'P0001', message = 'The onboarding requirement does not match this block.';
    end if;
    insert into public.onboarding_block_requirements (workspace_id, session_id, session_step_id, session_block_id, requirement_kind)
    values (v_block.workspace_id, v_block.session_id, v_block.session_step_id, v_block.id, p_requirement_kind)
    on conflict (session_block_id) do update set satisfied_at = onboarding_block_requirements.satisfied_at;
    return jsonb_build_object('session_block_id', v_block.id, 'satisfied', true);
end;
$$;

create or replace function public.enforce_onboarding_block_requirements()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare v_session_step_id uuid;
begin
    if new.native_kind <> 'onboarding_step' or new.status <> 'done' or old.status = 'done' then return new; end if;
    begin v_session_step_id := nullif(new.metadata->>'session_step_id', '')::uuid;
    exception when others then v_session_step_id := null; end;
    if v_session_step_id is not null and exists (
        select 1 from public.relationship_onboarding_session_blocks block
        where block.workspace_id = new.workspace_id and block.session_step_id = v_session_step_id and block.required
          and not exists (select 1 from public.onboarding_block_requirements requirement where requirement.workspace_id = block.workspace_id and requirement.session_block_id = block.id)
    ) then raise exception using errcode = 'P0001', message = 'Complete the required onboarding items before continuing.'; end if;
    return new;
end;
$$;

revoke all on table public.relationship_appointment_setting_configs from anon, authenticated;
grant select on table public.relationship_appointment_setting_configs to authenticated;
grant all on table public.relationship_appointment_setting_configs to service_role;
revoke all on function public.configure_appointment_setting_onboarding_block(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.configure_appointment_setting_onboarding_block(text, uuid, jsonb) to service_role;
revoke all on function public.validate_appointment_setting_appointment_configuration() from public, anon, authenticated;
grant execute on function public.validate_appointment_setting_appointment_configuration() to service_role;
