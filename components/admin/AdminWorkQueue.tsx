"use client"

import { useMemo, useState } from "react"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { MobileListActionSurface } from "@/components/list/MobileCardActionSurface"
import { FilterRail, FilterRailButton, FilterRailCount } from "@/components/panel/FilterRail"
import { QuickStats } from "@/components/panel/QuickStats"
import { Assignee, SquarePill, Status, type StatusTone } from "@/components/ui"
import type { AdminWorkItem } from "@/lib/admin/work-items"
import { formatOkrMetricValue } from "@/lib/admin/okr-metrics"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
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

function QueueRow({ item, workspaceSlug, names, avatarUrls }: {
    item: AdminWorkItem
    workspaceSlug: string
    names: Record<string, string>
    avatarUrls: Record<string, string | null>
}) {
    const ownerName = item.execution_owner_id ? names[item.execution_owner_id] ?? "Admin" : null
    const collaborators = item.assignee_ids.filter((id) => id !== item.execution_owner_id).map((id) => names[id] ?? "Admin")
    const assignees = [...(ownerName ? [ownerName] : []), ...collaborators]
    const priority = priorityPresentation(item)
    const forecast = queueForecast(item)
    const effort = item.predicted_duration_hours === item.conservative_duration_hours
        ? `${formatHours(item.predicted_duration_hours)} expected`
        : `${formatHours(item.predicted_duration_hours)} expected · ${formatHours(item.conservative_duration_hours)} reserved`
    const href = `/${workspaceSlug}/work-items/${item.id}`
    const actions = [{ label: "Open work item", href }]
    const firstAssigneeId = item.execution_owner_id ?? item.assignee_ids[0] ?? null
    const firstAssigneeName = firstAssigneeId ? names[firstAssigneeId] ?? "Admin" : null

    return (
        <ListItem>
            <MobileListActionSurface actions={actions} label={`Open actions for ${item.title}`}>
                <ListPrimaryRow>
                    <ListTitle href={href} className="flex-1">{item.title}</ListTitle>
                    <span className="hidden shrink-0 sm:inline-flex"><SquarePill>{workKindLabel(item.kind)}</SquarePill></span>
                    <Status label={priority.label} tone={queueTone(item)} className="ml-auto shrink-0" />
                </ListPrimaryRow>
                <ListSecondaryRow>
                    <span className="hidden min-w-0 flex-1 truncate text-neutral-400 lg:inline">{queueExplanation(item)}</span>
                    <span className="hidden shrink-0 text-neutral-500 md:inline">{effort}</span>
                    <span className={`hidden shrink-0 xl:inline ${item.priority_override === null ? "text-neutral-500" : "text-amber-300"}`}>{priority.source}</span>
                    {forecast ? <span className={`hidden shrink-0 text-neutral-500 sm:inline ${item.projected_lateness_hours > 0 ? "text-red-300" : ""}`}>{forecast}</span> : null}
                    {!firstAssigneeName ? <span className="hidden shrink-0 text-neutral-600 md:inline">Unassigned</span> : null}
                    <ListTrailing>
                        <span className="font-mono text-neutral-500">{shortId(item.id)}</span>
                        <span className="whitespace-nowrap text-neutral-500">{formatRelativeTime(item.updated_at)}</span>
                        {firstAssigneeName ? <span className="inline-flex shrink-0 items-center gap-1" aria-label={ownerName ? `Owned by ${ownerName}${collaborators.length ? ` with ${collaborators.join(", ")}` : ""}` : `Assigned to ${assignees.join(", ")}`}>
                            <Assignee userId={firstAssigneeId} name={firstAssigneeName} avatarSrc={firstAssigneeId ? avatarUrls[firstAssigneeId] : null} compact compactSize="md" />
                            {assignees.length > 1 ? <span className="text-xs text-neutral-500">+{assignees.length - 1}</span> : null}
                        </span> : null}
                        <ListActionMenu actions={actions} className="hidden sm:block" />
                    </ListTrailing>
                </ListSecondaryRow>
            </MobileListActionSurface>
        </ListItem>
    )
}

export function AdminWorkQueue({ items, workspaceSlug, currentUserId, names, avatarUrls }: { items: AdminWorkItem[]; workspaceSlug: string; currentUserId: string; names: Record<string, string>; avatarUrls: Record<string, string | null> }) {
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
        <List ariaLabel="Work queue">
            {ranked.length ? ranked.map((item) => <QueueRow key={item.id} item={item} workspaceSlug={workspaceSlug} names={names} avatarUrls={avatarUrls} />) : <p className="px-4 py-5 text-sm text-neutral-400">There is no actionable Admin work right now.</p>}
            {deferred.length ? (
                <div className="border-t border-neutral-800">
                    <div className="bg-neutral-950/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Blocked, waiting, or scheduled later</div>
                    {deferred.map((item) => <QueueRow key={item.id} item={item} workspaceSlug={workspaceSlug} names={names} avatarUrls={avatarUrls} />)}
                </div>
            ) : null}
            {!items.length ? <p className="px-4 py-5 text-sm text-neutral-400">Committed OKR actions and maintenance work will appear here.</p> : null}
        </List>
    </>
}
