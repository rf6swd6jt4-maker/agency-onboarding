-- Recoverable clean cutover to per-service upfront plus recurring billing.
-- Legacy sale records are retired instead of physically destroyed.

create temporary table billing_cutover_relationships on commit drop as
select distinct workspace_id, relationship_id
from public.client_sales
where relationship_id is not null and deleted_at is null;

update public.client_sales
set status = 'retired_billing_model',
    deleted_at = coalesce(deleted_at, now()),
    stripe_checkout_url = null,
    stripe_checkout_expires_at = null,
    updated_at = now()
where deleted_at is null;

update public.relationship_onboarding_sessions session
set status = 'archived',
    archived_at = coalesce(archived_at, now()),
    updated_at = now()
where source_sale_id in (select id from public.client_sales where status = 'retired_billing_model');

update public.work_items item
set status = 'canceled', updated_at = now()
where native_kind = 'onboarding_step'
and metadata->>'session_id' in (
    select id::text from public.relationship_onboarding_sessions
    where source_sale_id in (select id from public.client_sales where status = 'retired_billing_model')
);

update public.relationships relationship
set lifecycle_phase = 'potential_client', started_onboarding_at = null, updated_at = now()
from billing_cutover_relationships affected
where relationship.workspace_id = affected.workspace_id
and relationship.id = affected.relationship_id
and relationship.status <> 'archived';

update public.work_items item
set status = case when item.lifecycle_phase = 'potential_client' then 'doing' else 'todo' end,
    actual_start_at = case when item.lifecycle_phase = 'potential_client' then now() else null end,
    actual_start_has_time = item.lifecycle_phase = 'potential_client',
    actual_completed_at = null,
    actual_completed_has_time = false,
    updated_at = now()
from billing_cutover_relationships affected
where item.workspace_id = affected.workspace_id
  and item.native_kind = 'relationship_workflow'
  and item.metadata->>'relationship_id' = affected.relationship_id::text
  and item.lifecycle_phase in ('potential_client', 'sold', 'invoiced', 'onboarding', 'onboarding_review', 'fulfilment', 'retention');

alter table public.onboarding_service_revisions
    add column if not exists default_upfront_price_cents integer not null default 0 check (default_upfront_price_cents >= 0),
    add column if not exists default_recurring_price_cents integer not null default 0 check (default_recurring_price_cents >= 0);
update public.onboarding_service_revisions
set default_upfront_price_cents = default_price_cents
where default_upfront_price_cents = 0 and default_price_cents > 0;

create or replace function public.set_onboarding_service_revision_dual_prices()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    begin
        new.default_upfront_price_cents := coalesce(
            nullif(new.definition->>'defaultUpfrontPriceCents', '')::integer,
            new.default_price_cents,
            0
        );
        new.default_recurring_price_cents := coalesce(
            nullif(new.definition->>'defaultRecurringPriceCents', '')::integer,
            0
        );
    exception when others then
        raise exception using errcode = '22023', message = 'Service default prices must be non-negative whole cents';
    end;
    if new.default_upfront_price_cents < 0 or new.default_recurring_price_cents < 0 then
        raise exception using errcode = '22023', message = 'Service default prices must be non-negative whole cents';
    end if;
    -- The deprecated single-price column remains populated only for rolling
    -- database compatibility; new application code never reads it.
    new.default_price_cents := new.default_upfront_price_cents;
    return new;
end;
$$;

drop trigger if exists set_onboarding_service_revision_dual_prices on public.onboarding_service_revisions;
create trigger set_onboarding_service_revision_dual_prices
before insert on public.onboarding_service_revisions
for each row execute function public.set_onboarding_service_revision_dual_prices();

alter table public.relationship_services
    add column if not exists upfront_price_cents integer not null default 0 check (upfront_price_cents >= 0),
    add column if not exists recurring_price_cents integer not null default 0 check (recurring_price_cents >= 0);
update public.relationship_services
set upfront_price_cents = coalesce(price_cents, 0)
where upfront_price_cents = 0 and coalesce(price_cents, 0) > 0;

alter table public.client_sale_items
    add column if not exists upfront_amount_cents integer not null default 0 check (upfront_amount_cents >= 0),
    add column if not exists recurring_amount_cents integer not null default 0 check (recurring_amount_cents >= 0);

alter table public.client_sales
    add column if not exists upfront_total_amount integer not null default 0 check (upfront_total_amount >= 0),
    add column if not exists recurring_total_amount integer not null default 0 check (recurring_total_amount >= 0);

create or replace function public.save_relationship_dual_pricing_configuration(
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
    v_seller_id uuid;
    v_manager_id uuid;
    v_timeframe integer;
    v_upfront integer;
    v_recurring integer;
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Relationship commercial details may only be changed by trusted server actions';
    end if;
    if not exists (
        select 1 from public.workspace_memberships
        where workspace_id = p_workspace_id and user_id = p_actor_user_id
    ) then
        raise exception using errcode = '42501', message = 'Actor does not belong to this workspace';
    end if;
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
        'upfront_price_cents', selected.upfront_price_cents,
        'recurring_price_cents', selected.recurring_price_cents,
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
        'upfront_price_cents', coalesce((entry->>'upfront_price_cents')::integer, 0),
        'recurring_price_cents', coalesce((entry->>'recurring_price_cents')::integer, 0),
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
      and sale.status <> 'draft'
    order by sale.created_at desc limit 1
    for update;
    if v_locked_sale_id is not null and v_commercial_changed then
        raise exception using errcode = 'P0001', message = 'This sale is already frozen. Create a replacement sale before changing services or negotiated prices';
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

    for v_service in select value from jsonb_array_elements(coalesce(p_services, '[]'::jsonb)) loop
        if coalesce(v_service->>'upfront_price_cents', '') !~ '^[0-9]+$'
           or coalesce(v_service->>'recurring_price_cents', '') !~ '^[0-9]+$'
           or upper(coalesce(v_service->>'currency', '')) !~ '^[A-Z]{3}$'
           or nullif(v_service->>'service_id', '') is null
           or nullif(v_service->>'service_revision_id', '') is null then
            raise exception using errcode = '22023', message = 'Every relationship service needs a version, non-negative prices, and three-letter currency';
        end if;
        v_upfront := (v_service->>'upfront_price_cents')::integer;
        v_recurring := (v_service->>'recurring_price_cents')::integer;
        if v_upfront = 0 and v_recurring = 0 then
            raise exception using errcode = '22023', message = 'Every selected service needs an upfront or recurring price';
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
        primary_person_name = case when p_details ? 'primary_person_name' then p_details->>'primary_person_name' else primary_person_name end,
        business_name = case when p_details ? 'business_name' then nullif(trim(p_details->>'business_name'), '') else business_name end,
        primary_contact_role = case when p_details ? 'primary_contact_role' then nullif(trim(p_details->>'primary_contact_role'), '') else primary_contact_role end,
        primary_phone = case when p_details ? 'primary_phone' then nullif(trim(p_details->>'primary_phone'), '') else primary_phone end,
        primary_email = case when p_details ? 'primary_email' then nullif(trim(p_details->>'primary_email'), '') else primary_email end,
        notes_summary = case when p_details ? 'description' then nullif(trim(p_details->>'description'), '') else notes_summary end,
        updated_at = now()
    where workspace_id = p_workspace_id and id = p_relationship_id;

    if v_commercial_changed then
        delete from public.relationship_services
        where workspace_id = p_workspace_id and relationship_id = p_relationship_id;
        for v_service in select value from jsonb_array_elements(coalesce(p_services, '[]'::jsonb)) loop
            v_upfront := (v_service->>'upfront_price_cents')::integer;
            v_recurring := (v_service->>'recurring_price_cents')::integer;
            insert into public.relationship_services (
                workspace_id, relationship_id, service_key, price_cents,
                upfront_price_cents, recurring_price_cents, currency,
                assignee_user_id, service_id, service_revision_id
            ) values (
                p_workspace_id, p_relationship_id, v_service->>'service_key', v_upfront + v_recurring,
                v_upfront, v_recurring, upper(v_service->>'currency'),
                nullif(v_service->>'assignee_user_id', '')::uuid,
                (v_service->>'service_id')::uuid,
                (v_service->>'service_revision_id')::uuid
            );
        end loop;
    end if;

    perform public.record_workspace_admin_activity(
        p_workspace_id, 'services', 'services.relationship_assignments.changed',
        'Relationship commercial configuration saved',
        p_entity_type => 'relationship', p_entity_id => p_relationship_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_correlation_id => gen_random_uuid(),
        p_idempotency_key => format(
            'services.relationship.dual_prices:%s:%s:%s',
            p_relationship_id, extract(epoch from clock_timestamp())::bigint, p_actor_user_id
        ),
        p_metadata => jsonb_build_object(
            'relationship_id', p_relationship_id,
            'service_count', jsonb_array_length(coalesce(p_services, '[]'::jsonb)),
            'commercial_changed', v_commercial_changed,
            'locked_sale_id', v_locked_sale_id
        )
    );
    return jsonb_build_object(
        'relationship_id', p_relationship_id,
        'service_count', jsonb_array_length(coalesce(p_services, '[]'::jsonb)),
        'commercial_changed', v_commercial_changed
    );
end;
$$;

revoke all on function public.save_relationship_dual_pricing_configuration(uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_relationship_dual_pricing_configuration(uuid, uuid, uuid, jsonb, jsonb) to service_role;
revoke all on function public.save_relationship_commercial_configuration(uuid, uuid, uuid, jsonb, jsonb) from service_role;

revoke all on function public.reopen_voided_client_sale(uuid, uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.reopen_expired_recurring_checkout(uuid, uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.record_stripe_invoice_status_event(uuid, text, text, text, text, text, jsonb) from public, anon, authenticated, service_role;
