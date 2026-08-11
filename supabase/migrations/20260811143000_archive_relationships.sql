create or replace function public.archive_workspace_relationship(
    p_workspace_id uuid,
    p_relationship_id uuid,
    p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_relationship public.relationships%rowtype;
    v_workspace_slug text;
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Relationships may only be archived by trusted server actions';
    end if;
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);

    select * into v_relationship
    from public.relationships
    where workspace_id = p_workspace_id and id = p_relationship_id
    for update;

    if v_relationship.id is null then
        raise exception using errcode = 'P0001', message = 'Relationship not found';
    end if;
    if v_relationship.status = 'archived' then
        return jsonb_build_object('relationship_id', p_relationship_id, 'archived', true, 'idempotent', true);
    end if;

    update public.relationships
    set status = 'archived', lifecycle_phase = 'completed_lost', updated_at = now()
    where workspace_id = p_workspace_id and id = p_relationship_id;

    select slug into v_workspace_slug from public.workspaces where id = p_workspace_id;
    perform public.record_workspace_admin_activity(
        p_workspace_id,
        'relationships',
        'relationship.archived',
        'Relationship archived',
        p_entity_type => 'relationship',
        p_entity_id => p_relationship_id::text,
        p_source_href => format('/%s/relationships/%s', v_workspace_slug, p_relationship_id),
        p_actor_user_id => p_actor_user_id,
        p_actor_kind => 'staff',
        p_idempotency_key => 'relationship.archived:' || p_relationship_id::text,
        p_metadata => jsonb_build_object(
            'previous_status', v_relationship.status,
            'previous_lifecycle_phase', v_relationship.lifecycle_phase
        )
    );

    return jsonb_build_object(
        'relationship_id', p_relationship_id,
        'archived', true,
        'idempotent', false
    );
end;
$$;

revoke all on function public.archive_workspace_relationship(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.archive_workspace_relationship(uuid, uuid, uuid) to service_role;
