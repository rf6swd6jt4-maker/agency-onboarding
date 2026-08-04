import Link from "next/link"
import { AdminPanelNav } from "@/components/admin/AdminPanelNav"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { listMaintenanceRouting, listMaintenanceWorkItems, MAINTENANCE_CATEGORIES, maintenanceCategoryLabel, type MaintenanceCategory } from "@/lib/admin/maintenance"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"
import { saveMaintenanceRouting } from "../actions"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ category?: string; state?: string }>
}

function diagnosticSummary(metadata: Record<string, unknown>) {
    const diagnostics = metadata.latest_diagnostics
    if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) return "No diagnostic summary was recorded."
    const record = diagnostics as Record<string, unknown>
    const direct = [record.error, record.detail, record.message].find((value) => typeof value === "string" && value.trim())
    if (typeof direct === "string") return direct
    const summary = Object.entries(record).slice(0, 3).map(([key, value]) => `${key.replace(/_/g, " ")}: ${String(value)}`).join(" · ")
    return summary || "No diagnostic summary was recorded."
}

export default async function MaintenancePage({ params, searchParams }: PageProps) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const [items, routing, membershipResult] = await Promise.all([
        listMaintenanceWorkItems(workspace.id),
        listMaintenanceRouting(workspace.id),
        supabaseAdmin.from("workspace_memberships").select("user_id, role").eq("workspace_id", workspace.id).in("role", ["owner", "admin"]),
    ])
    const memberships = membershipResult.data ?? []
    const ids = memberships.map((membership) => membership.user_id)
    const { data: profiles } = ids.length ? await supabaseAdmin.from("user_profiles").select("user_id, username").in("user_id", ids) : { data: [] }
    const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.username]))
    const people = memberships.map((membership) => ({ ...membership, name: names.get(membership.user_id) ?? membership.role }))
    const routes = new Map(routing.map((route) => [route.category, route.responsible_user_id]))
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

            <section className="mt-6 rounded-2xl border border-neutral-800 bg-black p-5">
                <h2 className="text-lg font-semibold">Responsible officers</h2><p className="mt-1 text-sm text-neutral-500">Unconfigured categories fall back to the workspace owner.</p>
                <form action={saveMaintenanceRouting.bind(null, workspace.slug)} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{MAINTENANCE_CATEGORIES.map((category) => <label key={category} className="text-sm text-neutral-300">{maintenanceCategoryLabel(category)}<select name={category} defaultValue={routes.get(category) ?? ""} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white"><option value="">Workspace owner (fallback)</option>{people.map((person) => <option key={person.user_id} value={person.user_id}>{person.name} · {person.role}</option>)}</select></label>)}<div className="sm:col-span-2 lg:col-span-3"><button className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black">Save routing</button></div></form>
            </section>

            <section className="mt-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-xl font-semibold">Maintenance queue</h2><p className="mt-1 text-sm text-neutral-500">Repeated fingerprints update one open item; recurrence after resolution creates a new item.</p></div><div className="flex rounded-lg border border-neutral-800 p-1 text-sm"><Link href={filterHref(selectedCategory, "open")} className={`rounded px-3 py-1.5 ${selectedState === "open" ? "bg-neutral-800 text-white" : "text-neutral-500"}`}>Open</Link><Link href={filterHref(selectedCategory, "resolved")} className={`rounded px-3 py-1.5 ${selectedState === "resolved" ? "bg-neutral-800 text-white" : "text-neutral-500"}`}>Resolved</Link></div></div>
                <div className="mt-4 flex gap-2 overflow-x-auto pb-1 text-xs"><Link href={filterHref(null)} className={`shrink-0 rounded-full border px-3 py-1.5 ${!selectedCategory ? "border-neutral-500 text-white" : "border-neutral-800 text-neutral-500"}`}>All categories</Link>{MAINTENANCE_CATEGORIES.map((category) => <Link key={category} href={filterHref(category)} className={`shrink-0 rounded-full border px-3 py-1.5 ${selectedCategory === category ? "border-neutral-500 text-white" : "border-neutral-800 text-neutral-500"}`}>{maintenanceCategoryLabel(category)}</Link>)}</div>
                <div className="mt-4 space-y-3">{visibleItems.length ? visibleItems.map((item) => {
                    const assigneeNames = item.assignee_ids.map((id) => names.get(id) ?? "Admin")
                    return <article key={item.id} className="rounded-2xl border border-neutral-800 bg-black p-4">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-[11px] font-medium uppercase tracking-wide ${item.severity === "critical" ? "bg-red-400/10 text-red-300" : "bg-yellow-300/10 text-yellow-200"}`}>{item.severity} · {item.priority === 1 ? "urgent" : "high"}</span><span className="text-xs text-neutral-500">{maintenanceCategoryLabel(item.maintenance_category)}</span></div><Link href={`/${workspace.slug}/work-items/${item.id}`} className="mt-3 block text-base font-medium text-neutral-100 hover:underline">{item.title}</Link><p className="mt-2 line-clamp-2 text-sm leading-6 text-neutral-500">{diagnosticSummary(item.metadata)}</p><p className="mt-2 font-mono text-xs text-neutral-700">{shortId(item.id)} · {item.failure_fingerprint}</p></div><dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-3 text-sm lg:w-[27rem]"><div><dt className="text-xs text-neutral-600">Occurrences</dt><dd className="mt-1 text-neutral-300">{item.occurrence_count}</dd></div><div><dt className="text-xs text-neutral-600">Officer</dt><dd className="mt-1 text-neutral-300">{assigneeNames.join(", ") || "Owner fallback pending"}</dd></div><div><dt className="text-xs text-neutral-600">First seen</dt><dd className="mt-1 text-neutral-400">{formatRelativeTime(item.first_occurred_at)}</dd></div><div><dt className="text-xs text-neutral-600">Last seen</dt><dd className="mt-1 text-neutral-400">{formatRelativeTime(item.last_occurred_at)}</dd></div></dl></div>
                        <div className="mt-3 flex gap-4 border-t border-neutral-900 pt-3 text-sm"><Link href={`/${workspace.slug}/work-items/${item.id}`} className="text-neutral-300 underline underline-offset-4">Open Work Item</Link>{item.native_href ? <Link href={item.native_href} className="text-neutral-500 underline underline-offset-4">Open source</Link> : null}</div>
                    </article>
                }) : <p className="rounded-2xl border border-dashed border-neutral-800 bg-black px-4 py-8 text-sm text-neutral-500">No {selectedState} maintenance items match this filter.</p>}</div>
            </section>
        </div>
    </main>
}
