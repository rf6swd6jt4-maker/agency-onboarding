import { assertNativeConversationAccess } from "@/lib/teams/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const input = await request.json().catch(() => null) as Record<string, unknown> | null
    const conversationId = typeof input?.conversationId === "string" ? input.conversationId : ""
    const messageId = typeof input?.messageId === "string" ? input.messageId : ""
    if (!UUID_PATTERN.test(conversationId) || !UUID_PATTERN.test(messageId) || !await assertNativeConversationAccess(conversationId, user.id, "read")) return Response.json({ error: "Conversation not found." }, { status: 404 })
    const { data: message } = await supabaseAdmin.from("workspace_native_messages").select("id, created_at").eq("workspace_id", workspace.id).eq("conversation_id", conversationId).eq("id", messageId).maybeSingle()
    if (!message) return Response.json({ error: "Message not found." }, { status: 404 })
    const { data: current } = await supabaseAdmin.from("workspace_native_read_cursors").select("last_read_message_id, last_read_at").eq("workspace_id", workspace.id).eq("conversation_id", conversationId).eq("user_id", user.id).maybeSingle()
    if (current?.last_read_at && current.last_read_at >= message.created_at) return Response.json({ cursor: { conversationId, userId: user.id, lastReadMessageId: current.last_read_message_id, lastReadAt: current.last_read_at }, notificationReadThrough: current.last_read_at })
    const lastReadAt = message.created_at
    const { error } = await supabaseAdmin.from("workspace_native_read_cursors").upsert({ workspace_id: workspace.id, conversation_id: conversationId, user_id: user.id, last_read_message_id: messageId, last_read_at: lastReadAt }, { onConflict: "conversation_id,user_id" })
    if (error) return Response.json({ error: error.message }, { status: 503 })
    return Response.json({ cursor: { conversationId, userId: user.id, lastReadMessageId: messageId, lastReadAt }, notificationReadThrough: message.created_at })
}
