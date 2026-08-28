-- The client portal reads encrypted message attachments through its own
-- relationship-scoped credential. Keep file paths and customer encryption keys
-- behind a service-role-only projection; the public route validates the portal
-- session before invoking this function.

create or replace function public.client_portal_message_attachment_access(
    p_workspace_id uuid,
    p_relationship_id uuid,
    p_message_id uuid
)
returns table (
    storage_path text,
    file_name text,
    mime_type text,
    customer_key text,
    is_encrypted boolean
)
language sql
stable
security definer
set search_path = ''
as $$
    with decoded as materialized (
        select
            message.id,
            message.client_id,
            case
                when message.raw_payload_ciphertext is null then message.raw_payload
                else communications_secure.try_decrypt_jsonb(message.raw_payload_ciphertext, content_secret.secret)
            end as visible_raw_payload
        from public.client_messages message
        left join communications_secure.content_keys content_key on content_key.id = message.body_key_id
        left join vault.decrypted_secrets content_secret on content_secret.id = content_key.vault_secret_id
        where auth.role() = 'service_role'
          and message.workspace_id = p_workspace_id
          and message.relationship_id = p_relationship_id
          and message.id = p_message_id
    ), attachment as (
        select decoded.client_id, coalesce(decoded.visible_raw_payload -> 'bridge_media', decoded.visible_raw_payload -> 'attachment') as value
        from decoded
        where decoded.visible_raw_payload is not null
    ), prepared as (
        select
            attachment.client_id,
            coalesce(attachment.value ->> 'storagePath', attachment.value ->> 'storage_path') as storage_path,
            coalesce(attachment.value ->> 'fileName', attachment.value ->> 'file_name') as file_name,
            coalesce(attachment.value ->> 'mimeType', attachment.value ->> 'mime_type') as mime_type
        from attachment
        where jsonb_typeof(attachment.value) = 'object'
    )
    select
        prepared.storage_path,
        prepared.file_name,
        prepared.mime_type,
        file_secret.secret,
        encrypted_file.storage_path is not null
    from prepared
    left join communications_secure.encrypted_files encrypted_file
      on encrypted_file.storage_path = prepared.storage_path
     and encrypted_file.workspace_id = p_workspace_id
     and encrypted_file.scope_kind = 'client'
     and encrypted_file.scope_id = p_relationship_id
    left join vault.decrypted_secrets file_secret on file_secret.id = encrypted_file.vault_secret_id
    where prepared.storage_path is not null
      and (
          prepared.storage_path like p_workspace_id::text || '/relationships/' || p_relationship_id::text || '/client-messages/%'
          or (
              prepared.client_id is not null
              and prepared.storage_path like p_workspace_id::text || '/' || prepared.client_id::text || '/client-messages/%'
          )
      )
    limit 1;
$$;

revoke all on function public.client_portal_message_attachment_access(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.client_portal_message_attachment_access(uuid, uuid, uuid) to service_role;
