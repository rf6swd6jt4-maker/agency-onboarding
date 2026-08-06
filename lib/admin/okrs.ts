import { supabaseAdmin } from "@/lib/supabase/admin"
import { okrAttainment, okrKeyResultProgress, okrTargetMet, type OkrMetricComparator, type OkrMetricUnit } from "@/lib/admin/okr-metrics"
import type { OkrReportingCadence } from "@/lib/admin/okr-reporting"
import type { WorkspaceOkrType } from "@/lib/admin/okr-title"

export type WorkspaceOkrStatus = "draft" | "active" | "completed" | "cancelled"

export type OkrMeasurement = {
    id: string
    value: number
    measured_at: string
    reported_on: string
    note: string | null
    provenance: "manual"
    recorded_by: string | null
}

export type OkrActionWorkItem = {
    id: string
    title: string
    status: string
    priority: number
    description: string | null
    due_date: string | null
    created_at: string
    updated_at: string
    assignee_ids: string[]
}

export type OkrKeyResult = {
    id: string
    name: string
    description: string | null
    unit: OkrMetricUnit
    currency_code: string | null
    comparator: OkrMetricComparator
    baseline_value: number
    target_value: number
    sort_order: number
    reporting_cadence: OkrReportingCadence | null
    reporting_started_on: string | null
    measurements: OkrMeasurement[]
    actions: OkrActionWorkItem[]
    current_value: number
    progress: number
    target_met: boolean
}

export type WorkspaceOkr = {
    id: string
    workspace_id: string
    objective: string
    objective_type: WorkspaceOkrType | null
    is_test: boolean
    description: string | null
    period_start: string
    period_end: string
    owner_user_id: string
    status: WorkspaceOkrStatus
    outcome_note: string | null
    created_by: string | null
    created_at: string
    updated_at: string
    key_results: OkrKeyResult[]
    attainment: number
}

function numberValue(value: unknown) {
    const result = Number(value)
    return Number.isFinite(result) ? result : 0
}

export async function listWorkspaceOkrs(workspaceId: string): Promise<WorkspaceOkr[]> {
    const { data: okrs, error } = await supabaseAdmin.from("workspace_okrs")
        .select("id, workspace_id, objective, objective_type, is_test, description, period_start, period_end, owner_user_id, status, outcome_note, created_by, created_at, updated_at")
        .eq("workspace_id", workspaceId)
        .order("period_end", { ascending: false })
    if (error || !okrs?.length) return []

    const okrIds = okrs.map((okr) => okr.id)
    const { data: keyResults } = await supabaseAdmin.from("workspace_okr_key_results")
        .select("id, workspace_id, okr_id, name, description, unit, currency_code, comparator, baseline_value, target_value, sort_order, reporting_cadence, reporting_started_on")
        .eq("workspace_id", workspaceId).in("okr_id", okrIds).order("sort_order").order("created_at")
    const keyResultIds = (keyResults ?? []).map((item) => item.id)
    const [{ data: measurements }, { data: actionLinks }] = await Promise.all([
        keyResultIds.length ? supabaseAdmin.from("workspace_okr_measurements")
            .select("id, key_result_id, value, measured_at, reported_on, note, provenance, recorded_by")
            .eq("workspace_id", workspaceId).in("key_result_id", keyResultIds).order("reported_on", { ascending: true }).order("created_at", { ascending: true }) : Promise.resolve({ data: [] }),
        keyResultIds.length ? supabaseAdmin.from("workspace_okr_work_items")
            .select("key_result_id, work_items!inner(id, title, status, priority, description, due_date, created_at, updated_at)")
            .eq("workspace_id", workspaceId).in("key_result_id", keyResultIds) : Promise.resolve({ data: [] }),
    ])

    const linkedWorkItemIds = [...new Set((actionLinks ?? []).flatMap((link) => {
        const linked = Array.isArray(link.work_items) ? link.work_items[0] : link.work_items
        return linked ? [linked.id] : []
    }))]
    const { data: assigneeRows } = linkedWorkItemIds.length
        ? await supabaseAdmin.from("work_item_assignees").select("work_item_id, user_id").eq("workspace_id", workspaceId).in("work_item_id", linkedWorkItemIds)
        : { data: [] }
    const assigneesByWorkItem = new Map<string, string[]>()
    for (const assignee of assigneeRows ?? []) assigneesByWorkItem.set(assignee.work_item_id, [...(assigneesByWorkItem.get(assignee.work_item_id) ?? []), assignee.user_id])

    const measurementsByKeyResult = new Map<string, OkrMeasurement[]>()
    for (const measurement of measurements ?? []) {
        const rows = measurementsByKeyResult.get(measurement.key_result_id) ?? []
        rows.push({ ...measurement, value: numberValue(measurement.value), provenance: "manual" })
        measurementsByKeyResult.set(measurement.key_result_id, rows)
    }
    const actionsByKeyResult = new Map<string, OkrActionWorkItem[]>()
    for (const link of actionLinks ?? []) {
        const linked = Array.isArray(link.work_items) ? link.work_items[0] : link.work_items
        if (!linked) continue
        actionsByKeyResult.set(link.key_result_id, [...(actionsByKeyResult.get(link.key_result_id) ?? []), { ...linked, assignee_ids: assigneesByWorkItem.get(linked.id) ?? [] }])
    }

    const keyResultsByOkr = new Map<string, OkrKeyResult[]>()
    for (const result of keyResults ?? []) {
        const baseline = numberValue(result.baseline_value)
        const target = numberValue(result.target_value)
        const resultMeasurements = measurementsByKeyResult.get(result.id) ?? []
        const current = resultMeasurements.at(-1)?.value ?? baseline
        const mapped: OkrKeyResult = {
            id: result.id,
            name: result.name,
            description: result.description,
            unit: result.unit as OkrMetricUnit,
            currency_code: result.currency_code,
            comparator: result.comparator as OkrMetricComparator,
            baseline_value: baseline,
            target_value: target,
            sort_order: result.sort_order,
            reporting_cadence: result.reporting_cadence as OkrReportingCadence | null,
            reporting_started_on: result.reporting_started_on,
            measurements: resultMeasurements,
            actions: actionsByKeyResult.get(result.id) ?? [],
            current_value: current,
            progress: okrKeyResultProgress({ baseline, target, current }),
            target_met: okrTargetMet(result.comparator as OkrMetricComparator, current, target),
        }
        keyResultsByOkr.set(result.okr_id, [...(keyResultsByOkr.get(result.okr_id) ?? []), mapped])
    }

    return okrs.map((okr) => {
        const results = keyResultsByOkr.get(okr.id) ?? []
        return {
            ...okr,
            status: okr.status as WorkspaceOkrStatus,
            objective_type: okr.objective_type as WorkspaceOkrType | null,
            is_test: Boolean(okr.is_test),
            key_results: results,
            attainment: okrAttainment(results.map((result) => result.progress)),
        }
    })
}

export async function getWorkspaceOkr(workspaceId: string, okrId: string) {
    return (await listWorkspaceOkrs(workspaceId)).find((okr) => okr.id === okrId) ?? null
}

export type WorkItemKeyResultLink = {
    id: string
    name: string
    objective: string
    okr_id: string
}

export async function listActiveWorkspaceKeyResults(workspaceId: string): Promise<WorkItemKeyResultLink[]> {
    const { data: okrs } = await supabaseAdmin.from("workspace_okrs")
        .select("id, objective").eq("workspace_id", workspaceId).eq("status", "active").eq("objective_type", "committed")
    if (!okrs?.length) return []
    const objectiveById = new Map(okrs.map((okr) => [okr.id, okr.objective]))
    const { data: keyResults } = await supabaseAdmin.from("workspace_okr_key_results")
        .select("id, okr_id, name").eq("workspace_id", workspaceId).in("okr_id", okrs.map((okr) => okr.id)).order("sort_order").order("created_at")
    return (keyResults ?? []).map((result) => ({
        id: result.id,
        name: result.name,
        objective: objectiveById.get(result.okr_id) ?? "Objective",
        okr_id: result.okr_id,
    }))
}

export async function listWorkItemKeyResultLinks(workspaceId: string, workItemId: string): Promise<WorkItemKeyResultLink[]> {
    const { data: links } = await supabaseAdmin.from("workspace_okr_work_items")
        .select("key_result_id").eq("workspace_id", workspaceId).eq("work_item_id", workItemId)
    if (!links?.length) return []
    const { data: keyResults } = await supabaseAdmin.from("workspace_okr_key_results")
        .select("id, okr_id, name").eq("workspace_id", workspaceId).in("id", links.map((link) => link.key_result_id))
    if (!keyResults?.length) return []
    const { data: okrs } = await supabaseAdmin.from("workspace_okrs")
        .select("id, objective").eq("workspace_id", workspaceId).in("id", [...new Set(keyResults.map((result) => result.okr_id))])
    const objectiveById = new Map((okrs ?? []).map((okr) => [okr.id, okr.objective]))
    return keyResults.map((result) => ({ id: result.id, name: result.name, objective: objectiveById.get(result.okr_id) ?? "Objective", okr_id: result.okr_id }))
}
