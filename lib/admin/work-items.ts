import { supabaseAdmin } from "@/lib/supabase/admin"
import { buildAdminWorkQueue, type AdminQueueContribution, type AdminQueueDurationSource, type AdminQueueOkrLinkInput, type AdminQueueResult, type AdminQueueWorkInput, type AdminQueueWorkKind, type AdminQueueWorkStatus } from "@/lib/admin/work-priority"
import type { WorkspaceOkr } from "@/lib/admin/okrs"

export type AdminWorkItem = AdminQueueWorkInput & {
    description: string | null
    assignee_ids: string[]
    queue_position: number | null
    queue_reason: AdminQueueResult["queue_reason"]
    queue_label: string
    predicted_duration_hours: number
    conservative_duration_hours: number
    duration_source: AdminQueueDurationSource
    direct_priority_value: number
    direct_impact_rate: number
    queue_impact_rate: number
    latest_safe_start: string | null
    projected_start: string | null
    projected_finish: string | null
    projected_lateness_hours: number
    enables_work_item_id: string | null
    enables_work_item_title: string | null
    blocked_by_ids: string[]
    blocked_by_titles: string[]
    contributions: AdminQueueContribution[]
}

function queueWorkInput(item: Record<string, unknown>): AdminQueueWorkInput {
    const status = ["todo", "doing", "waiting", "blocked", "done", "canceled"].includes(String(item.status)) ? String(item.status) as AdminQueueWorkStatus : "todo"
    const kind = item.kind === "maintenance" || item.kind === "okr_action" ? item.kind as AdminQueueWorkKind : "standard"
    return {
        id: String(item.id),
        title: String(item.title ?? "Admin work"),
        status,
        priority: Number(item.priority ?? 4),
        priority_override: typeof item.priority_override === "number" ? item.priority_override : item.priority_override === null ? null : Number.isFinite(Number(item.priority_override)) ? Number(item.priority_override) : null,
        execution_owner_id: typeof item.execution_owner_id === "string" ? item.execution_owner_id : null,
        kind,
        severity: typeof item.severity === "string" ? item.severity : null,
        planned_start_date: typeof item.planned_start_date === "string" ? item.planned_start_date : null,
        due_date: typeof item.due_date === "string" ? item.due_date : null,
        due_time: typeof item.due_time === "string" ? item.due_time : null,
        actual_start_at: typeof item.actual_start_at === "string" ? item.actual_start_at : null,
        actual_completed_at: typeof item.actual_completed_at === "string" ? item.actual_completed_at : null,
        created_at: String(item.created_at),
        updated_at: String(item.updated_at),
    }
}

export async function listAdminWorkItems(workspaceId: string, okrs: WorkspaceOkr[], now = new Date()): Promise<AdminWorkItem[]> {
    const { data: itemRows, error } = await supabaseAdmin.from("work_items")
        .select("id, title, description, status, priority, priority_override, execution_owner_id, kind, severity, planned_start_date, due_date, due_time, actual_start_at, actual_completed_at, created_at, updated_at")
        .eq("workspace_id", workspaceId)
        .eq("area", "admin")
        .eq("visibility", "admins_only")
        .order("updated_at", { ascending: false })
        .limit(500)
    if (error) throw new Error(`Could not load the Admin work queue: ${error.message}`)
    if (!itemRows?.length) return []

    const items = itemRows.map((item) => queueWorkInput(item as Record<string, unknown>))
    const itemIds = items.map((item) => item.id)
    const [assigneeResult, dependencyResult, linkResult] = await Promise.all([
        supabaseAdmin.from("work_item_assignees").select("work_item_id, user_id").eq("workspace_id", workspaceId).in("work_item_id", itemIds),
        supabaseAdmin.from("work_item_dependencies").select("work_item_id, depends_on_work_item_id").eq("workspace_id", workspaceId).in("work_item_id", itemIds),
        supabaseAdmin.from("workspace_okr_work_items").select("work_item_id, key_result_id, expected_movement, impact_hypothesis").eq("workspace_id", workspaceId).in("work_item_id", itemIds),
    ])
    const relatedError = assigneeResult.error ?? dependencyResult.error ?? linkResult.error
    if (relatedError) throw new Error(`Could not calculate the Admin work queue: ${relatedError.message}`)
    const assignees = assigneeResult.data
    const dependencyRows = dependencyResult.data
    const linkRows = linkResult.data

    const assigneesByItem = new Map<string, string[]>()
    for (const row of assignees ?? []) assigneesByItem.set(row.work_item_id, [...(assigneesByItem.get(row.work_item_id) ?? []), row.user_id])
    const externalDependencyIds = [...new Set((dependencyRows ?? []).map((row) => row.depends_on_work_item_id).filter((id) => !itemIds.includes(id)))]
    const externalDependencyResult = externalDependencyIds.length
        ? await supabaseAdmin.from("work_items").select("id, title, status").eq("workspace_id", workspaceId).in("id", externalDependencyIds)
        : { data: [], error: null }
    if (externalDependencyResult.error) throw new Error(`Could not resolve Admin work dependencies: ${externalDependencyResult.error.message}`)
    const externalDependencies = externalDependencyResult.data
    const dependencyStatus = new Map([
        ...items.map((item) => [item.id, item.status] as const),
        ...(externalDependencies ?? []).map((item) => [item.id, item.status] as const),
    ])
    const dependencies = (dependencyRows ?? []).map((row) => ({
        work_item_id: row.work_item_id,
        depends_on_work_item_id: row.depends_on_work_item_id,
        depends_on_completed: dependencyStatus.get(row.depends_on_work_item_id) === "done",
    }))
    const links: AdminQueueOkrLinkInput[] = (linkRows ?? []).map((row) => ({
        work_item_id: row.work_item_id,
        key_result_id: row.key_result_id,
        expected_movement: row.expected_movement === null ? null : Number(row.expected_movement),
        impact_hypothesis: row.impact_hypothesis,
    }))
    const queue = buildAdminWorkQueue({ items, dependencies, okrs, links, now })
    const itemById = new Map(items.map((item) => [item.id, item]))
    const titleById = new Map([
        ...items.map((item) => [item.id, item.title] as const),
        ...(externalDependencies ?? []).map((item) => [item.id, item.title] as const),
    ])
    const rowById = new Map(itemRows.map((item) => [item.id, item]))

    return queue.map((queueResult) => {
        const item = itemById.get(queueResult.work_item_id)!
        const row = rowById.get(item.id)!
        return {
            ...item,
            description: row.description,
            assignee_ids: assigneesByItem.get(item.id) ?? [],
            ...queueResult,
            blocked_by_titles: queueResult.blocked_by_ids.map((id) => titleById.get(id) ?? "unfinished dependency"),
        }
    })
}
