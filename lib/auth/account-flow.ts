import "server-only"

import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createAccountToken, hashAccountToken } from "@/lib/auth/account-tokens"
import { AUTH_STEPS, type AuthStep, type OnboardingContext } from "@/lib/auth/account-flow-types"

export const ONBOARDING_COOKIE = "betelgeze-onboarding"
export const RECOVERY_EMAIL_COOKIE = "betelgeze-recovery-email"
export const RECOVERY_VERIFIED_COOKIE = "betelgeze-recovery-verified"
export const WELCOME_EVENT_COOKIE = "betelgeze-welcome-event"

export function accountFlowV2Enabled() {
    return process.env.ACCOUNT_FLOW_V2_ENABLED === "true"
}

export function authStepIndex(step: AuthStep) {
    return AUTH_STEPS.indexOf(step)
}

export function isAuthStep(value: string): value is AuthStep {
    return (AUTH_STEPS as readonly string[]).includes(value)
}

export function accountCookieOptions(maxAge: number, { hostOnly = false }: { hostOnly?: boolean } = {}) {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
    let domain: string | undefined
    try {
        const hostname = siteUrl ? new URL(siteUrl).hostname : "betelgeze.com"
        if (!hostOnly && (hostname === "betelgeze.com" || hostname.endsWith(".betelgeze.com"))) domain = ".betelgeze.com"
    } catch {
        domain = undefined
    }
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax" as const,
        path: "/",
        maxAge,
        ...(domain ? { domain } : {}),
    }
}

type OnboardingRow = {
    id: string
    invitation_id: string
    auth_user_id: string | null
    current_step: string
    username_candidate: string | null
    expires_at: string
    completed_at: string | null
    workspace_invitations: {
        id: string
        workspace_id: string
        email: string
        role: string
        expires_at: string
        accepted_at: string | null
        revoked_at: string | null
        workspaces: { id: string; name: string; slug: string; status: string }
    }
}

export async function getOnboardingContext(rawToken?: string | null): Promise<OnboardingContext | null> {
    const token = rawToken ?? (await cookies()).get(ONBOARDING_COOKIE)?.value
    if (!token) return null
    const { data } = await supabaseAdmin
        .from("account_onboarding_sessions")
        .select("id, invitation_id, auth_user_id, current_step, username_candidate, expires_at, completed_at, workspace_invitations!inner(id, workspace_id, email, role, expires_at, accepted_at, revoked_at, workspaces!inner(id, name, slug, status))")
        .eq("browser_token_hash", hashAccountToken(token))
        .maybeSingle() as { data: OnboardingRow | null }
    if (!data || new Date(data.expires_at) <= new Date()) return null
    const invitation = data.workspace_invitations
    if (invitation.revoked_at || new Date(invitation.expires_at) <= new Date()) return null
    if (!isAuthStep(data.current_step)) return null
    return {
        sessionId: data.id,
        invitationId: invitation.id,
        email: invitation.email,
        workspaceId: invitation.workspace_id,
        workspaceName: invitation.workspaces.name,
        workspaceSlug: invitation.workspaces.slug,
        role: invitation.role === "admin" ? "admin" : "staff",
        currentStep: data.current_step,
        usernameCandidate: data.username_candidate,
        existingAccount: Boolean(data.auth_user_id),
        expiresAt: data.expires_at,
    }
}

type InvitationExchange = {
    session_id: string
    invitation_id: string
    email: string
    expires_at: string
    existing_account: boolean
}

export async function exchangeInvitationToken(invitationToken: string) {
    const browserToken = createAccountToken()
    const { data, error } = await supabaseAdmin.rpc("exchange_account_invitation", {
        p_invitation_token: invitationToken,
        p_browser_token_hash: hashAccountToken(browserToken),
    })
    if (error || !data) throw new Error("Could not create account setup session")
    const exchange = data as InvitationExchange
    return { browserToken, sessionId: exchange.session_id, invitationId: exchange.invitation_id, email: exchange.email, expiresAt: exchange.expires_at, existingAccount: exchange.existing_account }
}

export async function updateOnboardingSession(sessionId: string, values: { current_step?: AuthStep; username_candidate?: string | null; auth_user_id?: string | null }) {
    const { error } = await supabaseAdmin
        .from("account_onboarding_sessions")
        .update({ ...values, updated_at: new Date().toISOString() })
        .eq("id", sessionId)
    if (error) throw new Error("Could not save onboarding progress")
}
