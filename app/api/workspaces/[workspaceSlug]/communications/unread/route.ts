import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspacePanel } from "@/lib/workspace-access"

export const dynamic = "force-dynamic"

type UnreadCountRow = {
    client_unread: number | string | null
    native_unread: number | string | null
}

function safeCount(value: number | string | null | undefined) {
    const count = Number(value ?? 0)
    return Number.isSafeInteger(count) && count > 0 ? count : 0
}

export async function GET(_request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "communications")
    const { data, error } = await supabaseAdmin.rpc("workspace_communications_unread_counts", {
        p_workspace_id: workspace.id,
        p_user_id: user.id,
    })
    if (error) {
        console.error("Workspace Communications unread service failed", {
            workspaceId: workspace.id,
            userId: user.id,
            code: error.code,
        })
        return Response.json({ error: "Unread messages could not be checked." }, {
            status: 503,
            headers: { "Cache-Control": "no-store" },
        })
    }

    const row = (data?.[0] ?? null) as UnreadCountRow | null
    const clientUnread = safeCount(row?.client_unread)
    const nativeUnread = safeCount(row?.native_unread)
    return Response.json({ clientUnread, nativeUnread, unreadCount: clientUnread + nativeUnread }, {
        headers: { "Cache-Control": "no-store" },
    })
}
