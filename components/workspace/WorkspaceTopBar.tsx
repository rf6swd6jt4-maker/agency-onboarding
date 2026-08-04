import { WorkspaceTopBarClient } from "@/components/workspace/WorkspaceTopBarClient"
import { createAssetFromModal, createRelationshipFromModal, createWorkItemFromModal } from "@/app/[workspaceSlug]/relationships/actions"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { leaveWorkspace } from "@/app/users/[username]/actions"
import { createUploadSignedUrl } from "@/lib/onboarding/uploads"
import { normalizeWorkspaceRole } from "@/lib/workspaces"
import { createOkrFromModal } from "@/app/[workspaceSlug]/admin/actions"

type Product = "client-work" | "leadgen"

type Props = {
    userId: string
    workspace: { id: string; name: string; slug: string; logo_path?: string | null }
    currentProduct: Product
}

export async function WorkspaceTopBar({ userId, workspace }: Props) {
    const [{ data: profile }, { data: authResult }, { data: membership }, { data: workItems }, { data: relationships }] = await Promise.all([
        supabaseAdmin.from("user_profiles").select("username, avatar_path").eq("user_id", userId).maybeSingle(),
        supabaseAdmin.auth.admin.getUserById(userId),
        supabaseAdmin.from("workspace_memberships").select("role").eq("workspace_id", workspace.id).eq("user_id", userId).maybeSingle(),
        supabaseAdmin.from("work_items").select("id, title, status").eq("workspace_id", workspace.id).eq("visibility", "workspace").order("title").limit(200),
        supabaseAdmin.from("relationships").select("id, primary_person_name, business_name").eq("workspace_id", workspace.id).order("updated_at", { ascending: false }).limit(200),
    ])
    const username = profile?.username ?? "account"
    const workspaceRole = normalizeWorkspaceRole(membership?.role) ?? "staff"
    const { data: adminMemberships } = workspaceRole === "owner" || workspaceRole === "admin"
        ? await supabaseAdmin.from("workspace_memberships").select("user_id, role").eq("workspace_id", workspace.id).in("role", ["owner", "admin"]).order("created_at")
        : { data: [] }
    const adminIds = (adminMemberships ?? []).map((item) => item.user_id)
    const { data: adminProfiles } = adminIds.length
        ? await supabaseAdmin.from("user_profiles").select("user_id, username").in("user_id", adminIds)
        : { data: [] }
    const adminNames = new Map((adminProfiles ?? []).map((item) => [item.user_id, item.username]))
    const [avatarSrc, workspaceLogoSrc] = await Promise.all([
        profile?.avatar_path ? createUploadSignedUrl(profile.avatar_path) : null,
        workspace.logo_path ? createUploadSignedUrl(workspace.logo_path) : null,
    ])

    return <WorkspaceTopBarClient
        workspace={workspace}
        currentUserId={userId}
        workspaceLogoSrc={workspaceLogoSrc}
        username={username}
        email={authResult.user?.email ?? ""}
        avatarSrc={avatarSrc}
        workspaceRole={workspaceRole}
        leaveAction={leaveWorkspace.bind(null, username)}
        createRelationshipAction={createRelationshipFromModal.bind(null, workspace.slug)}
        createWorkItemAction={createWorkItemFromModal.bind(null, workspace.slug)}
        createAssetAction={createAssetFromModal.bind(null, workspace.slug)}
        createOkrAction={createOkrFromModal.bind(null, workspace.slug)}
        workItemOptions={(workItems ?? []).map((item) => ({ id: item.id, title: item.title, status: item.status }))}
        relationshipOptions={(relationships ?? []).map((relationship) => ({ id: relationship.id, label: relationship.business_name ?? relationship.primary_person_name ?? "Relationship" }))}
        okrOwnerOptions={(adminMemberships ?? []).map((item) => ({ id: item.user_id, label: adminNames.get(item.user_id) ?? (item.user_id === userId ? username : item.role), role: item.role }))}
    />
}
