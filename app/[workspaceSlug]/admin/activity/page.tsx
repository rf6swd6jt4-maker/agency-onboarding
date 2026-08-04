import Link from "next/link"
import { AdminPanelNav } from "@/components/admin/AdminPanelNav"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ADMIN_ACTIVITY_CATEGORIES, adminActivityCategoryLabel, listAdminActivity, type AdminActivityCategory, type AdminActivityLevel } from "@/lib/admin/activity"
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

export default async function AdminActivityPage({ params, searchParams }: PageProps) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const events = await listAdminActivity(workspace.id)
    const actorIds = [...new Set(events.map((event) => event.actor_user_id).filter((id): id is string => Boolean(id)))]
    const { data: profiles } = actorIds.length ? await supabaseAdmin.from("user_profiles").select("user_id, username").in("user_id", actorIds) : { data: [] }
    const actorNames = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.username]))
    const category = ADMIN_ACTIVITY_CATEGORIES.includes(query.category as AdminActivityCategory) ? query.category as AdminActivityCategory : null
    const level = ["info", "warning", "error"].includes(query.level ?? "") ? query.level as AdminActivityLevel : null
    const visibleEvents = events.filter((event) => (!category || event.category === category) && (!level || event.level === level))
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
            <header><h1 className="text-2xl font-semibold">Activity Console</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">A workspace-wide operational trail for onboarding, billing, communications, Lead Gen, integrations, and Gantt automation.</p></header>
            <AdminPanelNav workspaceSlug={workspace.slug} active="activity" />

            <section className="mt-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-xl font-semibold">Event stream</h2><p className="mt-1 text-sm text-neutral-500">New events appear as the underlying operation completes or fails.</p></div><div className="flex rounded-lg border border-neutral-800 p-1 text-sm"><Link href={filterHref(category, null)} className={`rounded px-3 py-1.5 ${!level ? "bg-neutral-800 text-white" : "text-neutral-500"}`}>All</Link>{(["info", "warning", "error"] as const).map((item) => <Link key={item} href={filterHref(category, item)} className={`rounded px-3 py-1.5 capitalize ${level === item ? "bg-neutral-800 text-white" : "text-neutral-500"}`}>{item}</Link>)}</div></div>
                <div className="mt-4 flex gap-2 overflow-x-auto pb-1 text-xs"><Link href={filterHref(null)} className={`shrink-0 rounded-full border px-3 py-1.5 ${!category ? "border-neutral-500 text-white" : "border-neutral-800 text-neutral-500"}`}>All activities</Link>{ADMIN_ACTIVITY_CATEGORIES.map((item) => <Link key={item} href={filterHref(item)} className={`shrink-0 rounded-full border px-3 py-1.5 ${category === item ? "border-neutral-500 text-white" : "border-neutral-800 text-neutral-500"}`}>{adminActivityCategoryLabel(item)}</Link>)}</div>
                <div className="mt-4 overflow-hidden rounded-2xl border border-neutral-800 bg-black">{visibleEvents.length ? visibleEvents.map((event) => {
                    const details = metadataSummary(event.metadata)
                    return <article key={event.id} className="grid gap-3 border-b border-neutral-900 px-4 py-4 last:border-0 lg:grid-cols-[130px_minmax(0,1fr)_170px]"><div><span className={`rounded-full px-2 py-1 text-[11px] uppercase tracking-wide ${event.level === "error" ? "bg-red-400/10 text-red-300" : event.level === "warning" ? "bg-yellow-300/10 text-yellow-200" : "bg-sky-400/10 text-sky-200"}`}>{event.level}</span><p className="mt-2 text-xs text-neutral-600">{adminActivityCategoryLabel(event.category)}</p></div><div className="min-w-0"><p className="text-sm font-medium text-neutral-100">{event.summary}</p><p className="mt-1 font-mono text-xs text-neutral-700">{event.event_key}{event.entity_id ? ` · ${event.entity_type ?? "record"} ${shortId(event.entity_id)}` : ""}</p>{details ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-neutral-500">{details}</p> : null}{event.source_href ? <Link href={event.source_href} className="mt-2 inline-block text-xs text-neutral-400 underline underline-offset-4">Open source</Link> : null}</div><div className="text-xs text-neutral-600 lg:text-right"><p>{formatRelativeTime(event.occurred_at)}</p><p className="mt-1">{event.actor_user_id ? actorNames.get(event.actor_user_id) ?? "Workspace user" : "Automation"}</p></div></article>
                }) : <p className="px-4 py-10 text-sm text-neutral-500">No activity matches these filters yet.</p>}</div>
            </section>
        </div>
    </main>
}
