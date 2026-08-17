import { NextRequest, NextResponse } from "next/server"
import { createSupabaseRouteClient } from "@/lib/supabase/route"
import { clearCurrentDeviceAuthCookies } from "@/lib/supabase/legacy-cookies"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { PUSH_DEVICE_COOKIE, UUID_PATTERN } from "@/lib/push/device"

export function GET(request: NextRequest) {
    // GET must never mutate authentication state. Next.js may prefetch links
    // to GET routes before the user clicks them.
    return NextResponse.redirect(new URL("/", request.url))
}

export async function POST(request: NextRequest) {
    // Complete the POST/redirect/GET flow with 303 so the browser does not
    // preserve the POST method when it follows the redirect to the login page.
    const response = NextResponse.redirect(new URL("/login?loggedOut=1", request.url), 303)
    const auth = createSupabaseRouteClient(request, response)
    const { data: { user } } = await auth.auth.getUser().catch(() => ({ data: { user: null } }))
    const pushDeviceId = request.cookies.get(PUSH_DEVICE_COOKIE)?.value
    if (user && pushDeviceId && UUID_PATTERN.test(pushDeviceId)) await supabaseAdmin.from("web_push_subscriptions").delete().eq("user_id", user.id).eq("device_id", pushDeviceId)
    await auth.auth.signOut({ scope: "local" }).catch(() => undefined)
    response.cookies.set(PUSH_DEVICE_COOKIE, "", { path: "/", maxAge: 0 })
    clearCurrentDeviceAuthCookies(request, response)
    return response
}
