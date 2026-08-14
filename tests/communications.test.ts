import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("Communications is a fixed local-first client chat workspace", async () => {
    const [page, workspace] = await Promise.all([
        readFile("app/[workspaceSlug]/communications/page.tsx", "utf8"),
        readFile("components/communications/CommunicationsWorkspace.tsx", "utf8"),
    ])
    assert.match(page, /h-dvh overflow-hidden/)
    assert.doesNotMatch(page, /WorkspaceBanner|PanelTabs|area=/)
    assert.match(page, /relationship\.status !== "archived"/)
    assert.doesNotMatch(page, /relationship\.status !== "archived" && relationship\.client_id/)
    assert.match(workspace, /useState\(bootstrap\.selectedConversationId\)/)
    assert.match(workspace, /window\.history\.replaceState/)
    assert.match(workspace, /type: "location-replace"/)
    assert.match(workspace, /overflow-y-auto overscroll-contain/)
    assert.match(workspace, /postgres_changes/)
    assert.match(workspace, /communication_read_cursors/)
    assert.match(workspace, /status: "sending"/)
    assert.match(workspace, /send_uncertain/)
    assert.match(workspace, /message\.direction === "outbound" \? "justify-end" : "justify-start"/)
})

test("direct WhatsApp sending is durable and idempotent", async () => {
    const [migration, route, meta, webhook] = await Promise.all([
        readFile("supabase/migrations/20260814200000_communications_workspace.sql", "utf8"),
        readFile("app/api/workspaces/[workspaceSlug]/communications/messages/route.ts", "utf8"),
        readFile("lib/client-messages/meta-whatsapp.ts", "utf8"),
        readFile("app/api/client-messages/meta/whatsapp/route.ts", "utf8"),
    ])
    assert.match(migration, /client_messages_workspace_request_unique/)
    assert.match(migration, /communication_read_cursors/)
    assert.match(migration, /supabase_realtime add table public\.client_messages/)
    assert.match(route, /requireWorkspace\(workspaceSlug\)/)
    assert.match(route, /client_request_id/)
    assert.match(route, /existing && !\(input\?\.retry === true/)
    assert.match(route, /callbackData: messageId/)
    assert.match(route, /if \(!relationship\.client_id\) return \{ id: null, external_address: address \}/)
    assert.match(meta, /biz_opaque_callback_data: callbackData/)
    assert.match(webhook, /biz_opaque_callback_data/)
    assert.match(webhook, /statusOrder/)
    assert.match(webhook, /read_at:/)
    assert.match(webhook, /resolveInboundDestination/)
    assert.match(webhook, /\.in\("whatsapp_phone", relationshipAddresses\)/)
    assert.match(webhook, /relationshipId: relationship\.id/)
    assert.ok(
        webhook.indexOf('from("relationships")') <
            webhook.indexOf('from("client_communication_channels")'),
        "current relationships must win over legacy channels when a phone number is reused"
    )
})

test("automated onboarding messages are attributed and reuse their durable message log", async () => {
    const [outbox, automation, directMessages, profiles, migration] = await Promise.all([
        readFile("lib/onboarding/outbox.ts", "utf8"),
        readFile("lib/client-sales/automation.ts", "utf8"),
        readFile("app/api/workspaces/[workspaceSlug]/communications/messages/route.ts", "utf8"),
        readFile("lib/communications/server.ts", "utf8"),
        readFile("supabase/migrations/20260815001000_user_profile_display_names.sql", "utf8"),
    ])
    assert.match(outbox, /contains\("raw_payload", \{ outbox_id: row\.id \}\)/)
    assert.match(outbox, /sender_kind: "automation"/)
    assert.match(outbox, /callbackData: messageLogId/)
    assert.match(automation, /automation_label: "Consent request"/)
    assert.match(automation, /automation_label: "Onboarding link"/)
    assert.match(automation, /callbackData: messageLog\.id/)
    assert.match(outbox, /formatWhatsAppAttributedMessage\("Scaylup", body\)/)
    assert.match(automation, /formatWhatsAppAttributedMessage\("Scaylup", outboundBody\)/)
    assert.match(directMessages, /select\("display_name, username"\)/)
    assert.match(directMessages, /body: providerBody/)
    assert.match(profiles, /profile\?\.display_name \?\? profile\?\.username/)
    assert.match(migration, /add column if not exists display_name text/)
    assert.doesNotMatch(migration, /display_name text unique/)
})
