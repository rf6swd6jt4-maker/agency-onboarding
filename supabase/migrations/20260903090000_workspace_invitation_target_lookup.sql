-- Resolve one exact username or email for the Settings invitation flow without
-- exposing a browseable account directory to the client.

create or replace function public.lookup_workspace_invitation_target(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_identifier text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
    v_actor_role text;
    v_identifier text := lower(trim(coalesce(p_identifier, '')));
    v_username_identifier text;
    v_input_kind text;
    v_user_id uuid;
    v_email text;
    v_username text;
    v_is_member boolean := false;
    v_invitation_pending boolean := false;
begin
    select membership.role into v_actor_role
    from public.workspace_memberships membership
    where membership.workspace_id = p_workspace_id
      and membership.user_id = p_actor_user_id;

    if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
        raise exception 'WORKSPACE_INVITATION_LOOKUP_FORBIDDEN' using errcode = 'P0001';
    end if;
    if char_length(v_identifier) < 3 or char_length(v_identifier) > 320 then
        raise exception 'INVALID_INVITATION_IDENTIFIER' using errcode = '22023';
    end if;

    if position('@' in v_identifier) > 1 then
        v_input_kind := 'email';
        select account.id, lower(account.email), profile.username
        into v_user_id, v_email, v_username
        from auth.users account
        left join public.user_profiles profile on profile.user_id = account.id
        where lower(account.email) = v_identifier
        limit 1;
        v_email := coalesce(v_email, v_identifier);
    else
        v_input_kind := 'username';
        v_username_identifier := trim(leading '@' from v_identifier);
        select account.id, lower(account.email), profile.username
        into v_user_id, v_email, v_username
        from public.user_profiles profile
        join auth.users account on account.id = profile.user_id
        where lower(profile.username) = v_username_identifier
        limit 1;
    end if;

    if v_user_id is not null then
        select exists (
            select 1
            from public.workspace_memberships membership
            where membership.workspace_id = p_workspace_id
              and membership.user_id = v_user_id
        ) into v_is_member;
    end if;

    if v_email is not null then
        select exists (
            select 1
            from public.workspace_invitations invitation
            where invitation.workspace_id = p_workspace_id
              and lower(invitation.email) = v_email
              and invitation.accepted_at is null
              and invitation.revoked_at is null
              and invitation.expires_at > now()
              and invitation.delivery_status in ('queued', 'sent', 'delivered', 'delayed')
        ) into v_invitation_pending;
    end if;

    return jsonb_build_object(
        'input_kind', v_input_kind,
        'account_exists', v_user_id is not null,
        'email', v_email,
        'username', v_username,
        'is_workspace_member', v_is_member,
        'invitation_pending', v_invitation_pending
    );
end;
$$;

revoke all on function public.lookup_workspace_invitation_target(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.lookup_workspace_invitation_target(uuid, uuid, text) to service_role;
