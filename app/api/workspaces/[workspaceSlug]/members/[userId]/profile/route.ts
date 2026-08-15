import { profileAvatarUrl } from "@/lib/profile-avatar"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(_: Request, context: { params: Promise<{ workspaceSlug: string; userId: string }> }) {
    const { workspaceSlug, userId } = await context.params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    if (!UUID_PATTERN.test(userId)) return Response.json({ error: "Profile not found." }, { status: 404 })
    const [{ data: targetMembership, error: membershipError }, { data: currentMemberships }] = await Promise.all([
        supabaseAdmin.from("workspace_memberships").select("last_seen_at").eq("workspace_id", workspace.id).eq("user_id", userId).maybeSingle(),
        supabaseAdmin.from("workspace_memberships").select("workspace_id").eq("user_id", user.id),
    ])
    if (membershipError || !targetMembership) return Response.json({ error: "Profile not found." }, { status: 404 })
    const currentWorkspaceIds = (currentMemberships ?? []).map((membership) => membership.workspace_id)
    const [{ data: profile, error: profileError }, { data: authResult }, { data: targetMemberships }] = await Promise.all([
        supabaseAdmin.from("user_profiles").select("username, display_name, avatar_path").eq("user_id", userId).maybeSingle(),
        supabaseAdmin.auth.admin.getUserById(userId),
        currentWorkspaceIds.length ? supabaseAdmin.from("workspace_memberships").select("workspace_id, workspaces!inner(name, slug, status)").eq("user_id", userId).in("workspace_id", currentWorkspaceIds) : Promise.resolve({ data: [], error: null }),
    ])
    if (profileError || !profile || !authResult.user) return Response.json({ error: "Profile not found." }, { status: 404 })
    const isSelf = userId === user.id
    return Response.json({
        profile: {
            id: userId,
            displayName: profile.display_name?.trim() || profile.username,
            username: isSelf ? profile.username : null,
            email: authResult.user.email ?? "",
            avatarSrc: profile.avatar_path ? profileAvatarUrl(profile.username, profile.avatar_path) : null,
            lastSeenAt: targetMembership.last_seen_at,
            isSelf,
            sharedWorkspaces: (targetMemberships ?? []).flatMap((membership) => {
                const shared = membership.workspaces as unknown as { name: string; slug: string; status: string }
                return shared.status === "active" ? [{ name: shared.name, slug: shared.slug, current: shared.slug === workspace.slug }] : []
            }).sort((left, right) => Number(right.current) - Number(left.current) || left.name.localeCompare(right.name)),
        },
    }, { headers: { "Cache-Control": "no-store" } })
}
