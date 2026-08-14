import { NextRequest } from "next/server"

import { recordClientAdminActivity } from "@/lib/admin/activity"
import { normalizeMessageAddress } from "@/lib/client-messages/addresses"
import { metaWhatsAppFailureIsSafeToRetry, sendMetaWhatsAppMessage } from "@/lib/client-messages/meta-whatsapp"
import { COMMUNICATION_MESSAGE_COLUMNS, communicationMessageFromRow, loadCommunicationMessages } from "@/lib/communications/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function providerMessageId(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const messages = (value as { messages?: unknown }).messages
    if (!Array.isArray(messages)) return null
    const first = messages[0]
    return first && typeof first === "object" && !Array.isArray(first) && typeof (first as { id?: unknown }).id === "string"
        ? (first as { id: string }).id
        : null
}

async function scopedRelationship(workspaceId: string, relationshipId: string) {
    const { data, error } = await supabaseAdmin.from("relationships").select("id, client_id, primary_phone, whatsapp_phone, status").eq("workspace_id", workspaceId).eq("id", relationshipId).maybeSingle()
    if (error) throw new Error(error.message)
    return data?.status === "archived" ? null : data
}

async function destinationForRelationship(workspaceId: string, relationship: { id: string; client_id: string | null; primary_phone: string | null; whatsapp_phone: string | null }) {
    if (relationship.client_id) {
        const { data: existing, error } = await supabaseAdmin.from("client_communication_channels").select("id, external_address").eq("workspace_id", workspaceId).eq("client_id", relationship.client_id).eq("provider", "meta_whatsapp").eq("is_active", true).maybeSingle()
        if (error) throw new Error(error.message)
        if (existing) return existing
    }
    const address = normalizeMessageAddress(relationship.whatsapp_phone ?? relationship.primary_phone ?? "")
    if (!address) return null
    if (!relationship.client_id) return { id: null, external_address: address }
    const { data: channel, error: insertError } = await supabaseAdmin.from("client_communication_channels").upsert({
        workspace_id: workspaceId,
        client_id: relationship.client_id,
        relationship_id: relationship.id,
        provider: "meta_whatsapp",
        external_address: address,
        clickup_channel_id: null,
        is_active: true,
        updated_at: new Date().toISOString(),
    }, { onConflict: "client_id" }).select("id, external_address").single()
    if (insertError) throw new Error(insertError.message)
    return channel
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
    const input = await request.json().catch(() => null) as { relationshipId?: unknown; body?: unknown; clientRequestId?: unknown; retry?: unknown } | null
    const relationshipId = typeof input?.relationshipId === "string" ? input.relationshipId : ""
    const clientRequestId = typeof input?.clientRequestId === "string" ? input.clientRequestId : ""
    const body = typeof input?.body === "string" ? input.body.trim() : ""
    if (!UUID_PATTERN.test(relationshipId) || !UUID_PATTERN.test(clientRequestId) || !body || body.length > 4_000) return Response.json({ error: "A valid conversation, request ID, and message of up to 4,000 characters are required." }, { status: 400 })
    const relationship = await scopedRelationship(workspace.id, relationshipId)
    if (!relationship) return Response.json({ error: "Conversation not found" }, { status: 404 })
    const channel = await destinationForRelationship(workspace.id, relationship)
    if (!channel) return Response.json({ error: "This client has no WhatsApp destination." }, { status: 409 })

    const existingResult = await supabaseAdmin.from("client_messages").select(COMMUNICATION_MESSAGE_COLUMNS).eq("workspace_id", workspace.id).eq("client_request_id", clientRequestId).maybeSingle()
    if (existingResult.error) return Response.json({ error: existingResult.error.message }, { status: 503 })
    const existing = communicationMessageFromRow(existingResult.data)
    if (existing && !(input?.retry === true && existing.status === "send_failed")) return Response.json({ message: existing, reused: true })

    let messageId = existing?.id ?? null
    if (messageId) {
        const { error } = await supabaseAdmin.from("client_messages").update({ status: "sending", error: null, failed_at: null }).eq("workspace_id", workspace.id).eq("id", messageId)
        if (error) return Response.json({ error: error.message }, { status: 503 })
    } else {
        const { data, error } = await supabaseAdmin.from("client_messages").insert({
            workspace_id: workspace.id,
            relationship_id: relationship.id,
            client_id: relationship.client_id,
            communication_channel_id: channel.id,
            direction: "outbound",
            provider: "meta_whatsapp",
            to_address: channel.external_address,
            body,
            status: "sending",
            sender_kind: "staff",
            sender_user_id: user.id,
            client_request_id: clientRequestId,
        }).select("id").single()
        if (error || !data) return Response.json({ error: error?.message ?? "Could not create message" }, { status: 503 })
        messageId = data.id
    }

    try {
        const providerResponse = await sendMetaWhatsAppMessage({ workspaceId: workspace.id, to: channel.external_address, body, callbackData: messageId })
        const externalId = providerMessageId(providerResponse)
        const sentAt = new Date().toISOString()
        const finalized = await supabaseAdmin.from("client_messages").update({ status: "whatsapp_sent", provider_message_id: externalId, whatsapp_message_id: externalId, sent_at: sentAt, error: null }).eq("workspace_id", workspace.id).eq("id", messageId).in("status", ["sending", "send_uncertain", "send_failed", "sent", "whatsapp_sent"]).select(COMMUNICATION_MESSAGE_COLUMNS).maybeSingle()
        if (finalized.error) throw finalized.error
        const current = finalized.data ? finalized : await supabaseAdmin.from("client_messages").select(COMMUNICATION_MESSAGE_COLUMNS).eq("workspace_id", workspace.id).eq("id", messageId).single()
        const { data, error } = current
        if (error) throw error
        const message = communicationMessageFromRow(data)
        if (relationship.client_id) await recordClientAdminActivity({ clientId: relationship.client_id, category: "communications", eventKey: "whatsapp.message.sent_by_staff", summary: "WhatsApp message sent by staff", entityType: "client_message", entityId: messageId, actorUserId: user.id, actorKind: "staff", direction: "outbound", metadata: { provider_message_id: externalId } })
        return Response.json({ message })
    } catch (error) {
        const safeToRetry = metaWhatsAppFailureIsSafeToRetry(error)
        const errorMessage = error instanceof Error ? error.message : "WhatsApp send failed"
        const failed = await supabaseAdmin.from("client_messages").update({ status: safeToRetry ? "send_failed" : "send_uncertain", error: errorMessage, failed_at: safeToRetry ? new Date().toISOString() : null }).eq("workspace_id", workspace.id).eq("id", messageId).in("status", ["sending", "send_uncertain", "send_failed"]).select(COMMUNICATION_MESSAGE_COLUMNS).maybeSingle()
        const current = failed.data ? failed : await supabaseAdmin.from("client_messages").select(COMMUNICATION_MESSAGE_COLUMNS).eq("workspace_id", workspace.id).eq("id", messageId).maybeSingle()
        const data = current.data
        return Response.json({ error: errorMessage, message: communicationMessageFromRow(data), retryable: safeToRetry }, { status: 502 })
    }
}
