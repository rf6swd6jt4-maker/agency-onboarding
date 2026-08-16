"use client"

export function messagePaneIsAwayFromBottom(pane: HTMLDivElement, threshold = 96) {
    return pane.scrollHeight - pane.scrollTop - pane.clientHeight > threshold
}

export function messagePaneCanShowNewMessage(pane: HTMLDivElement | null, followingLatest: boolean) {
    if (!pane || !followingLatest || document.visibilityState !== "visible") return false
    const bounds = pane.getBoundingClientRect()
    return bounds.bottom > 0 && bounds.top < window.innerHeight
}

const BUTTON_CLASS = "absolute bottom-3 z-20 h-10 w-10 min-h-10 min-w-10 max-h-10 max-w-10 shrink-0 aspect-square items-center justify-center rounded-full border border-neutral-700 bg-neutral-900 p-0 leading-none text-neutral-200 shadow-xl transition hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"

function JumpButton({ className, onClick }: { className: string; onClick: () => void }) {
    return <button
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
        <JumpButton onClick={onClick} className="right-4 inline-flex lg:hidden" />
        <JumpButton onClick={onClick} className="right-6 hidden lg:inline-flex" />
    </>
}
