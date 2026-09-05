import { AdminPanelNav } from "@/components/admin/AdminPanelNav"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { MobileListActionSurface } from "@/components/list/MobileCardActionSurface"
import { workItemStatusPresentation } from "@/components/list/work-item-presentation"
import { FilterRail, FilterRailCount, FilterRailLink } from "@/components/panel/FilterRail"
import { InstantFilterCount, InstantFilterResults } from "@/components/panel/InstantFilterResults"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { QuickStats } from "@/components/panel/QuickStats"
import { Assignee, SquarePill, Status } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { listMaintenanceWorkItems, MAINTENANCE_CATEGORIES, maintenanceCategoryLabel, type MaintenanceCategory } from "@/lib/admin/maintenance"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"
import { workItemPriorityLabel } from "@/lib/work-item-priority"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ category?: string; state?: string }>
}

export default async function MaintenancePage({ params, searchParams }: PageProps) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const [items, membershipResult] = await Promise.all([
        listMaintenanceWorkItems(workspace.id),
        supabaseAdmin.from("workspace_memberships").select("user_id, role").eq("workspace_id", workspace.id).in("role", ["owner", "admin"]),
    ])
    const memberships = membershipResult.data ?? []
    const ids = memberships.map((membership) => membership.user_id)
    const { data: profiles } = ids.length ? await supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", ids) : { data: [] }
    const people = new Map((profiles ?? []).map((profile) => [profile.user_id, {
        name: profile.username,
        avatarSrc: profile.avatar_path ? profileAvatarUrl(profile.username, profile.avatar_path) : null,
    }]))
    const selectedCategory = MAINTENANCE_CATEGORIES.includes(query.category as MaintenanceCategory) ? query.category as MaintenanceCategory : null
    const selectedState = query.state === "resolved" ? "resolved" : "open"
    const openItems = items.filter((item) => !["done", "canceled"].includes(item.status))
    const resolvedItems = items.filter((item) => ["done", "canceled"].includes(item.status))
    const criticalItems = openItems.filter((item) => item.severity === "critical")
    const occurrences = items.reduce((total, item) => total + item.occurrence_count, 0)
    const filterHref = (category: MaintenanceCategory | null, state = selectedState) => {
        const params = new URLSearchParams({ state })
        if (category) params.set("category", category)
        return `/${workspace.slug}/admin/maintenance?${params}`
    }
    const filterDefinitions = [{ param: "state", defaultValue: "open" }, { param: "category" }]
    const filterValues = items.map((item) => ({
        id: item.id,
        values: {
            state: ["done", "canceled"].includes(item.status) ? "resolved" : "open",
            category: item.maintenance_category,
        },
    }))
    const filterValuesById = new Map(filterValues.map((item) => [item.id, item.values]))

    return <main className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-7xl">
            <PanelTabHeader
                title="Maintenance Queue"
                description="Actionable automation failures deduplicated into accountable Work Items. Repeated fingerprints update the open item; recurrence after resolution creates a new one."
                tabs={<AdminPanelNav workspaceSlug={workspace.slug} active="maintenance" />}
            />

            <QuickStats ariaLabel="Maintenance statistics" items={[
                { label: "Open", value: openItems.length },
                { label: "Resolved", value: resolvedItems.length },
                { label: "Occurrences", value: occurrences, hideOnMobile: true },
                { label: "Critical", value: criticalItems.length },
            ]} />
            <FilterRail ariaLabel="Filter maintenance by state">
                <FilterRailLink href={filterHref(selectedCategory, "open")} selected={selectedState === "open"} instant={{ param: "state", value: "open", defaultValue: "open" }}>Open <FilterRailCount><InstantFilterCount filters={filterDefinitions} items={filterValues} target={{ param: "state", value: "open" }} /></FilterRailCount></FilterRailLink>
                <FilterRailLink href={filterHref(selectedCategory, "resolved")} selected={selectedState === "resolved"} instant={{ param: "state", value: "resolved", defaultValue: "open" }}>Resolved <FilterRailCount><InstantFilterCount filters={filterDefinitions} items={filterValues} target={{ param: "state", value: "resolved" }} /></FilterRailCount></FilterRailLink>
            </FilterRail>
            <FilterRail ariaLabel="Filter maintenance by category" spacing="tight">
                <FilterRailLink href={filterHref(null)} selected={!selectedCategory} instant={{ param: "category", value: null }}>All categories <FilterRailCount><InstantFilterCount filters={filterDefinitions} items={filterValues} target={{ param: "category", value: null }} /></FilterRailCount></FilterRailLink>
                {MAINTENANCE_CATEGORIES.map((category) => <FilterRailLink key={category} href={filterHref(category)} selected={selectedCategory === category} instant={{ param: "category", value: category }}>{maintenanceCategoryLabel(category)} <FilterRailCount><InstantFilterCount filters={filterDefinitions} items={filterValues} target={{ param: "category", value: category }} /></FilterRailCount></FilterRailLink>)}
            </FilterRail>

            <List ariaLabel="Maintenance queue">
                <InstantFilterResults filters={filterDefinitions} items={items.map((item) => {
                    const href = `/${workspace.slug}/work-items/${item.id}`
                    const status = workItemStatusPresentation(item.status)
                    const assignees = item.assignee_ids.map((id) => ({ id, ...(people.get(id) ?? { name: "Admin", avatarSrc: null }) }))
                    const actions = [
                        { label: "Open work item", href },
                        item.native_href ? { label: "Open source", href: item.native_href } : null,
                        { label: "Copy item ID", copyText: item.id },
                    ]
                    return { id: item.id, values: filterValuesById.get(item.id)!, content: <ListItem className={item.severity === "critical" ? "bg-red-950/[0.08]" : ""} detailPreview={{
                        category: "Work item",
                        reference: shortId(item.id),
                        title: item.title,
                        updated: formatRelativeTime(item.last_occurred_at),
                    }}>
                        <MobileListActionSurface actions={actions} label={`Open actions for ${item.title}`}>
                            <ListPrimaryRow>
                                <ListTitle href={href} className="flex-1">{item.title}</ListTitle>
                                <SquarePill tone={item.severity === "critical" ? "red" : "yellow"} className="shrink-0 capitalize">{item.severity}</SquarePill>
                                <span className="hidden shrink-0 sm:inline-flex"><SquarePill>Admin</SquarePill></span>
                                <Status label={status.label} tone={status.tone} className="ml-auto shrink-0" />
                            </ListPrimaryRow>
                            <ListSecondaryRow>
                                <span className="shrink-0 text-neutral-400">{maintenanceCategoryLabel(item.maintenance_category)}</span>
                                <span className="hidden shrink-0 text-neutral-500 md:inline">{workItemPriorityLabel(item.priority)}</span>
                                <span className="hidden shrink-0 text-neutral-500 sm:inline">{item.occurrence_count} occurrence{item.occurrence_count === 1 ? "" : "s"}</span>
                                <span className="hidden shrink-0 text-neutral-500 xl:inline">First {formatRelativeTime(item.first_occurred_at)}</span>
                                {!assignees.length ? <span className="hidden shrink-0 text-neutral-600 lg:inline">Unassigned</span> : null}
                                <ListTrailing>
                                    <span className="font-mono text-neutral-500">{shortId(item.id)}</span>
                                    <span className="whitespace-nowrap text-neutral-500">{formatRelativeTime(item.last_occurred_at)}</span>
                                    {assignees[0] ? <span className="inline-flex shrink-0 items-center gap-1" aria-label={`Assigned to ${assignees.map((assignee) => assignee.name).join(", ")}`}>
                                        <Assignee userId={assignees[0].id} name={assignees[0].name} avatarSrc={assignees[0].avatarSrc} compact compactSize="md" />
                                        {assignees.length > 1 ? <span className="text-xs text-neutral-500">+{assignees.length - 1}</span> : null}
                                    </span> : null}
                                    <ListActionMenu actions={actions} className="hidden sm:block" />
                                </ListTrailing>
                            </ListSecondaryRow>
                        </MobileListActionSurface>
                    </ListItem> }
                })} empty={<div className="p-6">
                    <p className="text-lg font-semibold">No maintenance items match these filters.</p>
                    <p className="mt-2 text-sm text-neutral-400">Choose another state or category to broaden this queue.</p>
                </div>} />
            </List>
        </div>
    </main>
}
