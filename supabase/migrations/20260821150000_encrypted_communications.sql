-- Encrypt all new Communications content while leaving historical plaintext
-- readable. Keys live in Supabase Vault, whose root key is held separately
-- from the Postgres database and its backups.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- Vault's decrypted view must never be exposed through the anon or service
-- APIs. Only the narrowly scoped SECURITY DEFINER functions below may use it.
revoke all on table vault.secrets from public, anon, authenticated, service_role;
revoke all on table vault.decrypted_secrets from public, anon, authenticated, service_role;

create schema if not exists communications_secure;
revoke all on schema communications_secure from public, anon, authenticated, service_role;

create table if not exists communications_secure.content_keys (
    id uuid primary key default extensions.gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    scope_kind text not null check (scope_kind in ('client', 'native')),
    scope_id uuid not null,
    key_version integer not null check (key_version > 0),
    vault_secret_id uuid not null,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    retired_at timestamptz,
    unique (workspace_id, scope_kind, scope_id, key_version)
);

create unique index if not exists communication_content_keys_active_unique
on communications_secure.content_keys(workspace_id, scope_kind, scope_id)
where active;

create table if not exists communications_secure.encrypted_files (
    storage_path text primary key,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    scope_kind text not null check (scope_kind in ('client', 'native')),
    scope_id uuid not null,
    vault_secret_id uuid not null,
    created_by uuid,
    created_at timestamptz not null default now()
);

create index if not exists communication_encrypted_files_scope_idx
on communications_secure.encrypted_files(workspace_id, scope_kind, scope_id);

create table if not exists communications_secure.media_grants (
    id uuid primary key default extensions.gen_random_uuid(),
    storage_path text not null references communications_secure.encrypted_files(storage_path) on delete cascade,
    token_hash bytea not null unique,
    created_by uuid not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);

revoke all on all tables in schema communications_secure from public, anon, authenticated, service_role;
revoke all on all sequences in schema communications_secure from public, anon, authenticated, service_role;

alter table public.client_messages
    add column if not exists body_ciphertext bytea,
    add column if not exists body_key_id uuid,
    add column if not exists body_encryption_version integer,
    add column if not exists raw_payload_ciphertext bytea;

alter table public.client_messages alter column body drop not null;

alter table public.workspace_native_messages
    add column if not exists body_ciphertext bytea,
    add column if not exists body_key_id uuid,
    add column if not exists body_encryption_version integer,
    add column if not exists attachment_ciphertext bytea,
    add column if not exists sender_workspace_role text;

alter table public.workspace_native_messages alter column body drop not null;
alter table public.workspace_native_messages alter column body drop default;
alter table public.workspace_native_messages
    drop constraint if exists workspace_native_messages_body_check,
    drop constraint if exists workspace_native_messages_check,
    drop constraint if exists workspace_native_messages_attachment_check,
    drop constraint if exists workspace_native_messages_attachment_check1,
    drop constraint if exists workspace_native_messages_sender_workspace_role_check;

alter table public.workspace_native_messages
    add constraint workspace_native_messages_encrypted_content_check
    check (
        (body is not null and btrim(body) <> '')
        or body_ciphertext is not null
        or attachment is not null
        or attachment_ciphertext is not null
    ),
    add constraint workspace_native_messages_attachment_shape_check
    check (attachment is null or jsonb_typeof(attachment) = 'object'),
    add constraint workspace_native_messages_sender_workspace_role_check
    check (sender_workspace_role is null or sender_workspace_role in ('owner', 'admin', 'staff'));

update public.workspace_native_messages message
set sender_workspace_role = case when membership.role = 'member' then 'staff' else membership.role end
from public.workspace_memberships membership
where message.sender_workspace_role is null
  and membership.workspace_id = message.workspace_id
  and membership.user_id = message.sender_user_id
  and membership.role in ('owner', 'admin', 'staff', 'member');

create table if not exists public.workspace_native_conversation_visibility (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    conversation_id uuid not null,
    user_id uuid not null,
    cleared_at timestamptz not null,
    updated_at timestamptz not null default now(),
    primary key (conversation_id, user_id),
    foreign key (workspace_id, conversation_id)
        references public.workspace_native_conversations(workspace_id, id) on delete cascade
);

alter table public.workspace_native_conversation_visibility enable row level security;
revoke all on table public.workspace_native_conversation_visibility from public, anon, authenticated, service_role;

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
                when lower(entry.key) in ('body', 'body_text', 'caption', 'content', 'message_text', 'text')
                     and jsonb_typeof(entry.value) = 'string'
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

    generated_secret := encode(extensions.gen_random_bytes(32), 'base64');
    select vault.create_secret(
        generated_secret,
        'communication-content-' || extensions.gen_random_uuid()::text,
        'Betelgeze encrypted Communications content key'
    ) into generated_vault_id;

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
    secret := generated_secret;
    return next;
end;
$$;

create or replace function communications_secure.encrypt_client_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    content_key record;
    key_loaded boolean := false;
    key_scope_id uuid;
begin
    if new.workspace_id is null then
        raise exception 'encrypted_client_message_requires_workspace';
    end if;
    key_scope_id := coalesce(new.relationship_id, new.workspace_id);

    if new.body is not null then
        if char_length(new.body) > 8000 then raise exception 'message_body_too_long'; end if;
        select * into content_key
        from communications_secure.get_or_create_content_key(new.workspace_id, 'client', key_scope_id);
        key_loaded := true;
        new.body_ciphertext := extensions.pgp_sym_encrypt(new.body, content_key.secret, 'cipher-algo=aes256, compress-algo=0');
        new.body_key_id := content_key.key_id;
        new.body_encryption_version := content_key.key_version;
        new.body := null;
    end if;

    if new.raw_payload is not null and new.raw_payload <> '{}'::jsonb then
        if not key_loaded then
            select * into content_key
            from communications_secure.get_or_create_content_key(new.workspace_id, 'client', key_scope_id);
            key_loaded := true;
        end if;
        new.raw_payload_ciphertext := extensions.pgp_sym_encrypt(new.raw_payload::text, content_key.secret, 'cipher-algo=aes256, compress-algo=0');
        new.body_key_id := coalesce(new.body_key_id, content_key.key_id);
        new.body_encryption_version := coalesce(new.body_encryption_version, content_key.key_version);
        new.raw_payload := communications_secure.redact_message_json(new.raw_payload);
    end if;
    return new;
end;
$$;

drop trigger if exists encrypt_client_message on public.client_messages;
create trigger encrypt_client_message
before insert or update of body, raw_payload on public.client_messages
for each row execute function communications_secure.encrypt_client_message();

create or replace function communications_secure.catalog_client_message_attachment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    media jsonb := coalesce(new.raw_payload -> 'bridge_media', new.raw_payload -> 'attachment');
    media_kind text;
    asset_id uuid;
begin
    if new.relationship_id is null or media is null or jsonb_typeof(media) <> 'object' then return new; end if;
    media_kind := coalesce(media ->> 'kind', media ->> 'type');
    if media_kind is null or media_kind = 'sticker' or coalesce(media ->> 'storagePath', media ->> 'storage_path') is null then return new; end if;

    insert into public.assets(
        workspace_id, title, description, asset_kind, source_kind, storage_path,
        content_type, file_size, native_kind, native_id, metadata, created_by,
        created_at, updated_at
    ) values (
        new.workspace_id,
        case
            when media_kind = 'image' then 'Client chat image'
            when media_kind = 'video' then 'Client chat video'
            when media_kind = 'audio' then 'Client chat voice note'
            else 'Client chat document'
        end,
        'Encrypted attachment from a client conversation.',
        case when media_kind in ('image', 'video', 'audio') then 'media' else 'document' end,
        'message',
        coalesce(media ->> 'storagePath', media ->> 'storage_path'),
        coalesce(media ->> 'mimeType', media ->> 'mime_type'),
        case when coalesce(media ->> 'size', '') ~ '^[0-9]+$' then (media ->> 'size')::bigint else null end,
        'client_message_attachment',
        new.id,
        jsonb_build_object('relationship_id', new.relationship_id, 'direction', new.direction, 'encrypted', true),
        new.sender_user_id,
        new.created_at,
        new.created_at
    )
    on conflict (workspace_id, native_kind, native_id)
    where native_kind is not null and native_id is not null
    do update set
        storage_path = excluded.storage_path,
        content_type = excluded.content_type,
        file_size = excluded.file_size,
        metadata = public.assets.metadata || excluded.metadata,
        updated_at = excluded.updated_at
    returning id into asset_id;

    insert into public.asset_relationships(asset_id, relationship_id, workspace_id, created_at)
    values (asset_id, new.relationship_id, new.workspace_id, new.created_at)
    on conflict do nothing;
    return new;
end;
$$;

drop trigger if exists catalog_client_message_attachment on public.client_messages;
create trigger catalog_client_message_attachment
after insert or update of raw_payload on public.client_messages
for each row execute function communications_secure.catalog_client_message_attachment();

create or replace function communications_secure.encrypt_native_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    content_key record;
    key_loaded boolean := false;
begin
    if new.workspace_id is null or new.conversation_id is null then
        raise exception 'encrypted_native_message_requires_workspace_and_conversation';
    end if;

    if new.sender_workspace_role is null then
        select case when membership.role = 'member' then 'staff' else membership.role end
        into new.sender_workspace_role
        from public.workspace_memberships membership
        where membership.workspace_id = new.workspace_id and membership.user_id = new.sender_user_id;
    end if;

    if new.body is not null then
        if char_length(new.body) > 8000 then raise exception 'message_body_too_long'; end if;
        select * into content_key
        from communications_secure.get_or_create_content_key(new.workspace_id, 'native', new.conversation_id);
        key_loaded := true;
        new.body_ciphertext := extensions.pgp_sym_encrypt(new.body, content_key.secret, 'cipher-algo=aes256, compress-algo=0');
        new.body_key_id := content_key.key_id;
        new.body_encryption_version := content_key.key_version;
        new.body := null;
    end if;

    if new.attachment is not null
       and coalesce(new.attachment ->> 'kind', new.attachment ->> 'type', '') <> 'sticker' then
        if not key_loaded then
            select * into content_key
            from communications_secure.get_or_create_content_key(new.workspace_id, 'native', new.conversation_id);
            key_loaded := true;
        end if;
        new.attachment_ciphertext := extensions.pgp_sym_encrypt(new.attachment::text, content_key.secret, 'cipher-algo=aes256, compress-algo=0');
        new.body_key_id := coalesce(new.body_key_id, content_key.key_id);
        new.body_encryption_version := coalesce(new.body_encryption_version, content_key.key_version);
        new.attachment := null;
    end if;
    return new;
end;
$$;

drop trigger if exists encrypt_native_message on public.workspace_native_messages;
create trigger encrypt_native_message
before insert or update of body, attachment on public.workspace_native_messages
for each row execute function communications_secure.encrypt_native_message();

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
      and (p_relationship_id is null or message.relationship_id = p_relationship_id)
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
    order by message.created_at desc
    limit least(greatest(coalesce(p_limit, 4000), 1), 4000);
$$;

revoke all on function public.communication_native_messages(uuid, uuid, integer) from public, anon, service_role;
grant execute on function public.communication_native_messages(uuid, uuid, integer) to authenticated;

create or replace function public.clear_native_conversation_for_me(p_conversation_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.workspace_native_conversations%rowtype;
    cleared timestamptz := clock_timestamp();
begin
    if auth.role() <> 'authenticated' or auth.uid() is null or not public.current_session_is_aal2() then
        raise exception 'aal2_required';
    end if;
    select * into target from public.workspace_native_conversations where id = p_conversation_id;
    if not found or target.kind <> 'direct' or not public.native_conversation_can_read(target.id, auth.uid()) then
        raise exception 'conversation_not_found';
    end if;
    insert into public.workspace_native_conversation_visibility(workspace_id, conversation_id, user_id, cleared_at, updated_at)
    values (target.workspace_id, target.id, auth.uid(), cleared, cleared)
    on conflict (conversation_id, user_id) do update
    set cleared_at = excluded.cleared_at, updated_at = excluded.updated_at;
    return cleared;
end;
$$;

revoke all on function public.clear_native_conversation_for_me(uuid) from public, anon, service_role;
grant execute on function public.clear_native_conversation_for_me(uuid) to authenticated;

create or replace function public.delete_native_message_for_me(
    p_conversation_id uuid,
    p_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    target_message public.workspace_native_messages%rowtype;
    actor_role text;
    sender_role text;
    decrypted_attachment jsonb;
    secret text;
begin
    if auth.role() <> 'authenticated' or auth.uid() is null or not public.current_session_is_aal2() then
        raise exception 'aal2_required';
    end if;
    if not public.native_conversation_can_read(p_conversation_id, auth.uid()) then
        raise exception 'conversation_not_found';
    end if;

    select * into target_message
    from public.workspace_native_messages
    where id = p_message_id and conversation_id = p_conversation_id;
    if not found then return jsonb_build_object('deleted', true, 'attachment', null); end if;

    select case when membership.role = 'member' then 'staff' else membership.role end into actor_role
    from public.workspace_memberships membership
    where membership.workspace_id = target_message.workspace_id and membership.user_id = auth.uid();
    sender_role := target_message.sender_workspace_role;

    if target_message.sender_user_id <> auth.uid()
       and not (actor_role = 'admin' and sender_role = 'staff')
       and not (actor_role = 'owner' and sender_role in ('admin', 'staff')) then
        raise exception 'message_delete_forbidden';
    end if;

    if target_message.attachment_ciphertext is not null then
        select decrypted.secret into secret
        from communications_secure.content_keys content_key
        join vault.decrypted_secrets decrypted on decrypted.id = content_key.vault_secret_id
        where content_key.id = target_message.body_key_id;
        decrypted_attachment := extensions.pgp_sym_decrypt(target_message.attachment_ciphertext, secret)::jsonb;
    else
        decrypted_attachment := target_message.attachment;
    end if;

    delete from public.workspace_native_messages where id = target_message.id;
    return jsonb_build_object('deleted', true, 'attachment', decrypted_attachment);
end;
$$;

revoke all on function public.delete_native_message_for_me(uuid, uuid) from public, anon, service_role;
grant execute on function public.delete_native_message_for_me(uuid, uuid) to authenticated;

create or replace function communications_secure.validate_direct_conversation_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    creator_role text;
    first_role text;
    second_role text;
begin
    if new.kind <> 'direct' then return new; end if;
    select case when role = 'member' then 'staff' else role end into creator_role
    from public.workspace_memberships where workspace_id = new.workspace_id and user_id = new.created_by;
    select case when role = 'member' then 'staff' else role end into first_role
    from public.workspace_memberships where workspace_id = new.workspace_id and user_id = new.direct_user_one;
    select case when role = 'member' then 'staff' else role end into second_role
    from public.workspace_memberships where workspace_id = new.workspace_id and user_id = new.direct_user_two;
    if creator_role not in ('owner', 'admin') then raise exception 'only_admins_can_start_private_chats'; end if;
    if first_role is null or second_role is null then raise exception 'private_chat_members_must_be_active'; end if;
    if first_role = 'staff' and second_role = 'staff' then raise exception 'staff_private_chats_are_not_allowed'; end if;
    return new;
end;
$$;

drop trigger if exists validate_direct_conversation_policy on public.workspace_native_conversations;
create trigger validate_direct_conversation_policy
before insert on public.workspace_native_conversations
for each row execute function communications_secure.validate_direct_conversation_policy();

-- Existing staff-to-staff DMs remain available as read-only history.
update public.workspace_native_conversations conversation
set archived_at = coalesce(conversation.archived_at, now())
from public.workspace_memberships first_member, public.workspace_memberships second_member
where conversation.kind = 'direct'
  and first_member.workspace_id = conversation.workspace_id
  and second_member.workspace_id = conversation.workspace_id
  and first_member.user_id = conversation.direct_user_one
  and second_member.user_id = conversation.direct_user_two
  and first_member.role in ('staff', 'member')
  and second_member.role in ('staff', 'member')
  and conversation.archived_at is null;

create or replace function communications_secure.archive_disallowed_direct_conversations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.workspace_native_conversations conversation
    set archived_at = coalesce(conversation.archived_at, now())
    from public.workspace_memberships other_member
    where conversation.workspace_id = new.workspace_id
      and conversation.kind = 'direct'
      and new.role in ('staff', 'member')
      and other_member.workspace_id = new.workspace_id
      and other_member.role in ('staff', 'member')
      and other_member.user_id = case
          when conversation.direct_user_one = new.user_id then conversation.direct_user_two
          when conversation.direct_user_two = new.user_id then conversation.direct_user_one
          else null
      end;
    return new;
end;
$$;

drop trigger if exists archive_disallowed_direct_conversations on public.workspace_memberships;
create trigger archive_disallowed_direct_conversations
after insert or update of role on public.workspace_memberships
for each row execute function communications_secure.archive_disallowed_direct_conversations();

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
    generated_secret := encode(extensions.gen_random_bytes(32), 'base64');
    select vault.create_secret(
        generated_secret,
        'communication-file-' || extensions.gen_random_uuid()::text,
        'Betelgeze encrypted Communications file key'
    ) into generated_vault_id;
    insert into communications_secure.encrypted_files(storage_path, workspace_id, scope_kind, scope_id, vault_secret_id, created_by)
    values (p_storage_path, p_workspace_id, p_scope_kind, p_scope_id, generated_vault_id, auth.uid());
    return generated_secret;
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
begin
    if auth.role() <> 'service_role' then raise exception 'service_role_required'; end if;
    if not exists (select 1 from public.relationships where workspace_id = p_workspace_id and id = p_relationship_id)
       or p_storage_path = '' or p_storage_path not like p_workspace_id::text || '/%' then
        raise exception 'invalid_file_scope';
    end if;
    generated_secret := encode(extensions.gen_random_bytes(32), 'base64');
    select vault.create_secret(
        generated_secret,
        'communication-file-' || extensions.gen_random_uuid()::text,
        'Betelgeze encrypted inbound Communications file key'
    ) into generated_vault_id;
    insert into communications_secure.encrypted_files(storage_path, workspace_id, scope_kind, scope_id, vault_secret_id)
    values (p_storage_path, p_workspace_id, 'client', p_relationship_id, generated_vault_id);
    return generated_secret;
end;
$$;

revoke all on function public.communication_create_inbound_file_key(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.communication_create_inbound_file_key(uuid, uuid, text) to service_role;

create or replace function public.communication_file_key_for_user(p_storage_path text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select decrypted.secret
    from communications_secure.encrypted_files encrypted_file
    join vault.decrypted_secrets decrypted on decrypted.id = encrypted_file.vault_secret_id
    where encrypted_file.storage_path = p_storage_path
      and auth.role() = 'authenticated'
      and auth.uid() is not null
      and public.current_session_is_aal2()
      and (
          (encrypted_file.scope_kind = 'client' and public.is_workspace_member(encrypted_file.workspace_id))
          or
          (encrypted_file.scope_kind = 'native' and public.native_conversation_can_read(encrypted_file.scope_id, auth.uid()))
      );
$$;

revoke all on function public.communication_file_key_for_user(text) from public, anon, service_role;
grant execute on function public.communication_file_key_for_user(text) to authenticated;

create or replace function public.communication_create_media_grant(p_storage_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    token text;
begin
    if public.communication_file_key_for_user(p_storage_path) is null then return null; end if;
    token := encode(extensions.gen_random_bytes(32), 'hex');
    delete from communications_secure.media_grants where expires_at <= now();
    insert into communications_secure.media_grants(storage_path, token_hash, created_by, expires_at)
    values (p_storage_path, extensions.digest(token, 'sha256'), auth.uid(), now() + interval '2 hours');
    return token;
end;
$$;

revoke all on function public.communication_create_media_grant(text) from public, anon, service_role;
grant execute on function public.communication_create_media_grant(text) to authenticated;

create or replace function public.communication_redeem_media_grant(p_storage_path text, p_token text)
returns text
language sql
security definer
set search_path = ''
as $$
    select decrypted.secret
    from communications_secure.media_grants media_grant
    join communications_secure.encrypted_files encrypted_file on encrypted_file.storage_path = media_grant.storage_path
    join vault.decrypted_secrets decrypted on decrypted.id = encrypted_file.vault_secret_id
    where auth.role() = 'service_role'
      and media_grant.storage_path = p_storage_path
      and media_grant.token_hash = extensions.digest(p_token, 'sha256')
      and media_grant.expires_at > now();
$$;

revoke all on function public.communication_redeem_media_grant(text, text) from public, anon, authenticated;
grant execute on function public.communication_redeem_media_grant(text, text) to service_role;

-- Keys rotate for future team messages whenever team membership changes. Old
-- key versions remain available to current authorized members for recovery.
create or replace function communications_secure.rotate_team_content_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    target_team uuid := case when tg_op = 'DELETE' then old.team_id else new.team_id end;
    target_workspace uuid := case when tg_op = 'DELETE' then old.workspace_id else new.workspace_id end;
    target_conversation uuid;
    generated_secret text;
    generated_vault_id uuid;
    next_version integer;
begin
    select id into target_conversation
    from public.workspace_native_conversations
    where workspace_id = target_workspace and team_id = target_team and kind = 'team';
    if target_conversation is null or not exists (
        select 1 from communications_secure.content_keys
        where workspace_id = target_workspace and scope_kind = 'native' and scope_id = target_conversation and active
    ) then
        if tg_op = 'DELETE' then return old; end if;
        return new;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(target_workspace::text || ':native:' || target_conversation::text, 0)
    );
    update communications_secure.content_keys
    set active = false, retired_at = now()
    where workspace_id = target_workspace and scope_kind = 'native' and scope_id = target_conversation and active;
    select coalesce(max(key_version), 0) + 1 into next_version
    from communications_secure.content_keys
    where workspace_id = target_workspace and scope_kind = 'native' and scope_id = target_conversation;
    generated_secret := encode(extensions.gen_random_bytes(32), 'base64');
    select vault.create_secret(
        generated_secret,
        'communication-content-' || extensions.gen_random_uuid()::text,
        'Betelgeze rotated team Communications content key'
    ) into generated_vault_id;
    insert into communications_secure.content_keys(workspace_id, scope_kind, scope_id, key_version, vault_secret_id)
    values (target_workspace, 'native', target_conversation, next_version, generated_vault_id);
    if tg_op = 'DELETE' then return old; end if;
    return new;
end;
$$;

drop trigger if exists rotate_team_content_key on public.workspace_team_members;
create trigger rotate_team_content_key
after insert or delete on public.workspace_team_members
for each row execute function communications_secure.rotate_team_content_key();

-- Service-role access checks remain available to route handlers, but actual
-- message plaintext is only returned by the authenticated functions above.
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
            (conversation.kind = 'team' and exists (
                select 1 from public.workspace_team_members team_member
                where team_member.team_id = conversation.team_id and team_member.user_id = target_user
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

revoke all on function public.native_conversation_can_read(uuid, uuid) from public, anon;
revoke all on function public.native_conversation_can_write(uuid, uuid) from public, anon;
grant execute on function public.native_conversation_can_read(uuid, uuid) to authenticated, service_role;
grant execute on function public.native_conversation_can_write(uuid, uuid) to authenticated, service_role;
