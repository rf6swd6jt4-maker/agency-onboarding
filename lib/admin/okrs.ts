import { supabaseAdmin } from "@/lib/supabase/admin"
import { okrAttainment, okrKeyResultProgress, okrTargetMet, type OkrMetricComparator, type OkrMetricUnit } from "@/lib/admin/okr-metrics"

export type WorkspaceOkrStatus = "draft" | "active" | "completed" | "cancelled"

export type OkrMeasurement = {
    id: string
    value: number
    measured_at: string
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
    measurements: OkrMeasurement[]
    actions: OkrActionWorkItem[]
    current_value: number
    progress: number
    target_met: boolean
}

export type WorkspaceOkr = {
    id: string
    workspace_id: string
    title: string
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
        .select("id, workspace_id, title, description, period_start, period_end, owner_user_id, status, outcome_note, created_by, created_at, updated_at")
        .eq("workspace_id", workspaceId)
        .order("period_end", { ascending: false })
    if (error || !okrs?.length) return []

    const okrIds = okrs.map((okr) => okr.id)
    const { data: keyResults } = await supabaseAdmin.from("workspace_okr_key_results")
        .select("id, workspace_id, okr_id, name, description, unit, currency_code, comparator, baseline_value, target_value, sort_order")
        .eq("workspace_id", workspaceId).in("okr_id", okrIds).order("sort_order").order("created_at")
    const keyResultIds = (keyResults ?? []).map((item) => item.id)
    const [{ data: measurements }, { data: actionLinks }] = await Promise.all([
        keyResultIds.length ? supabaseAdmin.from("workspace_okr_measurements")
            .select("id, key_result_id, value, measured_at, note, provenance, recorded_by")
            .eq("workspace_id", workspaceId).in("key_result_id", keyResultIds).order("measured_at", { ascending: true }).order("created_at", { ascending: true }) : Promise.resolve({ data: [] }),
        keyResultIds.length ? supabaseAdmin.from("workspace_okr_work_items")
            .select("key_result_id, work_items!inner(id, title, status, priority, description)")
            .eq("workspace_id", workspaceId).in("key_result_id", keyResultIds) : Promise.resolve({ data: [] }),
    ])

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
        actionsByKeyResult.set(link.key_result_id, [...(actionsByKeyResult.get(link.key_result_id) ?? []), linked])
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
            key_results: results,
            attainment: okrAttainment(results.map((result) => result.progress)),
        }
    })
}

export async function getWorkspaceOkr(workspaceId: string, okrId: string) {
    return (await listWorkspaceOkrs(workspaceId)).find((okr) => okr.id === okrId) ?? null
}
