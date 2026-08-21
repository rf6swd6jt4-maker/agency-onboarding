-- Always encrypt with the value read back from Vault. The value returned by
-- vault.create_secret() is an identifier, and Vault remains the source of truth
-- for the corresponding secret even during the first write for a new scope.

create or replace function communications_secure.get_or_create_content_key(
    target_workspace uuid,
    target_scope_kind text,
    target_scope_id uuid
)
returns table(key_id uuid, key_version integer, secret text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    existing communications_secure.content_keys%rowtype;
    generated_secret text;
    generated_vault_id uuid;
    stored_secret text;
    next_version integer;
begin
    if target_scope_kind not in ('client', 'native') then
        raise exception 'invalid_communication_key_scope';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(target_workspace::text || ':' || target_scope_kind || ':' || target_scope_id::text, 0)
    );

    select * into existing
    from communications_secure.content_keys content_key
    where content_key.workspace_id = target_workspace
      and content_key.scope_kind = target_scope_kind
      and content_key.scope_id = target_scope_id
      and content_key.active
    limit 1;

    if found then
        return query
        select existing.id, existing.key_version, decrypted.secret
        from vault.decrypted_secrets decrypted
        where decrypted.id = existing.vault_secret_id;
        return;
    end if;

    generated_secret := pg_catalog.encode(extensions.gen_random_bytes(32), 'base64');
    select vault.create_secret(
        generated_secret,
        'communication-content-' || extensions.gen_random_uuid()::text,
        'Betelgeze encrypted Communications content key'
    ) into generated_vault_id;

    select decrypted.secret into stored_secret
    from vault.decrypted_secrets decrypted
    where decrypted.id = generated_vault_id;
    if stored_secret is null then
        raise exception 'communication_vault_key_roundtrip_failed';
    end if;

    select coalesce(max(content_key.key_version), 0) + 1 into next_version
    from communications_secure.content_keys content_key
    where content_key.workspace_id = target_workspace
      and content_key.scope_kind = target_scope_kind
      and content_key.scope_id = target_scope_id;

    insert into communications_secure.content_keys(
        workspace_id, scope_kind, scope_id, key_version, vault_secret_id
    ) values (
        target_workspace, target_scope_kind, target_scope_id, next_version, generated_vault_id
    ) returning id into key_id;

    key_version := next_version;
    secret := stored_secret;
    return next;
end;
$$;

create or replace function public.communication_create_file_key(
    p_workspace_id uuid,
    p_scope_kind text,
    p_scope_id uuid,
    p_storage_path text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    generated_secret text;
    generated_vault_id uuid;
    stored_secret text;
begin
    if auth.role() <> 'authenticated' or auth.uid() is null or not public.current_session_is_aal2() then
        raise exception 'aal2_required';
    end if;
    if p_scope_kind = 'client' then
        if not public.is_workspace_member(p_workspace_id) or not exists (
            select 1 from public.relationships where workspace_id = p_workspace_id and id = p_scope_id
        ) then raise exception 'file_scope_forbidden'; end if;
    elsif p_scope_kind = 'native' then
        if not public.native_conversation_can_write(p_scope_id, auth.uid()) or not exists (
            select 1 from public.workspace_native_conversations where workspace_id = p_workspace_id and id = p_scope_id
        ) then raise exception 'file_scope_forbidden'; end if;
    else
        raise exception 'invalid_file_scope';
    end if;
    if p_storage_path = '' or p_storage_path not like p_workspace_id::text || '/%' then
        raise exception 'invalid_storage_path';
    end if;
    if exists (select 1 from communications_secure.encrypted_files where storage_path = p_storage_path) then
        raise exception 'file_key_already_exists';
    end if;

    generated_secret := pg_catalog.encode(extensions.gen_random_bytes(32), 'base64');
    select vault.create_secret(
        generated_secret,
        'communication-file-' || extensions.gen_random_uuid()::text,
        'Betelgeze encrypted Communications file key'
    ) into generated_vault_id;

    select decrypted.secret into stored_secret
    from vault.decrypted_secrets decrypted
    where decrypted.id = generated_vault_id;
    if stored_secret is null then
        raise exception 'communication_vault_key_roundtrip_failed';
    end if;

    insert into communications_secure.encrypted_files(storage_path, workspace_id, scope_kind, scope_id, vault_secret_id, created_by)
    values (p_storage_path, p_workspace_id, p_scope_kind, p_scope_id, generated_vault_id, auth.uid());
    return stored_secret;
end;
$$;

revoke all on function public.communication_create_file_key(uuid, text, uuid, text) from public, anon, service_role;
grant execute on function public.communication_create_file_key(uuid, text, uuid, text) to authenticated;

create or replace function public.communication_create_inbound_file_key(
    p_workspace_id uuid,
    p_relationship_id uuid,
    p_storage_path text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    generated_secret text;
    generated_vault_id uuid;
    stored_secret text;
begin
    if auth.role() <> 'service_role' then raise exception 'service_role_required'; end if;
    if not exists (select 1 from public.relationships where workspace_id = p_workspace_id and id = p_relationship_id)
       or p_storage_path = '' or p_storage_path not like p_workspace_id::text || '/%' then
        raise exception 'invalid_file_scope';
    end if;

    generated_secret := pg_catalog.encode(extensions.gen_random_bytes(32), 'base64');
    select vault.create_secret(
        generated_secret,
        'communication-file-' || extensions.gen_random_uuid()::text,
        'Betelgeze encrypted inbound Communications file key'
    ) into generated_vault_id;

    select decrypted.secret into stored_secret
    from vault.decrypted_secrets decrypted
    where decrypted.id = generated_vault_id;
    if stored_secret is null then
        raise exception 'communication_vault_key_roundtrip_failed';
    end if;

    insert into communications_secure.encrypted_files(storage_path, workspace_id, scope_kind, scope_id, vault_secret_id)
    values (p_storage_path, p_workspace_id, 'client', p_relationship_id, generated_vault_id);
    return stored_secret;
end;
$$;

revoke all on function public.communication_create_inbound_file_key(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.communication_create_inbound_file_key(uuid, uuid, text) to service_role;

-- A damaged row must not prevent every participant from opening the wider
-- conversation. These helpers deliberately return null without logging or
-- exposing content; RPCs below omit only the row that cannot be authenticated.
create or replace function communications_secure.try_decrypt_text(ciphertext bytea, secret text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if ciphertext is null or secret is null then return null; end if;
    return extensions.pgp_sym_decrypt(ciphertext, secret);
exception when others then
    return null;
end;
$$;

create or replace function communications_secure.try_decrypt_jsonb(ciphertext bytea, secret text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    plaintext text;
begin
    plaintext := communications_secure.try_decrypt_text(ciphertext, secret);
    if plaintext is null then return null; end if;
    return plaintext::jsonb;
exception when others then
    return null;
end;
$$;

create or replace function public.communication_client_messages(
    p_workspace_id uuid,
    p_relationship_id uuid default null,
    p_limit integer default 2000
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
    with decoded as materialized (
        select
            message.*,
            communications_secure.try_decrypt_text(message.body_ciphertext, decrypted.secret) as decrypted_body,
            communications_secure.try_decrypt_jsonb(message.raw_payload_ciphertext, decrypted.secret) as decrypted_raw_payload
        from public.client_messages message
        left join communications_secure.content_keys content_key on content_key.id = message.body_key_id
        left join vault.decrypted_secrets decrypted on decrypted.id = content_key.vault_secret_id
        where auth.role() = 'authenticated'
          and auth.uid() is not null
          and public.current_session_is_aal2()
          and public.is_workspace_member(p_workspace_id)
          and message.workspace_id = p_workspace_id
          and (p_relationship_id is null or message.relationship_id = p_relationship_id)
    )
    select
        message.id,
        message.client_request_id,
        message.relationship_id,
        case when message.body_ciphertext is null then message.body else message.decrypted_body end,
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
        case when message.raw_payload_ciphertext is null then message.raw_payload else message.decrypted_raw_payload end
    from decoded message
    where (message.body_ciphertext is null or message.decrypted_body is not null)
      and (message.raw_payload_ciphertext is null or message.decrypted_raw_payload is not null)
    order by message.created_at desc
    limit least(greatest(coalesce(p_limit, 2000), 1), 4000);
$$;

revoke all on function public.communication_client_messages(uuid, uuid, integer) from public, anon, service_role;
grant execute on function public.communication_client_messages(uuid, uuid, integer) to authenticated;

create or replace function public.communication_native_messages(
    p_workspace_id uuid,
    p_conversation_id uuid default null,
    p_limit integer default 4000
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
    with readable as materialized (
        select
            message.*,
            decrypted.secret
        from public.workspace_native_messages message
        join public.workspace_native_conversations conversation on conversation.id = message.conversation_id
        left join communications_secure.content_keys content_key on content_key.id = message.body_key_id
        left join vault.decrypted_secrets decrypted on decrypted.id = content_key.vault_secret_id
        left join public.workspace_native_conversation_visibility visibility
          on visibility.conversation_id = message.conversation_id and visibility.user_id = auth.uid()
        where auth.role() = 'authenticated'
          and auth.uid() is not null
          and public.current_session_is_aal2()
          and message.workspace_id = p_workspace_id
          and (p_conversation_id is null or message.conversation_id = p_conversation_id)
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
          )
          and public.is_workspace_member(p_workspace_id)
    ), decoded as materialized (
        select
            message.*,
            communications_secure.try_decrypt_text(message.body_ciphertext, message.secret) as decrypted_body,
            communications_secure.try_decrypt_jsonb(message.attachment_ciphertext, message.secret) as decrypted_attachment
        from readable message
    )
    select
        message.id,
        message.client_request_id,
        message.conversation_id,
        message.sender_user_id,
        message.sender_workspace_role,
        case when message.body_ciphertext is null then coalesce(message.body, '') else message.decrypted_body end,
        message.reply_to_message_id,
        case when message.attachment_ciphertext is null then message.attachment else message.decrypted_attachment end,
        message.created_at
    from decoded message
    where (message.body_ciphertext is null or message.decrypted_body is not null)
      and (message.attachment_ciphertext is null or message.decrypted_attachment is not null)
    order by message.created_at desc
    limit least(greatest(coalesce(p_limit, 4000), 1), 4000);
$$;

revoke all on function public.communication_native_messages(uuid, uuid, integer) from public, anon, service_role;
grant execute on function public.communication_native_messages(uuid, uuid, integer) to authenticated;

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
    with decoded as materialized (
        select
            message.*,
            communications_secure.try_decrypt_text(message.body_ciphertext, decrypted.secret) as decrypted_body,
            communications_secure.try_decrypt_jsonb(message.raw_payload_ciphertext, decrypted.secret) as decrypted_raw_payload
        from public.client_messages message
        left join communications_secure.content_keys content_key on content_key.id = message.body_key_id
        left join vault.decrypted_secrets decrypted on decrypted.id = content_key.vault_secret_id
        where auth.role() = 'authenticated'
          and auth.uid() is not null
          and public.current_session_is_aal2()
          and public.is_workspace_member(p_workspace_id)
          and message.workspace_id = p_workspace_id
          and message.id = p_message_id
    )
    select
        message.id,
        message.client_request_id,
        message.relationship_id,
        case when message.body_ciphertext is null then message.body else message.decrypted_body end,
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
        case when message.raw_payload_ciphertext is null then message.raw_payload else message.decrypted_raw_payload end
    from decoded message
    where (message.body_ciphertext is null or message.decrypted_body is not null)
      and (message.raw_payload_ciphertext is null or message.decrypted_raw_payload is not null);
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
    with readable as materialized (
        select
            message.*,
            decrypted.secret
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
          )
    ), decoded as materialized (
        select
            message.*,
            communications_secure.try_decrypt_text(message.body_ciphertext, message.secret) as decrypted_body,
            communications_secure.try_decrypt_jsonb(message.attachment_ciphertext, message.secret) as decrypted_attachment
        from readable message
    )
    select
        message.id,
        message.client_request_id,
        message.conversation_id,
        message.sender_user_id,
        message.sender_workspace_role,
        case when message.body_ciphertext is null then coalesce(message.body, '') else message.decrypted_body end,
        message.reply_to_message_id,
        case when message.attachment_ciphertext is null then message.attachment else message.decrypted_attachment end,
        message.created_at
    from decoded message
    where (message.body_ciphertext is null or message.decrypted_body is not null)
      and (message.attachment_ciphertext is null or message.decrypted_attachment is not null);
$$;

revoke all on function public.communication_native_message(uuid, uuid) from public, anon, service_role;
grant execute on function public.communication_native_message(uuid, uuid) to authenticated;
