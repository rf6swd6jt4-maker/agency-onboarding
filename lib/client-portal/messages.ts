import "server-only"

import { supabaseAdmin } from "@/lib/supabase/admin"

export type ClientPortalMessageAttachment = {
    kind: "image" | "video" | "audio" | "document" | "sticker"
    fileName: string
    mimeType: string
    size: number | null
    storagePath: string
}

export type ClientPortalMessage = {
    id: string
    body: string
    direction: "inbound" | "outbound"
    senderKind: "client" | "staff" | "automation"
    automationLabel: string | null
    replyToMessageId: string | null
    attachment: ClientPortalMessageAttachment | null
    createdAt: string
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
    const createdAt = text(source.created_at)
    if (!id || body === null || !direction || !senderKind || !createdAt) return null
    return {
        id,
        body,
        direction,
        senderKind,
        automationLabel: text(source.automation_label),
        replyToMessageId: text(source.reply_to_message_id),
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
    const { data, error } = await supabaseAdmin.rpc("client_portal_messages", {
        p_workspace_id: workspaceId,
        p_relationship_id: relationshipId,
        p_before: before ?? null,
        p_limit: Math.max(1, Math.min(200, Math.round(limit))),
    })
    if (error) throw new Error(`Could not load client portal messages: ${error.message}`)
    return ((data ?? []) as unknown[]).flatMap((row) => messageFromValue(row) ?? []).reverse()
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
