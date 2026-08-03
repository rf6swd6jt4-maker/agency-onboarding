import Link from "next/link"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import {
    listWorkQueueItems,
    phaseLabel,
    workItemHref,
    type RelationshipWorkItemStatus,
} from "@/lib/relationships"
import { requireWorkspace } from "@/lib/workspaces"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
}

function statusTone(status: RelationshipWorkItemStatus) {
    if (status === "blocked") return "bg-red-300 text-red-200"
    if (status === "waiting") return "bg-yellow-300 text-yellow-200"
    if (status === "doing") return "bg-sky-300 text-sky-200"
    return "bg-neutral-500 text-neutral-300"
}

export default async function FulfilmentPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const allItems = await listWorkQueueItems(workspace.slug, workspace.id)
    const items = allItems.filter((item) => item.lifecycle_phase === "fulfilment" || item.relationship?.lifecycle_phase === "fulfilment")
    const fulfilmentRelationshipIds = new Set(items.map((item) => item.relationship_id).filter(Boolean))
    const blockedCount = items.filter((item) => item.status === "blocked").length
    const dueCount = items.filter((item) => item.due_date && new Date(item.due_date) <= new Date()).length

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl pt-5">
                <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
                <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">
                            Fulfilment
                        </h1>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
                            Fulfilment-stage relationships and their shared tasks. This uses the same work items visible from the relationship record.
                        </p>
                    </div>
                </header>

                <section className="mt-5 grid grid-cols-2 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 sm:grid-cols-4">
                    {[
                        ["Open work", items.length],
                        ["Relationships", fulfilmentRelationshipIds.size],
                        ["Blocked", blockedCount],
                        ["Due/ready", dueCount],
                    ].map(([label, value]) => (
                        <div key={label} className="border-r border-neutral-800 px-3 py-3 last:border-r-0">
                            <p className="text-xs text-neutral-500">{label}</p>
                            <p className="mt-1 text-xl font-semibold">{value}</p>
                        </div>
                    ))}
                </section>

                <section className="mt-5 overflow-hidden rounded-2xl border border-neutral-800 bg-black">
                    {items.length ? (
                        items.map((item) => {
                            const tone = statusTone(item.status)
                            const date = item.due_date ?? item.planned_start_date ?? item.actual_start_at ?? item.created_at
                            return (
                                <Link key={item.id} href={workItemHref(workspace.slug, item.id)} className="grid gap-3 border-b border-neutral-900 px-4 py-4 last:border-0 hover:bg-neutral-900/60 md:grid-cols-[minmax(240px,1fr)_minmax(190px,0.8fr)_150px_120px_120px] md:items-center">
                                    <div className="min-w-0">
                                        <p className="truncate font-medium text-neutral-100">{item.title}</p>
                                        {item.description && <p className="mt-1 line-clamp-1 text-sm text-neutral-500">{item.description}</p>}
                                        <p className="mt-1 font-mono text-xs text-neutral-600">{shortId(item.id)}</p>
                                    </div>
                                    <div className="min-w-0 text-sm text-neutral-300">
                                        <span className="block truncate">{item.relationship?.primary_person_name ?? "Workspace item"}</span>
                                        <span className="block truncate text-xs text-neutral-500">{item.relationship?.business_name ?? "No relationship attached"}</span>
                                    </div>
                                    <p className="text-sm text-neutral-400">{phaseLabel(item.lifecycle_phase)}</p>
                                    <div className="flex items-center gap-2 text-sm">
                                        <span className={`h-2 w-2 rotate-45 ${tone.split(" ")[0]}`} />
                                        <span className={tone.split(" ")[1]}>{item.status}</span>
                                    </div>
                                    <p className="text-sm text-neutral-500 md:text-right">{formatRelativeTime(date)}</p>
                                </Link>
                            )
                        })
                    ) : (
                        <div className="p-6">
                            <p className="text-lg font-semibold">No fulfilment work yet.</p>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
                                Move a relationship into fulfilment or add fulfilment-stage tasks from a relationship page. Nothing here depends on ClickUp.
                            </p>
                        </div>
                    )}
                </section>
            </div>
        </main>
    )
}
