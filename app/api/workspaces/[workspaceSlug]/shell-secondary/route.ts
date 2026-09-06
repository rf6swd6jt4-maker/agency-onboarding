import { createUploadSignedUrl } from "@/lib/onboarding/uploads"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

export async function GET(_request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const [{ data: authResult }, { data: memberships }, workspaceLogoSrc] = await Promise.all([
        supabaseAdmin.auth.admin.getUserById(user.id),
        supabaseAdmin.from("workspace_memberships").select("user_id").eq("workspace_id", workspace.id).order("created_at"),
        workspace.logo_path ? createUploadSignedUrl(workspace.logo_path) : Promise.resolve(null),
    ])
    const memberIds = (memberships ?? []).map((item) => item.user_id)
    const { data: profiles } = memberIds.length
        ? await supabaseAdmin.from("user_profiles").select("user_id, username, display_name, avatar_path").in("user_id", memberIds)
        : { data: [] }
    const profilesById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]))

    return Response.json({
        email: authResult.user?.email ?? "",
        workspaceLogoSrc,
        workspaceMembers: (memberships ?? []).map((membership) => {
            const profile = profilesById.get(membership.user_id)
            const username = profile?.username ?? null
            return {
                id: membership.user_id,
                name: profile?.display_name?.trim() || username || (membership.user_id === user.id ? "Account" : "Workspace user"),
                avatarSrc: profile?.avatar_path && username ? profileAvatarUrl(username, profile.avatar_path) : null,
            }
        }),
    }, { headers: { "Cache-Control": "private, no-store" } })
}
