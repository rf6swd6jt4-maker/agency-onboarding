import Link from "next/link"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { LibraryTabs } from "@/components/library/LibraryTabs"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { ListCreatorBadge } from "@/components/list/ListCreatorBadge"
import { MobileListActionSurface } from "@/components/list/MobileCardActionSurface"
import { workItemStatusPresentation } from "@/components/list/work-item-presentation"
import { FilterRail, FilterRailCount, FilterRailLink } from "@/components/panel/FilterRail"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { QuickStats } from "@/components/panel/QuickStats"
import { RelationshipStage, SquarePill, Status } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import { listWorkspaceWorkItems, workItemHref, workspaceHref } from "@/lib/relationships"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"
import { workItemPriorityLabel } from "@/lib/work-item-priority"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ state?: string }>
}

export default async function WorkItemsPage({ params, searchParams }: PageProps) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const items = await listWorkspaceWorkItems(workspace.id)
    const openItems = items.filter((item) => !["done", "canceled"].includes(item.status))
    const completedItems = items.filter((item) => ["done", "canceled"].includes(item.status))
    const blockedItems = items.filter((item) => item.status === "blocked")
    const dueCount = openItems.filter((item) => item.due_date && new Date(item.due_date) <= new Date()).length
    const selectedState = ["open", "blocked", "completed"].includes(query.state ?? "") ? query.state : null
    const visibleItems = selectedState === "open"
        ? openItems
        : selectedState === "blocked"
            ? blockedItems
            : selectedState === "completed"
                ? completedItems
                : items
    const creatorIds = [...new Set(items.map((item) => item.created_by).filter((id): id is string => Boolean(id)))]
    const creatorsResult = creatorIds.length
        ? await supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", creatorIds)
        : { data: [] as Array<{ user_id: string; username: string; avatar_path: string | null }> }
    const creatorById = new Map((creatorsResult.data ?? []).map((creator) => [creator.user_id, creator]))
    const filterHref = (state: string | null) => workspaceHref(workspace.slug, `work-items${state ? `?state=${state}` : ""}`)

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl pt-5">
                <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
                <PanelTabHeader
                    title="Work Items"
                    description="Workspace tasks ordered by their most recent update."
                    actions={<Link href={workspaceHref(workspace.slug, "work-items?create=work-item")} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-center text-sm font-medium leading-none text-black sm:min-h-10 sm:px-3">New work item</Link>}
                    tabs={<LibraryTabs workspaceSlug={workspace.slug} active="work-items" />}
                />

                <QuickStats ariaLabel="Work item statistics" items={[
                    { label: "Total", value: items.length, hideOnMobile: true },
                    { label: "Open", value: openItems.length },
                    { label: "Blocked", value: blockedItems.length },
                    { label: "Due/ready", value: dueCount },
                ]} />

                <FilterRail ariaLabel="Filter work items by state">
                    <FilterRailLink href={filterHref(null)} selected={!selectedState}>All <FilterRailCount>{items.length}</FilterRailCount></FilterRailLink>
                    <FilterRailLink href={filterHref("open")} selected={selectedState === "open"}>Open <FilterRailCount>{openItems.length}</FilterRailCount></FilterRailLink>
                    <FilterRailLink href={filterHref("blocked")} selected={selectedState === "blocked"}>Blocked <FilterRailCount>{blockedItems.length}</FilterRailCount></FilterRailLink>
                    <FilterRailLink href={filterHref("completed")} selected={selectedState === "completed"}>Completed <FilterRailCount>{completedItems.length}</FilterRailCount></FilterRailLink>
                </FilterRail>

                <List ariaLabel="Work items">
                    {visibleItems.length ? visibleItems.map((item) => {
                        const href = workItemHref(workspace.slug, item.id)
                        const status = workItemStatusPresentation(item.status)
                        const date = item.due_date ?? item.planned_start_date ?? item.actual_start_at ?? item.updated_at
                        const creator = item.created_by ? creatorById.get(item.created_by) : null
                        const creatorAvatarSrc = creator?.avatar_path && creator.username ? profileAvatarUrl(creator.username, creator.avatar_path) : null
                        const actions = [{ label: "Open work item", href }]
                        return <ListItem key={item.id}>
                            <MobileListActionSurface actions={actions} label={`Open actions for ${item.title}`}>
                                <ListPrimaryRow>
                                    <ListTitle href={href} className="flex-1">{item.title}</ListTitle>
                                    {item.is_key_task ? <SquarePill className="shrink-0">Key task</SquarePill> : null}
                                    <span className="hidden shrink-0 md:inline-flex"><RelationshipStage phase={item.lifecycle_phase} /></span>
                                    <Status label={status.label} tone={status.tone} className="ml-auto shrink-0" />
                                </ListPrimaryRow>
                                <ListSecondaryRow>
                                    {item.description ? <span className="hidden min-w-0 flex-1 truncate text-neutral-400 lg:inline">{item.description}</span> : null}
                                    <span className="hidden shrink-0 text-neutral-500 md:inline">{workItemPriorityLabel(item.priority)}</span>
                                    <ListTrailing>
                                        <span className="font-mono text-neutral-500">{shortId(item.id)}</span>
                                        <span className="whitespace-nowrap text-neutral-500">{formatRelativeTime(date)}</span>
                                        <ListCreatorBadge src={creatorAvatarSrc} username={creator?.username ?? null} label="Created by" date={new Date(item.created_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })} />
                                        <ListActionMenu actions={actions} className="hidden sm:block" />
                                    </ListTrailing>
                                </ListSecondaryRow>
                            </MobileListActionSurface>
                        </ListItem>
                    }) : <div className="p-6">
                        <p className="text-lg font-semibold">{selectedState ? `No ${selectedState} work items.` : "No work items yet."}</p>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">{selectedState ? <>Choose another state or <Link href={filterHref(null)} className="text-neutral-200 underline decoration-neutral-600 underline-offset-4 hover:text-white">show all work items</Link>.</> : "Create a task from here or attach work from a relationship page."}</p>
                    </div>}
                </List>
            </div>
        </main>
    )
}
