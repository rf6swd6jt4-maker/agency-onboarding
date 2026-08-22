-- Test relationships exercise the real post-onboarding client experience.
-- Provision and deliver their portal link through the same durable outbox as
-- other relationships instead of suppressing the delivery after provisioning.
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

    if portal_session.status <> 'active' then return new; end if;

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
