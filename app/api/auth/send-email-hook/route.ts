import { NextRequest, NextResponse } from "next/server"
import { Webhook } from "standardwebhooks"
import { sendAccountEmail } from "@/lib/email"
import type { AccountEmailPurpose } from "@/lib/auth/account-flow-types"

type HookPayload = {
    user: { id: string; email: string; new_email?: string }
    email_data: {
        token: string
        token_hash: string
        redirect_to: string
        email_action_type: string
        site_url: string
        token_new: string
        token_hash_new: string
    }
}

function callbackUrl(tokenHash: string, type: string, next: string) {
    const origin = process.env.NODE_ENV === "production" ? "https://auth.betelgeze.com" : (process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "http://localhost:3000")
    const url = new URL("/auth/callback", origin)
    url.searchParams.set("token_hash", tokenHash)
    url.searchParams.set("type", type)
    url.searchParams.set("next", next)
    return url.toString()
}

async function sendHookEmail({ to, userId, purpose, subject, preview, heading, body, token, tokenHash, type, next }: { to: string; userId: string; purpose: AccountEmailPurpose; subject: string; preview: string; heading: string; body: string; token: string; tokenHash: string; type: string; next: string }) {
    return sendAccountEmail({
        to,
        userId,
        purpose,
        subject,
        template: {
            preview,
            heading,
            body,
            code: token || null,
            actionLabel: tokenHash ? "Continue securely" : null,
            actionUrl: tokenHash ? callbackUrl(tokenHash, type, next) : null,
            expires: token ? "This code expires shortly. Only the newest Betelgeze code will work." : null,
        },
    })
}

export async function POST(request: NextRequest) {
    const rawBody = await request.text()
    const configuredSecret = process.env.SEND_EMAIL_HOOK_SECRET?.trim()
    if (!configuredSecret) return NextResponse.json({ error: { http_code: 500, message: "Email hook is not configured." } }, { status: 500 })
    let payload: HookPayload
    try {
        const secret = configuredSecret.replace(/^v1,whsec_/, "")
        payload = new Webhook(secret).verify(rawBody, Object.fromEntries(request.headers)) as HookPayload
    } catch {
        return NextResponse.json({ error: { http_code: 401, message: "Invalid webhook signature." } }, { status: 401 })
    }

    const { user, email_data: email } = payload
    try {
        if (email.email_action_type === "email_change") {
            const newEmail = user.new_email?.trim()
            if (!newEmail) throw new Error("Email change payload did not include the new address")
            if (email.token_hash_new && email.token) {
                await sendHookEmail({ to: user.email, userId: user.id, purpose: "email_change_current", subject: "Approve your Betelgeze email change", preview: "Approve the requested change from your current email.", heading: "Approve your email change", body: `A request was made to change this Betelgeze account from ${user.email} to ${newEmail}. Confirm from this current address first.`, token: email.token, tokenHash: email.token_hash_new, type: "email_change", next: "/workspaces" })
            }
            const newToken = email.token_new || email.token
            const newHash = email.token_hash || ""
            await sendHookEmail({ to: newEmail, userId: user.id, purpose: "email_change_new", subject: "Confirm your new Betelgeze email", preview: "Confirm this address for your Betelgeze account.", heading: "Confirm your new email", body: `Confirm ${newEmail} as the new address for your Betelgeze account.`, token: newToken, tokenHash: newHash, type: "email_change", next: "/workspaces" })
        } else if (email.email_action_type === "recovery") {
            await sendHookEmail({ to: user.email, userId: user.id, purpose: "password_recovery_otp", subject: "Your Betelgeze password recovery code", preview: `Your recovery code is ${email.token}.`, heading: "Recover your password", body: "Enter this six-digit code in the Betelgeze recovery page. The code alone does not disable your authenticator.", token: email.token, tokenHash: email.token_hash, type: "recovery", next: "/forgot-password/new-password" })
        } else if (email.email_action_type === "signup" || email.email_action_type === "invite") {
            await sendHookEmail({ to: user.email, userId: user.id, purpose: "signup_otp", subject: "Verify your Betelgeze email", preview: `Your verification code is ${email.token}.`, heading: "Verify your email", body: "Enter this code in the account setup flow to confirm that this invitation belongs to you.", token: email.token, tokenHash: email.token_hash, type: email.email_action_type === "invite" ? "invite" : "signup", next: "/sign-up/about" })
        } else {
            const otpType = email.email_action_type === "magic_link" ? "magiclink" : email.email_action_type === "email" ? "email" : "reauthentication"
            await sendHookEmail({ to: user.email, userId: user.id, purpose: "reauthentication", subject: "Confirm your Betelgeze security action", preview: `Your confirmation code is ${email.token}.`, heading: "Confirm it’s you", body: "A sensitive account action needs fresh confirmation. Enter this code only in Betelgeze.", token: email.token, tokenHash: email.token_hash, type: otpType, next: "/workspaces" })
        }
        return NextResponse.json({})
    } catch (error) {
        console.error("Supabase account email hook failed", { action: email.email_action_type, userId: user.id, error })
        return NextResponse.json({ error: { http_code: 502, message: "Account email delivery failed." } }, { status: 502 })
    }
}
