import { randomUUID } from "node:crypto"
import { WorkspaceTopBarClient } from "@/components/workspace/WorkspaceTopBarClient"
import { WorkspaceTabBridge } from "@/components/workspace/WorkspaceTabBridge"
import { createAssetFromModal, createRelationshipFromModal, createWorkItemFromModal } from "@/app/[workspaceSlug]/relationships/actions"
import { headers } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { leaveWorkspace } from "@/app/users/[username]/actions"
import { normalizeWorkspaceRole } from "@/lib/workspaces"
import { createOkrFromModal } from "@/app/[workspaceSlug]/admin/actions"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import { loadWorkspaceAccess, type WorkspaceAccess } from "@/lib/workspace-access"
import type { WorkspaceShellBootstrapTiming } from "@/lib/workspace-launch"
import { workspaceTabIdFromUrl, workspaceTabTitleForUrl, type WorkspaceInitialTab } from "@/lib/workspace-tabs"

type Product = "client-work" | "leadgen"

type Props = {
    userId: string
    workspace: { id: string; name: string; slug: string; logo_path?: string | null }
    currentProduct: Product
    workspaceAccess?: WorkspaceAccess
    shellProfile?: { username: string; avatarPath: string | null }
    initialWorkspaceUrl?: string
    initialTab?: WorkspaceInitialTab
    launchServerTiming?: WorkspaceShellBootstrapTiming
}

export async function WorkspaceTopBar({ userId, workspace, workspaceAccess, shellProfile, initialWorkspaceUrl, initialTab, launchServerTiming }: Props) {
    const currentPath = (await headers()).get("x-betelgeze-current-path")
    const tabId = workspaceTabIdFromUrl(currentPath)
    if (tabId) return <WorkspaceTabBridge tabId={tabId} workspaceSlug={workspace.slug} />

    const [{ data: profile }, { data: membership }] = await Promise.all([
        shellProfile
            ? Promise.resolve({ data: { username: shellProfile.username, avatar_path: shellProfile.avatarPath } })
            : supabaseAdmin.from("user_profiles").select("username, avatar_path").eq("user_id", userId).maybeSingle(),
        workspaceAccess
            ? Promise.resolve({ data: { role: workspaceAccess.role } })
            : supabaseAdmin.from("workspace_memberships").select("role").eq("workspace_id", workspace.id).eq("user_id", userId).maybeSingle(),
    ])
    const username = profile?.username ?? "account"
    const workspaceRole = normalizeWorkspaceRole(membership?.role) ?? "staff"
    const access = workspaceAccess ?? await loadWorkspaceAccess({ workspaceId: workspace.id, workspaceSlug: workspace.slug, userId, role: workspaceRole })
    const avatarSrc = profile?.avatar_path ? profileAvatarUrl(username, profile.avatar_path) : null
    const initialUrl = initialWorkspaceUrl ?? `/${workspace.slug}`
    const launchTab = initialTab ?? {
        id: randomUUID(),
        title: workspaceTabTitleForUrl(initialUrl, workspace.slug),
        url: initialUrl,
        history: [initialUrl],
        historyIndex: 0,
        seenRevision: 0,
    }

    return <WorkspaceTopBarClient
        workspace={workspace}
        initialWorkspaceUrl={initialWorkspaceUrl}
        initialTab={launchTab}
        launchServerTiming={launchServerTiming}
        currentUserId={userId}
        username={username}
        avatarSrc={avatarSrc}
        workspaceRole={workspaceRole}
        workspaceCapabilities={access.capabilities}
        leaveAction={leaveWorkspace.bind(null, username)}
        createRelationshipAction={createRelationshipFromModal.bind(null, workspace.slug)}
        createWorkItemAction={createWorkItemFromModal.bind(null, workspace.slug)}
        createAssetAction={createAssetFromModal.bind(null, workspace.slug)}
        createOkrAction={createOkrFromModal.bind(null, workspace.slug)}
    />
}
