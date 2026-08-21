create extension if not exists pgcrypto;

alter table public.workspace_invitations
    add column if not exists token_hash text,
    add column if not exists delivery_status text not null default 'queued',
    add column if not exists provider_message_id text,
    add column if not exists delivery_attempt_count integer not null default 0,
    add column if not exists sent_at timestamptz,
    add column if not exists delivered_at timestamptz,
    add column if not exists delivery_failed_at timestamptz,
    add column if not exists delivery_failure_code text,
    add column if not exists revoked_at timestamptz,
    add column if not exists accepted_by uuid references auth.users(id) on delete set null,
    add column if not exists token_exchanged_at timestamptz;

alter table public.workspace_invitations
    drop constraint if exists workspace_invitations_delivery_status_check;
alter table public.workspace_invitations
    add constraint workspace_invitations_delivery_status_check
    check (delivery_status in ('queued', 'sent', 'delivered', 'delayed', 'failed', 'bounced', 'suppressed', 'accepted', 'revoked'));

create unique index if not exists workspace_invitations_token_hash_idx
on public.workspace_invitations (token_hash)
where token_hash is not null;

create index if not exists workspace_invitations_provider_message_idx
on public.workspace_invitations (provider_message_id)
where provider_message_id is not null;

create table if not exists public.account_onboarding_sessions (
    id uuid primary key default gen_random_uuid(),
    invitation_id uuid not null references public.workspace_invitations(id) on delete cascade,
    browser_token_hash text not null unique,
    auth_user_id uuid references auth.users(id) on delete cascade,
    current_step text not null default 'review'
        check (current_step in ('review', 'email', 'username', 'password', 'verify-email', 'about', 'profile', '2fa', 'complete')),
    username_candidate text,
    expires_at timestamptz not null,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists account_onboarding_sessions_invitation_idx
on public.account_onboarding_sessions (invitation_id, created_at desc);

create table if not exists public.account_password_recovery_sessions (
    id uuid primary key default gen_random_uuid(),
    browser_token_hash text not null unique,
    auth_user_id uuid not null references auth.users(id) on delete cascade,
    email_hash text not null,
    expires_at timestamptz not null,
    completed_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists account_password_recovery_sessions_user_idx
on public.account_password_recovery_sessions (auth_user_id, created_at desc);

create or replace function public.exchange_account_invitation(
    p_invitation_token text,
    p_browser_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
    v_invitation public.workspace_invitations%rowtype;
    v_existing_user_id uuid;
    v_session_id uuid;
begin
    if p_invitation_token is null or char_length(p_invitation_token) < 32
       or p_browser_token_hash !~ '^[a-f0-9]{64}$' then
        raise exception 'INVITATION_UNAVAILABLE' using errcode = 'P0001';
    end if;

    select * into v_invitation
    from public.workspace_invitations
    where token_hash = encode(digest(p_invitation_token, 'sha256'), 'hex')
    for update;

    if not found
       or v_invitation.accepted_at is not null
       or v_invitation.revoked_at is not null
       or v_invitation.token_exchanged_at is not null
       or v_invitation.expires_at <= now() then
        raise exception 'INVITATION_UNAVAILABLE' using errcode = 'P0001';
    end if;

    select id into v_existing_user_id
    from auth.users
    where lower(email) = lower(v_invitation.email)
    limit 1;

    insert into public.account_onboarding_sessions (
        invitation_id, browser_token_hash, auth_user_id, current_step, expires_at
    ) values (
        v_invitation.id, p_browser_token_hash, v_existing_user_id, 'review', v_invitation.expires_at
    ) returning id into v_session_id;

    update public.workspace_invitations
    set token_exchanged_at = now()
    where id = v_invitation.id;

    return jsonb_build_object(
        'session_id', v_session_id,
        'invitation_id', v_invitation.id,
        'email', v_invitation.email,
        'expires_at', v_invitation.expires_at,
        'existing_account', v_existing_user_id is not null
    );
end;
$$;

revoke all on function public.exchange_account_invitation(text, text) from public, anon, authenticated;
grant execute on function public.exchange_account_invitation(text, text) to service_role;

create or replace function public.rotate_workspace_invitation(
    p_invitation_id uuid,
    p_workspace_id uuid,
    p_email text,
    p_role text,
    p_invited_by uuid,
    p_expires_at timestamptz,
    p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_invitation_id uuid;
    v_attempt_count integer;
begin
    if p_invitation_id is null or p_workspace_id is null or p_invited_by is null
       or p_role not in ('admin', 'staff')
       or p_email is null or position('@' in p_email) <= 1
       or p_expires_at <= now()
       or p_token_hash !~ '^[a-f0-9]{64}$' then
        raise exception 'INVALID_INVITATION_ROTATION' using errcode = 'P0001';
    end if;

    insert into public.workspace_invitations as existing_invitation (
        id, workspace_id, email, role, invited_by, expires_at,
        accepted_at, accepted_by, revoked_at, token_hash, token_exchanged_at,
        delivery_status, provider_message_id, delivery_attempt_count,
        sent_at, delivered_at, delivery_failed_at, delivery_failure_code
    ) values (
        p_invitation_id, p_workspace_id, lower(p_email), p_role, p_invited_by, p_expires_at,
        null, null, null, p_token_hash, null,
        'queued', null, 1,
        null, null, null, null
    )
    on conflict (workspace_id, email) do update
    set role = excluded.role,
        invited_by = excluded.invited_by,
        expires_at = excluded.expires_at,
        accepted_at = null,
        accepted_by = null,
        revoked_at = null,
        token_hash = excluded.token_hash,
        token_exchanged_at = null,
        delivery_status = 'queued',
        provider_message_id = null,
        delivery_attempt_count = existing_invitation.delivery_attempt_count + 1,
        sent_at = null,
        delivered_at = null,
        delivery_failed_at = null,
        delivery_failure_code = null
    returning id, delivery_attempt_count into v_invitation_id, v_attempt_count;

    delete from public.account_onboarding_sessions
    where invitation_id = v_invitation_id;

    return jsonb_build_object(
        'invitation_id', v_invitation_id,
        'delivery_attempt_count', v_attempt_count
    );
end;
$$;

revoke all on function public.rotate_workspace_invitation(uuid, uuid, text, text, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.rotate_workspace_invitation(uuid, uuid, text, text, uuid, timestamptz, text) to service_role;

create table if not exists public.account_onboarding_responses (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null unique references public.account_onboarding_sessions(id) on delete cascade,
    user_id uuid references auth.users(id) on delete cascade,
    question_version integer not null default 1,
    intended_uses text[] not null default '{}',
    role_answer text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.account_email_deliveries (
    id uuid primary key default gen_random_uuid(),
    provider_message_id text unique,
    purpose text not null check (purpose in (
        'workspace_invitation', 'signup_otp', 'password_recovery_otp',
        'email_change_current', 'email_change_new', 'password_changed',
        'reauthentication', 'security_notice'
    )),
    status text not null default 'queued'
        check (status in ('queued', 'sent', 'delivered', 'delayed', 'failed', 'bounced', 'suppressed')),
    user_id uuid references auth.users(id) on delete set null,
    invitation_id uuid references public.workspace_invitations(id) on delete set null,
    recipient_hash text not null,
    attempt_count integer not null default 1,
    provider_event_at timestamptz,
    sent_at timestamptz,
    delivered_at timestamptz,
    failed_at timestamptz,
    failure_code text,
    diagnostics jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists account_email_deliveries_user_idx
on public.account_email_deliveries (user_id, created_at desc);
create index if not exists account_email_deliveries_invitation_idx
on public.account_email_deliveries (invitation_id, created_at desc);

create table if not exists public.account_security_events (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    actor_user_id uuid references auth.users(id) on delete set null,
    workspace_id uuid references public.workspaces(id) on delete set null,
    event_type text not null check (event_type in (
        'password_changed', 'mfa_enrolled', 'mfa_backup_enrolled',
        'mfa_factor_removed', 'mfa_admin_reset', 'email_changed'
    )),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists account_security_events_user_idx
on public.account_security_events (user_id, created_at desc);

create table if not exists public.account_welcome_events (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    role text not null check (role in ('owner', 'admin', 'staff')),
    consumed_at timestamptz,
    created_at timestamptz not null default now()
);

alter table public.user_profiles
    add column if not exists mfa_reenrollment_required boolean not null default false;

alter table public.account_onboarding_sessions enable row level security;
alter table public.account_password_recovery_sessions enable row level security;
alter table public.account_onboarding_responses enable row level security;
alter table public.account_email_deliveries enable row level security;
alter table public.account_security_events enable row level security;
alter table public.account_welcome_events enable row level security;

create or replace function public.current_session_is_aal2()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select auth.role() = 'service_role'
        or (
            coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
            and not exists (
                select 1 from public.user_profiles
                where user_id = auth.uid()
                  and mfa_reenrollment_required
            )
        );
$$;

revoke all on function public.current_session_is_aal2() from public, anon;
grant execute on function public.current_session_is_aal2() to authenticated, service_role;

create or replace function public.is_workspace_member(
    target_workspace uuid,
    allowed_roles text[] default array['owner', 'admin', 'staff']
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.current_session_is_aal2()
       and exists (
           select 1
           from public.workspace_memberships
           where workspace_id = target_workspace
             and user_id = auth.uid()
             and role = any(allowed_roles)
       );
$$;

drop policy if exists "users can view their profile" on public.user_profiles;
create policy "users can view their profile" on public.user_profiles
for select using (user_id = auth.uid() and public.current_session_is_aal2());
drop policy if exists "users can update their profile" on public.user_profiles;
create policy "users can update their profile" on public.user_profiles
for update using (user_id = auth.uid() and public.current_session_is_aal2())
with check (user_id = auth.uid() and public.current_session_is_aal2());

create policy "users can read their onboarding responses"
on public.account_onboarding_responses for select
using (user_id = auth.uid() and public.current_session_is_aal2());

create policy "users can read their security events"
on public.account_security_events for select
using (user_id = auth.uid() and public.current_session_is_aal2());

create or replace function public.native_conversation_can_read(target_conversation uuid, target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.current_session_is_aal2() and exists (
        select 1
        from public.workspace_native_conversations conversation
        join public.workspace_memberships membership
          on membership.workspace_id = conversation.workspace_id
         and membership.user_id = target_user
        where conversation.id = target_conversation
          and (target_user = auth.uid() or auth.role() = 'service_role')
          and (
            (conversation.kind = 'direct' and exists (
                select 1 from public.workspace_native_conversation_participants participant
                where participant.conversation_id = conversation.id and participant.user_id = target_user
            ))
            or
            (conversation.kind = 'team' and (
                exists (
                    select 1 from public.workspace_team_members team_member
                    where team_member.team_id = conversation.team_id and team_member.user_id = target_user
                )
                or (membership.role in ('owner', 'admin') and exists (
                    select 1 from public.workspace_teams team
                    where team.id = conversation.team_id and team.archived_at is not null
                ))
            ))
          )
    );
$$;

create or replace function public.native_conversation_can_write(target_conversation uuid, target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.current_session_is_aal2() and exists (
        select 1
        from public.workspace_native_conversations conversation
        join public.workspace_memberships membership
          on membership.workspace_id = conversation.workspace_id
         and membership.user_id = target_user
        left join public.workspace_teams team on team.id = conversation.team_id
        where conversation.id = target_conversation
          and (target_user = auth.uid() or auth.role() = 'service_role')
          and (
            (conversation.kind = 'direct' and exists (
                select 1 from public.workspace_native_conversation_participants participant
                where participant.conversation_id = conversation.id and participant.user_id = target_user
            ))
            or
            (conversation.kind = 'team' and team.archived_at is null and exists (
                select 1 from public.workspace_team_members team_member
                where team_member.team_id = conversation.team_id and team_member.user_id = target_user
            ))
          )
    );
$$;

create or replace function public.can_access_communications_realtime(p_topic text)
returns boolean language sql stable security definer set search_path = '' as $$
    select public.current_session_is_aal2()
       and p_topic ~ '^communications:[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'
       and exists (
           select 1 from public.workspaces workspace
           where workspace.slug = split_part(p_topic, ':', 2)
             and workspace.status = 'active'
             and public.is_workspace_member(workspace.id)
       );
$$;

create or replace function public.can_access_workspace_presence_realtime(p_topic text)
returns boolean language sql stable security definer set search_path = '' as $$
    select public.current_session_is_aal2()
       and p_topic ~ '^workspace-presence:[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'
       and exists (
           select 1 from public.workspaces workspace
           where workspace.slug = split_part(p_topic, ':', 2)
             and workspace.status = 'active'
             and public.is_workspace_member(workspace.id)
       );
$$;

create or replace function public.can_access_onboarding_builder_realtime(p_topic text)
returns boolean language sql stable security definer set search_path = '' as $$
    select public.current_session_is_aal2()
       and p_topic ~ '^onboarding-builder:[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'
       and exists (
           select 1 from public.workspaces workspace
           where workspace.slug = split_part(p_topic, ':', 2)
             and workspace.status = 'active'
             and public.is_workspace_member(workspace.id, array['owner', 'admin'])
       );
$$;

create or replace function public.record_account_email_delivery_event(
    p_provider_message_id text,
    p_status text,
    p_event_at timestamptz,
    p_failure_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_delivery public.account_email_deliveries%rowtype;
    v_invitation public.workspace_invitations%rowtype;
    v_current_rank integer;
    v_incoming_rank integer;
begin
    if p_status not in ('sent', 'delivered', 'delayed', 'failed', 'bounced', 'suppressed') then
        raise exception 'INVALID_EMAIL_DELIVERY_STATUS' using errcode = 'P0001';
    end if;

    select * into v_delivery
    from public.account_email_deliveries
    where provider_message_id = p_provider_message_id
    for update;
    if not found then return false; end if;

    v_current_rank := case v_delivery.status
        when 'queued' then 0 when 'sent' then 1 when 'delayed' then 2
        when 'delivered' then 3 else 4 end;
    v_incoming_rank := case p_status
        when 'sent' then 1 when 'delayed' then 2 when 'delivered' then 3 else 4 end;

    if v_incoming_rank < v_current_rank then return true; end if;

    update public.account_email_deliveries
    set status = p_status,
        provider_event_at = greatest(coalesce(provider_event_at, p_event_at), p_event_at),
        delivered_at = case when p_status = 'delivered' then coalesce(delivered_at, p_event_at) else delivered_at end,
        failed_at = case when p_status in ('failed', 'bounced', 'suppressed') then coalesce(failed_at, p_event_at) else failed_at end,
        failure_code = case when p_status in ('failed', 'bounced', 'suppressed') then p_failure_code else failure_code end,
        updated_at = now()
    where id = v_delivery.id;

    if v_delivery.invitation_id is not null then
        select * into v_invitation
        from public.workspace_invitations
        where id = v_delivery.invitation_id
        for update;
        if found
           and v_invitation.provider_message_id = p_provider_message_id
           and v_invitation.delivery_status not in ('accepted', 'revoked') then
            update public.workspace_invitations
            set delivery_status = p_status,
                delivered_at = case when p_status = 'delivered' then coalesce(delivered_at, p_event_at) else delivered_at end,
                delivery_failed_at = case when p_status in ('failed', 'bounced', 'suppressed') then coalesce(delivery_failed_at, p_event_at) else delivery_failed_at end,
                delivery_failure_code = case when p_status in ('failed', 'bounced', 'suppressed') then p_failure_code else delivery_failure_code end
            where id = v_invitation.id;
        end if;
    end if;
    return true;
end;
$$;

revoke all on function public.record_account_email_delivery_event(text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.record_account_email_delivery_event(text, text, timestamptz, text) to service_role;

create or replace function public.complete_account_onboarding(p_browser_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
    v_user_id uuid := auth.uid();
    v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
    v_aal text := coalesce(auth.jwt() ->> 'aal', '');
    v_session public.account_onboarding_sessions%rowtype;
    v_invitation public.workspace_invitations%rowtype;
    v_workspace public.workspaces%rowtype;
    v_username text;
    v_welcome_id uuid;
    v_membership_role text;
begin
    if v_user_id is null then
        raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
    end if;
    if v_aal <> 'aal2' then
        raise exception 'AAL2_REQUIRED' using errcode = 'P0001';
    end if;
    if not exists (
        select 1
        from auth.users protected_user
        where protected_user.id = v_user_id
          and lower(protected_user.email) = v_email
          and protected_user.email_confirmed_at is not null
    ) then
        raise exception 'EMAIL_NOT_CONFIRMED' using errcode = 'P0001';
    end if;
    if p_browser_token is null or char_length(p_browser_token) < 32 then
        raise exception 'ONBOARDING_SESSION_INVALID' using errcode = 'P0001';
    end if;

    select * into v_session
    from public.account_onboarding_sessions
    where browser_token_hash = encode(digest(p_browser_token, 'sha256'), 'hex')
    for update;

    if not found or v_session.expires_at <= now() then
        raise exception 'ONBOARDING_SESSION_EXPIRED' using errcode = 'P0001';
    end if;

    select * into v_invitation
    from public.workspace_invitations
    where id = v_session.invitation_id
    for update;

    if not found or v_invitation.revoked_at is not null or v_invitation.expires_at <= now() then
        raise exception 'INVITATION_UNAVAILABLE' using errcode = 'P0001';
    end if;
    if lower(v_invitation.email) <> v_email then
        raise exception 'INVITATION_EMAIL_MISMATCH' using errcode = 'P0001';
    end if;
    if v_session.auth_user_id is not null and v_session.auth_user_id <> v_user_id then
        raise exception 'ONBOARDING_USER_MISMATCH' using errcode = 'P0001';
    end if;

    select * into v_workspace from public.workspaces where id = v_invitation.workspace_id;
    if not found or v_workspace.status <> 'active' then
        raise exception 'WORKSPACE_UNAVAILABLE' using errcode = 'P0001';
    end if;

    if v_invitation.accepted_at is not null then
        if v_invitation.accepted_by is distinct from v_user_id then
            raise exception 'INVITATION_UNAVAILABLE' using errcode = 'P0001';
        end if;
        select username into v_username from public.user_profiles where user_id = v_user_id;
        select role into v_membership_role
        from public.workspace_memberships
        where workspace_id = v_invitation.workspace_id and user_id = v_user_id;
        if v_membership_role is null then
            raise exception 'INVITATION_MEMBERSHIP_MISSING' using errcode = 'P0001';
        end if;
        select id into v_welcome_id
        from public.account_welcome_events
        where user_id = v_user_id and workspace_id = v_invitation.workspace_id
        order by created_at desc
        limit 1;
        return jsonb_build_object(
            'welcome_event_id', v_welcome_id,
            'workspace_id', v_workspace.id,
            'workspace_slug', v_workspace.slug,
            'workspace_name', v_workspace.name,
            'role', v_membership_role,
            'username', v_username
        );
    end if;

    insert into public.workspace_memberships as existing_membership (workspace_id, user_id, role)
    values (v_invitation.workspace_id, v_user_id, v_invitation.role)
    on conflict (workspace_id, user_id) do update
    set role = case
        when existing_membership.role = 'owner' then 'owner'
        when existing_membership.role = 'admin' and excluded.role = 'staff' then 'admin'
        else excluded.role
    end
    returning role into v_membership_role;

    update public.workspace_invitations
    set accepted_at = coalesce(accepted_at, now()),
        accepted_by = v_user_id,
        delivery_status = 'accepted'
    where id = v_invitation.id;

    update public.account_onboarding_sessions
    set auth_user_id = v_user_id,
        current_step = 'complete',
        completed_at = coalesce(completed_at, now()),
        updated_at = now()
    where invitation_id = v_invitation.id;

    update public.account_onboarding_responses
    set user_id = v_user_id, updated_at = now()
    where session_id = v_session.id;

    update public.user_profiles
    set mfa_reenrollment_required = false, updated_at = now()
    where user_id = v_user_id;

    select username into v_username from public.user_profiles where user_id = v_user_id;

    insert into public.account_welcome_events (user_id, workspace_id, role)
    values (v_user_id, v_invitation.workspace_id, v_membership_role)
    returning id into v_welcome_id;

    return jsonb_build_object(
        'welcome_event_id', v_welcome_id,
        'workspace_id', v_workspace.id,
        'workspace_slug', v_workspace.slug,
        'workspace_name', v_workspace.name,
        'role', v_membership_role,
        'username', v_username
    );
end;
$$;

revoke all on function public.complete_account_onboarding(text) from public;
grant execute on function public.complete_account_onboarding(text) to authenticated;
