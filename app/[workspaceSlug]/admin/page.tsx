import { AdminPanelNav } from "@/components/admin/AdminPanelNav"
import { AdminWorkQueue } from "@/components/admin/AdminWorkQueue"
import { OkrWorkspace } from "@/components/admin/OkrWorkspace"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { listWorkspaceOkrs } from "@/lib/admin/okrs"
import { okrAttention } from "@/lib/admin/work-priority"
import { listAdminWorkItems } from "@/lib/admin/work-items"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ view?: string }>
}

async function adminPeople(workspaceId: string) {
    const { data: memberships } = await supabaseAdmin.from("workspace_memberships").select("user_id, role").eq("workspace_id", workspaceId)
    const ids = (memberships ?? []).map((item) => item.user_id)
    const { data: profiles } = ids.length ? await supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", ids) : { data: [] }
    const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.username]))
    const avatarUrls = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.avatar_path ? profileAvatarUrl(profile.username, profile.avatar_path) : null]))
    return {
        names: new Map((memberships ?? []).map((membership) => [membership.user_id, names.get(membership.user_id) ?? membership.role])),
        avatarUrls,
        ownerOptions: (memberships ?? []).filter((membership) => membership.role === "owner" || membership.role === "admin").map((membership) => ({ user_id: membership.user_id, role: membership.role, name: names.get(membership.user_id) ?? membership.role })),
    }
}

export default async function AdminPage({ params, searchParams }: PageProps) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const view = query.view === "okrs" ? "okrs" : "work"
    const now = new Date()
    const [allOkrs, people] = await Promise.all([
        listWorkspaceOkrs(workspace.id),
        adminPeople(workspace.id),
    ])
    const [workItems, { data: linkableWorkItems }] = await Promise.all([
        listAdminWorkItems(workspace.id, allOkrs, now),
        view === "okrs" ? supabaseAdmin.from("work_items").select("id, title, status, priority, due_date, execution_owner_id").eq("workspace_id", workspace.id).order("priority").order("updated_at", { ascending: false }).limit(250) : Promise.resolve({ data: [] }),
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
                    title={view === "work" ? "Work Queue" : "OKRs"}
                    description={view === "work" ? "Ranked Admin work ordered by timing, dependencies, expected impact, ownership, and available capacity." : "Objectives and measurable Key Results for private workspace administration."}
                    tabs={<AdminPanelNav workspaceSlug={workspace.slug} active={view} />}
                />

                {view === "work" ? (
                    <AdminWorkQueue items={workItems} workspaceSlug={workspace.slug} currentUserId={user.id} names={Object.fromEntries(people.names)} avatarUrls={Object.fromEntries(people.avatarUrls)} />
                ) : (
                    <OkrWorkspace workspaceSlug={workspace.slug} currentUserId={user.id} okrs={okrs} ownerOptions={people.ownerOptions} workItems={linkableWorkItems ?? []} people={Object.fromEntries(people.names)} today={now.toISOString().slice(0, 10)} />
                )}
            </div>
        </main>
    )
}
