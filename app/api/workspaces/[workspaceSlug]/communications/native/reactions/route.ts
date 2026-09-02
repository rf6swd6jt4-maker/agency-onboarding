import { assertNativeConversationAccess } from "@/lib/teams/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspacePanel } from "@/lib/workspace-access"

export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function validReactionEmoji(value: string) {
    if (!value) return true
    const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)]
    return segments.length === 1 && value.length <= 32 && /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(value)
}

export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "communications")
    const input = await request.json().catch(() => null) as Record<string, unknown> | null
    const conversationId = typeof input?.conversationId === "string" ? input.conversationId : ""
    const messageId = typeof input?.messageId === "string" ? input.messageId : ""
    const emoji = typeof input?.emoji === "string" ? input.emoji.trim() : ""
    if (!UUID_PATTERN.test(conversationId) || !UUID_PATTERN.test(messageId) || !validReactionEmoji(emoji)) return Response.json({ error: "Choose one valid emoji reaction." }, { status: 400 })
    if (!await assertNativeConversationAccess(conversationId, user.id, "write")) return Response.json({ error: "Conversation is unavailable or read-only." }, { status: 403 })
    const { data: message } = await supabaseAdmin.from("workspace_native_messages").select("id").eq("workspace_id", workspace.id).eq("conversation_id", conversationId).eq("id", messageId).maybeSingle()
    if (!message) return Response.json({ error: "Message not found." }, { status: 404 })
    if (!emoji) {
        const { error } = await supabaseAdmin.from("workspace_native_reactions").delete().eq("workspace_id", workspace.id).eq("message_id", messageId).eq("reactor_user_id", user.id)
        return error ? Response.json({ error: error.message }, { status: 503 }) : Response.json({ reaction: null })
    }
    const { data, error } = await supabaseAdmin.from("workspace_native_reactions").upsert({ workspace_id: workspace.id, conversation_id: conversationId, message_id: messageId, reactor_user_id: user.id, emoji, updated_at: new Date().toISOString() }, { onConflict: "message_id,reactor_user_id" }).select("id, conversation_id, message_id, reactor_user_id, emoji, updated_at").single()
    if (error) return Response.json({ error: error.message }, { status: 503 })
    return Response.json({ reaction: { id: data.id, conversationId: data.conversation_id, messageId: data.message_id, reactorUserId: data.reactor_user_id, emoji: data.emoji, updatedAt: data.updated_at } })
}
