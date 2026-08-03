import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
}

export default async function OnboardingBuilderPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl pt-5">
                <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
                <header>
                    <h1 className="text-2xl font-semibold tracking-tight">Onboarding Builder</h1>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
                        Build the onboarding modules and session structure used by this workspace.
                    </p>
                </header>

                <section className="mt-5 rounded-2xl border border-dashed border-neutral-800 bg-neutral-900/45 p-6">
                    <p className="text-sm text-neutral-500">Onboarding Builder controls will be added here.</p>
                </section>
            </div>
        </main>
    )
}
