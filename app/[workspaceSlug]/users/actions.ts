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
    const { workspace, role } = await requireUserManager(slug)
    const email = String(formData.get("email") ?? "").trim().toLowerCase()
    const requestedRole = invitedRole(formData.get("role"))
    if (!email) throw new Error("Email is required")
    if (role !== "owner" && requestedRole !== "staff") {
        throw new Error("Only workspace owners can invite admins")
    }

    const { data: invitation, error } = await supabaseAdmin.from("workspace_invitations").upsert({ workspace_id: workspace.id, email, role: requestedRole, invited_by: (await requireUserManager(slug)).user.id, expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), accepted_at: null }, { onConflict: "workspace_id,email" }).select("id").single()
    if (error) throw new Error(error.message)
    const inviteUrl = `https://betelgeze.com/invitation?token=${invitation.id}&email=${encodeURIComponent(email)}`
    await sendWorkspaceInvitation({ to: email, workspaceName: workspace.name, inviteUrl })
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
