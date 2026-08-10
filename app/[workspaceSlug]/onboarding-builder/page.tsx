import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { OnboardingBuilderWorkspace } from "@/components/onboarding-builder/OnboardingBuilderWorkspace"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { loadOnboardingBuilderData } from "@/lib/onboarding/configuration"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ module?: string; bookend?: string }>
}

export default async function OnboardingBuilderPage({ params, searchParams }: PageProps) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const data = await loadOnboardingBuilderData(workspace.id, query.module)
    const initialBookend = query.bookend === "welcome" || query.bookend === "completion" ? query.bookend : null

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl pt-5">
                <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
                <PanelTabHeader title="Onboarding Builder" description="Build reusable form and video modules, edit required bookends, and preview the exact client journey." />
                <div className="mt-5"><OnboardingBuilderWorkspace key={`${query.module ?? ""}:${initialBookend ?? ""}:${data.selectedModule?.revisionId ?? "empty"}:${data.selectedModule?.lastEditedAt ?? ""}`} workspaceSlug={workspace.slug} workspaceName={workspace.name} data={data} initialBookend={initialBookend} /></div>
            </div>
        </main>
    )
}
