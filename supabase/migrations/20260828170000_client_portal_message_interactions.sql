-- Give the token-scoped client portal a source-aware, reaction-aware message
-- projection without exposing transport identifiers or reactor identities.

create or replace function public.client_portal_messages_v2(
    p_workspace_id uuid,
    p_relationship_id uuid,
    p_before timestamptz default null,
    p_limit integer default 100
)
returns table (
    id uuid,
    body text,
    direction text,
    sender_kind text,
    automation_label text,
    reply_to_message_id uuid,
    source text,
    reactions jsonb,
    attachment jsonb,
    created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
    with decoded as materialized (
        select
            message.*,
            communications_secure.try_decrypt_text(message.body_ciphertext, decrypted.decrypted_secret) as decrypted_body,
            communications_secure.try_decrypt_jsonb(message.raw_payload_ciphertext, decrypted.decrypted_secret) as decrypted_raw_payload
        from public.client_messages message
        left join communications_secure.content_keys content_key on content_key.id = message.body_key_id
        left join vault.decrypted_secrets decrypted on decrypted.id = content_key.vault_secret_id
        where auth.role() = 'service_role'
          and message.workspace_id = p_workspace_id
          and message.relationship_id = p_relationship_id
          and (p_before is null or message.created_at < p_before)
    ), visible as (
        select
            message.*,
            case when message.body_ciphertext is null then message.body else message.decrypted_body end as visible_body,
            case when message.raw_payload_ciphertext is null then message.raw_payload else message.decrypted_raw_payload end as visible_raw_payload
        from decoded message
        where (message.body_ciphertext is null or message.decrypted_body is not null)
          and (message.raw_payload_ciphertext is null or message.decrypted_raw_payload is not null)
    ), prepared as (
        select
            message.*,
            coalesce(message.visible_raw_payload -> 'bridge_media', message.visible_raw_payload -> 'attachment') as visible_attachment
        from visible message
    )
    select
        message.id,
        message.visible_body,
        message.direction,
        case
            when message.direction = 'inbound' then 'client'
            when message.sender_kind = 'automation' then 'automation'
            else 'staff'
        end,
        case when message.sender_kind = 'automation' then message.automation_label else null end,
        message.reply_to_message_id,
        case
            when message.direction = 'outbound' then 'agency'
            when message.provider = 'meta_whatsapp' then 'whatsapp'
            when message.provider = 'twilio_sms' then 'sms'
            when message.provider = 'client_portal' then 'portal'
            else 'external'
        end,
        coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', reaction.id,
                'direction', reaction.direction,
                'emoji', reaction.emoji,
                'updatedAt', reaction.updated_at
            ) order by reaction.updated_at, reaction.id)
            from public.communication_reactions reaction
            where reaction.workspace_id = p_workspace_id
              and reaction.relationship_id = p_relationship_id
              and reaction.client_message_id = message.id
        ), '[]'::jsonb),
        case
            when jsonb_typeof(message.visible_attachment) = 'object' then jsonb_strip_nulls(jsonb_build_object(
                'kind', coalesce(message.visible_attachment ->> 'kind', message.visible_attachment ->> 'type'),
                'fileName', coalesce(message.visible_attachment ->> 'fileName', message.visible_attachment ->> 'file_name'),
                'mimeType', coalesce(message.visible_attachment ->> 'mimeType', message.visible_attachment ->> 'mime_type'),
                'size', case
                    when coalesce(message.visible_attachment ->> 'size', '') ~ '^[0-9]+$'
                        then (message.visible_attachment ->> 'size')::bigint
                    else null
                end,
                'storagePath', coalesce(message.visible_attachment ->> 'storagePath', message.visible_attachment ->> 'storage_path')
            ))
            else null
        end,
        message.created_at
    from prepared message
    where message.visible_body is not null
    order by message.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

revoke all on function public.client_portal_messages_v2(uuid, uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.client_portal_messages_v2(uuid, uuid, timestamptz, integer) to service_role;

-- Portal clients may only remove messages created through the portal itself.
-- Provider-originated WhatsApp and SMS records remain immutable here.
create or replace function public.delete_client_portal_message(
    p_workspace_id uuid,
    p_relationship_id uuid,
    p_message_id uuid
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
    with deleted as (
        delete from public.client_messages message
        where auth.role() = 'service_role'
          and message.workspace_id = p_workspace_id
          and message.relationship_id = p_relationship_id
          and message.id = p_message_id
          and message.direction = 'inbound'
          and message.provider = 'client_portal'
        returning 1
    )
    select exists(select 1 from deleted);
$$;

revoke all on function public.delete_client_portal_message(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_client_portal_message(uuid, uuid, uuid) to service_role;
