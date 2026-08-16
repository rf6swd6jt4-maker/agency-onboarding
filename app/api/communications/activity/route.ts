import { getCurrentUser } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { UUID_PATTERN } from "@/lib/push/device"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
    const user = await getCurrentUser()
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 })
    const input = await request.json().catch(() => null) as { tabId?: unknown; active?: unknown } | null
    const tabId = typeof input?.tabId === "string" ? input.tabId : ""
    if (!UUID_PATTERN.test(tabId) || typeof input?.active !== "boolean") return Response.json({ error: "Invalid activity session." }, { status: 400 })

    if (!input.active) {
        const { error } = await supabaseAdmin.from("communications_active_sessions").delete().eq("user_id", user.id).eq("tab_id", tabId)
        return error ? Response.json({ error: "Could not close the activity session." }, { status: 503 }) : Response.json({ active: false })
    }
    const staleBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const [{ error }] = await Promise.all([
        supabaseAdmin.from("communications_active_sessions").upsert({ user_id: user.id, tab_id: tabId, last_seen_at: new Date().toISOString() }, { onConflict: "user_id,tab_id" }),
        supabaseAdmin.from("communications_active_sessions").delete().eq("user_id", user.id).lt("last_seen_at", staleBefore),
    ])
    return error ? Response.json({ error: "Could not update the activity session." }, { status: 503 }) : Response.json({ active: true })
}
