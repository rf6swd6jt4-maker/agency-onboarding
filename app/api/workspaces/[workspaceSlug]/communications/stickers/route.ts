import { NextRequest } from "next/server"

import { communicationAttachmentFromRawPayload } from "@/lib/communications/attachments"
import { deleteOnboardingUploads, prepareStoredCommunicationSticker, storeCommunicationSticker } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STICKER_COLUMNS = "id, file_name, storage_path, size_bytes, created_at"

function stickerValue(row: { id: string; file_name: string; storage_path: string; size_bytes: number; created_at: string }) {
    return {
        id: row.id,
        fileName: row.file_name,
        storagePath: row.storage_path,
        size: row.size_bytes,
        url: `/api/client-messages/media/${row.storage_path.split("/").map(encodeURIComponent).join("/")}`,
        createdAt: row.created_at,
    }
}

async function savedSticker(workspaceId: string, storagePath: string) {
    return supabaseAdmin
        .from("communication_stickers")
        .select(STICKER_COLUMNS)
        .eq("workspace_id", workspaceId)
        .eq("storage_path", storagePath)
        .maybeSingle()
}

async function saveStickerFromMessage(workspaceId: string, userId: string, messageId: string) {
    const { data: message, error: messageError } = await supabaseAdmin
        .from("client_messages")
        .select("raw_payload")
        .eq("workspace_id", workspaceId)
        .eq("id", messageId)
        .maybeSingle()
    if (messageError) return Response.json({ error: messageError.message }, { status: 503 })
    if (!message) return Response.json({ error: "Message not found." }, { status: 404 })

    const attachment = communicationAttachmentFromRawPayload(message.raw_payload)
    if (attachment?.kind !== "sticker") {
        return Response.json({ error: "That message does not contain a sticker." }, { status: 400 })
    }
    let prepared: Awaited<ReturnType<typeof prepareStoredCommunicationSticker>>
    try {
        prepared = await prepareStoredCommunicationSticker({
            workspaceId,
            storagePath: attachment.storagePath,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
        })
    } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Could not verify this sticker." }, { status: 400 })
    }
    const existing = await savedSticker(workspaceId, prepared.storagePath)
    if (existing.error) return Response.json({ error: existing.error.message }, { status: 503 })
    if (existing.data) return Response.json({ sticker: stickerValue(existing.data), alreadySaved: true })
    const { data, error } = await supabaseAdmin
        .from("communication_stickers")
        .insert({
            workspace_id: workspaceId,
            created_by: userId,
            file_name: prepared.fileName,
            storage_path: prepared.storagePath,
            size_bytes: prepared.size,
        })
        .select(STICKER_COLUMNS)
        .single()
    if (!error && data) return Response.json({ sticker: stickerValue(data), alreadySaved: false })
    if (error?.code === "23505") {
        const raced = await savedSticker(workspaceId, prepared.storagePath)
        if (!raced.error && raced.data) return Response.json({ sticker: stickerValue(raced.data), alreadySaved: true })
    }
    return Response.json({ error: error?.message ?? "Could not save this sticker." }, { status: 503 })
}

export async function GET(_request: NextRequest, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace } = await requireWorkspace(workspaceSlug)
    const { data, error } = await supabaseAdmin
        .from("communication_stickers")
        .select("id, file_name, storage_path, size_bytes, created_at")
        .eq("workspace_id", workspace.id)
        .order("created_at")
    if (error) return Response.json({ error: error.message }, { status: 503 })
    return Response.json({ stickers: (data ?? []).map(stickerValue) })
}

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    if (request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        const input = await request.json().catch(() => null) as { messageId?: unknown } | null
        const messageId = typeof input?.messageId === "string" ? input.messageId : ""
        if (!UUID_PATTERN.test(messageId)) return Response.json({ error: "Choose a valid sticker message." }, { status: 400 })
        return saveStickerFromMessage(workspace.id, user.id, messageId)
    }
    const formData = await request.formData().catch(() => null)
    const file = formData?.get("file")
    if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
        return Response.json({ error: "Choose a JPEG or PNG sticker image." }, { status: 400 })
    }
    let stored: Awaited<ReturnType<typeof storeCommunicationSticker>>
    try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        stored = await storeCommunicationSticker(workspace.id, {
            name: file.name,
            size: file.size,
            type: file.type,
            bytes,
        })
    } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Could not convert this sticker." }, { status: 400 })
    }
    const { data, error } = await supabaseAdmin
        .from("communication_stickers")
        .insert({
            workspace_id: workspace.id,
            created_by: user.id,
            file_name: stored.fileName,
            storage_path: stored.storagePath,
            size_bytes: stored.size,
        })
        .select(STICKER_COLUMNS)
        .single()
    if (error || !data) {
        await deleteOnboardingUploads([stored.storagePath]).catch(() => undefined)
        return Response.json({ error: error?.message ?? "Could not save this sticker." }, { status: 503 })
    }
    return Response.json({ sticker: stickerValue(data) })
}
