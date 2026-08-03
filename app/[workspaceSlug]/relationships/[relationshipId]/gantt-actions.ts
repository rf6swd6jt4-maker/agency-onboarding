"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import { getRelationshipGanttPlan, persistedScheduleMatchesChange, previewScheduleCascade, type RelationshipGanttDependency, type RelationshipGanttItem, type RelationshipGanttPlan, type ScheduleChange } from "@/lib/relationship-gantt"
import { getRelationship } from "@/lib/relationships"
import type { RelationshipPhase } from "@/lib/relationship-phases"

export type GanttMutationResult =
    | { status: "saved"; workItemId?: string; plan?: RelationshipGanttPlan }
    | { status: "cascade_required"; changes: ScheduleChange[] }
    | { status: "stale"; message: string }
    | { status: "invalid"; message: string }

async function requireGantt(slug: string, relationshipId: string, edit = true) {
    const context = await requireWorkspace(slug, edit ? "admin" : "staff")
    const { data: relationship } = await supabaseAdmin.from("relationships")
        .select("id, lifecycle_phase")
        .eq("workspace_id", context.workspace.id).eq("id", relationshipId).maybeSingle()
    if (!relationship) throw new Error("Relationship not found")
    return { ...context, relationship }
}

async function revalidateAffected(slug: string, workspaceId: string, workItemIds: string[]) {
    const { data: links, error } = await supabaseAdmin.from("work_item_relationships")
        .select("relationship_id").eq("workspace_id", workspaceId).in("work_item_id", workItemIds)
    if (error) throw new Error(error.message)
    const relationshipIds = [...new Set((links ?? []).map((link) => link.relationship_id))]
    revalidatePath(`/${slug}/relationships`)
    revalidatePath(`/${slug}/work`)
    revalidatePath(`/${slug}/work-items`)
    for (const id of relationshipIds) revalidatePath(`/${slug}/relationships/${id}`)
    for (const id of workItemIds) revalidatePath(`/${slug}/work-items/${id}`)
}

function errorResult(error: unknown): GanttMutationResult {
    const message = error instanceof Error ? error.message : String(error)
    return message.toLowerCase().includes("stale")
        ? { status: "stale", message: "The plan changed in another tab. Refresh and try again." }
        : { status: "invalid", message }
}

export async function loadGanttPlan(slug: string, relationshipId: string): Promise<RelationshipGanttPlan | null> {
    const { workspace } = await requireGantt(slug, relationshipId, false)
    const relationship = await getRelationship(workspace.id, relationshipId)
    if (!relationship) return null
    return getRelationshipGanttPlan(workspace.slug, relationship)
}

export async function previewGanttScheduleChange(
    slug: string,
    relationshipId: string,
    requested: { id: string; plannedStartDate: string; plannedStartTime?: string | null; dueDate: string; dueTime?: string | null },
): Promise<GanttMutationResult> {
    try {
        const { workspace } = await requireGantt(slug, relationshipId)
        const [itemsResult, dependenciesResult] = await Promise.all([
            supabaseAdmin.from("work_items").select("id, title, status, lifecycle_phase, workflow_role, workflow_action, parent_work_item_id, planned_start_date, planned_start_time, due_date, due_time, actual_start_at, actual_start_has_time, actual_completed_at, actual_completed_has_time, sort_order, created_at, updated_at").eq("workspace_id", workspace.id),
            supabaseAdmin.from("work_item_dependencies").select("work_item_id, depends_on_work_item_id, source").eq("workspace_id", workspace.id),
        ])
        const items: RelationshipGanttItem[] = (itemsResult.data ?? []).map((item) => ({
            id: item.id, title: item.title, status: item.status, lifecyclePhase: item.lifecycle_phase,
            workflowRole: item.workflow_role, workflowAction: item.workflow_action,
            parentWorkItemId: item.parent_work_item_id, plannedStartDate: item.planned_start_date,
            plannedStartTime: item.planned_start_time, dueDate: item.due_date, dueTime: item.due_time,
            actualStartAt: item.actual_start_at, actualStartHasTime: Boolean(item.actual_start_has_time),
            actualCompletedAt: item.actual_completed_at, actualCompletedHasTime: Boolean(item.actual_completed_has_time),
            sortOrder: item.sort_order, createdAt: item.created_at, updatedAt: item.updated_at, section: "relationship", assignees: [],
        }))
        const dependencies: RelationshipGanttDependency[] = (dependenciesResult.data ?? []).map((edge) => ({
            workItemId: edge.work_item_id, dependsOnWorkItemId: edge.depends_on_work_item_id,
            source: edge.source, external: false,
        }))
        const changes = previewScheduleCascade(items, dependencies, requested)
        if (!changes.length) return { status: "invalid", message: "Work item not found" }
        return { status: "cascade_required", changes }
    } catch (error) {
        return errorResult(error)
    }
}

export async function applyGanttScheduleChanges(
    slug: string,
    relationshipId: string,
    changes: ScheduleChange[],
): Promise<GanttMutationResult> {
    try {
        const { workspace } = await requireGantt(slug, relationshipId)
        const payload = changes.map((change) => ({
            id: change.id,
            planned_start_date: change.plannedStartDate,
            planned_start_time: change.plannedStartTime,
            due_date: change.dueDate,
            due_time: change.dueTime,
            expected_updated_at: change.expectedUpdatedAt,
        }))
        const { data: appliedRows, error } = await supabaseAdmin.rpc("apply_gantt_schedule_plan", { p_workspace_id: workspace.id, p_changes: payload })
        if (error) throw new Error(error.message)
        const requestedIds = [...new Set(changes.map((change) => change.id))]
        const appliedIds = new Set(((appliedRows ?? []) as Array<{ work_item_id: string }>).map((row) => String(row.work_item_id)))
        if (appliedIds.size !== requestedIds.length || requestedIds.some((id) => !appliedIds.has(id))) {
            throw new Error("The database did not confirm every schedule update. Reload before making further changes.")
        }
        const { data: persistedRows, error: verificationError } = await supabaseAdmin.from("work_items")
            .select("id, planned_start_date, planned_start_time, due_date, due_time")
            .eq("workspace_id", workspace.id).in("id", requestedIds)
        if (verificationError) throw new Error(verificationError.message)
        const persistedById = new Map((persistedRows ?? []).map((row) => [row.id, row]))
        const unverified = changes.find((change) => {
            const persisted = persistedById.get(change.id)
            return !persisted || !persistedScheduleMatchesChange(persisted, change)
        })
        if (unverified) throw new Error(`The saved schedule for ${unverified.title} could not be verified. Refresh and try again.`)
        await revalidateAffected(slug, workspace.id, changes.map((change) => change.id))
        const relationship = await getRelationship(workspace.id, relationshipId)
        const plan = relationship ? await getRelationshipGanttPlan(workspace.slug, relationship) : undefined
        return { status: "saved", plan }
    } catch (error) {
        return errorResult(error)
    }
}

export async function createGanttWorkItem(
    slug: string,
    relationshipId: string,
    input: { title: string; parentWorkItemId: string | null; startDate: string | null },
): Promise<GanttMutationResult> {
    try {
        const { workspace, user, relationship } = await requireGantt(slug, relationshipId)
        const title = input.title.trim()
        if (!title) return { status: "invalid", message: "Enter a work-item title" }
        let lifecyclePhase = relationship.lifecycle_phase as RelationshipPhase
        if (input.parentWorkItemId) {
            const { data: parent } = await supabaseAdmin.from("work_items").select("lifecycle_phase").eq("workspace_id", workspace.id).eq("id", input.parentWorkItemId).maybeSingle()
            if (!parent) return { status: "invalid", message: "Parent work item not found" }
            lifecyclePhase = parent.lifecycle_phase
        }
        const { data, error } = await supabaseAdmin.rpc("create_relationship_gantt_item", {
            p_workspace_id: workspace.id,
            p_relationship_id: relationshipId,
            p_title: title,
            p_lifecycle_phase: lifecyclePhase,
            p_parent_work_item_id: input.parentWorkItemId,
            p_start_date: input.startDate,
            p_due_date: input.startDate,
            p_created_by: user.id,
        })
        if (error) throw new Error(error.message)
        await revalidateAffected(slug, workspace.id, [String(data)])
        return { status: "saved", workItemId: String(data) }
    } catch (error) {
        return errorResult(error)
    }
}

export async function moveGanttWorkItem(
    slug: string,
    relationshipId: string,
    input: { workItemId: string; parentWorkItemId: string | null; sortOrder: number; expectedUpdatedAt: string },
): Promise<GanttMutationResult> {
    try {
        const { workspace } = await requireGantt(slug, relationshipId)
        const { error } = await supabaseAdmin.rpc("move_gantt_work_item", {
            p_workspace_id: workspace.id,
            p_work_item_id: input.workItemId,
            p_parent_work_item_id: input.parentWorkItemId,
            p_sort_order: input.sortOrder,
            p_expected_updated_at: input.expectedUpdatedAt,
        })
        if (error) throw new Error(error.message)
        await revalidateAffected(slug, workspace.id, [input.workItemId])
        return { status: "saved" }
    } catch (error) {
        return errorResult(error)
    }
}

export async function createGanttDependency(
    slug: string,
    relationshipId: string,
    workItemId: string,
    dependsOnWorkItemId: string,
): Promise<GanttMutationResult> {
    try {
        const { workspace, user } = await requireGantt(slug, relationshipId)
        if (workItemId === dependsOnWorkItemId) return { status: "invalid", message: "A work item cannot depend on itself" }

        // Reject cycles: the new edge means workItemId waits for dependsOnWorkItemId,
        // so it closes a loop if dependsOnWorkItemId already (transitively) depends on
        // workItemId. Walk the prerequisite chain from dependsOnWorkItemId and look
        // for workItemId. Consider every edge (manual and parent_auto) to be safe.
        const { data: edges } = await supabaseAdmin.from("work_item_dependencies")
            .select("work_item_id, depends_on_work_item_id").eq("workspace_id", workspace.id)
        const prerequisites = new Map<string, string[]>()
        for (const edge of edges ?? []) prerequisites.set(edge.work_item_id, [...(prerequisites.get(edge.work_item_id) ?? []), edge.depends_on_work_item_id])
        const stack = [dependsOnWorkItemId]
        const seen = new Set<string>()
        while (stack.length) {
            const current = stack.pop()!
            if (current === workItemId) return { status: "invalid", message: "That dependency would create a cycle" }
            if (seen.has(current)) continue
            seen.add(current)
            for (const next of prerequisites.get(current) ?? []) stack.push(next)
        }

        const { error } = await supabaseAdmin.from("work_item_dependencies").insert({
            workspace_id: workspace.id, work_item_id: workItemId,
            depends_on_work_item_id: dependsOnWorkItemId, source: "manual", created_by: user.id,
        })
        if (error) throw new Error(error.message)
        await revalidateAffected(slug, workspace.id, [workItemId, dependsOnWorkItemId])
        return { status: "saved" }
    } catch (error) {
        return errorResult(error)
    }
}

export async function removeGanttDependency(
    slug: string,
    relationshipId: string,
    workItemId: string,
    dependsOnWorkItemId: string,
): Promise<GanttMutationResult> {
    try {
        const { workspace } = await requireGantt(slug, relationshipId)
        const { error } = await supabaseAdmin.from("work_item_dependencies").delete()
            .eq("workspace_id", workspace.id).eq("work_item_id", workItemId)
            .eq("depends_on_work_item_id", dependsOnWorkItemId).eq("source", "manual")
        if (error) throw new Error(error.message)
        await revalidateAffected(slug, workspace.id, [workItemId, dependsOnWorkItemId])
        return { status: "saved" }
    } catch (error) {
        return errorResult(error)
    }
}
