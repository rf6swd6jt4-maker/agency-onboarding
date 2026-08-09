import Link from "next/link"
import { SquarePill, Status, type StatusTone } from "@/components/ui"
import type { AdminWorkItem } from "@/lib/admin/work-items"
import { formatOkrMetricValue } from "@/lib/admin/okr-metrics"
import { shortId } from "@/lib/ui/relative-time"
import { workItemPriorityLabel } from "@/lib/work-item-priority"

function statusTone(status: string) {
    if (status === "active" || status === "done") return "emerald" as const
    if (status === "doing" || status === "waiting") return "yellow" as const
    if (status === "blocked" || status === "cancelled" || status === "canceled") return "red" as const
    return "neutral" as const
}

function queueTone(item: AdminWorkItem): StatusTone {
    if (item.queue_reason === "forced") return "red"
    if (item.queue_reason === "blocked" || item.queue_reason === "waiting") return "yellow"
    return "grey"
}

function workKindLabel(kind: string) {
    if (kind === "maintenance") return "Maintenance"
    if (kind === "okr_action") return "OKR action"
    return "Admin work"
}

function formatHours(hours: number) {
    if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}min`
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(hours)}hr`
}

function durationSourceLabel(item: AdminWorkItem) {
    if (item.duration_source === "learned") return "learned duration"
    if (item.duration_source === "admin_history") return "estimated from Admin history"
    return "default duration until history exists"
}

function primaryContribution(item: AdminWorkItem) {
    return [...item.contributions].sort((left, right) => right.priority_value - left.priority_value)[0] ?? null
}

function QueueRow({ item, workspaceSlug, names }: { item: AdminWorkItem; workspaceSlug: string; names: Map<string, string> }) {
    const assignees = item.assignee_ids.map((id) => names.get(id) ?? "Admin")
    const contribution = primaryContribution(item)
    return (
        <Link href={`/${workspaceSlug}/work-items/${item.id}`} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 border-b border-neutral-900 px-4 py-3 last:border-0 hover:bg-neutral-900/60 sm:grid-cols-[2.75rem_minmax(0,1fr)]">
            <div className="pt-0.5 text-center font-mono text-sm text-neutral-500">{item.queue_position ?? "—"}</div>
            <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate font-medium text-neutral-100">{item.title}</p>
                    <SquarePill tone={statusTone(item.status)} className="shrink-0 capitalize">{item.status.replace(/_/g, " ")}</SquarePill>
                    <SquarePill className="ml-auto shrink-0">Admin</SquarePill>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
                    <Status label={item.queue_label} tone={queueTone(item)} />
                    <span>{workKindLabel(item.kind)}</span>
                    <span>{workItemPriorityLabel(item.priority)}</span>
                    <span>{assignees.length ? assignees.join(", ") : "Unassigned"}</span>
                    <span>{formatHours(item.predicted_duration_hours)} · {durationSourceLabel(item)}</span>
                    {item.queue_impact_rate > 0 ? <span>{item.queue_impact_rate.toFixed(2)} impact/hr</span> : null}
                    <span className="font-mono">{shortId(item.id)}</span>
                </div>
                {contribution ? (
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-neutral-400">
                        +{formatOkrMetricValue(contribution.expected_movement ?? 0, contribution.unit, contribution.currency_code ?? "USD")} expected for {contribution.key_result_name}
                        {contribution.remaining_gap > 0 ? ` · ${Math.round(contribution.remaining_gap_share * 100)}% of its remaining gap` : " · target already met"}
                    </p>
                ) : item.enables_work_item_title ? (
                    <p className="mt-2 text-xs leading-5 text-neutral-400">Required before {item.enables_work_item_title} can begin.</p>
                ) : item.blocked_by_titles.length ? (
                    <p className="mt-2 text-xs leading-5 text-neutral-400">Waiting for {item.blocked_by_titles.join(", ")}.</p>
                ) : (
                    <p className="mt-2 text-xs leading-5 text-neutral-600">No active committed KR contribution.</p>
                )}
            </div>
        </Link>
    )
}

export function AdminWorkQueue({ items, workspaceSlug, names }: { items: AdminWorkItem[]; workspaceSlug: string; names: Map<string, string> }) {
    const ranked = items.filter((item) => item.queue_position !== null)
    const deferred = items.filter((item) => item.queue_position === null && item.status !== "done" && item.status !== "canceled")
    const closed = items.filter((item) => item.status === "done" || item.status === "canceled")

    if (!items.length) return (
        <section className="mt-6 overflow-hidden rounded-2xl border border-neutral-800 bg-black p-6">
            <p className="text-lg font-semibold">No Admin work yet.</p>
            <p className="mt-2 text-sm text-neutral-400">Committed OKR actions and maintenance work will appear here.</p>
        </section>
    )

    return (
        <section className="mt-6 overflow-hidden rounded-2xl border border-neutral-800 bg-black">
            <header className="border-b border-neutral-800 px-4 py-4">
                <h2 className="font-semibold text-neutral-100">Recommended queue</h2>
                <p className="mt-1 max-w-4xl text-sm leading-6 text-neutral-400">The order balances timing commitments and dependencies first, then selects the greatest normalized KR movement per predicted working hour. Estimates guide priority; completing work never changes a KR measurement automatically.</p>
            </header>
            {ranked.length ? ranked.map((item) => <QueueRow key={item.id} item={item} workspaceSlug={workspaceSlug} names={names} />) : <p className="px-4 py-5 text-sm text-neutral-400">There is no actionable Admin work right now.</p>}
            {deferred.length ? (
                <div className="border-t border-neutral-800">
                    <div className="bg-neutral-950/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Not currently actionable</div>
                    {deferred.map((item) => <QueueRow key={item.id} item={item} workspaceSlug={workspaceSlug} names={names} />)}
                </div>
            ) : null}
            {closed.length ? (
                <details className="border-t border-neutral-800">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-neutral-400 hover:text-neutral-200">Completed and canceled ({closed.length})</summary>
                    <div className="border-t border-neutral-900">{closed.map((item) => <QueueRow key={item.id} item={item} workspaceSlug={workspaceSlug} names={names} />)}</div>
                </details>
            ) : null}
        </section>
    )
}
