-- Provider callbacks and delivery responses can repeat message text (Twilio's
-- response includes `body`, for example). Keep those payloads behind the same
-- workspace/conversation key boundary as the logical message.

create or replace function communications_secure.redact_message_json(value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
    result jsonb;
begin
    if value is null then return null; end if;
    if jsonb_typeof(value) = 'object' then
        select coalesce(jsonb_object_agg(entry.key,
            case
                when (
                    lower(entry.key) in (
                        'body', 'body_text', 'caption', 'content', 'message_text', 'text',
                        'file_name', 'filename', 'original_filename', 'original_name',
                        'url', 'uri', 'link', 'download_url', 'media_url'
                    )
                    or lower(entry.key) ~ '^(mediaurl|media_url)[0-9]*$'
                ) and jsonb_typeof(entry.value) = 'string'
                    then to_jsonb('[encrypted]'::text)
                else communications_secure.redact_message_json(entry.value)
            end
        ), '{}'::jsonb)
        into result
        from jsonb_each(value) entry;
        return result;
    end if;
    if jsonb_typeof(value) = 'array' then
        select coalesce(jsonb_agg(communications_secure.redact_message_json(entry.value)), '[]'::jsonb)
        into result
        from jsonb_array_elements(value) entry;
        return result;
    end if;
    return value;
end;
$$;

alter table public.communication_message_deliveries
    add column if not exists raw_payload_ciphertext bytea,
    add column if not exists raw_payload_key_id uuid;

create or replace function communications_secure.encrypt_delivery_payload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    parent_workspace uuid;
    parent_scope uuid;
    content_key record;
begin
    if new.raw_payload is null or new.raw_payload = '{}'::jsonb then return new; end if;

    select message.workspace_id, coalesce(message.relationship_id, message.workspace_id)
    into parent_workspace, parent_scope
    from public.client_messages message
    where message.id = new.client_message_id;

    if parent_workspace is null or parent_scope is null then
        raise exception 'encrypted_delivery_requires_message_scope';
    end if;

    select * into content_key
    from communications_secure.get_or_create_content_key(parent_workspace, 'client', parent_scope);

    new.raw_payload_ciphertext := extensions.pgp_sym_encrypt(
        new.raw_payload::text,
        content_key.secret,
        'cipher-algo=aes256, compress-algo=0'
    );
    new.raw_payload_key_id := content_key.key_id;
    new.raw_payload := communications_secure.redact_message_json(new.raw_payload);
    return new;
end;
$$;

drop trigger if exists encrypt_communication_delivery_payload on public.communication_message_deliveries;
create trigger encrypt_communication_delivery_payload
before insert or update of raw_payload on public.communication_message_deliveries
for each row execute function communications_secure.encrypt_delivery_payload();

-- Close the short cut-over window between the primary migration and this
-- hardening migration without touching delivery records for legacy messages.
update public.communication_message_deliveries delivery
set raw_payload = delivery.raw_payload
from public.client_messages message
where message.id = delivery.client_message_id
  and message.body_encryption_version is not null
  and delivery.raw_payload is not null
  and delivery.raw_payload <> '{}'::jsonb
  and delivery.raw_payload_ciphertext is null;
