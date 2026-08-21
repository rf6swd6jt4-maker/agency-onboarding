-- Guarded Betelgeze account/workspace reset.
--
-- Dry run (mandatory first):
--   psql "$DATABASE_URL" -v execute=false \
--     -v protected_user_id='<uuid>' -v protected_email='jedryszczyk@scaylup.com' \
--     -v protected_username='jedryszczyk' -v scaylup_workspace_id='<uuid>' \
--     -f scripts/reset-account-system-v2.sql
--
-- Execution requires the same identifiers plus:
--   -v execute=true -v confirmation='DELETE ALL BETELGEZE TEST ACCOUNTS'
--
-- This script is intentionally transactional, idempotent, and database-only.
-- It never calls Stripe, R2, Resend, or another external provider.

\set ON_ERROR_STOP on
\if :{?execute}
\else
  \set execute false
\endif
\if :{?protected_user_id}
\else
  \echo 'protected_user_id is required'
  \quit 1
\endif
\if :{?protected_email}
\else
  \echo 'protected_email is required'
  \quit 1
\endif
\if :{?protected_username}
\else
  \echo 'protected_username is required'
  \quit 1
\endif
\if :{?scaylup_workspace_id}
\else
  \echo 'scaylup_workspace_id is required'
  \quit 1
\endif
\if :{?confirmation}
\else
  \set confirmation ''
\endif

begin;
select set_config('betelgeze.reset.protected_user_id', :'protected_user_id', true);
select set_config('betelgeze.reset.protected_email', lower(:'protected_email'), true);
select set_config('betelgeze.reset.protected_username', lower(trim(leading '@' from :'protected_username')), true);
select set_config('betelgeze.reset.workspace_id', :'scaylup_workspace_id', true);
select set_config('betelgeze.reset.confirmation', :'confirmation', true);

do $$
declare
    v_user_count integer;
    v_workspace_count integer;
begin
    select count(*) into v_user_count
    from auth.users u
    join public.user_profiles p on p.user_id = u.id
    where u.id = current_setting('betelgeze.reset.protected_user_id')::uuid
      and lower(u.email) = current_setting('betelgeze.reset.protected_email')
      and lower(p.username) = current_setting('betelgeze.reset.protected_username');
    if v_user_count <> 1 then
        raise exception 'Protected account identity mismatch. Expected one exact UUID/email/username match; found %.', v_user_count;
    end if;

    select count(*) into v_workspace_count
    from public.workspaces
    where id = current_setting('betelgeze.reset.workspace_id')::uuid
      and slug = 'scaylup'
      and name = 'ScaylUp';
    if v_workspace_count <> 1 then
        raise exception 'ScaylUp workspace identity mismatch. Expected one exact UUID/slug/name match; found %.', v_workspace_count;
    end if;
end $$;

create temporary table betelgeze_reset_manifest on commit drop as
select jsonb_build_object(
    'captured_at', now(),
    'protected_user_id', current_setting('betelgeze.reset.protected_user_id'),
    'scaylup_workspace_id', current_setting('betelgeze.reset.workspace_id'),
    'auth_users_before', (select count(*) from auth.users),
    'workspaces_before', (select count(*) from public.workspaces),
    'pending_invitations_before', (select count(*) from public.workspace_invitations where accepted_at is null),
    'users_to_remove', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'email', email)), '[]'::jsonb) from auth.users where id <> current_setting('betelgeze.reset.protected_user_id')::uuid),
    'workspaces_to_remove', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'slug', slug)), '[]'::jsonb) from public.workspaces where id <> current_setting('betelgeze.reset.workspace_id')::uuid),
    'affected_row_counts', jsonb_build_object(
        'user_profiles_removed', (select count(*) from public.user_profiles where user_id <> current_setting('betelgeze.reset.protected_user_id')::uuid),
        'workspace_memberships_removed', (select count(*) from public.workspace_memberships where user_id <> current_setting('betelgeze.reset.protected_user_id')::uuid or workspace_id <> current_setting('betelgeze.reset.workspace_id')::uuid),
        'pending_invitations_removed', (select count(*) from public.workspace_invitations where accepted_at is null),
        'onboarding_sessions_removed', (select count(*) from public.account_onboarding_sessions session join public.workspace_invitations invitation on invitation.id = session.invitation_id where invitation.accepted_at is null),
        'native_messages_removed', (select count(*) from public.workspace_native_messages where sender_user_id <> current_setting('betelgeze.reset.protected_user_id')::uuid),
        'native_reactions_removed', (select count(*) from public.workspace_native_reactions where reactor_user_id <> current_setting('betelgeze.reset.protected_user_id')::uuid),
        'security_events_removed', (select count(*) from public.account_security_events where user_id <> current_setting('betelgeze.reset.protected_user_id')::uuid)
    )
) as manifest;

select manifest as dry_run_manifest from betelgeze_reset_manifest;

select 'external_orphan_review' as report,
       (select count(*) from public.client_sales where workspace_id <> current_setting('betelgeze.reset.workspace_id')::uuid and stripe_invoice_id is not null) as non_scaylup_stripe_sales,
       (select count(*) from public.workspace_integrations where workspace_id <> current_setting('betelgeze.reset.workspace_id')::uuid and connected_account_id is not null) as non_scaylup_connected_integrations,
       (select count(*) from public.assets where workspace_id <> current_setting('betelgeze.reset.workspace_id')::uuid and storage_path is not null) as non_scaylup_r2_assets,
       (select count(*) from public.relationship_onboarding_session_steps where workspace_id <> current_setting('betelgeze.reset.workspace_id')::uuid and video_storage_path is not null) as non_scaylup_r2_videos,
       (select count(*) from public.user_profiles where user_id <> current_setting('betelgeze.reset.protected_user_id')::uuid and avatar_path is not null) as removed_user_r2_avatars,
       (select count(*) from public.account_email_deliveries delivery
        left join public.workspace_invitations invitation on invitation.id = delivery.invitation_id
        where delivery.provider_message_id is not null
          and (delivery.user_id <> current_setting('betelgeze.reset.protected_user_id')::uuid
               or invitation.workspace_id <> current_setting('betelgeze.reset.workspace_id')::uuid)) as resend_messages_for_removed_records;

\if :execute
    do $$
    begin
        if current_setting('betelgeze.reset.confirmation') <> 'DELETE ALL BETELGEZE TEST ACCOUNTS' then
            raise exception 'Execution confirmation mismatch.';
        end if;
    end $$;

    insert into public.workspace_memberships (workspace_id, user_id, role)
    values (current_setting('betelgeze.reset.workspace_id')::uuid, current_setting('betelgeze.reset.protected_user_id')::uuid, 'owner')
    on conflict (workspace_id, user_id) do update set role = 'owner';

    update public.relationships
    set seller_user_id = current_setting('betelgeze.reset.protected_user_id')::uuid
    where workspace_id = current_setting('betelgeze.reset.workspace_id')::uuid
      and seller_user_id is not null
      and seller_user_id <> current_setting('betelgeze.reset.protected_user_id')::uuid;
    update public.relationships
    set fulfilment_manager_user_id = current_setting('betelgeze.reset.protected_user_id')::uuid
    where workspace_id = current_setting('betelgeze.reset.workspace_id')::uuid
      and fulfilment_manager_user_id is not null
      and fulfilment_manager_user_id <> current_setting('betelgeze.reset.protected_user_id')::uuid;
    update public.relationship_services
    set assignee_user_id = current_setting('betelgeze.reset.protected_user_id')::uuid
    where workspace_id = current_setting('betelgeze.reset.workspace_id')::uuid
      and assignee_user_id is not null
      and assignee_user_id <> current_setting('betelgeze.reset.protected_user_id')::uuid;
    update public.work_items
    set execution_owner_id = current_setting('betelgeze.reset.protected_user_id')::uuid
    where workspace_id = current_setting('betelgeze.reset.workspace_id')::uuid
      and execution_owner_id is not null
      and execution_owner_id <> current_setting('betelgeze.reset.protected_user_id')::uuid;
    update public.onboarding_service_revisions
    set default_assignee_user_id = current_setting('betelgeze.reset.protected_user_id')::uuid
    where workspace_id = current_setting('betelgeze.reset.workspace_id')::uuid
      and default_assignee_user_id is not null
      and default_assignee_user_id <> current_setting('betelgeze.reset.protected_user_id')::uuid;
    update public.client_sale_items
    set default_assignee_user_id = current_setting('betelgeze.reset.protected_user_id')::uuid
    where workspace_id = current_setting('betelgeze.reset.workspace_id')::uuid
      and default_assignee_user_id is not null
      and default_assignee_user_id <> current_setting('betelgeze.reset.protected_user_id')::uuid;
    update public.workspace_okrs
    set owner_user_id = current_setting('betelgeze.reset.protected_user_id')::uuid
    where workspace_id = current_setting('betelgeze.reset.workspace_id')::uuid
      and owner_user_id <> current_setting('betelgeze.reset.protected_user_id')::uuid;
    update public.workspace_maintenance_routing
    set responsible_user_id = current_setting('betelgeze.reset.protected_user_id')::uuid,
        updated_by = null
    where workspace_id = current_setting('betelgeze.reset.workspace_id')::uuid
      and responsible_user_id <> current_setting('betelgeze.reset.protected_user_id')::uuid;
    update public.workspace_team_service_responsibilities
    set responsible_user_id = current_setting('betelgeze.reset.protected_user_id')::uuid,
        updated_by = null
    where workspace_id = current_setting('betelgeze.reset.workspace_id')::uuid
      and responsible_user_id <> current_setting('betelgeze.reset.protected_user_id')::uuid;

    insert into public.work_item_assignees (work_item_id, user_id, workspace_id, assigned_by)
    select distinct assignment.work_item_id, current_setting('betelgeze.reset.protected_user_id')::uuid, assignment.workspace_id, null
    from public.work_item_assignees assignment
    where assignment.workspace_id = current_setting('betelgeze.reset.workspace_id')::uuid
      and assignment.user_id <> current_setting('betelgeze.reset.protected_user_id')::uuid
    on conflict (work_item_id, user_id) do nothing;
    delete from public.work_item_assignees
    where workspace_id = current_setting('betelgeze.reset.workspace_id')::uuid
      and user_id <> current_setting('betelgeze.reset.protected_user_id')::uuid;

    insert into public.workspace_team_members (workspace_id, team_id, user_id, added_by)
    select distinct member.workspace_id, member.team_id, current_setting('betelgeze.reset.protected_user_id')::uuid, null
    from public.workspace_team_members member
    where member.workspace_id = current_setting('betelgeze.reset.workspace_id')::uuid
      and member.user_id <> current_setting('betelgeze.reset.protected_user_id')::uuid
    on conflict (team_id, user_id) do nothing;
    delete from public.workspace_team_members
    where workspace_id = current_setting('betelgeze.reset.workspace_id')::uuid
      and user_id <> current_setting('betelgeze.reset.protected_user_id')::uuid;

    do $$
    begin
        if exists (
            select 1 from public.workspace_okrs
            where workspace_id = current_setting('betelgeze.reset.workspace_id')::uuid
              and owner_user_id <> current_setting('betelgeze.reset.protected_user_id')::uuid
        ) or exists (
            select 1 from public.workspace_team_service_responsibilities
            where workspace_id = current_setting('betelgeze.reset.workspace_id')::uuid
              and responsible_user_id <> current_setting('betelgeze.reset.protected_user_id')::uuid
        ) then
            raise exception 'Blocking active account references remain after reassignment.';
        end if;
    end $$;

    delete from public.workspace_invitations where accepted_at is null;
    delete from public.workspaces where id <> current_setting('betelgeze.reset.workspace_id')::uuid;
    delete from auth.users where id <> current_setting('betelgeze.reset.protected_user_id')::uuid;

    do $$
    begin
        if (select count(*) from auth.users) <> 1 then raise exception 'Final auth-user invariant failed.'; end if;
        if (select count(*) from public.workspaces) <> 1 then raise exception 'Final workspace invariant failed.'; end if;
        if exists (select 1 from public.workspace_invitations where accepted_at is null) then raise exception 'Pending invitation invariant failed.'; end if;
        if not exists (
            select 1 from public.workspace_memberships
            where workspace_id = current_setting('betelgeze.reset.workspace_id')::uuid
              and user_id = current_setting('betelgeze.reset.protected_user_id')::uuid
              and role = 'owner'
        ) then raise exception 'Protected owner membership invariant failed.'; end if;
    end $$;

    commit;
    \echo 'Reset committed. External provider records were not deleted; review the orphan report above.'
\else
    rollback;
    \echo 'Dry run complete. No rows were changed. Review and export the manifest before any execute=true run.'
\endif
