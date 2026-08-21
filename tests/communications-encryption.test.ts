import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("new Communications content is encrypted with non-database root keys", async () => {
    const [migration, hardeningMigration, realtimeMigration, keyRoundtripMigration, clientServer, nativeServer, nativeRoute, metaWebhook, clientWorkspace, nativeWorkspace] = await Promise.all([
        readFile("supabase/migrations/20260821150000_encrypted_communications.sql", "utf8"),
        readFile("supabase/migrations/20260821153000_encrypt_communication_delivery_payloads.sql", "utf8"),
        readFile("supabase/migrations/20260821154500_encrypted_communication_realtime_reads.sql", "utf8"),
        readFile("supabase/migrations/20260821230000_fix_communication_key_roundtrip.sql", "utf8"),
        readFile("lib/communications/server.ts", "utf8"),
        readFile("lib/teams/server.ts", "utf8"),
        readFile("app/api/workspaces/[workspaceSlug]/communications/native/messages/route.ts", "utf8"),
        readFile("app/api/client-messages/meta/whatsapp/route.ts", "utf8"),
        readFile("components/communications/CommunicationsWorkspace.tsx", "utf8"),
        readFile("components/communications/TeamCommunicationsWorkspace.tsx", "utf8"),
    ])
    assert.match(migration, /create extension if not exists supabase_vault with schema vault/)
    assert.match(migration, /vault\.create_secret/)
    assert.match(migration, /body_ciphertext bytea/)
    assert.match(migration, /new\.body_ciphertext := extensions\.pgp_sym_encrypt/)
    assert.match(migration, /new\.body := null/)
    assert.match(migration, /before insert or update of body, raw_payload on public\.client_messages/)
    assert.match(migration, /before insert or update of body, attachment on public\.workspace_native_messages/)
    assert.match(migration, /revoke all on function public\.communication_client_messages\(uuid, uuid, integer\) from public, anon, service_role/)
    assert.match(migration, /revoke all on function public\.communication_native_messages\(uuid, uuid, integer\) from public, anon, service_role/)
    assert.match(migration, /auth\.role\(\) = 'authenticated'/)
    assert.match(migration, /public\.current_session_is_aal2\(\)/)
    assert.match(hardeningMigration, /raw_payload_ciphertext bytea/)
    assert.match(hardeningMigration, /create trigger encrypt_communication_delivery_payload/)
    assert.match(hardeningMigration, /message\.body_encryption_version is not null/)
    assert.match(realtimeMigration, /communication_client_message\(/)
    assert.match(realtimeMigration, /communication_native_message\(/)
    assert.match(realtimeMigration, /from public, anon, service_role/)
    assert.match(keyRoundtripMigration, /where decrypted\.id = generated_vault_id/)
    assert.match(keyRoundtripMigration, /secret := stored_secret/)
    assert.match(keyRoundtripMigration, /return stored_secret/)
    assert.match(keyRoundtripMigration, /try_decrypt_text/)
    assert.match(keyRoundtripMigration, /message\.body_ciphertext is null or message\.decrypted_body is not null/)
    assert.doesNotMatch(metaWebhook, /STATUS_MESSAGE_COLUMNS = [^\n]*raw_payload/)
    assert.match(clientServer, /rpc\("communication_client_messages"/)
    assert.match(clientServer, /rpc\("communication_client_message"/)
    assert.match(nativeServer, /rpc\("communication_native_messages"/)
    assert.match(nativeServer, /rpc\("communication_native_message"/)
    assert.match(clientWorkspace, /messageId=\$\{encodeURIComponent\(messageId\)\}/)
    assert.match(nativeWorkspace, /native\/messages\?conversationId=.*&messageId=/)
    assert.match(nativeRoute, /\.eq\("client_request_id", clientRequestId\)/)
    assert.match(nativeRoute, /loadNativeMessageForCurrentUser\(\{ workspaceId: workspace\.id, messageId: data\.id \}\)/)
    assert.doesNotMatch(nativeRoute, /const existingMessages = await loadNativeMessagesForCurrentUser/)
})

test("private chat policy, recovery views, and participant moderation are database enforced", async () => {
    const [migration, route, workspace, profile] = await Promise.all([
        readFile("supabase/migrations/20260821150000_encrypted_communications.sql", "utf8"),
        readFile("app/api/workspaces/[workspaceSlug]/communications/native/conversations/route.ts", "utf8"),
        readFile("components/communications/TeamCommunicationsWorkspace.tsx", "utf8"),
        readFile("components/workspace/WorkspaceMemberProfileModal.tsx", "utf8"),
    ])
    assert.match(route, /Only owners and admins can start private chats/)
    assert.match(migration, /only_admins_can_start_private_chats/)
    assert.match(migration, /staff_private_chats_are_not_allowed/)
    assert.match(migration, /workspace_native_conversation_visibility/)
    assert.match(migration, /clear_native_conversation_for_me/)
    assert.match(migration, /actor_role = 'admin' and sender_role = 'staff'/)
    assert.match(migration, /actor_role = 'owner' and sender_role in \('admin', 'staff'\)/)
    assert.doesNotMatch(migration.slice(migration.lastIndexOf("create or replace function public.native_conversation_can_read")), /archived_at is not null/)
    assert.match(workspace, /The other participant will keep their history/)
    assert.match(workspace, /bootstrap\.currentUserRole === "admin" && message\.senderWorkspaceRole === "staff"/)
    assert.match(profile, /canMessage \? <button/)
    assert.doesNotMatch(await readFile("lib/teams/server.ts", "utf8"), /canInspectArchived/)
})

test("new chat attachments use R2 SSE-C and client media is referenced from Assets", async () => {
    const [migration, uploads, media, cors, assets] = await Promise.all([
        readFile("supabase/migrations/20260821150000_encrypted_communications.sql", "utf8"),
        readFile("lib/onboarding/uploads.ts", "utf8"),
        readFile("app/api/client-messages/media/[...path]/route.ts", "utf8"),
        readFile("lib/onboarding/r2-cors.ts", "utf8"),
        readFile("app/[workspaceSlug]/assets/page.tsx", "utf8"),
    ])
    assert.match(migration, /communications_secure\.encrypted_files/)
    assert.match(migration, /communication_create_file_key/)
    assert.match(migration, /catalog_client_message_attachment/)
    assert.match(migration, /'client_message_attachment'/)
    assert.match(uploads, /SSECustomerAlgorithm: "AES256"/)
    assert.match(uploads, /SSECustomerKeyMD5/)
    assert.match(uploads, /createCommunicationFileKey/)
    assert.match(uploads, /const encryptMedia = Boolean\(encrypt && workspaceId && relationshipId\)/)
    assert.match(media, /createEncryptedPrivateUploadSignedRequest/)
    assert.match(media, /redeemCommunicationMediaGrant/)
    assert.match(cors, /x-amz-server-side-encryption-customer-key-md5/)
    assert.match(assets, /asset\.source_kind === "message" \? encryptedMessageAssetUrl/)
})
