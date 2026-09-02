import { assertNativeConversationAccess } from "@/lib/teams/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspacePanel } from "@/lib/workspace-access"

export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "communications")
    const input = await request.json().catch(() => null) as { conversationId?: unknown; messageId?: unknown } | null
    const conversationId = typeof input?.conversationId === "string" ? input.conversationId : ""
    const messageId = input?.messageId === null ? null : typeof input?.messageId === "string" ? input.messageId : ""
    if (!UUID_PATTERN.test(conversationId) || (messageId !== null && !UUID_PATTERN.test(messageId))) return Response.json({ error: "Invalid pinned message." }, { status: 400 })
    if (!await assertNativeConversationAccess(conversationId, user.id, "write")) return Response.json({ error: "Conversation is unavailable or read-only." }, { status: 403 })
    if (messageId) {
        const { data: message, error: messageError } = await supabaseAdmin.from("workspace_native_messages").select("id").eq("workspace_id", workspace.id).eq("conversation_id", conversationId).eq("id", messageId).maybeSingle()
        if (messageError) return Response.json({ error: messageError.message }, { status: 503 })
        if (!message) return Response.json({ error: "Message not found." }, { status: 404 })
    }
    const { error } = await supabaseAdmin.from("workspace_native_conversations").update({ pinned_message_id: messageId }).eq("workspace_id", workspace.id).eq("id", conversationId)
    if (error) return Response.json({ error: error.message }, { status: 503 })
    return Response.json({ conversationId, pinnedMessageId: messageId })
}
