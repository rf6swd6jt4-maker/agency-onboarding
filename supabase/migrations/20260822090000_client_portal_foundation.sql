-- Client portal domains, durable relationship access, and completion delivery.

alter table public.workspaces
    add column if not exists custom_client_portal_domain text,
    add column if not exists custom_client_portal_domain_status text not null default 'none'
        check (custom_client_portal_domain_status in ('none', 'pending_dns', 'verified')),
    add column if not exists custom_client_portal_domain_records jsonb not null default '[]'::jsonb
        check (jsonb_typeof(custom_client_portal_domain_records) = 'array'),
    add column if not exists custom_client_portal_domain_verified_at timestamptz,
    add column if not exists custom_client_portal_domain_error text;

create unique index if not exists workspaces_custom_client_portal_domain_unique
on public.workspaces (lower(custom_client_portal_domain))
where custom_client_portal_domain is not null;

create or replace function public.prevent_duplicate_workspace_public_domains()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    requested_domain text;
begin
    if new.custom_onboarding_domain is not null
       and new.custom_client_portal_domain is not null
       and lower(new.custom_onboarding_domain) = lower(new.custom_client_portal_domain) then
        raise exception using errcode = '23505', message = 'Onboarding and client portal domains must be different';
    end if;

    foreach requested_domain in array array[
        lower(new.custom_onboarding_domain),
        lower(new.custom_client_portal_domain)
    ] loop
        if requested_domain is null then continue; end if;
        perform pg_advisory_xact_lock(hashtextextended(requested_domain, 0));
        if exists (
            select 1
            from public.workspaces workspace
            where workspace.id <> new.id
              and (
                  lower(workspace.custom_onboarding_domain) = requested_domain
                  or lower(workspace.custom_client_portal_domain) = requested_domain
              )
        ) then
            raise exception using errcode = '23505', message = 'This public domain is already assigned to another workspace';
        end if;
    end loop;
    return new;
end;
$$;

drop trigger if exists prevent_duplicate_workspace_public_domains on public.workspaces;
create trigger prevent_duplicate_workspace_public_domains
before insert or update of custom_onboarding_domain, custom_client_portal_domain
on public.workspaces
for each row execute function public.prevent_duplicate_workspace_public_domains();

create or replace function public.resolve_workspace_public_domain(requested_domain text)
returns table (workspace_slug text, domain_status text, surface text)
language sql
stable
security definer
set search_path = public
as $$
    select workspace.slug, resolved.domain_status, resolved.surface
    from public.workspaces workspace
    cross join lateral (
        values
            (workspace.custom_onboarding_domain, workspace.custom_onboarding_domain_status, 'onboarding'::text),
            (workspace.custom_client_portal_domain, workspace.custom_client_portal_domain_status, 'client_portal'::text)
    ) as resolved(domain_name, domain_status, surface)
    where workspace.status = 'active'
      and resolved.domain_name is not null
      and lower(resolved.domain_name) = lower(trim(requested_domain))
    limit 1;
$$;

revoke all on function public.resolve_workspace_public_domain(text) from public;
grant execute on function public.resolve_workspace_public_domain(text) to anon, authenticated;

create table if not exists public.client_portal_sessions (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null,
    onboarding_session_id uuid,
    session_token text not null unique check (session_token ~ '^[a-f0-9]{64}$'),
    status text not null default 'active' check (status in ('active', 'revoked')),
    token_revoked_at timestamptz,
    last_accessed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (workspace_id, id),
    unique (workspace_id, relationship_id),
    foreign key (workspace_id, relationship_id)
        references public.relationships(workspace_id, id) on delete cascade,
    foreign key (workspace_id, onboarding_session_id)
        references public.relationship_onboarding_sessions(workspace_id, id) on delete restrict,
    check (
        (status = 'active' and token_revoked_at is null)
        or (status = 'revoked' and token_revoked_at is not null)
    )
);

create index if not exists client_portal_sessions_relationship_idx
on public.client_portal_sessions(workspace_id, relationship_id);

drop trigger if exists client_portal_sessions_updated_at on public.client_portal_sessions;
create trigger client_portal_sessions_updated_at
before update on public.client_portal_sessions
for each row execute function public.set_updated_at();

alter table public.client_portal_sessions enable row level security;

drop policy if exists "workspace members read client portal sessions" on public.client_portal_sessions;
create policy "workspace members read client portal sessions"
on public.client_portal_sessions for select
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace admins manage client portal sessions" on public.client_portal_sessions;
create policy "workspace admins manage client portal sessions"
on public.client_portal_sessions for all
using (public.is_workspace_member(workspace_id, array['owner','admin']))
with check (public.is_workspace_member(workspace_id, array['owner','admin']));

-- Existing completed relationships receive portal access without sending stale
-- completion messages. New completions are provisioned by the trigger below.
insert into public.client_portal_sessions (
    workspace_id, relationship_id, onboarding_session_id, session_token
)
select distinct on (session.workspace_id, session.relationship_id)
    session.workspace_id,
    session.relationship_id,
    session.id,
    encode(extensions.gen_random_bytes(32), 'hex')
from public.relationship_onboarding_sessions session
where session.status = 'completed'
order by session.workspace_id, session.relationship_id,
    session.completed_at desc nulls last, session.updated_at desc, session.id
on conflict (workspace_id, relationship_id) do nothing;

alter table public.onboarding_delivery_outbox
    add column if not exists portal_session_id uuid;

alter table public.onboarding_delivery_outbox
    drop constraint if exists onboarding_delivery_outbox_kind_check;
alter table public.onboarding_delivery_outbox
    add constraint onboarding_delivery_outbox_kind_check
        check (kind in ('onboarding_link', 'module_update', 'client_portal_link'));

alter table public.onboarding_delivery_outbox
    drop constraint if exists onboarding_delivery_outbox_portal_session_workspace_fkey;
alter table public.onboarding_delivery_outbox
    add constraint onboarding_delivery_outbox_portal_session_workspace_fkey
        foreign key (workspace_id, portal_session_id)
        references public.client_portal_sessions(workspace_id, id) on delete cascade;

create or replace function public.provision_client_portal_after_onboarding()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    portal_session public.client_portal_sessions%rowtype;
    relationship_record public.relationships%rowtype;
    delivery_outbox_id uuid;
begin
    if new.status <> 'completed' or old.status = 'completed' then return new; end if;

    insert into public.client_portal_sessions (
        workspace_id, relationship_id, onboarding_session_id, session_token
    ) values (
        new.workspace_id,
        new.relationship_id,
        new.id,
        encode(extensions.gen_random_bytes(32), 'hex')
    )
    on conflict (workspace_id, relationship_id) do update set
        onboarding_session_id = excluded.onboarding_session_id,
        updated_at = now()
    returning * into portal_session;

    if portal_session.status <> 'active' or coalesce(new.is_test, false) then return new; end if;

    select * into relationship_record
    from public.relationships
    where workspace_id = new.workspace_id and id = new.relationship_id;

    insert into public.onboarding_delivery_outbox (
        workspace_id,
        relationship_id,
        session_id,
        portal_session_id,
        correlation_id,
        kind,
        destination,
        payload,
        idempotency_key
    ) values (
        new.workspace_id,
        new.relationship_id,
        new.id,
        portal_session.id,
        coalesce(new.source_sale_id, new.id),
        'client_portal_link',
        coalesce(nullif(trim(relationship_record.primary_phone), ''), 'relationship:' || new.relationship_id::text),
        jsonb_build_object(
            'client_id', relationship_record.client_id,
            'message', 'Your client portal is ready.'
        ),
        'client-portal-link:' || new.id::text
    )
    on conflict (workspace_id, idempotency_key) do nothing
    returning id into delivery_outbox_id;

    if delivery_outbox_id is not null then
        perform public.record_workspace_admin_activity(
            new.workspace_id,
            'communications',
            'client_portal.link.queued',
            'Client portal link queued for delivery',
            p_entity_type => 'client_portal_session',
            p_entity_id => portal_session.id::text,
            p_actor_kind => 'automation',
            p_correlation_id => coalesce(new.source_sale_id, new.id),
            p_idempotency_key => 'client_portal.link.queued:' || delivery_outbox_id::text,
            p_metadata => jsonb_build_object(
                'outbox_id', delivery_outbox_id,
                'relationship_id', new.relationship_id,
                'onboarding_session_id', new.id,
                'portal_session_id', portal_session.id
            )
        );
    end if;

    return new;
end;
$$;

drop trigger if exists provision_client_portal_after_onboarding on public.relationship_onboarding_sessions;
create trigger provision_client_portal_after_onboarding
after update of status on public.relationship_onboarding_sessions
for each row
when (new.status = 'completed' and old.status is distinct from new.status)
execute function public.provision_client_portal_after_onboarding();

-- Extend the existing delivery finalizer so portal deliveries retain accurate
-- Activity and recovery-work semantics while sharing the proven queue.
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
    v_is_portal boolean;
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
    v_is_portal := v_outbox.kind = 'client_portal_link';
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
            p_workspace_id,
            'communications',
            case when v_is_portal then 'client_portal.link.sent' else 'onboarding.link.sent' end,
            case
                when v_is_portal then 'Client portal link sent through connected messaging'
                when v_outbox.kind = 'module_update' then 'Onboarding module update sent through connected messaging'
                else 'Onboarding link sent through connected messaging'
            end,
            p_entity_type => case when v_is_portal then 'client_portal_session' else 'onboarding_session' end,
            p_entity_id => coalesce(v_outbox.portal_session_id, v_outbox.session_id)::text,
            p_actor_kind => 'automation', p_correlation_id => v_outbox.correlation_id,
            p_idempotency_key => format('onboarding.delivery.sent:%s:%s', v_outbox.id, v_outbox.attempt_count),
            p_outcome => 'succeeded', p_metric_classification => 'internal_call',
            p_metadata => jsonb_build_object(
                'outbox_id', v_outbox.id, 'relationship_id', v_outbox.relationship_id,
                'sale_id', v_sale_id, 'kind', v_outbox.kind, 'attempt_count', v_outbox.attempt_count,
                'portal_session_id', v_outbox.portal_session_id,
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
        error = left(coalesce(nullif(trim(p_error_summary), ''), case when v_is_portal then 'Client portal link delivery failed' else 'Onboarding delivery failed' end), 1000)
    where workspace_id = p_workspace_id
      and raw_payload @> jsonb_build_object('outbox_id', v_outbox.id);

    if v_outbox.relationship_id is not null then
        insert into public.work_items (
            workspace_id, title, description, lifecycle_phase, status, priority,
            is_key_task, native_kind, native_key, area, kind, visibility,
            metadata, created_by
        ) values (
            p_workspace_id,
            case when v_is_portal then 'Restore client portal link delivery' else 'Restore onboarding message delivery' end,
            case when v_is_portal
                then 'The client portal link could not be delivered. Check the connected channels, then retry.'
                else 'The client onboarding message could not be delivered. Check the connected channels, then retry.'
            end,
            case when v_is_portal then 'onboarding_review' else 'onboarding' end,
            'todo', 2, true, 'onboarding_delivery_failure',
            'onboarding-delivery:' || v_outbox.id::text, 'workspace', 'standard', 'workspace',
            jsonb_build_object(
                'relationship_id', v_outbox.relationship_id,
                'session_id', v_outbox.session_id,
                'portal_session_id', v_outbox.portal_session_id,
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
        p_workspace_id,
        'communications',
        case when v_is_portal then 'client_portal.link.failed' else 'onboarding.link.failed' end,
        case when v_is_portal then 'Client portal link delivery failed' else 'Onboarding message delivery failed' end,
        p_level => 'error',
        p_entity_type => case when v_is_portal then 'client_portal_session' else 'onboarding_session' end,
        p_entity_id => coalesce(v_outbox.portal_session_id, v_outbox.session_id)::text,
        p_actor_kind => 'automation', p_correlation_id => v_outbox.correlation_id,
        p_idempotency_key => format('onboarding.delivery.failed:%s:%s', v_outbox.id, v_outbox.attempt_count),
        p_outcome => 'failed', p_metric_classification => 'internal_call',
        p_maintenance_work_item_id => null,
        p_metadata => jsonb_build_object(
            'outbox_id', v_outbox.id, 'relationship_id', v_outbox.relationship_id,
            'sale_id', v_sale_id, 'kind', v_outbox.kind, 'attempt_count', v_outbox.attempt_count,
            'portal_session_id', v_outbox.portal_session_id,
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
