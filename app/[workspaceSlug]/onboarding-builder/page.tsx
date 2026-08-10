import { OnboardingBuilderWorkspace } from "@/components/onboarding-builder/OnboardingBuilderWorkspace"
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
    const data = await loadOnboardingBuilderData(workspace.id, query.module, user.id)
    const initialBookend = query.bookend === "welcome" || query.bookend === "completion" ? query.bookend : null

    if (!data.collaboration.visualEnabled) return <main className="flex min-h-screen items-center justify-center bg-neutral-950 p-6 text-white"><section className="max-w-lg rounded-2xl border border-neutral-800 bg-black p-6"><h1 className="text-lg font-semibold">Visual Onboarding Builder is not enabled</h1><p className="mt-2 text-sm leading-6 text-neutral-400">This workspace remains on the compatibility Builder while its version-two composition is being shadow-checked.</p></section></main>

    return (
        <main className="h-dvh min-h-[42rem] overflow-hidden bg-neutral-950 text-white">
            <OnboardingBuilderWorkspace key={`${query.module ?? ""}:${initialBookend ?? ""}:${data.selectedModule?.revisionId ?? "empty"}:${data.selectedModule?.lastEditedAt ?? ""}`} workspaceSlug={workspace.slug} workspaceName={workspace.name} data={data} initialBookend={initialBookend} />
        </main>
    )
}
