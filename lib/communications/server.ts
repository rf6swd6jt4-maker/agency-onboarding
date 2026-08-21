import { profileAvatarUrl } from "@/lib/profile-avatar"
import { supabaseAdmin } from "@/lib/supabase/admin"
import type {
    CommunicationMessage,
    CommunicationPerson,
    CommunicationReaction,
    CommunicationReadCursor,
    CommunicationSenderKind,
    CommunicationSticker,
} from "@/lib/communications/types"
import { communicationAttachmentFromRawPayload } from "@/lib/communications/attachments"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export const COMMUNICATION_MESSAGE_COLUMNS = "id, client_request_id, relationship_id, body, direction, provider, provider_message_id, whatsapp_message_id, reply_to_whatsapp_message_id, reply_to_message_id, status, error, sender_kind, sender_user_id, automation_kind, automation_label, created_at, sent_at, delivered_at, read_at, failed_at, raw_payload"
const legacyMessageColumns = "id, relationship_id, body, direction, provider, provider_message_id, whatsapp_message_id, reply_to_whatsapp_message_id, status, error, created_at, raw_payload"

function record(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown) {
    return typeof value === "string" && value ? value : null
}

function bodyText(value: unknown) {
    return typeof value === "string" ? value : null
}

function legacySenderKind(row: Record<string, unknown>): CommunicationSenderKind {
    if (row.direction === "inbound") return "client"
    if (row.provider === "clickup" || row.provider === "clickup_chat") return "legacy"
    const raw = record(row.raw_payload)
    if (raw.outbox_id || raw.template_name || raw.onboarding_url || raw.client_sale_id) return "automation"
    return "legacy"
}

function legacyAutomationLabel(row: Record<string, unknown>) {
    const raw = record(row.raw_payload)
    if (raw.kind === "module_update") return "Onboarding update"
    if (raw.template_name) return "Consent request"
    if (raw.outbox_id || raw.onboarding_url) return "Onboarding link"
    return null
}

function inferredTimestamp(status: string, createdAt: string, states: string[]) {
    return states.includes(status) ? createdAt : null
}

export function communicationMessageFromRow(value: unknown): CommunicationMessage | null {
    const row = record(value)
    const id = text(row.id)
    const relationshipId = text(row.relationship_id)
    const body = bodyText(row.body)
    const direction = row.direction === "inbound" ? "inbound" : row.direction === "outbound" ? "outbound" : null
    const createdAt = text(row.created_at)
    if (!id || !relationshipId || body === null || !direction || !createdAt) return null
    const status = text(row.status) ?? (direction === "inbound" ? "received" : "sent")
    const senderKind = (["client", "staff", "automation", "legacy"] as const).includes(row.sender_kind as CommunicationSenderKind)
        ? row.sender_kind as CommunicationSenderKind
        : legacySenderKind(row)
    return {
        id,
        clientRequestId: text(row.client_request_id),
        relationshipId,
        body,
        direction,
        provider: text(row.provider) ?? "meta_whatsapp",
        status,
        error: text(row.error),
        senderKind,
        senderUserId: text(row.sender_user_id),
        automationKind: text(row.automation_kind) ?? text(record(row.raw_payload).kind),
        automationLabel: text(row.automation_label) ?? legacyAutomationLabel(row),
        attachment: communicationAttachmentFromRawPayload(row.raw_payload),
        providerMessageId: text(row.whatsapp_message_id) ?? text(row.provider_message_id),
        replyToProviderMessageId: text(row.reply_to_whatsapp_message_id),
        replyToMessageId: text(row.reply_to_message_id),
        deliveries: [],
        createdAt,
        sentAt: text(row.sent_at) ?? inferredTimestamp(status, createdAt, ["sent", "delivered", "read", "whatsapp_sent", "whatsapp_delivered", "whatsapp_read"]),
        deliveredAt: text(row.delivered_at) ?? inferredTimestamp(status, createdAt, ["delivered", "read", "whatsapp_delivered", "whatsapp_read"]),
        readAt: text(row.read_at) ?? inferredTimestamp(status, createdAt, ["read", "whatsapp_read"]),
        failedAt: text(row.failed_at) ?? inferredTimestamp(status, createdAt, ["failed", "send_failed", "delivery_failed"]),
    }
}

function missingCommunicationsSchema(error: { code?: string; message?: string } | null | undefined) {
    const message = error?.message?.toLowerCase() ?? ""
    return error?.code === "42703" || error?.code === "42P01" || error?.code === "PGRST204"
        || message.includes("sender_kind") || message.includes("communication_read_cursors")
}

export async function loadCommunicationMessages({
    workspaceId,
    relationshipId,
    limit = 2_000,
}: {
    workspaceId: string
    relationshipId?: string
    limit?: number
}): Promise<{ messages: CommunicationMessage[]; schemaReady: boolean }> {
    const supabase = await createSupabaseServerClient()
    const current = await supabase.rpc("communication_client_messages", {
        p_workspace_id: workspaceId,
        p_relationship_id: relationshipId ?? null,
        p_limit: limit,
    })
    if (!current.error) {
        const messages: CommunicationMessage[] = (current.data ?? []).flatMap((row: unknown) => communicationMessageFromRow(row) ?? []).reverse()
        let deliveryQuery = supabaseAdmin
            .from("communication_message_deliveries")
            .select("client_message_id, provider, provider_message_id, status, error, sent_at, delivered_at, read_at, failed_at")
            .eq("workspace_id", workspaceId)
        if (relationshipId) deliveryQuery = deliveryQuery.eq("relationship_id", relationshipId)
        const deliveries = await deliveryQuery.order("created_at", { ascending: true }).limit(Math.max(limit * 2, 500))
        if (deliveries.error && deliveries.error.code !== "42P01") throw new Error(`Could not load communication deliveries: ${deliveries.error.message}`)
        const byMessage = new Map<string, NonNullable<CommunicationMessage["deliveries"]>>()
        for (const delivery of deliveries.data ?? []) {
            const values = byMessage.get(delivery.client_message_id) ?? []
            if (delivery.provider === "meta_whatsapp" || delivery.provider === "twilio_sms") values.push({
                provider: delivery.provider,
                providerMessageId: delivery.provider_message_id,
                status: delivery.status,
                error: delivery.error,
                sentAt: delivery.sent_at,
                deliveredAt: delivery.delivered_at,
                readAt: delivery.read_at,
                failedAt: delivery.failed_at,
            })
            byMessage.set(delivery.client_message_id, values)
        }
        return {
            messages: messages.map((message) => ({ ...message, deliveries: byMessage.get(message.id) ?? [] })),
            schemaReady: !deliveries.error,
        }
    }
    if (!missingCommunicationsSchema(current.error) && current.error.code !== "PGRST202") throw new Error(`Could not load communications: ${current.error.message}`)

    let legacyQuery = supabaseAdmin.from("client_messages").select(legacyMessageColumns).eq("workspace_id", workspaceId)
    if (relationshipId) legacyQuery = legacyQuery.eq("relationship_id", relationshipId)
    const legacy = await legacyQuery.order("created_at", { ascending: false }).limit(limit)
    if (legacy.error) throw new Error(`Could not load communications: ${legacy.error.message}`)
    return {
        messages: (legacy.data ?? []).flatMap((row) => communicationMessageFromRow(row) ?? []).reverse(),
        schemaReady: false,
    }
}

export async function loadCommunicationMessage({
    workspaceId,
    messageId,
}: {
    workspaceId: string
    messageId: string
}): Promise<CommunicationMessage | null> {
    const supabase = await createSupabaseServerClient()
    const current = await supabase.rpc("communication_client_message", {
        p_workspace_id: workspaceId,
        p_message_id: messageId,
    })
    if (current.error) throw new Error(`Could not load communication message: ${current.error.message}`)
    const message = (current.data ?? []).flatMap((row: unknown) => communicationMessageFromRow(row) ?? [])[0] ?? null
    if (!message) return null
    const deliveries = await supabaseAdmin
        .from("communication_message_deliveries")
        .select("provider, provider_message_id, status, error, sent_at, delivered_at, read_at, failed_at")
        .eq("workspace_id", workspaceId)
        .eq("client_message_id", messageId)
        .order("created_at", { ascending: true })
    if (deliveries.error && deliveries.error.code !== "42P01") throw new Error(`Could not load communication deliveries: ${deliveries.error.message}`)
    return {
        ...message,
        deliveries: (deliveries.data ?? []).flatMap((delivery) => delivery.provider === "meta_whatsapp" || delivery.provider === "twilio_sms" ? [{
            provider: delivery.provider,
            providerMessageId: delivery.provider_message_id,
            status: delivery.status,
            error: delivery.error,
            sentAt: delivery.sent_at,
            deliveredAt: delivery.delivered_at,
            readAt: delivery.read_at,
            failedAt: delivery.failed_at,
        }] : []),
    }
}

export async function loadCommunicationPeople(workspaceId: string, currentUserId: string): Promise<{ currentUser: CommunicationPerson; people: CommunicationPerson[] }> {
    const { data: memberships, error: membershipError } = await supabaseAdmin
        .from("workspace_memberships")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .order("created_at")
    if (membershipError) throw new Error(`Could not load communication members: ${membershipError.message}`)
    const userIds = (memberships ?? []).map((membership) => membership.user_id)
    const { data: profiles, error: profileError } = userIds.length
        ? await supabaseAdmin.from("user_profiles").select("user_id, username, display_name, avatar_path").in("user_id", userIds)
        : { data: [], error: null }
    if (profileError) throw new Error(`Could not load communication profiles: ${profileError.message}`)
    const profileById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]))
    const people = userIds.map((id) => {
        const profile = profileById.get(id)
        const name = profile?.display_name?.trim() || profile?.username || (id === currentUserId ? "You" : "Team member")
        return { id, name, avatarSrc: profile?.avatar_path && profile?.username ? profileAvatarUrl(profile.username, profile.avatar_path) : null }
    })
    return {
        people,
        currentUser: people.find((person) => person.id === currentUserId) ?? { id: currentUserId, name: "You", avatarSrc: null },
    }
}

export async function loadCommunicationReadCursors(workspaceId: string): Promise<{ cursors: CommunicationReadCursor[]; schemaReady: boolean }> {
    const { data, error } = await supabaseAdmin
        .from("communication_read_cursors")
        .select("relationship_id, user_id, last_read_message_id, last_read_at")
        .eq("workspace_id", workspaceId)
    if (!error) return {
        cursors: (data ?? []).map((cursor) => ({
            relationshipId: cursor.relationship_id,
            userId: cursor.user_id,
            lastReadMessageId: cursor.last_read_message_id,
            lastReadAt: cursor.last_read_at,
        })),
        schemaReady: true,
    }
    if (missingCommunicationsSchema(error)) return { cursors: [], schemaReady: false }
    throw new Error(`Could not load communication read cursors: ${error.message}`)
}

export async function loadCommunicationReactions(workspaceId: string): Promise<{ reactions: CommunicationReaction[]; schemaReady: boolean }> {
    const { data, error } = await supabaseAdmin
        .from("communication_reactions")
        .select("id, relationship_id, client_message_id, direction, emoji, reactor_user_id, updated_at")
        .eq("workspace_id", workspaceId)
    if (!error) return {
        reactions: (data ?? []).flatMap((reaction) => reaction.direction === "inbound" || reaction.direction === "outbound" ? [{
            id: reaction.id,
            relationshipId: reaction.relationship_id,
            messageId: reaction.client_message_id,
            direction: reaction.direction,
            emoji: reaction.emoji,
            reactorUserId: reaction.reactor_user_id,
            updatedAt: reaction.updated_at,
        }] : []),
        schemaReady: true,
    }
    if (missingCommunicationsSchema(error) || error.code === "42P01") return { reactions: [], schemaReady: false }
    throw new Error(`Could not load communication reactions: ${error.message}`)
}

export async function loadCommunicationStickers(workspaceId: string): Promise<{ stickers: CommunicationSticker[]; schemaReady: boolean }> {
    const { data, error } = await supabaseAdmin
        .from("communication_stickers")
        .select("id, file_name, storage_path, size_bytes, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at")
    if (!error) return {
        stickers: (data ?? []).map((sticker) => ({
            id: sticker.id,
            fileName: sticker.file_name,
            storagePath: sticker.storage_path,
            size: sticker.size_bytes,
            url: `/api/client-messages/media/${sticker.storage_path.split("/").map(encodeURIComponent).join("/")}`,
            createdAt: sticker.created_at,
        })),
        schemaReady: true,
    }
    if (missingCommunicationsSchema(error) || error.code === "42P01") return { stickers: [], schemaReady: false }
    throw new Error(`Could not load communication stickers: ${error.message}`)
}
