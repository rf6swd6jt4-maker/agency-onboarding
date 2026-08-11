-- Module removal keeps published definitions available to frozen sessions while
-- removing them from all future compositions. Unpublished modules can be erased.
create or replace function public.remove_onboarding_module(
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
    v_was_published boolean;
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Onboarding modules may only be removed by trusted server actions';
    end if;
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);

    if not exists (
        select 1 from public.onboarding_modules
        where workspace_id = p_workspace_id and id = p_module_id
    ) then
        raise exception 'Onboarding module not found';
    end if;

    select exists (
        select 1 from public.onboarding_module_revisions
        where workspace_id = p_workspace_id
          and module_id = p_module_id
          and status = 'published'
    ) into v_was_published;

    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding',
        case when v_was_published then 'onboarding.module.archived' else 'onboarding.module.draft_deleted' end,
        case when v_was_published then 'Onboarding module removed from future onboarding' else 'Unpublished onboarding module deleted' end,
        p_entity_type => 'onboarding_module', p_entity_id => p_module_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_idempotency_key => format('onboarding.module.removed:%s', p_module_id)
    );

    if v_was_published then
        update public.onboarding_modules
        set status = 'archived', archived_at = now(), updated_at = now()
        where workspace_id = p_workspace_id and id = p_module_id;
        return jsonb_build_object('module_id', p_module_id, 'removed', true, 'mode', 'archived');
    end if;

    delete from public.onboarding_modules
    where workspace_id = p_workspace_id and id = p_module_id;
    return jsonb_build_object('module_id', p_module_id, 'removed', true, 'mode', 'deleted');
end;
$$;

revoke all on function public.remove_onboarding_module(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_onboarding_module(uuid, uuid, uuid) to service_role;

-- Scaylup is the only workspace whose existing onboarding catalogue is a real
-- agency configuration. Remove seeded onboarding/catalogue state everywhere
-- else so new agencies begin with a genuinely blank Builder.
do $$
declare
    v_scaylup_count integer;
begin
    select count(*) into v_scaylup_count from public.workspaces where slug = 'scaylup';
    if v_scaylup_count <> 1 then
        raise exception 'Expected exactly one Scaylup workspace; refusing onboarding cleanup';
    end if;

    create temporary table onboarding_cleanup_workspaces on commit drop as
    select id from public.workspaces where slug <> 'scaylup';

    update public.client_sales sale
    set configuration_revision_id = null,
        welcome_revision_id = null,
        completion_revision_id = null,
        onboarding_session_id = null,
        composition_hash = null,
        snapshot_frozen_at = null
    where sale.workspace_id in (select id from onboarding_cleanup_workspaces);

    delete from public.client_sale_composition_items item where item.workspace_id in (select id from onboarding_cleanup_workspaces);
    delete from public.client_sale_items item where item.workspace_id in (select id from onboarding_cleanup_workspaces);
    delete from public.relationship_onboarding_sessions session where session.workspace_id in (select id from onboarding_cleanup_workspaces);
    delete from public.onboarding_storage_cleanup_outbox cleanup where cleanup.workspace_id in (select id from onboarding_cleanup_workspaces);
    delete from public.relationship_services service where service.workspace_id in (select id from onboarding_cleanup_workspaces);
    delete from public.onboarding_visual_preview_tokens preview where preview.workspace_id in (select id from onboarding_cleanup_workspaces);
    delete from public.onboarding_preview_tokens preview where preview.workspace_id in (select id from onboarding_cleanup_workspaces);
    delete from public.onboarding_builder_updates update_row where update_row.workspace_id in (select id from onboarding_cleanup_workspaces);
    delete from public.onboarding_builder_documents document where document.workspace_id in (select id from onboarding_cleanup_workspaces);

    alter table public.onboarding_module_revisions disable trigger prevent_published_onboarding_module_revision_mutation;
    alter table public.onboarding_configuration_revisions disable trigger prevent_published_onboarding_configuration_revision_mutation;
    alter table public.onboarding_service_revisions disable trigger prevent_onboarding_service_revision_mutation;
    alter table public.onboarding_service_revision_modules disable trigger prevent_onboarding_service_assignment_mutation;
    alter table public.onboarding_configuration_revision_modules disable trigger prevent_published_onboarding_configuration_assignment_mutation;

    delete from public.onboarding_configuration_revision_modules assignment where assignment.workspace_id in (select id from onboarding_cleanup_workspaces);
    delete from public.onboarding_service_revision_modules assignment where assignment.workspace_id in (select id from onboarding_cleanup_workspaces);
    delete from public.onboarding_configuration_revisions revision where revision.workspace_id in (select id from onboarding_cleanup_workspaces);
    delete from public.onboarding_service_revisions revision where revision.workspace_id in (select id from onboarding_cleanup_workspaces);
    delete from public.onboarding_services service where service.workspace_id in (select id from onboarding_cleanup_workspaces);
    delete from public.onboarding_module_revisions revision where revision.workspace_id in (select id from onboarding_cleanup_workspaces);
    delete from public.onboarding_modules module where module.workspace_id in (select id from onboarding_cleanup_workspaces);
    delete from public.onboarding_theme_revisions revision where revision.workspace_id in (select id from onboarding_cleanup_workspaces);
    delete from public.onboarding_themes theme where theme.workspace_id in (select id from onboarding_cleanup_workspaces);
    delete from public.onboarding_brand_swatches swatch where swatch.workspace_id in (select id from onboarding_cleanup_workspaces);

    alter table public.onboarding_module_revisions enable trigger prevent_published_onboarding_module_revision_mutation;
    alter table public.onboarding_configuration_revisions enable trigger prevent_published_onboarding_configuration_revision_mutation;
    alter table public.onboarding_service_revisions enable trigger prevent_onboarding_service_revision_mutation;
    alter table public.onboarding_service_revision_modules enable trigger prevent_onboarding_service_assignment_mutation;
    alter table public.onboarding_configuration_revision_modules enable trigger prevent_published_onboarding_configuration_assignment_mutation;
end;
$$;
