import { profileAvatarUrl } from "@/lib/profile-avatar"
import { supabaseAdmin } from "@/lib/supabase/admin"

export async function adminPeople(workspaceId: string) {
    const { data: memberships } = await supabaseAdmin.from("workspace_memberships").select("user_id, role").eq("workspace_id", workspaceId)
    const ids = (memberships ?? []).map((item) => item.user_id)
    const { data: profiles } = ids.length ? await supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", ids) : { data: [] }
    const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.username]))
    const avatarUrls = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.avatar_path ? profileAvatarUrl(profile.username, profile.avatar_path) : null]))
    return {
        names: new Map((memberships ?? []).map((membership) => [membership.user_id, names.get(membership.user_id) ?? membership.role])),
        avatarUrls,
        ownerOptions: (memberships ?? []).filter((membership) => membership.role === "owner" || membership.role === "admin").map((membership) => ({ user_id: membership.user_id, role: membership.role, name: names.get(membership.user_id) ?? membership.role })),
    }
}
