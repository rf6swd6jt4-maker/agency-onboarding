import Link from "next/link"
import { Suspense } from "react"
import { ActivityTrends, ActivityTrendsLoading } from "@/components/admin/ActivityTrends"

import { AdminPanelNav } from "@/components/admin/AdminPanelNav"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { ListCreatorAvatar } from "@/components/list/ListCreatorAvatar"
import { MobileListActionSurface } from "@/components/list/MobileCardActionSurface"
import { FilterRail, FilterRailCount, FilterRailLink } from "@/components/panel/FilterRail"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { Assignee, SquarePill, Status, type StatusTone } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ADMIN_ACTIVITY_CATEGORIES, adminActivityCategoryLabel, decodeAdminActivityCursor, encodeAdminActivityCursor, getAdminActivityFacets, listAdminActivityPage, listAdminActivitySince, type AdminActivityCategory, type AdminActivityLevel } from "@/lib/admin/activity"
import { ACTIVITY_RANGES, formatActivityCount, buildAdminActivityMetricBundle, type AdminActivityRange } from "@/lib/admin/activity-metrics"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ category?: string; level?: string; cursor?: string; range?: string }>
}

function metadataSummary(metadata: Record<string, unknown>) {
    return Object.entries(metadata).filter(([, value]) => value !== null && value !== undefined && typeof value !== "object").slice(0, 4).map(([key, value]) => `${key.replace(/_/g, " ")}: ${String(value)}`).join(" · ")
}

function activityStatus(level: AdminActivityLevel): { label: string; tone: StatusTone } {
    if (level === "error") return { label: "Error", tone: "red" }
    if (level === "warning") return { label: "Warning", tone: "yellow" }
    return { label: "Info", tone: "grey" }
}

async function loadActivityTrends(workspaceId: string, initialRange: AdminActivityRange, now: Date) {
    // Include three days of history to warm up the longest rolling average.
    const since = new Date(now.getTime() - 33 * 24 * 60 * 60 * 1000).toISOString()
    try {
        const events = await listAdminActivitySince(workspaceId, since, now.toISOString())
        return <ActivityTrends initialRange={initialRange} metrics={buildAdminActivityMetricBundle(events, now)} />
    } catch {
        return <p role="alert" className="mt-5 text-sm text-red-400">Activity charts could not load. Reload the tab to try again.</p>
    }
}

export default async function AdminActivityPage({ params, searchParams }: PageProps) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const category = ADMIN_ACTIVITY_CATEGORIES.includes(query.category as AdminActivityCategory) ? query.category as AdminActivityCategory : null
    const level = ["info", "warning", "error"].includes(query.level ?? "") ? query.level as AdminActivityLevel : null
    const cursor = decodeAdminActivityCursor(query.cursor)
    const range: AdminActivityRange = Object.hasOwn(ACTIVITY_RANGES, query.range ?? "") ? query.range as AdminActivityRange : "24h"
    const now = new Date()
    const trends = loadActivityTrends(workspace.id, range, now)
    const [activityPage, facets] = await Promise.all([
        listAdminActivityPage(workspace.id, { limit: 100, category, level, cursor }),
        getAdminActivityFacets(workspace.id, category, level),
    ])
    const events = activityPage.events
    const actorIds = [...new Set(events.map((event) => event.actor_user_id).filter((id): id is string => Boolean(id)))]
    const { data: profiles } = actorIds.length ? await supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", actorIds) : { data: [] }
    const actors = new Map((profiles ?? []).map((profile) => [profile.user_id, {
        name: profile.username,
        avatarSrc: profile.avatar_path ? profileAvatarUrl(profile.username, profile.avatar_path) : null,
    }]))
    const filterHref = (nextCategory: AdminActivityCategory | null, nextLevel = level, nextRange = range) => {
        const params = new URLSearchParams()
        params.set("range", nextRange)
        if (nextCategory) params.set("category", nextCategory)
        if (nextLevel) params.set("level", nextLevel)
        const suffix = params.toString()
        return `/${workspace.slug}/admin/activity${suffix ? `?${suffix}` : ""}`
    }

    return <main className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-7xl">
            <PanelTabHeader
                title="Activity Console"
                description="Event stream of recorded operations across services, onboarding, billing, communications, Lead Gen, integrations, and Gantt automation."
                tabs={<AdminPanelNav workspaceSlug={workspace.slug} active="activity" />}
            />

            <Suspense fallback={<ActivityTrendsLoading />}>{trends}</Suspense>

            <FilterRail ariaLabel="Filter activity by level">
                <FilterRailLink href={filterHref(category, null)} selected={!level}>All <FilterRailCount>{formatActivityCount(facets.levelTotal)}</FilterRailCount></FilterRailLink>
                {(["info", "warning", "error"] as const).map((item) => <FilterRailLink key={item} href={filterHref(category, item)} selected={level === item}><span className="capitalize">{item}</span> <FilterRailCount>{formatActivityCount(facets.byLevel[item])}</FilterRailCount></FilterRailLink>)}
            </FilterRail>
            <FilterRail ariaLabel="Filter activity by category" spacing="tight">
                <FilterRailLink href={filterHref(null)} selected={!category}>All activities <FilterRailCount>{formatActivityCount(facets.categoryTotal)}</FilterRailCount></FilterRailLink>
                {ADMIN_ACTIVITY_CATEGORIES.map((item) => <FilterRailLink key={item} href={filterHref(item)} selected={category === item}>{adminActivityCategoryLabel(item)} <FilterRailCount>{formatActivityCount(facets.byCategory[item])}</FilterRailCount></FilterRailLink>)}
            </FilterRail>

            <List ariaLabel="Activity log">
                {events.length ? events.map((event) => {
                    const details = metadataSummary(event.metadata)
                    const status = activityStatus(event.level)
                    const actor = event.actor_user_id ? actors.get(event.actor_user_id) ?? { name: "Workspace user", avatarSrc: null } : null
                    const sourceIsExternal = Boolean(event.source_href?.startsWith("http://") || event.source_href?.startsWith("https://"))
                    const detailHref = `/${workspace.slug}/admin/activity/${event.id}`
                    const actions = [
                        { label: "Open details", href: detailHref },
                        event.source_href ? { label: "Open source", href: event.source_href, external: sourceIsExternal } : null,
                        { label: "Copy event ID", copyText: event.id },
                    ]
                    return <ListItem key={event.id} className={event.level === "error" ? "bg-red-950/[0.08]" : ""} detailPreview={{
                        category: "Activity event",
                        reference: shortId(event.id),
                        title: event.summary,
                        subtitle: event.event_key,
                        updated: formatRelativeTime(event.occurred_at),
                    }}>
                        <MobileListActionSurface actions={actions} label={`Open actions for ${event.summary}`}>
                            <ListPrimaryRow>
                                <ListTitle href={detailHref} className="flex-1">{event.summary}</ListTitle>
                                <span className="hidden shrink-0 sm:inline-flex"><SquarePill>{adminActivityCategoryLabel(event.category)}</SquarePill></span>
                                <Status label={status.label} tone={status.tone} className="ml-auto shrink-0" />
                            </ListPrimaryRow>
                            <ListSecondaryRow>
                                <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-500">{event.event_key}</span>
                                {details ? <span className="hidden min-w-0 max-w-sm truncate text-neutral-500 xl:inline">{details}</span> : null}
                                {event.entity_id ? <span className="hidden shrink-0 text-neutral-500 md:inline">{event.entity_type ?? "Record"} {shortId(event.entity_id)}</span> : null}
                                <ListTrailing>
                                    <span className="font-mono text-neutral-500">{shortId(event.id)}</span>
                                    <span className="whitespace-nowrap text-neutral-500">{formatRelativeTime(event.occurred_at)}</span>
                                    {actor ? <Assignee name={actor.name} avatarSrc={actor.avatarSrc} compact compactSize="md" /> : <span title="Betelgeze automation"><ListCreatorAvatar src={null} username={null} className="h-6 w-6" /></span>}
                                    <ListActionMenu actions={actions} className="hidden sm:block" />
                                </ListTrailing>
                            </ListSecondaryRow>
                        </MobileListActionSurface>
                    </ListItem>
                }) : <div className="p-6">
                    <p className="text-lg font-semibold">No activity matches these filters.</p>
                    <p className="mt-2 text-sm text-neutral-400">Choose another level or category to broaden the event stream.</p>
                </div>}
            </List>
            {activityPage.nextCursor ? <div className="mt-4 flex justify-center">
                <Link className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-200 hover:border-neutral-500 hover:text-white" href={`${filterHref(category, level)}${filterHref(category, level).includes("?") ? "&" : "?"}cursor=${encodeURIComponent(encodeAdminActivityCursor(activityPage.nextCursor))}`}>Older activity</Link>
            </div> : null}
        </div>
    </main>
}
