export const WORKSPACE_LAUNCH_COOKIE = "betelgeze-last-workspace"
export const WORKSPACE_LAUNCH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90
export const WORKSPACE_LAUNCH_COOKIE_DOMAIN = ".betelgeze.com"

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

export function workspaceLaunchUrlForRestore(value: string, workspaceSlug: string) {
    const normalized = normalizeLaunchUrl(value, workspaceSlug)
    if (!normalized) return null

    const parsed = new URL(normalized, "http://localhost")
    const prefix = `/${workspaceSlug}/`
    const segments = parsed.pathname.slice(prefix.length).split("/").filter(Boolean)
    if (segments.length === 2 && ["relationships", "onboarding", "work", "appointment-setting", "work-items", "assets"].includes(segments[0])) {
        return `${prefix}${segments[0]}`
    }
    if (segments.length === 3 && segments[0] === "leadgen" && segments[1] === "poll") return `${prefix}leadgen/polls`
    if (segments.length === 3 && segments[0] === "admin" && (segments[1] === "activity" || segments[1] === "okrs")) return `${prefix}admin/${segments[1]}`
    return normalized
}

export function parseWorkspaceLaunchHint(value: string | null | undefined): WorkspaceLaunchHint | null {
    if (!value || value.length > 1800) return null
    try {
        const parsed = JSON.parse(decodeURIComponent(value)) as Partial<WorkspaceLaunchHint>
        if (!WORKSPACE_SLUG_PATTERN.test(parsed.workspaceSlug ?? "") || !TAB_ID_PATTERN.test(parsed.tabId ?? "")) return null
        const url = workspaceLaunchUrlForRestore(parsed.url ?? "", parsed.workspaceSlug!)
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
    const secure = window.location.protocol === "https:" ? "; Secure" : ""
    const hostname = window.location.hostname.toLowerCase()
    const domain = hostname === "betelgeze.com" || hostname.endsWith(".betelgeze.com")
        ? `; Domain=${WORKSPACE_LAUNCH_COOKIE_DOMAIN}`
        : ""
    // Remove the old host-only form before writing the shared app/dashboard
    // cookie so duplicate names cannot make launch selection ambiguous.
    document.cookie = `${WORKSPACE_LAUNCH_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
    document.cookie = `${WORKSPACE_LAUNCH_COOKIE}=${value}; Path=/; Max-Age=${WORKSPACE_LAUNCH_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${domain}${secure}`
    return true
}
