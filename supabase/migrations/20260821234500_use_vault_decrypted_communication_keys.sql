begin;

-- Vault's decrypted_secrets view exposes both the encrypted storage value in
-- `secret` and the usable plaintext in `decrypted_secret`. Repair the short
-- cut-over window where the encrypted storage value was used as the pgcrypto
-- passphrase. The plaintext is transformed entirely inside Postgres and is
-- never selected into a result set or written to a plaintext column.

update public.workspace_native_messages message
set body_ciphertext = case
        when message.body_ciphertext is not null
         and communications_secure.try_decrypt_text(message.body_ciphertext, vault_secret.decrypted_secret) is null
         and communications_secure.try_decrypt_text(message.body_ciphertext, vault_secret.secret) is not null
            then extensions.pgp_sym_encrypt(
                extensions.pgp_sym_decrypt(message.body_ciphertext, vault_secret.secret),
                vault_secret.decrypted_secret,
                'cipher-algo=aes256, compress-algo=0'
            )
        else message.body_ciphertext
    end,
    attachment_ciphertext = case
        when message.attachment_ciphertext is not null
         and communications_secure.try_decrypt_text(message.attachment_ciphertext, vault_secret.decrypted_secret) is null
         and communications_secure.try_decrypt_text(message.attachment_ciphertext, vault_secret.secret) is not null
            then extensions.pgp_sym_encrypt(
                extensions.pgp_sym_decrypt(message.attachment_ciphertext, vault_secret.secret),
                vault_secret.decrypted_secret,
                'cipher-algo=aes256, compress-algo=0'
            )
        else message.attachment_ciphertext
    end
from communications_secure.content_keys content_key
join vault.decrypted_secrets vault_secret on vault_secret.id = content_key.vault_secret_id
where content_key.id = message.body_key_id
  and (
      (
          message.body_ciphertext is not null
          and communications_secure.try_decrypt_text(message.body_ciphertext, vault_secret.decrypted_secret) is null
          and communications_secure.try_decrypt_text(message.body_ciphertext, vault_secret.secret) is not null
      )
      or
      (
          message.attachment_ciphertext is not null
          and communications_secure.try_decrypt_text(message.attachment_ciphertext, vault_secret.decrypted_secret) is null
          and communications_secure.try_decrypt_text(message.attachment_ciphertext, vault_secret.secret) is not null
      )
  );

update public.client_messages message
set body_ciphertext = case
        when message.body_ciphertext is not null
         and communications_secure.try_decrypt_text(message.body_ciphertext, vault_secret.decrypted_secret) is null
         and communications_secure.try_decrypt_text(message.body_ciphertext, vault_secret.secret) is not null
            then extensions.pgp_sym_encrypt(
                extensions.pgp_sym_decrypt(message.body_ciphertext, vault_secret.secret),
                vault_secret.decrypted_secret,
                'cipher-algo=aes256, compress-algo=0'
            )
        else message.body_ciphertext
    end,
    raw_payload_ciphertext = case
        when message.raw_payload_ciphertext is not null
         and communications_secure.try_decrypt_text(message.raw_payload_ciphertext, vault_secret.decrypted_secret) is null
         and communications_secure.try_decrypt_text(message.raw_payload_ciphertext, vault_secret.secret) is not null
            then extensions.pgp_sym_encrypt(
                extensions.pgp_sym_decrypt(message.raw_payload_ciphertext, vault_secret.secret),
                vault_secret.decrypted_secret,
                'cipher-algo=aes256, compress-algo=0'
            )
        else message.raw_payload_ciphertext
    end
from communications_secure.content_keys content_key
join vault.decrypted_secrets vault_secret on vault_secret.id = content_key.vault_secret_id
where content_key.id = message.body_key_id
  and (
      (
          message.body_ciphertext is not null
          and communications_secure.try_decrypt_text(message.body_ciphertext, vault_secret.decrypted_secret) is null
          and communications_secure.try_decrypt_text(message.body_ciphertext, vault_secret.secret) is not null
      )
      or
      (
          message.raw_payload_ciphertext is not null
          and communications_secure.try_decrypt_text(message.raw_payload_ciphertext, vault_secret.decrypted_secret) is null
          and communications_secure.try_decrypt_text(message.raw_payload_ciphertext, vault_secret.secret) is not null
      )
  );

update public.communication_message_deliveries delivery
set raw_payload_ciphertext = extensions.pgp_sym_encrypt(
    extensions.pgp_sym_decrypt(delivery.raw_payload_ciphertext, vault_secret.secret),
    vault_secret.decrypted_secret,
    'cipher-algo=aes256, compress-algo=0'
)
from communications_secure.content_keys content_key
join vault.decrypted_secrets vault_secret on vault_secret.id = content_key.vault_secret_id
where content_key.id = delivery.raw_payload_key_id
  and delivery.raw_payload_ciphertext is not null
  and communications_secure.try_decrypt_text(delivery.raw_payload_ciphertext, vault_secret.decrypted_secret) is null
  and communications_secure.try_decrypt_text(delivery.raw_payload_ciphertext, vault_secret.secret) is not null;

-- Correct the exact Vault reads used by message keys, file keys, participant
-- RPCs, media grants, and moderation. pg_get_functiondef preserves each
-- function's existing signature, ownership semantics, and grants. The block
-- fails closed if any expected function does not contain the old column read.
do $$
declare
    target_name text;
    target_function regprocedure;
    original_definition text;
    corrected_definition text;
begin
    foreach target_name in array array[
        'communications_secure.get_or_create_content_key(uuid,text,uuid)',
        'public.communication_create_file_key(uuid,text,uuid,text)',
        'public.communication_create_inbound_file_key(uuid,uuid,text)',
        'public.communication_file_key_for_user(text)',
        'public.communication_redeem_media_grant(text,text)',
        'public.delete_native_message_for_me(uuid,uuid)',
        'public.communication_client_messages(uuid,uuid,integer)',
        'public.communication_native_messages(uuid,uuid,integer)',
        'public.communication_client_message(uuid,uuid)',
        'public.communication_native_message(uuid,uuid)'
    ] loop
        target_function := pg_catalog.to_regprocedure(target_name);
        if target_function is null then
            raise exception 'missing_communication_key_function: %', target_name;
        end if;

        original_definition := pg_catalog.pg_get_functiondef(target_function);
        corrected_definition := pg_catalog.replace(
            original_definition,
            'decrypted.secret',
            'decrypted.decrypted_secret'
        );
        corrected_definition := pg_catalog.replace(
            corrected_definition,
            'message.secret',
            'message.decrypted_secret'
        );

        if corrected_definition = original_definition then
            raise exception 'communication_key_function_was_not_corrected: %', target_name;
        end if;
        execute corrected_definition;
    end loop;
end;
$$;

-- Do not commit a partial repair. Every encrypted field that was readable
-- before this migration must now authenticate with Vault's plaintext key.
do $$
begin
    if exists (
        select 1
        from public.workspace_native_messages message
        join communications_secure.content_keys content_key on content_key.id = message.body_key_id
        join vault.decrypted_secrets vault_secret on vault_secret.id = content_key.vault_secret_id
        where (
            message.body_ciphertext is not null
            and communications_secure.try_decrypt_text(message.body_ciphertext, vault_secret.decrypted_secret) is null
            and communications_secure.try_decrypt_text(message.body_ciphertext, vault_secret.secret) is not null
        ) or (
            message.attachment_ciphertext is not null
            and communications_secure.try_decrypt_text(message.attachment_ciphertext, vault_secret.decrypted_secret) is null
            and communications_secure.try_decrypt_text(message.attachment_ciphertext, vault_secret.secret) is not null
        )
    ) then
        raise exception 'native_communication_key_repair_incomplete';
    end if;

    if exists (
        select 1
        from public.client_messages message
        join communications_secure.content_keys content_key on content_key.id = message.body_key_id
        join vault.decrypted_secrets vault_secret on vault_secret.id = content_key.vault_secret_id
        where (
            message.body_ciphertext is not null
            and communications_secure.try_decrypt_text(message.body_ciphertext, vault_secret.decrypted_secret) is null
            and communications_secure.try_decrypt_text(message.body_ciphertext, vault_secret.secret) is not null
        ) or (
            message.raw_payload_ciphertext is not null
            and communications_secure.try_decrypt_text(message.raw_payload_ciphertext, vault_secret.decrypted_secret) is null
            and communications_secure.try_decrypt_text(message.raw_payload_ciphertext, vault_secret.secret) is not null
        )
    ) then
        raise exception 'client_communication_key_repair_incomplete';
    end if;
end;
$$;

commit;
