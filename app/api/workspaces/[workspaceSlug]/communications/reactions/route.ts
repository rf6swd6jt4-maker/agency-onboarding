import { NextRequest } from "next/server"

import { sendMetaWhatsAppReaction } from "@/lib/client-messages/meta-whatsapp"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspacePanel } from "@/lib/workspace-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function validReactionEmoji(value: string) {
    if (!value) return true
    const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)]
    return segments.length === 1 && value.length <= 32 && /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(value)
}

function providerMessageId(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const messages = (value as { messages?: unknown }).messages
    if (!Array.isArray(messages)) return null
    const first = messages[0]
    return first && typeof first === "object" && !Array.isArray(first) && typeof (first as { id?: unknown }).id === "string"
        ? (first as { id: string }).id
        : null
}

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "communications")
    const input = await request.json().catch(() => null) as { relationshipId?: unknown; messageId?: unknown; emoji?: unknown } | null
    const relationshipId = typeof input?.relationshipId === "string" ? input.relationshipId : ""
    const messageId = typeof input?.messageId === "string" ? input.messageId : ""
    const emoji = typeof input?.emoji === "string" ? input.emoji.trim() : ""
    if (!UUID_PATTERN.test(relationshipId) || !UUID_PATTERN.test(messageId) || !validReactionEmoji(emoji)) {
        return Response.json({ error: "Choose one valid emoji reaction." }, { status: 400 })
    }
    const { data: message, error: messageError } = await supabaseAdmin
        .from("client_messages")
        .select("id, direction, provider, from_address, to_address, provider_message_id, whatsapp_message_id, created_at")
        .eq("workspace_id", workspace.id)
        .eq("relationship_id", relationshipId)
        .eq("id", messageId)
        .maybeSingle()
    if (messageError) return Response.json({ error: messageError.message }, { status: 503 })
    if (!message) return Response.json({ error: "Message not found." }, { status: 404 })
    const portalNative = message.provider === "client_portal"
    let response: unknown = null
    if (!portalNative) {
        if (message.provider !== "meta_whatsapp") {
            return Response.json({ error: "This message source does not support reactions." }, { status: 409 })
        }
        if (Date.now() - new Date(message.created_at).getTime() > 30 * 24 * 60 * 60 * 1_000) {
            return Response.json({ error: "WhatsApp reactions are available for messages up to 30 days old." }, { status: 409 })
        }
        const targetProviderId = message.whatsapp_message_id ?? message.provider_message_id
        const to = message.direction === "inbound" ? message.from_address : message.to_address
        if (!targetProviderId || !to) return Response.json({ error: "This message cannot be reacted to in WhatsApp yet." }, { status: 409 })
        try {
            response = await sendMetaWhatsAppReaction({ workspaceId: workspace.id, to, messageId: targetProviderId, emoji })
        } catch (error) {
            return Response.json({ error: error instanceof Error ? error.message : "Could not send this reaction." }, { status: 502 })
        }
    }

    if (!emoji) {
        const { error } = await supabaseAdmin
            .from("communication_reactions")
            .delete()
            .eq("workspace_id", workspace.id)
            .eq("client_message_id", message.id)
            .eq("direction", "outbound")
        if (error) return Response.json({ error: error.message }, { status: 503 })
        return Response.json({ reaction: null })
    }

    const updatedAt = new Date().toISOString()
    const { data, error } = await supabaseAdmin
        .from("communication_reactions")
        .upsert({
            workspace_id: workspace.id,
            relationship_id: relationshipId,
            client_message_id: message.id,
            direction: "outbound",
            reactor_user_id: user.id,
            reactor_address: null,
            emoji,
            provider_message_id: providerMessageId(response),
            updated_at: updatedAt,
        }, { onConflict: "client_message_id,direction" })
        .select("id, relationship_id, client_message_id, direction, emoji, reactor_user_id, updated_at")
        .single()
    if (error || !data) return Response.json({ error: error?.message ?? "Could not save this reaction." }, { status: 503 })
    return Response.json({ reaction: {
        id: data.id,
        relationshipId: data.relationship_id,
        messageId: data.client_message_id,
        direction: data.direction,
        emoji: data.emoji,
        reactorUserId: data.reactor_user_id,
        updatedAt: data.updated_at,
    } })
}
