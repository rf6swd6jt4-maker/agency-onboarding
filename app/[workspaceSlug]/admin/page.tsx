import Link from "next/link"
import { AdminPanelNav } from "@/components/admin/AdminPanelNav"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { SquarePill } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { listWorkspaceOkrs } from "@/lib/admin/okrs"
import { formatOkrDeadline, okrDisplayTitle, okrTypeLabel } from "@/lib/admin/okr-title"
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
    const { data: memberships } = await supabaseAdmin.from("workspace_memberships").select("user_id, role").eq("workspace_id", workspaceId).in("role", ["owner", "admin"])
    const ids = (memberships ?? []).map((item) => item.user_id)
    const { data: profiles } = ids.length ? await supabaseAdmin.from("user_profiles").select("user_id, username").in("user_id", ids) : { data: [] }
    const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.username]))
    return new Map((memberships ?? []).map((membership) => [membership.user_id, names.get(membership.user_id) ?? membership.role]))
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
    const [okrs, workItems, people] = await Promise.all([
        listWorkspaceOkrs(workspace.id),
        listAdminWorkItems(workspace.id),
        adminPeople(workspace.id),
    ])
    const view = query.view === "okrs" ? "okrs" : "work"

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
                            const assignees = item.assignee_ids.map((id) => people.get(id) ?? "Admin")
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
                    <section className="mt-6 overflow-hidden rounded-2xl border border-neutral-800 bg-black">
                        {okrs.length ? okrs.map((okr) => <Link key={okr.id} href={`/${workspace.slug}/admin/okrs/${okr.id}`} className="block border-b border-neutral-900 px-4 py-3 last:border-0 hover:bg-neutral-900/60">
                            <div className="flex min-w-0 items-center gap-2">
                                <p className="truncate font-medium text-neutral-100">{okrDisplayTitle({ objectiveType: okr.objective_type, objective: okr.objective, deadline: okr.period_end })}</p>
                                {okr.objective_type ? <SquarePill tone={okr.objective_type === "aspirational" ? "violet" : "sky"} className="shrink-0">{okrTypeLabel(okr.objective_type)}</SquarePill> : null}
                                <SquarePill tone={statusTone(okr.status)} className="shrink-0 capitalize">{okr.status}</SquarePill>
                                <span className="ml-auto shrink-0 text-sm font-semibold tabular-nums text-neutral-200">{Math.round(okr.attainment)}%</span>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
                                <span>{okr.key_results.length} Key Result{okr.key_results.length === 1 ? "" : "s"}</span>
                                <span>Starts {formatOkrDeadline(okr.period_start)}</span>
                                <span>Deadline {formatOkrDeadline(okr.period_end)}</span>
                                <span>{people.get(okr.owner_user_id) ?? "Admin"}</span>
                                {okr.description ? <span className="min-w-0 flex-1 truncate">{okr.description}</span> : null}
                            </div>
                        </Link>) : <div className="p-6"><p className="text-lg font-semibold">No OKRs yet.</p><p className="mt-2 text-sm text-neutral-400">Use Create OKR from the workspace actions to add one.</p></div>}
                    </section>
                )}
            </div>
        </main>
    )
}
