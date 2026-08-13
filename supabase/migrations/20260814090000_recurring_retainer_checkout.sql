-- Relationship-specific recurring retainers use Stripe Checkout subscriptions.
-- The first paid subscription invoice enters the existing onboarding workflow;
-- later renewals remain billing updates on the same frozen sale snapshot.

alter table public.client_sales
    add column if not exists billing_model text not null default 'one_off',
    add column if not exists billing_interval text,
    add column if not exists billing_interval_count integer,
    add column if not exists stripe_checkout_session_id text,
    add column if not exists stripe_checkout_url text,
    add column if not exists stripe_checkout_status text,
    add column if not exists stripe_checkout_expires_at timestamptz,
    add column if not exists stripe_subscription_id text,
    add column if not exists stripe_subscription_status text,
    add column if not exists checkout_email_sent_at timestamptz,
    add column if not exists initial_payment_received_at timestamptz,
    add column if not exists latest_payment_at timestamptz,
    add column if not exists latest_invoice_id text,
    add column if not exists latest_invoice_status text;

alter table public.client_sales
    drop constraint if exists client_sales_billing_model_check,
    add constraint client_sales_billing_model_check
        check (billing_model in ('one_off', 'recurring')),
    drop constraint if exists client_sales_billing_interval_check,
    add constraint client_sales_billing_interval_check
        check (billing_interval is null or billing_interval in ('week', 'month', 'year')),
    drop constraint if exists client_sales_recurring_schedule_check,
    add constraint client_sales_recurring_schedule_check
        check (
            (billing_model = 'one_off' and billing_interval is null and billing_interval_count is null)
            or
            (billing_model = 'recurring' and (
                (billing_interval = 'week' and billing_interval_count between 1 and 156)
                or (billing_interval = 'month' and billing_interval_count between 1 and 36)
                or (billing_interval = 'year' and billing_interval_count between 1 and 3)
            ))
        );

create unique index if not exists client_sales_workspace_checkout_session_unique
on public.client_sales(workspace_id, stripe_checkout_session_id)
where stripe_checkout_session_id is not null;

create index if not exists client_sales_workspace_subscription_idx
on public.client_sales(workspace_id, stripe_subscription_id)
where stripe_subscription_id is not null;

create or replace function public.reopen_expired_recurring_checkout(
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
        raise exception using errcode = '42501', message = 'Recurring checkout replacement may only be opened by trusted server actions';
    end if;
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    select * into v_relationship from public.relationships
    where workspace_id = p_workspace_id and id = p_relationship_id
    for update;
    if v_relationship.id is null then raise exception using errcode = 'P0001', message = 'Relationship not found'; end if;
    select * into v_sale from public.client_sales
    where workspace_id = p_workspace_id and id = p_sale_id
      and relationship_id = p_relationship_id and deleted_at is null
    for update;
    if v_sale.id is null then raise exception using errcode = 'P0001', message = 'Recurring sale not found'; end if;
    if v_sale.billing_model <> 'recurring' or v_sale.stripe_checkout_session_id is null then
        raise exception using errcode = 'P0001', message = 'This sale is not a recurring Checkout request';
    end if;
    if v_sale.onboarding_session_id is not null or v_sale.initial_payment_received_at is not null or v_sale.stripe_subscription_id is not null
       or v_sale.status in (
           'paid', 'test_paid', 'paid_consent_template_sending',
           'paid_awaiting_whatsapp_confirm', 'paid_consent_template_failed',
           'whatsapp_confirmed', 'onboarding_created', 'onboarding_link_sent',
           'onboarding_link_failed'
       ) then
        raise exception using errcode = 'P0001', message = 'A paid or onboarding retainer cannot be expired or replaced';
    end if;
    if not (
        v_sale.status in ('invoice_sent', 'payment_failed')
        or (v_sale.status = 'invoice_inactive' and lower(coalesce(v_sale.stripe_checkout_status, '')) = 'expired')
    ) then
        raise exception using errcode = 'P0001', message = 'Only the current sent, unpaid recurring Checkout request can be replaced';
    end if;

    update public.client_sales
    set status = 'invoice_inactive', stripe_checkout_status = 'expired', updated_at = now()
    where workspace_id = p_workspace_id and id = p_sale_id;
    update public.relationships
    set lifecycle_phase = 'potential_client', updated_at = now()
    where workspace_id = p_workspace_id and id = p_relationship_id;

    update public.work_items
    set status = 'doing', actual_start_at = coalesce(actual_start_at, now()),
        actual_start_has_time = true, actual_completed_at = null,
        actual_completed_has_time = false, updated_at = now()
    where workspace_id = p_workspace_id
      and native_kind = 'relationship_workflow'
      and native_key = p_relationship_id::text || ':potential_client'
    returning id into v_sell_work_id;
    update public.work_items
    set status = 'todo', actual_start_at = null, actual_start_has_time = false,
        actual_completed_at = null, actual_completed_has_time = false, updated_at = now()
    where workspace_id = p_workspace_id
      and native_kind = 'relationship_workflow'
      and native_key = p_relationship_id::text || ':invoiced'
    returning id into v_payment_work_id;

    perform public.record_workspace_admin_activity(
        p_workspace_id, 'billing', 'stripe.checkout.expired_by_staff',
        'Recurring Stripe Checkout request expired by staff',
        p_entity_type => 'stripe_checkout_session', p_entity_id => v_sale.stripe_checkout_session_id,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_correlation_id => v_correlation_id,
        p_idempotency_key => 'stripe.checkout.expired_by_staff:' || p_sale_id::text,
        p_outcome => 'succeeded', p_metric_classification => 'internal_call',
        p_metadata => jsonb_build_object(
            'sale_id', p_sale_id, 'relationship_id', p_relationship_id,
            'previous_sale_status', v_sale.status,
            'provider_summary', public.sanitize_admin_activity_json(coalesce(p_provider_summary, '{}'::jsonb))
        )
    );
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'billing', 'stripe.checkout.replacement_opened',
        'Relationship reopened to prepare a replacement recurring checkout',
        p_entity_type => 'client_sale', p_entity_id => p_sale_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_correlation_id => v_correlation_id,
        p_idempotency_key => 'stripe.checkout.replacement_opened:' || p_sale_id::text,
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

revoke all on function public.reopen_expired_recurring_checkout(uuid, uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.reopen_expired_recurring_checkout(uuid, uuid, uuid, uuid, uuid, jsonb) to service_role;
