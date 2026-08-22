export function ComposerMessagePreview({ label, preview, onCancel }: {
    label: string
    preview: string
    onCancel?: () => void
}) {
    return <div className="mx-auto mb-2 flex max-w-3xl items-center gap-3 border-l-2 border-white px-3 py-1 text-xs">
        <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-neutral-200">{label}</span>
            <span className="block truncate text-neutral-500">{preview}</span>
        </span>
        {onCancel ? <button data-icon-button type="button" onPointerDown={(event) => event.preventDefault()} onClick={onCancel} aria-label="Cancel reply" className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-neutral-500 hover:text-white">×</button> : null}
    </div>
}
