"use server"

import { redirect } from "next/navigation"
import { redirectToLogin } from "@/lib/auth/server-redirects"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getCurrentUser, normalizeWorkspaceRole } from "@/lib/workspaces"
import { deleteOnboardingUploads, storeProfileAvatar } from "@/lib/onboarding/uploads"

const usernamePattern = /^[a-z0-9][a-z0-9-]{1,27}[a-z0-9]$/

export async function updateUsername(_: { error?: string; username?: string }, formData: FormData) {
    const user = await getCurrentUser()
    if (!user) return await redirectToLogin()
    const username = String(formData.get("username") ?? "").trim().toLowerCase()
    if (!usernamePattern.test(username)) return { error: "Use 3–30 lowercase letters, numbers, or hyphens." }
    const { error } = await supabaseAdmin.from("user_profiles").update({ username }).eq("user_id", user.id)
    if (error) return { error: error.code === "23505" ? "That username is already taken." : "We could not update your username. Please try again." }
    return { username }
}

export async function createWorkspace(username: string, formData: FormData) {
    const user = await getCurrentUser()
    if (!user) return await redirectToLogin()
    const name = String(formData.get("name") ?? "").trim()
    const slug = String(formData.get("slug") ?? "").trim().toLowerCase()
    if (name.length < 2 || !/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$/.test(slug)) throw new Error("Choose a workspace name and a valid URL slug.")
    const { data: workspace, error } = await supabaseAdmin.from("workspaces").insert({ name, slug }).select("id, slug").single()
    if (error || !workspace) throw new Error(error?.code === "23505" ? "That dashboard URL is already taken." : "Could not create dashboard.")
    await supabaseAdmin.from("workspace_memberships").insert({ workspace_id: workspace.id, user_id: user.id, role: "owner" })
    redirect(`/${workspace.slug}`)
}

export async function acceptWorkspaceInvitation(username: string, formData: FormData) {
    const user = await getCurrentUser()
    if (!user?.email) return await redirectToLogin()
    const token = String(formData.get("token") ?? "")
    const { data: invite } = await supabaseAdmin.from("workspace_invitations").select("id, workspace_id, email, role, expires_at, accepted_at").eq("id", token).maybeSingle()
    if (!invite || invite.accepted_at || new Date(invite.expires_at) < new Date() || invite.email.toLowerCase() !== user.email.toLowerCase()) throw new Error("This invitation is no longer available.")
    const role = normalizeWorkspaceRole(invite.role)
    if (!role) throw new Error("This invitation has an invalid role.")
    const { error } = await supabaseAdmin.from("workspace_memberships").upsert({ workspace_id: invite.workspace_id, user_id: user.id, role })
    if (error) throw new Error(error.message)
    await supabaseAdmin.from("workspace_invitations").update({ accepted_at: new Date().toISOString() }).eq("id", invite.id)
    redirect(`/users/${username}`)
}

export async function uploadProfileAvatar(username: string, formData: FormData) {
    const user = await getCurrentUser(); if (!user) return await redirectToLogin()
    const file = formData.get("avatar")
    if (!file || typeof file !== "object" || !("arrayBuffer" in file) || !("size" in file) || !file.size) throw new Error("Choose an image.")
    const upload = file as File
    const { data: existingProfile } = await supabaseAdmin.from("user_profiles").select("avatar_path").eq("user_id", user.id).maybeSingle()
    const avatarPath = await storeProfileAvatar(user.id, { name: upload.name, size: upload.size, type: upload.type, bytes: new Uint8Array(await upload.arrayBuffer()) })
    const { error } = await supabaseAdmin.from("user_profiles").update({ avatar_path: avatarPath }).eq("user_id", user.id)
    if (error) {
        await deleteOnboardingUploads([avatarPath])
        throw new Error("Your profile picture uploaded, but could not be saved. Please try again.")
    }
    if (existingProfile?.avatar_path) await deleteOnboardingUploads([existingProfile.avatar_path])
    redirect(`/users/${username}/edit`)
}

export async function deleteAccount() {
    const user = await getCurrentUser(); if (!user) return await redirectToLogin()
    const { data: profile } = await supabaseAdmin
        .from("user_profiles")
        .select("avatar_path")
        .eq("user_id", user.id)
        .maybeSingle()
    if (profile?.avatar_path) await deleteOnboardingUploads([profile.avatar_path])
    const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id)
    if (error) throw new Error("Could not delete this account.")
    redirect("/login?accountDeleted=1")
}

export async function leaveWorkspace(username: string, formData: FormData) {
    const user = await getCurrentUser()
    if (!user) return await redirectToLogin()
    const workspaceId = String(formData.get("workspaceId") ?? "")
    const { data: membership } = await supabaseAdmin
        .from("workspace_memberships")
        .select("role")
        .eq("workspace_id", workspaceId)
        .eq("user_id", user.id)
        .maybeSingle()
    if (!membership) throw new Error("You do not have access to this workspace")
    if (membership.role === "owner") {
        const { count } = await supabaseAdmin
            .from("workspace_memberships")
            .select("*", { count: "exact", head: true })
            .eq("workspace_id", workspaceId)
            .eq("role", "owner")
        if ((count ?? 0) <= 1) {
            throw new Error("Transfer ownership before leaving your only-owner workspace")
        }
    }
    await supabaseAdmin
        .from("workspace_memberships")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("user_id", user.id)
    redirect(`/users/${username}`)
}
