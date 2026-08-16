"use client"

export function messagePaneIsAwayFromBottom(pane: HTMLDivElement, threshold = 96) {
    return pane.scrollHeight - pane.scrollTop - pane.clientHeight > threshold
}

export function JumpToLatestButton({ onClick }: { onClick: () => void }) {
    return <button
        type="button"
        data-icon-button
        aria-label="Jump to latest message"
        title="Jump to latest message"
        onClick={onClick}
        className="absolute bottom-3 right-4 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900 text-neutral-200 shadow-xl transition hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 sm:right-6"
    >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="m6 9 6 6 6-6" /><path d="M12 4v11" /></svg>
    </button>
}
