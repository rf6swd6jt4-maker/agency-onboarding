import { supabaseAdmin } from "@/lib/supabase/admin"
import { createUploadSignedUrls } from "@/lib/onboarding/uploads"
import { phaseLabel, type RelationshipPhase } from "@/lib/relationship-phases"
import type { RelationshipRecord, RelationshipWorkItemStatus } from "@/lib/relationships"
export { addCalendarDays, dateDay, dayDate, effectiveGanttRanges, ganttTimelineRange, persistedScheduleMatchesChange, previewScheduleCascade, rangeContainsRange } from "@/lib/relationship-gantt-schedule"
export type { ScheduleChange } from "@/lib/relationship-gantt-schedule"

export type GanttPerson = { userId: string; username: string; avatarUrl: string | null }

export type RelationshipGanttItem = {
    id: string
    title: string
    status: RelationshipWorkItemStatus
    lifecyclePhase: RelationshipPhase
    workflowRole: string
    workflowAction: string | null
    parentWorkItemId: string | null
    plannedStartDate: string | null
    plannedStartTime: string | null
    dueDate: string | null
    dueTime: string | null
    actualStartAt: string | null
    actualStartHasTime: boolean
    actualCompletedAt: string | null
    actualCompletedHasTime: boolean
    sortOrder: number
    createdAt: string
    updatedAt: string
    section: "relationship" | "shared"
    assignees: GanttPerson[]
}

export type RelationshipGanttDependency = {
    workItemId: string
    dependsOnWorkItemId: string
    source: "manual" | "parent_auto"
    external: boolean
}

export type RelationshipGanttMilestone = {
    id: string
    title: string
    occurredAt: string
    kind: "relationship_started" | "client_invoiced" | "onboarding_completed" | "client_fulfilled"
    href: string | null
}

export type RelationshipGanttPlan = {
    items: RelationshipGanttItem[]
    externalItems: RelationshipGanttItem[]
    dependencies: RelationshipGanttDependency[]
    milestones: RelationshipGanttMilestone[]
}

type RawItem = {
    id: string
    title: string
    status: RelationshipWorkItemStatus
    lifecycle_phase: RelationshipPhase
    workflow_role: string
    workflow_action: string | null
    parent_work_item_id: string | null
    planned_start_date: string | null
    planned_start_time: string | null
    due_date: string | null
    due_time: string | null
    actual_start_at: string | null
    actual_start_has_time: boolean
    actual_completed_at: string | null
    actual_completed_has_time: boolean
    sort_order: number
    created_at: string
    updated_at: string
    native_key: string | null
    native_kind: string | null
}

type RawDependency = { work_item_id: string; depends_on_work_item_id: string; source: "manual" | "parent_auto" }

export async function getRelationshipGanttPlan(_workspaceSlug: string, relationship: RelationshipRecord): Promise<RelationshipGanttPlan> {
    const [itemsResult, linksResult, dependenciesResult, assigneesResult, sessionsResult] = await Promise.all([
        supabaseAdmin.from("work_items").select("id, title, status, lifecycle_phase, workflow_role, workflow_action, parent_work_item_id, planned_start_date, planned_start_time, due_date, due_time, actual_start_at, actual_start_has_time, actual_completed_at, actual_completed_has_time, sort_order, created_at, updated_at, native_key, native_kind").eq("workspace_id", relationship.workspace_id),
        supabaseAdmin.from("work_item_relationships").select("work_item_id, relationship_id, link_source, inherited_from_work_item_id").eq("workspace_id", relationship.workspace_id),
        supabaseAdmin.from("work_item_dependencies").select("work_item_id, depends_on_work_item_id, source").eq("workspace_id", relationship.workspace_id),
        supabaseAdmin.from("work_item_assignees").select("work_item_id, user_id").eq("workspace_id", relationship.workspace_id),
        supabaseAdmin.from("relationship_onboarding_sessions").select("id, status, created_at, completed_at").eq("workspace_id", relationship.workspace_id).eq("relationship_id", relationship.id).order("created_at"),
    ])

    const rawItems = (itemsResult.data ?? []) as RawItem[]
    const rawById = new Map(rawItems.map((item) => [item.id, item]))
    const links = (linksResult.data ?? []) as Array<{ work_item_id: string; relationship_id: string; link_source: "explicit" | "inherited"; inherited_from_work_item_id: string | null }>
    const linksByItem = new Map<string, typeof links>()
    for (const link of links) linksByItem.set(link.work_item_id, [...(linksByItem.get(link.work_item_id) ?? []), link])
    const linkedIds = new Set(links.filter((link) => link.relationship_id === relationship.id).map((link) => link.work_item_id))

    // Include descendants of linked roots for compatibility with work created before inheritance provenance.
    let expanded = true
    while (expanded) {
        expanded = false
        for (const item of rawItems) {
            if (item.parent_work_item_id && linkedIds.has(item.parent_work_item_id) && !linkedIds.has(item.id)) {
                linkedIds.add(item.id)
                expanded = true
            }
        }
    }

    const rootFor = (item: RawItem) => {
        let current = item
        const seen = new Set<string>()
        while (current.parent_work_item_id && !seen.has(current.id)) {
            seen.add(current.id)
            const parent = rawById.get(current.parent_work_item_id)
            if (!parent) break
            current = parent
        }
        return current
    }

    const includedIds = new Set(linkedIds)
    const relevantDependencies = ((dependenciesResult.data ?? []) as RawDependency[]).filter((edge) => linkedIds.has(edge.work_item_id))
    const externalIds = new Set(relevantDependencies.map((edge) => edge.depends_on_work_item_id).filter((id) => !linkedIds.has(id)))
    for (const id of externalIds) includedIds.add(id)

    const relevantAssignees = (assigneesResult.data ?? []).filter((row) => includedIds.has(row.work_item_id))
    const userIds = [...new Set(relevantAssignees.map((row) => row.user_id))]
    const profilesResult = userIds.length
        ? await supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", userIds)
        : { data: [] }
    const profiles = profilesResult.data ?? []
    const avatarUrls = await createUploadSignedUrls(profiles.map((profile) => profile.avatar_path).filter((path): path is string => Boolean(path)))
    const peopleById = new Map(profiles.map((profile) => [profile.user_id, {
        userId: profile.user_id,
        username: profile.username,
        avatarUrl: profile.avatar_path ? avatarUrls.get(profile.avatar_path) ?? null : null,
    }]))
    const peopleByItem = new Map<string, GanttPerson[]>()
    for (const row of relevantAssignees) {
        const person = peopleById.get(row.user_id)
        if (person) peopleByItem.set(row.work_item_id, [...(peopleByItem.get(row.work_item_id) ?? []), person])
    }

    const mapItem = (item: RawItem, section: "relationship" | "shared"): RelationshipGanttItem => ({
        id: item.id,
        title: item.title,
        status: item.status,
        lifecyclePhase: item.lifecycle_phase,
        workflowRole: item.workflow_role,
        workflowAction: item.workflow_action,
        parentWorkItemId: item.parent_work_item_id,
        plannedStartDate: item.planned_start_date,
        plannedStartTime: item.planned_start_time,
        dueDate: item.due_date,
        dueTime: item.due_time,
        actualStartAt: item.actual_start_at,
        // Canonical onboarding historically stored exact ISO values before the
        // presence flags existed. Their source is still timestamp-accurate.
        actualStartHasTime: Boolean(item.actual_start_has_time || (item.native_kind === "onboarding_step" && item.actual_start_at)),
        actualCompletedAt: item.actual_completed_at,
        actualCompletedHasTime: Boolean(item.actual_completed_has_time || (item.native_kind === "onboarding_step" && item.actual_completed_at)),
        sortOrder: item.sort_order,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        section,
        assignees: peopleByItem.get(item.id) ?? [],
    })

    const items = rawItems.filter((item) => linkedIds.has(item.id)).map((item) => {
        const root = rootFor(item)
        const rootRelationshipIds = new Set((linksByItem.get(root.id) ?? []).map((link) => link.relationship_id))
        return mapItem(item, rootRelationshipIds.size === 1 && rootRelationshipIds.has(relationship.id) ? "relationship" : "shared")
    })
    const externalItems = rawItems.filter((item) => externalIds.has(item.id)).map((item) => mapItem(item, "shared"))

    const milestones: RelationshipGanttMilestone[] = [
        { id: `relationship-started-${relationship.id}`, title: "Relationship Started", occurredAt: relationship.created_at, kind: "relationship_started", href: null },
    ]
    const soldStage = rawItems.find((item) => item.native_key === `${relationship.id}:potential_client` && item.actual_completed_at)
    if (soldStage?.actual_completed_at) milestones.push({ id: `client-sold-${relationship.id}`, title: "Client Sold", occurredAt: soldStage.actual_completed_at, kind: "client_invoiced", href: null })
    for (const session of sessionsResult.data ?? []) {
        if (session.status === "completed" && session.completed_at) milestones.push({ id: `onboarding-complete-${session.id}`, title: "Onboarding Completed", occurredAt: session.completed_at, kind: "onboarding_completed", href: null })
    }
    const fulfilmentStage = rawItems.find((item) => item.native_key === `${relationship.id}:fulfilment` && item.actual_completed_at)
    if (fulfilmentStage?.actual_completed_at) milestones.push({ id: `client-fulfilled-${relationship.id}`, title: "Client Fulfilled", occurredAt: fulfilmentStage.actual_completed_at, kind: "client_fulfilled", href: null })

    return {
        items,
        externalItems,
        dependencies: relevantDependencies.map((edge) => ({ workItemId: edge.work_item_id, dependsOnWorkItemId: edge.depends_on_work_item_id, source: edge.source, external: externalIds.has(edge.depends_on_work_item_id) })),
        // Preserve every event. The chart deliberately resolves visual overlap
        // at its active scale, with the most recent event painted on top.
        milestones: milestones.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)),
    }
}

export function ganttPhaseLabel(phase: RelationshipPhase) {
    return phaseLabel(phase)
}
