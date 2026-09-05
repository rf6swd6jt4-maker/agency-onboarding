import { WorkspaceTopBarClient } from "@/components/workspace/WorkspaceTopBarClient"
import { WorkspaceTabBridge } from "@/components/workspace/WorkspaceTabBridge"
import type { ReactNode } from "react"
import { createAssetFromModal, createRelationshipFromModal, createWorkItemFromModal } from "@/app/[workspaceSlug]/relationships/actions"
import { headers } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { leaveWorkspace } from "@/app/users/[username]/actions"
import { createUploadSignedUrl } from "@/lib/onboarding/uploads"
import { normalizeWorkspaceRole } from "@/lib/workspaces"
import { createOkrFromModal } from "@/app/[workspaceSlug]/admin/actions"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import { accessibleRelationshipIds, accessibleWorkItemIds, loadWorkspaceAccess, type WorkspaceAccess } from "@/lib/workspace-access"
import { workspaceTabIdFromUrl } from "@/lib/workspace-tabs"
import { WORKSPACE_DOCUMENT_REQUEST_HEADER } from "@/lib/workspace-shell"

type Product = "client-work" | "leadgen"

type Props = {
    userId: string
    workspace: { id: string; name: string; slug: string; logo_path?: string | null }
    currentProduct: Product
    workspaceAccess?: WorkspaceAccess
    initialWorkspaceUrl?: string
    documentContent?: ReactNode
    documentShell?: boolean
}

export async function WorkspaceTopBar({ userId, workspace, workspaceAccess, initialWorkspaceUrl, documentContent, documentShell = false }: Props) {
    const requestHeaders = await headers()
    const currentPath = requestHeaders.get("x-betelgeze-current-path")
    const tabId = workspaceTabIdFromUrl(currentPath)
    if (tabId) return <WorkspaceTabBridge tabId={tabId} workspaceSlug={workspace.slug} />
    if (requestHeaders.get(WORKSPACE_DOCUMENT_REQUEST_HEADER) === "1" && !documentShell) return null

    const [{ data: profile }, { data: authResult }, { data: membership }] = await Promise.all([
        supabaseAdmin.from("user_profiles").select("username, avatar_path").eq("user_id", userId).maybeSingle(),
        supabaseAdmin.auth.admin.getUserById(userId),
        workspaceAccess
            ? Promise.resolve({ data: { role: workspaceAccess.role } })
            : supabaseAdmin.from("workspace_memberships").select("role").eq("workspace_id", workspace.id).eq("user_id", userId).maybeSingle(),
    ])
    const username = profile?.username ?? "account"
    const workspaceRole = normalizeWorkspaceRole(membership?.role) ?? "staff"
    const access = workspaceAccess ?? await loadWorkspaceAccess({ workspaceId: workspace.id, workspaceSlug: workspace.slug, userId, role: workspaceRole })
    const relationshipIds = await accessibleRelationshipIds(access)
    const workItemIds = await accessibleWorkItemIds(access, relationshipIds)
    let workItemsQuery = supabaseAdmin.from("work_items").select("id, title, status").eq("workspace_id", workspace.id).eq("visibility", "workspace").order("title").limit(200)
    let relationshipsQuery = supabaseAdmin.from("relationships").select("id, primary_person_name, business_name").eq("workspace_id", workspace.id).order("updated_at", { ascending: false }).limit(200)
    if (workItemIds) workItemsQuery = workItemIds.size ? workItemsQuery.in("id", [...workItemIds]) : workItemsQuery.eq("id", "00000000-0000-0000-0000-000000000000")
    if (relationshipIds) relationshipsQuery = relationshipIds.size ? relationshipsQuery.in("id", [...relationshipIds]) : relationshipsQuery.eq("id", "00000000-0000-0000-0000-000000000000")
    const [{ data: workItems }, { data: relationships }] = await Promise.all([workItemsQuery, relationshipsQuery])
    const { data: adminMemberships } = workspaceRole === "owner" || workspaceRole === "admin"
        ? await supabaseAdmin.from("workspace_memberships").select("user_id, role").eq("workspace_id", workspace.id).in("role", ["owner", "admin"]).order("created_at")
        : { data: [] }
    const adminIds = (adminMemberships ?? []).map((item) => item.user_id)
    const { data: adminProfiles } = adminIds.length
        ? await supabaseAdmin.from("user_profiles").select("user_id, username").in("user_id", adminIds)
        : { data: [] }
    const adminNames = new Map((adminProfiles ?? []).map((item) => [item.user_id, item.username]))
    const { data: presenceMemberships } = await supabaseAdmin.from("workspace_memberships")
        .select("user_id").eq("workspace_id", workspace.id).order("created_at")
    const presenceIds = (presenceMemberships ?? []).map((item) => item.user_id)
    const { data: presenceProfiles } = presenceIds.length
        ? await supabaseAdmin.from("user_profiles").select("user_id, username, display_name, avatar_path").in("user_id", presenceIds)
        : { data: [] }
    const presenceProfilesById = new Map((presenceProfiles ?? []).map((item) => [item.user_id, item]))
    const avatarSrc = profile?.avatar_path ? profileAvatarUrl(username, profile.avatar_path) : null
    const workspaceLogoSrc = workspace.logo_path ? await createUploadSignedUrl(workspace.logo_path) : null
    const okrPeriodStartDate = new Date()
    const okrPeriodEndDate = new Date(okrPeriodStartDate)
    okrPeriodEndDate.setUTCDate(okrPeriodEndDate.getUTCDate() + 90)

    return <WorkspaceTopBarClient
        workspace={workspace}
        initialWorkspaceUrl={initialWorkspaceUrl}
        documentContent={documentContent}
        runtimeMode={documentShell ? "document" : "frames"}
        currentUserId={userId}
        workspaceLogoSrc={workspaceLogoSrc}
        username={username}
        email={authResult.user?.email ?? ""}
        avatarSrc={avatarSrc}
        workspaceRole={workspaceRole}
        workspaceCapabilities={access.capabilities}
        leaveAction={leaveWorkspace.bind(null, username)}
        createRelationshipAction={createRelationshipFromModal.bind(null, workspace.slug)}
        createWorkItemAction={createWorkItemFromModal.bind(null, workspace.slug)}
        createAssetAction={createAssetFromModal.bind(null, workspace.slug)}
        createOkrAction={createOkrFromModal.bind(null, workspace.slug)}
        workItemOptions={(workItems ?? []).map((item) => ({ id: item.id, title: item.title, status: item.status }))}
        relationshipOptions={(relationships ?? []).map((relationship) => ({ id: relationship.id, label: relationship.business_name ?? relationship.primary_person_name ?? "Relationship" }))}
        okrOwnerOptions={(adminMemberships ?? []).map((item) => ({ id: item.user_id, label: adminNames.get(item.user_id) ?? (item.user_id === userId ? username : item.role), role: item.role }))}
        workspaceMembers={(presenceMemberships ?? []).map((item) => {
            const memberProfile = presenceProfilesById.get(item.user_id)
            return {
                id: item.user_id,
                name: memberProfile?.display_name?.trim() || memberProfile?.username || (item.user_id === userId ? username : "Workspace user"),
                avatarSrc: memberProfile?.avatar_path && memberProfile.username ? profileAvatarUrl(memberProfile.username, memberProfile.avatar_path) : null,
            }
        })}
        okrPeriodStart={okrPeriodStartDate.toISOString().slice(0, 10)}
        okrPeriodEnd={okrPeriodEndDate.toISOString().slice(0, 10)}
    />
}
