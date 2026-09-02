"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { accessibleRelationshipIds, accessibleWorkItemIds, requireWorkspaceAccess, workspaceAccessCanWorkItem, workspaceAccessHasCapability } from "@/lib/workspace-access"
import { workItemHref } from "@/lib/relationships"

async function requireWorkItem(slug: string, workItemId: string) {
    const context = await requireWorkspaceAccess(slug)
    const { data: item } = await supabaseAdmin.from("work_items")
        .select("id, status, native_kind, parent_work_item_id, area, visibility, execution_owner_id, actual_completed_at, actual_completed_has_time, updated_at")
        .eq("workspace_id", context.workspace.id).eq("id", workItemId).maybeSingle()
    if (!item) throw new Error("Work item not found")
    if (context.role === "staff" && (
        item.area === "admin"
        || item.visibility === "admins_only"
        || (!workspaceAccessHasCapability(context.access, "onboarding.manage") && !workspaceAccessHasCapability(context.access, "fulfilment.manage"))
        || !await workspaceAccessCanWorkItem(context.access, workItemId)
    )) throw new Error("Work item not found")
    return { ...context, item }
}

function refreshWorkItem(slug: string, workItemId: string) {
    revalidatePath(workItemHref(slug, workItemId))
    revalidatePath(`/${slug}/work`)
    revalidatePath(`/${slug}/admin`)
}

async function refreshScheduleSurfaces(slug: string, workspaceId: string, workItemId: string) {
    refreshWorkItem(slug, workItemId)
    revalidatePath(`/${slug}/work-items`)
    revalidatePath(`/${slug}/relationships`)
    const { data: links, error } = await supabaseAdmin.from("work_item_relationships")
        .select("relationship_id").eq("workspace_id", workspaceId).eq("work_item_id", workItemId)
    if (error) throw new Error(error.message)
    for (const relationshipId of new Set((links ?? []).map((link) => link.relationship_id))) {
        revalidatePath(`/${slug}/relationships/${relationshipId}`)
    }
}

export async function updateWorkItemSchedule(slug: string, workItemId: string, startDate: string | null, startTime: string | null, endDate: string | null, endTime: string | null, completed: boolean, started = false, actualStartIso?: string | null, actualEndIso?: string | null) {
    const { workspace } = await requireWorkItem(slug, workItemId)
    const datePattern = /^\d{4}-\d{2}-\d{2}$/
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/
    if (startDate && !datePattern.test(startDate) || endDate && !datePattern.test(endDate)) throw new Error("Invalid schedule date")
    if (startTime && !timePattern.test(startTime) || endTime && !timePattern.test(endTime)) throw new Error("Invalid schedule time")
    if (actualStartIso && Number.isNaN(Date.parse(actualStartIso)) || actualEndIso && Number.isNaN(Date.parse(actualEndIso))) throw new Error("Invalid actual schedule timestamp")
    const values = completed ? {
        actual_start_at: startDate ? actualStartIso ?? `${startDate}T${startTime || "00:00"}:00.000Z` : null,
        actual_start_has_time: Boolean(startDate && startTime),
        actual_completed_at: endDate ? actualEndIso ?? `${endDate}T${endTime || "00:00"}:00.000Z` : null,
        actual_completed_has_time: Boolean(endDate && endTime),
    } : started ? {
        actual_start_at: startDate ? actualStartIso ?? `${startDate}T${startTime || "00:00"}:00.000Z` : null,
        actual_start_has_time: Boolean(startDate && startTime),
        due_date: endDate || null,
        due_time: endDate ? endTime || null : null,
    } : { planned_start_date: startDate || null, planned_start_time: startDate ? startTime || null : null, due_date: endDate || null, due_time: endDate ? endTime || null : null }
    const { error } = await supabaseAdmin.from("work_items").update(values).eq("workspace_id", workspace.id).eq("id", workItemId)
    if (error) throw new Error(error.message)
    await refreshScheduleSurfaces(slug, workspace.id, workItemId)
}

export async function updateWorkItemDescription(slug: string, workItemId: string, description: string, expectedUpdatedAt: string): Promise<{ ok: true; version: string } | { ok: false; error: string; conflict?: boolean; version?: string }> {
    const { workspace, item } = await requireWorkItem(slug, workItemId)
    if (expectedUpdatedAt && item.updated_at !== expectedUpdatedAt) {
        return { ok: false, conflict: true, version: item.updated_at, error: "Another user changed this work item. Refresh to review their version before retrying your description." }
    }
    const value = description.trim()
    const nextVersion = new Date().toISOString()
    let update = supabaseAdmin.from("work_items").update({ description: value || null, updated_at: nextVersion }).eq("workspace_id", workspace.id).eq("id", workItemId)
    if (expectedUpdatedAt) update = update.eq("updated_at", expectedUpdatedAt)
    const { data: saved, error } = await update.select("updated_at").maybeSingle()
    if (error) return { ok: false, error: `The database rejected this work-item change (${error.code}): ${error.message}` }
    if (!saved) {
        const { data: latest } = await supabaseAdmin.from("work_items").select("updated_at").eq("workspace_id", workspace.id).eq("id", workItemId).maybeSingle()
        return { ok: false, conflict: true, version: latest?.updated_at, error: "Another user changed this work item. Refresh to review their version before retrying your description." }
    }
    refreshWorkItem(slug, workItemId)
    return { ok: true, version: saved.updated_at }
}

export async function updateWorkItemAssignees(slug: string, workItemId: string, assigneeIds: string[], executionOwnerId: string | null) {
    const { workspace, user, item } = await requireWorkItem(slug, workItemId)
    const uniqueIds = [...new Set([...assigneeIds, ...(executionOwnerId ? [executionOwnerId] : [])])]
    let membersQuery = supabaseAdmin.from("workspace_memberships").select("user_id").eq("workspace_id", workspace.id)
    if (item.visibility === "admins_only") membersQuery = membersQuery.in("role", ["owner", "admin"])
    const { data: members } = await membersQuery
    const memberIds = new Set((members ?? []).map((row) => row.user_id))
    if (uniqueIds.some((id) => !memberIds.has(id))) throw new Error("Assignees must belong to this workspace")
    const { count: keyResultLinkCount } = await supabaseAdmin.from("workspace_okr_work_items").select("key_result_id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("work_item_id", workItemId)
    if (keyResultLinkCount && !executionOwnerId) throw new Error("KR-linked work requires an execution owner")
    if (uniqueIds.length) {
        const { error } = await supabaseAdmin.from("work_item_assignees").upsert(uniqueIds.map((userId) => ({ workspace_id: workspace.id, work_item_id: workItemId, user_id: userId, assigned_by: user.id })), { onConflict: "work_item_id,user_id" })
        if (error) throw new Error(error.message)
    }
    const { error: ownerError } = await supabaseAdmin.from("work_items").update({ execution_owner_id: executionOwnerId }).eq("workspace_id", workspace.id).eq("id", workItemId)
    if (ownerError) throw new Error(ownerError.message)
    let removedQuery = supabaseAdmin.from("work_item_assignees").delete().eq("workspace_id", workspace.id).eq("work_item_id", workItemId)
    if (uniqueIds.length) removedQuery = removedQuery.not("user_id", "in", `(${uniqueIds.join(",")})`)
    const { error: removeError } = await removedQuery
    if (removeError) throw new Error(removeError.message)
    refreshWorkItem(slug, workItemId)
}

export async function updateWorkItemParent(slug: string, workItemId: string, parentWorkItemId: string | null, waitForParent: boolean) {
    const { workspace, user, item, access } = await requireWorkItem(slug, workItemId)
    const [{ data: items }, { data: dependencyEdges }] = await Promise.all([
        supabaseAdmin.from("work_items").select("id, parent_work_item_id, status").eq("workspace_id", workspace.id).eq("visibility", item.visibility),
        supabaseAdmin.from("work_item_dependencies").select("work_item_id, depends_on_work_item_id").eq("workspace_id", workspace.id).neq("work_item_id", workItemId),
    ])
    const allowedWorkItemIds = await accessibleWorkItemIds(access)
    const scopedItems = (items ?? []).filter((row) => !allowedWorkItemIds || allowedWorkItemIds.has(row.id))
    const itemIds = new Set(scopedItems.map((row) => row.id))
    if (parentWorkItemId && (!itemIds.has(parentWorkItemId) || parentWorkItemId === workItemId)) throw new Error("Invalid parent")
    const children = new Map<string, string[]>()
    for (const row of scopedItems) if (row.parent_work_item_id) children.set(row.parent_work_item_id, [...(children.get(row.parent_work_item_id) ?? []), row.id])
    const queue = [...(children.get(workItemId) ?? [])]
    const descendants = new Set<string>()
    while (queue.length) { const id = queue.pop()!; if (descendants.has(id)) continue; descendants.add(id); queue.push(...(children.get(id) ?? [])) }
    if (parentWorkItemId && descendants.has(parentWorkItemId)) throw new Error("A child cannot become its ancestor's parent")
    if (item.status === "doing" && parentWorkItemId && waitForParent && scopedItems.find((row) => row.id === parentWorkItemId)?.status !== "done") throw new Error("An in-progress task cannot wait for an unfinished parent")
    if (parentWorkItemId && waitForParent) {
        const prerequisites = new Map<string, string[]>()
        for (const edge of dependencyEdges ?? []) prerequisites.set(edge.work_item_id, [...(prerequisites.get(edge.work_item_id) ?? []), edge.depends_on_work_item_id])
        const seen = new Set<string>(); const dependencyQueue = [parentWorkItemId]
        while (dependencyQueue.length) { const id = dependencyQueue.pop()!; if (id === workItemId) throw new Error("Waiting for this parent would create a dependency cycle"); if (seen.has(id)) continue; seen.add(id); dependencyQueue.push(...(prerequisites.get(id) ?? [])) }
    }

    const { error } = await supabaseAdmin.from("work_items").update({ parent_work_item_id: parentWorkItemId }).eq("workspace_id", workspace.id).eq("id", workItemId)
    if (error) throw new Error(error.message)
    await supabaseAdmin.from("work_item_dependencies").delete().eq("workspace_id", workspace.id).eq("work_item_id", workItemId).eq("source", "parent_auto")
    if (parentWorkItemId && waitForParent) {
        const { error: dependencyError } = await supabaseAdmin.from("work_item_dependencies").upsert({ workspace_id: workspace.id, work_item_id: workItemId, depends_on_work_item_id: parentWorkItemId, source: "parent_auto", created_by: user.id })
        if (dependencyError) throw new Error(dependencyError.message)
    }
    refreshWorkItem(slug, workItemId)
}

export async function updateWorkItemDependencies(slug: string, workItemId: string, dependencyIds: string[]) {
    const { workspace, user, item, access } = await requireWorkItem(slug, workItemId)
    const uniqueIds = [...new Set(dependencyIds)].filter((id) => id !== workItemId && id !== item.parent_work_item_id)
    const [{ data: items }, { data: edges }] = await Promise.all([
        supabaseAdmin.from("work_items").select("id, status").eq("workspace_id", workspace.id).eq("visibility", item.visibility),
        supabaseAdmin.from("work_item_dependencies").select("work_item_id, depends_on_work_item_id").eq("workspace_id", workspace.id).neq("work_item_id", workItemId),
    ])
    const allowedWorkItemIds = await accessibleWorkItemIds(access)
    const statuses = new Map((items ?? []).filter((row) => !allowedWorkItemIds || allowedWorkItemIds.has(row.id)).map((row) => [row.id, row.status]))
    if (uniqueIds.some((id) => !statuses.has(id))) throw new Error("Dependencies must belong to this workspace")
    if (item.status === "doing" && uniqueIds.some((id) => statuses.get(id) !== "done")) throw new Error("An in-progress task cannot gain an unfinished dependency")
    const prerequisites = new Map<string, string[]>()
    for (const edge of edges ?? []) prerequisites.set(edge.work_item_id, [...(prerequisites.get(edge.work_item_id) ?? []), edge.depends_on_work_item_id])
    for (const candidate of uniqueIds) {
        const seen = new Set<string>(); const queue = [candidate]
        while (queue.length) { const id = queue.pop()!; if (id === workItemId) throw new Error("Dependencies cannot contain a cycle"); if (seen.has(id)) continue; seen.add(id); queue.push(...(prerequisites.get(id) ?? [])) }
    }
    await supabaseAdmin.from("work_item_dependencies").delete().eq("workspace_id", workspace.id).eq("work_item_id", workItemId).eq("source", "manual")
    if (uniqueIds.length) {
        const { error } = await supabaseAdmin.from("work_item_dependencies").insert(uniqueIds.map((dependsOnId) => ({ workspace_id: workspace.id, work_item_id: workItemId, depends_on_work_item_id: dependsOnId, source: "manual", created_by: user.id })))
        if (error) throw new Error(error.message)
    }
    refreshWorkItem(slug, workItemId)
}

export async function updateWorkItemLinks(slug: string, workItemId: string, relationshipIds: string[], keyResultLinks: Array<{ keyResultId: string; expectedMovement: number; impactHypothesis: string }>) {
    const { workspace, user, item, access, role } = await requireWorkItem(slug, workItemId)
    if (item.native_kind === "onboarding_step") throw new Error("Onboarding work-item links are managed by onboarding")
    const uniqueIds = [...new Set(relationshipIds)]
    const normalizedKeyResultLinks = [...new Map(keyResultLinks.map((link) => [link.keyResultId, {
        keyResultId: link.keyResultId,
        expectedMovement: Number(link.expectedMovement),
        impactHypothesis: String(link.impactHypothesis ?? "").trim(),
    }])).values()]
    const uniqueKeyResultIds = normalizedKeyResultLinks.map((link) => link.keyResultId)
    if (role === "staff" && uniqueKeyResultIds.length) throw new Error("Staff cannot link work to private Admin goals")
    if (uniqueKeyResultIds.length && !item.execution_owner_id) throw new Error("Choose an execution owner before linking this work item to a Key Result")
    if (normalizedKeyResultLinks.some((link) => !Number.isFinite(link.expectedMovement) || link.expectedMovement <= 0)) throw new Error("Every linked Key Result needs a positive expected movement")
    if (normalizedKeyResultLinks.some((link) => !link.impactHypothesis)) throw new Error("Every linked Key Result needs an impact hypothesis")
    if ((item.area === "admin" || item.visibility === "admins_only") && uniqueIds.length) throw new Error("Private Admin work items cannot be linked to relationships")
    const [{ data: relationships }, { data: existingOkrLinks }] = await Promise.all([
        supabaseAdmin.from("relationships").select("id").eq("workspace_id", workspace.id),
        supabaseAdmin.from("workspace_okr_work_items").select("key_result_id").eq("workspace_id", workspace.id).eq("work_item_id", workItemId),
    ])
    const accessibleIds = await accessibleRelationshipIds(access)
    const allowedIds = new Set((relationships ?? []).filter((row) => !accessibleIds || accessibleIds.has(row.id)).map((row) => row.id))
    if (uniqueIds.some((id) => !allowedIds.has(id))) throw new Error("Relationships must belong to this workspace")

    if (uniqueKeyResultIds.length) {
        const { data: keyResults } = await supabaseAdmin.from("workspace_okr_key_results").select("id, okr_id").eq("workspace_id", workspace.id).in("id", uniqueKeyResultIds)
        if ((keyResults ?? []).length !== uniqueKeyResultIds.length) throw new Error("Key Results must belong to this workspace")
        const okrIds = [...new Set((keyResults ?? []).map((result) => result.okr_id))]
        const { data: okrs } = await supabaseAdmin.from("workspace_okrs").select("id").eq("workspace_id", workspace.id).eq("status", "active").eq("objective_type", "committed").in("id", okrIds)
        if ((okrs ?? []).length !== okrIds.length) throw new Error("Work can only be linked to committed Key Results")
    }

    if (item.area !== "admin" && item.visibility !== "admins_only") {
        const { error } = await supabaseAdmin.rpc("set_work_item_explicit_relationships", { p_workspace_id: workspace.id, p_work_item_id: workItemId, p_relationship_ids: uniqueIds })
        if (error) throw new Error(error.message)
    }
    const existingKeyResultIds = new Set((existingOkrLinks ?? []).map((link) => link.key_result_id))
    const removedKeyResultIds = [...existingKeyResultIds].filter((id) => !uniqueKeyResultIds.includes(id))
    if (normalizedKeyResultLinks.length) {
        const { error: upsertError } = await supabaseAdmin.from("workspace_okr_work_items").upsert(normalizedKeyResultLinks.map((link) => ({ workspace_id: workspace.id, key_result_id: link.keyResultId, work_item_id: workItemId, expected_movement: link.expectedMovement, impact_hypothesis: link.impactHypothesis, linked_by: user.id })), { onConflict: "key_result_id,work_item_id" })
        if (upsertError) throw new Error(upsertError.message)
    }
    if (removedKeyResultIds.length) {
        const { error: deleteError } = await supabaseAdmin.from("workspace_okr_work_items").delete().eq("workspace_id", workspace.id).eq("work_item_id", workItemId).in("key_result_id", removedKeyResultIds)
        if (deleteError) throw new Error(deleteError.message)
    }
    const allKeyResultIds = [...new Set([...(existingOkrLinks ?? []).map((link) => link.key_result_id), ...uniqueKeyResultIds])]
    if (allKeyResultIds.length) {
        const { data: keyResults } = await supabaseAdmin.from("workspace_okr_key_results").select("okr_id").eq("workspace_id", workspace.id).in("id", allKeyResultIds)
        for (const okrId of new Set((keyResults ?? []).map((result) => result.okr_id))) revalidatePath(`/${slug}/admin/okrs/${okrId}`)
        revalidatePath(`/${slug}/admin`)
    }
    refreshWorkItem(slug, workItemId)
}

export async function updateWorkItemPriority(slug: string, workItemId: string, priorityOverride: number | null) {
    const { workspace } = await requireWorkItem(slug, workItemId)
    if (priorityOverride !== null && (!Number.isInteger(priorityOverride) || priorityOverride < 1 || priorityOverride > 4)) throw new Error("Invalid priority")
    const { error } = await supabaseAdmin.from("work_items").update({ priority_override: priorityOverride }).eq("workspace_id", workspace.id).eq("id", workItemId)
    if (error) throw new Error(error.message)
    refreshWorkItem(slug, workItemId)
}

export type WorkItemCompletionUndo = {
    workItemId: string
    previousStatus: "todo" | "doing" | "waiting" | "blocked"
    previousActualCompletedAt: string | null
    previousActualCompletedHasTime: boolean
    completionVersion: string
}

export async function completeAdminWorkItem(slug: string, workItemId: string): Promise<WorkItemCompletionUndo> {
    const { workspace, item } = await requireWorkItem(slug, workItemId)
    if (item.area !== "admin" || item.visibility !== "admins_only") throw new Error("Only private Admin work can be completed from this queue")
    if (!["todo", "doing", "waiting", "blocked"].includes(item.status)) throw new Error("This work item is no longer actionable")
    const completedAt = new Date().toISOString()
    const { data: completed, error } = await supabaseAdmin.from("work_items")
        .update({ status: "done", actual_completed_at: completedAt, actual_completed_has_time: true })
        .eq("workspace_id", workspace.id)
        .eq("id", workItemId)
        .eq("updated_at", item.updated_at)
        .select("updated_at")
        .maybeSingle()
    if (error) throw new Error(error.message)
    if (!completed) throw new Error("This work item changed before it could be completed. Refresh and try again.")
    await refreshScheduleSurfaces(slug, workspace.id, workItemId)
    return {
        workItemId,
        previousStatus: item.status as WorkItemCompletionUndo["previousStatus"],
        previousActualCompletedAt: item.actual_completed_at,
        previousActualCompletedHasTime: Boolean(item.actual_completed_has_time),
        completionVersion: completed.updated_at,
    }
}

export async function undoAdminWorkItemCompletion(slug: string, undo: WorkItemCompletionUndo) {
    if (!undo || !undo.workItemId || !["todo", "doing", "waiting", "blocked"].includes(undo.previousStatus)) throw new Error("This completion cannot be undone")
    const { workspace, item } = await requireWorkItem(slug, undo.workItemId)
    if (item.area !== "admin" || item.visibility !== "admins_only" || item.status !== "done") throw new Error("This work item is no longer in the completed state")
    const { data: restored, error } = await supabaseAdmin.from("work_items")
        .update({
            status: undo.previousStatus,
            actual_completed_at: undo.previousActualCompletedAt,
            actual_completed_has_time: undo.previousActualCompletedHasTime,
        })
        .eq("workspace_id", workspace.id)
        .eq("id", undo.workItemId)
        .eq("updated_at", undo.completionVersion)
        .select("id")
        .maybeSingle()
    if (error) throw new Error(error.message)
    if (!restored) throw new Error("This work item changed after completion, so Undo cannot safely overwrite it")
    await refreshScheduleSurfaces(slug, workspace.id, undo.workItemId)
}
