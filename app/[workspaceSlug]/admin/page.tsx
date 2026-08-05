import Link from "next/link"
import { AdminPanelNav } from "@/components/admin/AdminPanelNav"
import { OkrWorkspace } from "@/components/admin/OkrWorkspace"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { SquarePill } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { listWorkspaceOkrs } from "@/lib/admin/okrs"
import { listAdminWorkItems } from "@/lib/admin/work-items"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"
import { workItemPriorityLabel } from "@/lib/work-item-priority"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ view?: string }>
}

async function adminPeople(workspaceId: string) {
    const { data: memberships } = await supabaseAdmin.from("workspace_memberships").select("user_id, role").eq("workspace_id", workspaceId)
    const ids = (memberships ?? []).map((item) => item.user_id)
    const { data: profiles } = ids.length ? await supabaseAdmin.from("user_profiles").select("user_id, username").in("user_id", ids) : { data: [] }
    const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.username]))
    return {
        names: new Map((memberships ?? []).map((membership) => [membership.user_id, names.get(membership.user_id) ?? membership.role])),
        ownerOptions: (memberships ?? []).filter((membership) => membership.role === "owner" || membership.role === "admin").map((membership) => ({ user_id: membership.user_id, role: membership.role, name: names.get(membership.user_id) ?? membership.role })),
    }
}

function statusTone(status: string) {
    if (status === "active" || status === "done") return "emerald" as const
    if (status === "doing" || status === "waiting") return "yellow" as const
    if (status === "blocked" || status === "cancelled" || status === "canceled") return "red" as const
    return "neutral" as const
}

function workKindLabel(kind: string) {
    if (kind === "maintenance") return "Maintenance"
    if (kind === "okr_action") return "OKR action"
    return "Admin work"
}

export default async function AdminPage({ params, searchParams }: PageProps) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const view = query.view === "okrs" ? "okrs" : "work"
    const [allOkrs, workItems, people, { data: linkableWorkItems }] = await Promise.all([
        listWorkspaceOkrs(workspace.id),
        listAdminWorkItems(workspace.id),
        adminPeople(workspace.id),
        view === "okrs" ? supabaseAdmin.from("work_items").select("id, title, status, priority, due_date").eq("workspace_id", workspace.id).order("priority").order("updated_at", { ascending: false }).limit(250) : Promise.resolve({ data: [] }),
    ])
    const okrs = allOkrs.filter((okr) => okr.objective_type !== "aspirational").sort((left, right) => {
        const leftClosed = left.status === "completed" || left.status === "cancelled" ? 1 : 0
        const rightClosed = right.status === "completed" || right.status === "cancelled" ? 1 : 0
        return leftClosed - rightClosed || left.period_end.localeCompare(right.period_end)
    })

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl pt-5">
                <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
                <header>
                    <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">Private objectives, operational work, platform maintenance, and activity for workspace administrators.</p>
                </header>
                <AdminPanelNav workspaceSlug={workspace.slug} active={view} />

                {view === "work" ? (
                    <section className="mt-6 overflow-hidden rounded-2xl border border-neutral-800 bg-black">
                        {workItems.length ? workItems.map((item) => {
                            const assignees = item.assignee_ids.map((id) => people.names.get(id) ?? "Admin")
                            return <Link key={item.id} href={`/${workspace.slug}/work-items/${item.id}`} className="block border-b border-neutral-900 px-4 py-3 last:border-0 hover:bg-neutral-900/60">
                                <div className="flex min-w-0 items-center gap-2">
                                    <p className="truncate font-medium text-neutral-100">{item.title}</p>
                                    <SquarePill tone={statusTone(item.status)} className="shrink-0 capitalize">{item.status.replace(/_/g, " ")}</SquarePill>
                                    <SquarePill className="ml-auto shrink-0">Admin</SquarePill>
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
                                    <span>{workKindLabel(item.kind)}</span>
                                    <span>{workItemPriorityLabel(item.priority)}</span>
                                    <span>{assignees.length ? assignees.join(", ") : "Unassigned"}</span>
                                    <span className="font-mono">{shortId(item.id)}</span>
                                    <span className="ml-auto">{formatRelativeTime(item.updated_at)}</span>
                                </div>
                            </Link>
                        }) : <div className="p-6"><p className="text-lg font-semibold">No Admin work yet.</p><p className="mt-2 text-sm text-neutral-400">OKR actions and maintenance work items will appear here.</p></div>}
                    </section>
                ) : (
                    <OkrWorkspace workspaceSlug={workspace.slug} okrs={okrs} ownerOptions={people.ownerOptions} workItems={linkableWorkItems ?? []} people={Object.fromEntries(people.names)} />
                )}
            </div>
        </main>
    )
}
