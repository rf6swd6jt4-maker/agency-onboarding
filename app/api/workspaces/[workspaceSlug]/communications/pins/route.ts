import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspacePanel } from "@/lib/workspace-access"

export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace } = await requireWorkspacePanel(workspaceSlug, "communications")
    const input = await request.json().catch(() => null) as { relationshipId?: unknown; messageId?: unknown } | null
    const relationshipId = typeof input?.relationshipId === "string" ? input.relationshipId : ""
    const messageId = input?.messageId === null ? null : typeof input?.messageId === "string" ? input.messageId : ""
    if (!UUID_PATTERN.test(relationshipId) || (messageId !== null && !UUID_PATTERN.test(messageId))) return Response.json({ error: "Invalid pinned message." }, { status: 400 })

    const { data: relationship, error: relationshipError } = await supabaseAdmin.from("relationships").select("id").eq("workspace_id", workspace.id).eq("id", relationshipId).maybeSingle()
    if (relationshipError) return Response.json({ error: relationshipError.message }, { status: 503 })
    if (!relationship) return Response.json({ error: "Conversation not found." }, { status: 404 })
    if (messageId) {
        const { data: message, error: messageError } = await supabaseAdmin.from("client_messages").select("id").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).eq("id", messageId).maybeSingle()
        if (messageError) return Response.json({ error: messageError.message }, { status: 503 })
        if (!message) return Response.json({ error: "Message not found." }, { status: 404 })
    }
    const { error } = await supabaseAdmin.from("relationships").update({ communication_pinned_message_id: messageId }).eq("workspace_id", workspace.id).eq("id", relationshipId)
    if (error) return Response.json({ error: error.message }, { status: 503 })
    return Response.json({ relationshipId, pinnedMessageId: messageId })
}
