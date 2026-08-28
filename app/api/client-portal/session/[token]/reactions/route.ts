import { type NextRequest } from "next/server"

import { resolveClientPortalAccessByToken } from "@/lib/client-portal/session"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function noStore(body: unknown, init?: ResponseInit) {
    const headers = new Headers(init?.headers)
    headers.set("Cache-Control", "private, no-store")
    return Response.json(body, { ...init, headers })
}

function validReactionEmoji(value: string) {
    if (!value) return true
    const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)]
    return segments.length === 1 && value.length <= 32 && /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(value)
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
    const { token } = await context.params
    const resolved = await resolveClientPortalAccessByToken(token)
    if (!resolved) return noStore({ error: "Portal not found." }, { status: 404 })

    const input = await request.json().catch(() => null) as { messageId?: unknown; emoji?: unknown } | null
    const messageId = typeof input?.messageId === "string" ? input.messageId : ""
    const emoji = typeof input?.emoji === "string" ? input.emoji.trim() : ""
    if (!UUID_PATTERN.test(messageId) || !validReactionEmoji(emoji)) {
        return noStore({ error: "Choose one valid emoji reaction." }, { status: 400 })
    }

    const message = await supabaseAdmin
        .from("client_messages")
        .select("id, direction")
        .eq("workspace_id", resolved.workspace.id)
        .eq("relationship_id", resolved.relationship.id)
        .eq("id", messageId)
        .maybeSingle()
    if (message.error) return noStore({ error: "Could not react to this message right now." }, { status: 503 })
    if (!message.data) return noStore({ error: "Message not found." }, { status: 404 })
    if (message.data.direction !== "outbound") {
        return noStore({ error: "You can react to messages from the agency." }, { status: 409 })
    }

    if (!emoji) {
        const removed = await supabaseAdmin
            .from("communication_reactions")
            .delete()
            .eq("workspace_id", resolved.workspace.id)
            .eq("relationship_id", resolved.relationship.id)
            .eq("client_message_id", messageId)
            .eq("direction", "inbound")
        if (removed.error) return noStore({ error: "Could not remove this reaction right now." }, { status: 503 })
        return noStore({ reaction: null })
    }

    const updatedAt = new Date().toISOString()
    const saved = await supabaseAdmin
        .from("communication_reactions")
        .upsert({
            workspace_id: resolved.workspace.id,
            relationship_id: resolved.relationship.id,
            client_message_id: messageId,
            direction: "inbound",
            reactor_user_id: null,
            reactor_address: "client_portal",
            emoji,
            provider_message_id: null,
            updated_at: updatedAt,
        }, { onConflict: "client_message_id,direction" })
        .select("id, direction, emoji, updated_at")
        .single()
    if (saved.error || !saved.data) return noStore({ error: "Could not save this reaction right now." }, { status: 503 })

    return noStore({ reaction: {
        id: saved.data.id,
        direction: saved.data.direction,
        emoji: saved.data.emoji,
        updatedAt: saved.data.updated_at,
    } })
}
