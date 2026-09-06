export const WORKSPACE_LAUNCH_COOKIE = "betelgeze-last-workspace"
export const WORKSPACE_LAUNCH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90

export type WorkspaceLaunchHint = {
    workspaceSlug: string
    tabId: string
    url: string
}

export type WorkspaceShellBootstrapTiming = {
    authMs: number
    bootstrapMs: number
    totalMs: number
    fallback: boolean
}

const TAB_ID_PATTERN = /^[a-zA-Z0-9-]{1,100}$/
const WORKSPACE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$/

function normalizeLaunchUrl(value: string, workspaceSlug: string) {
    if (!value.startsWith("/") || value.length > 1200) return null
    try {
        const parsed = new URL(value, "http://localhost")
        if (parsed.origin !== "http://localhost") return null
        parsed.searchParams.delete("__betelgeze_tab")
        const workspaceRoot = `/${workspaceSlug}`
        if (parsed.pathname !== workspaceRoot && !parsed.pathname.startsWith(`${workspaceRoot}/`)) return null
        return `${parsed.pathname}${parsed.search}${parsed.hash}`
    } catch {
        return null
    }
}

export function parseWorkspaceLaunchHint(value: string | null | undefined): WorkspaceLaunchHint | null {
    if (!value || value.length > 1800) return null
    try {
        const parsed = JSON.parse(decodeURIComponent(value)) as Partial<WorkspaceLaunchHint>
        if (!WORKSPACE_SLUG_PATTERN.test(parsed.workspaceSlug ?? "") || !TAB_ID_PATTERN.test(parsed.tabId ?? "")) return null
        const url = normalizeLaunchUrl(parsed.url ?? "", parsed.workspaceSlug!)
        return url ? { workspaceSlug: parsed.workspaceSlug!, tabId: parsed.tabId!, url } : null
    } catch {
        return null
    }
}

export function serializeWorkspaceLaunchHint(hint: WorkspaceLaunchHint) {
    const normalized = parseWorkspaceLaunchHint(encodeURIComponent(JSON.stringify(hint)))
    return normalized ? encodeURIComponent(JSON.stringify(normalized)) : null
}

export function persistWorkspaceLaunchHint(hint: WorkspaceLaunchHint) {
    if (typeof document === "undefined") return false
    const value = serializeWorkspaceLaunchHint(hint)
    if (!value) return false
    document.cookie = `${WORKSPACE_LAUNCH_COOKIE}=${value}; Path=/; Max-Age=${WORKSPACE_LAUNCH_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`
    return true
}
