import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"
import { accountCookieOptions, RECOVERY_EMAIL_COOKIE, RECOVERY_VERIFIED_COOKIE } from "@/lib/auth/account-flow"
import { createAccountToken, hashAccountToken } from "@/lib/auth/account-tokens"
import { accountErrorMessage } from "@/lib/auth/errors"
import { passwordRequirements } from "@/lib/auth/password"
import { getRequiredEnv } from "@/lib/env"
import { createSupabaseRouteClient } from "@/lib/supabase/route"
import { carrySessionResponse } from "@/lib/supabase/session-cookies"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { sendPasswordChangedNotice } from "@/lib/email"

function withSession<T>(source: NextResponse, body: T, init?: ResponseInit) {
    return carrySessionResponse(source, NextResponse.json(body, init))
}

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null)
    const action = typeof body?.action === "string" ? body.action : ""

    if (action === "request") {
        const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : ""
        if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 })
        const authOrigin = process.env.NODE_ENV === "production" ? "https://auth.betelgeze.com" : request.nextUrl.origin
        const supabase = createClient(getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"), getRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), { auth: { persistSession: false, autoRefreshToken: false } })
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${authOrigin}/forgot-password/new-password` })
        if (error) console.warn("Password recovery request was not delivered", { code: error.code, status: error.status })
        const response = NextResponse.json({ ok: true, next: "/forgot-password/code" })
        response.cookies.set(RECOVERY_EMAIL_COOKIE, encodeURIComponent(email), accountCookieOptions(15 * 60, { hostOnly: true }))
        response.cookies.set(RECOVERY_VERIFIED_COOKIE, "", { ...accountCookieOptions(0, { hostOnly: true }), maxAge: 0 })
        return response
    }

    const encodedEmail = request.cookies.get(RECOVERY_EMAIL_COOKIE)?.value
    let email = ""
    try { email = encodedEmail ? decodeURIComponent(encodedEmail) : "" } catch { email = "" }
    if (!email) return NextResponse.json({ code: "recovery_expired", error: "This recovery session has expired. Request a new code." }, { status: 401 })
    const sessionResponse = NextResponse.json({ ok: true })
    const supabase = createSupabaseRouteClient(request, sessionResponse)

    if (action === "verify") {
        const code = typeof body?.code === "string" ? body.code.replace(/\D/g, "").slice(0, 6) : ""
        if (!/^\d{6}$/.test(code)) return withSession(sessionResponse, { code: "invalid_otp", error: accountErrorMessage("invalid_otp") }, { status: 400 })
        const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: "recovery" })
        if (error || !data.user) return withSession(sessionResponse, { code: "invalid_otp", error: accountErrorMessage(error?.message.toLowerCase().includes("expired") ? "expired_otp" : "invalid_otp") }, { status: 400 })
        const recoveryToken = createAccountToken()
        const { error: recoverySessionError } = await supabaseAdmin.from("account_password_recovery_sessions").insert({
            browser_token_hash: hashAccountToken(recoveryToken),
            auth_user_id: data.user.id,
            email_hash: hashAccountToken(email),
            expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        })
        if (recoverySessionError) {
            await supabase.auth.signOut({ scope: "local" })
            return withSession(sessionResponse, { code: "configuration_error", error: accountErrorMessage("configuration_error") }, { status: 500 })
        }
        const verified = withSession(sessionResponse, { ok: true, next: "/forgot-password/new-password" })
        verified.cookies.set(RECOVERY_VERIFIED_COOKIE, recoveryToken, accountCookieOptions(10 * 60, { hostOnly: true }))
        return verified
    }

    if (action === "resend") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${request.nextUrl.origin}/forgot-password/new-password` })
        if (error) return withSession(sessionResponse, { code: "rate_limited", error: accountErrorMessage(error.message.toLowerCase().includes("rate") ? "rate_limited" : "unknown") }, { status: 400 })
        return withSession(sessionResponse, { ok: true })
    }

    if (action === "update") {
        const password = typeof body?.password === "string" ? body.password : ""
        if (!passwordRequirements(password).every((requirement) => requirement.met)) return withSession(sessionResponse, { code: "weak_password", error: "Use a password that meets every requirement." }, { status: 400 })
        const { data: authData } = await supabase.auth.getUser()
        if (!authData.user) return withSession(sessionResponse, { code: "auth_required", error: "Verify a fresh recovery code before changing your password." }, { status: 401 })
        const recoveryToken = request.cookies.get(RECOVERY_VERIFIED_COOKIE)?.value
        const { data: recoverySession } = recoveryToken
            ? await supabaseAdmin.from("account_password_recovery_sessions").select("id, auth_user_id, email_hash, expires_at, completed_at").eq("browser_token_hash", hashAccountToken(recoveryToken)).maybeSingle()
            : { data: null }
        if (!recoverySession
            || recoverySession.auth_user_id !== authData.user.id
            || recoverySession.email_hash !== hashAccountToken(email)
            || recoverySession.completed_at
            || new Date(recoverySession.expires_at) <= new Date()) {
            return withSession(sessionResponse, { code: "recovery_expired", error: "Verify a fresh recovery code for this account before changing its password." }, { status: 401 })
        }
        const { error } = await supabase.auth.updateUser({ password })
        if (error) return withSession(sessionResponse, { code: "password_update_failed", error: "The password could not be changed. Request a fresh recovery code and try again." }, { status: 400 })
        await supabaseAdmin.from("account_security_events").insert({ user_id: authData.user.id, actor_user_id: authData.user.id, event_type: "password_changed", metadata: { method: "recovery" } })
        if (authData.user.email) {
            try {
                await sendPasswordChangedNotice({ to: authData.user.email, userId: authData.user.id })
            } catch (noticeError) {
                console.error("Password-change security notice failed", { userId: authData.user.id, noticeError })
            }
        }
        await supabase.auth.signOut({ scope: "local" })
        await supabaseAdmin.from("account_password_recovery_sessions").update({ completed_at: new Date().toISOString() }).eq("id", recoverySession.id).is("completed_at", null)
        const response = withSession(sessionResponse, { ok: true, next: "/forgot-password/complete" })
        response.cookies.set(RECOVERY_EMAIL_COOKIE, "", { ...accountCookieOptions(0, { hostOnly: true }), maxAge: 0 })
        response.cookies.set(RECOVERY_VERIFIED_COOKIE, "", { ...accountCookieOptions(0, { hostOnly: true }), maxAge: 0 })
        return response
    }

    return withSession(sessionResponse, { error: "This recovery step is not available." }, { status: 400 })
}
