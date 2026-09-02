"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { normalizeWorkspaceRole, requireWorkspace } from "@/lib/workspaces"
import { emailDeliveryFailureDetails, sendSecurityNotice, sendWorkspaceInvitation } from "@/lib/email"
import { recordAdminActivity } from "@/lib/admin/activity"
import { createAccountToken, hashAccountToken } from "@/lib/auth/account-tokens"
import { accountFlowV2Enabled } from "@/lib/auth/account-flow"
import { authOrigin } from "@/lib/auth/origin"

export type WorkspaceInvitationActionState = {
    ok: boolean
    message: string
}

function invitedRole(value: FormDataEntryValue | null) {
    const role = normalizeWorkspaceRole(value)
    if (role === "staff" || role === "admin") return role
    throw new Error("Invalid role")
}

function requestedServiceIds(formData: FormData) {
    return [...new Set(formData.getAll("serviceId").map(String).filter((value) => /^[0-9a-f-]{36}$/i.test(value)))]
}

async function requireUserManager(slug: string) {
    return requireWorkspace(slug, "admin")
}

export async function inviteWorkspaceUser(slug: string, formData: FormData): Promise<WorkspaceInvitationActionState> {
    if (!accountFlowV2Enabled()) return { ok: false, message: "New account invitations are paused until Account Flow V2 is enabled." }
    const { workspace, role, user } = await requireUserManager(slug)
    const email = String(formData.get("email") ?? "").trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) return { ok: false, message: "Enter a valid email address." }
    let requestedRole: "staff" | "admin"
    try {
        requestedRole = invitedRole(formData.get("role"))
    } catch {
        return { ok: false, message: "Choose a valid workspace role." }
    }
    if (role !== "owner" && requestedRole !== "staff") {
        return { ok: false, message: "Only workspace owners can invite admins." }
    }
    const serviceIds = requestedRole === "staff" ? requestedServiceIds(formData) : []
    if (requestedRole === "staff" && !serviceIds.length) {
        return { ok: false, message: "Choose at least one service for this Staff member." }
    }
    const { data: targetState, error: targetStateError } = await supabaseAdmin.rpc("lookup_workspace_invitation_target", {
        p_workspace_id: workspace.id,
        p_actor_user_id: user.id,
        p_identifier: email,
    })
    if (targetStateError || !targetState) return { ok: false, message: "Betelgeze could not confirm that invitation target. Search for them again." }
    const currentTarget = targetState as { is_workspace_member?: unknown; invitation_pending?: unknown }
    if (currentTarget.is_workspace_member === true) return { ok: false, message: "That person is already in this workspace." }
    if (currentTarget.invitation_pending === true) return { ok: false, message: "An invitation for that person is already pending." }

    const proposedInvitationId = crypto.randomUUID()
    const invitationToken = createAccountToken()
    const invitationTokenHash = hashAccountToken(invitationToken)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const inviteUrl = `${authOrigin()}/invitation?token=${encodeURIComponent(invitationToken)}`
    const { data: inviterProfile } = await supabaseAdmin
        .from("user_profiles")
        .select("display_name, username")
        .eq("user_id", user.id)
        .maybeSingle()
    const inviterName = inviterProfile?.display_name?.trim() || inviterProfile?.username || user.email || "A workspace administrator"
    const { data: persistedInvitation, error: persistError } = await supabaseAdmin.rpc("rotate_workspace_invitation", {
        p_invitation_id: proposedInvitationId,
        p_workspace_id: workspace.id,
        p_email: email,
        p_role: requestedRole,
        p_invited_by: user.id,
        p_expires_at: expiresAt,
        p_token_hash: invitationTokenHash,
        p_service_ids: serviceIds,
    })
    if (persistError || !persistedInvitation) return { ok: false, message: "Betelgeze could not safely save the invitation, so no email was sent." }
    const invitationId = (persistedInvitation as { invitation_id: string }).invitation_id

    try {
        const delivery = await sendWorkspaceInvitation({ to: email, workspaceName: workspace.name, inviterName, inviteUrl, invitationId })
        await supabaseAdmin.from("workspace_invitations").update({ delivery_status: "sent", provider_message_id: delivery.providerMessageId, sent_at: new Date().toISOString() }).eq("id", invitationId).eq("token_hash", invitationTokenHash)
    } catch (error) {
        const details = emailDeliveryFailureDetails(error)
        console.error("Workspace invitation email failed", {
            workspaceId: workspace.id,
            kind: details.kind,
            providerCode: details.providerCode,
            providerCommand: details.providerCommand,
            providerResponseCode: details.providerResponseCode,
            providerResponse: details.providerResponse,
        })
        await supabaseAdmin.from("workspace_invitations").update({ delivery_status: "failed", delivery_failed_at: new Date().toISOString(), delivery_failure_code: details.providerCode ?? details.kind }).eq("id", invitationId).eq("token_hash", invitationTokenHash)
        await recordAdminActivity({
            workspaceId: workspace.id,
            category: "integrations",
            level: "error",
            eventKey: "workspace.invitation.email.failed",
            summary: "Workspace invitation email failed",
            sourceHref: `/${slug}/settings#users`,
            actorUserId: user.id,
            actorKind: "staff",
            outcome: "failed",
            metricClassification: "external_call",
            diagnostics: {
                kind: details.kind,
                provider_code: details.providerCode,
                provider_command: details.providerCommand,
                provider_response_code: details.providerResponseCode,
                provider_response: details.providerResponse,
            },
        })
        const reason = details.kind === "authentication" || details.kind === "configuration"
            ? "Betelgeze's Resend connection is not configured correctly"
            : details.kind === "connection" || details.kind === "tls"
                ? "Betelgeze could not connect securely to Resend"
                : details.kind === "sender"
                    ? "Resend rejected Betelgeze's sender address"
                    : details.kind === "recipient"
                        ? "Resend rejected the recipient address"
                        : "Resend rejected the message"
        return { ok: false, message: `The invitation was saved, but its email failed because ${reason}. Resend it after the connection is fixed.` }
    }
    revalidatePath(`/${slug}/settings`)
    return { ok: true, message: "Invitation email sent." }
}

export async function removeWorkspaceUser(slug: string, formData: FormData) {
    const { workspace, role: actingRole } = await requireUserManager(slug)
    const userId = String(formData.get("userId") ?? "")
    const { data: target } = await supabaseAdmin
        .from("workspace_memberships")
        .select("role")
        .eq("workspace_id", workspace.id)
        .eq("user_id", userId)
        .maybeSingle()
    if (!target || target.role === "owner") throw new Error("Owners cannot be removed here")
    if (actingRole !== "owner" && normalizeWorkspaceRole(target.role) !== "staff") {
        throw new Error("Admins can only remove staff")
    }
    await supabaseAdmin
        .from("workspace_memberships")
        .delete()
        .eq("workspace_id", workspace.id)
        .eq("user_id", userId)
    revalidatePath(`/${slug}/users`)
}

export type AdminMfaResetActionState = { ok: boolean; message: string }

async function performWorkspaceUserMfaReset(slug: string, formData: FormData) {
    const { workspace, role: actingRole, user: actor } = await requireUserManager(slug)
    const targetUserId = String(formData.get("userId") ?? "")
    const { data: targetMembership } = await supabaseAdmin.from("workspace_memberships").select("role").eq("workspace_id", workspace.id).eq("user_id", targetUserId).maybeSingle()
    const targetRole = normalizeWorkspaceRole(targetMembership?.role)
    if (!targetRole || targetRole === "owner") throw new Error("Owner MFA resets use the documented break-glass procedure.")
    if (actingRole === "admin" && targetRole !== "staff") throw new Error("Administrators can only reset staff MFA.")
    const { data: targetUser } = await supabaseAdmin.auth.admin.getUserById(targetUserId)
    const email = targetUser.user?.email?.toLowerCase()
    if (!email || String(formData.get("confirmation") ?? "") !== `RESET ${email}`) throw new Error("The MFA reset confirmation did not match.")
    const { data: factors, error: factorsError } = await supabaseAdmin.auth.admin.mfa.listFactors({ userId: targetUserId })
    if (factorsError) throw new Error("Betelgeze could not inspect that account's factors.")
    const { error: profileError } = await supabaseAdmin.from("user_profiles").update({ mfa_reenrollment_required: true, updated_at: new Date().toISOString() }).eq("user_id", targetUserId)
    if (profileError) throw new Error("Betelgeze could not safely require authenticator re-enrolment, so no factors were removed.")
    const deletionResults = await Promise.all(factors.factors.map(async (factor) => ({ factor, result: await supabaseAdmin.auth.admin.mfa.deleteFactor({ userId: targetUserId, id: factor.id }) })))
    const failures = deletionResults.filter(({ result }) => result.error)
    const removedCount = deletionResults.length - failures.length
    const { error: auditError } = await supabaseAdmin.from("account_security_events").insert({ user_id: targetUserId, actor_user_id: actor.id, workspace_id: workspace.id, event_type: "mfa_admin_reset", metadata: { requested_factor_count: factors.factors.length, removed_factor_count: removedCount, failed_factor_count: failures.length, actor_role: actingRole } })
    try { await sendSecurityNotice({ to: email, userId: targetUserId, heading: failures.length ? "Your Betelgeze authenticator reset needs review" : "Your Betelgeze authenticator was reset", body: failures.length ? `A ${workspace.name} administrator requested an authenticator reset, but not every factor could be removed. Your account is blocked from workspace access until the reset is reviewed and authenticator setup is completed.` : `A ${workspace.name} administrator removed the authenticator factors from your account. You must set up an authenticator again before accessing Betelgeze.` }) }
    catch (error) { console.error("MFA reset security notice failed", { workspaceId: workspace.id, targetUserId, error }) }
    revalidatePath(`/${slug}/settings`)
    if (failures.length) throw new Error("The MFA reset was only partially completed. Workspace access is blocked; review the account in Supabase before retrying.")
    if (auditError) throw new Error("The authenticators were reset, but the security audit record failed. Review the account before continuing.")
}

export async function resetWorkspaceUserMfa(slug: string, formData: FormData): Promise<AdminMfaResetActionState> {
    try {
        await performWorkspaceUserMfaReset(slug, formData)
        return { ok: true, message: "Authenticator reset complete. The user must enrol again before workspace access." }
    } catch (error) {
        console.error("Administrative MFA reset failed", { slug, error })
        return {
            ok: false,
            message: error instanceof Error ? error.message : "The authenticator reset could not be completed safely.",
        }
    }
}
