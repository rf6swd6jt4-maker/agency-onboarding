import { PinIcon } from "@/components/communications/MessageInteractionIcons"

export function PinnedMessageBar({ preview, onClick }: { preview: string; onClick: () => void }) {
    return <button type="button" onClick={onClick} aria-label={`Jump to pinned message: ${preview}`} className="flex h-11 w-full shrink-0 items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-4 text-left hover:bg-neutral-900 lg:h-10 lg:px-5">
        <span className="min-w-0 flex-1 truncate text-xs text-neutral-300 lg:text-[11px]">{preview}</span>
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-neutral-400"><PinIcon className="h-4 w-4" /></span>
    </button>
}
