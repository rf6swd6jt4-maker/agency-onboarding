-- Visual onboarding Builder V2. This migration is additive: immutable V1
-- definitions and frozen sessions remain readable throughout the cutover.

create table if not exists public.onboarding_builder_documents (
    workspace_id uuid primary key references public.workspaces(id) on delete cascade,
    visual_enabled boolean not null default true,
    version bigint not null default 0 check (version >= 0),
    published_version bigint not null default 0 check (published_version >= 0),
    snapshot_base64 text,
    snapshot_sequence bigint not null default 0 check (snapshot_sequence >= 0),
    release_lock_id uuid,
    release_locked_by uuid references auth.users(id) on delete set null,
    release_locked_at timestamptz,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
alter table public.onboarding_builder_documents
    add column if not exists visual_enabled boolean not null default true;

create table if not exists public.onboarding_builder_updates (
    sequence bigint generated always as identity primary key,
    id uuid not null default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    update_id text not null,
    update_base64 text not null,
    actor_user_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    unique (workspace_id, update_id),
    unique (workspace_id, sequence)
);
create index if not exists onboarding_builder_updates_workspace_sequence_idx
on public.onboarding_builder_updates(workspace_id, sequence);

create table if not exists public.onboarding_theme_revisions (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    revision_number integer,
    status text not null check (status in ('draft', 'published')),
    definition jsonb not null check (jsonb_typeof(definition) = 'object'),
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    published_by uuid references auth.users(id) on delete set null,
    published_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (workspace_id, id)
);
create unique index if not exists onboarding_theme_revisions_one_draft
on public.onboarding_theme_revisions(workspace_id) where status = 'draft';
create unique index if not exists onboarding_theme_revisions_version_unique
on public.onboarding_theme_revisions(workspace_id, revision_number) where revision_number is not null;

with definitions as (
    select theme.workspace_id,
           jsonb_build_object(
               'id', theme.id,
               'swatches', coalesce((
                   select jsonb_agg(jsonb_build_object(
                       'id', swatch.id, 'name', swatch.name, 'hex', swatch.hex,
                       'hidden', swatch.hidden
                   ) order by swatch.created_at, swatch.id)
                   from public.onboarding_brand_swatches swatch
                   where swatch.workspace_id = theme.workspace_id
               ), '[]'::jsonb),
               'assignments', theme.assignments,
               'updatedAt', theme.updated_at,
               'updatedBy', theme.updated_by
           ) as definition,
           theme.updated_by,
           theme.updated_at
    from public.onboarding_themes theme
)
insert into public.onboarding_theme_revisions (
    workspace_id, revision_number, status, definition, created_by, updated_by,
    published_by, published_at, created_at, updated_at
)
select workspace_id, 1, 'published', definition, updated_by, updated_by,
       updated_by, updated_at, updated_at, updated_at
from definitions
where not exists (
    select 1 from public.onboarding_theme_revisions revision
    where revision.workspace_id = definitions.workspace_id and revision.status = 'published'
);

insert into public.onboarding_theme_revisions (workspace_id, status, definition, created_by, updated_by)
select published.workspace_id, 'draft', published.definition, published.created_by, published.updated_by
from public.onboarding_theme_revisions published
where published.status = 'published'
  and not exists (
      select 1 from public.onboarding_theme_revisions draft
      where draft.workspace_id = published.workspace_id and draft.status = 'draft'
  );

create table if not exists public.onboarding_visual_preview_tokens (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
    snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
    expires_at timestamptz not null,
    revoked_at timestamptz,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    check (expires_at > created_at)
);
create index if not exists onboarding_visual_preview_tokens_workspace_idx
on public.onboarding_visual_preview_tokens(workspace_id, created_at desc);

alter table public.relationship_onboarding_session_steps
    add column if not exists navigation jsonb not null default '{"backLabel":"Back","continueLabel":"Complete and continue"}'::jsonb,
    add column if not exists is_actionable boolean not null default true,
    add column if not exists superseded_at timestamptz,
    add column if not exists superseded_by_release_id uuid;

alter table public.onboarding_session_notices
    add column if not exists consolidated_release_id uuid;

create or replace function public.mark_visual_onboarding_snapshot_version()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
    if jsonb_typeof(new.composition_snapshot->'items') = 'array' and exists (
        select 1 from jsonb_array_elements(new.composition_snapshot->'items') item
        where coalesce((item#>>'{definition,schemaVersion}')::integer, 1) = 2
    ) then new.snapshot_schema_version := 2; end if;
    return new;
end;
$$;
drop trigger if exists mark_visual_onboarding_snapshot_version on public.relationship_onboarding_sessions;
create trigger mark_visual_onboarding_snapshot_version
before insert or update of composition_snapshot on public.relationship_onboarding_sessions
for each row execute function public.mark_visual_onboarding_snapshot_version();

create table if not exists public.relationship_onboarding_session_blocks (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    session_id uuid not null,
    session_step_id uuid not null,
    source_block_id uuid not null,
    kind text not null check (kind in ('header', 'form', 'video', 'button')),
    sort_order integer not null check (sort_order >= 0),
    definition jsonb not null check (jsonb_typeof(definition) = 'object'),
    required boolean not null default false,
    created_at timestamptz not null default now(),
    foreign key (workspace_id, session_id) references public.relationship_onboarding_sessions(workspace_id, id) on delete cascade,
    foreign key (workspace_id, session_step_id) references public.relationship_onboarding_session_steps(workspace_id, id) on delete cascade,
    unique (session_step_id, source_block_id),
    unique (session_step_id, sort_order),
    unique (workspace_id, id)
);

create table if not exists public.onboarding_block_requirements (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    session_id uuid not null,
    session_step_id uuid not null,
    session_block_id uuid not null,
    requirement_kind text not null check (requirement_kind in ('button_opened', 'video_finished')),
    satisfied_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    foreign key (workspace_id, session_id) references public.relationship_onboarding_sessions(workspace_id, id) on delete cascade,
    foreign key (workspace_id, session_step_id) references public.relationship_onboarding_session_steps(workspace_id, id) on delete cascade,
    foreign key (workspace_id, session_block_id) references public.relationship_onboarding_session_blocks(workspace_id, id) on delete cascade,
    primary key (session_block_id)
);

create table if not exists public.onboarding_release_notices (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null,
    session_id uuid not null,
    release_id uuid not null,
    explanation text not null check (char_length(trim(explanation)) between 1 and 2000),
    affected_sections text[] not null default '{}',
    affected_session_step_ids uuid[] not null default '{}',
    requires_completion boolean not null default false,
    first_seen_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    foreign key (workspace_id, relationship_id) references public.relationships(workspace_id, id) on delete cascade,
    foreign key (workspace_id, session_id) references public.relationship_onboarding_sessions(workspace_id, id) on delete cascade,
    unique (session_id, release_id)
);

alter table public.onboarding_builder_documents enable row level security;
alter table public.onboarding_builder_updates enable row level security;
alter table public.onboarding_theme_revisions enable row level security;
alter table public.onboarding_visual_preview_tokens enable row level security;
alter table public.relationship_onboarding_session_blocks enable row level security;
alter table public.onboarding_block_requirements enable row level security;
alter table public.onboarding_release_notices enable row level security;

drop policy if exists "onboarding admins read builder documents" on public.onboarding_builder_documents;
create policy "onboarding admins read builder documents" on public.onboarding_builder_documents
for select using (public.is_workspace_member(workspace_id, array['owner','admin']));
drop policy if exists "onboarding admins read builder updates" on public.onboarding_builder_updates;
create policy "onboarding admins read builder updates" on public.onboarding_builder_updates
for select using (public.is_workspace_member(workspace_id, array['owner','admin']));
drop policy if exists "onboarding admins read theme revisions" on public.onboarding_theme_revisions;
create policy "onboarding admins read theme revisions" on public.onboarding_theme_revisions
for select using (public.is_workspace_member(workspace_id, array['owner','admin']));
drop policy if exists "onboarding admins read visual preview tokens" on public.onboarding_visual_preview_tokens;
create policy "onboarding admins read visual preview tokens" on public.onboarding_visual_preview_tokens
for select using (public.is_workspace_member(workspace_id, array['owner','admin']));
drop policy if exists "workspace members read onboarding session blocks" on public.relationship_onboarding_session_blocks;
create policy "workspace members read onboarding session blocks" on public.relationship_onboarding_session_blocks
for select using (public.is_workspace_member(workspace_id, array['owner','admin','staff']));
drop policy if exists "workspace admins read onboarding release notices" on public.onboarding_release_notices;
create policy "workspace admins read onboarding release notices" on public.onboarding_release_notices
for select using (public.is_workspace_member(workspace_id, array['owner','admin']));

-- Supabase private Broadcast and Presence channels use realtime.messages RLS.
-- The channel topic contains only the workspace slug; client payloads contain
-- collaboration state and never client onboarding data.
do $$
begin
    if to_regclass('realtime.messages') is not null then
        execute $policy$
            create policy "onboarding admins receive builder realtime"
            on realtime.messages for select to authenticated
            using (
                realtime.topic() like 'onboarding-builder:%'
                and exists (
                    select 1 from public.workspaces workspace
                    join public.workspace_memberships membership on membership.workspace_id = workspace.id
                    where workspace.slug = split_part(realtime.topic(), ':', 2)
                      and membership.user_id = auth.uid()
                      and membership.role in ('owner','admin')
                )
            )
        $policy$;
        execute $policy$
            create policy "onboarding admins send builder realtime"
            on realtime.messages for insert to authenticated
            with check (
                realtime.topic() like 'onboarding-builder:%'
                and exists (
                    select 1 from public.workspaces workspace
                    join public.workspace_memberships membership on membership.workspace_id = workspace.id
                    where workspace.slug = split_part(realtime.topic(), ':', 2)
                      and membership.user_id = auth.uid()
                      and membership.role in ('owner','admin')
                )
            )
        $policy$;
    end if;
exception when duplicate_object then null;
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
    v_form_count integer;
begin
    if jsonb_typeof(p_definition) <> 'object' or nullif(trim(p_definition->>'name'), '') is null then
        raise exception 'Give this module a name before publishing';
    end if;
    if jsonb_typeof(p_definition->'steps') <> 'array' or jsonb_array_length(p_definition->'steps') = 0 then
        raise exception 'A module must contain at least one step';
    end if;
    for v_step in select value from jsonb_array_elements(p_definition->'steps') loop
        begin v_id := (v_step->>'id')::uuid;
        exception when others then raise exception 'Every step requires a stable UUID'; end;
        if v_id = any(v_step_ids) then raise exception 'Step IDs must be unique within a module'; end if;
        v_step_ids := array_append(v_step_ids, v_id);

        if coalesce((p_definition->>'schemaVersion')::integer, 1) = 2 then
            if jsonb_typeof(v_step->'blocks') <> 'array' or jsonb_array_length(v_step->'blocks') = 0 then
                raise exception 'Every visual onboarding step requires blocks';
            end if;
            v_header_count := 0;
            v_form_count := 0;
            v_block_ids := '{}'::uuid[];
            for v_block in select value from jsonb_array_elements(v_step->'blocks') with ordinality order by ordinality loop
                begin v_id := (v_block->>'id')::uuid;
                exception when others then raise exception 'Every onboarding block requires a stable UUID'; end;
                if v_id = any(v_block_ids) then raise exception 'Block IDs must be unique within a step'; end if;
                v_block_ids := array_append(v_block_ids, v_id);
                if v_block->>'kind' not in ('header', 'form', 'video', 'button') then raise exception 'Unknown onboarding block type'; end if;
                if v_block->>'kind' = 'header' then
                    v_header_count := v_header_count + 1;
                    if v_header_count <> 1 or v_block <> (v_step->'blocks')->0 then raise exception 'The Header must be the first block in every step'; end if;
                    if nullif(trim(v_block->>'title'), '') is null then raise exception 'Every step requires a title'; end if;
                elsif v_block->>'kind' = 'form' then
                    v_form_count := v_form_count + 1;
                    if v_form_count > 1 then raise exception 'A step may contain only one Form block'; end if;
                    if jsonb_typeof(v_block->'fields') <> 'array' then raise exception 'Form blocks require a fields array'; end if;
                    v_field_ids := '{}'::uuid[];
                    for v_field in select value from jsonb_array_elements(v_block->'fields') loop
                        begin v_id := (v_field->>'id')::uuid;
                        exception when others then raise exception 'Every field requires a stable UUID'; end;
                        if v_id = any(v_field_ids) then raise exception 'Field IDs must be unique within a Form block'; end if;
                        v_field_ids := array_append(v_field_ids, v_id);
                        if nullif(trim(v_field->>'label'), '') is null then raise exception 'Every field requires a label'; end if;
                        if v_field->>'type' not in ('text','email','tel','url','textarea','file') then raise exception 'Unknown onboarding field type'; end if;
                    end loop;
                elsif v_block->>'kind' = 'video' then
                    if nullif(v_block#>>'{upload,path}', '') is null then raise exception 'Upload every video before publishing'; end if;
                    if nullif(v_block->>'legacyEmbedUrl', '') is not null then raise exception 'Replace embedded videos with workspace uploads before publishing'; end if;
                    if coalesce(v_block->>'requirement', 'none') not in ('none','finish') then raise exception 'Unknown video requirement'; end if;
                elsif v_block->>'kind' = 'button' then
                    if nullif(trim(v_block->>'label'), '') is null then raise exception 'Every button requires a label'; end if;
                    if coalesce(v_block->>'url', '') !~ '^https://' then raise exception 'Buttons require a secure HTTPS URL'; end if;
                end if;
            end loop;
            if v_header_count <> 1 then raise exception 'Every step requires exactly one Header block'; end if;
        else
            if nullif(trim(v_step->>'title'), '') is null then raise exception 'Every step requires a title'; end if;
            if coalesce(v_step->>'kind', '') not in ('form', 'video') then raise exception 'Unknown onboarding step type'; end if;
        end if;

        -- V2 retains this compatibility projection for existing invoice and
        -- session materialisers until the V1 reader is retired.
        if coalesce(v_step->>'kind', '') not in ('form', 'video') then raise exception 'Every step requires a compatibility kind'; end if;
        if v_step->>'kind' = 'form' and jsonb_typeof(v_step->'fields') <> 'array' then raise exception 'Form steps require a fields array'; end if;
    end loop;
end;
$$;

create or replace function public.materialize_onboarding_v2_blocks()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_definition jsonb;
    v_step jsonb;
    v_block jsonb;
    v_first_step jsonb;
    v_extra_step jsonb;
    v_extra_step_id uuid;
    v_base_order integer := new.sort_order;
    v_position integer := 0;
begin
    if new.module_revision_id is not null then
        select definition into v_definition from public.onboarding_module_revisions
        where workspace_id = new.workspace_id and id = new.module_revision_id;
    elsif new.bookend_revision_id is not null then
        select definition into v_definition from public.onboarding_configuration_revisions
        where workspace_id = new.workspace_id and id = new.bookend_revision_id;
    end if;
    if coalesce((v_definition->>'schemaVersion')::integer, 1) <> 2 then return new; end if;

    if new.source_step_id is not null then
        select value into v_step from jsonb_array_elements(v_definition->'steps')
        where value->>'id' = new.source_step_id::text limit 1;
    else
        select value into v_first_step from jsonb_array_elements(v_definition->'steps') with ordinality
        order by ordinality limit 1;
        v_step := v_first_step;
        update public.relationship_onboarding_session_steps
        set source_step_id = (v_step->>'id')::uuid,
            title = coalesce(v_step#>>'{blocks,0,title}', title),
            description = nullif(v_step#>>'{blocks,0,description}', ''),
            estimated_time = nullif(v_step#>>'{blocks,0,estimatedTime}', ''),
            navigation = coalesce(v_step->'navigation', navigation),
            is_actionable = true
        where id = new.id and workspace_id = new.workspace_id;
    end if;

    if v_step is not null then
        for v_block in select value from jsonb_array_elements(v_step->'blocks') with ordinality order by ordinality loop
            insert into public.relationship_onboarding_session_blocks (
                workspace_id, session_id, session_step_id, source_block_id,
                kind, sort_order, definition, required
            ) values (
                new.workspace_id, new.session_id, new.id, (v_block->>'id')::uuid,
                v_block->>'kind', v_position, v_block,
                case when v_block->>'kind' = 'video' then coalesce(v_block->>'requirement', 'none') = 'finish'
                     when v_block->>'kind' = 'button' then coalesce((v_block->>'required')::boolean, false)
                     else false end
            ) on conflict (session_step_id, source_block_id) do nothing;
            v_position := v_position + 1;
        end loop;
    end if;

    if new.bookend_revision_id is not null and new.source_step_id is null then
        v_position := 1;
        for v_extra_step in select value from jsonb_array_elements(v_definition->'steps') with ordinality where ordinality > 1 order by ordinality loop
            insert into public.relationship_onboarding_session_steps (
                workspace_id, session_id, bookend_revision_id, source_step_id, kind,
                title, description, estimated_time, sort_order, legacy_step_key,
                navigation, is_actionable
            ) values (
                new.workspace_id, new.session_id, new.bookend_revision_id,
                (v_extra_step->>'id')::uuid, new.kind,
                coalesce(v_extra_step#>>'{blocks,0,title}', initcap(new.kind)),
                nullif(v_extra_step#>>'{blocks,0,description}', ''),
                nullif(v_extra_step#>>'{blocks,0,estimatedTime}', ''),
                v_base_order + v_position, new.legacy_step_key || '-' || v_position,
                coalesce(v_extra_step->'navigation', new.navigation), true
            ) returning id into v_extra_step_id;
            v_position := v_position + 1;
        end loop;
    end if;
    return new;
end;
$$;

drop trigger if exists materialize_onboarding_v2_blocks on public.relationship_onboarding_session_steps;
create trigger materialize_onboarding_v2_blocks
after insert on public.relationship_onboarding_session_steps
for each row execute function public.materialize_onboarding_v2_blocks();

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
        where block.workspace_id = new.workspace_id and block.session_step_id = v_session_step_id
          and block.required
          and not exists (
              select 1 from public.onboarding_block_requirements requirement
              where requirement.workspace_id = block.workspace_id and requirement.session_block_id = block.id
          )
    ) then
        raise exception using errcode = 'P0001', message = 'Complete the required video or link before continuing.';
    end if;
    return new;
end;
$$;
drop trigger if exists enforce_onboarding_block_requirements on public.work_items;
create trigger enforce_onboarding_block_requirements
before update of status on public.work_items
for each row execute function public.enforce_onboarding_block_requirements();

create or replace function public.refresh_onboarding_release_notice_completion()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare v_session_id uuid;
begin
    if new.native_kind <> 'onboarding_step' or new.status <> 'done' or old.status = 'done' then return new; end if;
    begin v_session_id := nullif(new.metadata->>'session_id', '')::uuid;
    exception when others then v_session_id := null; end;
    if v_session_id is null then return new; end if;
    update public.onboarding_release_notices notice
    set completed_at = now()
    where notice.workspace_id = new.workspace_id
      and notice.session_id = v_session_id
      and notice.requires_completion
      and notice.completed_at is null
      and not exists (
          select 1 from unnest(notice.affected_session_step_ids) affected(session_step_id)
          where not exists (
              select 1 from public.work_items item
              where item.workspace_id = notice.workspace_id
                and item.native_kind = 'onboarding_step'
                and item.metadata->>'session_step_id' = affected.session_step_id::text
                and item.status = 'done'
          )
      );
    return new;
end;
$$;
drop trigger if exists refresh_onboarding_release_notice_completion on public.work_items;
create trigger refresh_onboarding_release_notice_completion
after update of status on public.work_items
for each row execute function public.refresh_onboarding_release_notice_completion();

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
declare v_session public.relationship_onboarding_sessions%rowtype;
begin
    if current_user <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted onboarding runtime required'; end if;
    select block.* into v_block
    from public.relationship_onboarding_session_blocks block
    join public.relationship_onboarding_sessions session on session.id = block.session_id and session.workspace_id = block.workspace_id
    where block.id = p_session_block_id and session.session_token = p_token and session.status = 'active'
    for update of block;
    if v_block.id is null or not v_block.required then raise exception using errcode = 'P0001', message = 'Required onboarding block not found.'; end if;
    if (v_block.kind = 'video' and p_requirement_kind <> 'video_finished')
       or (v_block.kind = 'button' and p_requirement_kind <> 'button_opened') then
        raise exception using errcode = 'P0001', message = 'The onboarding requirement does not match this block.';
    end if;
    insert into public.onboarding_block_requirements (
        workspace_id, session_id, session_step_id, session_block_id, requirement_kind
    ) values (
        v_block.workspace_id, v_block.session_id, v_block.session_step_id, v_block.id, p_requirement_kind
    ) on conflict (session_block_id) do update set satisfied_at = onboarding_block_requirements.satisfied_at;
    return jsonb_build_object('session_block_id', v_block.id, 'satisfied', true);
end;
$$;

create or replace function public.append_onboarding_builder_update(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_update_id text,
    p_update_base64 text,
    p_definition_ids text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare v_sequence bigint;
declare v_version bigint;
declare v_window bigint := floor(extract(epoch from now()) / 900);
declare v_definition_id text;
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    if nullif(trim(p_update_id), '') is null or length(p_update_id) > 160 then raise exception 'Invalid collaborative update ID'; end if;
    if p_update_base64 !~ '^[A-Za-z0-9+/=]+$' or length(p_update_base64) > 1400000 then raise exception 'Invalid collaborative update'; end if;
    insert into public.onboarding_builder_documents (workspace_id, updated_by)
    values (p_workspace_id, p_actor_user_id)
    on conflict (workspace_id) do nothing;
    insert into public.onboarding_builder_updates (workspace_id, update_id, update_base64, actor_user_id)
    values (p_workspace_id, p_update_id, p_update_base64, p_actor_user_id)
    on conflict (workspace_id, update_id) do nothing
    returning sequence into v_sequence;
    if v_sequence is null then
        select version into v_version
        from public.onboarding_builder_documents
        where workspace_id = p_workspace_id;
        return jsonb_build_object('sequence', (
            select sequence from public.onboarding_builder_updates
            where workspace_id = p_workspace_id and update_id = p_update_id
        ), 'version', v_version);
    end if;
    update public.onboarding_builder_documents
    set version = version + 1, updated_by = p_actor_user_id, updated_at = now()
    where workspace_id = p_workspace_id
    returning version into v_version;
    foreach v_definition_id in array case when cardinality(p_definition_ids) > 0 then p_definition_ids else array['builder'] end loop
        if v_definition_id !~ '^[a-zA-Z0-9:_-]{1,160}$' then raise exception 'Invalid Builder definition ID'; end if;
        perform public.record_workspace_admin_activity(
            p_workspace_id, 'onboarding', 'onboarding.builder.edit_session', 'Onboarding Builder draft edited',
            p_entity_type => 'onboarding_definition', p_entity_id => v_definition_id,
            p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
            p_metadata => jsonb_build_object('editing_window_minutes', 15),
            p_idempotency_key => format('onboarding.builder.edit:%s:%s:%s:%s', p_workspace_id, p_actor_user_id, v_definition_id, v_window),
            p_coalesce => true
        );
    end loop;
    return jsonb_build_object('sequence', v_sequence, 'version', v_version);
end;
$$;

create or replace function public.compact_onboarding_builder_document(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_snapshot_base64 text,
    p_snapshot_sequence bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    update public.onboarding_builder_documents
    set snapshot_base64 = p_snapshot_base64, snapshot_sequence = greatest(snapshot_sequence, p_snapshot_sequence),
        updated_by = p_actor_user_id, updated_at = now()
    where workspace_id = p_workspace_id;
    delete from public.onboarding_builder_updates
    where workspace_id = p_workspace_id and sequence <= p_snapshot_sequence;
    return jsonb_build_object('snapshot_sequence', p_snapshot_sequence);
end;
$$;

create or replace function public.save_onboarding_theme_draft(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_definition jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare v_id uuid;
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    if jsonb_typeof(p_definition->'swatches') <> 'array' or jsonb_typeof(p_definition->'assignments') <> 'object' then raise exception 'Theme draft is incomplete'; end if;
    update public.onboarding_theme_revisions
    set definition = p_definition, updated_by = p_actor_user_id, updated_at = now()
    where workspace_id = p_workspace_id and status = 'draft'
    returning id into v_id;
    if v_id is null then
        insert into public.onboarding_theme_revisions (workspace_id, status, definition, created_by, updated_by)
        values (p_workspace_id, 'draft', p_definition, p_actor_user_id, p_actor_user_id)
        returning id into v_id;
    end if;
    return jsonb_build_object('theme_revision_id', v_id, 'updated_at', now());
end;
$$;

create or replace function public.publish_onboarding_theme_draft(
    p_workspace_id uuid,
    p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare v_draft public.onboarding_theme_revisions%rowtype;
declare v_revision integer;
declare v_id uuid;
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    select * into v_draft from public.onboarding_theme_revisions
    where workspace_id = p_workspace_id and status = 'draft' for update;
    if v_draft.id is null then raise exception 'Theme draft not found'; end if;
    select coalesce(max(revision_number), 0) + 1 into v_revision from public.onboarding_theme_revisions
    where workspace_id = p_workspace_id and status = 'published';
    insert into public.onboarding_theme_revisions (
        workspace_id, revision_number, status, definition, created_by, updated_by, published_by, published_at
    ) values (
        p_workspace_id, v_revision, 'published', v_draft.definition, p_actor_user_id, p_actor_user_id, p_actor_user_id, now()
    ) returning id into v_id;
    perform public.save_onboarding_branding(
        p_workspace_id, p_actor_user_id, v_draft.definition->'swatches', v_draft.definition->'assignments'
    );
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.branding.published', 'Agency onboarding colours published',
        p_entity_type => 'onboarding_theme', p_entity_id => v_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_idempotency_key => format('onboarding.branding.published:%s:%s', p_workspace_id, v_revision),
        p_metadata => jsonb_build_object('revision_number', v_revision, 'global_client_impact', true)
    );
    return jsonb_build_object('theme_revision_id', v_id, 'revision_number', v_revision);
end;
$$;

create or replace function public.rotate_visual_onboarding_preview_token(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_token_hash text,
    p_snapshot jsonb,
    p_expires_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare v_id uuid;
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    if p_token_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_snapshot) <> 'object' then raise exception 'Invalid visual preview'; end if;
    if p_expires_at <= now() or p_expires_at > now() + interval '24 hours 5 minutes' then raise exception 'Invalid visual preview expiry'; end if;
    update public.onboarding_visual_preview_tokens
    set revoked_at = now()
    where workspace_id = p_workspace_id and created_by = p_actor_user_id and revoked_at is null;
    insert into public.onboarding_visual_preview_tokens (workspace_id, token_hash, snapshot, expires_at, created_by)
    values (p_workspace_id, p_token_hash, p_snapshot, p_expires_at, p_actor_user_id)
    returning id into v_id;
    return jsonb_build_object('preview_id', v_id, 'expires_at', p_expires_at);
end;
$$;

create or replace function public.publish_visual_onboarding_release(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_expected_document_version bigint,
    p_modules jsonb,
    p_bookends jsonb,
    p_theme jsonb,
    p_apply_to_active boolean,
    p_explanation text,
    p_release_id uuid,
    p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare v_document public.onboarding_builder_documents%rowtype;
declare v_module jsonb;
declare v_module_id uuid;
declare v_bookend jsonb;
declare v_kind text;
declare v_result jsonb;
declare v_results jsonb := '[]'::jsonb;
declare v_started_at timestamptz := clock_timestamp();
declare v_event_id uuid;
declare v_completion_revision_id uuid;
declare v_session record;
declare v_old_step_ids uuid[];
declare v_completion_sort_order integer;
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    insert into public.onboarding_builder_documents (workspace_id, updated_by)
    values (p_workspace_id, p_actor_user_id) on conflict (workspace_id) do nothing;
    select * into v_document from public.onboarding_builder_documents
    where workspace_id = p_workspace_id for update;
    if v_document.version <> p_expected_document_version then
        raise exception using errcode = '40001', message = 'The Builder changed while this release was being reviewed. Refresh the review and try again.';
    end if;
    update public.onboarding_builder_documents
    set release_lock_id = p_release_id, release_locked_by = p_actor_user_id, release_locked_at = now()
    where workspace_id = p_workspace_id;

    if jsonb_typeof(coalesce(p_modules, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_bookends, '[]'::jsonb)) <> 'array' then
        raise exception 'Visual release definitions must be arrays';
    end if;
    for v_module in select value from jsonb_array_elements(coalesce(p_modules, '[]'::jsonb)) loop
        begin v_module_id := (v_module->>'id')::uuid;
        exception when others then raise exception 'Visual release module ID is invalid'; end;
        perform public.save_onboarding_module_draft(p_workspace_id, p_actor_user_id, v_module_id, v_module->'definition');
        v_result := public.publish_onboarding_module(p_workspace_id, p_actor_user_id, v_module_id, p_apply_to_active, p_explanation);
        v_results := v_results || jsonb_build_array(v_result);
    end loop;
    for v_bookend in select value from jsonb_array_elements(coalesce(p_bookends, '[]'::jsonb)) loop
        v_kind := v_bookend->>'kind';
        if v_kind not in ('welcome','completion') then raise exception 'Unknown onboarding bookend'; end if;
        if v_kind = 'completion'
           and coalesce((v_bookend#>>'{definition,schemaVersion}')::integer, 1) = 2
           and exists (
               select 1
               from public.relationship_onboarding_sessions active_session
               join public.relationship_onboarding_session_steps completion_step
                 on completion_step.workspace_id = active_session.workspace_id
                and completion_step.session_id = active_session.id
                and completion_step.kind = 'completion'
               join public.work_items completion_work
                 on completion_work.workspace_id = completion_step.workspace_id
                and completion_work.metadata->>'session_step_id' = completion_step.id::text
                and completion_work.status = 'done'
               where active_session.workspace_id = p_workspace_id
                 and active_session.status = 'active'
           ) then
            raise exception using
                errcode = 'P0001',
                message = 'Completion cannot be published while an active client has already started it. Finish or restart the affected onboarding before publishing this Completion change.';
        end if;
        perform public.save_onboarding_bookend_draft(p_workspace_id, p_actor_user_id, v_kind, v_bookend->'definition');
        v_result := public.publish_onboarding_bookend(p_workspace_id, p_actor_user_id, v_kind);
        v_results := v_results || jsonb_build_array(v_result);
        if v_kind = 'completion' and coalesce((v_bookend#>>'{definition,schemaVersion}')::integer, 1) = 2 then
            v_completion_revision_id := (v_result->>'bookend_revision_id')::uuid;
            for v_session in
                select session.id, session.relationship_id
                from public.relationship_onboarding_sessions session
                where session.workspace_id = p_workspace_id
                  and session.status = 'active'
                  and not exists (
                      select 1
                      from public.relationship_onboarding_session_steps completion_step
                      join public.work_items completion_work
                        on completion_work.workspace_id = completion_step.workspace_id
                       and completion_work.metadata->>'session_step_id' = completion_step.id::text
                      where completion_step.workspace_id = p_workspace_id
                        and completion_step.session_id = session.id
                        and completion_step.kind = 'completion'
                        and completion_work.status = 'done'
                  )
                order by session.id for update
            loop
                select coalesce(array_agg(step.id), '{}'::uuid[]) into v_old_step_ids
                from public.relationship_onboarding_session_steps step
                where step.workspace_id = p_workspace_id and step.session_id = v_session.id
                  and step.kind = 'completion' and step.superseded_at is null;
                update public.onboarding_edit_requests
                set status = 'superseded', superseded_at = now(),
                    original_session_step_id = coalesce(original_session_step_id, session_step_id),
                    session_step_id = null
                where workspace_id = p_workspace_id and session_id = v_session.id
                  and status = 'pending' and session_step_id = any(v_old_step_ids);
                update public.work_items item
                set status = 'canceled', updated_at = now()
                where item.workspace_id = p_workspace_id
                  and item.native_kind = 'onboarding_step'
                  and item.status <> 'done'
                  and item.metadata->>'session_step_id' = any(v_old_step_ids::text[]);
                update public.relationship_onboarding_session_steps step
                set is_actionable = false, superseded_at = now(), superseded_by_release_id = p_release_id
                where step.workspace_id = p_workspace_id and step.id = any(v_old_step_ids);
                select coalesce(max(step.sort_order), 0) + 1000 into v_completion_sort_order
                from public.relationship_onboarding_session_steps step
                where step.workspace_id = p_workspace_id and step.session_id = v_session.id;
                insert into public.relationship_onboarding_session_steps (
                    workspace_id, session_id, bookend_revision_id, source_step_id,
                    kind, title, description, estimated_time, sort_order,
                    legacy_step_key, navigation, is_actionable
                ) values (
                    p_workspace_id, v_session.id, v_completion_revision_id, null,
                    'completion', coalesce(v_bookend#>>'{definition,title}', 'Completion'),
                    nullif(v_bookend#>>'{definition,body}', ''), null,
                    v_completion_sort_order, 'final',
                    '{"backLabel":"Back","continueLabel":"Finish onboarding"}'::jsonb, true
                );
                update public.relationship_onboarding_sessions
                set snapshot_schema_version = 2, updated_at = now()
                where workspace_id = p_workspace_id and id = v_session.id;
                perform public.record_workspace_admin_activity(
                    p_workspace_id, 'onboarding', 'onboarding.session.completion_reset',
                    'Unstarted Completion steps superseded for a visual release',
                    p_entity_type => 'onboarding_session', p_entity_id => v_session.id::text,
                    p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
                    p_correlation_id => p_release_id,
                    p_idempotency_key => format('onboarding.completion.reset:%s:%s', p_release_id, v_session.id),
                    p_metadata => jsonb_build_object('relationship_id', v_session.relationship_id, 'completion_revision_id', v_completion_revision_id, 'superseded_step_count', cardinality(v_old_step_ids))
                );
            end loop;
        end if;
    end loop;
    if p_theme is not null then
        perform public.save_onboarding_theme_draft(p_workspace_id, p_actor_user_id, p_theme);
        v_result := public.publish_onboarding_theme_draft(p_workspace_id, p_actor_user_id);
        v_results := v_results || jsonb_build_array(v_result);
    end if;

    insert into public.onboarding_release_notices (
        workspace_id, relationship_id, session_id, release_id, explanation,
        affected_sections, affected_session_step_ids, requires_completion
    )
    select p_workspace_id, session.relationship_id, session.id, p_release_id,
           coalesce(nullif(trim(p_explanation), ''), 'We updated parts of your onboarding. Please review the affected sections again.'),
           array(
               select distinct section_name from (
                   select snapshot_module.title as section_name
                   from public.relationship_onboarding_session_modules snapshot_module
                   where snapshot_module.workspace_id = p_workspace_id
                     and snapshot_module.session_id = session.id
                     and snapshot_module.module_id in (
                         select (module->>'id')::uuid from jsonb_array_elements(coalesce(p_modules, '[]'::jsonb)) module
                     )
                   union all
                   select 'Completion' where exists (
                       select 1 from jsonb_array_elements(coalesce(p_bookends, '[]'::jsonb)) bookend
                       where bookend->>'kind' = 'completion'
                   )
               ) sections where nullif(trim(section_name), '') is not null
           ),
           array(
               select step.id
               from public.relationship_onboarding_session_steps step
               left join public.relationship_onboarding_session_modules snapshot_module on snapshot_module.id = step.session_module_id
               where step.workspace_id = p_workspace_id and step.session_id = session.id
                 and step.superseded_at is null
                 and (
                     snapshot_module.module_id in (
                         select (module->>'id')::uuid from jsonb_array_elements(coalesce(p_modules, '[]'::jsonb)) module
                     )
                     or (step.kind = 'completion' and exists (
                         select 1 from jsonb_array_elements(coalesce(p_bookends, '[]'::jsonb)) bookend
                         where bookend->>'kind' = 'completion'
                     ))
                 )
               order by step.sort_order
           ),
           exists (
               select 1 from public.onboarding_session_notices module_notice
               where module_notice.workspace_id = p_workspace_id
                 and module_notice.session_id = session.id
                 and module_notice.created_at >= v_started_at
                 and module_notice.requires_completion
           )
    from public.relationship_onboarding_sessions session
    where session.workspace_id = p_workspace_id and session.status = 'active'
      and (
          exists (
              select 1 from public.onboarding_session_notices module_notice
              where module_notice.workspace_id = p_workspace_id
                and module_notice.session_id = session.id
                and module_notice.created_at >= v_started_at
          )
          or exists (
              select 1 from jsonb_array_elements(coalesce(p_bookends, '[]'::jsonb)) bookend
              where bookend->>'kind' = 'completion'
          )
      )
    on conflict (session_id, release_id) do nothing;

    -- Multiple module resets for one client are delivered as one release notice.
    with ranked as (
        select id, session_id,
               row_number() over (partition by session_id order by created_at, id) as position,
               jsonb_agg(payload) over (partition by session_id) as payloads
        from public.onboarding_delivery_outbox
        where workspace_id = p_workspace_id and kind = 'module_update' and created_at >= v_started_at
    )
    update public.onboarding_delivery_outbox outbox
    set payload = jsonb_build_object(
            'release_id', p_release_id,
            'explanation', coalesce(nullif(trim(p_explanation), ''), 'We updated parts of your onboarding. Please review the affected sections again.'),
            'changes', ranked.payloads
        ),
        idempotency_key = format('onboarding-release:%s:%s', p_release_id, outbox.session_id)
    from ranked where ranked.id = outbox.id and ranked.position = 1;
    update public.onboarding_delivery_outbox outbox
    set status = 'canceled', updated_at = now()
    from (
        select id, row_number() over (partition by session_id order by created_at, id) as position
        from public.onboarding_delivery_outbox
        where workspace_id = p_workspace_id and kind = 'module_update' and created_at >= v_started_at
    ) duplicate
    where outbox.id = duplicate.id and duplicate.position > 1;

    insert into public.onboarding_delivery_outbox (
        workspace_id, relationship_id, session_id, correlation_id, kind,
        destination, payload, idempotency_key
    )
    select notice.workspace_id, notice.relationship_id, notice.session_id, p_release_id,
           'module_update', relationship.whatsapp_phone,
           jsonb_build_object('release_id', p_release_id, 'explanation', notice.explanation, 'sections', to_jsonb(notice.affected_sections)),
           format('onboarding-release:%s:%s', p_release_id, notice.session_id)
    from public.onboarding_release_notices notice
    join public.relationships relationship on relationship.id = notice.relationship_id and relationship.workspace_id = notice.workspace_id
    where notice.workspace_id = p_workspace_id and notice.release_id = p_release_id
      and nullif(trim(relationship.whatsapp_phone), '') is not null
    on conflict (workspace_id, idempotency_key) do update
    set payload = excluded.payload, destination = excluded.destination;

    update public.onboarding_session_notices module_notice
    set consolidated_release_id = p_release_id
    where module_notice.workspace_id = p_workspace_id and module_notice.created_at >= v_started_at;

    v_event_id := public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.release.published', 'Visual onboarding release published',
        p_entity_type => 'onboarding_builder', p_entity_id => p_workspace_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_correlation_id => p_release_id,
        p_idempotency_key => p_idempotency_key,
        p_metadata => jsonb_build_object(
            'module_count', jsonb_array_length(coalesce(p_modules, '[]'::jsonb)),
            'bookend_count', jsonb_array_length(coalesce(p_bookends, '[]'::jsonb)),
            'theme_published', p_theme is not null,
            'apply_to_active', p_apply_to_active
        )
    );
    update public.onboarding_builder_documents
    set published_version = version, release_lock_id = null, release_locked_by = null,
        release_locked_at = null, updated_at = now()
    where workspace_id = p_workspace_id;
    return jsonb_build_object('release_id', p_release_id, 'activity_event_id', v_event_id, 'results', v_results);
end;
$$;

revoke all on function public.satisfy_onboarding_block_requirement(text, uuid, text) from public, anon, authenticated;
revoke all on function public.append_onboarding_builder_update(uuid, uuid, text, text, text[]) from public, anon, authenticated;
revoke all on function public.compact_onboarding_builder_document(uuid, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.save_onboarding_theme_draft(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.publish_onboarding_theme_draft(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rotate_visual_onboarding_preview_token(uuid, uuid, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.publish_visual_onboarding_release(uuid, uuid, bigint, jsonb, jsonb, jsonb, boolean, text, uuid, text) from public, anon, authenticated;
grant execute on function public.satisfy_onboarding_block_requirement(text, uuid, text) to service_role;
grant execute on function public.append_onboarding_builder_update(uuid, uuid, text, text, text[]) to service_role;
grant execute on function public.compact_onboarding_builder_document(uuid, uuid, text, bigint) to service_role;
grant execute on function public.save_onboarding_theme_draft(uuid, uuid, jsonb) to service_role;
grant execute on function public.publish_onboarding_theme_draft(uuid, uuid) to service_role;
grant execute on function public.rotate_visual_onboarding_preview_token(uuid, uuid, text, jsonb, timestamptz) to service_role;
grant execute on function public.publish_visual_onboarding_release(uuid, uuid, bigint, jsonb, jsonb, jsonb, boolean, text, uuid, text) to service_role;
