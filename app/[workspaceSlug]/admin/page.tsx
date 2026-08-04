import Link from "next/link"
import { AdminPanelNav } from "@/components/admin/AdminPanelNav"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { listWorkspaceOkrs } from "@/lib/admin/okrs"
import { listMaintenanceRouting, listMaintenanceWorkItems, MAINTENANCE_CATEGORIES, maintenanceCategoryLabel } from "@/lib/admin/maintenance"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ view?: string }>
}

async function adminPeople(workspaceId: string) {
    const { data: memberships } = await supabaseAdmin.from("workspace_memberships").select("user_id, role").eq("workspace_id", workspaceId).in("role", ["owner", "admin"])
    const ids = (memberships ?? []).map((item) => item.user_id)
    const { data: profiles } = ids.length ? await supabaseAdmin.from("user_profiles").select("user_id, username").in("user_id", ids) : { data: [] }
    const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.username]))
    return (memberships ?? []).map((membership) => ({ ...membership, name: names.get(membership.user_id) ?? membership.role }))
}

function statusTone(status: string) {
    if (status === "active") return "bg-lime-400/10 text-lime-200"
    if (status === "completed") return "bg-sky-400/10 text-sky-200"
    if (status === "cancelled") return "bg-red-400/10 text-red-200"
    return "bg-neutral-800 text-neutral-300"
}

export default async function AdminPage({ params, searchParams }: PageProps) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const [okrs, maintenance, routing, people] = await Promise.all([
        listWorkspaceOkrs(workspace.id),
        listMaintenanceWorkItems(workspace.id),
        listMaintenanceRouting(workspace.id),
        adminPeople(workspace.id),
    ])
    const view = query.view === "okrs" ? "okrs" : "overview"
    const activeOkrs = okrs.filter((okr) => okr.status === "active")
    const openMaintenance = maintenance.filter((item) => !["done", "canceled"].includes(item.status))
    const repeatedFailures = openMaintenance.filter((item) => item.occurrence_count > 1)
    const globalOfficerId = routing.find((route) => route.category === "global")?.responsible_user_id
    const configuredCategoryCount = routing.filter((route) => MAINTENANCE_CATEGORIES.includes(route.category as (typeof MAINTENANCE_CATEGORIES)[number])).length
    const missingRoutes = globalOfficerId ? 0 : MAINTENANCE_CATEGORIES.length - configuredCategoryCount
    const personName = new Map(people.map((person) => [person.user_id, person.name]))
    const attentionKeyResults = activeOkrs.flatMap((okr) => okr.key_results.filter((result) => !result.target_met).map((result) => ({ ...result, okrId: okr.id, okrTitle: okr.title }))).sort((left, right) => left.progress - right.progress)
    const routingByCategory = new Map(routing.map((route) => [route.category, route.responsible_user_id]))
    const owner = people.find((person) => person.role === "owner")

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl pt-5">
                <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
                <header>
                    <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">Turn measurable objectives and actionable platform failures into accountable Admin work.</p>
                </header>
                <AdminPanelNav workspaceSlug={workspace.slug} active={view} />

                {view === "overview" ? <>
                    <section className="mt-6 grid grid-cols-2 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 sm:grid-cols-4">
                        {[["Active OKRs", activeOkrs.length], ["Open maintenance", openMaintenance.length], ["Repeated failures", repeatedFailures.length], ["Unrouted categories", Math.max(0, missingRoutes)]].map(([label, value]) => <div key={label} className="border-r border-neutral-800 px-3 py-3 last:border-r-0"><p className="text-xs text-neutral-500">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>)}
                    </section>

                    <div className="mt-6 grid gap-6 lg:grid-cols-2">
                        <section className="rounded-2xl border border-neutral-800 bg-black p-5">
                            <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Active OKRs</h2><p className="mt-1 text-sm text-neutral-500">Objective attainment from the latest manual measurements.</p></div><Link href={`/${workspace.slug}/admin?view=okrs`} className="text-sm text-neutral-300 underline underline-offset-4">View all</Link></div>
                            <div className="mt-4 space-y-3">{activeOkrs.length ? activeOkrs.slice(0, 4).map((okr) => <Link key={okr.id} href={`/${workspace.slug}/admin/okrs/${okr.id}`} className="block rounded-xl border border-neutral-900 p-4 hover:border-neutral-700"><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-neutral-100">{okr.title}</p><p className="mt-1 text-xs text-neutral-500">{okr.key_results.length} Key Results · Owner {personName.get(okr.owner_user_id) ?? "Admin"}</p></div><span className="text-sm font-semibold">{Math.round(okr.attainment)}%</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-800"><div className="h-full bg-white" style={{ width: `${okr.attainment}%` }} /></div></Link>) : <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-sm text-neutral-500">No active OKRs yet.</p>}</div>
                        </section>

                        <section className="rounded-2xl border border-neutral-800 bg-black p-5">
                            <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Maintenance</h2><p className="mt-1 text-sm text-neutral-500">Terminal platform failures requiring an officer.</p></div><Link href={`/${workspace.slug}/admin/maintenance`} className="text-sm text-neutral-300 underline underline-offset-4">Open queue</Link></div>
                            <div className="mt-4 divide-y divide-neutral-900">{openMaintenance.length ? openMaintenance.slice(0, 5).map((item) => <Link key={item.id} href={`/${workspace.slug}/work-items/${item.id}`} className="flex gap-3 py-3 first:pt-0"><span className={`mt-1 h-2 w-2 shrink-0 rotate-45 ${item.severity === "critical" ? "bg-red-400" : "bg-yellow-300"}`} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-neutral-200">{item.title}</p><p className="mt-1 text-xs text-neutral-500">{maintenanceCategoryLabel(item.maintenance_category)} · {item.occurrence_count} occurrence{item.occurrence_count === 1 ? "" : "s"} · {formatRelativeTime(item.last_occurred_at)}</p></div></Link>) : <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-sm text-neutral-500">No actionable failures have been reported.</p>}</div>
                        </section>
                    </div>
                    <div className="mt-6 grid gap-6 lg:grid-cols-2">
                        <section className="rounded-2xl border border-neutral-800 bg-black p-5"><h2 className="text-lg font-semibold">Key Results needing attention</h2><p className="mt-1 text-sm text-neutral-500">Open targets, ordered by lowest attainment.</p><div className="mt-4 divide-y divide-neutral-900">{attentionKeyResults.length ? attentionKeyResults.slice(0, 6).map((result) => <Link key={result.id} href={`/${workspace.slug}/admin/okrs/${result.okrId}#key-result-${result.id}`} className="flex items-center justify-between gap-4 py-3 first:pt-0"><div className="min-w-0"><p className="truncate text-sm text-neutral-200">{result.name}</p><p className="mt-1 truncate text-xs text-neutral-600">{result.okrTitle}</p></div><span className="shrink-0 text-sm font-medium">{Math.round(result.progress)}%</span></Link>) : <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-sm text-neutral-500">Every active Key Result is on target, or no Key Results are active.</p>}</div></section>
                        <section className="rounded-2xl border border-neutral-800 bg-black p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Responsible officers</h2><p className="mt-1 text-sm text-neutral-500">{globalOfficerId ? `Global override · ${personName.get(globalOfficerId) ?? "Admin"}` : "Maintenance category ownership."}</p></div><Link href={`/${workspace.slug}/settings#officers`} className="text-sm text-neutral-300 underline underline-offset-4">Configure</Link></div><div className="mt-4 divide-y divide-neutral-900">{MAINTENANCE_CATEGORIES.map((category) => { const officerId = globalOfficerId ?? routingByCategory.get(category) ?? owner?.user_id; return <div key={category} className="flex justify-between gap-3 py-2.5"><span className="text-sm text-neutral-400">{maintenanceCategoryLabel(category)}</span><span className="text-sm text-neutral-200">{officerId ? personName.get(officerId) ?? "Admin" : "No owner available"}</span></div> })}</div></section>
                    </div>
                </> : <>
                    <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{okrs.length ? okrs.map((okr) => <Link key={okr.id} href={`/${workspace.slug}/admin/okrs/${okr.id}`} className="rounded-2xl border border-neutral-800 bg-black p-5 hover:border-neutral-600"><div className="flex items-start justify-between gap-3"><span className={`rounded-full px-2 py-1 text-[11px] capitalize ${statusTone(okr.status)}`}>{okr.status}</span><span className="text-sm font-semibold">{Math.round(okr.attainment)}%</span></div><h2 className="mt-4 font-semibold text-neutral-100">{okr.title}</h2><p className="mt-2 line-clamp-2 text-sm leading-6 text-neutral-500">{okr.description ?? "No objective description."}</p><p className="mt-4 text-xs text-neutral-600">{okr.key_results.length} Key Results · {okr.period_start} – {okr.period_end}</p></Link>) : <p className="text-sm text-neutral-500">No OKRs have been created. Use Create OKR from the workspace actions to add one.</p>}</section>
                </>}
            </div>
        </main>
    )
}
