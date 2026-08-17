import { getCurrentUser } from "@/lib/workspaces"
import { assertNativeConversationAccess } from "@/lib/teams/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { UUID_PATTERN } from "@/lib/push/device"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
    const user = await getCurrentUser()
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 })
    const input = await request.json().catch(() => null) as { tabId?: unknown; active?: unknown; workspaceId?: unknown; conversationId?: unknown; conversationKind?: unknown; connectionLive?: unknown } | null
    const tabId = typeof input?.tabId === "string" ? input.tabId : ""
    if (!UUID_PATTERN.test(tabId) || typeof input?.active !== "boolean") return Response.json({ error: "Invalid activity session." }, { status: 400 })

    if (!input.active) {
        const { error } = await supabaseAdmin.from("communications_active_sessions").delete().eq("user_id", user.id).eq("tab_id", tabId)
        return error ? Response.json({ error: "Could not close the activity session." }, { status: 503 }) : Response.json({ active: false })
    }
    const workspaceId = typeof input.workspaceId === "string" ? input.workspaceId : ""
    const conversationId = typeof input.conversationId === "string" ? input.conversationId : ""
    const conversationKind = input.conversationKind === "client" || input.conversationKind === "native" ? input.conversationKind : null
    if (!UUID_PATTERN.test(workspaceId) || !UUID_PATTERN.test(conversationId) || !conversationKind || input.connectionLive !== true) return Response.json({ error: "Invalid active conversation." }, { status: 400 })
    const { data: membership } = await supabaseAdmin.from("workspace_memberships").select("user_id").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle()
    if (!membership) return Response.json({ error: "Workspace not found." }, { status: 404 })
    const canRead = conversationKind === "client"
        ? Boolean((await supabaseAdmin.from("relationships").select("id").eq("workspace_id", workspaceId).eq("id", conversationId).maybeSingle()).data)
        : Boolean(await assertNativeConversationAccess(conversationId, user.id, "read"))
    if (!canRead) return Response.json({ error: "Conversation not found." }, { status: 404 })
    const staleBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const [{ error }] = await Promise.all([
        supabaseAdmin.from("communications_active_sessions").upsert({ user_id: user.id, tab_id: tabId, workspace_id: workspaceId, conversation_kind: conversationKind, conversation_id: conversationId, connection_live: true, last_seen_at: new Date().toISOString() }, { onConflict: "user_id,tab_id" }),
        supabaseAdmin.from("communications_active_sessions").delete().eq("user_id", user.id).lt("last_seen_at", staleBefore),
    ])
    return error ? Response.json({ error: "Could not update the activity session." }, { status: 503 }) : Response.json({ active: true })
}
