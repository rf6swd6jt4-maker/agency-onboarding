import { NextRequest, NextResponse } from "next/server"
import { accountCookieOptions, accountFlowV2Enabled, ONBOARDING_COOKIE, WELCOME_EVENT_COOKIE } from "@/lib/auth/account-flow"
import { accountErrorMessage, classifyAccountError } from "@/lib/auth/errors"
import { createSupabaseRouteClient } from "@/lib/supabase/route"
import { carrySessionResponse } from "@/lib/supabase/session-cookies"

type Completion = {
    welcome_event_id: string
    workspace_slug: string
    workspace_name: string
    role: "owner" | "admin" | "staff"
    username: string
}

export async function POST(request: NextRequest) {
    if (!accountFlowV2Enabled()) return NextResponse.json({ code: "flow_disabled", error: "New account setup is temporarily paused." }, { status: 503 })
    const onboardingToken = request.cookies.get(ONBOARDING_COOKIE)?.value
    if (!onboardingToken) return NextResponse.json({ code: "onboarding_expired", error: accountErrorMessage("onboarding_expired") }, { status: 401 })

    const sessionResponse = NextResponse.json({ ok: true })
    const supabase = createSupabaseRouteClient(request, sessionResponse)
    const { data, error } = await supabase.rpc("complete_account_onboarding", { p_browser_token: onboardingToken })
    if (error || !data) {
        const code = classifyAccountError(error)
        return carrySessionResponse(sessionResponse, NextResponse.json({ code, error: accountErrorMessage(code) }, { status: code === "aal2_required" ? 403 : 400 }))
    }

    const completion = data as Completion
    const response = carrySessionResponse(sessionResponse, NextResponse.json({
        ok: true,
        next: `/users/${encodeURIComponent(completion.username)}`,
        workspace: { slug: completion.workspace_slug, name: completion.workspace_name, role: completion.role },
    }))
    response.cookies.set(WELCOME_EVENT_COOKIE, completion.welcome_event_id, accountCookieOptions(10 * 60))
    response.cookies.set(ONBOARDING_COOKIE, "", { ...accountCookieOptions(0), maxAge: 0 })
    return response
}
