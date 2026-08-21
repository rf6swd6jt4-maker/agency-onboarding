import { NextRequest, NextResponse } from "next/server"
import { accountErrorMessage, classifyAccountError } from "@/lib/auth/errors"
import { accountFlowV2Enabled, getOnboardingContext, ONBOARDING_COOKIE, updateOnboardingSession } from "@/lib/auth/account-flow"
import { normalizeUsername, usernameAlternatives, usernameValidationMessage } from "@/lib/auth/username"
import { passwordRequirements } from "@/lib/auth/password"
import { createSupabaseRouteClient } from "@/lib/supabase/route"
import { carrySessionResponse } from "@/lib/supabase/session-cookies"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { storeProfileAvatar } from "@/lib/onboarding/uploads"
import { findAuthUserByEmail, isEmailConfirmed } from "@/lib/auth/users"

const intendedUseOptions = new Set(["communications", "point-of-sale", "onboarding", "operations", "just-exploring", "prefer-not-to-say"])
const roleOptions = new Set(["owner", "operations", "sales", "client-services", "other", "prefer-not-to-say"])

function jsonWithSession<T>(sessionResponse: NextResponse, body: T, init?: ResponseInit) {
    return carrySessionResponse(sessionResponse, NextResponse.json(body, init))
}

async function usernameIsAvailable(username: string, currentUserId?: string | null) {
    const { data } = await supabaseAdmin.from("user_profiles").select("user_id").eq("username", username).maybeSingle()
    return !data || data.user_id === currentUserId
}

async function availableUsernameAlternatives(username: string) {
    const candidates = usernameAlternatives(username)
    const { data } = await supabaseAdmin.from("user_profiles").select("username").in("username", candidates)
    const taken = new Set((data ?? []).map((item) => item.username))
    return candidates.filter((candidate) => !taken.has(candidate))
}

function friendlyError(error: unknown, status = 400) {
    const code = classifyAccountError(error)
    console.error("Account onboarding step failed", { code, error })
    return NextResponse.json({ code, error: accountErrorMessage(code) }, { status })
}

export async function POST(request: NextRequest) {
    if (!accountFlowV2Enabled()) return NextResponse.json({ code: "flow_disabled", error: "New account setup is temporarily paused." }, { status: 503 })
    const rawOnboardingToken = request.cookies.get(ONBOARDING_COOKIE)?.value
    const context = await getOnboardingContext(rawOnboardingToken)
    if (!context) return NextResponse.json({ code: "onboarding_expired", error: accountErrorMessage("onboarding_expired") }, { status: 401 })

    const contentType = request.headers.get("content-type") ?? ""
    const formData = contentType.includes("multipart/form-data") ? await request.formData().catch(() => null) : null
    const body = formData ? null : await request.json().catch(() => null)
    const action = String(formData?.get("action") ?? body?.action ?? "")
    const sessionResponse = NextResponse.json({ ok: true })
    const supabase = createSupabaseRouteClient(request, sessionResponse)

    try {
        if (action === "review") {
            if (context.currentStep !== "review") return NextResponse.json({ next: `/sign-up/${context.currentStep}` })
            if (context.existingAccount) {
                const existingUser = await findAuthUserByEmail(context.email)
                if (existingUser && !isEmailConfirmed(existingUser)) {
                    const { error } = await supabase.auth.resend({ type: "signup", email: context.email })
                    if (error) return jsonWithSession(sessionResponse, { code: "rate_limited", error: accountErrorMessage(error.message.toLowerCase().includes("rate") ? "rate_limited" : "unknown") }, { status: 400 })
                    await updateOnboardingSession(context.sessionId, { current_step: "verify-email" })
                    return jsonWithSession(sessionResponse, { next: "/sign-up/verify-email" })
                }
                await updateOnboardingSession(context.sessionId, { current_step: "complete" })
                const next = encodeURIComponent("/sign-up/complete")
                return NextResponse.json({ next: `/login?email=${encodeURIComponent(context.email)}&next=${next}` })
            }
            await updateOnboardingSession(context.sessionId, { current_step: "email" })
            return NextResponse.json({ next: "/sign-up/email" })
        }

        if (action === "email") {
            if (context.currentStep !== "email") return NextResponse.json({ next: `/sign-up/${context.currentStep}` })
            await updateOnboardingSession(context.sessionId, { current_step: "username" })
            return NextResponse.json({ next: "/sign-up/username" })
        }

        if (action === "username") {
            const username = normalizeUsername(String(body?.username ?? ""))
            const message = usernameValidationMessage(username)
            if (message) return NextResponse.json({ code: "invalid_username", error: message }, { status: 400 })
            if (!(await usernameIsAvailable(username, context.existingAccount ? undefined : null))) {
                return NextResponse.json({ code: "username_unavailable", error: accountErrorMessage("username_unavailable"), alternatives: await availableUsernameAlternatives(username) }, { status: 409 })
            }
            await updateOnboardingSession(context.sessionId, { username_candidate: username, current_step: "password" })
            return NextResponse.json({ next: "/sign-up/password" })
        }

        if (action === "signup") {
            const password = String(body?.password ?? "")
            const username = context.usernameCandidate ?? ""
            if (!username || usernameValidationMessage(username)) return jsonWithSession(sessionResponse, { code: "invalid_username", error: "Return to the username step and choose a valid username." }, { status: 400 })
            if (!passwordRequirements(password).every((requirement) => requirement.met)) {
                return jsonWithSession(sessionResponse, { code: "weak_password", error: "Use a password that meets every requirement." }, { status: 400 })
            }
            if (!(await usernameIsAvailable(username))) {
                await updateOnboardingSession(context.sessionId, { current_step: "username" })
                return jsonWithSession(sessionResponse, { code: "username_unavailable", error: accountErrorMessage("username_unavailable"), alternatives: await availableUsernameAlternatives(username) }, { status: 409 })
            }
            const authOrigin = process.env.NODE_ENV === "production" ? "https://auth.betelgeze.com" : request.nextUrl.origin
            const { data, error } = await supabase.auth.signUp({
                email: context.email,
                password,
                options: {
                    data: { username },
                    emailRedirectTo: `${authOrigin}/auth/callback?next=${encodeURIComponent("/sign-up/about")}`,
                },
            })
            if (error) {
                const collision = error.message.toLowerCase().includes("database error")
                if (collision) {
                    await updateOnboardingSession(context.sessionId, { current_step: "username" })
                    return jsonWithSession(sessionResponse, { code: "username_unavailable", error: accountErrorMessage("username_unavailable"), alternatives: await availableUsernameAlternatives(username) }, { status: 409 })
                }
                throw error
            }
            await updateOnboardingSession(context.sessionId, {
                auth_user_id: data.user?.id ?? null,
                current_step: data.session ? "about" : "verify-email",
            })
            return jsonWithSession(sessionResponse, { next: data.session ? "/sign-up/about" : "/sign-up/verify-email" })
        }

        if (action === "verify-email") {
            const code = String(body?.code ?? "").replace(/\D/g, "").slice(0, 6)
            if (!/^\d{6}$/.test(code)) return jsonWithSession(sessionResponse, { code: "invalid_otp", error: accountErrorMessage("invalid_otp") }, { status: 400 })
            const { data, error } = await supabase.auth.verifyOtp({ email: context.email, token: code, type: "signup" })
            if (error || !data.user) return jsonWithSession(sessionResponse, { code: "invalid_otp", error: accountErrorMessage(error?.message.toLowerCase().includes("expired") ? "expired_otp" : "invalid_otp") }, { status: 400 })
            await updateOnboardingSession(context.sessionId, { auth_user_id: data.user.id, current_step: "about" })
            return jsonWithSession(sessionResponse, { next: "/sign-up/about" })
        }

        if (action === "resend-signup") {
            const { error } = await supabase.auth.resend({ type: "signup", email: context.email })
            if (error) return jsonWithSession(sessionResponse, { code: "rate_limited", error: accountErrorMessage(error.message.toLowerCase().includes("rate") ? "rate_limited" : "unknown") }, { status: 400 })
            return jsonWithSession(sessionResponse, { ok: true })
        }

        const { data: authData } = await supabase.auth.getUser()
        const user = authData.user
        if (!user) return jsonWithSession(sessionResponse, { code: "auth_required", error: accountErrorMessage("auth_required") }, { status: 401 })

        if (action === "about") {
            const intendedUses = Array.isArray(body?.intendedUses) ? body.intendedUses.filter((value: unknown): value is string => typeof value === "string" && intendedUseOptions.has(value)) : []
            const roleAnswer = typeof body?.roleAnswer === "string" && roleOptions.has(body.roleAnswer) ? body.roleAnswer : null
            await supabaseAdmin.from("account_onboarding_responses").upsert({
                session_id: context.sessionId,
                user_id: user.id,
                question_version: 1,
                intended_uses: intendedUses.length ? intendedUses : ["prefer-not-to-say"],
                role_answer: roleAnswer,
                updated_at: new Date().toISOString(),
            }, { onConflict: "session_id" })
            await updateOnboardingSession(context.sessionId, { auth_user_id: user.id, current_step: "profile" })
            return jsonWithSession(sessionResponse, { next: "/sign-up/profile" })
        }

        if (action === "profile" && formData) {
            const displayNameInput = String(formData.get("displayName") ?? "").replace(/\s+/g, " ").trim()
            const { data: profile } = await supabaseAdmin.from("user_profiles").select("username, avatar_path").eq("user_id", user.id).single()
            const displayName = displayNameInput && displayNameInput.length <= 50 ? displayNameInput : profile?.username
            const avatar = formData.get("avatar")
            let avatarPath = profile?.avatar_path ?? null
            if (avatar instanceof File && avatar.size > 0) {
                if (avatar.size > 10 * 1024 * 1024) return jsonWithSession(sessionResponse, { code: "avatar_too_large", error: "Profile pictures must be 10MB or smaller." }, { status: 400 })
                avatarPath = await storeProfileAvatar(user.id, { name: avatar.name, size: avatar.size, type: avatar.type, bytes: new Uint8Array(await avatar.arrayBuffer()) })
            }
            const { error } = await supabaseAdmin.from("user_profiles").update({ display_name: displayName, avatar_path: avatarPath, updated_at: new Date().toISOString() }).eq("user_id", user.id)
            if (error) throw error
            await updateOnboardingSession(context.sessionId, { auth_user_id: user.id, current_step: "2fa" })
            return jsonWithSession(sessionResponse, { next: "/sign-up/2fa" })
        }

        return jsonWithSession(sessionResponse, { code: "invalid_step", error: "This setup step is no longer available. Resume from your current step." }, { status: 409 })
    } catch (error) {
        return friendlyError(error)
    }
}
