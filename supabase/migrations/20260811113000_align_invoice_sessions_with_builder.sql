-- Invoice and paid-session composition must use the same published module
-- definitions as the visual Builder. Welcome and Completion are ordinary
-- modules now; their legacy configuration revisions remain immutable history.

alter table public.relationship_onboarding_session_blocks
    drop constraint if exists relationship_onboarding_session_blocks_kind_check;
alter table public.relationship_onboarding_session_blocks
    add constraint relationship_onboarding_session_blocks_kind_check
    check (kind in ('header', 'estimate', 'form', 'video', 'button', 'checklist'));

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
    v_configuration_id uuid;
    v_currency text;
    v_currency_max text;
    v_service_count integer;
    v_item_count integer;
    v_module_count integer;
    v_composition jsonb;
    v_hash text;
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

    select revision.id into v_configuration_id
    from public.onboarding_configuration_revisions revision
    where revision.workspace_id = p_workspace_id
      and revision.configuration_type = 'mandatory_modules'
      and revision.status = 'published'
    order by revision.revision_number desc limit 1;

    select count(*)::integer, min(upper(rs.currency)), max(upper(rs.currency))
    into v_service_count, v_currency, v_currency_max
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
    if v_currency is distinct from v_currency_max then
        raise exception 'INVOICE_CURRENCY_MISMATCH: All selected services must use one currency';
    end if;

    delete from public.client_sale_composition_items where client_sale_id = p_sale_id;
    delete from public.client_sale_items where client_sale_id = p_sale_id;

    insert into public.client_sale_items (
        workspace_id, client_sale_id, service_id, service_revision_id,
        service_code, service_name, description, amount_cents, currency,
        default_assignee_user_id, display_priority, sort_order,
        fulfilment_definition_revision_id
    )
    select p_workspace_id, p_sale_id, rs.service_id, rs.service_revision_id,
           service.internal_code, revision.name, revision.description,
           rs.price_cents, upper(rs.currency),
           coalesce(rs.assignee_user_id, revision.default_assignee_user_id),
           revision.display_priority,
           (row_number() over (order by revision.display_priority desc, service.internal_code, service.id) - 1)::integer,
           revision.fulfilment_definition_revision_id
    from public.relationship_services rs
    join public.onboarding_services service
      on service.workspace_id = rs.workspace_id and service.id = rs.service_id
    join public.onboarding_service_revisions revision
      on revision.workspace_id = rs.workspace_id and revision.id = rs.service_revision_id
    where rs.workspace_id = p_workspace_id
      and rs.relationship_id = p_relationship_id
      and rs.service_key in (select jsonb_array_elements_text(v_sale.service_keys))
    order by revision.display_priority desc, service.internal_code, service.id;

    with latest_published as (
        select distinct on (module.id)
               module.id as module_id,
               module.internal_code,
               revision.id as module_revision_id,
               revision.revision_number,
               revision.definition,
               case
                   when revision.definition ? 'mandatory'
                       then coalesce((revision.definition->>'mandatory')::boolean, false)
                   else exists (
                       select 1
                       from public.onboarding_configuration_revision_modules assignment
                       where assignment.workspace_id = p_workspace_id
                         and assignment.configuration_revision_id = v_configuration_id
                         and assignment.module_id = module.id
                   )
               end or module.internal_code in ('system-welcome', 'system-completion') as mandatory,
               case
                   when module.internal_code = 'system-welcome' then -1
                   when module.internal_code = 'system-completion' then 3
                   when revision.definition->>'placement' = 'start' then 0
                   when revision.definition->>'placement' = 'end' then 2
                   else 1
               end as legacy_rank
        from public.onboarding_modules module
        join public.onboarding_module_revisions revision
          on revision.workspace_id = module.workspace_id
         and revision.module_id = module.id
         and revision.status = 'published'
        where module.workspace_id = p_workspace_id and module.status = 'active'
        order by module.id, revision.revision_number desc
    ), ordered_candidates as (
        select published.*,
               source_item.id as source_service_item_id,
               source_item.service_revision_id as source_service_revision_id,
               exists (
                   select 1 from latest_published any_module
                   where jsonb_typeof(any_module.definition->'sortOrder') = 'number'
               ) as has_persisted_order
        from latest_published published
        left join lateral (
            select item.id, item.service_revision_id
            from public.client_sale_items item
            where item.workspace_id = p_workspace_id
              and item.client_sale_id = p_sale_id
              and (
                  case when published.definition ? 'serviceIds'
                      then coalesce(published.definition->'serviceIds', '[]'::jsonb) @> jsonb_build_array(item.service_id::text)
                      else exists (
                          select 1 from public.onboarding_service_revision_modules assignment
                          where assignment.workspace_id = p_workspace_id
                            and assignment.service_revision_id = item.service_revision_id
                            and assignment.module_id = published.module_id
                      )
                  end
              )
            order by item.display_priority desc, item.sort_order, item.service_code
            limit 1
        ) source_item on true
        where published.mandatory or source_item.id is not null
    ), ranked as (
        select candidate.*,
               (row_number() over (
                   order by
                       case when candidate.has_persisted_order
                           then coalesce(
                               case when jsonb_typeof(candidate.definition->'sortOrder') = 'number'
                                   then (candidate.definition->>'sortOrder')::integer end,
                               candidate.legacy_rank * 10000
                           )
                           else candidate.legacy_rank
                       end,
                       coalesce(candidate.definition->>'name', candidate.internal_code),
                       candidate.module_id
               ) - 1)::integer * 10 as frozen_sort_order
        from ordered_candidates candidate
    )
    insert into public.client_sale_composition_items (
        workspace_id, client_sale_id, item_kind, source_kind, module_id,
        module_revision_id, configuration_revision_id,
        source_service_item_id, source_service_revision_id,
        sort_order, definition, source_references
    )
    select p_workspace_id, p_sale_id, 'module',
           case when ranked.mandatory then 'mandatory' else 'service' end,
           ranked.module_id, ranked.module_revision_id,
           case when ranked.mandatory then v_configuration_id else null end,
           case when ranked.mandatory then null else ranked.source_service_item_id end,
           case when ranked.mandatory then null else ranked.source_service_revision_id end,
           ranked.frozen_sort_order, ranked.definition,
           jsonb_strip_nulls(jsonb_build_object(
               'module_code', ranked.internal_code,
               'module_revision_id', ranked.module_revision_id,
               'module_revision_number', ranked.revision_number,
               'builder_sort_order', ranked.definition->'sortOrder',
               'source_service_revision_id', case when ranked.mandatory then null else ranked.source_service_revision_id end
           ))
    from ranked
    order by ranked.frozen_sort_order;

    select count(*)::integer into v_module_count
    from public.client_sale_composition_items
    where workspace_id = p_workspace_id and client_sale_id = p_sale_id and item_kind = 'module';
    if v_module_count = 0 then
        raise exception 'ONBOARDING_MODULES_REQUIRED: Publish at least one applicable Builder module before sending the invoice';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', item.id, 'kind', item.item_kind, 'source_kind', item.source_kind,
        'module_id', item.module_id, 'module_revision_id', item.module_revision_id,
        'configuration_revision_id', item.configuration_revision_id,
        'source_service_revision_id', item.source_service_revision_id,
        'sort_order', item.sort_order, 'definition', item.definition,
        'source_references', item.source_references
    ) order by item.sort_order), '[]'::jsonb)
    into v_composition
    from public.client_sale_composition_items item
    where item.workspace_id = p_workspace_id and item.client_sale_id = p_sale_id;
    v_hash := encode(extensions.digest(convert_to(v_composition::text, 'UTF8'), 'sha256'), 'hex');
    select count(*)::integer into v_item_count
    from public.client_sale_items where client_sale_id = p_sale_id;

    update public.client_sales
    set configuration_revision_id = v_configuration_id,
        welcome_revision_id = null,
        completion_revision_id = null,
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
        'Invoice service and Builder configuration frozen',
        p_entity_type => 'client_sale', p_entity_id => p_sale_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_correlation_id => v_correlation_id,
        p_idempotency_key => 'billing.invoice.snapshot_frozen:' || p_sale_id::text,
        p_metadata => jsonb_build_object(
            'relationship_id', p_relationship_id,
            'configuration_revision_id', v_configuration_id,
            'service_count', v_item_count,
            'module_count', v_module_count,
            'composition_hash', v_hash,
            'currency', v_currency,
            'composition_source', 'published_builder_modules'
        )
    );
    return jsonb_build_object(
        'sale_id', p_sale_id,
        'configuration_revision_id', v_configuration_id,
        'composition_hash', v_hash,
        'item_count', v_item_count,
        'module_count', v_module_count
    );
end;
$$;

revoke all on function public.freeze_client_sale_configuration(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.freeze_client_sale_configuration(uuid, uuid, uuid, uuid, uuid) to service_role;

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
    v_snapshot_schema_version integer := 1;
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
        where workspace_id = p_workspace_id and client_sale_id = p_sale_id and item_kind = 'module'
    ) then raise exception 'SALE_COMPOSITION_REQUIRED: Invoice has no frozen Builder module composition'; end if;

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', item.id, 'kind', item.item_kind, 'source_kind', item.source_kind,
        'module_id', item.module_id, 'module_revision_id', item.module_revision_id,
        'configuration_revision_id', item.configuration_revision_id,
        'source_service_revision_id', item.source_service_revision_id,
        'sort_order', item.sort_order, 'definition', item.definition,
        'source_references', item.source_references
    ) order by item.sort_order), '[]'::jsonb) into v_snapshot
    from public.client_sale_composition_items item
    where item.workspace_id = p_workspace_id and item.client_sale_id = p_sale_id and item.item_kind = 'module';
    v_composition_hash := coalesce(v_sale.composition_hash, md5(v_snapshot::text));
    select coalesce(max(case when jsonb_typeof(item.definition->'schemaVersion') = 'number'
        then (item.definition->>'schemaVersion')::integer else 1 end), 1)
    into v_snapshot_schema_version
    from public.client_sale_composition_items item
    where item.workspace_id = p_workspace_id and item.client_sale_id = p_sale_id and item.item_kind = 'module';

    insert into public.relationship_onboarding_sessions (
        id, workspace_id, relationship_id, session_token, status, is_test,
        project_timeframe_days, created_by, source_sale_id, configuration_revision_id,
        welcome_revision_id, completion_revision_id, snapshot_schema_version,
        composition_hash, composition_snapshot, created_at, updated_at
    ) values (
        v_session_id, p_workspace_id, v_sale.relationship_id, v_session_token, 'active',
        coalesce((select (source_metadata->>'is_test')::boolean from public.relationships where id = v_sale.relationship_id), false),
        v_sale.project_timeframe_days, v_sale.created_by, p_sale_id, v_sale.configuration_revision_id,
        null, null, v_snapshot_schema_version, v_composition_hash,
        jsonb_build_object('sale_id', p_sale_id, 'source', 'published_builder_modules', 'items', v_snapshot), v_now, v_now
    );

    for v_item in
        select * from public.client_sale_composition_items
        where workspace_id = p_workspace_id and client_sale_id = p_sale_id and item_kind = 'module'
        order by sort_order
    loop
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
                video_storage_path, sort_order, legacy_step_key, legacy_form_key,
                navigation, is_actionable
            ) values (
                p_workspace_id, v_session_id, v_session_module_id, (v_step->>'id')::uuid,
                v_item.module_revision_id, coalesce(nullif(v_step->>'kind', ''), 'form'),
                coalesce(v_step->>'title', v_step#>>'{blocks,0,title}', 'Onboarding step'),
                nullif(coalesce(v_step->>'description', v_step#>>'{blocks,0,description}'), ''),
                nullif(coalesce(v_step->>'estimatedTime', v_step#>>'{blocks,0,estimatedTime}'), ''),
                nullif(v_step->>'why', ''), nullif(v_step->>'videoUrl', ''), nullif(v_step->>'videoPath', ''),
                v_item.sort_order * 1000 + coalesce((select count(*) from public.relationship_onboarding_session_steps existing where existing.session_module_id = v_session_module_id), 0),
                nullif(v_step->>'key', ''), nullif(v_step->>'formKey', ''),
                coalesce(v_step->'navigation', '{"backLabel":"Back","continueLabel":"Complete and continue"}'::jsonb), true
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
    end loop;

    select id into v_stage_id from public.work_items
    where workspace_id = p_workspace_id and native_kind = 'relationship_workflow'
      and native_key = v_sale.relationship_id::text || ':onboarding'
    for update;
    if v_stage_id is null then
        insert into public.work_items (
            workspace_id, title, description, lifecycle_phase, status, priority, is_key_task,
            native_kind, native_key, workflow_role, completion_mode, workflow_action,
            actual_start_at, actual_start_has_time, sort_order, metadata, created_by
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
        where workspace_id = p_workspace_id and session_id = v_session_id and is_actionable = true
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
        p_workspace_id, 'onboarding', 'onboarding.session.composed', 'Paid onboarding session composed from Builder snapshot',
        p_entity_type => 'onboarding_session', p_entity_id => v_session_id::text,
        p_actor_kind => 'automation', p_correlation_id => v_correlation_id,
        p_idempotency_key => p_idempotency_key || ':composed',
        p_metadata => jsonb_build_object(
            'sale_id', p_sale_id, 'relationship_id', v_sale.relationship_id,
            'configuration_revision_id', v_sale.configuration_revision_id,
            'module_count', (select count(*) from public.relationship_onboarding_session_modules where session_id = v_session_id),
            'step_count', (select count(*) from public.relationship_onboarding_session_steps where session_id = v_session_id),
            'field_count', (select count(*) from public.relationship_onboarding_session_fields where session_id = v_session_id),
            'composition_hash', v_composition_hash,
            'snapshot_schema_version', v_snapshot_schema_version,
            'composition_source', 'published_builder_modules'
        )
    );
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.session.started', 'Client onboarding session prepared after payment',
        p_entity_type => 'onboarding_session', p_entity_id => v_session_id::text,
        p_actor_kind => 'automation', p_correlation_id => v_correlation_id,
        p_idempotency_key => p_idempotency_key || ':started',
        p_metadata => jsonb_build_object('sale_id', p_sale_id, 'relationship_id', v_sale.relationship_id, 'public_access', 'awaiting_whatsapp_confirmation')
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
