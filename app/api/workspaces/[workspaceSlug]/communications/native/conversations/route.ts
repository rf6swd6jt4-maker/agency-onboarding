import { loadNativeCommunications } from "@/lib/teams/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user, role } = await requireWorkspace(workspaceSlug)
    const url = new URL(request.url)
    return Response.json(await loadNativeCommunications({ workspaceId: workspace.id, workspaceSlug: workspace.slug, currentUserId: user.id, role, requestedConversationId: url.searchParams.get("conversation"), requestedDmUserId: url.searchParams.get("dm") }), { headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user, role } = await requireWorkspace(workspaceSlug)
    const input = await request.json().catch(() => null) as { userId?: unknown } | null
    const targetUserId = typeof input?.userId === "string" ? input.userId : ""
    if (!UUID_PATTERN.test(targetUserId) || targetUserId === user.id) return Response.json({ error: "Choose another workspace member." }, { status: 400 })
    if (role !== "owner" && role !== "admin") return Response.json({ error: "Only owners and admins can start private chats." }, { status: 403 })
    const { data: target } = await supabaseAdmin.from("workspace_memberships").select("user_id, role").eq("workspace_id", workspace.id).eq("user_id", targetUserId).maybeSingle()
    if (!target) return Response.json({ error: "Workspace member not found." }, { status: 404 })
    const [directUserOne, directUserTwo] = [user.id, targetUserId].sort()
    const existing = await supabaseAdmin.from("workspace_native_conversations").select("id").eq("workspace_id", workspace.id).eq("kind", "direct").eq("direct_user_one", directUserOne).eq("direct_user_two", directUserTwo).is("archived_at", null).maybeSingle()
    if (existing.data) return Response.json({ conversationId: existing.data.id, reused: true })
    const inserted = await supabaseAdmin.from("workspace_native_conversations").insert({ workspace_id: workspace.id, kind: "direct", direct_user_one: directUserOne, direct_user_two: directUserTwo, created_by: user.id }).select("id").single()
    if (!inserted.error && inserted.data) return Response.json({ conversationId: inserted.data.id, reused: false })
    if (inserted.error?.code === "23505") {
        const raced = await supabaseAdmin.from("workspace_native_conversations").select("id").eq("workspace_id", workspace.id).eq("kind", "direct").eq("direct_user_one", directUserOne).eq("direct_user_two", directUserTwo).single()
        if (raced.data) return Response.json({ conversationId: raced.data.id, reused: true })
    }
    return Response.json({ error: inserted.error?.message ?? "Could not open direct message." }, { status: 503 })
}
