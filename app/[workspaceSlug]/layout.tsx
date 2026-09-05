import { Suspense, type ReactNode } from "react"
import { headers } from "next/headers"

import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { WorkspaceBannerPending } from "@/components/admin/WorkspaceBannerPending"
import { WorkspacePanelChrome } from "@/components/workspace/WorkspacePanelChrome"
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
    const currentPath = (await headers()).get("x-betelgeze-current-path")
    if (!workspaceTabIdFromUrl(currentPath)) return children

    return <WorkspacePanelChrome banner={
        <Suspense fallback={<WorkspaceBannerPending />}>
            <SharedWorkspaceBanner params={params} />
        </Suspense>
    }>{children}</WorkspacePanelChrome>
}
