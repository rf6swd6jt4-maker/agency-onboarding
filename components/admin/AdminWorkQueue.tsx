"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { Status, type StatusTone } from "@/components/ui"
import { FilterRail, FilterRailButton, FilterRailCount } from "@/components/panel/FilterRail"
import { QuickStats } from "@/components/panel/QuickStats"
import type { AdminWorkItem } from "@/lib/admin/work-items"
import { formatOkrMetricValue } from "@/lib/admin/okr-metrics"
import { shortId } from "@/lib/ui/relative-time"
import { workItemPriorityLabel } from "@/lib/work-item-priority"

function queueTone(item: AdminWorkItem): StatusTone {
    if (item.priority_override === 1) return "red"
    if (item.priority_override === 2) return "yellow"
    if (item.queue_reason === "forced") return "red"
    if (item.queue_reason === "blocked" || item.queue_reason === "waiting" || item.queue_reason === "unassigned") return "yellow"
    if (item.queue_reason === "impact" || item.queue_reason === "enables") return "green"
    return "grey"
}

function workKindLabel(kind: string) {
    if (kind === "maintenance") return "Maintenance"
    if (kind === "okr_action") return "OKR action"
    return "Admin work"
}

function formatHours(hours: number) {
    if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}min`
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(hours)}h`
}

function formatProjectedTime(value: string | null) {
    if (!value) return null
    return new Intl.DateTimeFormat("en-GB", {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "UTC",
    }).format(new Date(value)).replace(",", "") + " UTC"
}

function primaryContribution(item: AdminWorkItem) {
    return [...item.contributions].sort((left, right) => right.priority_value - left.priority_value)[0] ?? null
}

function priorityPresentation(item: AdminWorkItem) {
    return item.priority_override === null
        ? { label: item.queue_label, source: "System priority" }
        : { label: workItemPriorityLabel(item.priority_override), source: "Manual override" }
}

function queueExplanation(item: AdminWorkItem) {
    const contribution = primaryContribution(item)
    const state = item.status === "doing" ? "In progress" : item.status === "blocked" ? "Blocked" : item.status === "waiting" ? "Waiting" : null
    const prefix = [workKindLabel(item.kind), state].filter(Boolean).join(" · ")
    if (contribution) {
        const movement = formatOkrMetricValue(contribution.expected_movement ?? 0, contribution.unit, contribution.currency_code ?? "USD")
        const gap = contribution.remaining_gap > 0 ? `${Math.round(contribution.remaining_gap_share * 100)}% of its remaining gap` : "target already met"
        return `${prefix} · +${movement} expected for ${contribution.key_result_name} · ${gap}`
    }
    if (item.enables_work_item_title) return `${prefix} · required before ${item.enables_work_item_title} can begin`
    if (item.blocked_by_titles.length) return `${prefix} · waiting for ${item.blocked_by_titles.join(", ")}`
    if (item.queue_reason === "forced" && item.projected_lateness_hours > 0) return `${prefix} · the projected plan has passed this item's latest safe start`
    if (item.queue_reason === "forced") return `${prefix} · must start now to protect its timing constraint`
    if (item.queue_reason === "obligation") return `${prefix} · protects the next operational deadline`
    if (item.queue_reason === "continuation") return `${prefix} · finishes work that is already in progress`
    return `${prefix} · ordered by timing, dependencies, and available capacity`
}

function queueForecast(item: AdminWorkItem) {
    const finish = formatProjectedTime(item.projected_finish)
    if (!finish) return !item.execution_owner_id ? "Assign owner to forecast" : item.queue_reason === "future" ? "Scheduled to start later" : null
    if (item.projected_lateness_hours > 0) return `Finish ${finish} · ${formatHours(item.projected_lateness_hours)} beyond capacity`
    return `Finish ${finish}`
}

function initials(name: string) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "A"
}

function QueueRow({ item, workspaceSlug, names }: {
    item: AdminWorkItem
    workspaceSlug: string
    names: Record<string, string>
}) {
    const ownerName = item.execution_owner_id ? names[item.execution_owner_id] ?? "Admin" : null
    const collaborators = item.assignee_ids.filter((id) => id !== item.execution_owner_id).map((id) => names[id] ?? "Admin")
    const assignees = [...(ownerName ? [ownerName] : []), ...collaborators]
    const priority = priorityPresentation(item)
    const forecast = queueForecast(item)
    const effort = item.predicted_duration_hours === item.conservative_duration_hours
        ? `${formatHours(item.predicted_duration_hours)} expected`
        : `${formatHours(item.predicted_duration_hours)} expected · ${formatHours(item.conservative_duration_hours)} reserved`

    return (
        <article className="border-b border-neutral-900 px-3 py-3 last:border-0 hover:bg-neutral-900/50 sm:px-4">
            <div className="min-w-0">
                <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_11.5rem_10rem_5.25rem] sm:items-center">
                    <Link href={`/${workspaceSlug}/work-items/${item.id}`} className="min-w-0 truncate font-medium text-neutral-100 hover:text-white hover:underline hover:underline-offset-4">{item.title}</Link>
                    <Status label={priority.label} tone={queueTone(item)} className="text-xs sm:text-sm" />
                    <span className="text-xs text-neutral-400 sm:text-right">{effort}</span>
                    <div className="flex -space-x-1 sm:justify-end" aria-label={ownerName ? `Owned by ${ownerName}${collaborators.length ? ` with ${collaborators.join(", ")}` : ""}` : "Unassigned"}>
                        {assignees.slice(0, 2).map((name, index) => <span key={`${name}-${index}`} className={`inline-flex h-7 w-7 items-center justify-center rounded-full border bg-neutral-900 text-[10px] font-semibold text-neutral-300 ${index === 0 && ownerName ? "border-white" : "border-neutral-700"}`}>{initials(name)}</span>)}
                        {!assignees.length ? <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-neutral-700 text-xs text-neutral-600">—</span> : null}
                    </div>
                </div>
                <div className="mt-1.5 grid min-w-0 gap-x-2 gap-y-1 text-xs leading-5 text-neutral-500 sm:grid-cols-[minmax(0,1fr)_11.5rem_10rem_5.25rem] sm:items-start">
                    <p className="min-w-0 line-clamp-2 text-neutral-400">{queueExplanation(item)}</p>
                    <span className={item.priority_override === null ? "text-neutral-500" : "text-amber-300"}>{priority.source}</span>
                    <span className={`sm:text-right ${item.projected_lateness_hours > 0 ? "text-red-300" : ""}`}>{forecast ?? workKindLabel(item.kind)}</span>
                    <span className="font-mono sm:text-right">{shortId(item.id)}</span>
                </div>
            </div>
        </article>
    )
}

export function AdminWorkQueue({ items, workspaceSlug, currentUserId, names }: { items: AdminWorkItem[]; workspaceSlug: string; currentUserId: string; names: Record<string, string> }) {
    const [view, setView] = useState<"business" | "mine">("business")
    const openItems = useMemo(() => items.filter((item) => item.status !== "done" && item.status !== "canceled"), [items])
    const visibleItems = useMemo(() => view === "mine" ? openItems.filter((item) => item.execution_owner_id === currentUserId) : openItems, [currentUserId, openItems, view])
    const myOpenItems = useMemo(() => openItems.filter((item) => item.execution_owner_id === currentUserId), [currentUserId, openItems])
    const ranked = visibleItems.filter((item) => item.queue_position !== null)
    const deferred = visibleItems.filter((item) => item.queue_position === null)
    const reservedHours = ranked.reduce((total, item) => total + item.conservative_duration_hours, 0)
    const lateItems = ranked.filter((item) => item.projected_lateness_hours > 0)
    const furthestLateness = Math.max(0, ...lateItems.map((item) => item.projected_lateness_hours))

    return <>
        <QuickStats ariaLabel="Work queue statistics" items={[
            { label: "Actionable", value: ranked.length },
            { label: "Reserved", value: formatHours(reservedHours) },
            { label: "Deferred", value: deferred.length, hideOnMobile: true },
            { label: "Capacity", value: furthestLateness > 0 ? `${formatHours(furthestLateness)} late` : "On plan" },
        ]} />
        <FilterRail ariaLabel="Filter work queue">
            <FilterRailButton selected={view === "business"} onClick={() => setView("business")}>Business <FilterRailCount>{openItems.length}</FilterRailCount></FilterRailButton>
            <FilterRailButton selected={view === "mine"} onClick={() => setView("mine")}>My work <FilterRailCount>{myOpenItems.length}</FilterRailCount></FilterRailButton>
        </FilterRail>
        <section className="mt-5 overflow-hidden rounded-2xl border border-neutral-800 bg-black" aria-label="Work queue">
            {ranked.length ? ranked.map((item) => <QueueRow key={item.id} item={item} workspaceSlug={workspaceSlug} names={names} />) : <p className="px-4 py-5 text-sm text-neutral-400">There is no actionable Admin work right now.</p>}
            {deferred.length ? (
                <div className="border-t border-neutral-800">
                    <div className="bg-neutral-950/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Blocked, waiting, or scheduled later</div>
                    {deferred.map((item) => <QueueRow key={item.id} item={item} workspaceSlug={workspaceSlug} names={names} />)}
                </div>
            ) : null}
            {!items.length ? <p className="px-4 py-5 text-sm text-neutral-400">Committed OKR actions and maintenance work will appear here.</p> : null}
        </section>
    </>
}
