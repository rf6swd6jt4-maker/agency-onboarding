-- Client Meta authorization is relationship-scoped. The public onboarding
-- token can start a short-lived OAuth attempt, but provider credentials remain
-- encrypted and accessible only to the trusted application service role.

alter table public.relationship_onboarding_session_blocks
    drop constraint if exists relationship_onboarding_session_blocks_kind_check;
alter table public.relationship_onboarding_session_blocks
    add constraint relationship_onboarding_session_blocks_kind_check
    check (kind in ('header', 'estimate', 'form', 'video', 'button', 'checklist', 'connection'));

alter table public.onboarding_block_requirements
    drop constraint if exists onboarding_block_requirements_requirement_kind_check;
alter table public.onboarding_block_requirements
    add constraint onboarding_block_requirements_requirement_kind_check
    check (requirement_kind in ('button_opened', 'video_finished', 'meta_ads_connected'));

create table if not exists public.onboarding_meta_ads_connection_attempts (
    state_hash text primary key check (length(state_hash) = 64),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null,
    session_id uuid not null,
    session_block_id uuid not null,
    redirect_uri text not null check (redirect_uri ~ '^https://'),
    expires_at timestamptz not null,
    used_at timestamptz,
    last_error text,
    created_at timestamptz not null default now(),
    foreign key (workspace_id, relationship_id) references public.relationships(workspace_id, id) on delete cascade,
    foreign key (workspace_id, session_id) references public.relationship_onboarding_sessions(workspace_id, id) on delete cascade,
    foreign key (workspace_id, session_block_id) references public.relationship_onboarding_session_blocks(workspace_id, id) on delete cascade
);

create table if not exists public.relationship_meta_ads_connections (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null,
    onboarding_session_id uuid not null,
    source_session_block_id uuid not null,
    service_revision_id uuid references public.onboarding_service_revisions(id) on delete set null,
    status text not null default 'connected' check (status in ('connected', 'needs_attention', 'revoked')),
    facebook_user_id text not null,
    facebook_user_name text not null,
    credential_encrypted text not null,
    access_token_expires_at timestamptz not null,
    businesses jsonb not null default '[]'::jsonb check (jsonb_typeof(businesses) = 'array'),
    ad_accounts jsonb not null default '[]'::jsonb check (jsonb_typeof(ad_accounts) = 'array'),
    connected_at timestamptz not null default now(),
    last_verified_at timestamptz,
    last_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (workspace_id, relationship_id) references public.relationships(workspace_id, id) on delete cascade,
    foreign key (workspace_id, onboarding_session_id) references public.relationship_onboarding_sessions(workspace_id, id) on delete cascade,
    foreign key (workspace_id, source_session_block_id) references public.relationship_onboarding_session_blocks(workspace_id, id) on delete restrict,
    unique (workspace_id, relationship_id)
);

alter table public.onboarding_meta_ads_connection_attempts enable row level security;
alter table public.relationship_meta_ads_connections enable row level security;

create or replace function public.require_connection_onboarding_block()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
    if new.kind = 'connection' then new.required := true; end if;
    return new;
end;
$$;

drop trigger if exists require_connection_onboarding_block on public.relationship_onboarding_session_blocks;
create trigger require_connection_onboarding_block
before insert or update of kind, required on public.relationship_onboarding_session_blocks
for each row execute function public.require_connection_onboarding_block();

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
            v_video_count := 0; v_button_count := 0; v_connection_count := 0; v_block_ids := '{}'::uuid[];
            for v_block in select value from jsonb_array_elements(v_step->'blocks') with ordinality order by ordinality loop
                begin v_id := (v_block->>'id')::uuid; exception when others then raise exception 'Every onboarding block requires a stable UUID'; end;
                if v_id = any(v_block_ids) then raise exception 'Block IDs must be unique within a step'; end if;
                v_block_ids := array_append(v_block_ids, v_id);
                if v_block->>'kind' not in ('header', 'estimate', 'form', 'checklist', 'video', 'button', 'connection') then raise exception 'Unknown onboarding block type'; end if;
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
