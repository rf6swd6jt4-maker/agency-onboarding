import type { MutableRefObject } from "react"

type Anchor = { element: HTMLElement; offset: number }

/** The pane has a fixed height; its content is the element that grows on decode. */
export function observeConversationLayout(
    pane: HTMLDivElement,
    followLatest: MutableRefObject<boolean>,
    onPosition: (atLatest: boolean, away: boolean) => void,
) {
    let height = 0
    let contentHeight = 0
    let scrollTop = pane.scrollTop
    let anchor: Anchor | null = null
    let disposed = false
    const content = pane.firstElementChild

    function captureAnchor() {
        const bounds = pane.getBoundingClientRect()
        const rows = pane.querySelectorAll<HTMLElement>("[data-message-scroll-anchor]")
        // Rows are ordered; avoid reading every message's bounds on each scroll.
        let low = 0, high = rows.length
        while (low < high) {
            const middle = (low + high) >>> 1
            if (rows[middle].getBoundingClientRect().bottom <= bounds.top) low = middle + 1
            else high = middle
        }
        const element = rows[low]
        anchor = element ? { element, offset: element.getBoundingClientRect().top - bounds.top } : null
    }

    function remember() {
        if (pane.clientHeight <= 0) return
        height = pane.clientHeight
        contentHeight = pane.scrollHeight
        scrollTop = pane.scrollTop
        if (!followLatest.current) captureAnchor()
        else anchor = null
        const distance = pane.scrollHeight - pane.clientHeight - pane.scrollTop
        onPosition(distance <= 24, distance > 96)
    }

    function restore() {
        const nextHeight = pane.clientHeight
        if (nextHeight <= 0) return // Hidden workspace tabs must not overwrite the anchor.
        let nextTop = scrollTop
        if (followLatest.current) nextTop = pane.scrollHeight - nextHeight
        else if (anchor?.element.isConnected && pane.contains(anchor.element)) {
            const offset = anchor.element.getBoundingClientRect().top - pane.getBoundingClientRect().top
            nextTop = pane.scrollTop + offset - anchor.offset + (height ? height - nextHeight : 0)
        } else if (height) nextTop += height - nextHeight
        nextTop = Math.max(0, Math.min(pane.scrollHeight - nextHeight, nextTop))
        if (Math.abs(pane.scrollTop - nextTop) > 0.5 || pane.scrollLeft) pane.scrollTo({ top: nextTop, left: 0, behavior: "instant" })
        pane.dataset.positioned = "true"
        remember()
    }

    function onScroll() {
        // Browser clamping can dispatch scroll before the resize notification.
        // Do not replace the old anchor with the displaced position in that gap.
        if (pane.clientHeight !== height || pane.scrollHeight !== contentHeight) restore()
        else queueMicrotask(() => { if (!disposed) remember() })
    }
    const observer = new ResizeObserver(restore)
    observer.observe(pane)
    if (content) observer.observe(content)
    pane.addEventListener("scroll", onScroll, { passive: true })
    pane.addEventListener("load", restore, true)
    pane.addEventListener("conversation-visible", restore)
    restore()
    return () => {
        disposed = true
        observer.disconnect()
        pane.removeEventListener("scroll", onScroll)
        pane.removeEventListener("load", restore, true)
        pane.removeEventListener("conversation-visible", restore)
    }
}
