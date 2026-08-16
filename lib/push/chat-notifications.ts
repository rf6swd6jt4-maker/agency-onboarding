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
    messageId: string
    conversationId: string
    title: string
    body: string
    url: string
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

export function chatNotificationText(kind: "native" | "whatsapp", senderName: string) {
    const safeName = senderName.replace(/\s+/g, " ").trim().slice(0, 80) || (kind === "whatsapp" ? "A client" : "A workspace member")
    return { title: kind === "whatsapp" ? "WhatsApp chat" : "Betelgeze chat", body: `From ${safeName}` }
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
        supabaseAdmin.from("communications_active_sessions").select("user_id").in("user_id", recipients).gte("last_seen_at", activeSince),
        supabaseAdmin.from("web_push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", recipients),
    ])
    if (activeError || subscriptionError) {
        console.error("Could not resolve chat push recipients", activeError ?? subscriptionError)
        return
    }

    const activeUsers = new Set((activeRows ?? []).map((row) => row.user_id))
    const subscriptions = (subscriptionRows ?? []) as StoredSubscription[]
    const payload = JSON.stringify({
        category: "chat",
        title: push.title,
        body: push.body,
        url: push.url,
        tag: `chat:${push.conversationId}`,
        messageId: push.messageId,
        conversationId: push.conversationId,
    })
    const topic = createHash("sha256").update(push.conversationId).digest("base64url").slice(0, 32)

    await Promise.all(subscriptions.filter((subscription) => !activeUsers.has(subscription.user_id)).map(async (subscription) => {
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
    const [{ data: participants, error: participantsError }, { data: profile, error: profileError }] = await Promise.all([
        supabaseAdmin.from("workspace_native_conversation_participants").select("user_id").eq("workspace_id", input.workspaceId).eq("conversation_id", input.conversationId),
        supabaseAdmin.from("user_profiles").select("display_name, username").eq("user_id", input.senderUserId).maybeSingle(),
    ])
    if (participantsError || profileError) {
        console.error("Could not prepare native chat push", participantsError ?? profileError)
        return
    }
    const senderName = profile?.display_name?.trim() || profile?.username || "A workspace member"
    const notification = chatNotificationText("native", senderName)
    await deliverChatPush(
        (participants ?? []).map((participant) => participant.user_id).filter((userId) => userId !== input.senderUserId),
        {
            messageId: input.messageId,
            conversationId: input.conversationId,
            title: notification.title,
            body: notification.body,
            url: `/${encodeURIComponent(input.workspaceSlug)}/communications?mode=team&nativeConversation=${encodeURIComponent(input.conversationId)}`,
        },
    )
}

export async function notifyWhatsAppChatMessage(input: {
    workspaceId: string
    relationshipId: string
    messageId: string
    senderName: string
}) {
    const [{ data: memberships, error: membershipError }, { data: workspace, error: workspaceError }] = await Promise.all([
        supabaseAdmin.from("workspace_memberships").select("user_id").eq("workspace_id", input.workspaceId),
        supabaseAdmin.from("workspaces").select("slug").eq("id", input.workspaceId).single(),
    ])
    if (membershipError || workspaceError || !workspace) {
        console.error("Could not prepare WhatsApp chat push", membershipError ?? workspaceError)
        return
    }
    const notification = chatNotificationText("whatsapp", input.senderName)
    await deliverChatPush((memberships ?? []).map((membership) => membership.user_id), {
        messageId: input.messageId,
        conversationId: input.relationshipId,
        title: notification.title,
        body: notification.body,
        url: `/${encodeURIComponent(workspace.slug)}/communications?conversation=${encodeURIComponent(input.relationshipId)}`,
    })
}
