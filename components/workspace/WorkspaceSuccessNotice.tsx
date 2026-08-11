"use client"

function CheckIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[2.5]"><path d="m5 12 4.5 4.5L19 7" /></svg>
}

export function WorkspaceSuccessNotice({ label, actionLabel, onAction }: {
    label: string
    actionLabel?: string
    onAction?: () => void
}) {
    return <div className="pointer-events-none fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[60] sm:left-1/2 sm:right-auto sm:w-[min(34rem,calc(100vw-2rem))] sm:-translate-x-1/2">
        <div role="status" aria-live="polite" className="pointer-events-auto flex min-h-12 items-center gap-3 rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm text-white shadow-2xl shadow-black/50 motion-reduce:animate-none" style={{ animation: "betelgeze-creation-notice 8.4s cubic-bezier(0.22, 1, 0.36, 1) both" }}>
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white text-white"><CheckIcon /></span>
            <span className="min-w-0 flex-1 font-medium">{label}</span>
            {actionLabel && onAction ? <button type="button" onClick={onAction} className="shrink-0 text-sm font-medium text-white underline underline-offset-4 hover:text-neutral-300">{actionLabel}</button> : null}
        </div>
    </div>
}
