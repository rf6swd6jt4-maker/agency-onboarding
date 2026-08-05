import Link from "next/link"
import { AdminPanelNav } from "@/components/admin/AdminPanelNav"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { SquarePill } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { listMaintenanceWorkItems, MAINTENANCE_CATEGORIES, maintenanceCategoryLabel, type MaintenanceCategory } from "@/lib/admin/maintenance"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"
import { workItemPriorityLabel } from "@/lib/work-item-priority"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ category?: string; state?: string }>
}

export default async function MaintenancePage({ params, searchParams }: PageProps) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const [items, membershipResult] = await Promise.all([
        listMaintenanceWorkItems(workspace.id),
        supabaseAdmin.from("workspace_memberships").select("user_id, role").eq("workspace_id", workspace.id).in("role", ["owner", "admin"]),
    ])
    const memberships = membershipResult.data ?? []
    const ids = memberships.map((membership) => membership.user_id)
    const { data: profiles } = ids.length ? await supabaseAdmin.from("user_profiles").select("user_id, username").in("user_id", ids) : { data: [] }
    const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.username]))
    const selectedCategory = MAINTENANCE_CATEGORIES.includes(query.category as MaintenanceCategory) ? query.category as MaintenanceCategory : null
    const selectedState = query.state === "resolved" ? "resolved" : "open"
    const categoryItems = selectedCategory ? items.filter((item) => item.maintenance_category === selectedCategory) : items
    const visibleItems = categoryItems.filter((item) => selectedState === "resolved" ? ["done", "canceled"].includes(item.status) : !["done", "canceled"].includes(item.status))
    const filterHref = (category: MaintenanceCategory | null, state = selectedState) => {
        const params = new URLSearchParams({ state })
        if (category) params.set("category", category)
        return `/${workspace.slug}/admin/maintenance?${params}`
    }

    return <main className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-7xl pt-5">
            <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
            <header><h1 className="text-2xl font-semibold">Platform Maintenance</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">Terminal, actionable automation failures deduplicated into accountable Work Items.</p></header>
            <AdminPanelNav workspaceSlug={workspace.slug} active="maintenance" />

            <section className="mt-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-xl font-semibold">Maintenance queue</h2><p className="mt-1 text-sm text-neutral-500">Repeated fingerprints update one open item; recurrence after resolution creates a new item.</p></div><div className="flex rounded-lg border border-neutral-800 p-1 text-sm"><Link href={filterHref(selectedCategory, "open")} className={`rounded px-3 py-1.5 ${selectedState === "open" ? "bg-neutral-800 text-white" : "text-neutral-500"}`}>Open</Link><Link href={filterHref(selectedCategory, "resolved")} className={`rounded px-3 py-1.5 ${selectedState === "resolved" ? "bg-neutral-800 text-white" : "text-neutral-500"}`}>Resolved</Link></div></div>
                <div className="mt-4 flex gap-2 overflow-x-auto pb-1 text-xs"><Link href={filterHref(null)} className={`shrink-0 rounded-full border px-3 py-1.5 ${!selectedCategory ? "border-neutral-500 text-white" : "border-neutral-800 text-neutral-500"}`}>All categories</Link>{MAINTENANCE_CATEGORIES.map((category) => <Link key={category} href={filterHref(category)} className={`shrink-0 rounded-full border px-3 py-1.5 ${selectedCategory === category ? "border-neutral-500 text-white" : "border-neutral-800 text-neutral-500"}`}>{maintenanceCategoryLabel(category)}</Link>)}</div>
                <div className="mt-4 overflow-hidden rounded-2xl border border-neutral-800 bg-black">{visibleItems.length ? visibleItems.map((item) => {
                    const assigneeNames = item.assignee_ids.map((id) => names.get(id) ?? "Admin")
                    return <div key={item.id} className="border-b border-neutral-900 px-4 py-3 last:border-0 hover:bg-neutral-900/60">
                        <div className="flex min-w-0 items-center gap-2">
                            <Link href={`/${workspace.slug}/work-items/${item.id}`} className="truncate font-medium text-neutral-100 hover:underline">{item.title}</Link>
                            <SquarePill tone={item.severity === "critical" ? "red" : "yellow"} className="shrink-0 capitalize">{item.severity}</SquarePill>
                            <SquarePill className="ml-auto shrink-0">Admin</SquarePill>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
                            <span>{maintenanceCategoryLabel(item.maintenance_category)}</span>
                            <span>{workItemPriorityLabel(item.priority)}</span>
                            <span>{item.occurrence_count} occurrence{item.occurrence_count === 1 ? "" : "s"}</span>
                            <span>{assigneeNames.join(", ") || "Owner fallback pending"}</span>
                            <span>First {formatRelativeTime(item.first_occurred_at)}</span>
                            <span className="ml-auto">Last {formatRelativeTime(item.last_occurred_at)}</span>
                            {item.native_href ? <Link href={item.native_href} className="text-neutral-400 underline underline-offset-4">Source</Link> : null}
                        </div>
                    </div>
                }) : <p className="px-4 py-8 text-sm text-neutral-500">No {selectedState} maintenance items match this filter.</p>}</div>
            </section>
        </div>
    </main>
}
