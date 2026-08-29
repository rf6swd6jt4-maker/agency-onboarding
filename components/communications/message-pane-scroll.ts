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

export function observeMessagePaneResize(
    pane: HTMLDivElement | null,
    isFollowingLatest: () => boolean,
    preserveVisibleBottom = false,
    layoutTarget: HTMLElement | null = null,
) {
    if (!pane || typeof ResizeObserver === "undefined") return () => undefined
    let previousHeight = pane.clientHeight
    let previousScrollTop = pane.scrollTop
    let frame = 0
    const rememberScrollPosition = () => {
        // A flex resize can emit scroll before ResizeObserver. Do not accept the
        // new height here or the resize callback will mistake it for no change.
        if (pane.clientHeight !== previousHeight) {
            scheduleAnchor()
            return
        }
        previousScrollTop = pane.scrollTop
    }
    const applyAnchor = () => {
        frame = 0
        const nextHeight = pane.clientHeight
        if (nextHeight === previousHeight) return
        const nextScrollTop = anchoredMessagePaneScrollTop({
            scrollHeight: pane.scrollHeight,
            previousClientHeight: previousHeight,
            nextClientHeight: nextHeight,
            previousScrollTop,
            followingLatest: isFollowingLatest(),
            preserveVisibleBottom,
        })
        previousHeight = nextHeight
        pane.scrollTo({ top: nextScrollTop, left: 0 })
        previousScrollTop = pane.scrollTop
    }
    const scheduleAnchor = () => {
        if (frame) return
        frame = window.requestAnimationFrame(applyAnchor)
    }
    const observer = new ResizeObserver(scheduleAnchor)
    pane.addEventListener("scroll", rememberScrollPosition, { passive: true })
    observer.observe(pane)
    if (layoutTarget) observer.observe(layoutTarget)
    return () => {
        if (frame) window.cancelAnimationFrame(frame)
        observer.disconnect()
        pane.removeEventListener("scroll", rememberScrollPosition)
    }
}
