-- Idempotent workspace seeding. The application passes the current legacy
-- catalogue so the database can translate it into real, stable UUID-backed
-- revisions atomically instead of leaving a schema-ready workspace empty.

create or replace function public.onboarding_seed_uuid(
    p_workspace_id uuid,
    p_kind text,
    p_key text
)
returns uuid
language sql
immutable
strict
set search_path = public
as $$
    select (
        substr(hash, 1, 8) || '-' || substr(hash, 9, 4) || '-' ||
        substr(hash, 13, 4) || '-' || substr(hash, 17, 4) || '-' ||
        substr(hash, 21, 12)
    )::uuid
    from (
        select md5(p_workspace_id::text || ':' || p_kind || ':' || p_key) as hash
    ) seed;
$$;

create or replace function public.normalize_seed_onboarding_module_definition(
    p_workspace_id uuid,
    p_code text,
    p_definition jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
    v_steps jsonb := '[]'::jsonb;
    v_fields jsonb;
    v_step jsonb;
    v_field jsonb;
    v_step_key text;
    v_field_key text;
    v_step_position integer := 0;
    v_field_position integer;
begin
    for v_step in
        select value
        from jsonb_array_elements(coalesce(p_definition->'steps', '[]'::jsonb))
    loop
        v_step_position := v_step_position + 1;
        v_step_key := coalesce(
            nullif(v_step->>'key', ''),
            nullif(v_step->>'code', ''),
            'step-' || v_step_position::text
        );
        v_fields := '[]'::jsonb;
        v_field_position := 0;
        for v_field in
            select value
            from jsonb_array_elements(coalesce(v_step->'fields', '[]'::jsonb))
        loop
            v_field_position := v_field_position + 1;
            v_field_key := coalesce(
                nullif(v_field->>'key', ''),
                nullif(v_field->>'name', ''),
                'field-' || v_field_position::text
            );
            v_fields := v_fields || jsonb_build_array(
                v_field || jsonb_build_object(
                    'id', public.onboarding_seed_uuid(
                        p_workspace_id, 'field',
                        p_code || ':' || v_step_key || ':' || v_field_key
                    ),
                    'key', v_field_key,
                    'label', coalesce(nullif(v_field->>'label', ''), initcap(replace(v_field_key, '_', ' '))),
                    'type', coalesce(nullif(v_field->>'type', ''), 'text'),
                    'required', coalesce((v_field->>'required')::boolean, false),
                    'helpText', coalesce(v_field->>'helpText', v_field->>'help_text', ''),
                    'placeholder', coalesce(v_field->>'placeholder', ''),
                    'accept', coalesce(v_field->>'accept', 'any'),
                    'multiple', case
                        when coalesce(v_field->>'type', 'text') = 'file'
                        then coalesce((v_field->>'multiple')::boolean, true)
                        else false
                    end
                )
            );
        end loop;
        v_steps := v_steps || jsonb_build_array(
            v_step || jsonb_build_object(
                'id', public.onboarding_seed_uuid(p_workspace_id, 'step', p_code || ':' || v_step_key),
                'key', v_step_key,
                'kind', case when v_step->>'kind' = 'video' then 'video' else 'form' end,
                'title', coalesce(nullif(v_step->>'title', ''), initcap(replace(v_step_key, '-', ' '))),
                'description', coalesce(v_step->>'description', ''),
                'estimatedTime', coalesce(v_step->>'estimatedTime', v_step->>'estimated_time', '2–3 minutes'),
                'why', coalesce(v_step->>'why', v_step->>'why_we_ask', ''),
                'videoUrl', coalesce(v_step->>'videoUrl', v_step->>'video_url', ''),
                'videoPath', coalesce(v_step->'videoPath', v_step->'video_path', 'null'::jsonb),
                'fields', case when v_step->>'kind' = 'video' then '[]'::jsonb else v_fields end
            )
        );
    end loop;
    return jsonb_build_object(
        'name', coalesce(nullif(p_definition->>'name', ''), nullif(p_definition->>'title', ''), initcap(replace(p_code, '-', ' '))),
        'description', coalesce(p_definition->>'description', ''),
        'isTest', coalesce((coalesce(p_definition->>'isTest', p_definition->>'is_test'))::boolean, false),
        'steps', v_steps
    );
end;
$$;

create or replace function public.backfill_workspace_onboarding_data(
    p_workspace_id uuid,
    p_actor_user_id uuid default null,
    p_correlation_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_configuration public.onboarding_configuration_revisions%rowtype;
    v_welcome public.onboarding_configuration_revisions%rowtype;
    v_completion public.onboarding_configuration_revisions%rowtype;
    v_session public.relationship_onboarding_sessions%rowtype;
    v_module record;
    v_step jsonb;
    v_field jsonb;
    v_session_module_id uuid;
    v_session_step_id uuid;
    v_module_position integer;
    v_step_position integer;
    v_field_position integer;
    v_snapshot jsonb;
    v_sessions_backfilled integer := 0;
    v_services_mapped integer := 0;
    v_work_items_mapped integer := 0;
    v_assets_mapped integer := 0;
    v_sales_backfilled integer := 0;
    v_count integer;
    v_sale public.client_sales%rowtype;
    v_sale_session public.relationship_onboarding_sessions%rowtype;
    v_sale_configuration_id uuid;
    v_sale_welcome_id uuid;
    v_sale_completion_id uuid;
    v_sale_migration_source text;
    v_sale_composition jsonb;
    v_sale_hash text;
    v_sales_without_sessions_frozen integer := 0;
    v_correlation_id uuid := coalesce(p_correlation_id, gen_random_uuid());
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Onboarding backfill requires trusted server access';
    end if;

    update public.relationship_services relationship_service
    set service_id = service.id,
        service_revision_id = revision.id
    from public.onboarding_services service
    join lateral (
        select service_revision.id
        from public.onboarding_service_revisions service_revision
        where service_revision.workspace_id = service.workspace_id
          and service_revision.service_id = service.id
        order by service_revision.revision_number desc limit 1
    ) revision on true
    where relationship_service.workspace_id = p_workspace_id
      and relationship_service.workspace_id = service.workspace_id
      and relationship_service.service_key = service.internal_code
      and (relationship_service.service_id is null or relationship_service.service_revision_id is null);
    get diagnostics v_services_mapped = row_count;

    select * into v_configuration
    from public.onboarding_configuration_revisions
    where workspace_id = p_workspace_id
      and configuration_type = 'mandatory_modules' and status = 'published'
    order by revision_number desc limit 1;
    select * into v_welcome
    from public.onboarding_configuration_revisions
    where workspace_id = p_workspace_id
      and configuration_type = 'welcome' and status = 'published'
    order by revision_number desc limit 1;
    select * into v_completion
    from public.onboarding_configuration_revisions
    where workspace_id = p_workspace_id
      and configuration_type = 'completion' and status = 'published'
    order by revision_number desc limit 1;
    if v_configuration.id is null or v_welcome.id is null or v_completion.id is null then
        raise exception 'Published onboarding configuration is required before backfill';
    end if;

    for v_session in
        select session.*
        from public.relationship_onboarding_sessions session
        where session.workspace_id = p_workspace_id
          and not exists (
              select 1 from public.relationship_onboarding_session_steps snapshot_step
              where snapshot_step.session_id = session.id
          )
        order by session.created_at, session.id
        for update
    loop
        insert into public.relationship_onboarding_session_steps (
            workspace_id, session_id, bookend_revision_id, kind, title,
            description, video_url, video_storage_path, sort_order,
            legacy_step_key
        ) values (
            p_workspace_id, v_session.id, v_welcome.id, 'welcome',
            coalesce(v_welcome.definition->>'title', 'Welcome'),
            nullif(coalesce(v_welcome.definition->>'body', v_welcome.definition->>'description'), ''),
            nullif(v_welcome.definition->>'videoUrl', ''),
            nullif(v_welcome.definition->>'videoPath', ''), 0, 'welcome'
        );

        v_module_position := 0;
        for v_module in
            select module.id as module_id, module.internal_code,
                   revision.id as module_revision_id, revision.revision_number,
                   revision.definition,
                   exists (
                       select 1 from public.onboarding_configuration_revision_modules assignment
                       where assignment.configuration_revision_id = v_configuration.id
                         and assignment.module_id = module.id
                   ) as mandatory,
                   coalesce((
                       select assignment.sort_order
                       from public.onboarding_configuration_revision_modules assignment
                       where assignment.configuration_revision_id = v_configuration.id
                         and assignment.module_id = module.id
                   ), 10000) as configuration_sort
            from public.relationship_onboarding_modules legacy_module
            join public.onboarding_modules module
              on module.workspace_id = legacy_module.workspace_id
             and module.internal_code = legacy_module.module_key
            join lateral (
                select published.* from public.onboarding_module_revisions published
                where published.workspace_id = module.workspace_id
                  and published.module_id = module.id and published.status = 'published'
                order by published.revision_number desc limit 1
            ) revision on true
            where legacy_module.workspace_id = p_workspace_id
              and legacy_module.relationship_id = v_session.relationship_id
            order by mandatory desc, configuration_sort, legacy_module.created_at, module.internal_code
        loop
            v_module_position := v_module_position + 1;
            insert into public.relationship_onboarding_session_modules (
                workspace_id, session_id, module_id, module_revision_id,
                source_kind, sort_order, title, description, is_test
            ) values (
                p_workspace_id, v_session.id, v_module.module_id,
                v_module.module_revision_id,
                case when v_module.mandatory then 'mandatory' else 'service' end,
                v_module_position,
                coalesce(v_module.definition->>'name', initcap(replace(v_module.internal_code, '-', ' '))),
                nullif(v_module.definition->>'description', ''),
                coalesce((v_module.definition->>'isTest')::boolean, false)
            ) returning id into v_session_module_id;
            v_step_position := 0;
            for v_step in
                select value from jsonb_array_elements(v_module.definition->'steps')
            loop
                v_step_position := v_step_position + 1;
                insert into public.relationship_onboarding_session_steps (
                    workspace_id, session_id, session_module_id, source_step_id,
                    module_revision_id, kind, title, description, estimated_time,
                    why_we_ask, video_url, video_storage_path, sort_order,
                    legacy_step_key, legacy_form_key
                ) values (
                    p_workspace_id, v_session.id, v_session_module_id,
                    (v_step->>'id')::uuid, v_module.module_revision_id,
                    v_step->>'kind', coalesce(v_step->>'title', 'Onboarding step'),
                    nullif(v_step->>'description', ''), nullif(v_step->>'estimatedTime', ''),
                    nullif(v_step->>'why', ''), nullif(v_step->>'videoUrl', ''),
                    nullif(v_step->>'videoPath', ''),
                    v_module_position * 1000 + v_step_position,
                    nullif(v_step->>'key', ''), nullif(v_step->>'formKey', '')
                ) returning id into v_session_step_id;
                v_field_position := 0;
                for v_field in
                    select value from jsonb_array_elements(coalesce(v_step->'fields', '[]'::jsonb))
                loop
                    v_field_position := v_field_position + 1;
                    insert into public.relationship_onboarding_session_fields (
                        workspace_id, session_id, session_step_id, source_field_id,
                        type, label, required, help_text, placeholder, file_accept,
                        multiple, sort_order, legacy_field_name
                    ) values (
                        p_workspace_id, v_session.id, v_session_step_id,
                        (v_field->>'id')::uuid, v_field->>'type',
                        coalesce(v_field->>'label', 'Field'),
                        coalesce((v_field->>'required')::boolean, false),
                        nullif(v_field->>'helpText', ''), nullif(v_field->>'placeholder', ''),
                        case when v_field->>'type' = 'file' then coalesce(nullif(v_field->>'accept', ''), 'any') else null end,
                        case when v_field->>'type' = 'file' then coalesce((v_field->>'multiple')::boolean, true) else false end,
                        v_field_position, nullif(v_field->>'key', '')
                    );
                end loop;
            end loop;
        end loop;

        insert into public.relationship_onboarding_session_steps (
            workspace_id, session_id, bookend_revision_id, kind, title,
            description, video_url, video_storage_path, sort_order,
            legacy_step_key
        ) values (
            p_workspace_id, v_session.id, v_completion.id, 'completion',
            coalesce(v_completion.definition->>'title', 'All done'),
            nullif(coalesce(v_completion.definition->>'body', v_completion.definition->>'description'), ''),
            nullif(v_completion.definition->>'videoUrl', ''),
            nullif(v_completion.definition->>'videoPath', ''), 2000000000, 'completion'
        );

        select jsonb_build_object(
            'migration', 'legacy_hard_coded_v1',
            'configuration_revision_id', v_configuration.id,
            'welcome_revision_id', v_welcome.id,
            'completion_revision_id', v_completion.id,
            'modules', coalesce(jsonb_agg(jsonb_build_object(
                'session_module_id', snapshot_module.id,
                'module_id', snapshot_module.module_id,
                'module_revision_id', snapshot_module.module_revision_id,
                'source_kind', snapshot_module.source_kind,
                'sort_order', snapshot_module.sort_order,
                'definition', revision.definition
            ) order by snapshot_module.sort_order), '[]'::jsonb)
        ) into v_snapshot
        from public.relationship_onboarding_session_modules snapshot_module
        join public.onboarding_module_revisions revision on revision.id = snapshot_module.module_revision_id
        where snapshot_module.session_id = v_session.id;

        update public.relationship_onboarding_sessions
        set configuration_revision_id = v_configuration.id,
            welcome_revision_id = v_welcome.id,
            completion_revision_id = v_completion.id,
            snapshot_schema_version = 1,
            composition_snapshot = v_snapshot,
            composition_hash = encode(extensions.digest(convert_to(v_snapshot::text, 'UTF8'), 'sha256'), 'hex'),
            updated_at = greatest(updated_at, now())
        where id = v_session.id and workspace_id = p_workspace_id;

        with mapped as (
            select item.id, snapshot_step.id as session_step_id
            from public.work_items item
            join public.relationship_onboarding_session_steps snapshot_step
              on snapshot_step.session_id = v_session.id
             and snapshot_step.legacy_step_key = item.metadata->>'step_key'
            where item.workspace_id = p_workspace_id
              and item.native_kind = 'onboarding_step'
              and (
                  item.metadata->>'session_id' = v_session.id::text
                  or item.native_key like v_session.id::text || ':%'
              )
        )
        update public.work_items item
        set metadata = item.metadata || jsonb_build_object(
            'session_step_id', mapped.session_step_id,
            'legacy_step_key', item.metadata->>'step_key'
        )
        from mapped where item.id = mapped.id;
        get diagnostics v_count = row_count;
        v_work_items_mapped := v_work_items_mapped + v_count;

        with mapped as (
            select asset.id, snapshot_step.id as session_step_id
            from public.assets asset
            join public.relationship_onboarding_session_steps snapshot_step
              on snapshot_step.session_id = v_session.id
             and snapshot_step.legacy_step_key = coalesce(asset.metadata->>'step_key', asset.metadata->>'legacy_step_key')
            where asset.workspace_id = p_workspace_id
              and asset.source_kind = 'onboarding_submission'
              and asset.metadata->>'session_id' = v_session.id::text
        )
        update public.assets asset
        set metadata = asset.metadata || jsonb_build_object(
            'session_step_id', mapped.session_step_id,
            'legacy_step_key', coalesce(asset.metadata->>'legacy_step_key', asset.metadata->>'step_key')
        )
        from mapped where asset.id = mapped.id;
        get diagnostics v_count = row_count;
        v_assets_mapped := v_assets_mapped + v_count;
        v_sessions_backfilled := v_sessions_backfilled + 1;
    end loop;

    -- Freeze historical sent/paid sales. Prefer the normalized session that was
    -- just backfilled; sales which predate WhatsApp confirmation may not have a
    -- session yet, so compose those from their preserved relationship prices
    -- and the newly seeded published catalogue instead of leaving them unable
    -- to resume payment automation.
    for v_sale in
        select sale.*
        from public.client_sales sale
        where sale.workspace_id = p_workspace_id
          and sale.snapshot_frozen_at is null
          and sale.relationship_id is not null
          and sale.deleted_at is null
          and (sale.stripe_invoice_id is not null or sale.status <> 'draft')
        order by sale.created_at, sale.id
        for update
    loop
        select session.* into v_sale_session
        from public.relationship_onboarding_sessions session
        where session.workspace_id = p_workspace_id
          and session.relationship_id = v_sale.relationship_id
          and (session.source_sale_id is null or session.source_sale_id = v_sale.id)
          and not exists (
              select 1 from public.client_sales linked_sale
              where linked_sale.workspace_id = p_workspace_id
                and linked_sale.onboarding_session_id = session.id
                and linked_sale.id <> v_sale.id
          )
        order by
            case when v_sale.onboarding_session_id = session.id then 0 else 1 end,
            abs(extract(epoch from (session.created_at - v_sale.created_at))),
            session.created_at,
            session.id
        limit 1
        for update;
        if v_sale_session.id is null then
            v_sale_configuration_id := v_configuration.id;
            v_sale_welcome_id := v_welcome.id;
            v_sale_completion_id := v_completion.id;
            v_sale_migration_source := 'legacy_sale_without_session';
            v_sales_without_sessions_frozen := v_sales_without_sessions_frozen + 1;
        else
            v_sale_configuration_id := coalesce(v_sale_session.configuration_revision_id, v_configuration.id);
            v_sale_welcome_id := coalesce(v_sale_session.welcome_revision_id, v_welcome.id);
            v_sale_completion_id := coalesce(v_sale_session.completion_revision_id, v_completion.id);
            v_sale_migration_source := 'legacy_session_snapshot';
        end if;

        insert into public.client_sale_items (
            workspace_id, client_sale_id, service_id, service_revision_id,
            service_code, service_name, description, amount_cents, currency,
            default_assignee_user_id, display_priority, sort_order,
            fulfilment_definition_revision_id
        )
        select p_workspace_id, v_sale.id, service.id, revision.id,
               service.internal_code, revision.name, revision.description,
               greatest(0, coalesce(
                   case when line_item.value->>'amount' ~ '^[0-9]+$' then (line_item.value->>'amount')::integer end,
                   relationship_service.price_cents,
                   revision.default_price_cents
               )),
               upper(coalesce(nullif(relationship_service.currency, ''), nullif(v_sale.currency, ''), revision.currency)),
               coalesce(relationship_service.assignee_user_id, revision.default_assignee_user_id),
               revision.display_priority,
               row_number() over (order by revision.display_priority desc, service.internal_code)::integer - 1,
               revision.fulfilment_definition_revision_id
        from public.relationship_services relationship_service
        join public.onboarding_services service
          on service.workspace_id = relationship_service.workspace_id
         and service.id = relationship_service.service_id
        join public.onboarding_service_revisions revision
          on revision.workspace_id = relationship_service.workspace_id
         and revision.id = relationship_service.service_revision_id
        left join lateral (
            select item as value
            from jsonb_array_elements(coalesce(v_sale.line_items, '[]'::jsonb)) item
            where coalesce(item->>'serviceKey', item->>'service_key', item->>'key') = relationship_service.service_key
            limit 1
        ) line_item on true
        where relationship_service.workspace_id = p_workspace_id
          and relationship_service.relationship_id = v_sale.relationship_id
          and (
              jsonb_typeof(v_sale.service_keys) <> 'array'
              or jsonb_array_length(v_sale.service_keys) = 0
              or relationship_service.service_key in (select jsonb_array_elements_text(v_sale.service_keys))
          )
        on conflict (client_sale_id, service_id) do nothing;

        insert into public.client_sale_composition_items (
            workspace_id, client_sale_id, item_kind, source_kind,
            configuration_revision_id, sort_order, definition, source_references
        ) values (
            p_workspace_id, v_sale.id, 'welcome', 'bookend',
            v_sale_welcome_id, 0,
            (select definition from public.onboarding_configuration_revisions where id = v_sale_welcome_id),
            jsonb_build_object(
                'configuration_revision_id', v_sale_welcome_id,
                'migrated_from_session_id', v_sale_session.id,
                'migration_source', v_sale_migration_source,
                'composition_uncertainty', v_sale_session.id is null
            )
        ) on conflict (client_sale_id, sort_order) do nothing;

        if v_sale_session.id is not null then
            insert into public.client_sale_composition_items (
                workspace_id, client_sale_id, item_kind, source_kind, module_id,
                module_revision_id, configuration_revision_id,
                source_service_item_id, source_service_revision_id,
                sort_order, definition, source_references
            )
            select p_workspace_id, v_sale.id, 'module', snapshot_module.source_kind,
                   snapshot_module.module_id, snapshot_module.module_revision_id,
                   case when snapshot_module.source_kind = 'mandatory' then v_sale_configuration_id else null end,
                   service_source.sale_item_id, service_source.service_revision_id,
                   snapshot_module.sort_order, revision.definition,
                   jsonb_build_object(
                       'module_revision_id', snapshot_module.module_revision_id,
                       'module_revision_number', revision.revision_number,
                       'migrated_from_session_id', v_sale_session.id,
                       'migration_source', v_sale_migration_source
                   )
            from public.relationship_onboarding_session_modules snapshot_module
            join public.onboarding_module_revisions revision
              on revision.id = snapshot_module.module_revision_id
            left join lateral (
                select sale_item.id as sale_item_id, sale_item.service_revision_id
                from public.client_sale_items sale_item
                join public.onboarding_service_revision_modules assignment
                  on assignment.workspace_id = sale_item.workspace_id
                 and assignment.service_revision_id = sale_item.service_revision_id
                 and assignment.module_id = snapshot_module.module_id
                where sale_item.workspace_id = p_workspace_id
                  and sale_item.client_sale_id = v_sale.id
                order by sale_item.display_priority desc, sale_item.sort_order, assignment.sort_order
                limit 1
            ) service_source on snapshot_module.source_kind = 'service'
            where snapshot_module.workspace_id = p_workspace_id
              and snapshot_module.session_id = v_sale_session.id
            on conflict (client_sale_id, sort_order) do nothing;
        else
            insert into public.client_sale_composition_items (
                workspace_id, client_sale_id, item_kind, source_kind, module_id,
                module_revision_id, configuration_revision_id, sort_order,
                definition, source_references
            )
            select p_workspace_id, v_sale.id, 'module', 'mandatory', module.id,
                   published.id, v_sale_configuration_id,
                   row_number() over (order by assignment.sort_order, module.id)::integer,
                   published.definition,
                   jsonb_build_object(
                       'module_revision_id', published.id,
                       'module_revision_number', published.revision_number,
                       'configuration_revision_id', v_sale_configuration_id,
                       'migration_source', v_sale_migration_source,
                       'composition_uncertainty', true
                   )
            from public.onboarding_configuration_revision_modules assignment
            join public.onboarding_modules module
              on module.workspace_id = assignment.workspace_id
             and module.id = assignment.module_id
            join lateral (
                select revision.*
                from public.onboarding_module_revisions revision
                where revision.workspace_id = module.workspace_id
                  and revision.module_id = module.id and revision.status = 'published'
                order by revision.revision_number desc limit 1
            ) published on true
            where assignment.workspace_id = p_workspace_id
              and assignment.configuration_revision_id = v_sale_configuration_id
            on conflict (client_sale_id, sort_order) do nothing;

            select coalesce(max(sort_order), 0) + 1 into v_count
            from public.client_sale_composition_items
            where workspace_id = p_workspace_id and client_sale_id = v_sale.id;
            insert into public.client_sale_composition_items (
                workspace_id, client_sale_id, item_kind, source_kind, module_id,
                module_revision_id, source_service_item_id,
                source_service_revision_id, sort_order, definition,
                source_references
            )
            with candidates as (
                select assignment.module_id, module.internal_code,
                       published.id as module_revision_id,
                       published.revision_number, published.definition,
                       sale_item.id as source_service_item_id,
                       sale_item.service_revision_id,
                       sale_item.display_priority,
                       sale_item.sort_order as service_sort_order,
                       assignment.sort_order as module_sort_order,
                       row_number() over (
                           partition by assignment.module_id
                           order by sale_item.display_priority desc,
                                    sale_item.sort_order, assignment.sort_order,
                                    sale_item.service_revision_id
                       ) as winner_rank
                from public.client_sale_items sale_item
                join public.onboarding_service_revision_modules assignment
                  on assignment.workspace_id = sale_item.workspace_id
                 and assignment.service_revision_id = sale_item.service_revision_id
                join public.onboarding_modules module
                  on module.workspace_id = assignment.workspace_id
                 and module.id = assignment.module_id
                join lateral (
                    select revision.*
                    from public.onboarding_module_revisions revision
                    where revision.workspace_id = module.workspace_id
                      and revision.module_id = module.id and revision.status = 'published'
                    order by revision.revision_number desc limit 1
                ) published on true
                where sale_item.workspace_id = p_workspace_id
                  and sale_item.client_sale_id = v_sale.id
                  and not exists (
                      select 1 from public.client_sale_composition_items existing
                      where existing.client_sale_id = v_sale.id
                        and existing.module_id = assignment.module_id
                  )
            ), winners as (
                select *, row_number() over (
                    order by display_priority desc, service_sort_order,
                             module_sort_order, module_id
                )::integer - 1 as final_position
                from candidates where winner_rank = 1
            )
            select p_workspace_id, v_sale.id, 'module', 'service', module_id,
                   module_revision_id, source_service_item_id,
                   service_revision_id, v_count + final_position,
                   definition,
                   jsonb_build_object(
                       'module_code', internal_code,
                       'module_revision_id', module_revision_id,
                       'module_revision_number', revision_number,
                       'service_revision_id', service_revision_id,
                       'service_priority', display_priority,
                       'service_module_sort_order', module_sort_order,
                       'migration_source', v_sale_migration_source,
                       'composition_uncertainty', true
                   )
            from winners
            order by final_position
            on conflict (client_sale_id, sort_order) do nothing;
        end if;

        select coalesce(max(sort_order), 0) + 1 into v_count
        from public.client_sale_composition_items
        where client_sale_id = v_sale.id;
        insert into public.client_sale_composition_items (
            workspace_id, client_sale_id, item_kind, source_kind,
            configuration_revision_id, sort_order, definition, source_references
        ) values (
            p_workspace_id, v_sale.id, 'completion', 'bookend',
            v_sale_completion_id, v_count,
            (select definition from public.onboarding_configuration_revisions where id = v_sale_completion_id),
            jsonb_build_object(
                'configuration_revision_id', v_sale_completion_id,
                'migrated_from_session_id', v_sale_session.id,
                'migration_source', v_sale_migration_source,
                'composition_uncertainty', v_sale_session.id is null
            )
        ) on conflict (client_sale_id, sort_order) do nothing;

        select coalesce(jsonb_agg(jsonb_build_object(
            'id', item.id, 'kind', item.item_kind, 'source_kind', item.source_kind,
            'module_id', item.module_id, 'module_revision_id', item.module_revision_id,
            'configuration_revision_id', item.configuration_revision_id,
            'source_service_revision_id', item.source_service_revision_id,
            'sort_order', item.sort_order, 'definition', item.definition,
            'source_references', item.source_references
        ) order by item.sort_order), '[]'::jsonb)
        into v_sale_composition
        from public.client_sale_composition_items item
        where item.workspace_id = p_workspace_id and item.client_sale_id = v_sale.id;
        v_sale_hash := encode(extensions.digest(convert_to(v_sale_composition::text, 'UTF8'), 'sha256'), 'hex');

        if v_sale_session.id is not null then
            update public.relationship_onboarding_sessions
            set source_sale_id = v_sale.id, updated_at = greatest(updated_at, now())
            where id = v_sale_session.id and workspace_id = p_workspace_id and source_sale_id is null;
        end if;
        update public.client_sales
        set configuration_revision_id = v_sale_configuration_id,
            welcome_revision_id = v_sale_welcome_id,
            completion_revision_id = v_sale_completion_id,
            composition_hash = v_sale_hash,
            snapshot_frozen_at = coalesce(updated_at, created_at, now()),
            onboarding_session_id = coalesce(onboarding_session_id, v_sale_session.id),
            correlation_id = coalesce(correlation_id, v_correlation_id),
            updated_at = greatest(updated_at, now())
        where id = v_sale.id and workspace_id = p_workspace_id;
        v_sales_backfilled := v_sales_backfilled + 1;
    end loop;

    perform public.record_workspace_admin_activity(
        p_workspace_id, 'system', 'onboarding.migration.backfilled',
        'Legacy onboarding relationships and sessions backfilled',
        p_entity_type => 'workspace', p_entity_id => p_workspace_id::text,
        p_actor_user_id => p_actor_user_id,
        p_actor_kind => case when p_actor_user_id is null then 'automation' else 'staff' end,
        p_correlation_id => v_correlation_id,
        p_idempotency_key => 'onboarding.migration.backfilled:' || p_workspace_id::text,
        p_metadata => jsonb_build_object(
            'relationship_services_mapped', v_services_mapped,
            'sessions_backfilled', v_sessions_backfilled,
            'sales_backfilled', v_sales_backfilled,
            'sales_without_sessions_frozen', v_sales_without_sessions_frozen,
            'work_items_mapped', v_work_items_mapped,
            'assets_mapped', v_assets_mapped
        )
    );
    return jsonb_build_object(
        'relationship_services_mapped', v_services_mapped,
        'sessions_backfilled', v_sessions_backfilled,
        'sales_backfilled', v_sales_backfilled,
        'sales_without_sessions_frozen', v_sales_without_sessions_frozen,
        'work_items_mapped', v_work_items_mapped,
        'assets_mapped', v_assets_mapped
    );
end;
$$;

create or replace function public.ensure_workspace_onboarding_seeded(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_modules jsonb,
    p_services jsonb,
    p_mandatory_module_codes text[],
    p_welcome jsonb,
    p_completion jsonb,
    p_swatches jsonb,
    p_assignments jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_module jsonb;
    v_service jsonb;
    v_swatch jsonb;
    v_assignment jsonb;
    v_definition jsonb;
    v_module_id uuid;
    v_module_revision_id uuid;
    v_service_id uuid;
    v_service_revision_id uuid;
    v_configuration_id uuid;
    v_code text;
    v_module_code text;
    v_module_codes text[];
    v_position integer;
    v_modules_created integer := 0;
    v_services_created integer := 0;
    v_module_revisions_created integer := 0;
    v_service_revisions_created integer := 0;
    v_correlation_id uuid := gen_random_uuid();
    v_backfill jsonb;
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Workspace onboarding seeding requires trusted server access';
    end if;
    if p_actor_user_id is not null then
        perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    elsif not exists (select 1 from public.workspaces where id = p_workspace_id) then
        raise exception 'Workspace not found';
    end if;
    if jsonb_typeof(p_modules) <> 'array' or jsonb_typeof(p_services) <> 'array' then
        raise exception 'Seed modules and services must be JSON arrays';
    end if;
    if jsonb_array_length(p_modules) = 0 or jsonb_array_length(p_services) = 0 then
        raise exception 'Seed catalogue cannot be empty';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('onboarding-seed:' || p_workspace_id::text, 0));
    for v_module in select value from jsonb_array_elements(p_modules) loop
        v_code := lower(regexp_replace(coalesce(
            nullif(v_module->>'code', ''), nullif(v_module->>'key', ''),
            nullif(v_module->>'internalCode', ''), nullif(v_module->>'name', '')
        ), '[^a-zA-Z0-9]+', '-', 'g'));
        v_code := trim(both '-' from v_code);
        if nullif(v_code, '') is null then raise exception 'Every seed module needs a code'; end if;
        v_module_id := public.onboarding_seed_uuid(p_workspace_id, 'module', v_code);
        insert into public.onboarding_modules (
            id, workspace_id, internal_code, status, created_by
        ) values (
            v_module_id, p_workspace_id, v_code, 'active', p_actor_user_id
        ) on conflict (workspace_id, internal_code) do nothing;
        if found then v_modules_created := v_modules_created + 1; end if;
        select id into v_module_id from public.onboarding_modules
        where workspace_id = p_workspace_id and internal_code = v_code;
        if not exists (
            select 1 from public.onboarding_module_revisions
            where workspace_id = p_workspace_id and module_id = v_module_id and status = 'published'
        ) then
            v_definition := public.normalize_seed_onboarding_module_definition(p_workspace_id, v_code, v_module);
            perform public.validate_onboarding_module_definition(v_definition);
            v_module_revision_id := public.onboarding_seed_uuid(p_workspace_id, 'module-revision', v_code || ':1');
            insert into public.onboarding_module_revisions (
                id, workspace_id, module_id, revision_number, status, definition,
                definition_hash, created_by, updated_by, published_by, published_at
            ) values (
                v_module_revision_id, p_workspace_id, v_module_id, 1, 'published',
                v_definition, encode(extensions.digest(convert_to(v_definition::text, 'UTF8'), 'sha256'), 'hex'),
                p_actor_user_id, p_actor_user_id, p_actor_user_id, now()
            );
            v_module_revisions_created := v_module_revisions_created + 1;
        end if;
    end loop;

    for v_service in select value from jsonb_array_elements(p_services) loop
        v_code := lower(regexp_replace(coalesce(
            nullif(v_service->>'code', ''), nullif(v_service->>'key', ''),
            nullif(v_service->>'internalCode', ''), nullif(v_service->>'name', '')
        ), '[^a-zA-Z0-9]+', '-', 'g'));
        v_code := trim(both '-' from v_code);
        if nullif(v_code, '') is null then raise exception 'Every seed service needs a code'; end if;
        v_service_id := public.onboarding_seed_uuid(p_workspace_id, 'service', v_code);
        insert into public.onboarding_services (
            id, workspace_id, internal_code, state, created_by
        ) values (
            v_service_id, p_workspace_id, v_code, 'active', p_actor_user_id
        ) on conflict (workspace_id, internal_code) do nothing;
        if found then v_services_created := v_services_created + 1; end if;
        select id into v_service_id from public.onboarding_services
        where workspace_id = p_workspace_id and internal_code = v_code;
        if not exists (
            select 1 from public.onboarding_service_revisions
            where workspace_id = p_workspace_id and service_id = v_service_id
        ) then
            v_service_revision_id := public.onboarding_seed_uuid(p_workspace_id, 'service-revision', v_code || ':1');
            v_definition := jsonb_build_object(
                'name', coalesce(nullif(v_service->>'name', ''), nullif(v_service->>'title', ''), initcap(replace(v_code, '-', ' '))),
                'description', coalesce(v_service->>'description', ''),
                'defaultPriceCents', coalesce((coalesce(v_service->>'defaultPriceCents', v_service->>'default_price_cents'))::integer, 0),
                'currency', upper(coalesce(nullif(v_service->>'currency', ''), 'USD')),
                'defaultAssigneeUserId', coalesce(v_service->'defaultAssigneeUserId', v_service->'default_assignee_user_id', 'null'::jsonb),
                'isTest', coalesce((coalesce(v_service->>'isTest', v_service->>'is_test'))::boolean, false),
                'displayPriority', coalesce((coalesce(v_service->>'displayPriority', v_service->>'display_priority'))::integer, v_services_created)
            );
            insert into public.onboarding_service_revisions (
                id, workspace_id, service_id, revision_number, name, description,
                default_price_cents, currency, default_assignee_user_id, is_test,
                display_priority, definition, created_by
            ) values (
                v_service_revision_id, p_workspace_id, v_service_id, 1,
                v_definition->>'name', nullif(v_definition->>'description', ''),
                (v_definition->>'defaultPriceCents')::integer,
                v_definition->>'currency',
                nullif(v_definition->>'defaultAssigneeUserId', '')::uuid,
                (v_definition->>'isTest')::boolean,
                (v_definition->>'displayPriority')::integer,
                v_definition, p_actor_user_id
            );
            v_service_revisions_created := v_service_revisions_created + 1;

            select coalesce(
                array_agg(code),
                '{}'::text[]
            ) into v_module_codes
            from (
                select coalesce(value->>'moduleCode', value->>'code', value->>'key') as code
                from jsonb_array_elements(coalesce(v_service->'modules', '[]'::jsonb))
                union all
                select value as code
                from jsonb_array_elements_text(coalesce(v_service->'moduleCodes', v_service->'requiredModuleKeys', '[]'::jsonb))
            ) codes
            where nullif(code, '') is not null;
            v_position := 0;
            foreach v_module_code in array v_module_codes loop
                select id into v_module_id
                from public.onboarding_modules
                where workspace_id = p_workspace_id and internal_code = v_module_code;
                if v_module_id is null then
                    raise exception 'Seed service % references unknown module code %', v_code, v_module_code;
                end if;
                insert into public.onboarding_service_revision_modules (
                    workspace_id, service_revision_id, module_id, sort_order
                ) values (
                    p_workspace_id, v_service_revision_id, v_module_id, v_position
                );
                v_position := v_position + 1;
            end loop;
        end if;
    end loop;

    if not exists (
        select 1 from public.onboarding_configuration_revisions
        where workspace_id = p_workspace_id
          and configuration_type = 'mandatory_modules' and status = 'published'
    ) then
        v_configuration_id := public.onboarding_seed_uuid(p_workspace_id, 'configuration-revision', 'mandatory:1');
        insert into public.onboarding_configuration_revisions (
            id, workspace_id, configuration_type, whatsapp_enabled,
            revision_number, status, definition, definition_hash,
            created_by, updated_by, published_by, published_at
        ) values (
            v_configuration_id, p_workspace_id, 'mandatory_modules', true, 1,
            'published', jsonb_build_object(
                'help_text', 'Not sure what we’re asking for? Don’t worry. We can walk you through it.',
                'whatsapp_enabled', true,
                'module_codes', to_jsonb(coalesce(p_mandatory_module_codes, '{}'::text[]))
            ), md5(coalesce(p_mandatory_module_codes, '{}'::text[])::text),
            p_actor_user_id, p_actor_user_id, p_actor_user_id, now()
        );
        v_position := 0;
        foreach v_module_code in array coalesce(p_mandatory_module_codes, '{}'::text[]) loop
            select id into v_module_id from public.onboarding_modules
            where workspace_id = p_workspace_id and internal_code = v_module_code;
            if v_module_id is null then raise exception 'Mandatory seed module % was not found', v_module_code; end if;
            insert into public.onboarding_configuration_revision_modules (
                workspace_id, configuration_revision_id, module_id, sort_order
            ) values (p_workspace_id, v_configuration_id, v_module_id, v_position);
            v_position := v_position + 1;
        end loop;
    end if;

    if not exists (
        select 1 from public.onboarding_configuration_revisions
        where workspace_id = p_workspace_id and configuration_type = 'welcome' and status = 'published'
    ) then
        v_definition := jsonb_build_object(
            'title', coalesce(nullif(p_welcome->>'title', ''), 'Welcome'),
            'body', coalesce(p_welcome->>'body', 'We’ll explain how this onboarding works and what we need from you.'),
            'videoUrl', coalesce(p_welcome->>'videoUrl', ''),
            'videoPath', coalesce(p_welcome->'videoPath', 'null'::jsonb)
        );
        insert into public.onboarding_configuration_revisions (
            id, workspace_id, configuration_type, revision_number, status,
            definition, definition_hash, created_by, updated_by, published_by, published_at
        ) values (
            public.onboarding_seed_uuid(p_workspace_id, 'configuration-revision', 'welcome:1'),
            p_workspace_id, 'welcome', 1, 'published', v_definition,
            encode(extensions.digest(convert_to(v_definition::text, 'UTF8'), 'sha256'), 'hex'),
            p_actor_user_id, p_actor_user_id, p_actor_user_id, now()
        );
    end if;
    if not exists (
        select 1 from public.onboarding_configuration_revisions
        where workspace_id = p_workspace_id and configuration_type = 'completion' and status = 'published'
    ) then
        v_definition := jsonb_build_object(
            'title', coalesce(nullif(p_completion->>'title', ''), 'All done'),
            'body', coalesce(p_completion->>'body', 'You have completed the onboarding steps.'),
            'videoUrl', coalesce(p_completion->>'videoUrl', ''),
            'videoPath', coalesce(p_completion->'videoPath', 'null'::jsonb)
        );
        insert into public.onboarding_configuration_revisions (
            id, workspace_id, configuration_type, revision_number, status,
            definition, definition_hash, created_by, updated_by, published_by, published_at
        ) values (
            public.onboarding_seed_uuid(p_workspace_id, 'configuration-revision', 'completion:1'),
            p_workspace_id, 'completion', 1, 'published', v_definition,
            encode(extensions.digest(convert_to(v_definition::text, 'UTF8'), 'sha256'), 'hex'),
            p_actor_user_id, p_actor_user_id, p_actor_user_id, now()
        );
    end if;

    if jsonb_typeof(p_swatches) = 'array' then
        for v_swatch in select value from jsonb_array_elements(p_swatches) loop
            insert into public.onboarding_brand_swatches (id, workspace_id, name, hex, hidden, hidden_at)
            values (
                v_swatch->>'id', p_workspace_id,
                coalesce(nullif(v_swatch->>'name', ''), 'Colour'),
                upper(v_swatch->>'hex'),
                coalesce((v_swatch->>'hidden')::boolean, false),
                case when coalesce((v_swatch->>'hidden')::boolean, false) then now() else null end
            ) on conflict (workspace_id, id) do nothing;
        end loop;
    end if;
    insert into public.onboarding_themes (workspace_id, assignments, updated_by)
    values (p_workspace_id, coalesce(p_assignments, '{}'::jsonb), p_actor_user_id)
    on conflict (workspace_id) do nothing;

    v_backfill := public.backfill_workspace_onboarding_data(
        p_workspace_id, p_actor_user_id, v_correlation_id
    );

    perform public.record_workspace_admin_activity(
        p_workspace_id, 'system', 'onboarding.migration.seeded',
        'Workspace onboarding catalogue seeded from the legacy definitions',
        p_entity_type => 'workspace', p_entity_id => p_workspace_id::text,
        p_actor_user_id => p_actor_user_id,
        p_actor_kind => case when p_actor_user_id is null then 'automation' else 'staff' end,
        p_correlation_id => v_correlation_id,
        p_idempotency_key => 'onboarding.migration.seeded:' || p_workspace_id::text,
        p_metadata => jsonb_build_object(
            'modules_created', v_modules_created,
            'module_revisions_created', v_module_revisions_created,
            'services_created', v_services_created,
            'service_revisions_created', v_service_revisions_created,
            'backfill', v_backfill
        )
    );
    return jsonb_build_object(
        'workspace_id', p_workspace_id,
        'modules_created', v_modules_created,
        'module_revisions_created', v_module_revisions_created,
        'services_created', v_services_created,
        'service_revisions_created', v_service_revisions_created,
        'backfill', v_backfill,
        'seeded', (v_modules_created + v_services_created + v_module_revisions_created + v_service_revisions_created) > 0
    );
end;
$$;

revoke all on function public.ensure_workspace_onboarding_seeded(uuid, uuid, jsonb, jsonb, text[], jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ensure_workspace_onboarding_seeded(uuid, uuid, jsonb, jsonb, text[], jsonb, jsonb, jsonb, jsonb) to service_role;
revoke all on function public.backfill_workspace_onboarding_data(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.backfill_workspace_onboarding_data(uuid, uuid, uuid) to service_role;

-- Existing legacy relationship rows receive stable catalogue identities as
-- soon as the matching catalogue has been seeded. This statement is harmless
-- before seeding and can also be rerun after calling the RPC.
update public.relationship_services relationship_service
set service_id = service.id,
    service_revision_id = revision.id
from public.onboarding_services service
join lateral (
    select service_revision.id
    from public.onboarding_service_revisions service_revision
    where service_revision.workspace_id = service.workspace_id
      and service_revision.service_id = service.id
    order by service_revision.revision_number desc limit 1
) revision on true
where relationship_service.workspace_id = service.workspace_id
  and relationship_service.service_key = service.internal_code
  and (relationship_service.service_id is null or relationship_service.service_revision_id is null);
