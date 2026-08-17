import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("chat push subscriptions and Communications sessions use server-only durable storage", async () => {
    const migration = await readFile("supabase/migrations/20260816170000_chat_web_push.sql", "utf8")
    assert.match(migration, /create table if not exists public\.web_push_subscriptions/)
    assert.match(migration, /create table if not exists public\.communications_active_sessions/)
    assert.match(migration, /alter table public\.web_push_subscriptions enable row level security/)
    assert.match(migration, /revoke all on public\.web_push_subscriptions from anon, authenticated/)
    assert.match(migration, /references auth\.users\(id\) on delete cascade/)
})

test("profile toggle registers from the user gesture and recovers after returning from device settings", async () => {
    const [settings, profile, subscriptionRoute] = await Promise.all([
        readFile("components/account/PushNotificationSettings.tsx", "utf8"),
        readFile("components/account/ProfileSettings.tsx", "utf8"),
        readFile("app/api/push/subscriptions/route.ts", "utf8"),
    ])
    assert.match(profile, /<PushNotificationSettings/)
    assert.match(settings, /userVisibleOnly: true/)
    assert.match(settings, /pushManager\.subscribe/)
    assert.match(settings, /window\.addEventListener\("focus", refresh\)/)
    assert.match(settings, /document\.addEventListener\("visibilitychange", refresh\)/)
    assert.doesNotMatch(settings, /if \(permission !== "granted"\)/)
    assert.match(settings, /h-11 min-h-0 w-14/)
    assert.match(settings, /sm:h-7 sm:w-12/)
    assert.match(settings, /relative block h-7 w-12 rounded-full/)
    assert.match(settings, /Add Betelgeze to your Home Screen/)
    assert.match(settings, /Notification previews show the chat name and message/)
    assert.match(settings, /role="switch"/)
    assert.match(subscriptionRoute, /getCurrentUser\(\)/)
    assert.match(subscriptionRoute, /WEB_PUSH|webPushPublicKey/)
    assert.match(subscriptionRoute, /httpOnly: true/)
})

test("chat push delivery is suppressed only for the exact visible live conversation", async () => {
    const [delivery, tracker, panel, contextMigration] = await Promise.all([
        readFile("lib/push/chat-notifications.ts", "utf8"),
        readFile("components/communications/CommunicationsActivityTracker.tsx", "utf8"),
        readFile("components/communications/CommunicationsPanel.tsx", "utf8"),
        readFile("supabase/migrations/20260817160000_reliable_communications_sessions.sql", "utf8"),
    ])
    assert.match(delivery, /communications_active_sessions/)
    assert.match(delivery, /activeUsers\.has\(subscription\.user_id\)/)
    assert.match(delivery, /eq\("workspace_id", push\.workspaceId\)/)
    assert.match(delivery, /eq\("conversation_kind", push\.conversationKind\)/)
    assert.match(delivery, /eq\("conversation_id", push\.conversationId\)/)
    assert.match(delivery, /eq\("connection_live", true\)/)
    assert.match(delivery, /workspace_native_conversation_participants/)
    assert.match(delivery, /userId !== input\.senderUserId/)
    assert.match(delivery, /workspace_memberships/)
    assert.match(delivery, /workspace_native_messages/)
    assert.match(delivery, /client_messages/)
    assert.match(delivery, /primary_person_name, business_name/)
    assert.match(delivery, /title: notificationLine\(chatName, 80\)/)
    assert.match(delivery, /body: notificationLine\(messageBody, 240\)/)
    assert.doesNotMatch(delivery, /body: `From /)
    assert.match(tracker, /useWorkspaceTabActive\(\)/)
    assert.match(tracker, /document\.visibilityState === "visible"/)
    assert.match(tracker, /connectionState === "live"/)
    assert.match(tracker, /navigator\.sendBeacon/)
    assert.match(panel, /<CommunicationsActivityTracker/)
    assert.match(contextMigration, /conversation_kind/)
    assert.match(contextMigration, /connection_live/)
})

test("native, WhatsApp, and Twilio message writes schedule chat pushes after their responses", async () => {
    const [nativeRoute, whatsappRoute, twilioRoute, worker] = await Promise.all([
        readFile("app/api/workspaces/[workspaceSlug]/communications/native/messages/route.ts", "utf8"),
        readFile("app/api/client-messages/meta/whatsapp/route.ts", "utf8"),
        readFile("app/api/client-messages/twilio/route.ts", "utf8"),
        readFile("public/sw.js", "utf8"),
    ])
    assert.match(nativeRoute, /after\(\(\) => notifyNativeChatMessage/)
    assert.match(whatsappRoute, /after\(\(\) => notifyClientChatMessage/)
    assert.match(twilioRoute, /after\(\(\) => notifyClientChatMessage/)
    assert.match(worker, /self\.addEventListener\("push"/)
    assert.match(worker, /payload\.url\.startsWith\("\/"\)/)
    assert.match(worker, /conversationId/)
    assert.match(worker, /new URL\(targetPath, self\.location\.origin\)\.href/)
    assert.match(worker, /await existingClient\.navigate\(targetUrl\)/)
    assert.match(worker, /navigatedClient \? navigatedClient\.focus\(\)/)
})

test("chat notifications aggregate per conversation, quiet rapid replacements, and clear only after reads persist", async () => {
    const [delivery, worker, clientWorkspace, teamWorkspace, browserNotifications, notificationGate] = await Promise.all([
        readFile("lib/push/chat-notifications.ts", "utf8"),
        readFile("public/sw.js", "utf8"),
        readFile("components/communications/CommunicationsWorkspace.tsx", "utf8"),
        readFile("components/communications/TeamCommunicationsWorkspace.tsx", "utf8"),
        readFile("lib/push/browser-notifications.ts", "utf8"),
        readFile("supabase/migrations/20260817190000_ios_chat_notification_gate.sql", "utf8"),
    ])
    assert.match(delivery, /chatNotificationBody\(push\.body, unreadCount\)/)
    assert.match(delivery, /communication_read_cursors/)
    assert.match(delivery, /workspace_native_read_cursors/)
    assert.match(delivery, /new messages/)
    assert.match(delivery, /messageCreatedAt/)
    assert.match(delivery, /claimChatPush\(subscription\.id, push\)/)
    assert.match(delivery, /clear_read_chat_push_notifications/)
    assert.match(worker, /getNotifications\(\{ tag \}\)/)
    assert.match(worker, /now - previousMessageAt >= 60_000/)
    assert.match(worker, /unreadCount/)
    assert.match(clientWorkspace, /dismissReadChatNotification\(cursor\.relationshipId, result\.notificationReadThrough\)/)
    assert.match(teamWorkspace, /dismissReadChatNotification\(cursor\.conversationId, result\.notificationReadThrough\)/)
    assert.match(browserNotifications, /getNotifications\(\)/)
    assert.match(browserNotifications, /data\.conversationId !== conversationId/)
    assert.match(browserNotifications, /messageCreatedAt <= readThroughCreatedAt/)
    assert.match(notificationGate, /primary key \(subscription_id, conversation_kind, conversation_id\)/)
    assert.match(notificationGate, /on conflict \(subscription_id, conversation_kind, conversation_id\) do nothing/)
    assert.match(notificationGate, /read_through >= p_message_created_at/)
    assert.match(notificationGate, /clear_read_chat_push_notifications/)
})
