import "server-only"

import { supabaseAdmin } from "@/lib/supabase/admin"

export type ClientPortalMessageAttachment = {
    kind: "image" | "video" | "audio" | "document" | "sticker"
    fileName: string
    mimeType: string
    size: number | null
    storagePath: string
}

export type ClientPortalMessageReaction = {
    id: string
    direction: "inbound" | "outbound"
    emoji: string
    updatedAt: string
}

export type ClientPortalMessage = {
    id: string
    body: string
    direction: "inbound" | "outbound"
    senderKind: "client" | "staff" | "automation"
    automationLabel: string | null
    replyToMessageId: string | null
    source: "agency" | "external" | "portal" | "sms" | "whatsapp"
    reactions: ClientPortalMessageReaction[]
    attachment: ClientPortalMessageAttachment | null
    createdAt: string
}

function reactionsFromValue(value: unknown): ClientPortalMessageReaction[] {
    if (!Array.isArray(value)) return []
    return value.flatMap((candidate) => {
        const source = record(candidate)
        const id = text(source.id)
        const direction = source.direction === "inbound" || source.direction === "outbound" ? source.direction : null
        const emoji = text(source.emoji)
        const updatedAt = text(source.updatedAt)
        return id && direction && emoji && updatedAt ? [{ id, direction, emoji, updatedAt }] : []
    })
}

export type ClientPortalAttachmentAccess = {
    storagePath: string
    fileName: string
    mimeType: string
    customerKey: string | null
    isEncrypted: boolean
}

function record(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null
}

function attachmentFromValue(value: unknown): ClientPortalMessageAttachment | null {
    const source = record(value)
    const kind = text(source.kind)
    const fileName = text(source.fileName)
    const mimeType = text(source.mimeType)
    const storagePath = text(source.storagePath)
    if (!(kind === "image" || kind === "video" || kind === "audio" || kind === "document" || kind === "sticker") || !fileName || !mimeType || !storagePath) return null
    return {
        kind,
        fileName,
        mimeType,
        size: typeof source.size === "number" && Number.isFinite(source.size) && source.size >= 0 ? source.size : null,
        storagePath,
    }
}

function messageFromValue(value: unknown): ClientPortalMessage | null {
    const source = record(value)
    const id = text(source.id)
    const body = typeof source.body === "string" ? source.body : null
    const direction = source.direction === "inbound" || source.direction === "outbound" ? source.direction : null
    const senderKind = source.sender_kind === "client" || source.sender_kind === "staff" || source.sender_kind === "automation" ? source.sender_kind : null
    const messageSource = source.source === "agency" || source.source === "external" || source.source === "portal" || source.source === "sms" || source.source === "whatsapp" ? source.source : null
    const createdAt = text(source.created_at)
    if (!id || body === null || !direction || !senderKind || !messageSource || !createdAt) return null
    return {
        id,
        body,
        direction,
        senderKind,
        automationLabel: text(source.automation_label),
        replyToMessageId: text(source.reply_to_message_id),
        source: messageSource,
        reactions: reactionsFromValue(source.reactions),
        attachment: attachmentFromValue(source.attachment),
        createdAt,
    }
}

export async function loadClientPortalMessages({
    workspaceId,
    relationshipId,
    before,
    limit = 100,
}: {
    workspaceId: string
    relationshipId: string
    before?: string | null
    limit?: number
}): Promise<ClientPortalMessage[]> {
    const parameters = {
        p_workspace_id: workspaceId,
        p_relationship_id: relationshipId,
        p_before: before ?? null,
        p_limit: Math.max(1, Math.min(200, Math.round(limit))),
    }
    const current = await supabaseAdmin.rpc("client_portal_messages_v2", parameters)
    if (!current.error) return ((current.data ?? []) as unknown[]).flatMap((row) => messageFromValue(row) ?? []).reverse()
    if (current.error.code !== "PGRST202") throw new Error(`Could not load client portal messages: ${current.error.message}`)

    // Keep chat readable while the additive v2 projection migration is being
    // applied. Only coarse source categories and sanitized reactions are joined.
    const legacy = await supabaseAdmin.rpc("client_portal_messages", parameters)
    if (legacy.error) throw new Error(`Could not load client portal messages: ${legacy.error.message}`)
    const rows = (legacy.data ?? []) as unknown[]
    const ids = rows.flatMap((row) => text(record(row).id) ?? [])
    if (!ids.length) return []
    const [sources, reactions] = await Promise.all([
        supabaseAdmin.from("client_messages").select("id, direction, provider").eq("workspace_id", workspaceId).eq("relationship_id", relationshipId).in("id", ids),
        supabaseAdmin.from("communication_reactions").select("id, client_message_id, direction, emoji, updated_at").eq("workspace_id", workspaceId).eq("relationship_id", relationshipId).in("client_message_id", ids),
    ])
    if (sources.error || reactions.error) throw new Error(`Could not enrich client portal messages: ${sources.error?.message ?? reactions.error?.message}`)
    const sourceById = new Map((sources.data ?? []).map((source) => [source.id, source.direction === "outbound" ? "agency" : source.provider === "meta_whatsapp" ? "whatsapp" : source.provider === "twilio_sms" ? "sms" : source.provider === "client_portal" ? "portal" : "external"]))
    const reactionsById = new Map<string, unknown[]>()
    for (const reaction of reactions.data ?? []) {
        const currentReactions = reactionsById.get(reaction.client_message_id) ?? []
        currentReactions.push({ id: reaction.id, direction: reaction.direction, emoji: reaction.emoji, updatedAt: reaction.updated_at })
        reactionsById.set(reaction.client_message_id, currentReactions)
    }
    return rows.flatMap((row) => {
        const source = record(row)
        const id = text(source.id)
        return messageFromValue({ ...source, source: id ? sourceById.get(id) ?? "external" : "external", reactions: id ? reactionsById.get(id) ?? [] : [] }) ?? []
    }).reverse()
}

export async function loadClientPortalAttachmentAccess({
    workspaceId,
    relationshipId,
    messageId,
}: {
    workspaceId: string
    relationshipId: string
    messageId: string
}): Promise<ClientPortalAttachmentAccess | null> {
    const { data, error } = await supabaseAdmin.rpc("client_portal_message_attachment_access", {
        p_workspace_id: workspaceId,
        p_relationship_id: relationshipId,
        p_message_id: messageId,
    })
    if (error) throw new Error(`Could not load client portal attachment access: ${error.message}`)
    const source = record(Array.isArray(data) ? data[0] : data)
    const storagePath = text(source.storage_path)
    const fileName = text(source.file_name)
    const mimeType = text(source.mime_type)
    if (!storagePath || !fileName || !mimeType) return null
    return {
        storagePath,
        fileName,
        mimeType,
        customerKey: text(source.customer_key),
        isEncrypted: source.is_encrypted === true,
    }
}
