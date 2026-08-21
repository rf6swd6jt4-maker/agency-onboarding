-- Realtime rows intentionally contain ciphertext only. These single-row RPCs
-- let an authorized recipient resolve the one new message without reloading a
-- whole conversation or the wider Communications bootstrap.

create or replace function public.communication_client_message(
    p_workspace_id uuid,
    p_message_id uuid
)
returns table (
    id uuid,
    client_request_id uuid,
    relationship_id uuid,
    body text,
    direction text,
    provider text,
    provider_message_id text,
    whatsapp_message_id text,
    reply_to_whatsapp_message_id text,
    reply_to_message_id uuid,
    status text,
    error text,
    sender_kind text,
    sender_user_id uuid,
    automation_kind text,
    automation_label text,
    created_at timestamptz,
    sent_at timestamptz,
    delivered_at timestamptz,
    read_at timestamptz,
    failed_at timestamptz,
    raw_payload jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        message.id,
        message.client_request_id,
        message.relationship_id,
        case
            when message.body_ciphertext is null then message.body
            else extensions.pgp_sym_decrypt(message.body_ciphertext, decrypted.secret)
        end,
        message.direction,
        message.provider,
        message.provider_message_id,
        message.whatsapp_message_id,
        message.reply_to_whatsapp_message_id,
        message.reply_to_message_id,
        message.status,
        message.error,
        message.sender_kind,
        message.sender_user_id,
        message.automation_kind,
        message.automation_label,
        message.created_at,
        message.sent_at,
        message.delivered_at,
        message.read_at,
        message.failed_at,
        case
            when message.raw_payload_ciphertext is null then message.raw_payload
            else extensions.pgp_sym_decrypt(message.raw_payload_ciphertext, decrypted.secret)::jsonb
        end
    from public.client_messages message
    left join communications_secure.content_keys content_key on content_key.id = message.body_key_id
    left join vault.decrypted_secrets decrypted on decrypted.id = content_key.vault_secret_id
    where auth.role() = 'authenticated'
      and auth.uid() is not null
      and public.current_session_is_aal2()
      and public.is_workspace_member(p_workspace_id)
      and message.workspace_id = p_workspace_id
      and message.id = p_message_id;
$$;

revoke all on function public.communication_client_message(uuid, uuid) from public, anon, service_role;
grant execute on function public.communication_client_message(uuid, uuid) to authenticated;

create or replace function public.communication_native_message(
    p_workspace_id uuid,
    p_message_id uuid
)
returns table (
    id uuid,
    client_request_id uuid,
    conversation_id uuid,
    sender_user_id uuid,
    sender_workspace_role text,
    body text,
    reply_to_message_id uuid,
    attachment jsonb,
    created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        message.id,
        message.client_request_id,
        message.conversation_id,
        message.sender_user_id,
        message.sender_workspace_role,
        case
            when message.body_ciphertext is null then coalesce(message.body, '')
            else extensions.pgp_sym_decrypt(message.body_ciphertext, decrypted.secret)
        end,
        message.reply_to_message_id,
        case
            when message.attachment_ciphertext is null then message.attachment
            else extensions.pgp_sym_decrypt(message.attachment_ciphertext, decrypted.secret)::jsonb
        end,
        message.created_at
    from public.workspace_native_messages message
    join public.workspace_native_conversations conversation on conversation.id = message.conversation_id
    left join communications_secure.content_keys content_key on content_key.id = message.body_key_id
    left join vault.decrypted_secrets decrypted on decrypted.id = content_key.vault_secret_id
    left join public.workspace_native_conversation_visibility visibility
      on visibility.conversation_id = message.conversation_id and visibility.user_id = auth.uid()
    where auth.role() = 'authenticated'
      and auth.uid() is not null
      and public.current_session_is_aal2()
      and public.is_workspace_member(p_workspace_id)
      and message.workspace_id = p_workspace_id
      and message.id = p_message_id
      and (visibility.cleared_at is null or message.created_at > visibility.cleared_at)
      and (
          (conversation.kind = 'direct' and exists (
              select 1 from public.workspace_native_conversation_participants participant
              where participant.conversation_id = conversation.id and participant.user_id = auth.uid()
          ))
          or
          (conversation.kind = 'team' and exists (
              select 1 from public.workspace_team_members team_member
              where team_member.team_id = conversation.team_id and team_member.user_id = auth.uid()
          ))
      );
$$;

revoke all on function public.communication_native_message(uuid, uuid) from public, anon, service_role;
grant execute on function public.communication_native_message(uuid, uuid) to authenticated;
