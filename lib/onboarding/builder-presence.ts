export type BuilderPresence = {
    clientId: string
    userId: string
    name: string
    avatarSrc: string | null
    color: string
    selection: string | null
    cursor: { xRatio: number; yRatio: number } | null
}

export function visibleBuilderPresence(state: Record<string, BuilderPresence[]>, currentClientId: string) {
    return Object.values(state).flat().filter((presence) => presence.clientId !== currentClientId)
}

export function normalizedBuilderCursor(clientX: number, clientY: number, viewportWidth: number, viewportHeight: number) {
    const ratio = (value: number, size: number) => Math.max(0, Math.min(1, size > 0 ? value / size : 0))
    return { xRatio: ratio(clientX, viewportWidth), yRatio: ratio(clientY, viewportHeight) }
}
