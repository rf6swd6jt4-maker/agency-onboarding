import Link from "next/link"
import { OnboardingBuilderWorkspace } from "@/components/onboarding-builder/OnboardingBuilderWorkspace"
import { WorkspaceTabBridge } from "@/components/workspace/WorkspaceTabBridge"
import { loadOnboardingBuilderData } from "@/lib/onboarding/configuration"
import { WORKSPACE_TAB_FRAME_PARAM } from "@/lib/workspace-tabs"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ module?: string; bookend?: string; __betelgeze_tab?: string }>
}

export default async function OnboardingBuilderPage({ params, searchParams }: PageProps) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const tabId = query[WORKSPACE_TAB_FRAME_PARAM]
    if (tabId) {
        const standaloneParams = new URLSearchParams()
        if (query.module) standaloneParams.set("module", query.module)
        if (query.bookend) standaloneParams.set("bookend", query.bookend)
        const standaloneHref = `/${workspace.slug}/onboarding-builder${standaloneParams.size ? `?${standaloneParams}` : ""}`

        return (
            <main className="flex min-h-screen items-center justify-center bg-neutral-950 p-6 text-white">
                <WorkspaceTabBridge tabId={tabId} workspaceSlug={workspace.slug} />
                <section className="w-full max-w-md rounded-2xl border border-neutral-800 bg-black p-8 text-center shadow-2xl shadow-black/30">
                    <div className="mx-auto flex size-11 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900 text-lg" aria-hidden="true">↗</div>
                    <h1 className="mt-5 text-lg font-semibold">Onboarding Builder open in another tab</h1>
                    <p className="mt-2 text-sm leading-6 text-neutral-400">The Builder uses a focused full-screen workspace outside the Betelgeze app shell.</p>
                    <Link href={standaloneHref} target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex min-h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-medium text-black transition hover:bg-neutral-200">
                        Open Onboarding Builder
                    </Link>
                </section>
            </main>
        )
    }
    const data = await loadOnboardingBuilderData(workspace.id, query.module, user.id)
    const initialBookend = query.bookend === "welcome" || query.bookend === "completion" ? query.bookend : null

    if (!data.collaboration.visualEnabled) return <main className="flex min-h-screen items-center justify-center bg-neutral-950 p-6 text-white"><section className="max-w-lg rounded-2xl border border-neutral-800 bg-black p-6"><h1 className="text-lg font-semibold">Visual Onboarding Builder is not enabled</h1><p className="mt-2 text-sm leading-6 text-neutral-400">This workspace remains on the compatibility Builder while its version-two composition is being shadow-checked.</p></section></main>

    return (
        <main className="h-dvh min-h-[42rem] overflow-hidden bg-neutral-950 text-white">
            <OnboardingBuilderWorkspace key={`${query.module ?? ""}:${initialBookend ?? ""}:${data.selectedModule?.revisionId ?? "empty"}:${data.selectedModule?.lastEditedAt ?? ""}`} workspaceSlug={workspace.slug} workspaceName={workspace.name} data={data} initialBookend={initialBookend} />
        </main>
    )
}
