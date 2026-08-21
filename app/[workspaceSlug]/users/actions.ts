"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { normalizeWorkspaceRole, requireWorkspace, type WorkspaceRole } from "@/lib/workspaces"
import { emailDeliveryFailureDetails, sendWorkspaceInvitation } from "@/lib/email"
import { recordAdminActivity } from "@/lib/admin/activity"

export type WorkspaceInvitationActionState = {
    ok?: boolean
    message?: string
}

function invitedRole(value: FormDataEntryValue | null) {
    const role = normalizeWorkspaceRole(value)
    if (role === "staff" || role === "admin") return role
    throw new Error("Invalid role")
}

async function requireUserManager(slug: string) {
    return requireWorkspace(slug, "admin")
}

export async function inviteWorkspaceUser(slug: string, _state: WorkspaceInvitationActionState, formData: FormData): Promise<WorkspaceInvitationActionState> {
    const { workspace, role, user } = await requireUserManager(slug)
    const email = String(formData.get("email") ?? "").trim().toLowerCase()
    if (!email) return { ok: false, message: "Enter an email address." }
    let requestedRole: "staff" | "admin"
    try {
        requestedRole = invitedRole(formData.get("role"))
    } catch {
        return { ok: false, message: "Choose a valid workspace role." }
    }
    if (role !== "owner" && requestedRole !== "staff") {
        return { ok: false, message: "Only workspace owners can invite admins." }
    }

    const { data: existingInvitation, error: lookupError } = await supabaseAdmin
        .from("workspace_invitations")
        .select("id")
        .eq("workspace_id", workspace.id)
        .eq("email", email)
        .maybeSingle()
    if (lookupError) return { ok: false, message: "Invitation failed before the email was sent. Nothing was saved." }

    const invitationId = existingInvitation?.id ?? crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const inviteUrl = `https://betelgeze.com/invitation?token=${invitationId}&email=${encodeURIComponent(email)}`
    const { data: inviterProfile } = await supabaseAdmin
        .from("user_profiles")
        .select("display_name, username")
        .eq("user_id", user.id)
        .maybeSingle()
    const inviterName = inviterProfile?.display_name?.trim() || inviterProfile?.username || user.email || "A workspace administrator"
    try {
        await sendWorkspaceInvitation({ to: email, workspaceName: workspace.name, inviterName, inviteUrl })
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
        return { ok: false, message: `Invitation failed because ${reason}. Nothing was saved.` }
    }

    const { error } = await supabaseAdmin.from("workspace_invitations").upsert({ id: invitationId, workspace_id: workspace.id, email, role: requestedRole, invited_by: user.id, expires_at: expiresAt, accepted_at: null }, { onConflict: "workspace_id,email" })
    if (error) return { ok: false, message: "The email was sent, but Betelgeze could not save the invitation. Please try again." }
    revalidatePath(`/${slug}/settings`)
    return { ok: true, message: `Invitation sent to ${email}.` }
}

export async function updateWorkspaceUserRole(slug: string, formData: FormData) {
    const { workspace, role: actingRole } = await requireUserManager(slug)
    if (actingRole !== "owner") throw new Error("Only workspace owners can change roles")
    const userId = String(formData.get("userId") ?? "")
    const role = invitedRole(formData.get("role")) as WorkspaceRole
    await supabaseAdmin
        .from("workspace_memberships")
        .update({ role })
        .eq("workspace_id", workspace.id)
        .eq("user_id", userId)
    revalidatePath(`/${slug}/users`)
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
