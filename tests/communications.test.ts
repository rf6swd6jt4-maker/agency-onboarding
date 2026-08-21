import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("Communications is an opaque local-first client chat workspace", async () => {
    const [page, workspace, bootstrap] = await Promise.all([
        readFile("app/[workspaceSlug]/communications/page.tsx", "utf8"),
        readFile("components/communications/CommunicationsWorkspace.tsx", "utf8"),
        readFile("lib/communications/bootstrap.ts", "utf8"),
    ])
    assert.match(page, /fixed inset-0 overflow-hidden bg-black/)
    assert.doesNotMatch(page, /WorkspaceBanner|PanelTabs|area=/)
    assert.match(bootstrap, /relationship\.status !== "archived"/)
    assert.doesNotMatch(bootstrap, /relationship\.status !== "archived" && relationship\.client_id/)
    assert.match(workspace, /useState\(bootstrap\.selectedConversationId\)/)
    assert.match(workspace, /window\.history\.replaceState/)
    assert.match(workspace, /type: "location-replace"/)
    assert.match(workspace, /overflow-y-auto overscroll-contain/)
    assert.match(workspace, /postgres_changes/)
    assert.doesNotMatch(workspace, /presenceState|channel\.track|Team presence/)
    assert.doesNotMatch(workspace, /<h1[^>]*>Communications<\/h1>|Search client chats/)
    assert.doesNotMatch(workspace, />Client chats</)
    assert.match(workspace, /role="tab" aria-selected="true"[^>]*>Clients/)
    assert.match(workspace, /role="tab" aria-selected="false" onClick=\{onOpenTeam\}/)
    assert.match(workspace, /aria-label="Search conversations"/)
    assert.match(workspace, /aria-label=\{`Open \$\{selected\.title\} relationship`\}/)
    assert.doesNotMatch(workspace, />Relationship<\/Link>/)
    assert.match(workspace, /DoubleDeliveryCheckIcon/)
    assert.doesNotMatch(workspace, />✓✓<\/span>/)
    assert.match(workspace, /communication_read_cursors/)
    assert.match(workspace, /status: "sending"/)
    assert.match(workspace, /send_uncertain/)
    assert.match(workspace, /message\.direction === "outbound" \? "justify-end" : "justify-start"/)
})

test("Communications avatar controls stay circular on mobile", async () => {
    const [clients, team, avatar] = await Promise.all([
        readFile("components/communications/CommunicationsWorkspace.tsx", "utf8"),
        readFile("components/communications/TeamCommunicationsWorkspace.tsx", "utf8"),
        readFile("components/account/Avatar.tsx", "utf8"),
    ])

    assert.match(clients, /readers\.map\(\(person\) => <button data-icon-button/)
    assert.match(team, /readers\.map\(\(person\) => <button data-icon-button/)
    assert.match(team, /<button data-icon-button type="button" onClick=\{\(\) => openWorkspaceMemberProfile\(message\.senderUserId\)\}/)
    assert.match(avatar, /object-cover object-center/)
    assert.match(avatar, /objectPosition: "50% 50%"/)
})

test("client and native unread chat indicators use the neutral white accent", async () => {
    const [clients, team] = await Promise.all([
        readFile("components/communications/CommunicationsWorkspace.tsx", "utf8"),
        readFile("components/communications/TeamCommunicationsWorkspace.tsx", "utf8"),
    ])

    for (const workspace of [clients, team]) {
        assert.match(workspace, /unread \? "[^"]*text-white"/)
        assert.match(workspace, /\{unread \? <span className="[^"]*bg-white[^"]*text-black"/)
        assert.doesNotMatch(workspace, /unread[^\n]*emerald/)
    }
})

test("client and team chats reconcile missed Realtime events without a reload", async () => {
    const [hook, panel, clients, team, syncRoute] = await Promise.all([
        readFile("components/communications/useReliableCommunicationsRealtime.ts", "utf8"),
        readFile("components/communications/CommunicationsPanel.tsx", "utf8"),
        readFile("components/communications/CommunicationsWorkspace.tsx", "utf8"),
        readFile("components/communications/TeamCommunicationsWorkspace.tsx", "utf8"),
        readFile("app/api/workspaces/[workspaceSlug]/communications/sync/route.ts", "utf8"),
    ])

    assert.match(hook, /status === "SUBSCRIBED"/)
    assert.match(hook, /synchronizeRef\.current\(\)/)
    assert.match(hook, /await synchronizeRef\.current\(\)\s+await refreshRealtimeAuth\(\)\s+if \(disposed\) return/)
    assert.match(hook, /\.then\(async \(\) => \{\s+await refreshRealtimeAuth\(\)/)
    assert.match(hook, /supabase\.realtime\.setAuth\(accessToken\)/)
    assert.match(hook, /window\.addEventListener\("online", recoverWhenAvailable\)/)
    assert.match(hook, /window\.addEventListener\("focus", recoverWhenAvailable\)/)
    assert.match(hook, /document\.addEventListener\("visibilitychange", recoverWhenAvailable\)/)
    assert.match(hook, /SAFETY_SYNC_MS = 20_000/)
    assert.match(hook, /RETRY_DELAYS_MS/)
    assert.match(panel, /className=\{mode === "clients" \? "absolute inset-0" : "hidden"\}/)
    assert.match(panel, /className=\{mode === "team" \? "absolute inset-0" : "hidden"\}/)
    assert.match(clients, /communications\/sync/)
    assert.match(team, /communications\/native\/conversations/)
    assert.match(syncRoute, /loadClientCommunicationsBootstrap/)
    for (const workspace of [clients, team]) {
        assert.match(workspace, /persistReadCursor/)
        assert.match(workspace, /lastReadAt > incoming\.lastReadAt/)
        assert.match(workspace, /message\.createdAt > ownCursor\.lastReadAt/)
        assert.match(workspace, /<CommunicationsConnectionStatus/)
    }
})

test("direct omnichannel sending is durable and idempotent", async () => {
    const [migration, omnichannelMigration, route, omnichannel, meta, webhook] = await Promise.all([
        readFile("supabase/migrations/20260814200000_communications_workspace.sql", "utf8"),
        readFile("supabase/migrations/20260817110000_twilio_omnichannel_messaging.sql", "utf8"),
        readFile("app/api/workspaces/[workspaceSlug]/communications/messages/route.ts", "utf8"),
        readFile("lib/client-messages/omnichannel.ts", "utf8"),
        readFile("lib/client-messages/meta-whatsapp.ts", "utf8"),
        readFile("app/api/client-messages/meta/whatsapp/route.ts", "utf8"),
    ])
    assert.match(migration, /client_messages_workspace_request_unique/)
    assert.match(migration, /communication_read_cursors/)
    assert.match(migration, /supabase_realtime add table public\.client_messages/)
    assert.match(route, /requireWorkspace\(workspaceSlug\)/)
    assert.match(route, /client_request_id/)
    assert.match(route, /existing && !\(input\?\.retry === true/)
    assert.match(route, /sendCommunicationDeliveries/)
    assert.match(omnichannel, /callbackData: input\.messageId/)
    assert.match(omnichannel, /if \(!input\.clientId\) return null/)
    assert.match(omnichannel, /relationship\.whatsapp_phone \?\? ""/)
    assert.doesNotMatch(omnichannel, /whatsapp_phone \?\? relationship\.primary_phone/)
    assert.match(omnichannelMigration, /communication_message_deliveries/)
    assert.match(meta, /biz_opaque_callback_data: callbackData/)
    assert.match(webhook, /biz_opaque_callback_data/)
    assert.match(webhook, /findStatusMessage/)
    assert.match(webhook, /\.eq\("id", callbackId\)/)
    assert.doesNotMatch(webhook, /provider_message_id\.eq\.\$\{messageId\}/)
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

test("WhatsApp receives a debounced one-way typing indicator from client chat", async () => {
    const [workspace, route, meta] = await Promise.all([
        readFile("components/communications/CommunicationsWorkspace.tsx", "utf8"),
        readFile("app/api/workspaces/[workspaceSlug]/communications/typing/route.ts", "utf8"),
        readFile("lib/client-messages/meta-whatsapp.ts", "utf8"),
    ])
    assert.match(workspace, /WHATSAPP_TYPING_DEBOUNCE_MS = 500/)
    assert.match(workspace, /WHATSAPP_TYPING_REFRESH_MS = 20_000/)
    assert.match(workspace, /selected\?\.channels\?\.includes\("meta_whatsapp"\)/)
    assert.match(workspace, /communications\/typing/)
    assert.match(route, /requireWorkspace\(workspaceSlug\)/)
    assert.match(route, /\.eq\("direction", "inbound"\)/)
    assert.match(route, /\.eq\("provider", "meta_whatsapp"\)/)
    assert.match(route, /sendMetaWhatsAppTypingIndicator/)
    assert.match(meta, /status: "read"/)
    assert.match(meta, /message_id: messageId/)
    assert.match(meta, /typing_indicator: \{ type: "text" \}/)
})

test("client chat colours only inbound WhatsApp bubbles while retaining compact delivery ticks", async () => {
    const [workspace, voiceNote] = await Promise.all([
        readFile("components/communications/CommunicationsWorkspace.tsx", "utf8"),
        readFile("components/communications/VoiceNotePlayer.tsx", "utf8"),
    ])
    assert.match(workspace, /function usesWhatsApp/)
    assert.match(workspace, /message\.direction === "inbound" && usesWhatsApp\(message\)/)
    assert.match(workspace, /bg-\[#154D37\] text-white/)
    assert.match(workspace, /message\.direction === "outbound" \? "bg-neutral-100 text-neutral-950"/)
    assert.match(workspace, /whiteOnColor=\{isWhatsAppClientMessage\}/)
    assert.match(voiceNote, /whiteOnColor \? "border-white\/15 bg-white\/10 text-white"/)
    assert.match(voiceNote, /whiteOnColor \? "bg-white\/35"/)
    assert.doesNotMatch(workspace, /#25D366/)
    assert.match(workspace, /<DoubleDeliveryCheckIcon/)
    assert.doesNotMatch(workspace, />\{label\} \{mark\}</)
})

test("logical replies remain linked while WhatsApp receives native reply context", async () => {
    const [route, omnichannel, meta, webhook, server, workspace] = await Promise.all([
        readFile("app/api/workspaces/[workspaceSlug]/communications/messages/route.ts", "utf8"),
        readFile("lib/client-messages/omnichannel.ts", "utf8"),
        readFile("lib/client-messages/meta-whatsapp.ts", "utf8"),
        readFile("app/api/client-messages/meta/whatsapp/route.ts", "utf8"),
        readFile("lib/communications/server.ts", "utf8"),
        readFile("components/communications/CommunicationsWorkspace.tsx", "utf8"),
    ])
    assert.match(webhook, /reply_to_whatsapp_message_id: replyToWhatsAppMessageId/)
    assert.match(server, /reply_to_whatsapp_message_id/)
    assert.match(route, /replyToMessageId/)
    assert.match(route, /reply_to_message_id: replyToMessageId/)
    assert.match(omnichannel, /communication_message_deliveries/)
    assert.match(omnichannel, /replyToMessageId: input\.replyToMessageId/)
    assert.match(meta, /context: replyToMessageId \? \{ message_id: replyToMessageId \} : undefined/)
    assert.match(workspace, /Replying to \{senderName\(replyingTo\)\}/)
    assert.match(workspace, /start\.maxDeltaX > 52/)
    assert.match(workspace, /start\.verticalAtMax < 42/)
    assert.match(workspace, /message\.replyToMessageId/)
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
    assert.match(outbox, /sendCommunicationDeliveries/)
    assert.match(automation, /automation_label: "Consent request"/)
    assert.match(automation, /automation_label: "Onboarding link"/)
    assert.match(automation, /callbackData: messageLog\.id/)
    assert.match(outbox, /resolveCommunicationDestinations/)
    assert.match(automation, /formatWhatsAppAttributedMessage\("Scaylup", outboundBody\)/)
    assert.match(directMessages, /select\("display_name, username"\)/)
    assert.match(directMessages, /senderName: profile\?\.display_name/)
    assert.match(profiles, /profile\?\.display_name\?\.trim\(\) \|\| profile\?\.username/)
    assert.match(migration, /add column if not exists display_name text/)
    assert.doesNotMatch(migration, /display_name text unique/)
})
