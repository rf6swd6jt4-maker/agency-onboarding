import Link from "next/link"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { LibraryTabs } from "@/components/library/LibraryTabs"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import {
    listWorkspaceWorkItems,
    phaseLabel,
    workItemHref,
    workspaceHref,
    type RelationshipWorkItemStatus,
} from "@/lib/relationships"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
}

function statusTone(status: RelationshipWorkItemStatus) {
    if (status === "blocked") return "bg-red-300 text-red-200"
    if (status === "waiting") return "bg-yellow-300 text-yellow-200"
    if (status === "doing") return "bg-sky-300 text-sky-200"
    if (status === "done") return "bg-lime-300 text-lime-200"
    if (status === "canceled") return "bg-neutral-600 text-neutral-400"
    return "bg-neutral-500 text-neutral-300"
}

export default async function WorkItemsPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const items = await listWorkspaceWorkItems(workspace.id)
    const openItems = items.filter((item) => !["done", "canceled"].includes(item.status))
    const blockedCount = items.filter((item) => item.status === "blocked").length
    const dueCount = openItems.filter((item) => item.due_date && new Date(item.due_date) <= new Date()).length
    const keyTaskCount = openItems.filter((item) => item.is_key_task).length

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl pt-5">
                <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
                <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
                            Browse workspace work items and assets from one place.
                        </p>
                    </div>
                    <Link href={workspaceHref(workspace.slug, "work-items?create=work-item")} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-center text-sm font-medium leading-none text-black sm:min-h-10 sm:px-3">
                        New work item
                    </Link>
                </header>

                <LibraryTabs workspaceSlug={workspace.slug} active="work-items" />

                <section className="mt-5 grid grid-cols-2 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 sm:grid-cols-4">
                    {[
                        ["Total", items.length],
                        ["Open", openItems.length],
                        ["Blocked", blockedCount],
                        [dueCount ? "Due/ready" : "Key open", dueCount || keyTaskCount],
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
                            const date = item.due_date ?? item.planned_start_date ?? item.actual_start_at ?? item.updated_at
                            return (
                                <Link key={item.id} href={workItemHref(workspace.slug, item.id)} className="grid gap-3 border-b border-neutral-900 px-4 py-4 last:border-0 hover:bg-neutral-900/60 md:grid-cols-[minmax(260px,1fr)_150px_120px_120px_130px] md:items-center">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            {item.is_key_task && <span className="h-2 w-2 shrink-0 rotate-45 bg-white" />}
                                            <p className="truncate font-medium text-neutral-100">{item.title}</p>
                                        </div>
                                        {item.description && <p className="mt-1 line-clamp-1 text-sm text-neutral-500">{item.description}</p>}
                                        <p className="mt-1 font-mono text-xs text-neutral-600">{shortId(item.id)}</p>
                                    </div>
                                    <p className="text-sm text-neutral-400">{phaseLabel(item.lifecycle_phase)}</p>
                                    <div className="flex items-center gap-2 text-sm">
                                        <span className={`h-2 w-2 rotate-45 ${tone.split(" ")[0]}`} />
                                        <span className={tone.split(" ")[1]}>{item.status}</span>
                                    </div>
                                    <p className="text-sm text-neutral-500">Priority {item.priority}</p>
                                    <p className="text-sm text-neutral-500 md:text-right">{formatRelativeTime(date)}</p>
                                </Link>
                            )
                        })
                    ) : (
                        <div className="p-6">
                            <p className="text-lg font-semibold">No work items yet.</p>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
                                Create a task from here or attach work from a relationship page.
                            </p>
                        </div>
                    )}
                </section>
            </div>
        </main>
    )
}
