export const MAX_MOBILE_RETAINED_WORKSPACE_PANES = 3
export const MAX_DESKTOP_RETAINED_WORKSPACE_PANES = 5

export function workspacePaneRetentionLimit({ compact, deviceMemoryGb }: {
    compact: boolean
    deviceMemoryGb?: number | null
}) {
    if (compact || (typeof deviceMemoryGb === "number" && deviceMemoryGb <= 4)) {
        return MAX_MOBILE_RETAINED_WORKSPACE_PANES
    }
    return MAX_DESKTOP_RETAINED_WORKSPACE_PANES
}

export function retainRecentWorkspacePane(
    current: string[],
    tabId: string,
    openTabIds: Iterable<string>,
    limit: number,
) {
    const open = new Set(openTabIds)
    const boundedLimit = Math.max(1, Math.floor(limit))
    return [tabId, ...current]
        .filter((id, index, values) => Boolean(id) && open.has(id) && values.indexOf(id) === index)
        .slice(0, boundedLimit)
}

export function pruneRetainedWorkspacePanes(
    current: string[],
    openTabIds: Iterable<string>,
    limit: number,
) {
    const open = new Set(openTabIds)
    const boundedLimit = Math.max(1, Math.floor(limit))
    return current
        .filter((id, index, values) => open.has(id) && values.indexOf(id) === index)
        .slice(0, boundedLimit)
}
