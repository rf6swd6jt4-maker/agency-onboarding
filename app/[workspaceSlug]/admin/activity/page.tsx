import Link from "next/link"
import { AdminPanelNav } from "@/components/admin/AdminPanelNav"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { FilterRail, FilterRailCount, FilterRailLink } from "@/components/panel/FilterRail"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { TrendChart } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ADMIN_ACTIVITY_CATEGORIES, adminActivityCategoryLabel, listAdminActivity, listAdminActivitySince, type AdminActivityCategory, type AdminActivityLevel } from "@/lib/admin/activity"
import { buildAdminActivityMetrics, type AdminActivityMetric } from "@/lib/admin/activity-metrics"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ category?: string; level?: string }>
}

function metadataSummary(metadata: Record<string, unknown>) {
    return Object.entries(metadata).filter(([, value]) => value !== null && value !== undefined && typeof value !== "object").slice(0, 4).map(([key, value]) => `${key.replace(/_/g, " ")}: ${String(value)}`).join(" · ")
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
    const now = new Date()
    const metricSince = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const [events, metricEvents] = await Promise.all([listAdminActivity(workspace.id, 500), listAdminActivitySince(workspace.id, metricSince)])
    const metrics = buildAdminActivityMetrics(metricEvents, now)
    const actorIds = [...new Set(events.map((event) => event.actor_user_id).filter((id): id is string => Boolean(id)))]
    const { data: profiles } = actorIds.length ? await supabaseAdmin.from("user_profiles").select("user_id, username").in("user_id", actorIds) : { data: [] }
    const actorNames = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.username]))
    const category = ADMIN_ACTIVITY_CATEGORIES.includes(query.category as AdminActivityCategory) ? query.category as AdminActivityCategory : null
    const level = ["info", "warning", "error"].includes(query.level ?? "") ? query.level as AdminActivityLevel : null
    const visibleEvents = events.filter((event) => (!category || event.category === category) && (!level || event.level === level))
    const eventsInCategory = events.filter((event) => !category || event.category === category)
    const eventsAtLevel = events.filter((event) => !level || event.level === level)
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
                description="Event stream of recorded operations across onboarding, billing, communications, Lead Gen, integrations, and Gantt automation."
                tabs={<AdminPanelNav workspaceSlug={workspace.slug} active="activity" />}
            />

            <section className="mt-6" aria-label="Activity trends"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{metrics.map((metric) => <ActivityMetricCard key={metric.key} metric={metric} />)}</div><p className="mt-2 text-[11px] text-neutral-700">Rolling 24 hours in hourly buckets. Reloading this tab includes the latest recorded activity.</p></section>

            <FilterRail ariaLabel="Filter activity by level">
                <FilterRailLink href={filterHref(category, null)} selected={!level}>All <FilterRailCount>{eventsInCategory.length}</FilterRailCount></FilterRailLink>
                {(["info", "warning", "error"] as const).map((item) => <FilterRailLink key={item} href={filterHref(category, item)} selected={level === item}><span className="capitalize">{item}</span> <FilterRailCount>{eventsInCategory.filter((event) => event.level === item).length}</FilterRailCount></FilterRailLink>)}
            </FilterRail>
            <FilterRail ariaLabel="Filter activity by category" spacing="tight">
                <FilterRailLink href={filterHref(null)} selected={!category}>All activities <FilterRailCount>{eventsAtLevel.length}</FilterRailCount></FilterRailLink>
                {ADMIN_ACTIVITY_CATEGORIES.map((item) => <FilterRailLink key={item} href={filterHref(item)} selected={category === item}>{adminActivityCategoryLabel(item)} <FilterRailCount>{eventsAtLevel.filter((event) => event.category === item).length}</FilterRailCount></FilterRailLink>)}
            </FilterRail>

            <section className="mt-5" aria-label="Activity log">
                <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-black">{visibleEvents.length ? visibleEvents.map((event) => {
                    const details = metadataSummary(event.metadata)
                    return <article key={event.id} className="grid gap-3 border-b border-neutral-900 px-4 py-4 last:border-0 lg:grid-cols-[130px_minmax(0,1fr)_170px]"><div><span className={`rounded-full px-2 py-1 text-[11px] uppercase tracking-wide ${event.level === "error" ? "bg-red-400/10 text-red-300" : event.level === "warning" ? "bg-yellow-300/10 text-yellow-200" : "bg-sky-400/10 text-sky-200"}`}>{event.level}</span><p className="mt-2 text-xs text-neutral-600">{adminActivityCategoryLabel(event.category)}</p></div><div className="min-w-0"><p className="text-sm font-medium text-neutral-100">{event.summary}</p><p className="mt-1 font-mono text-xs text-neutral-700">{event.event_key}{event.entity_id ? ` · ${event.entity_type ?? "record"} ${shortId(event.entity_id)}` : ""}</p>{details ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-neutral-500">{details}</p> : null}{event.source_href ? <Link href={event.source_href} className="mt-2 inline-block text-xs text-neutral-400 underline underline-offset-4">Open source</Link> : null}</div><div className="text-xs text-neutral-600 lg:text-right"><p>{formatRelativeTime(event.occurred_at)}</p><p className="mt-1">{event.actor_user_id ? actorNames.get(event.actor_user_id) ?? "Workspace user" : "Automation"}</p></div></article>
                }) : <p className="px-4 py-10 text-sm text-neutral-500">No activity matches these filters yet.</p>}</div>
            </section>
        </div>
    </main>
}
