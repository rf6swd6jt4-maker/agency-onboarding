import Link from "next/link"
import { notFound } from "next/navigation"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ClientContextPanel } from "@/components/workspace/ClientContextPanel"
import {
    getRelationship,
    listRelationshipTimelineItems,
    phaseLabel,
    relationshipHubHref,
    workItemHref,
} from "@/lib/relationships"
import { formatRelativeTime } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string; relationshipId: string }>
}

export default async function FulfilmentDetailPlaceholder({ params }: PageProps) {
    const { workspaceSlug, relationshipId } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const relationship = await getRelationship(workspace.id, relationshipId)
    if (!relationship) notFound()
    const workItems = await listRelationshipTimelineItems(workspace.slug, relationship)
    const openItems = workItems.filter((item) => !["done", "canceled"].includes(item.status))

    return (
        <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-[92rem]">
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                        <header className="border-b border-neutral-800 pb-6">
                            <p className="text-sm text-neutral-500">Fulfilment detail</p>
                            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{relationship.primary_person_name}</h1>
                            <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
                                This panel will replace the old ClickUp Client Work list for this relationship. Future task rows will open global work-item detail panels at `/work-items/[id]`.
                            </p>
                        </header>

                <section className="mt-6 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <p className="text-sm text-neutral-500">Open work</p>
                        <p className="mt-2 font-medium">{openItems.length}</p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <p className="text-sm text-neutral-500">Lifecycle</p>
                        <p className="mt-2 font-medium">{phaseLabel(relationship.lifecycle_phase)}</p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <p className="text-sm text-neutral-500">Updated</p>
                        <p className="mt-2 font-medium">{formatRelativeTime(relationship.updated_at)}</p>
                    </div>
                </section>

                <section className="mt-6 rounded-2xl border border-neutral-800 bg-black p-5">
                    <h2 className="text-lg font-semibold">Future fulfilment workspace</h2>
                    <p className="mt-2 text-sm leading-6 text-neutral-400">
                        Placeholder for relationship fulfilment tasks, blockers, due dates, assigned work, assets, and links to global work-item detail panels.
                    </p>
                    <div className="mt-4 divide-y divide-neutral-900 rounded-xl border border-neutral-900">
                        {openItems.slice(0, 6).map((item) => (
                            <Link key={item.id} href={item.synthesized ? item.native_href ?? workItemHref(workspace.slug, item.id) : workItemHref(workspace.slug, item.id)} className="block px-3 py-2 hover:bg-neutral-900/70">
                                <p className="text-sm font-medium text-neutral-100">{item.title}</p>
                                <p className="mt-1 text-xs text-neutral-500">{item.status} · {phaseLabel(item.lifecycle_phase)}</p>
                            </Link>
                        ))}
                        {openItems.length === 0 && (
                            <p className="px-3 py-4 text-sm text-neutral-500">No open work items are attached yet.</p>
                        )}
                    </div>
                    <Link href={relationshipHubHref(workspace.slug, relationship.id)} className="mt-4 inline-flex rounded-lg border border-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:text-white">
                        Open relationship summary
                    </Link>
                </section>

                        <section className="mt-6 rounded-2xl border border-red-500/20 bg-red-950/10 p-5">
                            <h2 className="text-lg font-semibold text-red-100">Danger zone placeholder</h2>
                            <p className="mt-2 text-sm leading-6 text-red-100/70">
                                Project archive/delete controls will live here after the real fulfilment detail panel is built.
                            </p>
                        </section>
                    </div>

                    <ClientContextPanel
                        workspaceSlug={workspace.slug}
                        relationship={relationship}
                        metrics={[{ label: "Open work", value: openItems.length }]}
                    />
                </div>
            </div>
        </main>
    )
}
