export type WorkspacePresenceMember = {
    clientId: string
    userId: string
    name: string
    avatarSrc: string | null
    activePath: string | null
}

export function workspacePresenceTopic(workspaceSlug: string) {
    return `workspace-presence:${workspaceSlug}`
}

export function visibleWorkspacePresence(
    state: Record<string, WorkspacePresenceMember[]>,
    currentUserId: string,
) {
    const byUser = new Map<string, WorkspacePresenceMember>()
    for (const member of Object.values(state).flat()) {
        if (!member.clientId || !member.userId || member.userId === currentUserId) continue
        if (!byUser.has(member.userId)) byUser.set(member.userId, member)
    }
    return [...byUser.values()].sort((left, right) => left.name.localeCompare(right.name))
}
