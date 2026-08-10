-- Atomic operational paths for frozen invoices and publishing a module into
-- active sessions. Storage cleanup and WhatsApp delivery happen after commit.

create table if not exists public.onboarding_session_notices (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null,
    session_id uuid not null,
    session_module_id uuid not null,
    module_revision_id uuid not null,
    explanation text not null check (char_length(trim(explanation)) between 1 and 2000),
    requires_completion boolean not null default false,
    first_seen_at timestamptz,
    dismissed_at timestamptz,
    module_completed_at timestamptz,
    created_at timestamptz not null default now(),
    foreign key (workspace_id, relationship_id)
        references public.relationships(workspace_id, id) on delete cascade,
    foreign key (workspace_id, session_id)
        references public.relationship_onboarding_sessions(workspace_id, id) on delete cascade,
    foreign key (workspace_id, session_module_id)
        references public.relationship_onboarding_session_modules(workspace_id, id) on delete cascade,
    foreign key (workspace_id, module_revision_id)
        references public.onboarding_module_revisions(workspace_id, id) on delete restrict,
    unique (session_id, module_revision_id)
);

create table if not exists public.onboarding_storage_cleanup_outbox (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    session_id uuid references public.relationship_onboarding_sessions(id) on delete set null,
    correlation_id uuid not null,
    storage_path text not null,
    reason text not null check (reason in ('active_module_reset', 'asset_replaced', 'session_cleanup')),
    status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed', 'canceled')),
    idempotency_key text not null,
    attempt_count integer not null default 0 check (attempt_count >= 0),
    next_attempt_at timestamptz not null default now(),
    locked_at timestamptz,
    completed_at timestamptz,
    error_code text,
    error_summary text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (workspace_id, idempotency_key)
);
create index if not exists onboarding_storage_cleanup_queue_idx
on public.onboarding_storage_cleanup_outbox(status, next_attempt_at, created_at)
where status in ('queued', 'failed');

alter table public.onboarding_session_notices enable row level security;
alter table public.onboarding_storage_cleanup_outbox enable row level security;
create policy "workspace admins read onboarding session notices" on public.onboarding_session_notices
for select using (public.is_workspace_member(workspace_id, array['owner','admin']));
create policy "workspace admins read onboarding storage cleanup" on public.onboarding_storage_cleanup_outbox
for select using (public.is_workspace_member(workspace_id, array['owner','admin']));

drop trigger if exists onboarding_storage_cleanup_outbox_updated_at on public.onboarding_storage_cleanup_outbox;
create trigger onboarding_storage_cleanup_outbox_updated_at
before update on public.onboarding_storage_cleanup_outbox
for each row execute function public.set_updated_at();

-- Keep superseded edit requests as diagnostic history when their old snapshot
-- step is replaced. Pending requests still require a live, same-workspace step.
alter table public.onboarding_edit_requests
    add column if not exists original_session_step_id uuid;
update public.onboarding_edit_requests
set original_session_step_id = session_step_id
where original_session_step_id is null;
alter table public.onboarding_edit_requests
    drop constraint if exists onboarding_edit_requests_workspace_id_session_step_id_fkey;
alter table public.onboarding_edit_requests
    alter column session_step_id drop not null;
alter table public.onboarding_edit_requests
    add constraint onboarding_edit_requests_session_step_fkey
        foreign key (session_step_id)
        references public.relationship_onboarding_session_steps(id) on delete set null,
    add constraint onboarding_edit_requests_pending_step_check
        check (status <> 'pending' or session_step_id is not null);

create or replace function public.validate_onboarding_edit_request_step()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.session_step_id is not null and not exists (
        select 1
        from public.relationship_onboarding_session_steps step
        where step.id = new.session_step_id
          and step.workspace_id = new.workspace_id
          and step.session_id = new.session_id
    ) then
        raise exception 'Edit request step must belong to the same workspace and session';
    end if;
    return new;
end;
$$;
drop trigger if exists validate_onboarding_edit_request_step on public.onboarding_edit_requests;
create trigger validate_onboarding_edit_request_step
before insert or update of workspace_id, session_id, session_step_id on public.onboarding_edit_requests
for each row execute function public.validate_onboarding_edit_request_step();

-- Database-side filters and a stable (occurred_at,id) cursor keep permanent
-- Activity routes deterministic even when many events share a timestamp.
create or replace function public.list_workspace_admin_activity(
    p_workspace_id uuid,
    p_category text default null,
    p_level text default null,
    p_before_occurred_at timestamptz default null,
    p_before_id uuid default null,
    p_limit integer default 100
)
returns setof public.workspace_admin_activity
language sql
stable
security invoker
set search_path = public
as $$
    select event.*
    from public.workspace_admin_activity event
    where event.workspace_id = p_workspace_id
      and (p_category is null or event.category = p_category)
      and (p_level is null or event.level = p_level)
      and (
          p_before_occurred_at is null
          or (event.occurred_at, event.id) < (p_before_occurred_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
      )
    order by event.occurred_at desc, event.id desc
    limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;
revoke all on function public.list_workspace_admin_activity(uuid, text, text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.list_workspace_admin_activity(uuid, text, text, timestamptz, uuid, integer) to authenticated, service_role;

create or replace function public.workspace_admin_activity_facets(
    p_workspace_id uuid,
    p_category text default null,
    p_level text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
    select jsonb_build_object(
        'level_total', count(*) filter (where p_category is null or category = p_category),
        'category_total', count(*) filter (where p_level is null or level = p_level),
        'by_level', jsonb_build_object(
            'info', count(*) filter (where level = 'info' and (p_category is null or category = p_category)),
            'warning', count(*) filter (where level = 'warning' and (p_category is null or category = p_category)),
            'error', count(*) filter (where level = 'error' and (p_category is null or category = p_category))
        ),
        'by_category', jsonb_build_object(
            'onboarding', count(*) filter (where category = 'onboarding' and (p_level is null or level = p_level)),
            'services', count(*) filter (where category = 'services' and (p_level is null or level = p_level)),
            'leadgen', count(*) filter (where category = 'leadgen' and (p_level is null or level = p_level)),
            'billing', count(*) filter (where category = 'billing' and (p_level is null or level = p_level)),
            'communications', count(*) filter (where category = 'communications' and (p_level is null or level = p_level)),
            'gantt', count(*) filter (where category = 'gantt' and (p_level is null or level = p_level)),
            'integrations', count(*) filter (where category = 'integrations' and (p_level is null or level = p_level)),
            'maintenance', count(*) filter (where category = 'maintenance' and (p_level is null or level = p_level)),
            'system', count(*) filter (where category = 'system' and (p_level is null or level = p_level))
        )
    )
    from public.workspace_admin_activity
    where workspace_id = p_workspace_id;
$$;
revoke all on function public.workspace_admin_activity_facets(uuid, text, text) from public, anon;
grant execute on function public.workspace_admin_activity_facets(uuid, text, text) to authenticated, service_role;

create or replace function public.freeze_client_sale_configuration(
    p_workspace_id uuid,
    p_relationship_id uuid,
    p_actor_user_id uuid,
    p_sale_id uuid,
    p_correlation_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_sale public.client_sales%rowtype;
    v_configuration public.onboarding_configuration_revisions%rowtype;
    v_welcome public.onboarding_configuration_revisions%rowtype;
    v_completion public.onboarding_configuration_revisions%rowtype;
    v_currency text;
    v_service_count integer;
    v_item_count integer;
    v_module_count integer;
    v_sort integer := 0;
    v_composition jsonb;
    v_hash text;
    v_service record;
    v_module record;
    v_seen_module_ids uuid[] := '{}'::uuid[];
    v_correlation_id uuid := coalesce(p_correlation_id, gen_random_uuid());
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);

    perform 1 from public.relationships
    where workspace_id = p_workspace_id and id = p_relationship_id
    for update;
    if not found then
        raise exception 'INVOICE_RELATIONSHIP_NOT_FOUND: Relationship does not belong to this workspace';
    end if;

    select * into v_sale
    from public.client_sales
    where workspace_id = p_workspace_id
      and id = p_sale_id
      and relationship_id = p_relationship_id
    for update;
    if v_sale.id is null then
        raise exception 'INVOICE_SALE_NOT_FOUND: Sale does not belong to this relationship';
    end if;
    if v_sale.snapshot_frozen_at is not null then
        select count(*)::integer into v_item_count
        from public.client_sale_items where client_sale_id = p_sale_id;
        select count(*)::integer into v_module_count
        from public.client_sale_composition_items
        where client_sale_id = p_sale_id and item_kind = 'module';
        return jsonb_build_object(
            'sale_id', v_sale.id,
            'configuration_revision_id', v_sale.configuration_revision_id,
            'welcome_revision_id', v_sale.welcome_revision_id,
            'completion_revision_id', v_sale.completion_revision_id,
            'composition_hash', v_sale.composition_hash,
            'item_count', v_item_count,
            'module_count', v_module_count
        );
    end if;
    if v_sale.status <> 'draft' then
        raise exception 'INVOICE_NOT_DRAFT: A sent sale must be voided and replaced before alteration';
    end if;
    if jsonb_typeof(v_sale.service_keys) <> 'array' or jsonb_array_length(v_sale.service_keys) = 0 then
        raise exception 'INVOICE_SERVICES_REQUIRED: Select at least one service before sending';
    end if;

    select revision.* into v_configuration
    from public.onboarding_configuration_revisions revision
    where revision.workspace_id = p_workspace_id
      and revision.configuration_type = 'mandatory_modules'
      and revision.status = 'published'
    order by revision.revision_number desc limit 1;
    select revision.* into v_welcome
    from public.onboarding_configuration_revisions revision
    where revision.workspace_id = p_workspace_id
      and revision.configuration_type = 'welcome'
      and revision.status = 'published'
    order by revision.revision_number desc limit 1;
    select revision.* into v_completion
    from public.onboarding_configuration_revisions revision
    where revision.workspace_id = p_workspace_id
      and revision.configuration_type = 'completion'
      and revision.status = 'published'
    order by revision.revision_number desc limit 1;
    if v_configuration.id is null then raise exception 'ONBOARDING_CONFIGURATION_REQUIRED: Publish mandatory onboarding settings first'; end if;
    if v_welcome.id is null or v_completion.id is null then raise exception 'ONBOARDING_BOOKENDS_REQUIRED: Publish welcome and completion before sending'; end if;

    select count(*)::integer, min(upper(rs.currency)), max(upper(rs.currency))
    into v_service_count, v_currency, v_hash
    from public.relationship_services rs
    join public.onboarding_services service
      on service.workspace_id = rs.workspace_id and service.id = rs.service_id
    join public.onboarding_service_revisions revision
      on revision.workspace_id = rs.workspace_id and revision.id = rs.service_revision_id
     and revision.service_id = service.id
    where rs.workspace_id = p_workspace_id
      and rs.relationship_id = p_relationship_id
      and rs.service_key in (select jsonb_array_elements_text(v_sale.service_keys))
      and service.state = 'active'
      and rs.price_cents is not null and rs.price_cents > 0
      and rs.currency is not null;
    if v_service_count <> jsonb_array_length(v_sale.service_keys) then
        raise exception 'INVOICE_SERVICE_REVISION_INVALID: Every selected service needs an Active service revision and positive negotiated price';
    end if;
    if v_currency is distinct from v_hash then
        raise exception 'INVOICE_CURRENCY_MISMATCH: All selected services must use one currency';
    end if;

    delete from public.client_sale_composition_items where client_sale_id = p_sale_id;
    delete from public.client_sale_items where client_sale_id = p_sale_id;

    for v_service in
        select rs.*, service.internal_code, revision.name, revision.description,
               revision.default_assignee_user_id, revision.display_priority,
               revision.fulfilment_definition_revision_id, revision.revision_number
        from public.relationship_services rs
        join public.onboarding_services service
          on service.workspace_id = rs.workspace_id and service.id = rs.service_id
        join public.onboarding_service_revisions revision
          on revision.workspace_id = rs.workspace_id and revision.id = rs.service_revision_id
        where rs.workspace_id = p_workspace_id
          and rs.relationship_id = p_relationship_id
          and rs.service_key in (select jsonb_array_elements_text(v_sale.service_keys))
        order by revision.display_priority desc, revision.name, service.id
    loop
        insert into public.client_sale_items (
            workspace_id, client_sale_id, service_id, service_revision_id,
            service_code, service_name, description, amount_cents, currency,
            default_assignee_user_id, display_priority, sort_order,
            fulfilment_definition_revision_id
        ) values (
            p_workspace_id, p_sale_id, v_service.service_id, v_service.service_revision_id,
            v_service.internal_code, v_service.name, v_service.description,
            v_service.price_cents, upper(v_service.currency),
            coalesce(v_service.assignee_user_id, v_service.default_assignee_user_id),
            v_service.display_priority, v_sort, v_service.fulfilment_definition_revision_id
        );
        v_sort := v_sort + 1;
    end loop;

    v_sort := 0;
    insert into public.client_sale_composition_items (
        workspace_id, client_sale_id, item_kind, source_kind,
        configuration_revision_id, sort_order, definition, source_references
    ) values (
        p_workspace_id, p_sale_id, 'welcome', 'bookend', v_welcome.id, v_sort,
        v_welcome.definition,
        jsonb_build_object('configuration_revision_id', v_welcome.id, 'revision_number', v_welcome.revision_number)
    );
    v_sort := v_sort + 1;

    for v_module in
        select module.id as module_id, module.internal_code,
               published.id as module_revision_id, published.revision_number,
               published.definition
        from public.onboarding_configuration_revision_modules assignment
        join public.onboarding_modules module
          on module.workspace_id = assignment.workspace_id and module.id = assignment.module_id
        join lateral (
            select revision.* from public.onboarding_module_revisions revision
            where revision.workspace_id = module.workspace_id
              and revision.module_id = module.id and revision.status = 'published'
            order by revision.revision_number desc limit 1
        ) published on true
        where assignment.workspace_id = p_workspace_id
          and assignment.configuration_revision_id = v_configuration.id
          and module.status = 'active'
        order by assignment.sort_order
    loop
        v_seen_module_ids := array_append(v_seen_module_ids, v_module.module_id);
        insert into public.client_sale_composition_items (
            workspace_id, client_sale_id, item_kind, source_kind, module_id,
            module_revision_id, configuration_revision_id, sort_order,
            definition, source_references
        ) values (
            p_workspace_id, p_sale_id, 'module', 'mandatory', v_module.module_id,
            v_module.module_revision_id, v_configuration.id, v_sort,
            v_module.definition,
            jsonb_build_object(
                'module_code', v_module.internal_code,
                'module_revision_id', v_module.module_revision_id,
                'module_revision_number', v_module.revision_number,
                'configuration_revision_id', v_configuration.id,
                'configuration_revision_number', v_configuration.revision_number
            )
        );
        v_sort := v_sort + 1;
    end loop;

    for v_module in
        with candidates as (
            select assignment.module_id, module.internal_code,
                   published.id as module_revision_id, published.revision_number,
                   published.definition, item.id as source_service_item_id,
                   item.service_revision_id, item.display_priority,
                   item.sort_order as service_sort_order,
                   assignment.sort_order as module_sort_order,
                   row_number() over (
                       partition by assignment.module_id
                       order by item.display_priority desc, item.sort_order,
                                assignment.sort_order, item.service_revision_id
                   ) as winner_rank
            from public.client_sale_items item
            join public.onboarding_service_revision_modules assignment
              on assignment.workspace_id = item.workspace_id
             and assignment.service_revision_id = item.service_revision_id
            join public.onboarding_modules module
              on module.workspace_id = assignment.workspace_id and module.id = assignment.module_id
            join lateral (
                select revision.* from public.onboarding_module_revisions revision
                where revision.workspace_id = module.workspace_id
                  and revision.module_id = module.id and revision.status = 'published'
                order by revision.revision_number desc limit 1
            ) published on true
            where item.workspace_id = p_workspace_id
              and item.client_sale_id = p_sale_id
              and module.status = 'active'
              and not (assignment.module_id = any(v_seen_module_ids))
        )
        select * from candidates
        where winner_rank = 1
        order by display_priority desc, service_sort_order, module_sort_order, module_id
    loop
        v_seen_module_ids := array_append(v_seen_module_ids, v_module.module_id);
        insert into public.client_sale_composition_items (
            workspace_id, client_sale_id, item_kind, source_kind, module_id,
            module_revision_id, source_service_item_id, source_service_revision_id,
            sort_order, definition, source_references
        ) values (
            p_workspace_id, p_sale_id, 'module', 'service', v_module.module_id,
            v_module.module_revision_id, v_module.source_service_item_id,
            v_module.service_revision_id, v_sort, v_module.definition,
            jsonb_build_object(
                'module_code', v_module.internal_code,
                'module_revision_id', v_module.module_revision_id,
                'module_revision_number', v_module.revision_number,
                'service_revision_id', v_module.service_revision_id,
                'service_priority', v_module.display_priority,
                'service_module_sort_order', v_module.module_sort_order
            )
        );
        v_sort := v_sort + 1;
    end loop;

    insert into public.client_sale_composition_items (
        workspace_id, client_sale_id, item_kind, source_kind,
        configuration_revision_id, sort_order, definition, source_references
    ) values (
        p_workspace_id, p_sale_id, 'completion', 'bookend', v_completion.id, v_sort,
        v_completion.definition,
        jsonb_build_object('configuration_revision_id', v_completion.id, 'revision_number', v_completion.revision_number)
    );

    select jsonb_agg(jsonb_build_object(
        'id', item.id, 'kind', item.item_kind, 'source_kind', item.source_kind,
        'module_id', item.module_id, 'module_revision_id', item.module_revision_id,
        'configuration_revision_id', item.configuration_revision_id,
        'source_service_revision_id', item.source_service_revision_id,
        'sort_order', item.sort_order, 'definition', item.definition,
        'source_references', item.source_references
    ) order by item.sort_order)
    into v_composition
    from public.client_sale_composition_items item
    where item.workspace_id = p_workspace_id and item.client_sale_id = p_sale_id;
    v_hash := encode(extensions.digest(convert_to(v_composition::text, 'UTF8'), 'sha256'), 'hex');
    select count(*)::integer into v_item_count
    from public.client_sale_items where client_sale_id = p_sale_id;
    select count(*)::integer into v_module_count
    from public.client_sale_composition_items
    where client_sale_id = p_sale_id and item_kind = 'module';

    update public.client_sales
    set configuration_revision_id = v_configuration.id,
        welcome_revision_id = v_welcome.id,
        completion_revision_id = v_completion.id,
        composition_hash = v_hash,
        snapshot_frozen_at = now(),
        correlation_id = v_correlation_id,
        currency = lower(v_currency),
        total_amount = (
            select coalesce(sum(amount_cents), 0)
            from public.client_sale_items where client_sale_id = p_sale_id
        ),
        updated_at = now()
    where id = p_sale_id and workspace_id = p_workspace_id;

    perform public.record_workspace_admin_activity(
        p_workspace_id, 'billing', 'billing.invoice.snapshot_frozen',
        'Invoice service and onboarding configuration frozen',
        p_entity_type => 'client_sale', p_entity_id => p_sale_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_correlation_id => v_correlation_id,
        p_idempotency_key => 'billing.invoice.snapshot_frozen:' || p_sale_id::text,
        p_metadata => jsonb_build_object(
            'relationship_id', p_relationship_id,
            'configuration_revision_id', v_configuration.id,
            'welcome_revision_id', v_welcome.id,
            'completion_revision_id', v_completion.id,
            'service_count', v_item_count,
            'module_count', v_module_count,
            'composition_hash', v_hash,
            'currency', v_currency
        )
    );
    return jsonb_build_object(
        'sale_id', p_sale_id,
        'configuration_revision_id', v_configuration.id,
        'welcome_revision_id', v_welcome.id,
        'completion_revision_id', v_completion.id,
        'composition_hash', v_hash,
        'item_count', v_item_count,
        'module_count', v_module_count
    );
end;
$$;
revoke all on function public.freeze_client_sale_configuration(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.freeze_client_sale_configuration(uuid, uuid, uuid, uuid, uuid) to service_role;

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
    v_correlation_id uuid := gen_random_uuid();
    v_session_module record;
    v_step jsonb;
    v_field jsonb;
    v_session_step_id uuid;
    v_old_step_ids uuid[];
    v_old_work_ids uuid[];
    v_preceding_work_ids uuid[];
    v_following_work_ids uuid[];
    v_stage_id uuid;
    v_previous_work_item_id uuid;
    v_work_item_id uuid;
    v_step_row record;
    v_reset_count integer := 0;
    v_asset_count integer := 0;
    v_work_count integer := 0;
    v_requires_completion boolean;
    v_new_snapshot jsonb;
    v_delivery_outbox_id uuid;
    v_explanation text := coalesce(
        nullif(trim(p_explanation), ''),
        'We updated this part of your onboarding so we can collect the right information. Please complete it again.'
    );
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
      and snapshot_module.module_id = p_module_id and session.status = 'active';

    insert into public.onboarding_module_revisions (
        workspace_id, module_id, revision_number, status, definition, definition_hash,
        created_by, updated_by, published_by, published_at
    ) values (
        p_workspace_id, p_module_id, v_revision_number, 'published', v_definition,
        encode(extensions.digest(convert_to(v_definition::text, 'UTF8'), 'sha256'), 'hex'),
        p_actor_user_id, p_actor_user_id, p_actor_user_id, now()
    ) returning id into v_revision_id;

    if p_apply_to_active then
        for v_session_module in
            select snapshot_module.*, session.relationship_id, relationship.whatsapp_phone
            from public.relationship_onboarding_session_modules snapshot_module
            join public.relationship_onboarding_sessions session on session.id = snapshot_module.session_id
            join public.relationships relationship on relationship.id = session.relationship_id
            where snapshot_module.workspace_id = p_workspace_id
              and snapshot_module.module_id = p_module_id
              and session.status = 'active'
            order by session.id
            for update of snapshot_module, session
        loop
            select coalesce(array_agg(step.id), '{}'::uuid[]) into v_old_step_ids
            from public.relationship_onboarding_session_steps step
            where step.workspace_id = p_workspace_id
              and step.session_module_id = v_session_module.id;

            select
                exists (
                    select 1 from public.work_items item
                    where item.workspace_id = p_workspace_id
                      and item.native_kind = 'onboarding_step'
                      and item.metadata->>'session_step_id' = any(v_old_step_ids::text[])
                      and (item.status in ('doing', 'done') or item.actual_completed_at is not null)
                )
                or exists (
                    select 1 from public.assets asset
                    where asset.workspace_id = p_workspace_id
                      and asset.source_kind = 'onboarding_submission'
                      and asset.metadata->>'session_step_id' = any(v_old_step_ids::text[])
                )
                or exists (
                    select 1 from public.onboarding_step_drafts draft
                    where draft.workspace_id = p_workspace_id
                      and draft.session_step_id = any(v_old_step_ids)
                )
            into v_requires_completion;

            insert into public.onboarding_storage_cleanup_outbox (
                workspace_id, session_id, correlation_id, storage_path, reason, idempotency_key
            )
            select distinct p_workspace_id, v_session_module.session_id, v_correlation_id,
                   asset.storage_path, 'active_module_reset',
                   format('module-reset:%s:%s', v_revision_id, md5(asset.storage_path))
            from public.assets asset
            where asset.workspace_id = p_workspace_id
              and asset.source_kind = 'onboarding_submission'
              and asset.storage_path is not null
              and asset.metadata->>'session_step_id' = any(v_old_step_ids::text[])
            on conflict (workspace_id, idempotency_key) do nothing;

            with removed as (
                delete from public.assets asset
                where asset.workspace_id = p_workspace_id
                  and asset.source_kind = 'onboarding_submission'
                  and asset.metadata->>'session_step_id' = any(v_old_step_ids::text[])
                returning 1
            ) select count(*)::integer into v_asset_count from removed;

            update public.onboarding_edit_requests
            set status = 'superseded', superseded_at = now(),
                original_session_step_id = coalesce(original_session_step_id, session_step_id),
                session_step_id = null
            where workspace_id = p_workspace_id
              and session_id = v_session_module.session_id
              and status = 'pending'
              and session_step_id = any(v_old_step_ids);
            delete from public.onboarding_step_drafts
            where workspace_id = p_workspace_id
              and session_id = v_session_module.session_id
              and session_step_id = any(v_old_step_ids);

            select coalesce(array_agg(item.id), '{}'::uuid[]) into v_old_work_ids
            from public.work_items item
            where item.workspace_id = p_workspace_id
              and item.native_kind = 'onboarding_step'
              and item.metadata->>'session_step_id' = any(v_old_step_ids::text[]);
            select coalesce(array_agg(distinct dependency.depends_on_work_item_id), '{}'::uuid[])
            into v_preceding_work_ids
            from public.work_item_dependencies dependency
            where dependency.workspace_id = p_workspace_id
              and dependency.work_item_id = any(v_old_work_ids)
              and not (dependency.depends_on_work_item_id = any(v_old_work_ids));
            select coalesce(array_agg(distinct dependency.work_item_id), '{}'::uuid[])
            into v_following_work_ids
            from public.work_item_dependencies dependency
            where dependency.workspace_id = p_workspace_id
              and dependency.depends_on_work_item_id = any(v_old_work_ids)
              and not (dependency.work_item_id = any(v_old_work_ids));
            v_work_count := coalesce(array_length(v_old_work_ids, 1), 0);
            delete from public.work_items where id = any(v_old_work_ids);

            delete from public.relationship_onboarding_session_steps
            where workspace_id = p_workspace_id and session_module_id = v_session_module.id;
            update public.relationship_onboarding_session_modules
            set module_revision_id = v_revision_id,
                title = coalesce(v_definition->>'name', 'Onboarding module'),
                description = nullif(v_definition->>'description', ''),
                is_test = coalesce((v_definition->>'isTest')::boolean, false)
            where id = v_session_module.id and workspace_id = p_workspace_id;

            for v_step in
                select value from jsonb_array_elements(v_definition->'steps') with ordinality as steps(value, position)
                order by position
            loop
                insert into public.relationship_onboarding_session_steps (
                    workspace_id, session_id, session_module_id, source_step_id,
                    module_revision_id, kind, title, description, estimated_time,
                    why_we_ask, video_url, video_storage_path, sort_order,
                    legacy_step_key, legacy_form_key
                ) values (
                    p_workspace_id, v_session_module.session_id, v_session_module.id,
                    (v_step->>'id')::uuid, v_revision_id, v_step->>'kind',
                    coalesce(v_step->>'title', 'Onboarding step'),
                    nullif(v_step->>'description', ''), nullif(v_step->>'estimatedTime', ''),
                    nullif(v_step->>'why', ''), nullif(v_step->>'videoUrl', ''),
                    nullif(v_step->>'videoPath', ''),
                    v_session_module.sort_order * 1000 +
                        (select count(*) from public.relationship_onboarding_session_steps current_step where current_step.session_module_id = v_session_module.id),
                    nullif(v_step->>'key', ''), nullif(v_step->>'formKey', '')
                ) returning id into v_session_step_id;
                for v_field in
                    select value from jsonb_array_elements(coalesce(v_step->'fields', '[]'::jsonb)) with ordinality as fields(value, position)
                    order by position
                loop
                    insert into public.relationship_onboarding_session_fields (
                        workspace_id, session_id, session_step_id, source_field_id,
                        type, label, required, help_text, placeholder, file_accept,
                        multiple, sort_order, legacy_field_name
                    ) values (
                        p_workspace_id, v_session_module.session_id, v_session_step_id,
                        (v_field->>'id')::uuid, v_field->>'type',
                        coalesce(v_field->>'label', 'Field'),
                        coalesce((v_field->>'required')::boolean, false),
                        nullif(v_field->>'helpText', ''), nullif(v_field->>'placeholder', ''),
                        case when v_field->>'type' = 'file' then coalesce(nullif(v_field->>'accept', ''), 'any') else null end,
                        case when v_field->>'type' = 'file' then coalesce((v_field->>'multiple')::boolean, true) else false end,
                        (select count(*) from public.relationship_onboarding_session_fields current_field where current_field.session_step_id = v_session_step_id),
                        nullif(v_field->>'key', '')
                    );
                end loop;
            end loop;

            select id into v_stage_id
            from public.work_items
            where workspace_id = p_workspace_id
              and native_kind = 'relationship_workflow'
              and native_key = v_session_module.relationship_id::text || ':onboarding'
            for update;
            v_previous_work_item_id := null;
            for v_step_row in
                select * from public.relationship_onboarding_session_steps
                where workspace_id = p_workspace_id
                  and session_module_id = v_session_module.id
                order by sort_order
            loop
                insert into public.work_items (
                    workspace_id, title, description, lifecycle_phase, status,
                    priority, is_key_task, native_kind, native_key,
                    parent_work_item_id, workflow_role, sort_order, metadata, created_by
                ) values (
                    p_workspace_id, v_step_row.title, v_step_row.description,
                    'onboarding', 'todo', 3, true, 'onboarding_step',
                    v_session_module.session_id::text || ':step:' || v_step_row.id::text,
                    v_stage_id, 'task', v_step_row.sort_order,
                    jsonb_strip_nulls(jsonb_build_object(
                        'session_id', v_session_module.session_id,
                        'relationship_id', v_session_module.relationship_id,
                        'session_step_id', v_step_row.id,
                        'step_key', v_step_row.legacy_step_key,
                        'module_revision_id', v_revision_id,
                        'kind', v_step_row.kind,
                        'auto_created', true,
                        'reset_by_module_publish', true
                    )), p_actor_user_id
                ) returning id into v_work_item_id;
                insert into public.work_item_relationships (workspace_id, work_item_id, relationship_id)
                values (p_workspace_id, v_work_item_id, v_session_module.relationship_id)
                on conflict (work_item_id, relationship_id) do nothing;
                if v_previous_work_item_id is not null then
                    insert into public.work_item_dependencies (
                        workspace_id, work_item_id, depends_on_work_item_id, source, created_by
                    ) values (
                        p_workspace_id, v_work_item_id, v_previous_work_item_id, 'manual', p_actor_user_id
                    ) on conflict (work_item_id, depends_on_work_item_id) do nothing;
                elsif coalesce(array_length(v_preceding_work_ids, 1), 0) > 0 then
                    insert into public.work_item_dependencies (
                        workspace_id, work_item_id, depends_on_work_item_id, source, created_by
                    )
                    select p_workspace_id, v_work_item_id, prerequisite_id, 'manual', p_actor_user_id
                    from unnest(v_preceding_work_ids) as prerequisites(prerequisite_id)
                    on conflict (work_item_id, depends_on_work_item_id) do nothing;
                end if;
                v_previous_work_item_id := v_work_item_id;
            end loop;
            if v_previous_work_item_id is not null and coalesce(array_length(v_following_work_ids, 1), 0) > 0 then
                insert into public.work_item_dependencies (
                    workspace_id, work_item_id, depends_on_work_item_id, source, created_by
                )
                select p_workspace_id, following_id, v_previous_work_item_id, 'manual', p_actor_user_id
                from unnest(v_following_work_ids) as following_items(following_id)
                on conflict (work_item_id, depends_on_work_item_id) do nothing;
            end if;

            insert into public.onboarding_session_notices (
                workspace_id, relationship_id, session_id, session_module_id,
                module_revision_id, explanation, requires_completion
            ) values (
                p_workspace_id, v_session_module.relationship_id,
                v_session_module.session_id, v_session_module.id,
                v_revision_id, v_explanation, v_requires_completion
            );
            if nullif(trim(v_session_module.whatsapp_phone), '') is not null then
                insert into public.onboarding_delivery_outbox (
                    workspace_id, relationship_id, session_id, correlation_id,
                    kind, destination, payload, idempotency_key
                ) values (
                    p_workspace_id, v_session_module.relationship_id,
                    v_session_module.session_id, v_correlation_id,
                    'module_update', v_session_module.whatsapp_phone,
                    jsonb_build_object(
                        'module_id', p_module_id,
                        'module_revision_id', v_revision_id,
                        'explanation', v_explanation
                    ),
                    format('module-update:%s:%s', v_revision_id, v_session_module.session_id)
                ) on conflict (workspace_id, idempotency_key) do update
                    set idempotency_key = excluded.idempotency_key
                returning id into v_delivery_outbox_id;
                perform public.record_workspace_admin_activity(
                    p_workspace_id, 'communications', 'onboarding.link.queued',
                    'Onboarding module update queued for WhatsApp delivery',
                    p_entity_type => 'onboarding_session',
                    p_entity_id => v_session_module.session_id::text,
                    p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
                    p_correlation_id => v_correlation_id,
                    p_idempotency_key => 'onboarding.delivery.queued:' || v_delivery_outbox_id::text,
                    p_outcome => 'queued', p_metric_classification => 'audit',
                    p_metadata => jsonb_build_object(
                        'outbox_id', v_delivery_outbox_id,
                        'relationship_id', v_session_module.relationship_id,
                        'kind', 'module_update'
                    )
                );
            end if;
            select case
                when jsonb_typeof(session.composition_snapshot->'items') = 'array' then
                    jsonb_set(
                        session.composition_snapshot,
                        '{items}',
                        coalesce((
                            select jsonb_agg(
                                case when item->>'module_id' = p_module_id::text then
                                    item || jsonb_build_object(
                                        'module_revision_id', v_revision_id,
                                        'definition', v_definition,
                                        'source_references', coalesce(item->'source_references', '{}'::jsonb) || jsonb_build_object(
                                            'module_revision_id', v_revision_id,
                                            'module_revision_number', v_revision_number
                                        )
                                    )
                                else item end
                                order by position
                            )
                            from jsonb_array_elements(session.composition_snapshot->'items') with ordinality as items(item, position)
                        ), '[]'::jsonb),
                        true
                    )
                else session.composition_snapshot
            end || jsonb_build_object(
                    'latest_active_migration', jsonb_build_object(
                        'module_id', p_module_id,
                        'module_revision_id', v_revision_id,
                        'revision_number', v_revision_number,
                        'migrated_at', now(),
                        'correlation_id', v_correlation_id
                    )
                ) into v_new_snapshot
            from public.relationship_onboarding_sessions session
            where session.id = v_session_module.session_id and session.workspace_id = p_workspace_id;
            update public.relationship_onboarding_sessions
            set composition_snapshot = v_new_snapshot,
                composition_hash = encode(extensions.digest(convert_to(v_new_snapshot::text, 'UTF8'), 'sha256'), 'hex'),
                updated_at = now()
            where id = v_session_module.session_id and workspace_id = p_workspace_id;

            perform public.record_workspace_admin_activity(
                p_workspace_id, 'onboarding', 'onboarding.session.module_reset',
                'Active onboarding module reset to a newly published revision',
                p_entity_type => 'onboarding_session',
                p_entity_id => v_session_module.session_id::text,
                p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
                p_correlation_id => v_correlation_id,
                p_idempotency_key => format('onboarding.session.module_reset:%s:%s', v_session_module.session_id, v_revision_id),
                p_metadata => jsonb_build_object(
                    'relationship_id', v_session_module.relationship_id,
                    'module_id', p_module_id,
                    'previous_module_revision_id', v_session_module.module_revision_id,
                    'new_module_revision_id', v_revision_id,
                    'new_revision_number', v_revision_number,
                    'cleared_asset_count', v_asset_count,
                    'replaced_work_item_count', v_work_count,
                    'explanation_supplied', true
                )
            );
            v_reset_count := v_reset_count + 1;
        end loop;
    end if;

    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.module.published',
        'Onboarding module published',
        p_entity_type => 'onboarding_module', p_entity_id => p_module_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_correlation_id => v_correlation_id,
        p_idempotency_key => format('onboarding.module.published:%s:%s', p_module_id, v_revision_number),
        p_metadata => jsonb_build_object(
            'revision_id', v_revision_id,
            'revision_number', v_revision_number,
            'apply_to_active', p_apply_to_active,
            'affected_active_sessions', v_affected,
            'migrated_active_sessions', v_reset_count,
            'step_count', jsonb_array_length(v_definition->'steps'),
            'explanation_supplied', p_apply_to_active
        )
    );
    if p_apply_to_active and v_reset_count > 0 then
        perform public.record_workspace_admin_activity(
            p_workspace_id, 'onboarding', 'onboarding.module.active_sessions_migrated',
            'Published onboarding module migrated into active sessions',
            p_entity_type => 'onboarding_module', p_entity_id => p_module_id::text,
            p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
            p_correlation_id => v_correlation_id,
            p_idempotency_key => format('onboarding.module.active_sessions_migrated:%s', v_revision_id),
            p_metadata => jsonb_build_object(
                'revision_id', v_revision_id,
                'revision_number', v_revision_number,
                'session_count', v_reset_count
            )
        );
    end if;
    return jsonb_build_object(
        'module_id', p_module_id, 'revision_id', v_revision_id,
        'revision_number', v_revision_number,
        'affected_active_sessions', v_affected
    );
end;
$$;
revoke all on function public.publish_onboarding_module(uuid, uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.publish_onboarding_module(uuid, uuid, uuid, boolean, text) to service_role;

create or replace function public.enqueue_onboarding_link_delivery(
    p_workspace_id uuid,
    p_sale_id uuid,
    p_relationship_id uuid,
    p_session_id uuid,
    p_destination text,
    p_body text,
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
    v_session public.relationship_onboarding_sessions%rowtype;
    v_outbox public.onboarding_delivery_outbox%rowtype;
    v_event_id uuid;
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Onboarding delivery may only be queued by trusted automation';
    end if;
    if nullif(trim(p_destination), '') is null then
        raise exception using errcode = '22023', message = 'Onboarding delivery destination is required';
    end if;
    if nullif(trim(p_body), '') is null then
        raise exception using errcode = '22023', message = 'Onboarding delivery message is required';
    end if;
    if nullif(trim(p_idempotency_key), '') is null then
        raise exception using errcode = '22023', message = 'Onboarding delivery idempotency key is required';
    end if;
    perform 1 from public.relationships
    where workspace_id = p_workspace_id and id = p_relationship_id
    for update;
    if not found then
        raise exception using errcode = 'P0001', message = 'Onboarding delivery relationship not found';
    end if;
    select * into v_sale
    from public.client_sales
    where workspace_id = p_workspace_id and id = p_sale_id
      and relationship_id = p_relationship_id and deleted_at is null
    for update;
    if v_sale.id is null then
        raise exception using errcode = 'P0001', message = 'Onboarding delivery sale not found';
    end if;
    select * into v_session
    from public.relationship_onboarding_sessions
    where workspace_id = p_workspace_id and id = p_session_id
      and relationship_id = p_relationship_id
      and source_sale_id = p_sale_id and status in ('active', 'completed')
    for update;
    if v_session.id is null then
        raise exception using errcode = 'P0001', message = 'Onboarding delivery session does not match this sale';
    end if;
    select * into v_outbox
    from public.onboarding_delivery_outbox
    where workspace_id = p_workspace_id and idempotency_key = trim(p_idempotency_key)
    for update;
    if v_outbox.id is not null then
        if v_outbox.kind <> 'onboarding_link'
           or v_outbox.relationship_id is distinct from p_relationship_id
           or v_outbox.session_id is distinct from p_session_id
           or v_outbox.payload->>'sale_id' is distinct from p_sale_id::text then
            raise exception using errcode = '23505', message = 'Onboarding delivery idempotency key is already used by another operation';
        end if;
        return jsonb_build_object(
            'outbox_id', v_outbox.id, 'status', v_outbox.status,
            'created', false
        );
    end if;
    insert into public.onboarding_delivery_outbox (
        workspace_id, relationship_id, session_id, correlation_id, kind,
        destination, payload, idempotency_key
    ) values (
        p_workspace_id, p_relationship_id, p_session_id,
        coalesce(p_correlation_id, v_sale.correlation_id, v_session.source_sale_id, v_session.id),
        'onboarding_link', left(trim(p_destination), 500),
        jsonb_build_object(
            'sale_id', v_sale.id,
            'client_id', v_sale.client_id,
            'message', left(p_body, 8000)
        ), trim(p_idempotency_key)
    ) returning * into v_outbox;
    update public.client_sales
    set status = case when status = 'onboarding_link_sent' then status else 'onboarding_created' end,
        onboarding_session_id = coalesce(onboarding_session_id, p_session_id),
        correlation_id = coalesce(correlation_id, v_outbox.correlation_id),
        updated_at = now()
    where workspace_id = p_workspace_id and id = p_sale_id;
    v_event_id := public.record_workspace_admin_activity(
        p_workspace_id, 'communications', 'onboarding.link.queued',
        'Onboarding link queued for WhatsApp delivery',
        p_entity_type => 'onboarding_session', p_entity_id => p_session_id::text,
        p_actor_kind => 'automation', p_correlation_id => v_outbox.correlation_id,
        p_idempotency_key => 'onboarding.link.queued:' || v_outbox.id::text,
        p_metadata => jsonb_build_object(
            'outbox_id', v_outbox.id, 'sale_id', p_sale_id,
            'relationship_id', p_relationship_id, 'kind', v_outbox.kind
        )
    );
    return jsonb_build_object(
        'outbox_id', v_outbox.id, 'status', v_outbox.status,
        'created', true, 'event_id', v_event_id
    );
end;
$$;

create or replace function public.claim_onboarding_delivery_outbox(
    p_workspace_id uuid,
    p_limit integer default 25
)
returns setof public.onboarding_delivery_outbox
language plpgsql
security invoker
set search_path = public
as $$
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Delivery outbox may only be claimed by trusted automation';
    end if;
    return query
    with due as (
        select outbox.id
        from public.onboarding_delivery_outbox outbox
        where outbox.workspace_id = p_workspace_id
          and (
              (outbox.status in ('queued', 'failed') and outbox.next_attempt_at <= now())
              or (outbox.status = 'processing' and outbox.locked_at < now() - interval '15 minutes')
          )
        order by coalesce(outbox.locked_at, outbox.next_attempt_at), outbox.created_at, outbox.id
        for update skip locked
        limit greatest(1, least(coalesce(p_limit, 25), 100))
    )
    update public.onboarding_delivery_outbox outbox
    set status = 'processing', locked_at = now(),
        attempt_count = outbox.attempt_count + 1, updated_at = now()
    from due
    where outbox.id = due.id
    returning outbox.*;
end;
$$;

create or replace function public.finish_onboarding_delivery_outbox(
    p_workspace_id uuid,
    p_outbox_id uuid,
    p_succeeded boolean,
    p_provider_message_id text default null,
    p_error_code text default null,
    p_error_summary text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_outbox public.onboarding_delivery_outbox%rowtype;
    v_sale_id uuid;
    v_work_item_id uuid;
    v_event_id uuid;
    v_next_attempt_at timestamptz;
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Delivery outbox may only be finished by trusted automation';
    end if;
    select * into v_outbox
    from public.onboarding_delivery_outbox
    where workspace_id = p_workspace_id and id = p_outbox_id
    for update;
    if v_outbox.id is null then raise exception 'Delivery outbox item not found'; end if;
    if v_outbox.status in ('sent', 'canceled') then
        return jsonb_build_object('outbox_id', v_outbox.id, 'status', v_outbox.status, 'idempotent', true);
    end if;
    if v_outbox.kind = 'onboarding_link'
       and coalesce(v_outbox.payload->>'sale_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_sale_id := (v_outbox.payload->>'sale_id')::uuid;
    end if;
    if p_succeeded then
        update public.onboarding_delivery_outbox
        set status = 'sent', sent_at = now(), provider_message_id = p_provider_message_id,
            error_code = null, error_summary = null, locked_at = null, updated_at = now()
        where id = v_outbox.id;
        if v_sale_id is not null then
            update public.client_sales
            set status = 'onboarding_link_sent', onboarding_link_sent_at = now(),
                onboarding_link_message_id = coalesce(p_provider_message_id, onboarding_link_message_id),
                onboarding_session_id = coalesce(onboarding_session_id, v_outbox.session_id),
                correlation_id = coalesce(correlation_id, v_outbox.correlation_id),
                updated_at = now()
            where workspace_id = p_workspace_id and id = v_sale_id
              and relationship_id = v_outbox.relationship_id;
        end if;
        update public.client_messages
        set status = 'sent',
            provider_message_id = coalesce(p_provider_message_id, provider_message_id),
            whatsapp_message_id = coalesce(p_provider_message_id, whatsapp_message_id),
            error = null
        where workspace_id = p_workspace_id
          and raw_payload @> jsonb_build_object('outbox_id', v_outbox.id);
        update public.work_items
        set status = 'done', actual_completed_at = coalesce(actual_completed_at, now()),
            actual_completed_has_time = true, updated_at = now()
        where workspace_id = p_workspace_id
          and native_kind = 'onboarding_delivery_failure'
          and native_key = 'onboarding-delivery:' || v_outbox.id::text
          and status not in ('done', 'canceled');
        v_event_id := public.record_workspace_admin_activity(
            p_workspace_id, 'communications', 'onboarding.link.sent',
            case when v_outbox.kind = 'module_update' then 'Onboarding module update sent through WhatsApp' else 'Onboarding link sent through WhatsApp' end,
            p_entity_type => 'onboarding_session', p_entity_id => v_outbox.session_id::text,
            p_actor_kind => 'automation', p_correlation_id => v_outbox.correlation_id,
            p_idempotency_key => format('onboarding.delivery.sent:%s:%s', v_outbox.id, v_outbox.attempt_count),
            p_outcome => 'succeeded', p_metric_classification => 'internal_call',
            p_metadata => jsonb_build_object(
                'outbox_id', v_outbox.id, 'relationship_id', v_outbox.relationship_id,
                'sale_id', v_sale_id, 'kind', v_outbox.kind, 'attempt_count', v_outbox.attempt_count,
                'provider_message_id', p_provider_message_id
            )
        );
        return jsonb_build_object('outbox_id', v_outbox.id, 'status', 'sent', 'event_id', v_event_id);
    end if;

    v_next_attempt_at := now() + make_interval(secs => least(3600, 30 * power(2, least(greatest(v_outbox.attempt_count - 1, 0), 7)))::integer);
    update public.onboarding_delivery_outbox
    set status = 'failed', error_code = nullif(trim(p_error_code), ''),
        error_summary = left(nullif(trim(p_error_summary), ''), 1000),
        next_attempt_at = v_next_attempt_at, locked_at = null, updated_at = now()
    where id = v_outbox.id;
    if v_sale_id is not null then
        update public.client_sales
        set status = 'onboarding_link_failed',
            onboarding_session_id = coalesce(onboarding_session_id, v_outbox.session_id),
            correlation_id = coalesce(correlation_id, v_outbox.correlation_id),
            updated_at = now()
        where workspace_id = p_workspace_id and id = v_sale_id
          and relationship_id = v_outbox.relationship_id;
    end if;
    update public.client_messages
    set status = 'send_failed',
        error = left(coalesce(nullif(trim(p_error_summary), ''), 'Onboarding delivery failed'), 1000)
    where workspace_id = p_workspace_id
      and raw_payload @> jsonb_build_object('outbox_id', v_outbox.id);

    if v_outbox.relationship_id is not null then
        insert into public.work_items (
            workspace_id, title, description, lifecycle_phase, status, priority,
            is_key_task, native_kind, native_key, area, kind, visibility,
            metadata, created_by
        ) values (
            p_workspace_id, 'Restore onboarding WhatsApp delivery',
            'The client onboarding message could not be delivered. Check the number or provider status, then retry.',
            'onboarding', 'todo', 2, true, 'onboarding_delivery_failure',
            'onboarding-delivery:' || v_outbox.id::text, 'workspace', 'standard', 'workspace',
            jsonb_build_object(
                'relationship_id', v_outbox.relationship_id,
                'session_id', v_outbox.session_id,
                'outbox_id', v_outbox.id,
                'error_code', nullif(trim(p_error_code), ''),
                'error_summary', left(nullif(trim(p_error_summary), ''), 1000),
                'attempt_count', v_outbox.attempt_count,
                'next_attempt_at', v_next_attempt_at
            ), null
        )
        on conflict (workspace_id, native_kind, native_key)
        where native_kind is not null and native_key is not null
        do update set
            status = case when public.work_items.status in ('done', 'canceled') then 'todo' else public.work_items.status end,
            metadata = public.work_items.metadata || excluded.metadata,
            updated_at = now()
        returning id into v_work_item_id;
        insert into public.work_item_relationships (workspace_id, work_item_id, relationship_id)
        values (p_workspace_id, v_work_item_id, v_outbox.relationship_id)
        on conflict (work_item_id, relationship_id) do nothing;
    end if;
    v_event_id := public.record_workspace_admin_activity(
        p_workspace_id, 'communications', 'onboarding.link.failed',
        'Onboarding WhatsApp delivery failed',
        p_level => 'error', p_entity_type => 'onboarding_session',
        p_entity_id => v_outbox.session_id::text,
        p_actor_kind => 'automation', p_correlation_id => v_outbox.correlation_id,
        p_idempotency_key => format('onboarding.delivery.failed:%s:%s', v_outbox.id, v_outbox.attempt_count),
        p_outcome => 'failed', p_metric_classification => 'internal_call',
        p_maintenance_work_item_id => null,
        p_metadata => jsonb_build_object(
            'outbox_id', v_outbox.id, 'relationship_id', v_outbox.relationship_id,
            'sale_id', v_sale_id, 'kind', v_outbox.kind, 'attempt_count', v_outbox.attempt_count,
            'delivery_work_item_id', v_work_item_id, 'next_attempt_at', v_next_attempt_at
        ),
        p_diagnostics => jsonb_build_object(
            'error_code', nullif(trim(p_error_code), ''),
            'error_summary', left(nullif(trim(p_error_summary), ''), 1000)
        )
    );
    return jsonb_build_object(
        'outbox_id', v_outbox.id, 'status', 'failed',
        'event_id', v_event_id, 'delivery_work_item_id', v_work_item_id,
        'next_attempt_at', v_next_attempt_at
    );
end;
$$;

create or replace function public.claim_onboarding_storage_cleanup_outbox(
    p_workspace_id uuid,
    p_limit integer default 25
)
returns setof public.onboarding_storage_cleanup_outbox
language plpgsql
security invoker
set search_path = public
as $$
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Storage cleanup outbox may only be claimed by trusted automation';
    end if;
    return query
    with due as (
        select outbox.id
        from public.onboarding_storage_cleanup_outbox outbox
        where outbox.workspace_id = p_workspace_id
          and (
              (outbox.status in ('queued', 'failed') and outbox.next_attempt_at <= now())
              or (outbox.status = 'processing' and outbox.locked_at < now() - interval '15 minutes')
          )
        order by coalesce(outbox.locked_at, outbox.next_attempt_at), outbox.created_at, outbox.id
        for update skip locked
        limit greatest(1, least(coalesce(p_limit, 25), 100))
    )
    update public.onboarding_storage_cleanup_outbox outbox
    set status = 'processing', locked_at = now(),
        attempt_count = outbox.attempt_count + 1, updated_at = now()
    from due where outbox.id = due.id
    returning outbox.*;
end;
$$;

create or replace function public.finish_onboarding_storage_cleanup_outbox(
    p_workspace_id uuid,
    p_outbox_id uuid,
    p_succeeded boolean,
    p_error_code text default null,
    p_error_summary text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_outbox public.onboarding_storage_cleanup_outbox%rowtype;
    v_event_id uuid;
    v_next_attempt_at timestamptz;
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Storage cleanup outbox may only be finished by trusted automation';
    end if;
    select * into v_outbox from public.onboarding_storage_cleanup_outbox
    where workspace_id = p_workspace_id and id = p_outbox_id for update;
    if v_outbox.id is null then raise exception 'Storage cleanup outbox item not found'; end if;
    if v_outbox.status in ('completed', 'canceled') then
        return jsonb_build_object('outbox_id', v_outbox.id, 'status', v_outbox.status, 'idempotent', true);
    end if;
    if p_succeeded then
        update public.onboarding_storage_cleanup_outbox
        set status = 'completed', completed_at = now(), locked_at = null,
            error_code = null, error_summary = null, updated_at = now()
        where id = v_outbox.id;
        v_event_id := public.record_workspace_admin_activity(
            p_workspace_id, 'onboarding', 'onboarding.storage_cleanup.completed',
            'Superseded onboarding upload removed from storage',
            p_entity_type => 'onboarding_session', p_entity_id => v_outbox.session_id::text,
            p_actor_kind => 'automation', p_correlation_id => v_outbox.correlation_id,
            p_idempotency_key => format('onboarding.storage_cleanup.completed:%s:%s', v_outbox.id, v_outbox.attempt_count),
            p_outcome => 'succeeded', p_metric_classification => 'internal_call',
            p_metadata => jsonb_build_object('outbox_id', v_outbox.id, 'reason', v_outbox.reason, 'attempt_count', v_outbox.attempt_count)
        );
        return jsonb_build_object('outbox_id', v_outbox.id, 'status', 'completed', 'event_id', v_event_id);
    end if;
    v_next_attempt_at := now() + make_interval(secs => least(3600, 30 * power(2, least(greatest(v_outbox.attempt_count - 1, 0), 7)))::integer);
    update public.onboarding_storage_cleanup_outbox
    set status = 'failed', error_code = nullif(trim(p_error_code), ''),
        error_summary = left(nullif(trim(p_error_summary), ''), 1000),
        next_attempt_at = v_next_attempt_at, locked_at = null, updated_at = now()
    where id = v_outbox.id;
    v_event_id := public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.storage_cleanup.failed',
        'Superseded onboarding upload cleanup failed',
        p_level => 'error', p_entity_type => 'onboarding_session',
        p_entity_id => v_outbox.session_id::text,
        p_actor_kind => 'automation', p_correlation_id => v_outbox.correlation_id,
        p_idempotency_key => format('onboarding.storage_cleanup.failed:%s:%s', v_outbox.id, v_outbox.attempt_count),
        p_outcome => 'failed', p_metric_classification => 'internal_call',
        p_metadata => jsonb_build_object('outbox_id', v_outbox.id, 'reason', v_outbox.reason, 'attempt_count', v_outbox.attempt_count, 'next_attempt_at', v_next_attempt_at),
        p_diagnostics => jsonb_build_object('error_code', nullif(trim(p_error_code), ''), 'error_summary', left(nullif(trim(p_error_summary), ''), 1000))
    );
    return jsonb_build_object('outbox_id', v_outbox.id, 'status', 'failed', 'event_id', v_event_id, 'next_attempt_at', v_next_attempt_at);
end;
$$;

revoke all on function public.claim_onboarding_delivery_outbox(uuid, integer) from public, anon, authenticated;
revoke all on function public.enqueue_onboarding_link_delivery(uuid, uuid, uuid, uuid, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.finish_onboarding_delivery_outbox(uuid, uuid, boolean, text, text, text) from public, anon, authenticated;
revoke all on function public.claim_onboarding_storage_cleanup_outbox(uuid, integer) from public, anon, authenticated;
revoke all on function public.finish_onboarding_storage_cleanup_outbox(uuid, uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.claim_onboarding_delivery_outbox(uuid, integer) to service_role;
grant execute on function public.enqueue_onboarding_link_delivery(uuid, uuid, uuid, uuid, text, text, uuid, text) to service_role;
grant execute on function public.finish_onboarding_delivery_outbox(uuid, uuid, boolean, text, text, text) to service_role;
grant execute on function public.claim_onboarding_storage_cleanup_outbox(uuid, integer) to service_role;
grant execute on function public.finish_onboarding_storage_cleanup_outbox(uuid, uuid, boolean, text, text) to service_role;

-- Consequential client/session mutations are coupled to their definitive
-- Activity row. The application keeps its former direct-write path only while
-- this rolling migration is not yet present in the target workspace.
create or replace function public.revoke_relationship_onboarding_session_token(
    p_workspace_id uuid,
    p_relationship_id uuid,
    p_session_id uuid,
    p_actor_user_id uuid,
    p_expected_token_version integer,
    p_correlation_id uuid default null,
    p_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_session public.relationship_onboarding_sessions%rowtype;
    v_workspace_slug text;
    v_event_id uuid;
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Onboarding session tokens may only be changed by trusted server actions';
    end if;
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    select slug into v_workspace_slug from public.workspaces where id = p_workspace_id;
    if v_workspace_slug is null or not exists (
        select 1 from public.relationships
        where workspace_id = p_workspace_id and id = p_relationship_id
    ) then
        raise exception using errcode = 'P0001', message = 'Onboarding relationship not found';
    end if;
    select * into v_session
    from public.relationship_onboarding_sessions
    where workspace_id = p_workspace_id
      and relationship_id = p_relationship_id
      and id = p_session_id
      and status in ('active', 'completed')
    for update;
    if v_session.id is null then
        raise exception using errcode = 'P0001', message = 'Onboarding session not found';
    end if;
    if v_session.token_revoked_at is not null then
        return jsonb_build_object(
            'session_id', v_session.id, 'revoked', true,
            'token_version', v_session.token_version, 'idempotent', true
        );
    end if;
    if p_expected_token_version is null
       or v_session.token_version <> p_expected_token_version then
        raise exception using errcode = '40001', message = 'The onboarding link changed. Reload and try again';
    end if;
    update public.relationship_onboarding_sessions
    set token_revoked_at = now(), updated_at = now()
    where workspace_id = p_workspace_id and id = v_session.id;
    v_event_id := public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.token.revoked',
        'Onboarding link revoked',
        p_entity_type => 'onboarding_session', p_entity_id => v_session.id::text,
        p_source_href => format('/%s/onboarding/%s', v_workspace_slug, p_relationship_id),
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_correlation_id => coalesce(p_correlation_id, v_session.source_sale_id, v_session.id),
        p_idempotency_key => coalesce(
            nullif(trim(p_idempotency_key), ''),
            format('onboarding.token.revoked:%s:%s', v_session.id, v_session.token_version)
        ),
        p_metadata => jsonb_build_object(
            'relationship_id', p_relationship_id,
            'session_id', v_session.id,
            'token_version', v_session.token_version
        )
    );
    return jsonb_build_object(
        'session_id', v_session.id, 'revoked', true,
        'token_version', v_session.token_version,
        'event_id', v_event_id, 'idempotent', false
    );
end;
$$;

create or replace function public.rotate_relationship_onboarding_session_token(
    p_workspace_id uuid,
    p_relationship_id uuid,
    p_session_id uuid,
    p_actor_user_id uuid,
    p_expected_token_version integer,
    p_new_token text,
    p_correlation_id uuid default null,
    p_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_session public.relationship_onboarding_sessions%rowtype;
    v_workspace_slug text;
    v_next_version integer;
    v_event_id uuid;
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Onboarding session tokens may only be changed by trusted server actions';
    end if;
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    if p_new_token is null or p_new_token !~ '^[0-9a-f]{64}$' then
        raise exception using errcode = '22023', message = 'A 64-character lowercase hexadecimal onboarding token is required';
    end if;
    select slug into v_workspace_slug from public.workspaces where id = p_workspace_id;
    if v_workspace_slug is null or not exists (
        select 1 from public.relationships
        where workspace_id = p_workspace_id and id = p_relationship_id
    ) then
        raise exception using errcode = 'P0001', message = 'Onboarding relationship not found';
    end if;
    select * into v_session
    from public.relationship_onboarding_sessions
    where workspace_id = p_workspace_id
      and relationship_id = p_relationship_id
      and id = p_session_id
      and status in ('active', 'completed')
    for update;
    if v_session.id is null then
        raise exception using errcode = 'P0001', message = 'Onboarding session not found';
    end if;
    v_next_version := p_expected_token_version + 1;
    if v_session.session_token = p_new_token
       and v_session.token_version = v_next_version
       and v_session.token_revoked_at is null then
        return jsonb_build_object(
            'session_id', v_session.id, 'session_token', p_new_token,
            'token_version', v_session.token_version, 'rotated', true,
            'idempotent', true
        );
    end if;
    if p_expected_token_version is null
       or v_session.token_version <> p_expected_token_version then
        raise exception using errcode = '40001', message = 'The onboarding link changed. Reload and try again';
    end if;
    update public.relationship_onboarding_sessions
    set session_token = p_new_token, token_version = v_next_version,
        token_revoked_at = null, updated_at = now()
    where workspace_id = p_workspace_id and id = v_session.id;
    v_event_id := public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.token.rotated',
        'Onboarding link rotated',
        p_entity_type => 'onboarding_session', p_entity_id => v_session.id::text,
        p_source_href => format('/%s/onboarding/%s', v_workspace_slug, p_relationship_id),
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_correlation_id => coalesce(p_correlation_id, v_session.source_sale_id, v_session.id),
        p_idempotency_key => coalesce(
            nullif(trim(p_idempotency_key), ''),
            format('onboarding.token.rotated:%s:%s', v_session.id, v_next_version)
        ),
        p_metadata => jsonb_build_object(
            'relationship_id', p_relationship_id,
            'session_id', v_session.id,
            'previous_token_version', v_session.token_version,
            'token_version', v_next_version
        )
    );
    return jsonb_build_object(
        'session_id', v_session.id, 'session_token', p_new_token,
        'token_version', v_next_version, 'rotated', true,
        'event_id', v_event_id, 'idempotent', false
    );
end;
$$;

create or replace function public.record_onboarding_edit_request(
    p_workspace_id uuid,
    p_session_id uuid,
    p_session_step_id uuid,
    p_session_token text,
    p_correlation_id uuid default null,
    p_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_session public.relationship_onboarding_sessions%rowtype;
    v_step public.relationship_onboarding_session_steps%rowtype;
    v_request public.onboarding_edit_requests%rowtype;
    v_workspace_slug text;
    v_event_id uuid;
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Client onboarding mutations require trusted server access';
    end if;
    select * into v_session
    from public.relationship_onboarding_sessions
    where workspace_id = p_workspace_id and id = p_session_id
      and session_token = p_session_token
      and token_revoked_at is null
      and status in ('active', 'completed')
    for update;
    if v_session.id is null then
        raise exception using errcode = 'P0001', message = 'Invalid onboarding session';
    end if;
    select * into v_step
    from public.relationship_onboarding_session_steps
    where workspace_id = p_workspace_id and session_id = p_session_id
      and id = p_session_step_id and kind in ('form', 'video', 'welcome')
    for update;
    if v_step.id is null or not exists (
        select 1 from public.work_items item
        where item.workspace_id = p_workspace_id
          and item.native_kind = 'onboarding_step'
          and item.status = 'done'
          and (
              item.native_key = p_session_id::text || ':step:' || p_session_step_id::text
              or (
                  item.metadata->>'session_id' = p_session_id::text
                  and item.metadata->>'session_step_id' = p_session_step_id::text
              )
          )
    ) then
        raise exception using errcode = 'P0001', message = 'Only submitted steps can have an edit request';
    end if;
    select * into v_request
    from public.onboarding_edit_requests
    where workspace_id = p_workspace_id and session_id = p_session_id
      and session_step_id = p_session_step_id and status = 'pending'
    for update;
    if v_request.id is not null then
        return jsonb_build_object(
            'request_id', v_request.id, 'requested', true,
            'already_requested', true
        );
    end if;
    insert into public.onboarding_edit_requests (
        workspace_id, relationship_id, session_id, session_step_id,
        original_session_step_id, status
    ) values (
        p_workspace_id, v_session.relationship_id, p_session_id,
        p_session_step_id, p_session_step_id, 'pending'
    ) returning * into v_request;
    select slug into v_workspace_slug from public.workspaces where id = p_workspace_id;
    v_event_id := public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.edit_request.recorded',
        'Client requested an edit to onboarding step: ' || v_step.title,
        p_entity_type => 'onboarding_edit_request', p_entity_id => v_request.id::text,
        p_source_href => format('/%s/onboarding/%s', v_workspace_slug, v_session.relationship_id),
        p_actor_kind => 'client',
        p_correlation_id => coalesce(p_correlation_id, v_session.source_sale_id, v_session.id),
        p_idempotency_key => coalesce(
            nullif(trim(p_idempotency_key), ''),
            format('onboarding.edit_request.recorded:%s:%s', p_session_id, p_session_step_id)
        ),
        p_metadata => jsonb_build_object(
            'relationship_id', v_session.relationship_id,
            'session_id', p_session_id,
            'session_step_id', p_session_step_id
        )
    );
    return jsonb_build_object(
        'request_id', v_request.id, 'requested', true,
        'already_requested', false, 'event_id', v_event_id
    );
end;
$$;

create or replace function public.complete_onboarding_session_step(
    p_workspace_id uuid,
    p_session_id uuid,
    p_session_step_id uuid,
    p_work_item_id uuid,
    p_session_token text,
    p_correlation_id uuid default null,
    p_idempotency_key text default null,
    p_form_response jsonb default null,
    p_form_title text default null,
    p_form_key text default null,
    p_uploads jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_session public.relationship_onboarding_sessions%rowtype;
    v_step public.relationship_onboarding_session_steps%rowtype;
    v_work_item public.work_items%rowtype;
    v_workspace_slug text;
    v_predecessor_completed_at timestamptz;
    v_completed_at timestamptz;
    v_notice_count integer := 0;
    v_event_id uuid;
    v_idempotent boolean := false;
    v_submission_asset_id uuid;
    v_upload jsonb;
    v_upload_asset_id uuid;
    v_upload_native_key text;
    v_active_upload_keys text[] := '{}'::text[];
    v_rolling_step record;
    v_rolling_index integer := 0;
    v_rolling_predecessor_id uuid;
    v_rolling_work_item_id uuid;
    v_next_work_item_id uuid;
    v_upcoming_work_item_id uuid;
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Client onboarding mutations require trusted server access';
    end if;
    if jsonb_typeof(coalesce(p_uploads, '[]'::jsonb)) <> 'array' then
        raise exception using errcode = '22023', message = 'Onboarding upload descriptors must be an array';
    end if;
    select * into v_session
    from public.relationship_onboarding_sessions
    where workspace_id = p_workspace_id and id = p_session_id
      and session_token = p_session_token
      and token_revoked_at is null and status = 'active'
    for update;
    if v_session.id is null then
        raise exception using errcode = 'P0001', message = 'This onboarding session is no longer writable';
    end if;
    select * into v_step
    from public.relationship_onboarding_session_steps
    where workspace_id = p_workspace_id and session_id = p_session_id
      and id = p_session_step_id and kind in ('form', 'video', 'welcome')
    for update;
    if v_step.id is null then
        raise exception using errcode = 'P0001', message = 'Your onboarding session was updated. Reload this page to continue.';
    end if;
    select * into v_work_item
    from public.work_items item
    where item.workspace_id = p_workspace_id and item.id = p_work_item_id
      and item.native_kind = 'onboarding_step'
      and (
          item.native_key = p_session_id::text || ':step:' || p_session_step_id::text
          or (
              item.metadata->>'session_id' = p_session_id::text
              and item.metadata->>'session_step_id' = p_session_step_id::text
          )
      )
    for update;
    if v_work_item.id is null then
        raise exception using errcode = 'P0001', message = 'Invalid onboarding step';
    end if;
    if v_work_item.parent_work_item_id is null then
        raise exception using errcode = 'P0001', message = 'Onboarding workflow is missing its lifecycle stage';
    end if;
    if v_work_item.status <> 'done' and (
        exists (
            select 1
            from public.work_item_dependencies dependency
            join public.work_items predecessor
              on predecessor.workspace_id = dependency.workspace_id
             and predecessor.id = dependency.depends_on_work_item_id
            where dependency.workspace_id = p_workspace_id
              and dependency.work_item_id = v_work_item.id
              and predecessor.status <> 'done'
        )
        or exists (
            select 1
            from public.relationship_onboarding_session_steps snapshot_step
            where snapshot_step.workspace_id = p_workspace_id
              and snapshot_step.session_id = p_session_id
              and snapshot_step.kind <> 'completion'
              and snapshot_step.sort_order < v_step.sort_order
              and not exists (
                  select 1
                  from public.work_items earlier_work
                  where earlier_work.workspace_id = p_workspace_id
                    and earlier_work.native_kind = 'onboarding_step'
                    and earlier_work.status = 'done'
                    and (
                        earlier_work.native_key = p_session_id::text || ':step:' || snapshot_step.id::text
                        or (
                            earlier_work.metadata->>'session_id' = p_session_id::text
                            and earlier_work.metadata->>'session_step_id' = snapshot_step.id::text
                        )
                    )
              )
        )
    ) then
        raise exception using errcode = 'P0001', message = 'Complete the earlier onboarding step first.';
    end if;
    if v_work_item.status <> 'done' and p_form_response is not null then
        if v_step.kind <> 'form' or jsonb_typeof(p_form_response) <> 'object' then
            raise exception using errcode = '22023', message = 'A form response can only be submitted for a form step';
        end if;
        insert into public.assets (
            workspace_id, title, description, asset_kind, source_kind,
            native_kind, native_key, metadata, updated_at
        ) values (
            p_workspace_id, left(coalesce(nullif(trim(p_form_title), ''), v_step.title) || ' submission', 500),
            'Onboarding form submission.', 'form_submission', 'onboarding_submission',
            'onboarding_form_submission',
            p_session_id::text || ':step:' || p_session_step_id::text || ':submission',
            jsonb_build_object(
                'session_id', p_session_id,
                'relationship_id', v_session.relationship_id,
                'session_step_id', p_session_step_id,
                'source_step_id', v_step.source_step_id,
                'step_key', p_session_step_id,
                'legacy_step_key', coalesce(v_step.legacy_step_key, p_session_step_id::text),
                'form_key', coalesce(nullif(trim(p_form_key), ''), v_step.legacy_form_key, p_session_step_id::text),
                'response', p_form_response
            ), now()
        )
        on conflict (workspace_id, native_kind, native_key)
        where native_kind is not null and native_key is not null
        do update set
            title = excluded.title,
            description = excluded.description,
            metadata = excluded.metadata,
            updated_at = excluded.updated_at
        returning id into v_submission_asset_id;
        insert into public.asset_relationships (asset_id, relationship_id, workspace_id)
        values (v_submission_asset_id, v_session.relationship_id, p_workspace_id)
        on conflict (asset_id, relationship_id) do nothing;
        insert into public.asset_work_items (asset_id, work_item_id, workspace_id)
        values (v_submission_asset_id, v_work_item.id, p_workspace_id)
        on conflict (asset_id, work_item_id) do nothing;

        for v_upload in
            select value from jsonb_array_elements(coalesce(p_uploads, '[]'::jsonb))
        loop
            v_upload_native_key := p_session_id::text || ':step:' || p_session_step_id::text || ':upload:' || (v_upload->>'path');
            if jsonb_typeof(v_upload) <> 'object'
               or nullif(v_upload->>'path', '') is null
               or nullif(v_upload->>'name', '') is null
               or coalesce(v_upload->>'size', '') !~ '^[0-9]+$' then
                raise exception using errcode = '22023', message = 'An onboarding upload descriptor is invalid or exceeds 500 MB';
            end if;
            if (v_upload->>'size')::bigint <= 0
               or (v_upload->>'size')::bigint > 524288000
               or position(
                    p_workspace_id::text || '/onboarding/' ||
                    v_session.relationship_id::text || '/' ||
                    p_session_id::text || '/'
                    in v_upload->>'path'
                  ) <> 1
               or v_upload_native_key = any(v_active_upload_keys) then
                raise exception using errcode = '22023', message = 'An onboarding upload descriptor is invalid or exceeds 500 MB';
            end if;
            v_active_upload_keys := array_append(v_active_upload_keys, v_upload_native_key);
            insert into public.assets (
                workspace_id, title, description, asset_kind, source_kind,
                storage_path, content_type, file_size, native_kind, native_key,
                metadata, updated_at
            ) values (
                p_workspace_id, left(v_upload->>'name', 500),
                left('Uploaded during ' || v_step.title || ' onboarding.', 1000),
                case when v_upload->>'asset_kind' in ('file', 'media', 'document')
                    then v_upload->>'asset_kind' else 'file' end,
                'onboarding_submission', v_upload->>'path',
                coalesce(nullif(v_upload->>'type', ''), 'application/octet-stream'),
                (v_upload->>'size')::bigint, 'onboarding_upload', v_upload_native_key,
                jsonb_build_object(
                    'session_id', p_session_id,
                    'relationship_id', v_session.relationship_id,
                    'session_step_id', p_session_step_id,
                    'source_step_id', v_step.source_step_id,
                    'step_key', p_session_step_id,
                    'legacy_step_key', coalesce(v_step.legacy_step_key, p_session_step_id::text),
                    'field_name', nullif(v_upload->>'field_name', ''),
                    'provider', case when v_upload->>'provider' = 'supabase' then 'supabase' else 'r2' end
                ), now()
            )
            on conflict (workspace_id, native_kind, native_key)
            where native_kind is not null and native_key is not null
            do update set
                title = excluded.title,
                description = excluded.description,
                storage_path = excluded.storage_path,
                content_type = excluded.content_type,
                file_size = excluded.file_size,
                metadata = excluded.metadata,
                updated_at = excluded.updated_at
            returning id into v_upload_asset_id;
            insert into public.asset_relationships (asset_id, relationship_id, workspace_id)
            values (v_upload_asset_id, v_session.relationship_id, p_workspace_id)
            on conflict (asset_id, relationship_id) do nothing;
            insert into public.asset_work_items (asset_id, work_item_id, workspace_id)
            values (v_upload_asset_id, v_work_item.id, p_workspace_id)
            on conflict (asset_id, work_item_id) do nothing;
        end loop;
        delete from public.asset_work_items link
        using public.assets asset
        where link.workspace_id = p_workspace_id
          and link.work_item_id = v_work_item.id
          and link.asset_id = asset.id
          and asset.workspace_id = p_workspace_id
          and asset.native_kind = 'onboarding_upload'
          and asset.native_key like p_session_id::text || ':step:' || p_session_step_id::text || ':upload:%'
          and not (asset.native_key = any(v_active_upload_keys));
        delete from public.onboarding_step_drafts
        where workspace_id = p_workspace_id and session_id = p_session_id
          and session_step_id = p_session_step_id;
    elsif v_work_item.status <> 'done' and jsonb_array_length(coalesce(p_uploads, '[]'::jsonb)) > 0 then
        raise exception using errcode = '22023', message = 'Uploads require a form response';
    end if;
    if v_work_item.status = 'done' then
        v_completed_at := coalesce(v_work_item.actual_completed_at, v_work_item.updated_at, now());
        v_idempotent := true;
    else
        select max(predecessor.actual_completed_at) into v_predecessor_completed_at
        from public.work_item_dependencies dependency
        join public.work_items predecessor
          on predecessor.workspace_id = dependency.workspace_id
         and predecessor.id = dependency.depends_on_work_item_id
        where dependency.workspace_id = p_workspace_id
          and dependency.work_item_id = v_work_item.id;
        v_completed_at := now();
        update public.work_items
        set status = 'done',
            actual_start_at = coalesce(actual_start_at, v_predecessor_completed_at, v_completed_at),
            actual_start_has_time = true,
            actual_completed_at = v_completed_at,
            actual_completed_has_time = true,
            updated_at = v_completed_at
        where workspace_id = p_workspace_id and id = v_work_item.id;
    end if;

    -- Materialise the next actionable step and one look-ahead step while the
    -- session lock is held. A client retry repairs a previous partial rollout,
    -- and the stable native key prevents duplicate work.
    v_rolling_predecessor_id := v_work_item.id;
    for v_rolling_step in
        select snapshot_step.*
        from public.relationship_onboarding_session_steps snapshot_step
        where snapshot_step.workspace_id = p_workspace_id
          and snapshot_step.session_id = p_session_id
          and snapshot_step.kind <> 'completion'
          and snapshot_step.sort_order > v_step.sort_order
        order by snapshot_step.sort_order, snapshot_step.id
        limit 2
    loop
        v_rolling_work_item_id := null;
        select item.id into v_rolling_work_item_id
        from public.work_items item
        where item.workspace_id = p_workspace_id
          and item.native_kind = 'onboarding_step'
          and (
              item.native_key = p_session_id::text || ':step:' || v_rolling_step.id::text
              or (
                  item.metadata->>'session_id' = p_session_id::text
                  and item.metadata->>'session_step_id' = v_rolling_step.id::text
              )
          )
        order by (item.native_key = p_session_id::text || ':step:' || v_rolling_step.id::text) desc
        limit 1
        for update;
        if v_rolling_work_item_id is null then
            insert into public.work_items (
                workspace_id, title, description, lifecycle_phase, status,
                priority, is_key_task, native_kind, native_key,
                parent_work_item_id, workflow_role, planned_start_date,
                actual_start_at, actual_start_has_time, sort_order,
                metadata, created_by
            ) values (
                p_workspace_id, v_rolling_step.title, v_rolling_step.description,
                'onboarding', 'todo', 3, true, 'onboarding_step',
                p_session_id::text || ':step:' || v_rolling_step.id::text,
                v_work_item.parent_work_item_id, 'task', null,
                case when v_rolling_index = 0 then v_completed_at else null end,
                v_rolling_index = 0, v_rolling_step.sort_order,
                jsonb_strip_nulls(jsonb_build_object(
                    'session_id', p_session_id,
                    'relationship_id', v_session.relationship_id,
                    'session_step_id', v_rolling_step.id,
                    'step_key', v_rolling_step.legacy_step_key,
                    'module_revision_id', v_rolling_step.module_revision_id,
                    'kind', v_rolling_step.kind,
                    'auto_created', true
                )), v_session.created_by
            ) returning id into v_rolling_work_item_id;
        elsif v_rolling_index = 0 then
            update public.work_items
            set actual_start_at = coalesce(actual_start_at, v_completed_at),
                actual_start_has_time = true,
                updated_at = now()
            where workspace_id = p_workspace_id and id = v_rolling_work_item_id;
        end if;
        insert into public.work_item_relationships (
            workspace_id, work_item_id, relationship_id
        ) values (
            p_workspace_id, v_rolling_work_item_id, v_session.relationship_id
        ) on conflict (work_item_id, relationship_id) do nothing;
        insert into public.work_item_dependencies (
            workspace_id, work_item_id, depends_on_work_item_id, source
        ) values (
            p_workspace_id, v_rolling_work_item_id, v_rolling_predecessor_id, 'manual'
        ) on conflict (work_item_id, depends_on_work_item_id) do nothing;
        if v_rolling_index = 0 then
            v_next_work_item_id := v_rolling_work_item_id;
        else
            v_upcoming_work_item_id := v_rolling_work_item_id;
        end if;
        v_rolling_predecessor_id := v_rolling_work_item_id;
        v_rolling_index := v_rolling_index + 1;
    end loop;

    if v_step.session_module_id is not null and not exists (
        select 1
        from public.relationship_onboarding_session_steps module_step
        where module_step.workspace_id = p_workspace_id
          and module_step.session_id = p_session_id
          and module_step.session_module_id = v_step.session_module_id
          and module_step.kind in ('form', 'video')
          and not exists (
              select 1 from public.work_items item
              where item.workspace_id = p_workspace_id
                and item.native_kind = 'onboarding_step'
                and item.status = 'done'
                and (
                    item.native_key = p_session_id::text || ':step:' || module_step.id::text
                    or (
                        item.metadata->>'session_id' = p_session_id::text
                        and item.metadata->>'session_step_id' = module_step.id::text
                    )
                )
          )
    ) then
        update public.onboarding_session_notices
        set module_completed_at = coalesce(module_completed_at, v_completed_at)
        where workspace_id = p_workspace_id and session_id = p_session_id
          and session_module_id = v_step.session_module_id
          and module_completed_at is null;
        get diagnostics v_notice_count = row_count;
    end if;
    select slug into v_workspace_slug from public.workspaces where id = p_workspace_id;
    v_event_id := public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.step.completed',
        'Client completed onboarding step: ' || v_step.title,
        p_entity_type => 'work_item', p_entity_id => v_work_item.id::text,
        p_source_href => format('/%s/onboarding/%s', v_workspace_slug, v_session.relationship_id),
        p_actor_kind => 'client',
        p_correlation_id => coalesce(p_correlation_id, v_session.source_sale_id, v_session.id),
        p_idempotency_key => coalesce(
            nullif(trim(p_idempotency_key), ''),
            format('onboarding.step.completed:%s:%s', p_session_id, p_session_step_id)
        ),
        p_metadata => jsonb_build_object(
            'relationship_id', v_session.relationship_id,
            'session_id', p_session_id,
            'session_step_id', p_session_step_id,
            'step_key', v_step.legacy_step_key,
            'module_notice_completed', v_notice_count > 0
        )
    );
    return jsonb_build_object(
        'work_item_id', v_work_item.id, 'status', 'done',
        'completed_at', v_completed_at,
        'module_notice_completed', v_notice_count > 0,
        'next_work_item_id', v_next_work_item_id,
        'upcoming_work_item_id', v_upcoming_work_item_id,
        'event_id', v_event_id, 'idempotent', v_idempotent
    );
end;
$$;

create or replace function public.complete_relationship_onboarding_session(
    p_workspace_id uuid,
    p_session_id uuid,
    p_session_token text,
    p_correlation_id uuid default null,
    p_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_session public.relationship_onboarding_sessions%rowtype;
    v_relationship public.relationships%rowtype;
    v_workspace_slug text;
    v_completed_at timestamptz;
    v_event_id uuid;
    v_idempotent boolean := false;
    v_onboarding_stage_id uuid;
    v_review_stage_id uuid;
    v_fulfilment_stage_id uuid;
    v_reviewer_id uuid;
    v_review_step record;
    v_review_work_item_id uuid;
    v_previous_review_work_item_id uuid;
    v_review_item_count integer := 0;
    v_workflow_already_finalized boolean := false;
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Client onboarding mutations require trusted server access';
    end if;
    select * into v_session
    from public.relationship_onboarding_sessions
    where workspace_id = p_workspace_id and id = p_session_id
      and session_token = p_session_token and token_revoked_at is null
      and status in ('active', 'completed')
    for update;
    if v_session.id is null then
        raise exception using errcode = 'P0001', message = 'Invalid onboarding session';
    end if;
    select * into v_relationship
    from public.relationships
    where workspace_id = p_workspace_id and id = v_session.relationship_id
    for update;
    if v_relationship.id is null then
        raise exception using errcode = 'P0001', message = 'Onboarding relationship no longer exists';
    end if;

    select item.id into v_review_stage_id
    from public.work_items item
    where item.workspace_id = p_workspace_id
      and item.native_kind = 'relationship_workflow'
      and item.native_key = v_session.relationship_id::text || ':onboarding_review'
    for update;
    if v_session.status = 'completed'
       and v_review_stage_id is not null
       and v_relationship.lifecycle_phase in ('onboarding_review', 'fulfilment', 'retention') then
        v_workflow_already_finalized := true;
    end if;
    if v_session.status = 'completed' then
        v_completed_at := coalesce(v_session.completed_at, v_session.updated_at, now());
        v_idempotent := true;
    else
        if exists (
            select 1
            from public.relationship_onboarding_session_steps snapshot_step
            where snapshot_step.workspace_id = p_workspace_id
              and snapshot_step.session_id = p_session_id
              and snapshot_step.kind <> 'completion'
              and not exists (
                  select 1
                  from public.work_items item
                  where item.workspace_id = p_workspace_id
                    and item.native_kind = 'onboarding_step'
                    and item.status = 'done'
                    and (
                        item.native_key = p_session_id::text || ':step:' || snapshot_step.id::text
                        or (
                            item.metadata->>'session_id' = p_session_id::text
                            and item.metadata->>'session_step_id' = snapshot_step.id::text
                        )
                    )
              )
        ) then
            raise exception using errcode = 'P0001', message = 'Onboarding cannot be completed until every step is submitted';
        end if;
        v_completed_at := now();
        update public.relationship_onboarding_sessions
        set status = 'completed', completed_at = v_completed_at, updated_at = v_completed_at
        where workspace_id = p_workspace_id and id = p_session_id;
    end if;

    if not v_workflow_already_finalized then
        select item.parent_work_item_id into v_onboarding_stage_id
        from public.work_items item
        where item.workspace_id = p_workspace_id
          and item.native_kind = 'onboarding_step'
          and item.metadata->>'session_id' = p_session_id::text
          and item.parent_work_item_id is not null
        order by item.sort_order desc
        limit 1;
        if v_onboarding_stage_id is null then
            select item.id into v_onboarding_stage_id
            from public.work_items item
            where item.workspace_id = p_workspace_id
              and item.native_kind = 'relationship_workflow'
              and item.native_key = v_session.relationship_id::text || ':onboarding'
            for update;
        else
            perform 1 from public.work_items
            where workspace_id = p_workspace_id and id = v_onboarding_stage_id
            for update;
        end if;
        if v_onboarding_stage_id is null then
            raise exception using errcode = 'P0001', message = 'Onboarding lifecycle work is missing';
        end if;
        update public.work_items
        set status = 'done',
            actual_start_at = coalesce(actual_start_at, v_session.created_at, v_completed_at),
            actual_start_has_time = true,
            actual_completed_at = coalesce(actual_completed_at, v_completed_at),
            actual_completed_has_time = true,
            updated_at = now()
        where workspace_id = p_workspace_id and id = v_onboarding_stage_id;

        v_reviewer_id := case
            when v_relationship.fulfilment_manager_user_id is not null and exists (
                select 1 from public.workspace_memberships membership
                where membership.workspace_id = p_workspace_id
                  and membership.user_id = v_relationship.fulfilment_manager_user_id
            ) then v_relationship.fulfilment_manager_user_id
            when v_session.created_by is not null and exists (
                select 1 from public.workspace_memberships membership
                where membership.workspace_id = p_workspace_id
                  and membership.user_id = v_session.created_by
            ) then v_session.created_by
            else null
        end;

        insert into public.work_items (
            workspace_id, title, description, lifecycle_phase, status, priority,
            is_key_task, native_kind, native_key, workflow_role, completion_mode,
            workflow_action, planned_start_date, actual_start_at,
            actual_start_has_time, sort_order, metadata, created_by
        ) values (
            p_workspace_id, 'Review Onboarding Information', null,
            'onboarding_review', 'todo', 3, true, 'relationship_workflow',
            v_session.relationship_id::text || ':onboarding_review',
            'lifecycle_stage', 'all_required_children', 'begin_fulfilment',
            current_date, v_completed_at, true, 0,
            jsonb_build_object(
                'relationship_id', v_session.relationship_id,
                'created_from', 'onboarding_completion',
                'onboarding_review_session_id', p_session_id
            ), v_session.created_by
        )
        on conflict (workspace_id, native_kind, native_key)
        where native_kind is not null and native_key is not null
        do update set
            title = excluded.title,
            lifecycle_phase = excluded.lifecycle_phase,
            workflow_role = excluded.workflow_role,
            completion_mode = excluded.completion_mode,
            workflow_action = excluded.workflow_action,
            parent_work_item_id = null,
            planned_start_date = coalesce(public.work_items.planned_start_date, excluded.planned_start_date),
            actual_start_at = case
                when public.work_items.metadata->>'onboarding_review_session_id' = p_session_id::text
                then coalesce(public.work_items.actual_start_at, excluded.actual_start_at)
                else excluded.actual_start_at
            end,
            actual_start_has_time = true,
            status = case
                when public.work_items.metadata->>'onboarding_review_session_id' = p_session_id::text
                then public.work_items.status
                else 'todo'
            end,
            actual_completed_at = case
                when public.work_items.metadata->>'onboarding_review_session_id' = p_session_id::text
                then public.work_items.actual_completed_at
                else null
            end,
            actual_completed_has_time = case
                when public.work_items.metadata->>'onboarding_review_session_id' = p_session_id::text
                then public.work_items.actual_completed_has_time
                else false
            end,
            metadata = public.work_items.metadata || excluded.metadata,
            updated_at = now()
        returning id into v_review_stage_id;
        insert into public.work_item_relationships (workspace_id, work_item_id, relationship_id)
        values (p_workspace_id, v_review_stage_id, v_session.relationship_id)
        on conflict (work_item_id, relationship_id) do nothing;
        insert into public.work_item_dependencies (
            workspace_id, work_item_id, depends_on_work_item_id, source
        ) values (
            p_workspace_id, v_review_stage_id, v_onboarding_stage_id, 'manual'
        ) on conflict (work_item_id, depends_on_work_item_id) do nothing;
        if v_reviewer_id is not null then
            delete from public.work_item_assignees
            where workspace_id = p_workspace_id and work_item_id = v_review_stage_id;
            insert into public.work_item_assignees (workspace_id, work_item_id, user_id)
            values (p_workspace_id, v_review_stage_id, v_reviewer_id)
            on conflict (work_item_id, user_id) do nothing;
        end if;

        update public.work_items
        set workflow_required = false,
            status = case when status = 'done' then status else 'canceled' end,
            updated_at = now()
        where workspace_id = p_workspace_id
          and parent_work_item_id = v_review_stage_id
          and workflow_role = 'review'
          and coalesce(native_key, '') not like
              v_session.relationship_id::text || ':onboarding-review:' || p_session_id::text || ':%';

        v_previous_review_work_item_id := null;
        for v_review_step in
            select
                snapshot_step.id as session_step_id,
                snapshot_step.title,
                snapshot_step.sort_order,
                submitted.id as submitted_work_item_id
            from public.relationship_onboarding_session_steps snapshot_step
            join lateral (
                select item.id
                from public.work_items item
                where item.workspace_id = p_workspace_id
                  and item.native_kind = 'onboarding_step'
                  and item.status = 'done'
                  and (
                      item.native_key = p_session_id::text || ':step:' || snapshot_step.id::text
                      or (
                          item.metadata->>'session_id' = p_session_id::text
                          and item.metadata->>'session_step_id' = snapshot_step.id::text
                      )
                  )
                order by (item.native_key = p_session_id::text || ':step:' || snapshot_step.id::text) desc
                limit 1
            ) submitted on true
            where snapshot_step.workspace_id = p_workspace_id
              and snapshot_step.session_id = p_session_id
              and snapshot_step.kind <> 'completion'
            order by snapshot_step.sort_order, snapshot_step.id
        loop
            insert into public.work_items (
                workspace_id, title, description, lifecycle_phase, status,
                priority, is_key_task, native_kind, native_key,
                parent_work_item_id, workflow_role, workflow_required,
                planned_start_date, sort_order, metadata, created_by
            ) values (
                p_workspace_id, 'Review ' || v_review_step.title,
                'Review the submitted onboarding information before fulfilment begins.',
                'onboarding_review', 'todo', 3, true, 'relationship_workflow',
                v_session.relationship_id::text || ':onboarding-review:' ||
                    p_session_id::text || ':' || v_review_step.submitted_work_item_id::text,
                v_review_stage_id, 'review', true, current_date,
                v_review_item_count * 10,
                jsonb_build_object(
                    'relationship_id', v_session.relationship_id,
                    'session_id', p_session_id,
                    'session_step_id', v_review_step.session_step_id,
                    'submitted_work_item_id', v_review_step.submitted_work_item_id,
                    'created_from', 'onboarding_completion'
                ), v_session.created_by
            )
            on conflict (workspace_id, native_kind, native_key)
            where native_kind is not null and native_key is not null
            do update set
                title = excluded.title,
                description = excluded.description,
                lifecycle_phase = excluded.lifecycle_phase,
                parent_work_item_id = excluded.parent_work_item_id,
                workflow_role = excluded.workflow_role,
                workflow_required = true,
                planned_start_date = coalesce(public.work_items.planned_start_date, excluded.planned_start_date),
                sort_order = excluded.sort_order,
                metadata = public.work_items.metadata || excluded.metadata,
                status = case when public.work_items.status = 'canceled' then 'todo' else public.work_items.status end,
                updated_at = now()
            returning id into v_review_work_item_id;
            insert into public.work_item_relationships (workspace_id, work_item_id, relationship_id)
            values (p_workspace_id, v_review_work_item_id, v_session.relationship_id)
            on conflict (work_item_id, relationship_id) do nothing;
            if v_previous_review_work_item_id is not null then
                insert into public.work_item_dependencies (
                    workspace_id, work_item_id, depends_on_work_item_id, source
                ) values (
                    p_workspace_id, v_review_work_item_id,
                    v_previous_review_work_item_id, 'manual'
                ) on conflict (work_item_id, depends_on_work_item_id) do nothing;
            end if;
            if v_reviewer_id is not null then
                delete from public.work_item_assignees
                where workspace_id = p_workspace_id and work_item_id = v_review_work_item_id;
                insert into public.work_item_assignees (workspace_id, work_item_id, user_id)
                values (p_workspace_id, v_review_work_item_id, v_reviewer_id)
                on conflict (work_item_id, user_id) do nothing;
            end if;
            v_previous_review_work_item_id := v_review_work_item_id;
            v_review_item_count := v_review_item_count + 1;
        end loop;

        insert into public.work_items (
            workspace_id, title, description, lifecycle_phase, status, priority,
            is_key_task, native_kind, native_key, workflow_role, completion_mode,
            workflow_action, sort_order, metadata, created_by
        ) values (
            p_workspace_id, 'Fulfil Client', null, 'fulfilment', 'todo', 3,
            true, 'relationship_workflow',
            v_session.relationship_id::text || ':fulfilment',
            'lifecycle_stage', 'all_required_children', 'begin_retention', 0,
            jsonb_build_object(
                'relationship_id', v_session.relationship_id,
                'created_from', 'relationship_workflow'
            ), v_session.created_by
        )
        on conflict (workspace_id, native_kind, native_key)
        where native_kind is not null and native_key is not null
        do update set
            title = excluded.title,
            lifecycle_phase = excluded.lifecycle_phase,
            workflow_role = excluded.workflow_role,
            completion_mode = excluded.completion_mode,
            workflow_action = excluded.workflow_action,
            metadata = public.work_items.metadata || excluded.metadata,
            updated_at = now()
        returning id into v_fulfilment_stage_id;
        insert into public.work_item_relationships (workspace_id, work_item_id, relationship_id)
        values (p_workspace_id, v_fulfilment_stage_id, v_session.relationship_id)
        on conflict (work_item_id, relationship_id) do nothing;
        insert into public.work_item_dependencies (
            workspace_id, work_item_id, depends_on_work_item_id, source
        ) values (
            p_workspace_id, v_fulfilment_stage_id, v_review_stage_id, 'manual'
        ) on conflict (work_item_id, depends_on_work_item_id) do nothing;

        update public.relationships
        set lifecycle_phase = case
                when lifecycle_phase in ('fulfilment', 'retention') then lifecycle_phase
                else 'onboarding_review'
            end,
            updated_at = now()
        where workspace_id = p_workspace_id and id = v_session.relationship_id;
    else
        select count(*) into v_review_item_count
        from public.work_items item
        where item.workspace_id = p_workspace_id
          and item.parent_work_item_id = v_review_stage_id
          and item.workflow_role = 'review'
          and item.native_key like
              v_session.relationship_id::text || ':onboarding-review:' || p_session_id::text || ':%';
    end if;
    select slug into v_workspace_slug from public.workspaces where id = p_workspace_id;
    v_event_id := public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.session.completed',
        'Client completed onboarding',
        p_entity_type => 'onboarding_session', p_entity_id => v_session.id::text,
        p_source_href => format('/%s/onboarding/%s', v_workspace_slug, v_session.relationship_id),
        p_actor_kind => 'client',
        p_correlation_id => coalesce(p_correlation_id, v_session.source_sale_id, v_session.id),
        p_idempotency_key => coalesce(
            nullif(trim(p_idempotency_key), ''),
            format('onboarding.session.completed:%s', p_session_id)
        ),
        p_metadata => jsonb_build_object(
            'relationship_id', v_session.relationship_id,
            'session_id', p_session_id,
            'onboarding_work_item_id', v_onboarding_stage_id,
            'review_work_item_id', v_review_stage_id,
            'review_item_count', v_review_item_count,
            'workflow_finalized', true
        )
    );
    return jsonb_build_object(
        'session_id', v_session.id, 'status', 'completed',
        'completed_at', v_completed_at,
        'onboarding_work_item_id', v_onboarding_stage_id,
        'review_work_item_id', v_review_stage_id,
        'review_item_count', v_review_item_count,
        'workflow_finalized', true,
        'event_id', v_event_id, 'idempotent', v_idempotent
    );
end;
$$;

-- Help publication is independent from the pending mandatory-module draft.
-- Clone the latest published assignment set so immutable published revisions
-- remain append-only and a help save cannot accidentally publish module edits.
create or replace function public.save_published_onboarding_help(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_help_text text,
    p_whatsapp_enabled boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_previous public.onboarding_configuration_revisions%rowtype;
    v_revision_id uuid;
    v_revision_number integer;
    v_definition jsonb;
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Published onboarding help may only be changed by trusted server actions';
    end if;
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    select * into v_previous
    from public.onboarding_configuration_revisions
    where workspace_id = p_workspace_id
      and configuration_type = 'mandatory_modules' and status = 'published'
    order by revision_number desc
    limit 1
    for update;
    if v_previous.id is null then
        raise exception using errcode = 'P0001', message = 'Publish mandatory onboarding settings before saving client help';
    end if;
    select coalesce(max(revision_number), 0) + 1 into v_revision_number
    from public.onboarding_configuration_revisions
    where workspace_id = p_workspace_id
      and configuration_type = 'mandatory_modules' and status = 'published';
    v_definition := v_previous.definition || jsonb_build_object(
        'help_text', left(coalesce(p_help_text, ''), 2000),
        'whatsapp_enabled', coalesce(p_whatsapp_enabled, false)
    );
    insert into public.onboarding_configuration_revisions (
        workspace_id, configuration_type, whatsapp_enabled,
        revision_number, status, definition, definition_hash,
        created_by, updated_by, published_by, published_at
    ) values (
        p_workspace_id, 'mandatory_modules', coalesce(p_whatsapp_enabled, false),
        v_revision_number, 'published', v_definition,
        encode(extensions.digest(convert_to(v_definition::text, 'UTF8'), 'sha256'), 'hex'),
        p_actor_user_id, p_actor_user_id, p_actor_user_id, now()
    ) returning id into v_revision_id;
    insert into public.onboarding_configuration_revision_modules (
        workspace_id, configuration_revision_id, module_id, sort_order
    )
    select p_workspace_id, v_revision_id, module_id, sort_order
    from public.onboarding_configuration_revision_modules
    where workspace_id = p_workspace_id
      and configuration_revision_id = v_previous.id
    order by sort_order;
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.help.published',
        'Client onboarding help settings published',
        p_entity_type => 'onboarding_configuration', p_entity_id => v_revision_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_idempotency_key => format('onboarding.help.published:%s:%s', p_workspace_id, v_revision_number),
        p_metadata => jsonb_build_object(
            'previous_revision_id', v_previous.id,
            'previous_revision_number', v_previous.revision_number,
            'revision_id', v_revision_id,
            'revision_number', v_revision_number,
            'whatsapp_enabled', coalesce(p_whatsapp_enabled, false),
            'module_count', (
                select count(*) from public.onboarding_configuration_revision_modules
                where configuration_revision_id = v_revision_id
            )
        )
    );
    return jsonb_build_object(
        'configuration_revision_id', v_revision_id,
        'revision_number', v_revision_number
    );
end;
$$;

revoke all on function public.revoke_relationship_onboarding_session_token(uuid, uuid, uuid, uuid, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.rotate_relationship_onboarding_session_token(uuid, uuid, uuid, uuid, integer, text, uuid, text) from public, anon, authenticated;
revoke all on function public.record_onboarding_edit_request(uuid, uuid, uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_onboarding_session_step(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.complete_relationship_onboarding_session(uuid, uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.save_published_onboarding_help(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.revoke_relationship_onboarding_session_token(uuid, uuid, uuid, uuid, integer, uuid, text) to service_role;
grant execute on function public.rotate_relationship_onboarding_session_token(uuid, uuid, uuid, uuid, integer, text, uuid, text) to service_role;
grant execute on function public.record_onboarding_edit_request(uuid, uuid, uuid, text, uuid, text) to service_role;
grant execute on function public.complete_onboarding_session_step(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, text, text, jsonb) to service_role;
grant execute on function public.complete_relationship_onboarding_session(uuid, uuid, text, uuid, text) to service_role;
grant execute on function public.save_published_onboarding_help(uuid, uuid, text, boolean) to service_role;

create or replace function public.reopen_voided_client_sale(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_relationship_id uuid,
    p_sale_id uuid,
    p_correlation_id uuid,
    p_provider_summary jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_sale public.client_sales%rowtype;
    v_relationship public.relationships%rowtype;
    v_sell_work_id uuid;
    v_payment_work_id uuid;
    v_correlation_id uuid := coalesce(p_correlation_id, gen_random_uuid());
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Voided invoices may only be reopened by trusted server actions';
    end if;
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    select * into v_relationship from public.relationships
    where workspace_id = p_workspace_id and id = p_relationship_id
    for update;
    if v_relationship.id is null then
        raise exception using errcode = 'P0001', message = 'Relationship not found';
    end if;
    select * into v_sale from public.client_sales
    where workspace_id = p_workspace_id and id = p_sale_id
      and relationship_id = p_relationship_id and deleted_at is null
    for update;
    if v_sale.id is null then
        raise exception using errcode = 'P0001', message = 'Invoice sale not found';
    end if;
    if v_sale.onboarding_session_id is not null or exists (
        select 1 from public.relationship_onboarding_sessions session
        where session.workspace_id = p_workspace_id and session.source_sale_id = p_sale_id
    ) or v_sale.status in (
        'paid', 'test_paid', 'paid_consent_template_sending',
        'paid_awaiting_whatsapp_confirm', 'paid_consent_template_failed',
        'whatsapp_confirmed', 'onboarding_created', 'onboarding_link_sent',
        'onboarding_link_failed'
    ) then
        raise exception using errcode = 'P0001', message = 'A paid or onboarding invoice cannot be voided or replaced';
    end if;
    if v_sale.stripe_invoice_id is null
       or not (
           v_sale.status in ('invoice_sent', 'payment_failed')
           or (
               v_sale.status = 'invoice_inactive'
               and lower(coalesce(v_sale.stripe_invoice_status, '')) in ('void', 'voided')
           )
       ) then
        raise exception using errcode = 'P0001', message = 'Only the current sent, unpaid, Stripe-voided invoice can be replaced';
    end if;

    update public.client_sales
    set status = 'invoice_inactive', stripe_invoice_status = 'void', updated_at = now()
    where workspace_id = p_workspace_id and id = p_sale_id;
    update public.relationships
    set lifecycle_phase = 'potential_client', updated_at = now()
    where workspace_id = p_workspace_id and id = p_relationship_id;

    update public.work_items
    set status = 'doing',
        actual_start_at = coalesce(actual_start_at, now()),
        actual_start_has_time = true,
        actual_completed_at = null,
        actual_completed_has_time = false,
        updated_at = now()
    where workspace_id = p_workspace_id
      and native_kind = 'relationship_workflow'
      and native_key = p_relationship_id::text || ':potential_client'
    returning id into v_sell_work_id;
    update public.work_items
    set status = 'todo', actual_start_at = null, actual_start_has_time = false,
        actual_completed_at = null, actual_completed_has_time = false,
        updated_at = now()
    where workspace_id = p_workspace_id
      and native_kind = 'relationship_workflow'
      and native_key = p_relationship_id::text || ':invoiced'
    returning id into v_payment_work_id;

    perform public.record_workspace_admin_activity(
        p_workspace_id, 'billing', 'stripe.invoice.voided_by_staff',
        'Stripe invoice voided by staff',
        p_entity_type => 'stripe_invoice', p_entity_id => v_sale.stripe_invoice_id,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_correlation_id => v_correlation_id,
        p_idempotency_key => 'stripe.invoice.voided_by_staff:' || p_sale_id::text,
        p_outcome => 'succeeded', p_metric_classification => 'internal_call',
        p_metadata => jsonb_build_object(
            'sale_id', p_sale_id, 'relationship_id', p_relationship_id,
            'previous_sale_status', v_sale.status,
            'provider_summary', public.sanitize_admin_activity_json(coalesce(p_provider_summary, '{}'::jsonb))
        )
    );
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'billing', 'stripe.invoice.replacement_opened',
        'Relationship reopened to prepare a replacement invoice',
        p_entity_type => 'client_sale', p_entity_id => p_sale_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_correlation_id => v_correlation_id,
        p_idempotency_key => 'stripe.invoice.replacement_opened:' || p_sale_id::text,
        p_metadata => jsonb_build_object(
            'relationship_id', p_relationship_id,
            'sell_work_item_id', v_sell_work_id,
            'payment_work_item_id', v_payment_work_id,
            'frozen_snapshot_preserved', true
        )
    );
    return jsonb_build_object(
        'sale_id', p_sale_id, 'relationship_id', p_relationship_id,
        'reopened_work_item_id', v_sell_work_id
    );
end;
$$;

create or replace function public.save_relationship_commercial_configuration(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_relationship_id uuid,
    p_details jsonb,
    p_services jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_relationship public.relationships%rowtype;
    v_service jsonb;
    v_service_identity public.onboarding_services%rowtype;
    v_service_revision public.onboarding_service_revisions%rowtype;
    v_existing_services jsonb;
    v_requested_services jsonb;
    v_commercial_changed boolean;
    v_locked_sale_id uuid;
    v_service_count integer := 0;
    v_changed_fields text[] := '{}'::text[];
    v_seller_id uuid;
    v_manager_id uuid;
    v_timeframe integer;
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Relationship commercial details may only be changed by trusted server actions';
    end if;
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    if jsonb_typeof(coalesce(p_details, '{}'::jsonb)) <> 'object'
       or jsonb_typeof(coalesce(p_services, '[]'::jsonb)) <> 'array' then
        raise exception using errcode = '22023', message = 'Commercial details must contain an object and a service array';
    end if;
    select * into v_relationship from public.relationships
    where workspace_id = p_workspace_id and id = p_relationship_id
    for update;
    if v_relationship.id is null then
        raise exception using errcode = 'P0001', message = 'Relationship not found';
    end if;
    if exists (
        select 1 from jsonb_array_elements(coalesce(p_services, '[]'::jsonb)) entry
        group by entry->>'service_key'
        having count(*) > 1 or nullif(entry->>'service_key', '') is null
    ) then
        raise exception using errcode = '22023', message = 'Relationship services must have unique service keys';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
        'service_key', selected.service_key,
        'service_id', selected.service_id,
        'service_revision_id', selected.service_revision_id,
        'price_cents', selected.price_cents,
        'currency', upper(selected.currency),
        'assignee_user_id', selected.assignee_user_id
    ) order by selected.service_key), '[]'::jsonb)
    into v_existing_services
    from public.relationship_services selected
    where selected.workspace_id = p_workspace_id
      and selected.relationship_id = p_relationship_id;
    select coalesce(jsonb_agg(jsonb_build_object(
        'service_key', entry->>'service_key',
        'service_id', nullif(entry->>'service_id', '')::uuid,
        'service_revision_id', nullif(entry->>'service_revision_id', '')::uuid,
        'price_cents', coalesce((entry->>'price_cents')::integer, 0),
        'currency', upper(coalesce(nullif(entry->>'currency', ''), 'USD')),
        'assignee_user_id', nullif(entry->>'assignee_user_id', '')::uuid
    ) order by entry->>'service_key'), '[]'::jsonb)
    into v_requested_services
    from jsonb_array_elements(coalesce(p_services, '[]'::jsonb)) entry;
    v_commercial_changed := v_existing_services is distinct from v_requested_services;

    select sale.id into v_locked_sale_id
    from public.client_sales sale
    where sale.workspace_id = p_workspace_id
      and sale.relationship_id = p_relationship_id
      and sale.deleted_at is null
      and sale.snapshot_frozen_at is not null
      and sale.status not in ('draft', 'invoice_inactive')
    order by sale.created_at desc limit 1
    for update;
    if v_locked_sale_id is not null and v_commercial_changed then
        raise exception using errcode = 'P0001', message = 'Void and replace the sent invoice before changing services or negotiated prices';
    end if;

    v_seller_id := nullif(p_details->>'seller_user_id', '')::uuid;
    v_manager_id := nullif(p_details->>'fulfilment_manager_user_id', '')::uuid;
    v_timeframe := case
        when coalesce(p_details->>'project_timeframe_days', '') ~ '^[0-9]+$'
        then greatest(1, least((p_details->>'project_timeframe_days')::integer, 36500))
        else null
    end;
    if v_seller_id is not null and not exists (
        select 1 from public.workspace_memberships
        where workspace_id = p_workspace_id and user_id = v_seller_id
    ) then raise exception using errcode = '22023', message = 'Seller must belong to this workspace'; end if;
    if v_manager_id is not null and not exists (
        select 1 from public.workspace_memberships
        where workspace_id = p_workspace_id and user_id = v_manager_id
    ) then raise exception using errcode = '22023', message = 'Fulfilment manager must belong to this workspace'; end if;

    if v_relationship.seller_user_id is distinct from v_seller_id then v_changed_fields := array_append(v_changed_fields, 'seller_user_id'); end if;
    if v_relationship.fulfilment_manager_user_id is distinct from v_manager_id then v_changed_fields := array_append(v_changed_fields, 'fulfilment_manager_user_id'); end if;
    if v_relationship.whatsapp_phone is distinct from nullif(trim(p_details->>'whatsapp_phone'), '') then v_changed_fields := array_append(v_changed_fields, 'whatsapp_phone'); end if;
    if v_relationship.project_timeframe_days is distinct from v_timeframe then v_changed_fields := array_append(v_changed_fields, 'project_timeframe_days'); end if;
    if v_commercial_changed then v_changed_fields := array_append(v_changed_fields, 'services'); end if;

    for v_service in select value from jsonb_array_elements(coalesce(p_services, '[]'::jsonb)) loop
        if coalesce(v_service->>'price_cents', '') !~ '^[0-9]+$'
           or upper(coalesce(v_service->>'currency', '')) !~ '^[A-Z]{3}$'
           or nullif(v_service->>'service_id', '') is null
           or nullif(v_service->>'service_revision_id', '') is null then
            raise exception using errcode = '22023', message = 'Every relationship service needs a version, non-negative price, and three-letter currency';
        end if;
        select * into v_service_identity from public.onboarding_services
        where workspace_id = p_workspace_id
          and id = (v_service->>'service_id')::uuid
          and internal_code = v_service->>'service_key';
        select * into v_service_revision from public.onboarding_service_revisions
        where workspace_id = p_workspace_id
          and id = (v_service->>'service_revision_id')::uuid
          and service_id = v_service_identity.id;
        if v_service_identity.id is null or v_service_revision.id is null then
            raise exception using errcode = '22023', message = 'A selected service revision does not belong to this workspace';
        end if;
        if v_service_identity.state <> 'active' and not exists (
            select 1 from public.relationship_services existing
            where existing.workspace_id = p_workspace_id
              and existing.relationship_id = p_relationship_id
              and existing.service_id = v_service_identity.id
              and existing.service_revision_id = v_service_revision.id
        ) then
            raise exception using errcode = '22023', message = 'Only Active services can be newly assigned';
        end if;
        if nullif(v_service->>'assignee_user_id', '') is not null and not exists (
            select 1 from public.workspace_memberships
            where workspace_id = p_workspace_id
              and user_id = (v_service->>'assignee_user_id')::uuid
        ) then raise exception using errcode = '22023', message = 'Service assignee must belong to this workspace'; end if;
    end loop;

    update public.relationships
    set seller_user_id = v_seller_id,
        fulfilment_manager_user_id = v_manager_id,
        whatsapp_phone = nullif(trim(p_details->>'whatsapp_phone'), ''),
        project_timeframe_days = v_timeframe,
        updated_at = now()
    where workspace_id = p_workspace_id and id = p_relationship_id;
    if v_commercial_changed then
        delete from public.relationship_services
        where workspace_id = p_workspace_id and relationship_id = p_relationship_id;
        for v_service in select value from jsonb_array_elements(coalesce(p_services, '[]'::jsonb)) loop
            insert into public.relationship_services (
                workspace_id, relationship_id, service_key, price_cents, currency,
                assignee_user_id, service_id, service_revision_id
            ) values (
                p_workspace_id, p_relationship_id, v_service->>'service_key',
                (v_service->>'price_cents')::integer, upper(v_service->>'currency'),
                nullif(v_service->>'assignee_user_id', '')::uuid,
                (v_service->>'service_id')::uuid,
                (v_service->>'service_revision_id')::uuid
            );
            v_service_count := v_service_count + 1;
        end loop;
    else
        v_service_count := jsonb_array_length(v_existing_services);
    end if;
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'services', 'services.relationship_assignments.changed',
        'Relationship commercial configuration saved',
        p_entity_type => 'relationship', p_entity_id => p_relationship_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_correlation_id => gen_random_uuid(),
        p_idempotency_key => format(
            'services.relationship_assignments:%s:%s:%s',
            p_relationship_id, extract(epoch from clock_timestamp())::bigint, p_actor_user_id
        ),
        p_metadata => jsonb_build_object(
            'relationship_id', p_relationship_id,
            'service_count', v_service_count,
            'commercial_changed', v_commercial_changed,
            'changed_fields', to_jsonb(v_changed_fields),
            'locked_sale_id', v_locked_sale_id
        )
    );
    return jsonb_build_object(
        'relationship_id', p_relationship_id,
        'service_count', v_service_count,
        'commercial_changed', v_commercial_changed,
        'changed_fields', to_jsonb(v_changed_fields)
    );
end;
$$;

revoke all on function public.reopen_voided_client_sale(uuid, uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.save_relationship_commercial_configuration(uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.reopen_voided_client_sale(uuid, uuid, uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.save_relationship_commercial_configuration(uuid, uuid, uuid, jsonb, jsonb) to service_role;

create or replace function public.archive_relationship_onboarding_session(
    p_workspace_id uuid,
    p_relationship_id uuid,
    p_session_id uuid,
    p_actor_user_id uuid,
    p_correlation_id uuid default null,
    p_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_session public.relationship_onboarding_sessions%rowtype;
    v_workspace_slug text;
    v_canceled_count integer := 0;
    v_event_id uuid;
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Onboarding sessions may only be archived by trusted server actions';
    end if;
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    if not exists (
        select 1 from public.relationships
        where workspace_id = p_workspace_id and id = p_relationship_id
    ) then raise exception using errcode = 'P0001', message = 'Relationship not found'; end if;
    select * into v_session from public.relationship_onboarding_sessions
    where workspace_id = p_workspace_id and relationship_id = p_relationship_id
      and id = p_session_id
    for update;
    if v_session.id is null then
        raise exception using errcode = 'P0001', message = 'Onboarding session not found';
    end if;
    if v_session.status = 'archived' then
        return jsonb_build_object(
            'session_id', v_session.id, 'archived', true,
            'canceled_work_item_count', 0, 'idempotent', true
        );
    end if;
    update public.relationship_onboarding_sessions
    set status = 'archived', archived_at = now(), updated_at = now()
    where workspace_id = p_workspace_id and id = v_session.id;
    update public.work_items item
    set status = 'canceled', updated_at = now()
    where item.workspace_id = p_workspace_id
      and item.native_kind = 'onboarding_step'
      and item.status <> 'done'
      and (
          item.metadata->>'session_id' = v_session.id::text
          or item.native_key like v_session.id::text || ':%'
      );
    get diagnostics v_canceled_count = row_count;
    select slug into v_workspace_slug from public.workspaces where id = p_workspace_id;
    v_event_id := public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.session.archived',
        'Onboarding session archived',
        p_entity_type => 'onboarding_session', p_entity_id => v_session.id::text,
        p_source_href => format('/%s/onboarding/%s', v_workspace_slug, p_relationship_id),
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_correlation_id => coalesce(p_correlation_id, v_session.source_sale_id, v_session.id),
        p_idempotency_key => coalesce(
            nullif(trim(p_idempotency_key), ''),
            'onboarding.session.archived:' || v_session.id::text
        ),
        p_metadata => jsonb_build_object(
            'relationship_id', p_relationship_id,
            'previous_status', v_session.status,
            'canceled_work_item_count', v_canceled_count
        )
    );
    return jsonb_build_object(
        'session_id', v_session.id, 'archived', true,
        'canceled_work_item_count', v_canceled_count,
        'event_id', v_event_id, 'idempotent', false
    );
end;
$$;

revoke all on function public.archive_relationship_onboarding_session(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.archive_relationship_onboarding_session(uuid, uuid, uuid, uuid, uuid, text) to service_role;

create or replace function public.record_stripe_invoice_status_event(
    p_workspace_id uuid,
    p_invoice_id text,
    p_stripe_event_id text,
    p_event_type text,
    p_sale_status text,
    p_invoice_status text default null,
    p_raw_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_sale_id uuid;
    v_relationship_id uuid;
    v_event_id uuid;
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Stripe invoice status events require trusted automation';
    end if;
    if p_event_type not in ('invoice.payment_failed', 'invoice.voided', 'invoice.marked_uncollectible')
       or p_sale_status not in ('payment_failed', 'invoice_inactive')
       or nullif(trim(p_invoice_id), '') is null
       or nullif(trim(p_stripe_event_id), '') is null then
        raise exception using errcode = '22023', message = 'Stripe invoice status event is invalid';
    end if;
    update public.client_sales
    set status = p_sale_status,
        stripe_invoice_status = nullif(trim(p_invoice_status), ''),
        raw_payload = coalesce(p_raw_payload, '{}'::jsonb),
        updated_at = now()
    where workspace_id = p_workspace_id
      and stripe_invoice_id = trim(p_invoice_id)
    returning id, relationship_id into v_sale_id, v_relationship_id;
    if v_sale_id is null then
        return jsonb_build_object('updated', false);
    end if;
    v_event_id := public.record_workspace_admin_activity(
        p_workspace_id, 'billing',
        'stripe.invoice.' || split_part(p_event_type, '.', 2),
        'Invoice status updated: ' || replace(p_sale_status, '_', ' '),
        p_level => case when p_event_type = 'invoice.payment_failed' then 'warning' else 'info' end,
        p_entity_type => 'stripe_invoice', p_entity_id => trim(p_invoice_id),
        p_actor_kind => 'automation',
        p_correlation_id => coalesce(
            (select correlation_id from public.client_sales where workspace_id = p_workspace_id and id = v_sale_id),
            gen_random_uuid()
        ),
        p_idempotency_key => 'stripe.invoice.status:' || trim(p_stripe_event_id),
        p_metadata => jsonb_build_object(
            'stripe_event_id', trim(p_stripe_event_id),
            'event_type', p_event_type,
            'sale_id', v_sale_id,
            'relationship_id', v_relationship_id,
            'sale_status', p_sale_status
        )
    );
    return jsonb_build_object(
        'updated', true,
        'sale_id', v_sale_id,
        'relationship_id', v_relationship_id,
        'event_id', v_event_id
    );
end;
$$;

revoke all on function public.record_stripe_invoice_status_event(uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_stripe_invoice_status_event(uuid, text, text, text, text, text, jsonb) to service_role;
