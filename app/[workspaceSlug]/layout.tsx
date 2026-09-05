import { Suspense, type ReactNode } from "react"
import { headers } from "next/headers"

import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { WorkspaceBannerPending } from "@/components/admin/WorkspaceBannerPending"
import { WorkspacePanelChrome } from "@/components/workspace/WorkspacePanelChrome"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { requireWorkspaceAccess } from "@/lib/workspace-access"
import { WORKSPACE_DOCUMENT_REQUEST_HEADER, workspaceProductForPath, workspaceRouteUsesShell } from "@/lib/workspace-shell"
import { requireWorkspace } from "@/lib/workspaces"
import { workspaceTabIdFromUrl } from "@/lib/workspace-tabs"

async function SharedWorkspaceBanner({ params }: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await params
    const { workspace } = await requireWorkspace(workspaceSlug)

    return <WorkspaceBanner
        bannerPath={workspace.banner_path}
        logoPath={workspace.logo_path}
        name={workspace.name}
        height={workspace.banner_height}
        position={workspace.banner_position}
    />
}

export default async function WorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ workspaceSlug: string }> }) {
    const requestHeaders = await headers()
    const currentPath = requestHeaders.get("x-betelgeze-current-path")
    const tabId = workspaceTabIdFromUrl(currentPath)
    const pathname = currentPath ? new URL(currentPath, "http://localhost").pathname : ""
    const banner = <Suspense fallback={<WorkspaceBannerPending />}>
        <SharedWorkspaceBanner params={params} />
    </Suspense>

    if (requestHeaders.get(WORKSPACE_DOCUMENT_REQUEST_HEADER) === "1" && workspaceRouteUsesShell(pathname)) {
        const { workspaceSlug } = await params
        const { workspace, user, access } = await requireWorkspaceAccess(workspaceSlug)
        return <WorkspaceTopBar
            userId={user.id}
            workspace={workspace}
            currentProduct={workspaceProductForPath(pathname)}
            workspaceAccess={access}
            initialWorkspaceUrl={currentPath ?? undefined}
            documentShell
            documentContent={<WorkspacePanelChrome banner={banner}>{children}</WorkspacePanelChrome>}
        />
    }

    if (!tabId) return children

    return <WorkspacePanelChrome banner={banner}>{children}</WorkspacePanelChrome>
}
