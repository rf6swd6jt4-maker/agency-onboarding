import { NextRequest, NextResponse } from "next/server"
import { accountCookieOptions, accountFlowV2Enabled, exchangeInvitationToken, ONBOARDING_COOKIE } from "@/lib/auth/account-flow"

function unavailable(request: NextRequest, reason: string) {
    const target = new URL("/sign-up", request.url)
    target.searchParams.set("reason", reason)
    return NextResponse.redirect(target)
}

export async function GET(request: NextRequest) {
    if (!accountFlowV2Enabled()) return unavailable(request, "disabled")
    const token = request.nextUrl.searchParams.get("token")?.trim()
    if (!token || token.length < 32) return unavailable(request, "invalid")

    try {
        const session = await exchangeInvitationToken(token)
        const response = NextResponse.redirect(new URL("/sign-up/review", request.url))
        const secondsUntilExpiry = Math.max(60, Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000))
        response.cookies.set(ONBOARDING_COOKIE, session.browserToken, accountCookieOptions(secondsUntilExpiry))
        response.headers.set("Cache-Control", "no-store")
        return response
    } catch (error) {
        console.error("Account onboarding session creation failed", { error })
        return unavailable(request, "session")
    }
}
