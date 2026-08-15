import Link from "next/link"

import { AdminPanelNav } from "@/components/admin/AdminPanelNav"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { ListCreatorAvatar } from "@/components/list/ListCreatorAvatar"
import { MobileListActionSurface } from "@/components/list/MobileCardActionSurface"
import { FilterRail, FilterRailCount, FilterRailLink } from "@/components/panel/FilterRail"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { Assignee, SquarePill, Status, TrendChart, type StatusTone } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ADMIN_ACTIVITY_CATEGORIES, adminActivityCategoryLabel, decodeAdminActivityCursor, encodeAdminActivityCursor, getAdminActivityFacets, listAdminActivityPage, listAdminActivitySince, type AdminActivityCategory, type AdminActivityLevel } from "@/lib/admin/activity"
import { buildAdminActivityMetrics, type AdminActivityMetric } from "@/lib/admin/activity-metrics"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ category?: string; level?: string; cursor?: string }>
}

function metadataSummary(metadata: Record<string, unknown>) {
    return Object.entries(metadata).filter(([, value]) => value !== null && value !== undefined && typeof value !== "object").slice(0, 4).map(([key, value]) => `${key.replace(/_/g, " ")}: ${String(value)}`).join(" · ")
}

function activityStatus(level: AdminActivityLevel): { label: string; tone: StatusTone } {
    if (level === "error") return { label: "Error", tone: "red" }
    if (level === "warning") return { label: "Warning", tone: "yellow" }
    return { label: "Info", tone: "grey" }
}

function metricValue(metric: AdminActivityMetric, value: number) {
    return metric.unit === "percentage" ? `${value.toFixed(value > 0 && value < 10 ? 1 : 0)}%` : Math.round(value).toLocaleString("en-IE")
}

function metricTime(value: string, detailed = false) {
    return new Intl.DateTimeFormat("en-IE", detailed
        ? { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" }
        : { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" }
    ).format(new Date(value))
}

function ActivityMetricCard({ metric }: { metric: AdminActivityMetric }) {
    const maximum = Math.max(1, ...metric.points.map((point) => point.value))
    const labelIndexes = [0, Math.floor((metric.points.length - 1) / 2), metric.points.length - 1]
    return <article className="min-w-0 rounded-xl border border-neutral-800 bg-black px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="text-sm font-medium text-neutral-200">{metric.title}</h2><p className="mt-1 min-h-10 text-xs leading-5 text-neutral-600">{metric.description}</p></div><div className="shrink-0 text-right"><p className={`text-2xl font-semibold tabular-nums ${metric.tone === "red" ? "text-red-400" : "text-white"}`}>{metricValue(metric, metric.currentValue)}</p><p className="mt-0.5 text-[10px] text-neutral-600">Current hour</p></div></div>
        <div className="mt-2"><TrendChart
            ariaLabel={`${metric.title} over the last 24 hours`}
            points={metric.points.map((point, index) => ({ id: `${metric.key}-${point.startsAt}`, position: index, value: point.value, ariaLabel: `${metricTime(point.startsAt, true)}: ${metricValue(metric, point.value)}`, tooltipLabel: metricTime(point.startsAt, true), tooltipValue: metricValue(metric, point.value) }))}
            domainEnd={metric.points.length - 1}
            min={0}
            max={maximum}
            labels={labelIndexes.map((index, labelIndex) => ({ id: `${metric.key}-label-${index}`, position: index, label: metricTime(metric.points[index].startsAt), anchor: labelIndex === 0 ? "start" as const : labelIndex === labelIndexes.length - 1 ? "end" as const : "middle" as const }))}
            tone={metric.tone}
        /></div>
    </article>
}

export default async function AdminActivityPage({ params, searchParams }: PageProps) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const category = ADMIN_ACTIVITY_CATEGORIES.includes(query.category as AdminActivityCategory) ? query.category as AdminActivityCategory : null
    const level = ["info", "warning", "error"].includes(query.level ?? "") ? query.level as AdminActivityLevel : null
    const cursor = decodeAdminActivityCursor(query.cursor)
    const now = new Date()
    const metricSince = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const [activityPage, facets, metricEvents] = await Promise.all([
        listAdminActivityPage(workspace.id, { limit: 100, category, level, cursor }),
        getAdminActivityFacets(workspace.id, category, level),
        listAdminActivitySince(workspace.id, metricSince),
    ])
    const events = activityPage.events
    const metrics = buildAdminActivityMetrics(metricEvents, now)
    const actorIds = [...new Set(events.map((event) => event.actor_user_id).filter((id): id is string => Boolean(id)))]
    const { data: profiles } = actorIds.length ? await supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", actorIds) : { data: [] }
    const actors = new Map((profiles ?? []).map((profile) => [profile.user_id, {
        name: profile.username,
        avatarSrc: profile.avatar_path ? profileAvatarUrl(profile.username, profile.avatar_path) : null,
    }]))
    const filterHref = (nextCategory: AdminActivityCategory | null, nextLevel = level) => {
        const params = new URLSearchParams()
        if (nextCategory) params.set("category", nextCategory)
        if (nextLevel) params.set("level", nextLevel)
        const suffix = params.toString()
        return `/${workspace.slug}/admin/activity${suffix ? `?${suffix}` : ""}`
    }

    return <main className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-7xl pt-5">
            <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
            <PanelTabHeader
                title="Activity Console"
                description="Event stream of recorded operations across services, onboarding, billing, communications, Lead Gen, integrations, and Gantt automation."
                tabs={<AdminPanelNav workspaceSlug={workspace.slug} active="activity" />}
            />

            <section className="mt-5" aria-label="Activity trends"><div className="grid gap-3 md:grid-cols-3">{metrics.map((metric) => <ActivityMetricCard key={metric.key} metric={metric} />)}</div><p className="mt-2 text-[11px] text-neutral-700">Rolling 24 hours in hourly buckets. Reloading this tab includes the latest recorded activity.</p></section>

            <FilterRail ariaLabel="Filter activity by level">
                <FilterRailLink href={filterHref(category, null)} selected={!level}>All <FilterRailCount>{facets.levelTotal}</FilterRailCount></FilterRailLink>
                {(["info", "warning", "error"] as const).map((item) => <FilterRailLink key={item} href={filterHref(category, item)} selected={level === item}><span className="capitalize">{item}</span> <FilterRailCount>{facets.byLevel[item]}</FilterRailCount></FilterRailLink>)}
            </FilterRail>
            <FilterRail ariaLabel="Filter activity by category" spacing="tight">
                <FilterRailLink href={filterHref(null)} selected={!category}>All activities <FilterRailCount>{facets.categoryTotal}</FilterRailCount></FilterRailLink>
                {ADMIN_ACTIVITY_CATEGORIES.map((item) => <FilterRailLink key={item} href={filterHref(item)} selected={category === item}>{adminActivityCategoryLabel(item)} <FilterRailCount>{facets.byCategory[item]}</FilterRailCount></FilterRailLink>)}
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
                    return <ListItem key={event.id} className={event.level === "error" ? "bg-red-950/[0.08]" : ""}>
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
