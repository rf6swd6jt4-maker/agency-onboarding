"use server"

import { redirect } from "next/navigation"
import { redirectToLogin } from "@/lib/auth/server-redirects"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getCurrentUser } from "@/lib/workspaces"
import { deleteOnboardingUploads, storeProfileAvatar } from "@/lib/onboarding/uploads"
import { normalizeChatDisplayName } from "@/lib/client-messages/whatsapp-attribution"

const usernamePattern = /^[a-z0-9][a-z0-9-]{1,27}[a-z0-9]$/

export async function updateProfile(_: { error?: string; username?: string; displayName?: string }, formData: FormData) {
    const user = await getCurrentUser()
    if (!user) return await redirectToLogin()
    const username = String(formData.get("username") ?? "").trim().toLowerCase()
    const displayName = normalizeChatDisplayName(formData.get("displayName"))
    if (!usernamePattern.test(username)) return { error: "Use 3–30 lowercase letters, numbers, or hyphens." }
    if (!displayName) return { error: "Use a display name between 1 and 50 characters." }
    const { error } = await supabaseAdmin.from("user_profiles").update({ username, display_name: displayName }).eq("user_id", user.id)
    if (error) return { error: error.code === "23505" ? "That username is already taken." : "We could not update your profile. Please try again." }
    return { username, displayName }
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
