"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState, useTransition } from "react"
import { completeAdminWorkItem, undoAdminWorkItemCompletion, type WorkItemCompletionUndo } from "@/app/[workspaceSlug]/work-items/[id]/actions"
import { Status, type StatusTone } from "@/components/ui"
import { FilterRail, FilterRailButton, FilterRailCount } from "@/components/panel/FilterRail"
import { QuickStats } from "@/components/panel/QuickStats"
import type { AdminWorkItem } from "@/lib/admin/work-items"
import { formatOkrMetricValue } from "@/lib/admin/okr-metrics"
import { shortId } from "@/lib/ui/relative-time"
import { workItemPriorityLabel } from "@/lib/work-item-priority"

type QueueNotice = { kind: "completed"; undo: WorkItemCompletionUndo } | { kind: "error"; message: string }

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

function QueueRow({ item, workspaceSlug, names, pending, onComplete }: {
    item: AdminWorkItem
    workspaceSlug: string
    names: Record<string, string>
    pending: boolean
    onComplete: (item: AdminWorkItem) => void
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
        <article className="grid grid-cols-[2rem_2rem_minmax(0,1fr)] gap-x-2 border-b border-neutral-900 px-3 py-3 last:border-0 hover:bg-neutral-900/50 sm:grid-cols-[2.5rem_2.25rem_minmax(0,1fr)] sm:px-4">
            <div className="row-span-2 pt-0.5 text-center font-mono text-sm text-neutral-500">{item.queue_position ?? "—"}</div>
            <div className="row-span-2 pt-0.5">
                <button
                    type="button"
                    disabled={pending}
                    onClick={() => onComplete(item)}
                    aria-label={`Complete ${item.title}`}
                    className={`group flex h-5 w-5 items-center justify-center rounded-full border transition disabled:cursor-wait ${pending ? "border-neutral-300 text-neutral-300" : "border-neutral-600 text-transparent hover:border-neutral-300 hover:text-neutral-300"}`}
                >
                    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3 fill-none stroke-current stroke-[1.8]"><path d="m3.2 8.3 3 3 6.6-6.6" /></svg>
                </button>
            </div>

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

function QueueNotice({ notice, pending, onUndo }: { notice: QueueNotice; pending: boolean; onUndo: () => void }) {
    const completed = notice.kind === "completed"
    return (
        <div className="pointer-events-none fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[60] sm:left-1/2 sm:right-auto sm:w-[min(34rem,calc(100vw-2rem))] sm:-translate-x-1/2">
            <div role="status" aria-live="polite" className="pointer-events-auto flex min-h-12 items-center gap-3 rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm text-white shadow-2xl shadow-black/50 motion-reduce:animate-none" style={{ animation: "betelgeze-creation-notice 8.4s cubic-bezier(0.22, 1, 0.36, 1) both" }}>
                <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${completed ? "border-white text-white" : "border-red-400 text-red-300"}`}>
                    {completed ? <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-none stroke-current stroke-[1.8]"><path d="m3.2 8.3 3 3 6.6-6.6" /></svg> : "!"}
                </span>
                <span className="min-w-0 flex-1 font-medium">{completed ? "Work item completed" : notice.message}</span>
                {completed ? <button type="button" disabled={pending} onClick={onUndo} className="shrink-0 text-sm font-medium text-white underline underline-offset-4 hover:text-neutral-300 disabled:opacity-50">{pending ? "Undoing…" : "Undo"}</button> : null}
            </div>
        </div>
    )
}

export function AdminWorkQueue({ items, workspaceSlug, currentUserId, names }: { items: AdminWorkItem[]; workspaceSlug: string; currentUserId: string; names: Record<string, string> }) {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [pendingId, setPendingId] = useState<string | null>(null)
    const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set())
    const [notice, setNotice] = useState<QueueNotice | null>(null)
    const [view, setView] = useState<"business" | "mine">("business")

    useEffect(() => {
        if (!notice) return
        const timeout = window.setTimeout(() => setNotice(null), 8_400)
        return () => window.clearTimeout(timeout)
    }, [notice])

    const openItems = useMemo(() => items.filter((item) => !hiddenIds.has(item.id) && item.status !== "done" && item.status !== "canceled"), [hiddenIds, items])
    const visibleItems = useMemo(() => view === "mine" ? openItems.filter((item) => item.execution_owner_id === currentUserId) : openItems, [currentUserId, openItems, view])
    const myOpenItems = useMemo(() => openItems.filter((item) => item.execution_owner_id === currentUserId), [currentUserId, openItems])
    const ranked = visibleItems.filter((item) => item.queue_position !== null)
    const deferred = visibleItems.filter((item) => item.queue_position === null)
    const reservedHours = ranked.reduce((total, item) => total + item.conservative_duration_hours, 0)
    const lateItems = ranked.filter((item) => item.projected_lateness_hours > 0)
    const furthestLateness = Math.max(0, ...lateItems.map((item) => item.projected_lateness_hours))
    const hasOkrMovement = visibleItems.some((item) => item.contributions.length > 0)
    const ownerSummaries = (() => {
        const summaries = new Map<string, { count: number; hours: number; lateness: number }>()
        for (const item of ranked) {
            if (!item.execution_owner_id) continue
            const current = summaries.get(item.execution_owner_id) ?? { count: 0, hours: 0, lateness: 0 }
            summaries.set(item.execution_owner_id, {
                count: current.count + 1,
                hours: current.hours + item.conservative_duration_hours,
                lateness: Math.max(current.lateness, item.projected_lateness_hours),
            })
        }
        return [...summaries.entries()].map(([ownerId, summary]) => ({ ownerId, name: names[ownerId] ?? "Admin", ...summary }))
    })()

    function complete(item: AdminWorkItem) {
        setPendingId(item.id)
        startTransition(async () => {
            try {
                const undo = await completeAdminWorkItem(workspaceSlug, item.id)
                setHiddenIds((current) => new Set(current).add(item.id))
                setNotice({ kind: "completed", undo })
                router.refresh()
            } catch (error) {
                setNotice({ kind: "error", message: error instanceof Error ? error.message : "Could not complete this work item" })
            } finally {
                setPendingId(null)
            }
        })
    }

    function undoCompletion() {
        if (!notice || notice.kind !== "completed") return
        const undo = notice.undo
        startTransition(async () => {
            try {
                await undoAdminWorkItemCompletion(workspaceSlug, undo)
                setHiddenIds((current) => { const next = new Set(current); next.delete(undo.workItemId); return next })
                setNotice(null)
                router.refresh()
            } catch (error) {
                setNotice({ kind: "error", message: error instanceof Error ? error.message : "Could not undo this completion" })
            }
        })
    }

    return <>
        <QuickStats ariaLabel="Work queue statistics" items={[
            { label: "Actionable", value: ranked.length },
            { label: "Reserved", value: formatHours(reservedHours) },
            { label: "Deferred", value: deferred.length, hideOnMobile: true },
            { label: "Projected late", value: lateItems.length },
        ]} />
        <FilterRail ariaLabel="Filter work queue">
            <FilterRailButton selected={view === "business"} onClick={() => setView("business")}>Business <FilterRailCount>{openItems.length}</FilterRailCount></FilterRailButton>
            <FilterRailButton selected={view === "mine"} onClick={() => setView("mine")}>My work <FilterRailCount>{myOpenItems.length}</FilterRailCount></FilterRailButton>
        </FilterRail>
        {view === "business" && ownerSummaries.length ? <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">{ownerSummaries.map((owner) => <span key={owner.ownerId}>{owner.name}: {owner.count} item{owner.count === 1 ? "" : "s"} · {formatHours(owner.hours)}{owner.lateness > 0 ? <span className="text-red-300"> · {formatHours(owner.lateness)} late</span> : ""}</span>)}</div> : null}
        {lateItems.length ? <p className="mt-3 text-sm text-red-300">The current plan exceeds available capacity by up to {formatHours(furthestLateness)}. The affected finish forecasts are marked below.</p> : null}
        {!hasOkrMovement && visibleItems.length ? <p className="mt-3 text-sm text-neutral-500">No committed KR movement is active, so ordering uses timing, dependencies, operational severity, and capacity.</p> : null}
        <section className="mt-5 overflow-hidden rounded-2xl border border-neutral-800 bg-black" aria-label="Work queue">
            {ranked.length ? ranked.map((item) => <QueueRow key={item.id} item={item} workspaceSlug={workspaceSlug} names={names} pending={pending && pendingId === item.id} onComplete={complete} />) : <p className="px-4 py-5 text-sm text-neutral-400">There is no actionable Admin work right now.</p>}
            {deferred.length ? (
                <div className="border-t border-neutral-800">
                    <div className="bg-neutral-950/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Blocked, waiting, or scheduled later</div>
                    {deferred.map((item) => <QueueRow key={item.id} item={item} workspaceSlug={workspaceSlug} names={names} pending={pending && pendingId === item.id} onComplete={complete} />)}
                </div>
            ) : null}
            {!items.length ? <p className="px-4 py-5 text-sm text-neutral-400">Committed OKR actions and maintenance work will appear here.</p> : null}
            {notice ? <QueueNotice notice={notice} pending={pending} onUndo={undoCompletion} /> : null}
        </section>
    </>
}
