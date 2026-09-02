import { NextRequest } from "next/server"

import { supabaseAdmin } from "@/lib/supabase/admin"
import { clearReadChatPushNotifications } from "@/lib/push/chat-notifications"
import { requireWorkspacePanel } from "@/lib/workspace-access"

export const dynamic = "force-dynamic"
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "communications")
    const input = await request.json().catch(() => null) as { relationshipId?: unknown; messageId?: unknown } | null
    const relationshipId = typeof input?.relationshipId === "string" ? input.relationshipId : ""
    const messageId = typeof input?.messageId === "string" ? input.messageId : ""
    if (!UUID_PATTERN.test(relationshipId) || !UUID_PATTERN.test(messageId)) return Response.json({ error: "Invalid read cursor" }, { status: 400 })
    const { data: target } = await supabaseAdmin.from("client_messages").select("id, created_at").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).eq("id", messageId).maybeSingle()
    if (!target) return Response.json({ error: "Message not found" }, { status: 404 })
    const { data: current } = await supabaseAdmin.from("communication_read_cursors").select("last_read_message_id, last_read_at").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).eq("user_id", user.id).maybeSingle()
    if (current?.last_read_message_id) {
        const { data: previous } = await supabaseAdmin.from("client_messages").select("created_at").eq("id", current.last_read_message_id).maybeSingle()
        if (previous && previous.created_at >= target.created_at) {
            await clearReadChatPushNotifications({ userId: user.id, conversationKind: "client", conversationId: relationshipId, readThroughCreatedAt: previous.created_at })
            return Response.json({ cursor: { relationshipId, userId: user.id, lastReadMessageId: current.last_read_message_id, lastReadAt: current.last_read_at }, notificationReadThrough: previous.created_at })
        }
    }
    const lastReadAt = new Date().toISOString()
    const { error } = await supabaseAdmin.from("communication_read_cursors").upsert({ workspace_id: workspace.id, relationship_id: relationshipId, user_id: user.id, last_read_message_id: messageId, last_read_at: lastReadAt }, { onConflict: "workspace_id,relationship_id,user_id" })
    if (error) return Response.json({ error: error.message }, { status: 503 })
    await clearReadChatPushNotifications({ userId: user.id, conversationKind: "client", conversationId: relationshipId, readThroughCreatedAt: target.created_at })
    return Response.json({ cursor: { relationshipId, userId: user.id, lastReadMessageId: messageId, lastReadAt }, notificationReadThrough: target.created_at })
}
