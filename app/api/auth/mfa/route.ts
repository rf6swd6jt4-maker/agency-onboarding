import { NextRequest, NextResponse } from "next/server"
import { getOnboardingContext, ONBOARDING_COOKIE, updateOnboardingSession } from "@/lib/auth/account-flow"
import { createSupabaseRouteClient } from "@/lib/supabase/route"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { carrySessionResponse } from "@/lib/supabase/session-cookies"

function jsonWithSessionCookies<T>(sessionResponse: NextResponse, body: T, init?: ResponseInit) {
    const response = NextResponse.json(body, init)
    return carrySessionResponse(sessionResponse, response)
}

export async function GET(request: NextRequest) {
    const sessionResponse = NextResponse.json({ verified: false })
    const supabase = createSupabaseRouteClient(request, sessionResponse)
    const [{ data, error }, { data: assurance }, { data: authData }] = await Promise.all([
        supabase.auth.mfa.listFactors(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.getUser(),
    ])
    if (error) return jsonWithSessionCookies(sessionResponse, { error: "Your security session could not be checked. Sign in again." }, { status: 401 })
    const { data: profile, error: profileError } = authData.user
        ? await supabaseAdmin.from("user_profiles").select("mfa_reenrollment_required").eq("user_id", authData.user.id).maybeSingle()
        : { data: null, error: null }
    if (profileError) return jsonWithSessionCookies(sessionResponse, { error: "Your authenticator reset state could not be checked. Try again shortly." }, { status: 503 })
    const reenrollmentRequired = Boolean(profile?.mfa_reenrollment_required)
    const pending = data?.all.find((factor) => factor.factor_type === "totp" && factor.status === "unverified")
    return jsonWithSessionCookies(sessionResponse, {
        assured: assurance?.currentLevel === "aal2" && !reenrollmentRequired,
        reenrollmentRequired,
        verified: Boolean(data?.totp.some((factor) => factor.status === "verified")),
        verifiedFactorCount: data?.totp.filter((factor) => factor.status === "verified").length ?? 0,
        factors: data?.totp.filter((factor) => factor.status === "verified").map((factor) => ({ id: factor.id, friendlyName: factor.friendly_name ?? "Authenticator", createdAt: factor.created_at })) ?? [],
        pendingFactorId: pending?.id ?? null,
    })
}

export async function POST(request: NextRequest) {
    let code = ""
    let action = "verify"
    let factorId = ""
    let friendlyName = "Betelgeze"
    try {
        const payload = await request.json()
        code = typeof payload?.code === "string" ? payload.code : ""
        action = typeof payload?.action === "string" ? payload.action : "verify"
        factorId = typeof payload?.factorId === "string" ? payload.factorId : ""
        friendlyName = typeof payload?.friendlyName === "string"
            ? payload.friendlyName.replace(/[^a-z0-9 _-]/gi, "").trim().slice(0, 40) || "Betelgeze"
            : "Betelgeze"
    } catch {
        return NextResponse.json({ error: "Enter your six-digit authentication code." }, { status: 400 })
    }

    const response = NextResponse.json({ ok: true })
    const supabase = createSupabaseRouteClient(request, response)
    const { data: factorData, error: factorError } = await supabase.auth.mfa.listFactors()
    if (factorError) return jsonWithSessionCookies(response, { error: "Your security session could not be checked. Sign in again." }, { status: 401 })

    if (action === "setup") {
        const pending = factorData?.all.find((factor) => factor.factor_type === "totp" && factor.status === "unverified")
        if (pending) return jsonWithSessionCookies(response, { factorId: pending.id, pending: true })
        const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName })
        if (error) return jsonWithSessionCookies(response, { error: "We could not start authenticator setup. If you already scanned a code, enter its current code to finish setup." }, { status: 400 })
        return jsonWithSessionCookies(response, { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
    }

    if (action === "reset-setup") {
        const pending = factorData?.all.find((factor) => factor.factor_type === "totp" && factor.status === "unverified")
        if (!pending) return jsonWithSessionCookies(response, { cleared: true })
        const { error } = await supabase.auth.mfa.unenroll({ factorId: pending.id })
        if (error) return jsonWithSessionCookies(response, { error: "We could not clear the unfinished authenticator setup. Please try again." }, { status: 400 })
        return jsonWithSessionCookies(response, { cleared: true })
    }

    if (!/^\d{6}$/.test(code)) return jsonWithSessionCookies(response, { error: "Enter a valid six-digit authentication code." }, { status: 400 })

    const factor = factorId
        ? factorData?.all.find((item) => item.id === factorId && item.factor_type === "totp")
        : factorData?.totp.find((item) => item.status === "verified")
    if (!factor) {
        return jsonWithSessionCookies(response, { error: "Your unfinished authenticator setup could not be found. Start again with a new QR code." }, { status: 403 })
    }

    const { data: authDataBeforeVerify } = await supabase.auth.getUser()
    const { data: profileBeforeVerify, error: profileBeforeVerifyError } = authDataBeforeVerify.user
        ? await supabaseAdmin.from("user_profiles").select("mfa_reenrollment_required").eq("user_id", authDataBeforeVerify.user.id).maybeSingle()
        : { data: null, error: null }
    if (profileBeforeVerifyError) {
        return jsonWithSessionCookies(response, { error: "Your authenticator reset state could not be checked. Try again shortly." }, { status: 503 })
    }
    if (profileBeforeVerify?.mfa_reenrollment_required && factor.status !== "unverified") {
        return jsonWithSessionCookies(response, { code: "mfa_reenrollment_required", error: "Set up and verify a new authenticator before continuing." }, { status: 409 })
    }

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: factor.id })
    if (challengeError) return jsonWithSessionCookies(response, { error: "We could not check that authenticator yet. Please try again." }, { status: 400 })

    const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: factor.id,
        challengeId: challenge.id,
        code,
    })
    if (verifyError) {
        const expired = verifyError.message.toLowerCase().includes("expired")
        return jsonWithSessionCookies(response, {
            code: expired ? "expired_totp_challenge" : "invalid_totp",
            error: expired
                ? "That authenticator challenge expired. Enter the newest code to try again."
                : "That code did not match. Check that your device time is automatic, then try the newest code.",
        }, { status: 401 })
    }

    const { data: authData } = await supabase.auth.getUser()
    if (authData.user) {
        if (factor.status === "unverified") {
            await supabaseAdmin.from("user_profiles").update({ mfa_reenrollment_required: false, updated_at: new Date().toISOString() }).eq("user_id", authData.user.id)
            await supabaseAdmin.from("account_security_events").insert({
                user_id: authData.user.id,
                actor_user_id: authData.user.id,
                event_type: (factorData?.totp.filter((item) => item.status === "verified").length ?? 0) > 0 ? "mfa_backup_enrolled" : "mfa_enrolled",
                metadata: { factor_id: factor.id },
            })
        }
        const context = await getOnboardingContext(request.cookies.get(ONBOARDING_COOKIE)?.value)
        if (context?.currentStep === "2fa") await updateOnboardingSession(context.sessionId, { auth_user_id: authData.user.id, current_step: "complete" })
    }

    return response
}

export async function DELETE(request: NextRequest) {
    const factorId = request.nextUrl.searchParams.get("factorId") ?? ""
    const response = NextResponse.json({ ok: true })
    const supabase = createSupabaseRouteClient(request, response)
    const [{ data: authData }, { data: assurance }, { data: factors }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
    ])
    if (!authData.user || assurance?.currentLevel !== "aal2") return jsonWithSessionCookies(response, { error: "Confirm your authenticator before changing security factors." }, { status: 403 })
    const verified = factors?.totp.filter((factor) => factor.status === "verified") ?? []
    if (verified.length <= 1) return jsonWithSessionCookies(response, { error: "Add and verify a backup authenticator before removing this factor." }, { status: 409 })
    if (!verified.some((factor) => factor.id === factorId)) return jsonWithSessionCookies(response, { error: "That authenticator factor is no longer available." }, { status: 404 })
    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    if (error) return jsonWithSessionCookies(response, { error: "The authenticator could not be removed. Try again after signing in freshly." }, { status: 400 })
    await supabaseAdmin.from("account_security_events").insert({ user_id: authData.user.id, actor_user_id: authData.user.id, event_type: "mfa_factor_removed", metadata: { factor_id: factorId } })
    return response
}
