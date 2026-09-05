import { AdminPanelNav } from "@/components/admin/AdminPanelNav"
import { OkrWorkspace } from "@/components/admin/OkrWorkspace"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { listWorkspaceOkrs } from "@/lib/admin/okrs"
import { adminPeople } from "@/lib/admin/people"
import { okrAttention } from "@/lib/admin/work-priority"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
}

export default async function AdminOkrsPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const now = new Date()
    const [allOkrs, people, { data: linkableWorkItems }] = await Promise.all([
        listWorkspaceOkrs(workspace.id),
        adminPeople(workspace.id),
        supabaseAdmin.from("work_items").select("id, title, status, priority, due_date, execution_owner_id").eq("workspace_id", workspace.id).order("priority").order("updated_at", { ascending: false }).limit(250),
    ])
    const okrs = allOkrs.filter((okr) => okr.objective_type !== "aspirational").map((okr) => ({
        ...okr,
        key_results: okr.status === "active" ? [...okr.key_results].sort((left, right) => {
            const leftAttention = okrAttention({ progress: left.progress, periodStart: okr.period_start, periodEnd: okr.period_end, now })
            const rightAttention = okrAttention({ progress: right.progress, periodStart: okr.period_start, periodEnd: okr.period_end, now })
            if (!Number.isFinite(leftAttention) && !Number.isFinite(rightAttention)) return left.sort_order - right.sort_order
            if (!Number.isFinite(leftAttention)) return -1
            if (!Number.isFinite(rightAttention)) return 1
            return rightAttention - leftAttention || left.sort_order - right.sort_order
        }) : okr.key_results,
    })).sort((left, right) => {
        const leftClosed = left.status === "completed" || left.status === "cancelled" ? 1 : 0
        const rightClosed = right.status === "completed" || right.status === "cancelled" ? 1 : 0
        return leftClosed - rightClosed || left.period_end.localeCompare(right.period_end)
    })

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl">
                <PanelTabHeader
                    title="OKRs"
                    description="Objectives and measurable Key Results for private workspace administration."
                    tabs={<AdminPanelNav workspaceSlug={workspace.slug} active="okrs" />}
                />
                <OkrWorkspace workspaceSlug={workspace.slug} currentUserId={user.id} okrs={okrs} ownerOptions={people.ownerOptions} workItems={linkableWorkItems ?? []} people={Object.fromEntries(people.names)} today={now.toISOString().slice(0, 10)} />
            </div>
        </main>
    )
}
