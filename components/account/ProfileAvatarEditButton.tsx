type ProfileAvatarEditButtonProps = {
    onClick: () => void
    label?: string
    className?: string
    disabled?: boolean
}

function PencilIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3Z" /><path d="m13.5 8.5 3 3" /></svg>
}

export function ProfileAvatarEditButton({
    onClick,
    label = "Change profile picture",
    className = "",
    disabled = false,
}: ProfileAvatarEditButtonProps) {
    return (
        <button
            data-icon-button
            type="button"
            onClick={onClick}
            aria-label={label}
            disabled={disabled}
            className={`inline-flex shrink-0 items-center justify-center rounded-full border border-white/20 bg-neutral-950 text-white shadow-lg transition hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        >
            <PencilIcon />
        </button>
    )
}
