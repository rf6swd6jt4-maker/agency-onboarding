"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import { workItemHref } from "@/lib/relationships"

async function requireWorkItem(slug: string, workItemId: string) {
    const context = await requireWorkspace(slug, "admin")
    const { data: item } = await supabaseAdmin.from("work_items")
        .select("id, status, native_kind, parent_work_item_id, area, visibility")
        .eq("workspace_id", context.workspace.id).eq("id", workItemId).maybeSingle()
    if (!item) throw new Error("Work item not found")
    return { ...context, item }
}

function refreshWorkItem(slug: string, workItemId: string) {
    revalidatePath(workItemHref(slug, workItemId))
    revalidatePath(`/${slug}/work`)
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

export async function updateWorkItemDescription(slug: string, workItemId: string, description: string) {
    const { workspace } = await requireWorkItem(slug, workItemId)
    const value = description.trim()
    const { error } = await supabaseAdmin.from("work_items").update({ description: value || null }).eq("workspace_id", workspace.id).eq("id", workItemId)
    if (error) throw new Error(error.message)
    refreshWorkItem(slug, workItemId)
}

export async function updateWorkItemAssignees(slug: string, workItemId: string, assigneeIds: string[]) {
    const { workspace, user, item } = await requireWorkItem(slug, workItemId)
    const uniqueIds = [...new Set(assigneeIds)]
    let membersQuery = supabaseAdmin.from("workspace_memberships").select("user_id").eq("workspace_id", workspace.id)
    if (item.visibility === "admins_only") membersQuery = membersQuery.in("role", ["owner", "admin"])
    const { data: members } = await membersQuery
    const memberIds = new Set((members ?? []).map((row) => row.user_id))
    if (uniqueIds.some((id) => !memberIds.has(id))) throw new Error("Assignees must belong to this workspace")
    await supabaseAdmin.from("work_item_assignees").delete().eq("workspace_id", workspace.id).eq("work_item_id", workItemId)
    if (uniqueIds.length) {
        const { error } = await supabaseAdmin.from("work_item_assignees").insert(uniqueIds.map((userId) => ({ workspace_id: workspace.id, work_item_id: workItemId, user_id: userId, assigned_by: user.id })))
        if (error) throw new Error(error.message)
    }
    refreshWorkItem(slug, workItemId)
}

export async function updateWorkItemParent(slug: string, workItemId: string, parentWorkItemId: string | null, waitForParent: boolean) {
    const { workspace, user, item } = await requireWorkItem(slug, workItemId)
    const [{ data: items }, { data: dependencyEdges }] = await Promise.all([
        supabaseAdmin.from("work_items").select("id, parent_work_item_id, status").eq("workspace_id", workspace.id).eq("visibility", item.visibility),
        supabaseAdmin.from("work_item_dependencies").select("work_item_id, depends_on_work_item_id").eq("workspace_id", workspace.id).neq("work_item_id", workItemId),
    ])
    const itemIds = new Set((items ?? []).map((row) => row.id))
    if (parentWorkItemId && (!itemIds.has(parentWorkItemId) || parentWorkItemId === workItemId)) throw new Error("Invalid parent")
    const children = new Map<string, string[]>()
    for (const row of items ?? []) if (row.parent_work_item_id) children.set(row.parent_work_item_id, [...(children.get(row.parent_work_item_id) ?? []), row.id])
    const queue = [...(children.get(workItemId) ?? [])]
    const descendants = new Set<string>()
    while (queue.length) { const id = queue.pop()!; if (descendants.has(id)) continue; descendants.add(id); queue.push(...(children.get(id) ?? [])) }
    if (parentWorkItemId && descendants.has(parentWorkItemId)) throw new Error("A child cannot become its ancestor's parent")
    if (item.status === "doing" && parentWorkItemId && waitForParent && items?.find((row) => row.id === parentWorkItemId)?.status !== "done") throw new Error("An in-progress task cannot wait for an unfinished parent")
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
    const { workspace, user, item } = await requireWorkItem(slug, workItemId)
    const uniqueIds = [...new Set(dependencyIds)].filter((id) => id !== workItemId && id !== item.parent_work_item_id)
    const [{ data: items }, { data: edges }] = await Promise.all([
        supabaseAdmin.from("work_items").select("id, status").eq("workspace_id", workspace.id).eq("visibility", item.visibility),
        supabaseAdmin.from("work_item_dependencies").select("work_item_id, depends_on_work_item_id").eq("workspace_id", workspace.id).neq("work_item_id", workItemId),
    ])
    const statuses = new Map((items ?? []).map((row) => [row.id, row.status]))
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

export async function updateWorkItemRelationships(slug: string, workItemId: string, relationshipIds: string[]) {
    const { workspace, item } = await requireWorkItem(slug, workItemId)
    if (item.area === "admin" || item.visibility === "admins_only") throw new Error("Private Admin work items cannot be linked to relationships")
    if (item.native_kind === "onboarding_step") throw new Error("Onboarding work-item relationships are managed by onboarding")
    const uniqueIds = [...new Set(relationshipIds)]
    const { data: relationships } = await supabaseAdmin.from("relationships").select("id").eq("workspace_id", workspace.id)
    const allowedIds = new Set((relationships ?? []).map((row) => row.id))
    if (uniqueIds.some((id) => !allowedIds.has(id))) throw new Error("Relationships must belong to this workspace")
    const { error } = await supabaseAdmin.rpc("set_work_item_explicit_relationships", { p_workspace_id: workspace.id, p_work_item_id: workItemId, p_relationship_ids: uniqueIds })
    if (error) throw new Error(error.message)
    refreshWorkItem(slug, workItemId)
}

export async function updateWorkItemPriority(slug: string, workItemId: string, priority: number) {
    const { workspace } = await requireWorkItem(slug, workItemId)
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) throw new Error("Invalid priority")
    const { error } = await supabaseAdmin.from("work_items").update({ priority }).eq("workspace_id", workspace.id).eq("id", workItemId)
    if (error) throw new Error(error.message)
    refreshWorkItem(slug, workItemId)
}
