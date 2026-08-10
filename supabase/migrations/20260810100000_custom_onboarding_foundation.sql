-- Workspace-owned onboarding catalogue, immutable revisions, frozen commercial
-- composition, inspectable session snapshots, and transaction-safe Activity.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Stripe object IDs are scoped to the connected account. Keep webhook and
-- invoice idempotency tenant-aware now that each workspace owns its provider.
alter table public.stripe_events
    drop constraint if exists stripe_events_pkey;
alter table public.stripe_events
    add constraint stripe_events_pkey primary key (workspace_id, id);
alter table public.client_sales
    drop constraint if exists client_sales_stripe_invoice_id_key;
create unique index if not exists client_sales_workspace_stripe_invoice_unique
on public.client_sales(workspace_id, stripe_invoice_id)
where stripe_invoice_id is not null;

-- Activity is an audit log as well as an operational diagnostic stream.  Keep
-- audit events out of request metrics unless the producer classifies them.
alter table public.workspace_admin_activity
    drop constraint if exists workspace_admin_activity_category_check;
alter table public.workspace_admin_activity
    add constraint workspace_admin_activity_category_check
    check (category in ('onboarding', 'services', 'leadgen', 'billing', 'communications', 'gantt', 'integrations', 'maintenance', 'system'));

alter table public.workspace_admin_activity
    add column if not exists actor_kind text,
    add column if not exists correlation_id uuid,
    add column if not exists causation_event_id uuid references public.workspace_admin_activity(id) on delete set null,
    add column if not exists idempotency_key text,
    add column if not exists outcome text,
    add column if not exists metric_classification text,
    add column if not exists diagnostics jsonb not null default '{}'::jsonb,
    add column if not exists failure_fingerprint text,
    add column if not exists maintenance_work_item_id uuid references public.work_items(id) on delete set null;

update public.workspace_admin_activity
set
    actor_kind = case
        when actor_user_id is not null then 'staff'
        when event_key in ('onboarding.step.completed', 'onboarding.session.completed', 'onboarding.edit_request.recorded') then 'client'
        else 'automation'
    end,
    correlation_id = coalesce(correlation_id, gen_random_uuid()),
    outcome = coalesce(outcome, case when level = 'error' then 'failed' else 'succeeded' end),
    metric_classification = coalesce(
        metric_classification,
        case metadata->>'request_direction'
            when 'outbound' then 'internal_call'
            when 'inbound' then 'external_call'
            else 'audit'
        end
    )
where actor_kind is null
   or correlation_id is null
   or outcome is null
   or metric_classification is null;

alter table public.workspace_admin_activity
    alter column actor_kind set default 'automation',
    alter column actor_kind set not null,
    alter column correlation_id set default gen_random_uuid(),
    alter column correlation_id set not null,
    alter column outcome set default 'succeeded',
    alter column outcome set not null,
    alter column metric_classification set default 'audit',
    alter column metric_classification set not null;

alter table public.workspace_admin_activity
    drop constraint if exists workspace_admin_activity_actor_kind_check,
    add constraint workspace_admin_activity_actor_kind_check
        check (actor_kind in ('staff', 'client', 'automation')),
    drop constraint if exists workspace_admin_activity_outcome_check,
    add constraint workspace_admin_activity_outcome_check
        check (outcome in ('succeeded', 'failed', 'rejected', 'queued', 'skipped')),
    drop constraint if exists workspace_admin_activity_metric_classification_check,
    add constraint workspace_admin_activity_metric_classification_check
        check (metric_classification in ('audit', 'operational', 'internal_call', 'external_call')),
    drop constraint if exists workspace_admin_activity_metadata_object_check,
    add constraint workspace_admin_activity_metadata_object_check
        check (jsonb_typeof(metadata) = 'object'),
    drop constraint if exists workspace_admin_activity_diagnostics_object_check,
    add constraint workspace_admin_activity_diagnostics_object_check
        check (jsonb_typeof(diagnostics) = 'object');

create unique index if not exists workspace_admin_activity_idempotency_unique
on public.workspace_admin_activity(workspace_id, idempotency_key)
where idempotency_key is not null;

create index if not exists workspace_admin_activity_correlation_idx
on public.workspace_admin_activity(workspace_id, correlation_id, occurred_at, id);

create index if not exists workspace_admin_activity_entity_idx
on public.workspace_admin_activity(workspace_id, entity_type, entity_id, occurred_at desc, id desc)
where entity_type is not null and entity_id is not null;

create index if not exists workspace_admin_activity_failure_fingerprint_idx
on public.workspace_admin_activity(workspace_id, failure_fingerprint, occurred_at desc)
where failure_fingerprint is not null;

create index if not exists workspace_admin_activity_metric_idx
on public.workspace_admin_activity(workspace_id, metric_classification, occurred_at desc);

-- Services failures have their own Activity and Maintenance ownership.
alter table public.work_items drop constraint if exists work_items_maintenance_category_check;
alter table public.work_items add constraint work_items_maintenance_category_check
check (maintenance_category is null or maintenance_category in ('services', 'leadgen', 'onboarding', 'billing', 'communications', 'integrations', 'system_health'));

alter table public.workspace_maintenance_routing
drop constraint if exists workspace_maintenance_routing_category_check;
alter table public.workspace_maintenance_routing
add constraint workspace_maintenance_routing_category_check
check (category in ('global', 'services', 'leadgen', 'onboarding', 'billing', 'communications', 'integrations', 'system_health'));

-- Stable catalogue identities. Published revision rows are immutable; one
-- mutable draft per module supports quiet autosave and last-write-wins editing.
create table if not exists public.onboarding_modules (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    internal_code text not null,
    status text not null default 'active' check (status in ('active', 'archived')),
    created_by uuid references auth.users(id) on delete set null,
    archived_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (workspace_id, internal_code),
    unique (workspace_id, id),
    check ((status = 'archived') = (archived_at is not null))
);

create table if not exists public.onboarding_module_revisions (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    module_id uuid not null,
    revision_number integer,
    status text not null default 'draft' check (status in ('draft', 'published')),
    definition jsonb not null default '{}'::jsonb check (jsonb_typeof(definition) = 'object'),
    definition_hash text not null,
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    published_by uuid references auth.users(id) on delete set null,
    published_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (workspace_id, module_id) references public.onboarding_modules(workspace_id, id) on delete cascade,
    check (
        (status = 'draft' and revision_number is null and published_at is null)
        or (status = 'published' and revision_number >= 1 and published_at is not null)
    )
);

create unique index if not exists onboarding_module_revisions_one_draft
on public.onboarding_module_revisions(module_id)
where status = 'draft';
create unique index if not exists onboarding_module_revisions_version_unique
on public.onboarding_module_revisions(module_id, revision_number)
where revision_number is not null;
create index if not exists onboarding_module_revisions_workspace_idx
on public.onboarding_module_revisions(workspace_id, module_id, status, revision_number desc);

create table if not exists public.onboarding_services (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    internal_code text not null,
    state text not null default 'active' check (state in ('active', 'retired', 'archived')),
    created_by uuid references auth.users(id) on delete set null,
    retired_at timestamptz,
    archived_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (workspace_id, internal_code),
    unique (workspace_id, id),
    check ((state = 'archived') = (archived_at is not null))
);

create table if not exists public.onboarding_service_revisions (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    service_id uuid not null,
    revision_number integer not null check (revision_number >= 1),
    name text not null,
    description text,
    default_price_cents integer not null check (default_price_cents >= 0),
    currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
    default_assignee_user_id uuid references auth.users(id) on delete set null,
    is_test boolean not null default false,
    display_priority integer not null default 0 check (display_priority between 0 and 10000),
    fulfilment_definition_revision_id uuid,
    definition jsonb not null default '{}'::jsonb check (jsonb_typeof(definition) = 'object'),
    created_by uuid references auth.users(id) on delete set null,
    published_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    foreign key (workspace_id, service_id) references public.onboarding_services(workspace_id, id) on delete cascade,
    unique (service_id, revision_number),
    unique (workspace_id, id)
);

create table if not exists public.onboarding_service_revision_modules (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    service_revision_id uuid not null,
    module_id uuid not null,
    sort_order integer not null check (sort_order >= 0),
    created_at timestamptz not null default now(),
    foreign key (workspace_id, service_revision_id) references public.onboarding_service_revisions(workspace_id, id) on delete cascade,
    foreign key (workspace_id, module_id) references public.onboarding_modules(workspace_id, id) on delete restrict,
    primary key (service_revision_id, module_id),
    unique (service_revision_id, sort_order)
);

-- Mandatory modules and both singleton bookends share one revision mechanism.
create table if not exists public.onboarding_configuration_revisions (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    configuration_type text not null check (configuration_type in ('mandatory_modules', 'welcome', 'completion')),
    whatsapp_enabled boolean not null default true,
    revision_number integer,
    status text not null default 'draft' check (status in ('draft', 'published')),
    definition jsonb not null default '{}'::jsonb check (jsonb_typeof(definition) = 'object'),
    definition_hash text not null,
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    published_by uuid references auth.users(id) on delete set null,
    published_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (workspace_id, id),
    check (
        (status = 'draft' and revision_number is null and published_at is null)
        or (status = 'published' and revision_number >= 1 and published_at is not null)
    )
);

create unique index if not exists onboarding_configuration_one_draft
on public.onboarding_configuration_revisions(workspace_id, configuration_type)
where status = 'draft';
create unique index if not exists onboarding_configuration_version_unique
on public.onboarding_configuration_revisions(workspace_id, configuration_type, revision_number)
where revision_number is not null;

create table if not exists public.onboarding_configuration_revision_modules (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    configuration_revision_id uuid not null,
    module_id uuid not null,
    sort_order integer not null check (sort_order >= 0),
    created_at timestamptz not null default now(),
    foreign key (workspace_id, configuration_revision_id) references public.onboarding_configuration_revisions(workspace_id, id) on delete cascade,
    foreign key (workspace_id, module_id) references public.onboarding_modules(workspace_id, id) on delete restrict,
    primary key (configuration_revision_id, module_id),
    unique (configuration_revision_id, sort_order)
);

create table if not exists public.onboarding_brand_swatches (
    id text not null,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    name text not null,
    hex text not null check (hex ~ '^#[0-9A-F]{6}$'),
    hidden boolean not null default false,
    hidden_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (workspace_id, id)
);

create table if not exists public.onboarding_themes (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
    assignments jsonb not null default '{}'::jsonb check (jsonb_typeof(assignments) = 'object'),
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.onboarding_preview_tokens (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    module_id uuid not null,
    token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
    expires_at timestamptz not null,
    revoked_at timestamptz,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    foreign key (workspace_id, module_id) references public.onboarding_modules(workspace_id, id) on delete cascade,
    check (expires_at > created_at)
);
create index if not exists onboarding_preview_tokens_module_idx
on public.onboarding_preview_tokens(workspace_id, module_id, created_at desc);

-- A sent sale freezes exact service and onboarding revisions.  Legacy JSON is
-- retained during cutover, but new runtime code reads these normalized rows.
alter table public.relationship_services
    add column if not exists service_id uuid,
    add column if not exists service_revision_id uuid;

alter table public.client_sales
    add column if not exists snapshot_frozen_at timestamptz,
    add column if not exists configuration_revision_id uuid,
    add column if not exists welcome_revision_id uuid,
    add column if not exists completion_revision_id uuid,
    add column if not exists composition_hash text,
    add column if not exists onboarding_session_id uuid,
    add column if not exists correlation_id uuid;

create table if not exists public.client_sale_items (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    client_sale_id uuid not null references public.client_sales(id) on delete cascade,
    service_id uuid not null,
    service_revision_id uuid not null,
    service_code text not null,
    service_name text not null,
    description text,
    amount_cents integer not null check (amount_cents >= 0),
    currency text not null check (currency ~ '^[A-Z]{3}$'),
    default_assignee_user_id uuid references auth.users(id) on delete set null,
    display_priority integer not null default 0,
    sort_order integer not null default 0,
    fulfilment_definition_revision_id uuid,
    created_at timestamptz not null default now(),
    foreign key (workspace_id, service_id) references public.onboarding_services(workspace_id, id) on delete restrict,
    foreign key (workspace_id, service_revision_id) references public.onboarding_service_revisions(workspace_id, id) on delete restrict,
    unique (client_sale_id, service_id),
    unique (workspace_id, id)
);

create table if not exists public.client_sale_composition_items (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    client_sale_id uuid not null references public.client_sales(id) on delete cascade,
    item_kind text not null check (item_kind in ('welcome', 'module', 'completion')),
    source_kind text not null check (source_kind in ('bookend', 'mandatory', 'service')),
    module_id uuid,
    module_revision_id uuid,
    configuration_revision_id uuid,
    source_service_item_id uuid,
    source_service_revision_id uuid,
    sort_order integer not null check (sort_order >= 0),
    definition jsonb not null check (jsonb_typeof(definition) = 'object'),
    source_references jsonb not null default '{}'::jsonb check (jsonb_typeof(source_references) = 'object'),
    created_at timestamptz not null default now(),
    foreign key (workspace_id, module_id) references public.onboarding_modules(workspace_id, id) on delete restrict,
    foreign key (workspace_id, module_revision_id) references public.onboarding_module_revisions(workspace_id, id) on delete restrict,
    foreign key (workspace_id, configuration_revision_id) references public.onboarding_configuration_revisions(workspace_id, id) on delete restrict,
    foreign key (workspace_id, source_service_item_id) references public.client_sale_items(workspace_id, id) on delete restrict,
    foreign key (workspace_id, source_service_revision_id) references public.onboarding_service_revisions(workspace_id, id) on delete restrict,
    unique (client_sale_id, sort_order),
    check (
        (item_kind = 'module' and module_id is not null and module_revision_id is not null)
        or (item_kind in ('welcome', 'completion') and configuration_revision_id is not null)
    )
);

-- Session snapshots are addressed by immutable UUIDs rather than editable keys.
alter table public.relationship_onboarding_sessions
    add column if not exists source_sale_id uuid references public.client_sales(id) on delete restrict,
    add column if not exists configuration_revision_id uuid references public.onboarding_configuration_revisions(id) on delete restrict,
    add column if not exists welcome_revision_id uuid references public.onboarding_configuration_revisions(id) on delete restrict,
    add column if not exists completion_revision_id uuid references public.onboarding_configuration_revisions(id) on delete restrict,
    add column if not exists snapshot_schema_version integer not null default 1,
    add column if not exists composition_hash text,
    add column if not exists composition_snapshot jsonb not null default '{}'::jsonb,
    add column if not exists token_version integer not null default 1,
    add column if not exists token_revoked_at timestamptz;
create unique index if not exists relationship_onboarding_sessions_source_sale_unique
on public.relationship_onboarding_sessions(source_sale_id)
where source_sale_id is not null;

create table if not exists public.relationship_onboarding_session_modules (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    session_id uuid not null references public.relationship_onboarding_sessions(id) on delete cascade,
    module_id uuid not null,
    module_revision_id uuid not null,
    source_kind text not null check (source_kind in ('mandatory', 'service')),
    source_service_revision_id uuid,
    sort_order integer not null check (sort_order >= 0),
    title text not null,
    description text,
    is_test boolean not null default false,
    created_at timestamptz not null default now(),
    foreign key (workspace_id, module_id) references public.onboarding_modules(workspace_id, id) on delete restrict,
    foreign key (workspace_id, module_revision_id) references public.onboarding_module_revisions(workspace_id, id) on delete restrict,
    foreign key (workspace_id, source_service_revision_id) references public.onboarding_service_revisions(workspace_id, id) on delete restrict,
    unique (session_id, module_id),
    unique (session_id, sort_order),
    unique (workspace_id, id)
);

create table if not exists public.relationship_onboarding_session_steps (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    session_id uuid not null references public.relationship_onboarding_sessions(id) on delete cascade,
    session_module_id uuid,
    source_step_id uuid,
    module_revision_id uuid,
    bookend_revision_id uuid,
    kind text not null check (kind in ('form', 'video', 'welcome', 'completion')),
    title text not null,
    description text,
    estimated_time text,
    why_we_ask text,
    video_url text,
    video_storage_path text,
    sort_order integer not null check (sort_order >= 0),
    legacy_step_key text,
    legacy_form_key text,
    created_at timestamptz not null default now(),
    foreign key (workspace_id, session_module_id) references public.relationship_onboarding_session_modules(workspace_id, id) on delete cascade,
    foreign key (workspace_id, module_revision_id) references public.onboarding_module_revisions(workspace_id, id) on delete restrict,
    foreign key (workspace_id, bookend_revision_id) references public.onboarding_configuration_revisions(workspace_id, id) on delete restrict,
    unique (session_id, sort_order),
    unique (workspace_id, id),
    check (
        (kind in ('form', 'video') and session_module_id is not null and module_revision_id is not null and source_step_id is not null)
        or (kind in ('welcome', 'completion') and session_module_id is null and bookend_revision_id is not null)
    )
);

create table if not exists public.relationship_onboarding_session_fields (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    session_id uuid not null references public.relationship_onboarding_sessions(id) on delete cascade,
    session_step_id uuid not null,
    source_field_id uuid not null,
    type text not null check (type in ('text', 'email', 'tel', 'url', 'textarea', 'file')),
    label text not null,
    required boolean not null default false,
    help_text text,
    placeholder text,
    file_accept text check (file_accept is null or file_accept in ('image', 'video', 'document', 'any')),
    multiple boolean not null default false,
    sort_order integer not null check (sort_order >= 0),
    legacy_field_name text,
    created_at timestamptz not null default now(),
    foreign key (workspace_id, session_step_id) references public.relationship_onboarding_session_steps(workspace_id, id) on delete cascade,
    unique (session_step_id, source_field_id),
    unique (session_step_id, sort_order)
);

create table if not exists public.onboarding_step_drafts (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    session_id uuid not null references public.relationship_onboarding_sessions(id) on delete cascade,
    session_step_id uuid not null,
    response jsonb not null default '{}'::jsonb check (jsonb_typeof(response) = 'object'),
    lock_version integer not null default 1 check (lock_version >= 1),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (workspace_id, session_step_id) references public.relationship_onboarding_session_steps(workspace_id, id) on delete cascade,
    primary key (session_step_id)
);

create table if not exists public.onboarding_edit_requests (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null references public.relationships(id) on delete cascade,
    session_id uuid not null references public.relationship_onboarding_sessions(id) on delete cascade,
    session_step_id uuid not null,
    status text not null default 'pending' check (status in ('pending', 'superseded')),
    requested_at timestamptz not null default now(),
    superseded_at timestamptz,
    foreign key (workspace_id, session_step_id) references public.relationship_onboarding_session_steps(workspace_id, id) on delete cascade
);
create unique index if not exists onboarding_edit_requests_one_pending
on public.onboarding_edit_requests(session_step_id)
where status = 'pending';

create table if not exists public.onboarding_delivery_outbox (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid references public.relationships(id) on delete cascade,
    session_id uuid references public.relationship_onboarding_sessions(id) on delete cascade,
    correlation_id uuid not null default gen_random_uuid(),
    kind text not null check (kind in ('onboarding_link', 'module_update')),
    status text not null default 'queued' check (status in ('queued', 'processing', 'sent', 'failed', 'canceled')),
    destination text not null,
    payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
    idempotency_key text not null,
    attempt_count integer not null default 0 check (attempt_count >= 0),
    next_attempt_at timestamptz not null default now(),
    locked_at timestamptz,
    sent_at timestamptz,
    provider_message_id text,
    error_code text,
    error_summary text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (workspace_id, idempotency_key)
);
create index if not exists onboarding_delivery_outbox_queue_idx
on public.onboarding_delivery_outbox(status, next_attempt_at, created_at)
where status in ('queued', 'failed');

-- Standard updated-at triggers.
drop trigger if exists onboarding_modules_updated_at on public.onboarding_modules;
create trigger onboarding_modules_updated_at before update on public.onboarding_modules
for each row execute function public.set_updated_at();
drop trigger if exists onboarding_module_revisions_updated_at on public.onboarding_module_revisions;
create trigger onboarding_module_revisions_updated_at before update on public.onboarding_module_revisions
for each row execute function public.set_updated_at();
drop trigger if exists onboarding_services_updated_at on public.onboarding_services;
create trigger onboarding_services_updated_at before update on public.onboarding_services
for each row execute function public.set_updated_at();
drop trigger if exists onboarding_configuration_revisions_updated_at on public.onboarding_configuration_revisions;
create trigger onboarding_configuration_revisions_updated_at before update on public.onboarding_configuration_revisions
for each row execute function public.set_updated_at();
drop trigger if exists onboarding_brand_swatches_updated_at on public.onboarding_brand_swatches;
create trigger onboarding_brand_swatches_updated_at before update on public.onboarding_brand_swatches
for each row execute function public.set_updated_at();
drop trigger if exists onboarding_themes_updated_at on public.onboarding_themes;
create trigger onboarding_themes_updated_at before update on public.onboarding_themes
for each row execute function public.set_updated_at();
drop trigger if exists onboarding_step_drafts_updated_at on public.onboarding_step_drafts;
create trigger onboarding_step_drafts_updated_at before update on public.onboarding_step_drafts
for each row execute function public.set_updated_at();
drop trigger if exists onboarding_delivery_outbox_updated_at on public.onboarding_delivery_outbox;
create trigger onboarding_delivery_outbox_updated_at before update on public.onboarding_delivery_outbox
for each row execute function public.set_updated_at();

create or replace function public.sanitize_admin_activity_json(value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
    result jsonb;
    item record;
    element jsonb;
    primitive_text text;
begin
    if value is null then return '{}'::jsonb; end if;
    if jsonb_typeof(value) = 'object' then
        result := '{}'::jsonb;
        for item in select key, val from jsonb_each(value) as entry(key, val) loop
            if lower(item.key) = any(array[
                'password', 'passwords', 'secret', 'secrets', 'credential', 'credentials',
                'access_token', 'refresh_token', 'session_token', 'answer', 'answers',
                'response', 'form_response', 'definition', 'file_contents', 'raw_payload',
                'authorization', 'proxy_authorization', 'cookie', 'cookies', 'set_cookie',
                'token', 'tokens', 'id_token', 'api_token', 'bearer_token', 'client_secret',
                'api_key', 'apikey', 'x_api_key', 'body', 'request_body', 'response_body',
                'payload', 'request_payload', 'response_payload', 'phone', 'client_phone',
                'primary_phone', 'email', 'client_email', 'primary_email'
            ]) or lower(item.key) ~ '(^|_)(password|secret|credential|token|phone|email)$' then
                continue;
            end if;
            if lower(item.key) = any(array[
                'error_code', 'provider_message_id', 'composition_hash',
                'definition_hash', 'failure_fingerprint'
            ]) and jsonb_typeof(item.val) = 'string' then
                result := result || jsonb_build_object(item.key, left(item.val #>> '{}', 200));
                continue;
            end if;
            result := result || jsonb_build_object(item.key, public.sanitize_admin_activity_json(item.val));
        end loop;
        return result;
    end if;
    if jsonb_typeof(value) = 'array' then
        result := '[]'::jsonb;
        for element in select array_value from jsonb_array_elements(value) as values_list(array_value) loop
            result := result || jsonb_build_array(public.sanitize_admin_activity_json(element));
        end loop;
        return result;
    end if;
    if jsonb_typeof(value) = 'string' then
        primitive_text := left(value #>> '{}', 1000);
        primitive_text := regexp_replace(
            primitive_text,
            'Bearer[[:space:]]+[A-Za-z0-9._~+/=-]+',
            'Bearer [REDACTED]', 'gi'
        );
        primitive_text := regexp_replace(
            primitive_text,
            '(authorization|password|secret|client[_-]?secret|api[_-]?key|token|answer|response|body|payload)[[:space:]]*[:=][[:space:]]*[^[:space:],;]+',
            '[REDACTED CREDENTIAL]', 'gi'
        );
        primitive_text := regexp_replace(
            primitive_text,
            '[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
            '[REDACTED EMAIL]', 'gi'
        );
        primitive_text := regexp_replace(
            primitive_text,
            '\+[0-9][0-9 ()-]{7,}[0-9]',
            '[REDACTED PHONE]', 'g'
        );
        primitive_text := regexp_replace(
            primitive_text,
            '[A-Fa-f0-9]{32,}',
            '[REDACTED TOKEN]', 'g'
        );
        return to_jsonb(primitive_text);
    end if;
    return value;
end;
$$;

create or replace function public.require_onboarding_admin_actor(
    p_workspace_id uuid,
    p_actor_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
    if current_user <> 'service_role' and auth.uid() is distinct from p_actor_user_id then
        raise exception using errcode = '42501', message = 'The authenticated actor does not match this mutation';
    end if;
    if p_workspace_id is null or p_actor_user_id is null or not exists (
        select 1
        from public.workspace_memberships membership
        where membership.workspace_id = p_workspace_id
          and membership.user_id = p_actor_user_id
          and membership.role in ('owner', 'admin')
    ) then
        raise exception using errcode = '42501', message = 'Owner or Admin access is required';
    end if;
end;
$$;

create or replace function public.record_workspace_admin_activity(
    p_workspace_id uuid,
    p_category text,
    p_event_key text,
    p_summary text,
    p_level text default 'info',
    p_entity_type text default null,
    p_entity_id text default null,
    p_source_href text default null,
    p_actor_user_id uuid default null,
    p_actor_kind text default 'automation',
    p_metadata jsonb default '{}'::jsonb,
    p_diagnostics jsonb default '{}'::jsonb,
    p_occurred_at timestamptz default now(),
    p_correlation_id uuid default null,
    p_causation_event_id uuid default null,
    p_idempotency_key text default null,
    p_outcome text default 'succeeded',
    p_metric_classification text default 'audit',
    p_failure_fingerprint text default null,
    p_maintenance_work_item_id uuid default null,
    p_coalesce boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_event_id uuid;
    v_correlation_id uuid := coalesce(p_correlation_id, gen_random_uuid());
    v_metadata jsonb := public.sanitize_admin_activity_json(coalesce(p_metadata, '{}'::jsonb));
    v_diagnostics jsonb := public.sanitize_admin_activity_json(coalesce(p_diagnostics, '{}'::jsonb));
begin
    if current_user <> 'service_role' and not public.is_workspace_member(p_workspace_id, array['owner','admin']) then
        raise exception using errcode = '42501', message = 'Admin Activity may only be recorded by a workspace Admin or trusted automation';
    end if;
    if p_workspace_id is null then raise exception 'Activity workspace is required'; end if;
    if nullif(trim(p_event_key), '') is null then raise exception 'Activity event key is required'; end if;
    if nullif(trim(p_summary), '') is null then raise exception 'Activity summary is required'; end if;
    if p_causation_event_id is not null and not exists (
        select 1 from public.workspace_admin_activity
        where id = p_causation_event_id and workspace_id = p_workspace_id
    ) then raise exception 'Causation event must belong to the same workspace'; end if;
    if p_maintenance_work_item_id is not null and not exists (
        select 1 from public.work_items
        where id = p_maintenance_work_item_id and workspace_id = p_workspace_id
    ) then raise exception 'Maintenance work must belong to the same workspace'; end if;

    insert into public.workspace_admin_activity (
        workspace_id, category, level, event_key, summary, entity_type, entity_id,
        source_href, actor_user_id, actor_kind, metadata, diagnostics, occurred_at,
        correlation_id, causation_event_id, idempotency_key, outcome,
        metric_classification, failure_fingerprint, maintenance_work_item_id
    ) values (
        p_workspace_id, p_category, p_level, trim(p_event_key), trim(p_summary),
        nullif(trim(p_entity_type), ''), nullif(trim(p_entity_id), ''), p_source_href,
        p_actor_user_id, p_actor_kind, v_metadata, v_diagnostics,
        coalesce(p_occurred_at, now()), v_correlation_id, p_causation_event_id,
        nullif(trim(p_idempotency_key), ''), p_outcome, p_metric_classification,
        nullif(trim(p_failure_fingerprint), ''), p_maintenance_work_item_id
    )
    on conflict (workspace_id, idempotency_key)
    where idempotency_key is not null
    do update set
        summary = excluded.summary,
        level = excluded.level,
        metadata = public.workspace_admin_activity.metadata || excluded.metadata,
        diagnostics = public.workspace_admin_activity.diagnostics || excluded.diagnostics,
        outcome = excluded.outcome,
        occurred_at = excluded.occurred_at,
        maintenance_work_item_id = coalesce(excluded.maintenance_work_item_id, public.workspace_admin_activity.maintenance_work_item_id)
    where p_coalesce
    returning id into v_event_id;

    if v_event_id is null and nullif(trim(p_idempotency_key), '') is not null then
        select id into v_event_id
        from public.workspace_admin_activity
        where workspace_id = p_workspace_id and idempotency_key = trim(p_idempotency_key);
    end if;
    return v_event_id;
end;
$$;

create or replace function public.prevent_published_onboarding_revision_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if old.status = 'published' then
        if tg_op = 'DELETE' and (
            not exists (select 1 from public.workspaces where id = old.workspace_id)
            or (
                tg_table_name = 'onboarding_module_revisions'
                and not exists (
                    select 1 from public.onboarding_modules
                    where id = (to_jsonb(old)->>'module_id')::uuid
                )
            )
        ) then
            return old;
        end if;
        raise exception 'Published onboarding revisions are immutable';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists prevent_published_onboarding_module_revision_mutation on public.onboarding_module_revisions;
create trigger prevent_published_onboarding_module_revision_mutation
before update or delete on public.onboarding_module_revisions
for each row execute function public.prevent_published_onboarding_revision_mutation();

drop trigger if exists prevent_published_onboarding_configuration_revision_mutation on public.onboarding_configuration_revisions;
create trigger prevent_published_onboarding_configuration_revision_mutation
before update or delete on public.onboarding_configuration_revisions
for each row execute function public.prevent_published_onboarding_revision_mutation();

create or replace function public.prevent_onboarding_service_revision_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if tg_op = 'DELETE' and (
        not exists (select 1 from public.workspaces where id = old.workspace_id)
        or not exists (select 1 from public.onboarding_services where id = old.service_id)
    ) then
        return old;
    end if;
    raise exception 'Published service revisions are immutable';
end;
$$;

drop trigger if exists prevent_onboarding_service_revision_mutation on public.onboarding_service_revisions;
create trigger prevent_onboarding_service_revision_mutation
before update or delete on public.onboarding_service_revisions
for each row execute function public.prevent_onboarding_service_revision_mutation();

create or replace function public.prevent_onboarding_identity_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.id is distinct from old.id
       or new.workspace_id is distinct from old.workspace_id
       or new.internal_code is distinct from old.internal_code then
        raise exception 'Onboarding identity and internal code are immutable';
    end if;
    return new;
end;
$$;
drop trigger if exists prevent_onboarding_module_identity_mutation on public.onboarding_modules;
create trigger prevent_onboarding_module_identity_mutation
before update on public.onboarding_modules
for each row execute function public.prevent_onboarding_identity_mutation();
drop trigger if exists prevent_onboarding_service_identity_mutation on public.onboarding_services;
create trigger prevent_onboarding_service_identity_mutation
before update on public.onboarding_services
for each row execute function public.prevent_onboarding_identity_mutation();

create or replace function public.prevent_onboarding_service_assignment_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
    if tg_op = 'INSERT' then
        if current_user <> 'service_role' then
            raise exception 'Published service assignments may only be inserted by a trusted revision transaction';
        end if;
        return new;
    end if;
    if tg_op = 'DELETE' and (
        not exists (select 1 from public.workspaces where id = old.workspace_id)
        or not exists (
            select 1 from public.onboarding_service_revisions
            where id = old.service_revision_id and workspace_id = old.workspace_id
        )
    ) then return old; end if;
    raise exception 'Published service assignments are immutable';
end;
$$;
drop trigger if exists prevent_onboarding_service_assignment_mutation on public.onboarding_service_revision_modules;
create trigger prevent_onboarding_service_assignment_mutation
before insert or update or delete on public.onboarding_service_revision_modules
for each row execute function public.prevent_onboarding_service_assignment_mutation();

create or replace function public.prevent_published_onboarding_configuration_assignment_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    v_revision_id uuid := case when tg_op = 'DELETE' then old.configuration_revision_id else new.configuration_revision_id end;
    v_workspace_id uuid := case when tg_op = 'DELETE' then old.workspace_id else new.workspace_id end;
    v_status text;
begin
    select status into v_status
    from public.onboarding_configuration_revisions
    where workspace_id = v_workspace_id and id = v_revision_id;
    if tg_op = 'DELETE' and (
        not exists (select 1 from public.workspaces where id = v_workspace_id)
        or v_status is null
    ) then return old; end if;
    if v_status = 'published' then
        if tg_op = 'INSERT' and current_user = 'service_role' then return new; end if;
        raise exception 'Published onboarding configuration assignments are immutable';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists prevent_published_onboarding_configuration_assignment_mutation on public.onboarding_configuration_revision_modules;
create trigger prevent_published_onboarding_configuration_assignment_mutation
before insert or update or delete on public.onboarding_configuration_revision_modules
for each row execute function public.prevent_published_onboarding_configuration_assignment_mutation();

-- Authenticated workspace users receive read-only access to the catalogue and
-- session snapshots. Every write is intentionally service-role-only so it must
-- pass through a tenant-validating RPC that records the consequential Activity;
-- drafts, preview links, and outbox mutations have no authenticated policy.
alter table public.onboarding_modules enable row level security;
alter table public.onboarding_module_revisions enable row level security;
alter table public.onboarding_services enable row level security;
alter table public.onboarding_service_revisions enable row level security;
alter table public.onboarding_service_revision_modules enable row level security;
alter table public.onboarding_configuration_revisions enable row level security;
alter table public.onboarding_configuration_revision_modules enable row level security;
alter table public.onboarding_brand_swatches enable row level security;
alter table public.onboarding_themes enable row level security;
alter table public.onboarding_preview_tokens enable row level security;
alter table public.client_sale_items enable row level security;
alter table public.client_sale_composition_items enable row level security;
alter table public.relationship_onboarding_session_modules enable row level security;
alter table public.relationship_onboarding_session_steps enable row level security;
alter table public.relationship_onboarding_session_fields enable row level security;
alter table public.onboarding_step_drafts enable row level security;
alter table public.onboarding_edit_requests enable row level security;
alter table public.onboarding_delivery_outbox enable row level security;

create policy "workspace members read onboarding modules" on public.onboarding_modules
for select using (public.is_workspace_member(workspace_id, array['owner','admin']));
create policy "workspace members read published onboarding module revisions" on public.onboarding_module_revisions
for select using (status = 'published' and public.is_workspace_member(workspace_id, array['owner','admin']));

create policy "workspace members read onboarding services" on public.onboarding_services
for select using (public.is_workspace_member(workspace_id, array['owner','admin']));
create policy "workspace members read onboarding service revisions" on public.onboarding_service_revisions
for select using (public.is_workspace_member(workspace_id, array['owner','admin']));
create policy "workspace members read onboarding service assignments" on public.onboarding_service_revision_modules
for select using (public.is_workspace_member(workspace_id, array['owner','admin']));

create policy "workspace members read published onboarding configuration" on public.onboarding_configuration_revisions
for select using (status = 'published' and public.is_workspace_member(workspace_id, array['owner','admin']));
create policy "workspace members read published onboarding configuration modules" on public.onboarding_configuration_revision_modules
for select using (
    public.is_workspace_member(workspace_id, array['owner','admin'])
    and exists (select 1 from public.onboarding_configuration_revisions revision where revision.id = configuration_revision_id and revision.status = 'published')
);

create policy "workspace members read onboarding brand swatches" on public.onboarding_brand_swatches
for select using (public.is_workspace_member(workspace_id, array['owner','admin']));
create policy "workspace members read onboarding themes" on public.onboarding_themes
for select using (public.is_workspace_member(workspace_id, array['owner','admin']));

create policy "workspace members read client sale items" on public.client_sale_items
for select using (public.is_workspace_member(workspace_id));
create policy "workspace members read client sale composition" on public.client_sale_composition_items
for select using (public.is_workspace_member(workspace_id));

create policy "workspace members read onboarding session modules" on public.relationship_onboarding_session_modules
for select using (public.is_workspace_member(workspace_id));
create policy "workspace members read onboarding session steps" on public.relationship_onboarding_session_steps
for select using (public.is_workspace_member(workspace_id));
create policy "workspace members read onboarding session fields" on public.relationship_onboarding_session_fields
for select using (public.is_workspace_member(workspace_id));

-- No staff SELECT policy is deliberately created for onboarding_step_drafts.
create policy "workspace admins read onboarding edit requests" on public.onboarding_edit_requests
for select using (public.is_workspace_member(workspace_id));
create policy "workspace admins read onboarding delivery outbox" on public.onboarding_delivery_outbox
for select using (public.is_workspace_member(workspace_id, array['owner','admin']));

-- Composite keys make every duplicated workspace_id a real tenancy boundary,
-- rather than a caller-supplied label that can disagree with its parent row.
alter table public.relationships
    add constraint relationships_workspace_id_id_unique unique (workspace_id, id);
alter table public.client_sales
    add constraint client_sales_workspace_id_id_unique unique (workspace_id, id);
alter table public.relationship_onboarding_sessions
    add constraint relationship_onboarding_sessions_workspace_id_id_unique unique (workspace_id, id);

alter table public.relationship_onboarding_sessions
    add constraint relationship_onboarding_sessions_relationship_workspace_fkey
        foreign key (workspace_id, relationship_id) references public.relationships(workspace_id, id) on delete cascade,
    add constraint relationship_onboarding_sessions_source_sale_workspace_fkey
        foreign key (workspace_id, source_sale_id) references public.client_sales(workspace_id, id) on delete restrict;

alter table public.relationship_services
    add constraint relationship_services_service_workspace_fkey
        foreign key (workspace_id, service_id) references public.onboarding_services(workspace_id, id) on delete restrict,
    add constraint relationship_services_service_revision_workspace_fkey
        foreign key (workspace_id, service_revision_id) references public.onboarding_service_revisions(workspace_id, id) on delete restrict;

alter table public.client_sales
    add constraint client_sales_configuration_revision_fkey
        foreign key (workspace_id, configuration_revision_id) references public.onboarding_configuration_revisions(workspace_id, id) on delete restrict,
    add constraint client_sales_welcome_revision_fkey
        foreign key (workspace_id, welcome_revision_id) references public.onboarding_configuration_revisions(workspace_id, id) on delete restrict,
    add constraint client_sales_completion_revision_fkey
        foreign key (workspace_id, completion_revision_id) references public.onboarding_configuration_revisions(workspace_id, id) on delete restrict,
    add constraint client_sales_onboarding_session_fkey
        foreign key (workspace_id, onboarding_session_id) references public.relationship_onboarding_sessions(workspace_id, id) on delete restrict;

alter table public.client_sale_items
    add constraint client_sale_items_sale_workspace_fkey
        foreign key (workspace_id, client_sale_id) references public.client_sales(workspace_id, id) on delete cascade;
alter table public.client_sale_composition_items
    add constraint client_sale_composition_sale_workspace_fkey
        foreign key (workspace_id, client_sale_id) references public.client_sales(workspace_id, id) on delete cascade;
alter table public.relationship_onboarding_session_modules
    add constraint onboarding_session_modules_session_workspace_fkey
        foreign key (workspace_id, session_id) references public.relationship_onboarding_sessions(workspace_id, id) on delete cascade;
alter table public.relationship_onboarding_session_steps
    add constraint onboarding_session_steps_session_workspace_fkey
        foreign key (workspace_id, session_id) references public.relationship_onboarding_sessions(workspace_id, id) on delete cascade;
alter table public.relationship_onboarding_session_fields
    add constraint onboarding_session_fields_session_workspace_fkey
        foreign key (workspace_id, session_id) references public.relationship_onboarding_sessions(workspace_id, id) on delete cascade;
alter table public.onboarding_step_drafts
    add constraint onboarding_step_drafts_session_workspace_fkey
        foreign key (workspace_id, session_id) references public.relationship_onboarding_sessions(workspace_id, id) on delete cascade;
alter table public.onboarding_edit_requests
    add constraint onboarding_edit_requests_relationship_workspace_fkey
        foreign key (workspace_id, relationship_id) references public.relationships(workspace_id, id) on delete cascade,
    add constraint onboarding_edit_requests_session_workspace_fkey
        foreign key (workspace_id, session_id) references public.relationship_onboarding_sessions(workspace_id, id) on delete cascade;
alter table public.onboarding_delivery_outbox
    add constraint onboarding_delivery_outbox_relationship_workspace_fkey
        foreign key (workspace_id, relationship_id) references public.relationships(workspace_id, id) on delete cascade,
    add constraint onboarding_delivery_outbox_session_workspace_fkey
        foreign key (workspace_id, session_id) references public.relationship_onboarding_sessions(workspace_id, id) on delete cascade;

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
    v_step_ids uuid[] := '{}'::uuid[];
    v_field_ids uuid[];
    v_id uuid;
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
        if nullif(trim(v_step->>'title'), '') is null then raise exception 'Every step requires a title'; end if;
        if coalesce(v_step->>'kind', '') not in ('form', 'video') then raise exception 'Unknown onboarding step type'; end if;
        if v_step->>'kind' = 'form' then
            if jsonb_typeof(v_step->'fields') <> 'array' then raise exception 'Form steps require a fields array'; end if;
            v_field_ids := '{}'::uuid[];
            for v_field in select value from jsonb_array_elements(v_step->'fields') loop
                begin v_id := (v_field->>'id')::uuid;
                exception when others then raise exception 'Every field requires a stable UUID'; end;
                if v_id = any(v_field_ids) then raise exception 'Field IDs must be unique within a step'; end if;
                v_field_ids := array_append(v_field_ids, v_id);
                if nullif(trim(v_field->>'label'), '') is null then raise exception 'Every field requires a label'; end if;
                if coalesce(v_field->>'type', '') not in ('text', 'email', 'tel', 'url', 'textarea', 'file') then
                    raise exception 'Unknown onboarding field type';
                end if;
            end loop;
        end if;
    end loop;
end;
$$;

create or replace function public.onboarding_internal_code(p_prefix text, p_name text, p_id uuid)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
    select left(
        trim(both '-' from lower(regexp_replace(coalesce(nullif(trim(p_name), ''), p_prefix), '[^a-zA-Z0-9]+', '-', 'g')))
        || '-' || left(replace(p_id::text, '-', ''), 8),
        120
    );
$$;

create or replace function public.rekey_onboarding_module_definition(p_definition jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
    v_result jsonb := coalesce(p_definition, '{}'::jsonb) - 'steps';
    v_steps jsonb := '[]'::jsonb;
    v_fields jsonb;
    v_step jsonb;
    v_field jsonb;
    v_step_id uuid;
    v_field_id uuid;
begin
    for v_step in select value from jsonb_array_elements(coalesce(p_definition->'steps', '[]'::jsonb)) loop
        v_step_id := gen_random_uuid();
        v_fields := '[]'::jsonb;
        for v_field in select value from jsonb_array_elements(coalesce(v_step->'fields', '[]'::jsonb)) loop
            v_field_id := gen_random_uuid();
            v_fields := v_fields || jsonb_build_array(v_field || jsonb_build_object(
                'id', v_field_id,
                'key', 'field-' || left(replace(v_field_id::text, '-', ''), 12)
            ));
        end loop;
        v_steps := v_steps || jsonb_build_array(v_step || jsonb_build_object(
            'id', v_step_id,
            'key', 'step-' || left(replace(v_step_id::text, '-', ''), 12),
            'fields', v_fields
        ));
    end loop;
    return v_result || jsonb_build_object(
        'name', left('Copy of ' || coalesce(p_definition->>'name', 'module'), 120),
        'steps', v_steps
    );
end;
$$;

create or replace function public.create_onboarding_module(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_definition jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_module_id uuid := gen_random_uuid();
    v_revision_id uuid;
    v_definition jsonb := coalesce(p_definition, '{}'::jsonb);
    v_name text;
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    if jsonb_typeof(v_definition) <> 'object' then raise exception 'Module definition must be an object'; end if;
    v_name := coalesce(nullif(trim(v_definition->>'name'), ''), 'Untitled module');
    v_definition := v_definition || jsonb_build_object('name', v_name);
    insert into public.onboarding_modules (id, workspace_id, internal_code, created_by)
    values (v_module_id, p_workspace_id, public.onboarding_internal_code('module', v_name, v_module_id), p_actor_user_id);
    insert into public.onboarding_module_revisions (
        workspace_id, module_id, status, definition, definition_hash, created_by, updated_by
    ) values (
        p_workspace_id, v_module_id, 'draft', v_definition, md5(v_definition::text), p_actor_user_id, p_actor_user_id
    ) returning id into v_revision_id;
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.module.created', 'Onboarding module created',
        p_entity_type => 'onboarding_module', p_entity_id => v_module_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_metadata => jsonb_build_object('draft_revision_id', v_revision_id),
        p_idempotency_key => 'onboarding.module.created:' || v_module_id
    );
    return jsonb_build_object('module_id', v_module_id, 'draft_revision_id', v_revision_id);
end;
$$;

create or replace function public.save_onboarding_module_draft(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_module_id uuid,
    p_definition jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_revision_id uuid;
    v_updated_at timestamptz;
    v_window bigint := floor(extract(epoch from now()) / 900);
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    if jsonb_typeof(p_definition) <> 'object' then raise exception 'Module definition must be an object'; end if;
    if not exists (select 1 from public.onboarding_modules where id = p_module_id and workspace_id = p_workspace_id and status = 'active') then
        raise exception 'Active onboarding module not found';
    end if;
    update public.onboarding_module_revisions
    set definition = p_definition, definition_hash = md5(p_definition::text), updated_by = p_actor_user_id
    where workspace_id = p_workspace_id and module_id = p_module_id and status = 'draft'
    returning id, updated_at into v_revision_id, v_updated_at;
    if v_revision_id is null then
        insert into public.onboarding_module_revisions (
            workspace_id, module_id, status, definition, definition_hash, created_by, updated_by
        ) values (
            p_workspace_id, p_module_id, 'draft', p_definition, md5(p_definition::text), p_actor_user_id, p_actor_user_id
        ) returning id, updated_at into v_revision_id, v_updated_at;
    end if;
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.module.edit_session', 'Onboarding module draft edited',
        p_entity_type => 'onboarding_module', p_entity_id => p_module_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_metadata => jsonb_build_object('draft_revision_id', v_revision_id, 'editing_window_minutes', 15),
        p_idempotency_key => format('onboarding.module.edit:%s:%s:%s', p_module_id, p_actor_user_id, v_window),
        p_coalesce => true
    );
    return jsonb_build_object('module_id', p_module_id, 'draft_revision_id', v_revision_id, 'updated_at', v_updated_at);
end;
$$;

create or replace function public.duplicate_onboarding_module(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_module_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_definition jsonb;
    v_result jsonb;
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    select revision.definition into v_definition
    from public.onboarding_module_revisions revision
    where revision.workspace_id = p_workspace_id and revision.module_id = p_module_id
    order by (revision.status = 'published') desc, revision.revision_number desc nulls last, revision.updated_at desc
    limit 1;
    if v_definition is null then raise exception 'Onboarding module not found'; end if;
    v_result := public.create_onboarding_module(p_workspace_id, p_actor_user_id, public.rekey_onboarding_module_definition(v_definition));
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.module.duplicated', 'Onboarding module duplicated',
        p_entity_type => 'onboarding_module', p_entity_id => v_result->>'module_id',
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_metadata => jsonb_build_object('source_module_id', p_module_id),
        p_idempotency_key => 'onboarding.module.duplicated:' || (v_result->>'module_id')
    );
    return v_result;
end;
$$;

create or replace function public.publish_onboarding_module(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_module_id uuid,
    p_apply_to_active boolean default false,
    p_explanation text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_definition jsonb;
    v_revision_id uuid;
    v_revision_number integer;
    v_affected integer;
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    select definition into v_definition
    from public.onboarding_module_revisions
    where workspace_id = p_workspace_id and module_id = p_module_id and status = 'draft'
    for update;
    if v_definition is null then raise exception 'Module draft not found'; end if;
    perform public.validate_onboarding_module_definition(v_definition);
    select coalesce(max(revision_number), 0) + 1 into v_revision_number
    from public.onboarding_module_revisions
    where workspace_id = p_workspace_id and module_id = p_module_id and status = 'published';
    select count(*)::integer into v_affected
    from public.relationship_onboarding_session_modules snapshot_module
    join public.relationship_onboarding_sessions session on session.id = snapshot_module.session_id
    where snapshot_module.workspace_id = p_workspace_id
      and snapshot_module.module_id = p_module_id
      and session.status = 'active';
    if p_apply_to_active and v_affected > 0 then
        raise exception 'Active-session module migration must run through the atomic session migration procedure';
    end if;
    insert into public.onboarding_module_revisions (
        workspace_id, module_id, revision_number, status, definition, definition_hash,
        created_by, updated_by, published_by, published_at
    ) values (
        p_workspace_id, p_module_id, v_revision_number, 'published', v_definition,
        md5(v_definition::text), p_actor_user_id, p_actor_user_id, p_actor_user_id, now()
    ) returning id into v_revision_id;
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.module.published', 'Onboarding module published',
        p_entity_type => 'onboarding_module', p_entity_id => p_module_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_metadata => jsonb_build_object(
            'revision_id', v_revision_id, 'revision_number', v_revision_number,
            'apply_to_active', p_apply_to_active, 'affected_active_sessions', v_affected,
            'explanation_supplied', nullif(trim(coalesce(p_explanation, '')), '') is not null
        ),
        p_idempotency_key => format('onboarding.module.published:%s:%s', p_module_id, v_revision_number)
    );
    return jsonb_build_object(
        'module_id', p_module_id, 'revision_id', v_revision_id,
        'revision_number', v_revision_number, 'affected_active_sessions', v_affected
    );
end;
$$;

create or replace function public.archive_onboarding_module(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_module_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    if exists (
        select 1
        from public.onboarding_services service
        join lateral (
            select id from public.onboarding_service_revisions
            where service_id = service.id order by revision_number desc limit 1
        ) revision on true
        join public.onboarding_service_revision_modules assignment on assignment.service_revision_id = revision.id
        where service.workspace_id = p_workspace_id and service.state = 'active' and assignment.module_id = p_module_id
    ) then raise exception 'This module is used by an active service'; end if;
    if exists (
        select 1
        from public.onboarding_configuration_revision_modules assignment
        join public.onboarding_configuration_revisions revision on revision.id = assignment.configuration_revision_id
        where assignment.workspace_id = p_workspace_id and assignment.module_id = p_module_id
          and revision.configuration_type = 'mandatory_modules' and revision.status = 'published'
          and revision.revision_number = (
              select max(latest.revision_number) from public.onboarding_configuration_revisions latest
              where latest.workspace_id = p_workspace_id and latest.configuration_type = 'mandatory_modules' and latest.status = 'published'
          )
    ) then raise exception 'This module is mandatory for onboarding'; end if;
    update public.onboarding_modules set status = 'archived', archived_at = now()
    where workspace_id = p_workspace_id and id = p_module_id;
    if not found then raise exception 'Onboarding module not found'; end if;
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.module.archived', 'Onboarding module archived',
        p_entity_type => 'onboarding_module', p_entity_id => p_module_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff'
    );
    return jsonb_build_object('module_id', p_module_id, 'status', 'archived');
end;
$$;

create or replace function public.restore_onboarding_module(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_module_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    update public.onboarding_modules set status = 'active', archived_at = null
    where workspace_id = p_workspace_id and id = p_module_id and status = 'archived';
    if not found then raise exception 'Archived onboarding module not found'; end if;
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.module.restored', 'Onboarding module restored',
        p_entity_type => 'onboarding_module', p_entity_id => p_module_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff'
    );
    return jsonb_build_object('module_id', p_module_id, 'status', 'active');
end;
$$;

revoke all on function public.create_onboarding_module(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.save_onboarding_module_draft(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.duplicate_onboarding_module(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.publish_onboarding_module(uuid, uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.archive_onboarding_module(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.restore_onboarding_module(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_onboarding_module(uuid, uuid, jsonb) to service_role;
grant execute on function public.save_onboarding_module_draft(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.duplicate_onboarding_module(uuid, uuid, uuid) to service_role;
grant execute on function public.publish_onboarding_module(uuid, uuid, uuid, boolean, text) to service_role;
grant execute on function public.archive_onboarding_module(uuid, uuid, uuid) to service_role;
grant execute on function public.restore_onboarding_module(uuid, uuid, uuid) to service_role;

create or replace function public.delete_onboarding_module_draft(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_module_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    if exists (
        select 1 from public.onboarding_module_revisions
        where workspace_id = p_workspace_id and module_id = p_module_id and status = 'published'
    ) then raise exception 'Only modules that have never been published can be permanently deleted'; end if;
    if not exists (
        select 1 from public.onboarding_modules where workspace_id = p_workspace_id and id = p_module_id
    ) then raise exception 'Onboarding module not found'; end if;
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.module.draft_deleted', 'Unpublished onboarding module deleted',
        p_entity_type => 'onboarding_module', p_entity_id => p_module_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_idempotency_key => 'onboarding.module.deleted:' || p_module_id
    );
    delete from public.onboarding_modules where workspace_id = p_workspace_id and id = p_module_id;
    return jsonb_build_object('module_id', p_module_id, 'deleted', true);
end;
$$;
revoke all on function public.delete_onboarding_module_draft(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_onboarding_module_draft(uuid, uuid, uuid) to service_role;

create or replace function public.save_onboarding_service_revision(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_service_id uuid,
    p_definition jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_service_id uuid := coalesce(p_service_id, gen_random_uuid());
    v_revision_id uuid;
    v_revision_number integer;
    v_name text := nullif(trim(p_definition->>'name'), '');
    v_description text := nullif(trim(p_definition->>'description'), '');
    v_price integer;
    v_currency text := upper(coalesce(nullif(trim(p_definition->>'currency'), ''), 'USD'));
    v_assignee uuid;
    v_is_test boolean := coalesce((p_definition->>'isTest')::boolean, false);
    v_priority integer := greatest(0, least(10000, coalesce((p_definition->>'displayPriority')::integer, 0)));
    v_module_ids jsonb := coalesce(p_definition->'moduleIds', '[]'::jsonb);
    v_previous_state text;
    v_created boolean := p_service_id is null;
    v_modules_changed boolean := true;
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    if jsonb_typeof(p_definition) <> 'object' or v_name is null then raise exception 'Give this service a name before saving'; end if;
    begin v_price := (p_definition->>'defaultPriceCents')::integer;
    exception when others then raise exception 'Enter a valid default price'; end;
    if v_price < 0 then raise exception 'Enter a valid default price'; end if;
    if v_currency !~ '^[A-Z]{3}$' then raise exception 'Use a three-letter currency code'; end if;
    if jsonb_typeof(v_module_ids) <> 'array' then raise exception 'Service module assignments must be an array'; end if;
    if p_definition->>'defaultAssigneeUserId' is not null and p_definition->>'defaultAssigneeUserId' <> '' then
        begin v_assignee := (p_definition->>'defaultAssigneeUserId')::uuid;
        exception when others then raise exception 'Default assignee is invalid'; end;
        if not exists (select 1 from public.workspace_memberships where workspace_id = p_workspace_id and user_id = v_assignee) then
            raise exception 'Default assignee must belong to this workspace';
        end if;
    end if;
    if exists (
        select 1
        from jsonb_array_elements_text(v_module_ids) ids(module_id)
        group by module_id having count(*) > 1
    ) then raise exception 'A service cannot contain the same module twice'; end if;
    if exists (
        select 1
        from jsonb_array_elements_text(v_module_ids) ids(module_id)
        left join public.onboarding_modules module
          on module.workspace_id = p_workspace_id and module.id = ids.module_id::uuid and module.status = 'active'
        where module.id is null or not exists (
            select 1 from public.onboarding_module_revisions revision
            where revision.workspace_id = p_workspace_id and revision.module_id = module.id and revision.status = 'published'
        )
    ) then raise exception 'Every assigned module must be active and published'; end if;

    if p_service_id is null then
        insert into public.onboarding_services (id, workspace_id, internal_code, created_by)
        values (v_service_id, p_workspace_id, public.onboarding_internal_code('service', v_name, v_service_id), p_actor_user_id);
    else
        select state into v_previous_state from public.onboarding_services
        where workspace_id = p_workspace_id and id = p_service_id for update;
        if v_previous_state is null then raise exception 'Service not found'; end if;
        if v_previous_state = 'archived' then raise exception 'Restore this service before creating a reviewed revision'; end if;
    end if;

    select coalesce(max(revision_number), 0) + 1 into v_revision_number
    from public.onboarding_service_revisions where workspace_id = p_workspace_id and service_id = v_service_id;
    if v_revision_number > 1 then
        select not (
            coalesce(jsonb_agg(assignment.module_id order by assignment.sort_order), '[]'::jsonb)
            = v_module_ids
        ) into v_modules_changed
        from public.onboarding_service_revision_modules assignment
        where assignment.service_revision_id = (
            select id from public.onboarding_service_revisions
            where workspace_id = p_workspace_id and service_id = v_service_id
            order by revision_number desc limit 1
        );
    end if;
    insert into public.onboarding_service_revisions (
        workspace_id, service_id, revision_number, name, description, default_price_cents,
        currency, default_assignee_user_id, is_test, display_priority, definition, created_by
    ) values (
        p_workspace_id, v_service_id, v_revision_number, v_name, v_description, v_price,
        v_currency, v_assignee, v_is_test, v_priority, p_definition, p_actor_user_id
    ) returning id into v_revision_id;
    insert into public.onboarding_service_revision_modules (workspace_id, service_revision_id, module_id, sort_order)
    select p_workspace_id, v_revision_id, value::uuid, ordinality::integer - 1
    from jsonb_array_elements_text(v_module_ids) with ordinality as modules(value, ordinality);
    if v_previous_state = 'retired' then
        update public.onboarding_services set state = 'active', retired_at = null
        where workspace_id = p_workspace_id and id = v_service_id;
    end if;
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'services',
        case when v_created then 'services.service.created' when v_previous_state = 'retired' then 'services.service.reactivated' else 'services.service.revised' end,
        case when v_created then 'Service created' when v_previous_state = 'retired' then 'Service reactivated with a new revision' else 'Service revision saved' end,
        p_entity_type => 'onboarding_service', p_entity_id => v_service_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_metadata => jsonb_build_object(
            'revision_id', v_revision_id, 'revision_number', v_revision_number,
            'module_count', jsonb_array_length(v_module_ids), 'assignments_changed', v_modules_changed
        ),
        p_idempotency_key => format('services.service.revision:%s:%s', v_service_id, v_revision_number)
    );
    if v_modules_changed then
        perform public.record_workspace_admin_activity(
            p_workspace_id, 'services', 'services.assignments.changed', 'Service module assignments changed',
            p_entity_type => 'onboarding_service', p_entity_id => v_service_id::text,
            p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
            p_metadata => jsonb_build_object('revision_id', v_revision_id, 'module_count', jsonb_array_length(v_module_ids)),
            p_idempotency_key => format('services.assignments:%s:%s', v_service_id, v_revision_number)
        );
    end if;
    return jsonb_build_object(
        'service_id', v_service_id, 'revision_id', v_revision_id,
        'revision_number', v_revision_number, 'state', 'active'
    );
end;
$$;

create or replace function public.set_onboarding_service_state(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_service_id uuid,
    p_state text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_previous text;
    v_next text := p_state;
    v_event text;
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    if p_state not in ('active', 'retired', 'archived') then raise exception 'Unknown service state'; end if;
    select state into v_previous from public.onboarding_services
    where workspace_id = p_workspace_id and id = p_service_id for update;
    if v_previous is null then raise exception 'Service not found'; end if;
    if v_previous = p_state then return jsonb_build_object('service_id', p_service_id, 'state', p_state); end if;
    if p_state = 'active' then raise exception 'Reactivation requires saving a reviewed new service revision'; end if;
    if v_previous = 'archived' then
        if p_state <> 'retired' then raise exception 'Restoring an archived service returns it to Retired'; end if;
        v_event := 'services.service.restored';
    elsif p_state = 'retired' then
        v_event := 'services.service.retired';
    else
        if exists (
            select 1 from public.relationship_services selected
            join public.relationships relationship on relationship.id = selected.relationship_id
            where selected.workspace_id = p_workspace_id and selected.service_id = p_service_id
              and relationship.status not in ('completed', 'lost', 'archived')
        ) or exists (
            select 1 from public.client_sale_items item
            join public.client_sales sale on sale.id = item.client_sale_id
            left join public.relationships relationship on relationship.id = sale.relationship_id
            where item.workspace_id = p_workspace_id and item.service_id = p_service_id
              and lower(coalesce(sale.status, '')) not in (
                  'invoice_inactive', 'void', 'voided', 'canceled', 'cancelled',
                  'uncollectible', 'marked_uncollectible'
              )
              and lower(coalesce(sale.stripe_invoice_status, '')) not in (
                  'void', 'voided', 'uncollectible', 'marked_uncollectible'
              )
              and (relationship.id is null or relationship.status not in ('completed', 'lost', 'archived'))
        ) or exists (
            select 1 from public.work_items item
            where item.workspace_id = p_workspace_id and item.status not in ('done', 'canceled')
              and item.metadata->>'service_id' = p_service_id::text
        ) then raise exception 'This service still has open invoices, lifecycle work, or delivery obligations'; end if;
        v_event := 'services.service.archived';
    end if;
    update public.onboarding_services
    set state = v_next,
        retired_at = case when v_next = 'retired' then now() else retired_at end,
        archived_at = case when v_next = 'archived' then now() else null end
    where workspace_id = p_workspace_id and id = p_service_id;
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'services', v_event,
        case v_event when 'services.service.restored' then 'Service restored to Retired' when 'services.service.retired' then 'Service retired' else 'Service archived' end,
        p_entity_type => 'onboarding_service', p_entity_id => p_service_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_metadata => jsonb_build_object('previous_state', v_previous, 'new_state', v_next)
    );
    return jsonb_build_object('service_id', p_service_id, 'state', v_next);
end;
$$;

revoke all on function public.save_onboarding_service_revision(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.set_onboarding_service_state(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.save_onboarding_service_revision(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.set_onboarding_service_state(uuid, uuid, uuid, text) to service_role;

create or replace function public.save_onboarding_configuration_draft(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_module_ids uuid[],
    p_help_text text default null,
    p_whatsapp_enabled boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_revision_id uuid;
    v_updated_at timestamptz;
    v_definition jsonb;
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    if cardinality(p_module_ids) <> cardinality(array(select distinct unnest(p_module_ids))) then
        raise exception 'Mandatory modules cannot contain duplicates';
    end if;
    if exists (
        select 1 from unnest(p_module_ids) module_id
        left join public.onboarding_modules module on module.id = module_id and module.workspace_id = p_workspace_id and module.status = 'active'
        where module.id is null or not exists (
            select 1 from public.onboarding_module_revisions revision
            where revision.workspace_id = p_workspace_id and revision.module_id = module.id and revision.status = 'published'
        )
    ) then raise exception 'Every mandatory module must be active and published'; end if;
    v_definition := jsonb_build_object(
        'module_ids', to_jsonb(coalesce(p_module_ids, '{}'::uuid[])),
        'help_text', left(coalesce(p_help_text, ''), 2000),
        'whatsapp_enabled', coalesce(p_whatsapp_enabled, true)
    );
    update public.onboarding_configuration_revisions
    set definition = v_definition, definition_hash = md5(v_definition::text),
        whatsapp_enabled = coalesce(p_whatsapp_enabled, true), updated_by = p_actor_user_id
    where workspace_id = p_workspace_id and configuration_type = 'mandatory_modules' and status = 'draft'
    returning id, updated_at into v_revision_id, v_updated_at;
    if v_revision_id is null then
        insert into public.onboarding_configuration_revisions (
            workspace_id, configuration_type, status, definition, definition_hash,
            whatsapp_enabled, created_by, updated_by
        ) values (
            p_workspace_id, 'mandatory_modules', 'draft', v_definition, md5(v_definition::text),
            coalesce(p_whatsapp_enabled, true), p_actor_user_id, p_actor_user_id
        ) returning id, updated_at into v_revision_id, v_updated_at;
    end if;
    delete from public.onboarding_configuration_revision_modules
    where workspace_id = p_workspace_id and configuration_revision_id = v_revision_id;
    insert into public.onboarding_configuration_revision_modules (workspace_id, configuration_revision_id, module_id, sort_order)
    select p_workspace_id, v_revision_id, module_id, ordinality::integer - 1
    from unnest(coalesce(p_module_ids, '{}'::uuid[])) with ordinality modules(module_id, ordinality);
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.configuration.draft_saved', 'Mandatory onboarding configuration draft saved',
        p_entity_type => 'onboarding_configuration', p_entity_id => v_revision_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_metadata => jsonb_build_object('module_count', cardinality(p_module_ids), 'whatsapp_enabled', coalesce(p_whatsapp_enabled, true))
    );
    return jsonb_build_object('configuration_revision_id', v_revision_id, 'updated_at', v_updated_at);
end;
$$;

create or replace function public.publish_onboarding_configuration(
    p_workspace_id uuid,
    p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_draft public.onboarding_configuration_revisions%rowtype;
    v_revision_id uuid;
    v_revision_number integer;
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    select * into v_draft from public.onboarding_configuration_revisions
    where workspace_id = p_workspace_id and configuration_type = 'mandatory_modules' and status = 'draft'
    for update;
    if v_draft.id is null then raise exception 'Mandatory onboarding configuration draft not found'; end if;
    if exists (
        select 1 from public.onboarding_configuration_revision_modules assignment
        join public.onboarding_modules module on module.id = assignment.module_id and module.workspace_id = assignment.workspace_id
        where assignment.configuration_revision_id = v_draft.id
          and (module.status <> 'active' or not exists (
              select 1 from public.onboarding_module_revisions revision
              where revision.module_id = module.id and revision.workspace_id = p_workspace_id and revision.status = 'published'
          ))
    ) then raise exception 'Every mandatory module must be active and published'; end if;
    select coalesce(max(revision_number), 0) + 1 into v_revision_number
    from public.onboarding_configuration_revisions
    where workspace_id = p_workspace_id and configuration_type = 'mandatory_modules' and status = 'published';
    insert into public.onboarding_configuration_revisions (
        workspace_id, configuration_type, revision_number, status, definition,
        definition_hash, whatsapp_enabled, created_by, updated_by, published_by, published_at
    ) values (
        p_workspace_id, 'mandatory_modules', v_revision_number, 'published', v_draft.definition,
        v_draft.definition_hash, v_draft.whatsapp_enabled, p_actor_user_id, p_actor_user_id, p_actor_user_id, now()
    ) returning id into v_revision_id;
    insert into public.onboarding_configuration_revision_modules (workspace_id, configuration_revision_id, module_id, sort_order)
    select p_workspace_id, v_revision_id, module_id, sort_order
    from public.onboarding_configuration_revision_modules where configuration_revision_id = v_draft.id;
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.configuration.published', 'Mandatory onboarding configuration published',
        p_entity_type => 'onboarding_configuration', p_entity_id => v_revision_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_metadata => jsonb_build_object('revision_number', v_revision_number, 'module_count', jsonb_array_length(v_draft.definition->'module_ids')),
        p_idempotency_key => format('onboarding.configuration.published:%s:%s', p_workspace_id, v_revision_number)
    );
    return jsonb_build_object('configuration_revision_id', v_revision_id, 'revision_number', v_revision_number);
end;
$$;

create or replace function public.save_onboarding_bookend_draft(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_kind text,
    p_definition jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_revision_id uuid;
    v_updated_at timestamptz;
    v_window bigint := floor(extract(epoch from now()) / 900);
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    if p_kind not in ('welcome', 'completion') then raise exception 'Unknown onboarding bookend'; end if;
    if jsonb_typeof(p_definition) <> 'object' or nullif(trim(p_definition->>'title'), '') is null then
        raise exception 'Give this bookend a title before saving';
    end if;
    update public.onboarding_configuration_revisions
    set definition = p_definition, definition_hash = md5(p_definition::text), updated_by = p_actor_user_id
    where workspace_id = p_workspace_id and configuration_type = p_kind and status = 'draft'
    returning id, updated_at into v_revision_id, v_updated_at;
    if v_revision_id is null then
        insert into public.onboarding_configuration_revisions (
            workspace_id, configuration_type, status, definition, definition_hash, created_by, updated_by
        ) values (
            p_workspace_id, p_kind, 'draft', p_definition, md5(p_definition::text), p_actor_user_id, p_actor_user_id
        ) returning id, updated_at into v_revision_id, v_updated_at;
    end if;
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.bookend.edit_session', initcap(p_kind) || ' bookend draft edited',
        p_entity_type => 'onboarding_bookend', p_entity_id => v_revision_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_metadata => jsonb_build_object('kind', p_kind, 'editing_window_minutes', 15),
        p_idempotency_key => format('onboarding.bookend.edit:%s:%s:%s', p_kind, p_actor_user_id, v_window),
        p_coalesce => true
    );
    return jsonb_build_object('bookend_revision_id', v_revision_id, 'updated_at', v_updated_at);
end;
$$;

create or replace function public.publish_onboarding_bookend(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_kind text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_draft public.onboarding_configuration_revisions%rowtype;
    v_revision_id uuid;
    v_revision_number integer;
    v_affected integer := 0;
    v_session record;
    v_updated_snapshot jsonb;
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    if p_kind not in ('welcome', 'completion') then raise exception 'Unknown onboarding bookend'; end if;
    select * into v_draft from public.onboarding_configuration_revisions
    where workspace_id = p_workspace_id and configuration_type = p_kind and status = 'draft'
    for update;
    if v_draft.id is null then raise exception 'Bookend draft not found'; end if;
    select coalesce(max(revision_number), 0) + 1 into v_revision_number
    from public.onboarding_configuration_revisions
    where workspace_id = p_workspace_id and configuration_type = p_kind and status = 'published';
    insert into public.onboarding_configuration_revisions (
        workspace_id, configuration_type, revision_number, status, definition,
        definition_hash, created_by, updated_by, published_by, published_at
    ) values (
        p_workspace_id, p_kind, v_revision_number, 'published', v_draft.definition,
        v_draft.definition_hash, p_actor_user_id, p_actor_user_id, p_actor_user_id, now()
    ) returning id into v_revision_id;
    if p_kind = 'completion' then
        for v_session in
            select id, composition_snapshot
            from public.relationship_onboarding_sessions
            where workspace_id = p_workspace_id and status = 'active'
            for update
        loop
            v_updated_snapshot := case
                when jsonb_typeof(v_session.composition_snapshot->'items') = 'array' then
                    jsonb_set(
                        v_session.composition_snapshot,
                        '{items}',
                        coalesce((
                            select jsonb_agg(
                                case when item->>'kind' = 'completion' then
                                    item || jsonb_build_object(
                                        'configuration_revision_id', v_revision_id,
                                        'definition', v_draft.definition,
                                        'source_references', coalesce(item->'source_references', '{}'::jsonb) || jsonb_build_object(
                                            'configuration_revision_id', v_revision_id,
                                            'revision_number', v_revision_number
                                        )
                                    )
                                else item end
                                order by position
                            )
                            from jsonb_array_elements(v_session.composition_snapshot->'items') with ordinality as items(item, position)
                        ), '[]'::jsonb),
                        true
                    )
                else coalesce(v_session.composition_snapshot, '{}'::jsonb)
            end || jsonb_build_object(
                'latest_completion_migration', jsonb_build_object(
                    'completion_revision_id', v_revision_id,
                    'revision_number', v_revision_number,
                    'migrated_at', now()
                )
            );
            update public.relationship_onboarding_sessions
            set completion_revision_id = v_revision_id,
                composition_snapshot = v_updated_snapshot,
                composition_hash = encode(extensions.digest(convert_to(v_updated_snapshot::text, 'UTF8'), 'sha256'), 'hex'),
                updated_at = now()
            where workspace_id = p_workspace_id and id = v_session.id;
            v_affected := v_affected + 1;
        end loop;
        update public.relationship_onboarding_session_steps step
        set bookend_revision_id = v_revision_id,
            title = v_draft.definition->>'title',
            description = nullif(v_draft.definition->>'body', ''),
            video_url = nullif(v_draft.definition->>'videoUrl', ''),
            video_storage_path = nullif(v_draft.definition->>'videoPath', '')
        from public.relationship_onboarding_sessions session
        where step.session_id = session.id and step.workspace_id = p_workspace_id
          and session.status = 'active' and step.kind = 'completion';
    end if;
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.bookend.published', initcap(p_kind) || ' bookend published',
        p_entity_type => 'onboarding_bookend', p_entity_id => v_revision_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_metadata => jsonb_build_object('kind', p_kind, 'revision_number', v_revision_number, 'affected_active_sessions', v_affected),
        p_idempotency_key => format('onboarding.bookend.published:%s:%s:%s', p_workspace_id, p_kind, v_revision_number)
    );
    return jsonb_build_object('bookend_revision_id', v_revision_id, 'revision_number', v_revision_number);
end;
$$;

create or replace function public.save_onboarding_branding(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_swatches jsonb,
    p_assignments jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_swatch jsonb;
    v_updated_at timestamptz := now();
    v_window bigint := floor(extract(epoch from now()) / 900);
    v_slot text;
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    if jsonb_typeof(p_swatches) <> 'array' or jsonb_array_length(p_swatches) > 50 then raise exception 'Provide no more than 50 colour swatches'; end if;
    if jsonb_typeof(p_assignments) <> 'object' then raise exception 'Theme assignments must be an object'; end if;
    for v_swatch in select value from jsonb_array_elements(p_swatches) loop
        if nullif(trim(v_swatch->>'id'), '') is null or nullif(trim(v_swatch->>'name'), '') is null
           or upper(v_swatch->>'hex') !~ '^#[0-9A-F]{6}$' then raise exception 'Every swatch needs an ID, name, and valid hex colour'; end if;
        insert into public.onboarding_brand_swatches (id, workspace_id, name, hex, hidden, hidden_at)
        values (
            v_swatch->>'id', p_workspace_id, left(trim(v_swatch->>'name'), 80), upper(v_swatch->>'hex'),
            coalesce((v_swatch->>'hidden')::boolean, false),
            case when coalesce((v_swatch->>'hidden')::boolean, false) then now() else null end
        )
        on conflict (workspace_id, id) do update set
            name = excluded.name, hex = excluded.hex, hidden = excluded.hidden, hidden_at = excluded.hidden_at;
    end loop;
    update public.onboarding_brand_swatches existing
    set hidden = true, hidden_at = coalesce(hidden_at, now())
    where existing.workspace_id = p_workspace_id
      and not exists (select 1 from jsonb_array_elements(p_swatches) supplied where supplied->>'id' = existing.id);
    foreach v_slot in array array['primary','accent','pageBackground','surface','text','mutedText'] loop
        if nullif(p_assignments->>v_slot, '') is null or not exists (
            select 1 from public.onboarding_brand_swatches
            where workspace_id = p_workspace_id and id = p_assignments->>v_slot
        ) then raise exception 'Assign an existing colour to every theme role'; end if;
    end loop;
    insert into public.onboarding_themes (workspace_id, assignments, updated_by, updated_at)
    values (p_workspace_id, p_assignments, p_actor_user_id, v_updated_at)
    on conflict (workspace_id) do update set assignments = excluded.assignments, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.branding.edit_session', 'Agency onboarding colours edited',
        p_entity_type => 'onboarding_theme', p_entity_id => p_workspace_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_metadata => jsonb_build_object('swatch_count', jsonb_array_length(p_swatches), 'editing_window_minutes', 15),
        p_idempotency_key => format('onboarding.branding.edit:%s:%s:%s', p_workspace_id, p_actor_user_id, v_window),
        p_coalesce => true
    );
    return jsonb_build_object('workspace_id', p_workspace_id, 'updated_at', v_updated_at);
end;
$$;

create or replace function public.rotate_onboarding_preview_token(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_module_id uuid,
    p_token_hash text,
    p_expires_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare v_token_id uuid;
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    if p_token_hash !~ '^[0-9a-f]{64}$' or p_expires_at <= now() or p_expires_at > now() + interval '24 hours 5 minutes' then
        raise exception 'Preview token must be a 64-character hash expiring within 24 hours';
    end if;
    if not exists (
        select 1 from public.onboarding_module_revisions
        where workspace_id = p_workspace_id and module_id = p_module_id and status = 'draft'
    ) then raise exception 'Module draft not found'; end if;
    update public.onboarding_preview_tokens set revoked_at = now()
    where workspace_id = p_workspace_id and module_id = p_module_id and revoked_at is null;
    insert into public.onboarding_preview_tokens (workspace_id, module_id, token_hash, expires_at, created_by)
    values (p_workspace_id, p_module_id, p_token_hash, p_expires_at, p_actor_user_id)
    returning id into v_token_id;
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.preview.rotated', 'Onboarding module preview link generated',
        p_entity_type => 'onboarding_module', p_entity_id => p_module_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_metadata => jsonb_build_object('preview_token_id', v_token_id, 'expires_at', p_expires_at),
        p_idempotency_key => 'onboarding.preview.rotated:' || v_token_id
    );
    return jsonb_build_object('preview_token_id', v_token_id, 'expires_at', p_expires_at);
end;
$$;

create or replace function public.record_onboarding_preview_revoked(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_module_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare v_count integer;
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    update public.onboarding_preview_tokens set revoked_at = coalesce(revoked_at, now())
    where workspace_id = p_workspace_id and module_id = p_module_id and revoked_at is null;
    get diagnostics v_count = row_count;
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.preview.revoked', 'Onboarding module preview link revoked',
        p_entity_type => 'onboarding_module', p_entity_id => p_module_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_metadata => jsonb_build_object('revoked_token_count', v_count)
    );
    return jsonb_build_object('module_id', p_module_id, 'revoked', true);
end;
$$;

revoke all on function public.save_onboarding_configuration_draft(uuid, uuid, uuid[], text, boolean) from public, anon, authenticated;
revoke all on function public.publish_onboarding_configuration(uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_onboarding_bookend_draft(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.publish_onboarding_bookend(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.save_onboarding_branding(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.rotate_onboarding_preview_token(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.record_onboarding_preview_revoked(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.save_onboarding_configuration_draft(uuid, uuid, uuid[], text, boolean) to service_role;
grant execute on function public.publish_onboarding_configuration(uuid, uuid) to service_role;
grant execute on function public.save_onboarding_bookend_draft(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.publish_onboarding_bookend(uuid, uuid, text) to service_role;
grant execute on function public.save_onboarding_branding(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.rotate_onboarding_preview_token(uuid, uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.record_onboarding_preview_revoked(uuid, uuid, uuid) to service_role;

create or replace function public.report_platform_failure(
    p_workspace_id uuid,
    p_category text,
    p_source text,
    p_operation text,
    p_fingerprint text,
    p_severity text,
    p_summary text,
    p_diagnostics jsonb default '{}'::jsonb,
    p_occurred_at timestamptz default now(),
    p_source_href text default null,
    p_actor_user_id uuid default null,
    p_correlation_id uuid default null,
    p_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_activity_category text := case when p_category = 'system_health' then 'system' else p_category end;
    v_correlation_id uuid := coalesce(p_correlation_id, gen_random_uuid());
    v_occurred_at timestamptz := coalesce(p_occurred_at, now());
    v_event_id uuid;
    v_count_24h integer;
    v_first_24h timestamptz;
    v_work_item_id uuid;
    v_created boolean := false;
    v_officer_id uuid;
    v_error_code text := coalesce(nullif(p_diagnostics->>'error_code', ''), 'BGE-9006');
    v_error_name text := coalesce(nullif(p_diagnostics->>'error_name', ''), 'Platform operation failure');
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Platform failures may only be reported by trusted automation';
    end if;
    if p_category not in ('services', 'leadgen', 'onboarding', 'billing', 'communications', 'integrations', 'system_health') then
        raise exception 'Unknown Maintenance category';
    end if;
    if p_severity not in ('warning', 'critical') then raise exception 'Unknown Maintenance severity'; end if;
    if nullif(trim(p_fingerprint), '') is null then raise exception 'Failure fingerprint is required'; end if;
    v_event_id := public.record_workspace_admin_activity(
        p_workspace_id, v_activity_category, trim(p_source) || '.' || trim(p_operation) || '.failed', p_summary,
        p_level => 'error', p_entity_type => 'platform_failure', p_entity_id => trim(p_fingerprint),
        p_source_href => p_source_href, p_actor_user_id => p_actor_user_id,
        p_actor_kind => case when p_actor_user_id is null then 'automation' else 'staff' end,
        p_metadata => jsonb_build_object('source', p_source, 'operation', p_operation),
        p_diagnostics => coalesce(p_diagnostics, '{}'::jsonb) || jsonb_build_object('error_code', v_error_code, 'error_name', v_error_name),
        p_occurred_at => v_occurred_at, p_correlation_id => v_correlation_id,
        p_idempotency_key => p_idempotency_key, p_outcome => 'failed',
        p_metric_classification => 'operational', p_failure_fingerprint => trim(p_fingerprint)
    );
    select count(*)::integer, min(occurred_at) into v_count_24h, v_first_24h
    from public.workspace_admin_activity
    where workspace_id = p_workspace_id and failure_fingerprint = trim(p_fingerprint)
      and outcome = 'failed' and occurred_at >= v_occurred_at - interval '24 hours'
      and occurred_at <= v_occurred_at;

    if p_severity = 'critical' or v_count_24h >= 3 then
        insert into public.work_items (
            workspace_id, title, description, lifecycle_phase, status, priority, is_key_task,
            native_kind, native_href, area, kind, visibility, maintenance_category, severity,
            failure_fingerprint, occurrence_count, first_occurred_at, last_occurred_at, metadata
        ) values (
            p_workspace_id, format('Bug: %s - %s', v_error_code, v_error_name), 'Admin work: ' || p_summary,
            null, 'todo', case when p_severity = 'critical' then 1 else 2 end, true,
            'platform_failure', p_source_href, 'admin', 'maintenance', 'admins_only', p_category,
            p_severity, trim(p_fingerprint), greatest(1, v_count_24h), coalesce(v_first_24h, v_occurred_at), v_occurred_at,
            jsonb_build_object(
                'source', p_source, 'operation', p_operation, 'error_code', v_error_code,
                'error_name', v_error_name, 'latest_diagnostics', public.sanitize_admin_activity_json(coalesce(p_diagnostics, '{}'::jsonb)),
                'latest_occurred_at', v_occurred_at
            )
        )
        on conflict (workspace_id, failure_fingerprint)
        where kind = 'maintenance' and failure_fingerprint is not null and status not in ('done', 'canceled')
        do update set
            title = excluded.title,
            description = excluded.description,
            severity = case when public.work_items.severity = 'critical' or excluded.severity = 'critical' then 'critical' else 'warning' end,
            priority = least(public.work_items.priority, excluded.priority),
            occurrence_count = greatest(public.work_items.occurrence_count, excluded.occurrence_count),
            first_occurred_at = least(public.work_items.first_occurred_at, excluded.first_occurred_at),
            last_occurred_at = greatest(public.work_items.last_occurred_at, excluded.last_occurred_at),
            native_href = coalesce(excluded.native_href, public.work_items.native_href),
            metadata = coalesce(public.work_items.metadata, '{}'::jsonb) || excluded.metadata
        returning id, (xmax = 0) into v_work_item_id, v_created;

        select route.responsible_user_id into v_officer_id
        from public.workspace_maintenance_routing route
        where route.workspace_id = p_workspace_id and route.category in ('global', p_category)
        order by case when route.category = 'global' then 0 else 1 end
        limit 1;
        if v_officer_id is null then
            select membership.user_id into v_officer_id
            from public.workspace_memberships membership
            where membership.workspace_id = p_workspace_id and membership.role = 'owner'
            order by membership.created_at, membership.user_id limit 1;
        end if;
        if v_officer_id is not null then
            update public.work_items set execution_owner_id = coalesce(execution_owner_id, v_officer_id)
            where workspace_id = p_workspace_id and id = v_work_item_id;
            insert into public.work_item_assignees (workspace_id, work_item_id, user_id)
            values (p_workspace_id, v_work_item_id, v_officer_id)
            on conflict (work_item_id, user_id) do nothing;
        end if;
        update public.workspace_admin_activity
        set maintenance_work_item_id = v_work_item_id
        where workspace_id = p_workspace_id and failure_fingerprint = trim(p_fingerprint)
          and occurred_at >= v_occurred_at - interval '24 hours' and maintenance_work_item_id is null;
    end if;
    return jsonb_build_object(
        'ok', true, 'event_id', v_event_id, 'work_item_id', v_work_item_id,
        'maintenance_created', v_created, 'occurrence_count_24h', v_count_24h,
        'threshold_reached', p_severity = 'critical' or v_count_24h >= 3,
        'correlation_id', v_correlation_id
    );
end;
$$;

revoke all on function public.report_platform_failure(uuid, text, text, text, text, text, text, jsonb, timestamptz, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.report_platform_failure(uuid, text, text, text, text, text, text, jsonb, timestamptz, text, uuid, uuid, text) to service_role;
revoke all on function public.record_workspace_admin_activity(uuid, text, text, text, text, text, text, text, uuid, text, jsonb, jsonb, timestamptz, uuid, uuid, text, text, text, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.record_workspace_admin_activity(uuid, text, text, text, text, text, text, text, uuid, text, jsonb, jsonb, timestamptz, uuid, uuid, text, text, text, text, uuid, boolean) to service_role;

create or replace function public.create_paid_onboarding_session(
    p_workspace_id uuid,
    p_sale_id uuid,
    p_correlation_id uuid,
    p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_sale public.client_sales%rowtype;
    v_existing public.relationship_onboarding_sessions%rowtype;
    v_session_id uuid := gen_random_uuid();
    v_session_token text := encode(extensions.gen_random_bytes(32), 'hex');
    v_correlation_id uuid := coalesce(p_correlation_id, gen_random_uuid());
    v_snapshot jsonb;
    v_composition_hash text;
    v_configuration_revision_id uuid;
    v_welcome_revision_id uuid;
    v_completion_revision_id uuid;
    v_item record;
    v_module_definition jsonb;
    v_session_module_id uuid;
    v_step jsonb;
    v_field jsonb;
    v_session_step_id uuid;
    v_stage_id uuid;
    v_work_item_id uuid;
    v_previous_work_item_id uuid;
    v_work_step record;
    v_now timestamptz := now();
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Paid onboarding may only be created by trusted payment automation';
    end if;
    select * into v_sale from public.client_sales
    where id = p_sale_id and workspace_id = p_workspace_id
    for update;
    if v_sale.id is null then raise exception using errcode = 'P0002', message = 'SALE_NOT_FOUND: Client sale does not belong to this workspace'; end if;
    select * into v_existing from public.relationship_onboarding_sessions
    where source_sale_id = p_sale_id;
    if v_existing.id is not null then
        update public.client_sales set onboarding_session_id = v_existing.id
        where id = p_sale_id and workspace_id = p_workspace_id and onboarding_session_id is distinct from v_existing.id;
        return jsonb_build_object(
            'session_id', v_existing.id, 'session_token', v_existing.session_token,
            'relationship_id', v_existing.relationship_id, 'created', false,
            'composition_hash', v_existing.composition_hash
        );
    end if;
    if v_sale.relationship_id is null then raise exception 'SALE_RELATIONSHIP_REQUIRED: Paid sale has no relationship'; end if;
    if v_sale.status not in (
        'paid', 'test_paid', 'paid_consent_template_sending', 'paid_awaiting_whatsapp_confirm',
        'whatsapp_confirmed', 'onboarding_created', 'onboarding_link_sent', 'onboarding_link_failed'
    ) then raise exception 'SALE_NOT_PAID: Onboarding starts only after successful payment'; end if;
    if exists (
        select 1 from public.relationship_onboarding_sessions
        where workspace_id = p_workspace_id and relationship_id = v_sale.relationship_id and status = 'active'
    ) then raise exception 'ACTIVE_SESSION_EXISTS: This relationship already has active onboarding'; end if;
    if not exists (
        select 1 from public.client_sale_composition_items
        where workspace_id = p_workspace_id and client_sale_id = p_sale_id
    ) then raise exception 'SALE_COMPOSITION_REQUIRED: Invoice has no frozen onboarding composition'; end if;
    if not exists (
        select 1 from public.client_sale_composition_items
        where workspace_id = p_workspace_id and client_sale_id = p_sale_id and item_kind = 'welcome'
    ) or not exists (
        select 1 from public.client_sale_composition_items
        where workspace_id = p_workspace_id and client_sale_id = p_sale_id and item_kind = 'completion'
    ) then raise exception 'SALE_BOOKENDS_REQUIRED: Frozen onboarding composition requires welcome and completion'; end if;

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', item.id, 'kind', item.item_kind, 'source_kind', item.source_kind,
        'module_id', item.module_id, 'module_revision_id', item.module_revision_id,
        'configuration_revision_id', item.configuration_revision_id,
        'source_service_revision_id', item.source_service_revision_id,
        'sort_order', item.sort_order, 'definition', item.definition,
        'source_references', item.source_references
    ) order by item.sort_order), '[]'::jsonb) into v_snapshot
    from public.client_sale_composition_items item
    where item.workspace_id = p_workspace_id and item.client_sale_id = p_sale_id;
    v_composition_hash := coalesce(v_sale.composition_hash, md5(v_snapshot::text));
    select coalesce(v_sale.configuration_revision_id, max(configuration_revision_id) filter (where source_kind = 'mandatory')),
           coalesce(v_sale.welcome_revision_id, max(configuration_revision_id) filter (where item_kind = 'welcome')),
           coalesce(v_sale.completion_revision_id, max(configuration_revision_id) filter (where item_kind = 'completion'))
    into v_configuration_revision_id, v_welcome_revision_id, v_completion_revision_id
    from public.client_sale_composition_items
    where workspace_id = p_workspace_id and client_sale_id = p_sale_id;

    insert into public.relationship_onboarding_sessions (
        id, workspace_id, relationship_id, session_token, status, is_test,
        project_timeframe_days, created_by, source_sale_id, configuration_revision_id,
        welcome_revision_id, completion_revision_id, snapshot_schema_version,
        composition_hash, composition_snapshot, created_at, updated_at
    ) values (
        v_session_id, p_workspace_id, v_sale.relationship_id, v_session_token, 'active',
        coalesce((select (source_metadata->>'is_test')::boolean from public.relationships where id = v_sale.relationship_id), false),
        v_sale.project_timeframe_days, v_sale.created_by, p_sale_id, v_configuration_revision_id,
        v_welcome_revision_id, v_completion_revision_id, 1, v_composition_hash,
        jsonb_build_object('sale_id', p_sale_id, 'items', v_snapshot), v_now, v_now
    );

    for v_item in
        select * from public.client_sale_composition_items
        where workspace_id = p_workspace_id and client_sale_id = p_sale_id
        order by sort_order
    loop
        if v_item.item_kind = 'module' then
            v_module_definition := v_item.definition;
            insert into public.relationship_onboarding_session_modules (
                workspace_id, session_id, module_id, module_revision_id, source_kind,
                source_service_revision_id, sort_order, title, description, is_test
            ) values (
                p_workspace_id, v_session_id, v_item.module_id, v_item.module_revision_id,
                v_item.source_kind, v_item.source_service_revision_id, v_item.sort_order,
                coalesce(v_module_definition->>'name', 'Onboarding module'),
                nullif(v_module_definition->>'description', ''),
                coalesce((v_module_definition->>'isTest')::boolean, false)
            ) returning id into v_session_module_id;
            for v_step in select value from jsonb_array_elements(coalesce(v_module_definition->'steps', '[]'::jsonb)) with ordinality order by ordinality loop
                insert into public.relationship_onboarding_session_steps (
                    workspace_id, session_id, session_module_id, source_step_id, module_revision_id,
                    kind, title, description, estimated_time, why_we_ask, video_url,
                    video_storage_path, sort_order, legacy_step_key, legacy_form_key
                ) values (
                    p_workspace_id, v_session_id, v_session_module_id, (v_step->>'id')::uuid,
                    v_item.module_revision_id, v_step->>'kind', coalesce(v_step->>'title', 'Onboarding step'),
                    nullif(v_step->>'description', ''), nullif(v_step->>'estimatedTime', ''), nullif(v_step->>'why', ''),
                    nullif(v_step->>'videoUrl', ''), nullif(v_step->>'videoPath', ''),
                    v_item.sort_order * 1000 + coalesce((select count(*) from public.relationship_onboarding_session_steps existing where existing.session_module_id = v_session_module_id), 0),
                    nullif(v_step->>'key', ''), nullif(v_step->>'formKey', '')
                ) returning id into v_session_step_id;
                for v_field in select value from jsonb_array_elements(coalesce(v_step->'fields', '[]'::jsonb)) with ordinality order by ordinality loop
                    insert into public.relationship_onboarding_session_fields (
                        workspace_id, session_id, session_step_id, source_field_id, type, label,
                        required, help_text, placeholder, file_accept, multiple, sort_order, legacy_field_name
                    ) values (
                        p_workspace_id, v_session_id, v_session_step_id, (v_field->>'id')::uuid,
                        v_field->>'type', coalesce(v_field->>'label', 'Field'),
                        coalesce((v_field->>'required')::boolean, false), nullif(v_field->>'helpText', ''),
                        nullif(v_field->>'placeholder', ''),
                        case when v_field->>'type' = 'file' then coalesce(nullif(v_field->>'accept', ''), 'any') else null end,
                        case when v_field->>'type' = 'file' then coalesce((v_field->>'multiple')::boolean, true) else false end,
                        coalesce((select count(*) from public.relationship_onboarding_session_fields existing where existing.session_step_id = v_session_step_id), 0),
                        nullif(v_field->>'key', '')
                    );
                end loop;
            end loop;
        else
            insert into public.relationship_onboarding_session_steps (
                workspace_id, session_id, bookend_revision_id, kind, title, description,
                video_url, video_storage_path, sort_order, legacy_step_key
            ) values (
                p_workspace_id, v_session_id, v_item.configuration_revision_id, v_item.item_kind,
                coalesce(v_item.definition->>'title', initcap(v_item.item_kind)),
                nullif(coalesce(v_item.definition->>'body', v_item.definition->>'description'), ''),
                nullif(v_item.definition->>'videoUrl', ''), nullif(v_item.definition->>'videoPath', ''),
                v_item.sort_order * 1000, v_item.item_kind
            );
        end if;
    end loop;

    select id into v_stage_id from public.work_items
    where workspace_id = p_workspace_id and native_kind = 'relationship_workflow'
      and native_key = v_sale.relationship_id::text || ':onboarding'
    for update;
    if v_stage_id is null then
        insert into public.work_items (
            workspace_id, title, description, lifecycle_phase, status, priority, is_key_task,
            native_kind, native_key, workflow_role, completion_mode, workflow_action,
            actual_start_at, actual_start_has_time, sort_order,
            metadata, created_by
        ) values (
            p_workspace_id, 'Onboard Client', 'Complete the client onboarding session.',
            'onboarding', 'doing', 2, true, 'relationship_workflow',
            v_sale.relationship_id::text || ':onboarding', 'lifecycle_stage',
            'all_required_children', 'await_onboarding', v_now, true, 0,
            jsonb_build_object('relationship_id', v_sale.relationship_id, 'created_from', 'paid_onboarding'),
            v_sale.created_by
        ) returning id into v_stage_id;
    end if;
    insert into public.work_item_relationships (workspace_id, work_item_id, relationship_id)
    values (p_workspace_id, v_stage_id, v_sale.relationship_id)
    on conflict (work_item_id, relationship_id) do nothing;

    v_previous_work_item_id := null;
    for v_work_step in
        select * from public.relationship_onboarding_session_steps
        where workspace_id = p_workspace_id and session_id = v_session_id and kind <> 'completion'
        order by sort_order limit 2
    loop
        insert into public.work_items (
            workspace_id, title, description, lifecycle_phase, status, priority, is_key_task,
            native_kind, native_key, native_href, parent_work_item_id, workflow_role,
            planned_start_date, actual_start_at, actual_start_has_time, sort_order,
            metadata, created_by
        ) values (
            p_workspace_id, v_work_step.title, v_work_step.description, 'onboarding', 'todo', 3, true,
            'onboarding_step', v_session_id::text || ':step:' || v_work_step.id::text, null,
            v_stage_id, 'task', null,
            case when v_previous_work_item_id is null then v_now else null end,
            v_previous_work_item_id is null, v_work_step.sort_order,
            jsonb_strip_nulls(jsonb_build_object(
                'session_id', v_session_id, 'relationship_id', v_sale.relationship_id,
                'session_step_id', v_work_step.id, 'step_key', v_work_step.legacy_step_key,
                'module_revision_id', v_work_step.module_revision_id, 'kind', v_work_step.kind,
                'auto_created', true
            )), v_sale.created_by
        ) returning id into v_work_item_id;
        insert into public.work_item_relationships (workspace_id, work_item_id, relationship_id)
        values (p_workspace_id, v_work_item_id, v_sale.relationship_id)
        on conflict (work_item_id, relationship_id) do nothing;
        if v_previous_work_item_id is not null then
            insert into public.work_item_dependencies (workspace_id, work_item_id, depends_on_work_item_id, source)
            values (p_workspace_id, v_work_item_id, v_previous_work_item_id, 'manual')
            on conflict (work_item_id, depends_on_work_item_id) do nothing;
        end if;
        v_previous_work_item_id := v_work_item_id;
    end loop;

    insert into public.relationship_services (
        workspace_id, relationship_id, service_key, price_cents, currency,
        assignee_user_id, service_id, service_revision_id
    )
    select p_workspace_id, v_sale.relationship_id, item.service_code, item.amount_cents,
           lower(item.currency), item.default_assignee_user_id, item.service_id, item.service_revision_id
    from public.client_sale_items item
    where item.workspace_id = p_workspace_id and item.client_sale_id = p_sale_id
    on conflict (relationship_id, service_key) do update set
        price_cents = excluded.price_cents, currency = excluded.currency,
        assignee_user_id = excluded.assignee_user_id, service_id = excluded.service_id,
        service_revision_id = excluded.service_revision_id;
    update public.relationships
    set lifecycle_phase = 'onboarding', started_onboarding_at = coalesce(started_onboarding_at, v_now), updated_at = v_now
    where workspace_id = p_workspace_id and id = v_sale.relationship_id;
    update public.client_sales
    set onboarding_session_id = v_session_id, correlation_id = v_correlation_id, updated_at = v_now
    where workspace_id = p_workspace_id and id = p_sale_id;

    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.session.composed', 'Paid onboarding session composed',
        p_entity_type => 'onboarding_session', p_entity_id => v_session_id::text,
        p_actor_kind => 'automation', p_correlation_id => v_correlation_id,
        p_idempotency_key => p_idempotency_key || ':composed',
        p_metadata => jsonb_build_object(
            'sale_id', p_sale_id, 'relationship_id', v_sale.relationship_id,
            'configuration_revision_id', v_configuration_revision_id,
            'welcome_revision_id', v_welcome_revision_id,
            'completion_revision_id', v_completion_revision_id,
            'module_count', (select count(*) from public.relationship_onboarding_session_modules where session_id = v_session_id),
            'step_count', (select count(*) from public.relationship_onboarding_session_steps where session_id = v_session_id),
            'field_count', (select count(*) from public.relationship_onboarding_session_fields where session_id = v_session_id),
            'composition_hash', v_composition_hash
        )
    );
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.session.started', 'Client onboarding session started after payment',
        p_entity_type => 'onboarding_session', p_entity_id => v_session_id::text,
        p_actor_kind => 'automation', p_correlation_id => v_correlation_id,
        p_idempotency_key => p_idempotency_key || ':started',
        p_metadata => jsonb_build_object('sale_id', p_sale_id, 'relationship_id', v_sale.relationship_id, 'is_test', false)
    );
    return jsonb_build_object(
        'session_id', v_session_id, 'session_token', v_session_token,
        'relationship_id', v_sale.relationship_id, 'created', true,
        'composition_hash', v_composition_hash
    );
end;
$$;

revoke all on function public.create_paid_onboarding_session(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_paid_onboarding_session(uuid, uuid, uuid, text) to service_role;
