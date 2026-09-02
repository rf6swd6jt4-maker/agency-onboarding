import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireWorkspacePanel } from "@/lib/workspace-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    await requireWorkspacePanel(workspaceSlug, "communications")
    const input = await request.json().catch(() => null) as { conversationId?: unknown } | null
    const conversationId = typeof input?.conversationId === "string" ? input.conversationId : ""
    if (!UUID_PATTERN.test(conversationId)) return Response.json({ error: "A valid private chat is required." }, { status: 400 })
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.rpc("clear_native_conversation_for_me", { p_conversation_id: conversationId })
    if (error) return Response.json({ error: error.message.includes("conversation_not_found") ? "Private chat not found." : error.message }, { status: error.message.includes("conversation_not_found") ? 404 : 503 })
    return Response.json({ cleared: true, conversationId, clearedAt: data })
}
