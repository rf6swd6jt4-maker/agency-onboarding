import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
}

export default async function AdminPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl pt-5">
                <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
                <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
                            Admin tools will live here. This area will support automation-failure follow-up, including work items assigned to admins, and a future Goals section.
                        </p>
                    </div>
                </header>

                <section className="mt-6 rounded-2xl border border-dashed border-neutral-800 bg-neutral-900/45 p-5 sm:p-6">
                    <h2 className="text-base font-semibold text-neutral-200">Admin tools coming soon</h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
                        There are no admin actions available yet. Automation failures and their assigned work items will appear here as this panel is built out.
                    </p>
                </section>
            </div>
        </main>
    )
}
