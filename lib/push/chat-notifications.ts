import "server-only"

import { createHash } from "node:crypto"
import webPush, { WebPushError, type PushSubscription } from "web-push"
import { supabaseAdmin } from "@/lib/supabase/admin"

const ACTIVE_WINDOW_MS = 60_000
const PUSH_TTL_SECONDS = 24 * 60 * 60

type StoredSubscription = {
    id: string
    user_id: string
    endpoint: string
    p256dh: string
    auth: string
}

type ChatPush = {
    workspaceId: string
    conversationKind: "client" | "native"
    messageId: string
    messageCreatedAt: string
    conversationId: string
    title: string
    body: string
    url: string
}

type ReadCursor = {
    user_id: string
    last_read_at: string
}

function vapidDetails() {
    const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim()
    const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim()
    const subject = process.env.WEB_PUSH_VAPID_SUBJECT?.trim() || "mailto:support@betelgeze.com"
    return publicKey && privateKey ? { subject, publicKey, privateKey } : null
}

export function webPushPublicKey() {
    return process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() || null
}

function notificationLine(value: unknown, limit: number) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : ""
}

function attachmentMessage(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return ""
    const attachment = value as Record<string, unknown>
    const kind = notificationLine(attachment.kind, 24)
    const fileName = notificationLine(attachment.fileName, 100)
    const label = kind === "image" ? "Photo" : kind === "video" ? "Video" : kind === "audio" ? "Voice note" : kind === "sticker" ? "Sticker" : kind === "document" ? "File" : ""
    return label ? (label === "File" && fileName ? `${label}: ${fileName}` : label) : ""
}

function missingActivityContext(error: { code?: string; message?: string } | null) {
    const message = error?.message?.toLowerCase() ?? ""
    return error?.code === "42703" || error?.code === "42P01" || error?.code === "PGRST204"
        || message.includes("conversation_kind") || message.includes("conversation_id") || message.includes("connection_live") || message.includes("workspace_id")
}

export function chatNotificationText(chatName: string, messageBody: unknown, attachment?: unknown) {
    return {
        title: notificationLine(chatName, 80) || "Betelgeze chat",
        body: notificationLine(messageBody, 240) || attachmentMessage(attachment) || "New message",
    }
}

function chatNotificationBody(preview: string, unreadCount: number) {
    return unreadCount > 1 ? `${unreadCount} new messages · ${preview}` : preview
}

async function unreadCounts(recipientUserIds: string[], push: ChatPush) {
    const counts = new Map<string, number>()
    if (recipientUserIds.length === 0) return counts

    const cursorQuery = push.conversationKind === "client"
        ? supabaseAdmin.from("communication_read_cursors").select("user_id, last_read_at").eq("workspace_id", push.workspaceId).eq("relationship_id", push.conversationId).in("user_id", recipientUserIds)
        : supabaseAdmin.from("workspace_native_read_cursors").select("user_id, last_read_at").eq("workspace_id", push.workspaceId).eq("conversation_id", push.conversationId).in("user_id", recipientUserIds)
    const { data: cursorRows, error: cursorError } = await cursorQuery
    if (cursorError) {
        console.warn("Could not resolve chat notification read cursors", cursorError)
        recipientUserIds.forEach((userId) => counts.set(userId, 1))
        return counts
    }

    const cursors = new Map(((cursorRows ?? []) as ReadCursor[]).map((cursor) => [cursor.user_id, cursor.last_read_at]))
    await Promise.all(recipientUserIds.map(async (userId) => {
        const lastReadAt = cursors.get(userId)
        let query = push.conversationKind === "client"
            ? supabaseAdmin.from("client_messages").select("id", { count: "exact", head: true }).eq("workspace_id", push.workspaceId).eq("relationship_id", push.conversationId).eq("direction", "inbound")
            : supabaseAdmin.from("workspace_native_messages").select("id", { count: "exact", head: true }).eq("workspace_id", push.workspaceId).eq("conversation_id", push.conversationId).neq("sender_user_id", userId)
        if (lastReadAt) query = query.gt("created_at", lastReadAt)
        const { count, error } = await query
        if (error) {
            console.warn("Could not count unread chat messages", error)
            counts.set(userId, 1)
            return
        }
        counts.set(userId, count ?? 1)
    }))
    return counts
}

async function deliverChatPush(recipientUserIds: string[], push: ChatPush) {
    const recipients = [...new Set(recipientUserIds.filter(Boolean))]
    if (recipients.length === 0) return

    const details = vapidDetails()
    if (!details) {
        console.warn("Chat push skipped because VAPID credentials are not configured")
        return
    }

    const activeSince = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString()
    const [{ data: activeRows, error: activeError }, { data: subscriptionRows, error: subscriptionError }] = await Promise.all([
        supabaseAdmin.from("communications_active_sessions").select("user_id").in("user_id", recipients).eq("workspace_id", push.workspaceId).eq("conversation_kind", push.conversationKind).eq("conversation_id", push.conversationId).eq("connection_live", true).gte("last_seen_at", activeSince),
        supabaseAdmin.from("web_push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", recipients),
    ])
    if (subscriptionError || (activeError && !missingActivityContext(activeError))) {
        console.error("Could not resolve chat push recipients", activeError ?? subscriptionError)
        return
    }
    if (activeError) console.warn("Chat push activity context is not migrated; delivering without active-chat suppression")

    const activeUsers = new Set((activeError ? [] : activeRows ?? []).map((row) => row.user_id))
    const subscriptions = (subscriptionRows ?? []) as StoredSubscription[]
    const inactiveUsers = [...new Set(subscriptions.map((subscription) => subscription.user_id).filter((userId) => !activeUsers.has(userId)))]
    const counts = await unreadCounts(inactiveUsers, push)
    const topic = createHash("sha256").update(push.conversationId).digest("base64url").slice(0, 32)

    await Promise.all(subscriptions.filter((subscription) => !activeUsers.has(subscription.user_id) && (counts.get(subscription.user_id) ?? 1) > 0).map(async (subscription) => {
        const unreadCount = counts.get(subscription.user_id) ?? 1
        const payload = JSON.stringify({
            category: "chat",
            title: push.title,
            body: chatNotificationBody(push.body, unreadCount),
            url: push.url,
            tag: `chat:${push.conversationId}`,
            messageId: push.messageId,
            messageCreatedAt: push.messageCreatedAt,
            unreadCount,
            conversationId: push.conversationId,
        })
        const browserSubscription: PushSubscription = {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }
        try {
            await webPush.sendNotification(browserSubscription, payload, {
                vapidDetails: details,
                TTL: PUSH_TTL_SECONDS,
                urgency: "high",
                topic,
                timeout: 10_000,
            })
            await supabaseAdmin.from("web_push_subscriptions").update({ last_success_at: new Date().toISOString(), failure_count: 0, updated_at: new Date().toISOString() }).eq("id", subscription.id)
        } catch (error) {
            if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
                await supabaseAdmin.from("web_push_subscriptions").delete().eq("id", subscription.id)
                return
            }
            console.error("Chat push delivery failed", error)
            await supabaseAdmin.rpc("increment_web_push_failure", { subscription_id: subscription.id }).then(() => undefined)
        }
    }))
}

export async function notifyNativeChatMessage(input: {
    workspaceId: string
    workspaceSlug: string
    conversationId: string
    messageId: string
    senderUserId: string
}) {
    const [
        { data: participants, error: participantsError },
        { data: profile, error: profileError },
        { data: conversation, error: conversationError },
        { data: message, error: messageError },
    ] = await Promise.all([
        supabaseAdmin.from("workspace_native_conversation_participants").select("user_id").eq("workspace_id", input.workspaceId).eq("conversation_id", input.conversationId),
        supabaseAdmin.from("user_profiles").select("display_name, username").eq("user_id", input.senderUserId).maybeSingle(),
        supabaseAdmin.from("workspace_native_conversations").select("kind, team_id").eq("workspace_id", input.workspaceId).eq("id", input.conversationId).maybeSingle(),
        supabaseAdmin.from("workspace_native_messages").select("body, attachment, created_at").eq("workspace_id", input.workspaceId).eq("conversation_id", input.conversationId).eq("id", input.messageId).maybeSingle(),
    ])
    if (participantsError || profileError || conversationError || messageError || !conversation || !message) {
        console.error("Could not prepare native chat push", participantsError ?? profileError ?? conversationError ?? messageError)
        return
    }
    const senderName = profile?.display_name?.trim() || profile?.username || "A workspace member"
    let chatName = senderName
    if (conversation.kind === "team" && conversation.team_id) {
        const { data: team, error: teamError } = await supabaseAdmin.from("workspace_teams").select("name").eq("workspace_id", input.workspaceId).eq("id", conversation.team_id).maybeSingle()
        if (teamError) {
            console.error("Could not resolve native chat name", teamError)
            return
        }
        chatName = team?.name?.trim() || "Team chat"
    }
    const notification = chatNotificationText(chatName, message.body, message.attachment)
    await deliverChatPush(
        (participants ?? []).map((participant) => participant.user_id).filter((userId) => userId !== input.senderUserId),
        {
            workspaceId: input.workspaceId,
            conversationKind: "native",
            messageId: input.messageId,
            messageCreatedAt: message.created_at,
            conversationId: input.conversationId,
            title: notification.title,
            body: notification.body,
            url: `/${encodeURIComponent(input.workspaceSlug)}/communications?mode=team&nativeConversation=${encodeURIComponent(input.conversationId)}`,
        },
    )
}

export async function notifyClientChatMessage(input: {
    workspaceId: string
    relationshipId: string
    messageId: string
    senderName: string
}) {
    const [
        { data: memberships, error: membershipError },
        { data: workspace, error: workspaceError },
        { data: relationship, error: relationshipError },
        { data: message, error: messageError },
    ] = await Promise.all([
        supabaseAdmin.from("workspace_memberships").select("user_id").eq("workspace_id", input.workspaceId),
        supabaseAdmin.from("workspaces").select("slug").eq("id", input.workspaceId).single(),
        supabaseAdmin.from("relationships").select("primary_person_name, business_name").eq("workspace_id", input.workspaceId).eq("id", input.relationshipId).maybeSingle(),
        supabaseAdmin.from("client_messages").select("body, created_at").eq("workspace_id", input.workspaceId).eq("relationship_id", input.relationshipId).eq("id", input.messageId).maybeSingle(),
    ])
    if (membershipError || workspaceError || relationshipError || messageError || !workspace || !message) {
        console.error("Could not prepare client chat push", membershipError ?? workspaceError ?? relationshipError ?? messageError)
        return
    }
    const primaryName = relationship?.primary_person_name?.trim() || input.senderName
    const businessName = relationship?.business_name?.trim()
    const notification = chatNotificationText(businessName ? `${primaryName} – ${businessName}` : primaryName, message.body)
    await deliverChatPush((memberships ?? []).map((membership) => membership.user_id), {
        workspaceId: input.workspaceId,
        conversationKind: "client",
        messageId: input.messageId,
        messageCreatedAt: message.created_at,
        conversationId: input.relationshipId,
        title: notification.title,
        body: notification.body,
        url: `/${encodeURIComponent(workspace.slug)}/communications?conversation=${encodeURIComponent(input.relationshipId)}`,
    })
}
