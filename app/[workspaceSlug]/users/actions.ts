"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { normalizeWorkspaceRole, requireWorkspace, type WorkspaceRole } from "@/lib/workspaces"
import { sendWorkspaceInvitation } from "@/lib/email"

function invitedRole(value: FormDataEntryValue | null) {
    const role = normalizeWorkspaceRole(value)
    if (role === "staff" || role === "admin") return role
    throw new Error("Invalid role")
}

async function requireUserManager(slug: string) {
    return requireWorkspace(slug, "admin")
}

export async function inviteWorkspaceUser(slug: string, formData: FormData) {
    const { workspace, role, user } = await requireUserManager(slug)
    const email = String(formData.get("email") ?? "").trim().toLowerCase()
    const requestedRole = invitedRole(formData.get("role"))
    if (!email) throw new Error("Email is required")
    if (role !== "owner" && requestedRole !== "staff") {
        throw new Error("Only workspace owners can invite admins")
    }

    const { data: existingInvitation, error: lookupError } = await supabaseAdmin
        .from("workspace_invitations")
        .select("id")
        .eq("workspace_id", workspace.id)
        .eq("email", email)
        .maybeSingle()
    if (lookupError) throw new Error(lookupError.message)

    const invitationId = existingInvitation?.id ?? crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const inviteUrl = `https://betelgeze.com/invitation?token=${invitationId}&email=${encodeURIComponent(email)}`
    await sendWorkspaceInvitation({ to: email, workspaceName: workspace.name, inviteUrl })

    const { error } = await supabaseAdmin.from("workspace_invitations").upsert({ id: invitationId, workspace_id: workspace.id, email, role: requestedRole, invited_by: user.id, expires_at: expiresAt, accepted_at: null }, { onConflict: "workspace_id,email" })
    if (error) throw new Error(error.message)
    revalidatePath(`/${slug}/settings`)
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
