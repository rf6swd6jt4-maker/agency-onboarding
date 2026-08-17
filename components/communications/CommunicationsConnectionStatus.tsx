import type { CommunicationsConnectionState } from "@/components/communications/useReliableCommunicationsRealtime"

export function CommunicationsConnectionStatus({ state, error }: { state: CommunicationsConnectionState; error: string | null }) {
    if (state === "live") return null
    const label = state === "connecting" ? "Messages connecting"
        : state === "syncing" ? "Checking for missed messages"
            : state === "reconnecting" ? "Messages reconnecting"
                : error || "Messages offline"
    const waiting = state === "connecting" || state === "syncing" || state === "reconnecting"
    return <span aria-label={label} title={label} className={`h-2.5 w-2.5 shrink-0 rounded-full ${waiting ? "animate-pulse bg-amber-400" : "bg-red-400"}`} />
}
