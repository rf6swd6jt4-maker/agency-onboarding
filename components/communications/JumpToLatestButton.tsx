"use client"

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
    composer: HTMLTextAreaElement | null = null,
) {
    if (!pane || typeof ResizeObserver === "undefined") return () => undefined
    let previousHeight = pane.clientHeight
    let previousComposerHeight = composer?.getBoundingClientRect().height ?? 0
    const observer = new ResizeObserver(() => {
        const nextHeight = pane.clientHeight
        const nextComposerHeight = composer?.getBoundingClientRect().height ?? previousComposerHeight
        const composerHeightDelta = nextComposerHeight - previousComposerHeight
        const paneHeightDelta = previousHeight - nextHeight
        if (paneHeightDelta === 0 && Math.abs(composerHeightDelta) < 0.01) return
        const followingLatest = isFollowingLatest()
        previousHeight = nextHeight
        previousComposerHeight = nextComposerHeight
        // Composer growth is the user-visible movement to mirror. Measure it
        // directly instead of deriving it from the pane's rounded clientHeight.
        if (Math.abs(composerHeightDelta) >= 0.01) pane.scrollTo({ top: pane.scrollTop + composerHeightDelta, left: 0 })
        else if (followingLatest) pane.scrollTo({ top: pane.scrollHeight, left: 0 })
        else if (preserveVisibleBottom) pane.scrollTo({ top: pane.scrollTop + paneHeightDelta, left: 0 })
    })
    observer.observe(pane)
    return () => {
        observer.disconnect()
    }
}

const BUTTON_CLASS = "absolute bottom-3 z-20 box-border shrink-0 aspect-square place-items-center overflow-hidden rounded-full border border-neutral-700 bg-neutral-900 p-0 leading-none text-neutral-200 shadow-xl transition hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"

function JumpButton({ className, onClick }: { className: string; onClick: () => void }) {
    return <button
        data-icon-button
        type="button"
        aria-label="Jump to latest message"
        title="Jump to latest message"
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
