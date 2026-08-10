export const WORKSPACE_TAB_FRAME_PARAM = "__betelgeze_tab"
export const WORKSPACE_TAB_FRAME_NAME_PREFIX = "betelgeze-tab:"
export const WORKSPACE_TAB_MESSAGE_SOURCE = "betelgeze-workspace-tabs"

export type WorkspaceTabParentMessage = {
    source: typeof WORKSPACE_TAB_MESSAGE_SOURCE
    target: "frame"
    tabId: string
    type: "activate" | "navigate" | "traverse" | "context-set"
    url?: string
    refresh?: boolean
    active?: boolean
    open?: boolean
}

export type WorkspaceTabFrameMessage = {
    source: typeof WORKSPACE_TAB_MESSAGE_SOURCE
    target: "host"
    tabId: string
    type: "location" | "mutation" | "action-start" | "action-end" | "context-status" | "context-obstruction" | "navigation-start" | "poll-started" | "reopen-closed-tab"
    url?: string
    relationshipId?: string | null
    contextSupported?: boolean
    context?: WorkspaceTabRelationshipContext | null
    contextObstructed?: boolean
    pollId?: string
}

export type WorkspaceTabContextMetric = {
    label: string
    value: string | number
}

export type WorkspaceTabRelationshipContext = {
    id: string
    primary_person_name: string
    primary_email: string | null
    primary_phone: string | null
    business_name: string | null
    website_url: string | null
    industry_value: string | null
    location_value: string | null
    source_label: string | null
    primary_contact_role: string | null
    notes_summary: string | null
    lifecycle_phase: string
    metrics: WorkspaceTabContextMetric[]
}

export function normalizeWorkspaceUrl(value: string, workspaceSlug: string, origin: string) {
    const parsed = new URL(value, origin)
    parsed.searchParams.delete(WORKSPACE_TAB_FRAME_PARAM)
    const search = parsed.search
    const hash = parsed.hash
    const path = parsed.pathname
    const defaultWorkspaceUrl = `/${workspaceSlug}`
    const dashboardMatch = path.match(new RegExp(`^/dashboard/${workspaceSlug}(?:/(.*))?$`, "i"))

    if (dashboardMatch) return `${defaultWorkspaceUrl}${dashboardMatch[1] ? `/${dashboardMatch[1]}` : ""}${search}${hash}`
    return `${path}${search}${hash}`
}

export function workspaceTabFrameUrl(value: string, tabId: string, origin: string) {
    const parsed = new URL(value, origin)
    parsed.searchParams.set(WORKSPACE_TAB_FRAME_PARAM, tabId)
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

export function isWorkspaceOnboardingBuilderUrl(value: string, workspaceSlug: string, origin: string) {
    const parsed = new URL(value, origin)
    return parsed.origin === new URL(origin).origin
        && parsed.pathname === `/${workspaceSlug}/onboarding-builder`
}

export function workspaceTabFrameMatchesUrl(actualValue: string, desiredValue: string, tabId: string, origin: string) {
    const actual = new URL(actualValue, origin)
    const desired = new URL(workspaceTabFrameUrl(desiredValue, tabId, origin), origin)
    actual.searchParams.sort()
    desired.searchParams.sort()
    return actual.origin === desired.origin
        && actual.pathname === desired.pathname
        && actual.search === desired.search
        && actual.hash === desired.hash
}

export function workspaceTabContextStorageKey(workspaceSlug: string, tabId: string) {
    return `betelgeze:client-context:${workspaceSlug}:${tabId}:open`
}

export function workspaceRouteCanShowRelationshipContext(value: string, workspaceSlug: string, origin: string) {
    const parsed = new URL(value, origin)
    const defaultWorkspaceUrl = `/${workspaceSlug}`
    const suffix = parsed.pathname.startsWith(`${defaultWorkspaceUrl}/`)
        ? parsed.pathname.slice(defaultWorkspaceUrl.length + 1)
        : ""
    const [section, id] = suffix.split("/")
    return Boolean(id) && (section === "relationships" || section === "onboarding" || section === "work")
}

export function isReopenClosedTabShortcut(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">) {
    return event.key.toLowerCase() === "t"
        && event.shiftKey
        && !event.altKey
        && (event.metaKey || event.ctrlKey)
}

export function workspaceTabHistoryStep(history: string[], historyIndex: number, step: -1 | 1) {
    const nextIndex = historyIndex + step
    if (nextIndex < 0 || nextIndex >= history.length) return null
    return { historyIndex: nextIndex, url: history[nextIndex] }
}

export function appendWorkspaceTabHistory(history: string[], historyIndex: number, url: string, limit = 50) {
    const nextHistory = [...history.slice(0, historyIndex + 1), url]
    const boundedLimit = Math.max(2, limit)
    const boundedHistory = nextHistory.length > boundedLimit
        ? [nextHistory[0], ...nextHistory.slice(-(boundedLimit - 1))]
        : nextHistory
    return { history: boundedHistory, historyIndex: boundedHistory.length - 1 }
}

export function reorderWorkspaceTabs<T extends { id: string }>(tabs: T[], tabId: string, insertionIndex: number) {
    const tab = tabs.find((candidate) => candidate.id === tabId)
    if (!tab) return tabs
    const remaining = tabs.filter((candidate) => candidate.id !== tabId)
    const boundedIndex = Math.min(Math.max(insertionIndex, 0), remaining.length)
    const reordered = [
        ...remaining.slice(0, boundedIndex),
        tab,
        ...remaining.slice(boundedIndex),
    ]
    return reordered.every((candidate, index) => candidate.id === tabs[index]?.id) ? tabs : reordered
}

export function orderWorkspaceTabsByStableIds<T extends { id: string }>(tabs: T[], stableIds: string[]) {
    const positions = new Map(stableIds.map((id, index) => [id, index]))
    return tabs
        .map((tab, index) => ({ tab, index }))
        .sort((a, b) => (positions.get(a.tab.id) ?? stableIds.length + a.index) - (positions.get(b.tab.id) ?? stableIds.length + b.index))
        .map(({ tab }) => tab)
}

export function normalizeWorkspaceTabCustomTitle(value: string, maxLength = 60) {
    const normalized = value.trim().replace(/\s+/g, " ").slice(0, maxLength)
    return normalized || null
}
