-- Preserve workspace-authored history when a human login is removed. Operational
-- membership rows still cascade from auth.users, while durable content points to
-- this non-auth attribution record instead of disappearing with the login.

create table if not exists public.account_user_attributions (
    user_id uuid primary key,
    username text not null,
    display_name text,
    avatar_path text,
    removed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

insert into public.account_user_attributions (user_id, username, display_name, avatar_path, created_at, updated_at)
select profile.user_id, profile.username, profile.display_name, profile.avatar_path, profile.created_at, profile.updated_at
from public.user_profiles profile
on conflict (user_id) do update
set username = excluded.username,
    display_name = excluded.display_name,
    avatar_path = excluded.avatar_path,
    updated_at = excluded.updated_at;

create or replace function public.sync_account_user_attribution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.account_user_attributions (user_id, username, display_name, avatar_path, removed_at, created_at, updated_at)
    values (new.user_id, new.username, new.display_name, new.avatar_path, null, new.created_at, new.updated_at)
    on conflict (user_id) do update
    set username = excluded.username,
        display_name = excluded.display_name,
        avatar_path = excluded.avatar_path,
        removed_at = null,
        updated_at = excluded.updated_at;
    return new;
end;
$$;

drop trigger if exists sync_account_user_attribution on public.user_profiles;
create trigger sync_account_user_attribution
after insert or update of username, display_name, avatar_path on public.user_profiles
for each row execute function public.sync_account_user_attribution();

alter table public.onboarding_builder_updates
    drop constraint if exists onboarding_builder_updates_actor_user_id_fkey;
alter table public.onboarding_builder_updates
    add constraint onboarding_builder_updates_actor_user_id_fkey
    foreign key (actor_user_id) references public.account_user_attributions(user_id) on delete restrict;

alter table public.workspace_invitations
    drop constraint if exists workspace_invitations_invited_by_fkey;
alter table public.workspace_invitations
    add constraint workspace_invitations_invited_by_fkey
    foreign key (invited_by) references public.account_user_attributions(user_id) on delete restrict;

alter table public.workspace_native_conversations
    add column if not exists archived_at timestamptz,
    add column if not exists archived_reason text;
alter table public.workspace_native_conversations
    drop constraint if exists workspace_native_conversations_direct_user_one_fkey,
    drop constraint if exists workspace_native_conversations_direct_user_two_fkey;
alter table public.workspace_native_conversations
    add constraint workspace_native_conversations_direct_user_one_fkey
        foreign key (direct_user_one) references public.account_user_attributions(user_id) on delete restrict,
    add constraint workspace_native_conversations_direct_user_two_fkey
        foreign key (direct_user_two) references public.account_user_attributions(user_id) on delete restrict;

alter table public.workspace_native_messages
    drop constraint if exists workspace_native_messages_sender_user_id_fkey;
alter table public.workspace_native_messages
    add constraint workspace_native_messages_sender_user_id_fkey
    foreign key (sender_user_id) references public.account_user_attributions(user_id) on delete restrict;

alter table public.workspace_native_reactions
    drop constraint if exists workspace_native_reactions_reactor_user_id_fkey;
alter table public.workspace_native_reactions
    add constraint workspace_native_reactions_reactor_user_id_fkey
    foreign key (reactor_user_id) references public.account_user_attributions(user_id) on delete restrict;

alter table public.client_messages
    drop constraint if exists client_messages_sender_user_id_fkey;
alter table public.client_messages
    add constraint client_messages_sender_user_id_fkey
    foreign key (sender_user_id) references public.account_user_attributions(user_id) on delete restrict;

alter table public.communication_reactions
    drop constraint if exists communication_reactions_reactor_user_id_fkey;
alter table public.communication_reactions
    add constraint communication_reactions_reactor_user_id_fkey
    foreign key (reactor_user_id) references public.account_user_attributions(user_id) on delete restrict;

alter table public.account_user_attributions enable row level security;

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
          and conversation.archived_at is null
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

revoke all on table public.account_user_attributions from public, anon, authenticated;
revoke all on function public.native_conversation_can_read(uuid, uuid) from public, anon;
revoke all on function public.native_conversation_can_write(uuid, uuid) from public, anon;
grant execute on function public.native_conversation_can_read(uuid, uuid) to authenticated, service_role;
grant execute on function public.native_conversation_can_write(uuid, uuid) to authenticated, service_role;
