import { NextRequest, NextResponse } from "next/server"
import { accountFlowV2Enabled, getOnboardingContext, ONBOARDING_COOKIE } from "@/lib/auth/account-flow"
import { usernameAlternatives, usernameValidationMessage } from "@/lib/auth/username"
import { supabaseAdmin } from "@/lib/supabase/admin"

export async function GET(request: NextRequest) {
    if (!accountFlowV2Enabled()) return NextResponse.json({ code: "flow_disabled" }, { status: 503 })
    const context = await getOnboardingContext(request.cookies.get(ONBOARDING_COOKIE)?.value)
    if (!context) return NextResponse.json({ code: "onboarding_expired" }, { status: 401 })
    const username = request.nextUrl.searchParams.get("value") ?? ""
    const validation = usernameValidationMessage(username)
    if (validation) return NextResponse.json({ available: false, message: validation, alternatives: [] }, { status: 400 })

    const candidates = [username, ...usernameAlternatives(username)]
    const { data } = await supabaseAdmin.from("user_profiles").select("username").in("username", candidates)
    const taken = new Set((data ?? []).map((item) => item.username))
    return NextResponse.json({
        available: !taken.has(username),
        message: taken.has(username) ? "That username is already in use." : "Username available.",
        alternatives: candidates.slice(1).filter((candidate) => !taken.has(candidate)),
    }, { headers: { "Cache-Control": "no-store" } })
}
