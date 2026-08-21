import { NextRequest, NextResponse } from "next/server"
import { createSupabaseRouteClient } from "@/lib/supabase/route"
import { clearLegacyHostOnlyAuthCookies } from "@/lib/supabase/legacy-cookies"
import { getOnboardingContext, ONBOARDING_COOKIE, updateOnboardingSession } from "@/lib/auth/account-flow"
import { isEmailConfirmed } from "@/lib/auth/users"

export async function GET(request: NextRequest) {
    const url = request.nextUrl
    const code = url.searchParams.get("code")
    const tokenHash = url.searchParams.get("token_hash")
    const type = url.searchParams.get("type")
    const requestedNext = url.searchParams.get("next") || (type === "recovery" ? "/forgot-password/new-password" : type === "signup" ? "/sign-up/about" : "/login")
    const suiteNext = /^https:\/\/(app|dashboard|onboarding|leadgen)\.betelgeze\.com(?:\/|$)/.test(requestedNext)
    const next = suiteNext ? requestedNext : requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/workspaces"
    const response = NextResponse.redirect(new URL(next, url.origin))

    if (code || tokenHash) {
        const supabase = createSupabaseRouteClient(request, response)
        const supportedOtpTypes = new Set(["signup", "recovery", "email_change", "invite", "magiclink", "reauthentication", "email"])
        const { error } = code
            ? await supabase.auth.exchangeCodeForSession(code)
            : type && supportedOtpTypes.has(type)
                ? await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: type as "signup" | "recovery" | "email_change" | "invite" | "magiclink" | "reauthentication" | "email" })
                : { error: new Error("Unsupported confirmation link.") }

        if (error) {
            const failed = new URL(type === "recovery" ? "/forgot-password" : type === "signup" ? "/sign-up" : "/login", url.origin)
            failed.searchParams.set("reason", "invalid-or-expired")
            response.headers.set("location", failed.toString())
            return response
        }

        if (type === "signup" || type === "invite") {
            const onboarding = await getOnboardingContext(request.cookies.get(ONBOARDING_COOKIE)?.value)
            const { data: authData } = await supabase.auth.getUser()
            const user = authData.user
            if (onboarding?.currentStep === "verify-email" && user && isEmailConfirmed(user) && user.email?.toLowerCase() === onboarding.email.toLowerCase()) {
                await updateOnboardingSession(onboarding.sessionId, { auth_user_id: user.id, current_step: "about" })
            }
        }

        clearLegacyHostOnlyAuthCookies(request, response)
    }

    return response
}
