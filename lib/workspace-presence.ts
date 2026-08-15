export type WorkspacePresencePayload = {
    sessionId: string
    userId: string
    name: string
    avatarSrc: string | null
    activePath: string | null
    updatedAt: string
}

export type WorkspacePresenceMember = WorkspacePresencePayload
export type WorkspacePresenceState = "connecting" | "live" | "reconnecting" | "offline" | "error"

export type TrustedWorkspaceMember = {
    id: string
    name: string
    avatarSrc: string | null
}

export function workspacePresenceTopic(workspaceSlug: string) {
    return `workspace-presence:${workspaceSlug}`
}

export function visibleWorkspacePresence(
    state: Record<string, WorkspacePresencePayload[]>,
    currentUserId: string,
    trustedMembers: TrustedWorkspaceMember[],
) {
    const trustedById = new Map(trustedMembers.map((member) => [member.id, member]))
    const byUser = new Map<string, WorkspacePresenceMember>()
    for (const presence of Object.values(state).flat()) {
        const trusted = trustedById.get(presence.userId)
        if (!presence.sessionId || !presence.userId || presence.userId === currentUserId || !trusted) continue
        const candidate = { ...presence, name: trusted.name, avatarSrc: trusted.avatarSrc }
        const existing = byUser.get(presence.userId)
        if (!existing || Date.parse(candidate.updatedAt) > Date.parse(existing.updatedAt)) byUser.set(presence.userId, candidate)
    }
    return [...byUser.values()].sort((left, right) => left.name.localeCompare(right.name))
}
