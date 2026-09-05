import { AdminPanelNav } from "@/components/admin/AdminPanelNav"
import { AdminWorkQueue } from "@/components/admin/AdminWorkQueue"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { listWorkspaceOkrs } from "@/lib/admin/okrs"
import { adminPeople } from "@/lib/admin/people"
import { listAdminWorkItems } from "@/lib/admin/work-items"
import { requireWorkspace } from "@/lib/workspaces"
import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function AdminPage({ params, searchParams }: PageProps) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    if (query.view === "okrs") {
        const nextQuery = new URLSearchParams()
        for (const [key, rawValue] of Object.entries(query)) {
            if (key === "view" || rawValue === undefined) continue
            for (const entry of Array.isArray(rawValue) ? rawValue : [rawValue]) nextQuery.append(key, entry)
        }
        redirect(`/${workspaceSlug}/admin/okrs${nextQuery.size ? `?${nextQuery.toString()}` : ""}`)
    }
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const now = new Date()
    const [allOkrs, people] = await Promise.all([
        listWorkspaceOkrs(workspace.id),
        adminPeople(workspace.id),
    ])
    const workItems = await listAdminWorkItems(workspace.id, allOkrs, now)

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl">
                <PanelTabHeader
                    title="Work Queue"
                    description="Ranked Admin work ordered by timing, dependencies, expected impact, ownership, and available capacity."
                    tabs={<AdminPanelNav workspaceSlug={workspace.slug} active="work" />}
                />
                <AdminWorkQueue items={workItems} workspaceSlug={workspace.slug} currentUserId={user.id} names={Object.fromEntries(people.names)} avatarUrls={Object.fromEntries(people.avatarUrls)} />
            </div>
        </main>
    )
}
