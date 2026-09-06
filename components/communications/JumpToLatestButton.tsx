"use client"

import { anchoredMessagePaneScrollTop } from "@/components/communications/message-pane-scroll"

export function messagePaneIsAwayFromBottom(pane: HTMLDivElement, threshold = 96) {
    return pane.scrollHeight - pane.scrollTop - pane.clientHeight > threshold
}

export function messagePaneCanShowNewMessage(pane: HTMLDivElement | null, followingLatest: boolean) {
    if (!pane || !followingLatest || document.visibilityState !== "visible") return false
    const bounds = pane.getBoundingClientRect()
    return bounds.bottom > 0 && bounds.top < window.innerHeight
}

export function observeMessagePaneResize(
    pane: HTMLDivElement | null,
    isFollowingLatest: () => boolean,
    preserveVisibleBottom = false,
) {
    if (!pane || typeof ResizeObserver === "undefined") return () => undefined
    let previousHeight = pane.clientHeight
    let previousScrollTop = pane.scrollTop
    const rememberScrollPosition = () => {
        previousHeight = pane.clientHeight
        previousScrollTop = pane.scrollTop
    }
    const observer = new ResizeObserver(() => {
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
    })
    pane.addEventListener("scroll", rememberScrollPosition, { passive: true })
    observer.observe(pane)
    return () => {
        observer.disconnect()
        pane.removeEventListener("scroll", rememberScrollPosition)
    }
}

const BUTTON_CLASS = "absolute bottom-3 z-20 box-border shrink-0 aspect-square place-items-center overflow-hidden rounded-full border border-neutral-700 bg-neutral-900 p-0 leading-none text-neutral-200 shadow-xl transition hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"

function JumpButton({ className, onClick }: { className: string; onClick: () => void }) {
    return <button
        data-icon-button
        type="button"
        aria-label="Jump to latest message"
        title="Jump to latest message"
        // Keep the keyboard (and this button's position) stable until activation.
        onPointerDown={(event) => { if (event.button === 0) event.preventDefault() }}
        onClick={onClick}
        className={`${BUTTON_CLASS} ${className}`}
    >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="block h-5 w-5 shrink-0 fill-none stroke-current stroke-2"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
    </button>
}

export function JumpToLatestButton({ onClick }: { onClick: () => void }) {
    return <>
        <JumpButton onClick={onClick} className="right-4 grid h-11 w-11 min-h-11 min-w-11 max-h-11 max-w-11 lg:hidden" />
        <JumpButton onClick={onClick} className="right-6 hidden h-10 w-10 min-h-10 min-w-10 max-h-10 max-w-10 lg:grid" />
    </>
}
