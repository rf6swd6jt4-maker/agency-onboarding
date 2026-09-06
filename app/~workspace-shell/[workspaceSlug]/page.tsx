import { randomUUID } from "node:crypto"
import { cookies } from "next/headers"
import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { defaultWorkspaceHref } from "@/lib/workspace-access"
import { parseWorkspaceLaunchHint, WORKSPACE_LAUNCH_COOKIE } from "@/lib/workspace-launch"
import { requireWorkspaceShellBootstrap } from "@/lib/workspace-shell-bootstrap"
import { canAccessWorkspaceUrl } from "@/lib/workspace-panels"
import { WORKSPACE_SHELL_REQUEST_HEADER, workspaceProductForPath, workspaceRouteUsesShell } from "@/lib/workspace-shell"
import { normalizeWorkspaceUrl, workspaceTabTitleForUrl, type WorkspaceInitialTab } from "@/lib/workspace-tabs"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
}

export default async function WorkspaceShellPage({ params }: PageProps) {
    const [{ workspaceSlug }, requestHeaders, cookieStore] = await Promise.all([params, headers(), cookies()])
    const currentPath = requestHeaders.get("x-betelgeze-current-path")
    const pathname = currentPath ? new URL(currentPath, "http://localhost").pathname : ""
    if (requestHeaders.get(WORKSPACE_SHELL_REQUEST_HEADER) !== "1" || !workspaceRouteUsesShell(pathname)) notFound()

    const { workspace, user, access, profile, timing } = await requireWorkspaceShellBootstrap(workspaceSlug)
    const requestedUrl = currentPath ? normalizeWorkspaceUrl(currentPath, workspaceSlug, "http://localhost") : ""
    const initialUrl = requestedUrl && canAccessWorkspaceUrl(requestedUrl, workspaceSlug, access.role, access.capabilities)
        ? requestedUrl
        : defaultWorkspaceHref(access)
    const launchHint = parseWorkspaceLaunchHint(cookieStore.get(WORKSPACE_LAUNCH_COOKIE)?.value)
    const initialTabId = launchHint?.workspaceSlug === workspaceSlug && launchHint.url === initialUrl
        ? launchHint.tabId
        : randomUUID()
    const initialTab: WorkspaceInitialTab = {
        id: initialTabId,
        title: workspaceTabTitleForUrl(initialUrl, workspaceSlug),
        url: initialUrl,
        history: [initialUrl],
        historyIndex: 0,
        seenRevision: 0,
    }

    return <WorkspaceTopBar
        userId={user.id}
        workspace={workspace}
        currentProduct={workspaceProductForPath(pathname)}
        workspaceAccess={access}
        shellProfile={profile}
        initialWorkspaceUrl={initialUrl}
        initialTab={initialTab}
        launchServerTiming={timing}
    />
}
