-- Keep the workspace shell's Communications badge exact without loading and
-- decrypting every conversation while the Communications pane is unmounted.
-- This service-only function returns metadata counts; message content remains
-- behind the existing authenticated/AAL2 functions.

create index if not exists client_messages_workspace_inbound_unread_idx
on public.client_messages(workspace_id, relationship_id, created_at)
where direction = 'inbound';

create index if not exists workspace_native_messages_workspace_unread_idx
on public.workspace_native_messages(workspace_id, conversation_id, created_at)
include (sender_user_id);

create or replace function public.workspace_communications_unread_counts(
    p_workspace_id uuid,
    p_user_id uuid
)
returns table (
    client_unread bigint,
    native_unread bigint
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        (
            select count(*)
            from public.client_messages message
            join public.relationships relationship
              on relationship.id = message.relationship_id
             and relationship.workspace_id = message.workspace_id
            left join public.communication_read_cursors cursor
              on cursor.workspace_id = message.workspace_id
             and cursor.relationship_id = message.relationship_id
             and cursor.user_id = p_user_id
            where message.workspace_id = p_workspace_id
              and message.direction = 'inbound'
              and relationship.status is distinct from 'archived'
              and (cursor.last_read_at is null or message.created_at > cursor.last_read_at)
        )::bigint as client_unread,
        (
            select count(*)
            from public.workspace_native_messages message
            join public.workspace_native_conversations conversation
              on conversation.id = message.conversation_id
             and conversation.workspace_id = message.workspace_id
            left join public.workspace_native_read_cursors cursor
              on cursor.workspace_id = message.workspace_id
             and cursor.conversation_id = message.conversation_id
             and cursor.user_id = p_user_id
            left join public.workspace_native_conversation_visibility visibility
              on visibility.workspace_id = message.workspace_id
             and visibility.conversation_id = message.conversation_id
             and visibility.user_id = p_user_id
            where message.workspace_id = p_workspace_id
              and message.sender_user_id is distinct from p_user_id
              and (cursor.last_read_at is null or message.created_at > cursor.last_read_at)
              and (visibility.cleared_at is null or message.created_at > visibility.cleared_at)
              and (
                  (conversation.kind = 'direct' and exists (
                      select 1
                      from public.workspace_native_conversation_participants participant
                      where participant.workspace_id = p_workspace_id
                        and participant.conversation_id = conversation.id
                        and participant.user_id = p_user_id
                  ))
                  or
                  (conversation.kind = 'team' and exists (
                      select 1
                      from public.workspace_team_members team_member
                      where team_member.workspace_id = p_workspace_id
                        and team_member.team_id = conversation.team_id
                        and team_member.user_id = p_user_id
                  ))
              )
        )::bigint as native_unread;
$$;

revoke all on function public.workspace_communications_unread_counts(uuid, uuid) from public, anon, authenticated;
grant execute on function public.workspace_communications_unread_counts(uuid, uuid) to service_role;
