export function anchoredMessagePaneScrollTop({
    scrollHeight,
    previousClientHeight,
    nextClientHeight,
    previousScrollTop,
    followingLatest,
    preserveVisibleBottom,
}: {
    scrollHeight: number
    previousClientHeight: number
    nextClientHeight: number
    previousScrollTop: number
    followingLatest: boolean
    preserveVisibleBottom: boolean
}) {
    const maximumScrollTop = Math.max(0, scrollHeight - nextClientHeight)
    if (followingLatest) return maximumScrollTop

    const requestedScrollTop = preserveVisibleBottom
        ? previousScrollTop + previousClientHeight - nextClientHeight
        : previousScrollTop
    return Math.min(maximumScrollTop, Math.max(0, requestedScrollTop))
}
