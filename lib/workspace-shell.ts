export const WORKSPACE_SHELL_INTERNAL_PREFIX = "/~workspace-shell"
export const WORKSPACE_SHELL_REQUEST_HEADER = "x-betelgeze-workspace-shell"

const WORKSPACE_SHELL_SECTIONS = new Set([
    "admin",
    "appointment-setting",
    "assets",
    "communications",
    "leadgen",
    "no-access",
    "onboarding",
    "relationships",
    "settings",
    "work",
    "work-items",
])

export function workspaceRouteUsesShell(pathname: string) {
    const segments = pathname.split("/").filter(Boolean)
    if (segments.length < 2 || segments[0] === WORKSPACE_SHELL_INTERNAL_PREFIX.slice(1)) return false
    if (segments[1] === "admin" && segments[2] === "okrs" && segments[3]) return false
    return WORKSPACE_SHELL_SECTIONS.has(segments[1])
}

export function workspaceShellRoute(workspaceSlug: string) {
    return `${WORKSPACE_SHELL_INTERNAL_PREFIX}/${encodeURIComponent(workspaceSlug)}`
}

export function workspaceProductForPath(pathname: string): "client-work" | "leadgen" {
    return pathname.split("/").filter(Boolean)[1] === "leadgen" ? "leadgen" : "client-work"
}
