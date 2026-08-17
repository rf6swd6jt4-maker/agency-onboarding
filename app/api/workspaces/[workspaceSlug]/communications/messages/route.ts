import { NextRequest } from "next/server"

import { recordClientAdminActivity } from "@/lib/admin/activity"
import { resolveCommunicationDestinations, sendCommunicationDeliveries } from "@/lib/client-messages/omnichannel"
import { COMMUNICATION_MESSAGE_COLUMNS, communicationMessageFromRow, loadCommunicationMessages } from "@/lib/communications/server"
import { communicationAttachmentFromValue, MAX_COMMUNICATION_MEDIA_CAPTION_LENGTH } from "@/lib/communications/attachments"
import { verifyClientMessageUpload } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import type { CommunicationAttachment } from "@/lib/communications/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function scopedRelationship(workspaceId: string, relationshipId: string) {
    const { data, error } = await supabaseAdmin.from("relationships").select("id, client_id, primary_phone, whatsapp_phone, status").eq("workspace_id", workspaceId).eq("id", relationshipId).maybeSingle()
    if (error) throw new Error(error.message)
    return data?.status === "archived" ? null : data
}

export async function GET(request: NextRequest, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace } = await requireWorkspace(workspaceSlug)
    const relationshipId = request.nextUrl.searchParams.get("relationshipId") ?? ""
    if (!UUID_PATTERN.test(relationshipId)) return Response.json({ error: "Invalid conversation" }, { status: 400 })
    const relationship = await scopedRelationship(workspace.id, relationshipId)
    if (!relationship) return Response.json({ error: "Conversation not found" }, { status: 404 })
    return Response.json(await loadCommunicationMessages({ workspaceId: workspace.id, relationshipId, limit: 500 }))
}

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const input = await request.json().catch(() => null) as { relationshipId?: unknown; body?: unknown; clientRequestId?: unknown; retry?: unknown; attachment?: unknown; replyToMessageId?: unknown; stickerId?: unknown } | null
    const relationshipId = typeof input?.relationshipId === "string" ? input.relationshipId : ""
    const clientRequestId = typeof input?.clientRequestId === "string" ? input.clientRequestId : ""
    const replyToMessageId = typeof input?.replyToMessageId === "string" ? input.replyToMessageId : ""
    const stickerId = typeof input?.stickerId === "string" ? input.stickerId : ""
    const body = typeof input?.body === "string" ? input.body.trim() : ""
    const inputAttachment = communicationAttachmentFromValue(input?.attachment)
    if (input?.attachment && !inputAttachment) return Response.json({ error: "The attachment metadata is invalid." }, { status: 400 })
    if (!UUID_PATTERN.test(relationshipId) || !UUID_PATTERN.test(clientRequestId) || (replyToMessageId && !UUID_PATTERN.test(replyToMessageId)) || (stickerId && !UUID_PATTERN.test(stickerId)) || (!body && !inputAttachment && !stickerId) || body.length > 4_000) return Response.json({ error: "A valid conversation, request ID, and message, attachment, or sticker are required." }, { status: 400 })
    const relationship = await scopedRelationship(workspace.id, relationshipId)
    if (!relationship) return Response.json({ error: "Conversation not found" }, { status: 404 })
    let resolved: Awaited<ReturnType<typeof resolveCommunicationDestinations>>
    try {
        resolved = await resolveCommunicationDestinations({ workspaceId: workspace.id, relationshipId: relationship.id })
    } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Could not resolve communication channels." }, { status: 409 })
    }
    if (!resolved.destinations.length) return Response.json({ error: "This client has no connected SMS or WhatsApp destination." }, { status: 409 })
    const { data: profile, error: profileError } = await supabaseAdmin
        .from("user_profiles")
        .select("display_name, username")
        .eq("user_id", user.id)
        .maybeSingle()
    if (profileError) return Response.json({ error: "Could not load your chat display name." }, { status: 503 })

    const existingResult = await supabaseAdmin.from("client_messages").select(COMMUNICATION_MESSAGE_COLUMNS).eq("workspace_id", workspace.id).eq("client_request_id", clientRequestId).maybeSingle()
    if (existingResult.error) return Response.json({ error: existingResult.error.message }, { status: 503 })
    const existing = communicationMessageFromRow(existingResult.data)
    if (existing && !(input?.retry === true && ["send_failed", "partial_sent"].includes(existing.status))) return Response.json({ message: existing, reused: true })
    if (replyToMessageId) {
        const replyTarget = await supabaseAdmin
            .from("client_messages")
            .select("id")
            .eq("workspace_id", workspace.id)
            .eq("relationship_id", relationship.id)
            .eq("id", replyToMessageId)
            .maybeSingle()
        if (replyTarget.error) return Response.json({ error: replyTarget.error.message }, { status: 503 })
        if (!replyTarget.data) return Response.json({ error: "The message being replied to was not found." }, { status: 404 })
    }
    let stickerAttachment: CommunicationAttachment | null = null
    if (!existing && stickerId) {
        const { data: sticker, error: stickerError } = await supabaseAdmin
            .from("communication_stickers")
            .select("file_name, storage_path, size_bytes")
            .eq("workspace_id", workspace.id)
            .eq("id", stickerId)
            .maybeSingle()
        if (stickerError) return Response.json({ error: stickerError.message }, { status: 503 })
        if (!sticker) return Response.json({ error: "Sticker not found." }, { status: 404 })
        stickerAttachment = {
            kind: "sticker" as const,
            fileName: sticker.file_name,
            mimeType: "image/webp",
            size: sticker.size_bytes,
            storagePath: sticker.storage_path,
            url: `/api/client-messages/media/${sticker.storage_path.split("/").map(encodeURIComponent).join("/")}`,
        }
    }
    let attachment = existing?.attachment ?? stickerAttachment ?? inputAttachment
    if (attachment && body.length > MAX_COMMUNICATION_MEDIA_CAPTION_LENGTH) {
        return Response.json({ error: `Attachment captions can be up to ${MAX_COMMUNICATION_MEDIA_CAPTION_LENGTH} characters.` }, { status: 400 })
    }
    const storedBody = body || (attachment ? `[${attachment.kind[0].toUpperCase()}${attachment.kind.slice(1)}] ${attachment.fileName}` : "")
    if (attachment && attachment.kind !== "sticker") {
        try {
            const verified = await verifyClientMessageUpload({
                workspaceId: workspace.id,
                relationshipId: relationship.id,
                storagePath: attachment.storagePath,
                mimeType: attachment.mimeType,
            })
            attachment = { ...attachment, kind: verified.kind, mimeType: verified.contentType, size: verified.size }
        } catch (error) {
            return Response.json({ error: error instanceof Error ? error.message : "Could not verify attachment." }, { status: 400 })
        }
    }

    let messageId = existing?.id ?? null
    if (messageId) {
        const { error } = await supabaseAdmin.from("client_messages").update({ status: "sending", error: null, failed_at: null }).eq("workspace_id", workspace.id).eq("id", messageId)
        if (error) return Response.json({ error: error.message }, { status: 503 })
    } else {
        const { data, error } = await supabaseAdmin.from("client_messages").insert({
            workspace_id: workspace.id,
            relationship_id: relationship.id,
            client_id: relationship.client_id,
            communication_channel_id: resolved.destinations.find((destination) => destination.primary)?.channelId ?? resolved.destinations[0].channelId,
            direction: "outbound",
            provider: resolved.destinations.length > 1 ? "omnichannel" : resolved.destinations[0].provider,
            to_address: resolved.destinations.find((destination) => destination.primary)?.address ?? resolved.destinations[0].address,
            body: storedBody,
            status: "sending",
            sender_kind: "staff",
            sender_user_id: user.id,
            client_request_id: clientRequestId,
            reply_to_message_id: replyToMessageId || null,
            raw_payload: attachment ? { bridge_media: attachment } : {},
        }).select("id").single()
        if (error || !data) return Response.json({ error: error?.message ?? "Could not create message" }, { status: 503 })
        messageId = data.id
    }
    if (!messageId) return Response.json({ error: "Could not resolve the message log." }, { status: 503 })

    try {
        const delivery = await sendCommunicationDeliveries({
            workspaceId: workspace.id,
            relationshipId: relationship.id,
            messageId,
            body: storedBody,
            senderName: profile?.display_name ?? profile?.username,
            attachment,
            replyToMessageId: replyToMessageId || null,
            destinations: resolved.destinations,
        })
        const loaded = await loadCommunicationMessages({ workspaceId: workspace.id, relationshipId: relationship.id, limit: 500 })
        const message = loaded.messages.find((candidate) => candidate.id === messageId) ?? null
        if (relationship.client_id) await recordClientAdminActivity({ clientId: relationship.client_id, category: "communications", eventKey: "client.message.sent_by_staff", summary: "Client message sent by staff", entityType: "client_message", entityId: messageId, actorUserId: user.id, actorKind: "staff", direction: "outbound", metadata: { deliveries: delivery.results.map((result) => ({ provider: result.provider, ok: result.ok, provider_message_id: result.providerMessageId })) } })
        const success = delivery.results.some((result) => result.ok)
        return Response.json({ message, deliveries: delivery.results }, { status: success ? 200 : 502 })
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Message send failed"
        const failed = await supabaseAdmin.from("client_messages").update({ status: "send_failed", error: errorMessage, failed_at: new Date().toISOString() }).eq("workspace_id", workspace.id).eq("id", messageId).in("status", ["sending", "send_uncertain", "send_failed"]).select(COMMUNICATION_MESSAGE_COLUMNS).maybeSingle()
        const current = failed.data ? failed : await supabaseAdmin.from("client_messages").select(COMMUNICATION_MESSAGE_COLUMNS).eq("workspace_id", workspace.id).eq("id", messageId).maybeSingle()
        const data = current.data
        return Response.json({ error: errorMessage, message: communicationMessageFromRow(data), retryable: true }, { status: 502 })
    }
}
