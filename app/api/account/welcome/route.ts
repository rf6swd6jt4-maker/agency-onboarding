import { NextRequest, NextResponse } from "next/server"
import { accountCookieOptions, WELCOME_EVENT_COOKIE } from "@/lib/auth/account-flow"
import { createSupabaseRouteClient } from "@/lib/supabase/route"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getAal2User } from "@/lib/auth/aal"

export async function POST(request: NextRequest) {
    const eventId = request.cookies.get(WELCOME_EVENT_COOKIE)?.value
    const response = NextResponse.json({ event: null as null | { workspaceName: string; workspaceSlug: string; role: string } })
    if (!eventId) return response
    const supabase = createSupabaseRouteClient(request, response)
    const user = await getAal2User(supabase)
    if (!user) return response

    const { data: event } = await supabaseAdmin
        .from("account_welcome_events")
        .select("id, role, consumed_at, workspaces!inner(name, slug)")
        .eq("id", eventId)
        .eq("user_id", user.id)
        .maybeSingle()
    if (event && !event.consumed_at) {
        await supabaseAdmin.from("account_welcome_events").update({ consumed_at: new Date().toISOString() }).eq("id", event.id).is("consumed_at", null)
        const workspace = event.workspaces as unknown as { name: string; slug: string }
        response.headers.set("Content-Type", "application/json")
        const delivered = NextResponse.json({ event: { workspaceName: workspace.name, workspaceSlug: workspace.slug, role: event.role } })
        response.cookies.getAll().forEach((cookie) => delivered.cookies.set(cookie))
        delivered.cookies.set(WELCOME_EVENT_COOKIE, "", { ...accountCookieOptions(0), maxAge: 0 })
        return delivered
    }
    response.cookies.set(WELCOME_EVENT_COOKIE, "", { ...accountCookieOptions(0), maxAge: 0 })
    return response
}
