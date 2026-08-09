import { RoundPill } from "@/components/ui/RoundPill"

export function MobileAssignedServices({ labels }: { labels: string[] }) {
    if (labels.length === 0) {
        return <span className="min-w-0 flex-1 truncate text-neutral-500 sm:hidden">No assigned services</span>
    }

    return <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden sm:hidden">
        <RoundPill tone="emerald" className="min-w-0">{labels[0]}</RoundPill>
        {labels.length > 1 ? <span className="shrink-0 text-xs tabular-nums text-neutral-400">+{labels.length - 1}</span> : null}
    </div>
}
