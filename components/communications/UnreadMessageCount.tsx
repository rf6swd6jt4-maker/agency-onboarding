export function UnreadMessageCount({ count, label }: { count: number; label: string }) {
    if (count <= 0) return null
    // This is unread navigation state for one destination, not an operational
    // status or grouped statistic that the shared StatusStat primitive represents.
    return <span aria-label={`${count} ${label}`} className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold tabular-nums text-black">{count}</span>
}
