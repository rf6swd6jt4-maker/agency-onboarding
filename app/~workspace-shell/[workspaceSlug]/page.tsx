import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { requireWorkspaceAccess } from "@/lib/workspace-access"
import { WORKSPACE_SHELL_REQUEST_HEADER, workspaceProductForPath, workspaceRouteUsesShell } from "@/lib/workspace-shell"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
}

export default async function WorkspaceShellPage({ params }: PageProps) {
    const [{ workspaceSlug }, requestHeaders] = await Promise.all([params, headers()])
    const currentPath = requestHeaders.get("x-betelgeze-current-path")
    const pathname = currentPath ? new URL(currentPath, "http://localhost").pathname : ""
    if (requestHeaders.get(WORKSPACE_SHELL_REQUEST_HEADER) !== "1" || !workspaceRouteUsesShell(pathname)) notFound()

    const { workspace, user, access } = await requireWorkspaceAccess(workspaceSlug)

    return <WorkspaceTopBar
        userId={user.id}
        workspace={workspace}
        currentProduct={workspaceProductForPath(pathname)}
        workspaceAccess={access}
        initialWorkspaceUrl={currentPath ?? undefined}
    />
}
