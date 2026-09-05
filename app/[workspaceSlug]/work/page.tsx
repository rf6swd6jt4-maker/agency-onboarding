import Link from "next/link"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { ListCreatorBadge } from "@/components/list/ListCreatorBadge"
import { MobileListActionSurface } from "@/components/list/MobileCardActionSurface"
import { workItemStatusPresentation } from "@/components/list/work-item-presentation"
import { FilterRail, FilterRailCount, FilterRailLink } from "@/components/panel/FilterRail"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { QuickStats } from "@/components/panel/QuickStats"
import { SquarePill, Status } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import { listWorkQueueItems, nativeItemHref, workspaceHref } from "@/lib/relationships"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { accessibleRelationshipIds, accessibleWorkItemIds, requireWorkspacePanel } from "@/lib/workspace-access"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ state?: string }>
}

export default async function FulfilmentPage({ params, searchParams }: PageProps) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    const { workspace, user, access } = await requireWorkspacePanel(workspaceSlug, "fulfilment")
    const allowedRelationshipIds = await accessibleRelationshipIds(access)
    const allowedWorkItemIds = await accessibleWorkItemIds(access, allowedRelationshipIds)
    const allItems = await listWorkQueueItems(workspace.slug, workspace.id)
    const items = allItems.filter((item) => (
        (!allowedWorkItemIds || allowedWorkItemIds.has(item.id) || Boolean(item.synthesized && item.relationship_id && allowedRelationshipIds?.has(item.relationship_id)))
        && (item.lifecycle_phase === "fulfilment" || item.relationship?.lifecycle_phase === "fulfilment")
    ))
    const fulfilmentRelationshipIds = new Set(items.map((item) => item.relationship_id).filter(Boolean))
    const blockedItems = items.filter((item) => item.status === "blocked")
    const dueItems = items.filter((item) => item.due_date && new Date(item.due_date) <= new Date())
    const selectedState = query.state === "blocked" || query.state === "due" ? query.state : null
    const visibleItems = selectedState === "blocked" ? blockedItems : selectedState === "due" ? dueItems : items
    const creatorIds = [...new Set(items.map((item) => item.created_by).filter((id): id is string => Boolean(id)))]
    const creatorsResult = creatorIds.length
        ? await supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", creatorIds)
        : { data: [] as Array<{ user_id: string; username: string; avatar_path: string | null }> }
    const creatorById = new Map((creatorsResult.data ?? []).map((creator) => [creator.user_id, creator]))
    const filterHref = (state: string | null) => workspaceHref(workspace.slug, `work${state ? `?state=${state}` : ""}`)

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl">
                <PanelTabHeader
                    title="Fulfilment"
                    description="Open fulfilment work shared with its relationship record."
                />

                <QuickStats ariaLabel="Fulfilment statistics" items={[
                    { label: "Open work", value: items.length },
                    { label: "Relationships", value: fulfilmentRelationshipIds.size, hideOnMobile: true },
                    { label: "Blocked", value: blockedItems.length },
                    { label: "Due/ready", value: dueItems.length },
                ]} />

                <FilterRail ariaLabel="Filter fulfilment work">
                    <FilterRailLink href={filterHref(null)} selected={!selectedState}>All work <FilterRailCount>{items.length}</FilterRailCount></FilterRailLink>
                    <FilterRailLink href={filterHref("blocked")} selected={selectedState === "blocked"}>Blocked <FilterRailCount>{blockedItems.length}</FilterRailCount></FilterRailLink>
                    <FilterRailLink href={filterHref("due")} selected={selectedState === "due"}>Due/ready <FilterRailCount>{dueItems.length}</FilterRailCount></FilterRailLink>
                </FilterRail>

                <List ariaLabel="Fulfilment work">
                    {visibleItems.length ? visibleItems.map((item) => {
                        const href = nativeItemHref(workspace.slug, item)
                        const status = workItemStatusPresentation(item.status)
                        const date = item.due_date ?? item.planned_start_date ?? item.actual_start_at ?? item.created_at
                        const creator = item.created_by ? creatorById.get(item.created_by) : null
                        const creatorAvatarSrc = creator?.avatar_path && creator.username ? profileAvatarUrl(creator.username, creator.avatar_path) : null
                        const relationshipTitle = item.relationship
                            ? item.relationship.business_name
                                ? `${item.relationship.primary_person_name} – ${item.relationship.business_name}`
                                : item.relationship.primary_person_name
                            : "Workspace work"
                        const actions = [{ label: "Open work item", href }]
                        return <ListItem key={item.id}>
                            <MobileListActionSurface actions={actions} label={`Open actions for ${item.title}`}>
                                <ListPrimaryRow>
                                    <ListTitle href={href} className="flex-1">{item.title}</ListTitle>
                                    {item.is_key_task ? <span className="hidden shrink-0 sm:inline-flex"><SquarePill>Key task</SquarePill></span> : null}
                                    <Status label={status.label} tone={status.tone} className="ml-auto shrink-0" />
                                </ListPrimaryRow>
                                <ListSecondaryRow>
                                    <span className="min-w-0 flex-1 truncate text-neutral-300">{relationshipTitle}</span>
                                    {item.description ? <span className="hidden min-w-0 truncate text-neutral-500 xl:inline">{item.description}</span> : null}
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
                        <p className="text-lg font-semibold">{selectedState ? `No ${selectedState === "due" ? "due or ready" : selectedState} fulfilment work.` : "No fulfilment work yet."}</p>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">{selectedState ? <>Choose another state or <Link href={filterHref(null)} className="text-neutral-200 underline decoration-neutral-600 underline-offset-4 hover:text-white">show all fulfilment work</Link>.</> : "Move a relationship into fulfilment or add fulfilment-stage tasks from a relationship page."}</p>
                    </div>}
                </List>
            </div>
        </main>
    )
}
