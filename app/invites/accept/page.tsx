import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getCurrentUser, normalizeWorkspaceRole } from "@/lib/workspaces"

export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
    const { token } = await searchParams; const user = await getCurrentUser(); if (!user) redirect(`/login?invite=${token ?? ""}`)
    if (!token) redirect("/workspaces")
    const { data: invite } = await supabaseAdmin.from("workspace_invitations").select("id, workspace_id, email, role, expires_at, accepted_at").eq("id", token).maybeSingle()
    if (!invite || invite.accepted_at || new Date(invite.expires_at) < new Date() || user.email?.toLowerCase() !== invite.email.toLowerCase()) redirect("/workspaces")
    const role = normalizeWorkspaceRole(invite.role)
    if (!role) redirect("/workspaces")
    await supabaseAdmin.from("workspace_memberships").upsert({ workspace_id: invite.workspace_id, user_id: user.id, role })
    await supabaseAdmin.from("workspace_invitations").update({ accepted_at: new Date().toISOString() }).eq("id", invite.id)
    const { data: profile } = await supabaseAdmin.from("user_profiles").select("username").eq("user_id", user.id).maybeSingle()
    redirect(profile ? `/users/${profile.username}` : "/workspaces")
}
