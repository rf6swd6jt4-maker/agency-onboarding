-- A sale is confirmed on WhatsApp before Stripe Checkout is created. The
-- resulting onboarding session is accessible immediately but remains on the
-- fixed Payment gate until Stripe confirms the first payment.

alter table public.client_sales
    add column if not exists checkout_flow text not null default 'legacy_invoice';

alter table public.client_sales
    drop constraint if exists client_sales_checkout_flow_check,
    add constraint client_sales_checkout_flow_check
        check (checkout_flow in ('legacy_invoice', 'onboarding_payment_gate'));

alter table public.relationships drop constraint if exists relationships_lifecycle_phase_check;
alter table public.relationships add constraint relationships_lifecycle_phase_check
    check (lifecycle_phase in ('lead', 'nurturing', 'potential_client', 'sold', 'invoiced', 'onboarding', 'onboarding_review', 'fulfilment', 'retention', 'completed_lost'));

alter table public.relationship_work_items drop constraint if exists relationship_work_items_lifecycle_phase_check;
alter table public.relationship_work_items add constraint relationship_work_items_lifecycle_phase_check
    check (lifecycle_phase in ('lead', 'nurturing', 'potential_client', 'sold', 'invoiced', 'onboarding', 'onboarding_review', 'fulfilment', 'retention', 'completed_lost'));

alter table public.work_items drop constraint if exists work_items_lifecycle_phase_check;
alter table public.work_items add constraint work_items_lifecycle_phase_check
    check (
        (area = 'admin' and lifecycle_phase is null)
        or
        (area = 'workspace' and lifecycle_phase in ('lead', 'nurturing', 'potential_client', 'sold', 'invoiced', 'onboarding', 'onboarding_review', 'fulfilment', 'retention', 'completed_lost'))
    );

update public.work_items
set workflow_action = 'sell_client', title = 'Sell Client', updated_at = now()
where native_kind = 'relationship_workflow'
  and lifecycle_phase = 'potential_client'
  and workflow_action = 'send_invoice'
  and status not in ('done', 'canceled');

create or replace function public.default_onboarding_payment_gate()
returns jsonb
language sql
immutable
set search_path = public
as $$
    select jsonb_build_object(
        'id', '00000000-0000-4000-8000-000000000100',
        'schemaVersion', 2,
        'steps', jsonb_build_array(jsonb_build_object(
            'id', '00000000-0000-4000-8000-000000000101',
            'key', 'payment',
            'blocks', jsonb_build_array(
                jsonb_build_object('id','00000000-0000-4000-8000-000000000102','name','Header block','kind','header','title','Payment','description','Complete payment securely with Stripe to begin your onboarding.','estimatedTime','2 minutes','showComposedModuleSummary',false,'layout',jsonb_build_object('width','standard','alignment','left','spacingBefore','normal','spacingAfter','normal')),
                jsonb_build_object('id','00000000-0000-4000-8000-000000000103','name','Estimated time','kind','estimate','estimatedTime','2 minutes','layout',jsonb_build_object('width','standard','alignment','left','spacingBefore','compact','spacingAfter','compact')),
                jsonb_build_object('id','00000000-0000-4000-8000-000000000104','name','Pay button','kind','button','label','Pay securely','url','https://checkout.stripe.com/','required',true,'appearance','primary','layout',jsonb_build_object('width','wide','alignment','left','spacingBefore','normal','spacingAfter','normal'))
            ),
            'navigation', jsonb_build_object('backLabel','Back','continueLabel','Continue')
        ))
    );
$$;

-- Published assignments remain immutable after creation. The foundation
-- trigger originally allowed only service_role to perform the initial insert,
-- but migration backfills execute as the database owner (postgres). Permit
-- that equally trusted owner to create a new published revision's assignment
-- snapshot without permitting either role to change or remove it afterwards.
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
        if tg_op = 'INSERT' and current_user in ('service_role', 'postgres') then return new; end if;
        raise exception 'Published onboarding configuration assignments are immutable';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare
    v_previous public.onboarding_configuration_revisions%rowtype;
    v_revision_id uuid;
    v_revision_number integer;
    v_definition jsonb;
begin
    for v_previous in
        select distinct on (workspace_id) *
        from public.onboarding_configuration_revisions
        where configuration_type = 'mandatory_modules' and status = 'published'
        order by workspace_id, revision_number desc
    loop
        if v_previous.definition ? 'payment_gate' then continue; end if;
        select coalesce(max(revision_number), 0) + 1 into v_revision_number
        from public.onboarding_configuration_revisions
        where workspace_id = v_previous.workspace_id and configuration_type = 'mandatory_modules';
        v_revision_id := gen_random_uuid();
        v_definition := v_previous.definition || jsonb_build_object('payment_gate', public.default_onboarding_payment_gate());
        insert into public.onboarding_configuration_revisions (
            id, workspace_id, configuration_type, whatsapp_enabled, revision_number,
            status, definition, definition_hash, created_by, updated_by,
            published_by, published_at
        ) values (
            v_revision_id, v_previous.workspace_id, 'mandatory_modules', v_previous.whatsapp_enabled,
            v_revision_number, 'published', v_definition,
            encode(extensions.digest(convert_to(v_definition::text, 'UTF8'), 'sha256'), 'hex'),
            v_previous.created_by, v_previous.updated_by, v_previous.published_by, now()
        );
        insert into public.onboarding_configuration_revision_modules (workspace_id, configuration_revision_id, module_id, sort_order)
        select v_previous.workspace_id, v_revision_id, module_id, sort_order
        from public.onboarding_configuration_revision_modules
        where workspace_id = v_previous.workspace_id and configuration_revision_id = v_previous.id
        order by sort_order;
    end loop;
end;
$$;

create or replace function public.save_published_onboarding_payment_gate(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_payment_gate jsonb
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
        raise exception using errcode = '42501', message = 'Published Payment may only be changed by trusted server actions';
    end if;
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    if jsonb_typeof(p_payment_gate) <> 'object' or p_payment_gate->>'id' <> '00000000-0000-4000-8000-000000000100' then
        raise exception using errcode = '22023', message = 'The fixed Payment definition is invalid';
    end if;
    select * into v_previous from public.onboarding_configuration_revisions
    where workspace_id = p_workspace_id and configuration_type = 'mandatory_modules' and status = 'published'
    order by revision_number desc limit 1 for update;
    if v_previous.id is null then raise exception 'Publish mandatory onboarding settings before Payment'; end if;
    select coalesce(max(revision_number), 0) + 1 into v_revision_number
    from public.onboarding_configuration_revisions
    where workspace_id = p_workspace_id and configuration_type = 'mandatory_modules';
    v_definition := v_previous.definition || jsonb_build_object('payment_gate', p_payment_gate);
    insert into public.onboarding_configuration_revisions (
        workspace_id, configuration_type, whatsapp_enabled, revision_number,
        status, definition, definition_hash, created_by, updated_by,
        published_by, published_at
    ) values (
        p_workspace_id, 'mandatory_modules', v_previous.whatsapp_enabled,
        v_revision_number, 'published', v_definition,
        encode(extensions.digest(convert_to(v_definition::text, 'UTF8'), 'sha256'), 'hex'),
        p_actor_user_id, p_actor_user_id, p_actor_user_id, now()
    ) returning id into v_revision_id;
    insert into public.onboarding_configuration_revision_modules (workspace_id, configuration_revision_id, module_id, sort_order)
    select p_workspace_id, v_revision_id, module_id, sort_order
    from public.onboarding_configuration_revision_modules
    where workspace_id = p_workspace_id and configuration_revision_id = v_previous.id
    order by sort_order;
    return jsonb_build_object('configuration_revision_id', v_revision_id, 'revision_number', v_revision_number);
end;
$$;

create or replace function public.publish_visual_onboarding_release_v3(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_expected_document_version bigint,
    p_modules jsonb,
    p_bookends jsonb,
    p_theme jsonb,
    p_payment_gate jsonb,
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
declare v_result jsonb;
begin
    v_result := public.publish_visual_onboarding_release(
        p_workspace_id, p_actor_user_id, p_expected_document_version,
        p_modules, p_bookends, p_theme, p_apply_to_active, p_explanation,
        p_release_id, p_idempotency_key
    );
    if p_payment_gate is not null then
        perform public.save_published_onboarding_payment_gate(p_workspace_id, p_actor_user_id, p_payment_gate);
    end if;
    return v_result;
end;
$$;

create or replace function public.prepare_confirmed_onboarding_session(
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
    v_result jsonb;
    v_relationship_id uuid;
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Confirmed onboarding may only be created by trusted automation';
    end if;
    select * into v_sale from public.client_sales
    where workspace_id = p_workspace_id and id = p_sale_id for update;
    if v_sale.id is null then raise exception 'SALE_NOT_FOUND: Client sale does not belong to this workspace'; end if;
    if v_sale.checkout_flow <> 'onboarding_payment_gate' then raise exception 'SALE_FLOW_INVALID: This sale does not use the onboarding Payment gate'; end if;
    if v_sale.status not in ('sold_awaiting_whatsapp_confirm', 'onboarding_payment_pending', 'onboarding_link_failed', 'onboarding_link_sent') then
        raise exception 'SALE_NOT_CONFIRMED: WhatsApp confirmation must happen before onboarding is prepared';
    end if;
    v_relationship_id := v_sale.relationship_id;
    update public.client_sales set status = 'paid', updated_at = now()
    where workspace_id = p_workspace_id and id = p_sale_id;
    v_result := public.create_paid_onboarding_session(p_workspace_id, p_sale_id, p_correlation_id, p_idempotency_key || ':compose');
    update public.client_sales set status = 'onboarding_payment_pending', updated_at = now()
    where workspace_id = p_workspace_id and id = p_sale_id;
    update public.relationships set lifecycle_phase = 'sold', started_onboarding_at = null, updated_at = now()
    where workspace_id = p_workspace_id and id = v_relationship_id;
    update public.work_items set status = 'todo', actual_start_at = null, actual_start_has_time = false,
        actual_completed_at = null, actual_completed_has_time = false, updated_at = now()
    where workspace_id = p_workspace_id and native_kind = 'relationship_workflow'
      and native_key = v_relationship_id::text || ':onboarding';
    update public.work_items set status = 'todo', actual_start_at = null, actual_start_has_time = false,
        actual_completed_at = null, actual_completed_has_time = false, updated_at = now()
    where workspace_id = p_workspace_id and native_kind = 'onboarding_step'
      and metadata->>'session_id' = v_result->>'session_id';
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.session.payment_locked',
        'Confirmed onboarding session created behind Payment',
        p_entity_type => 'onboarding_session', p_entity_id => v_result->>'session_id',
        p_actor_kind => 'automation', p_correlation_id => coalesce(p_correlation_id, gen_random_uuid()),
        p_idempotency_key => p_idempotency_key || ':payment-locked',
        p_metadata => jsonb_build_object('sale_id', p_sale_id, 'relationship_id', v_relationship_id)
    );
    return v_result;
end;
$$;

revoke all on function public.default_onboarding_payment_gate() from public, anon, authenticated;
revoke all on function public.save_published_onboarding_payment_gate(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.publish_visual_onboarding_release_v3(uuid, uuid, bigint, jsonb, jsonb, jsonb, jsonb, boolean, text, uuid, text) from public, anon, authenticated;
revoke all on function public.prepare_confirmed_onboarding_session(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.default_onboarding_payment_gate() to service_role;
grant execute on function public.save_published_onboarding_payment_gate(uuid, uuid, jsonb) to service_role;
grant execute on function public.publish_visual_onboarding_release_v3(uuid, uuid, bigint, jsonb, jsonb, jsonb, jsonb, boolean, text, uuid, text) to service_role;
grant execute on function public.prepare_confirmed_onboarding_session(uuid, uuid, uuid, text) to service_role;
