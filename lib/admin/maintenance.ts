import { supabaseAdmin } from "@/lib/supabase/admin"
import { maintenanceBugTitle, resolveMaintenanceError } from "@/lib/admin/error-catalogue"
import { sanitizeAdminActivityPayload } from "@/lib/admin/activity-sanitizer"

export const MAINTENANCE_CATEGORIES = ["services", "leadgen", "onboarding", "billing", "communications", "integrations", "system_health"] as const
export type MaintenanceCategory = (typeof MAINTENANCE_CATEGORIES)[number]
export const MAINTENANCE_ROUTE_KEYS = ["global", ...MAINTENANCE_CATEGORIES] as const
export type MaintenanceRouteKey = (typeof MAINTENANCE_ROUTE_KEYS)[number]
export type MaintenanceSeverity = "warning" | "critical"

export type PlatformFailureInput = {
    workspaceId: string | null | undefined
    category: MaintenanceCategory
    source: string
    operation: string
    fingerprint: string
    severity: MaintenanceSeverity
    summary: string
    diagnostics?: Record<string, unknown>
    occurredAt?: string
    sourceHref?: string | null
    actorUserId?: string | null
    correlationId?: string | null
    idempotencyKey?: string | null
}

export type MaintenanceWorkItem = {
    id: string
    title: string
    description: string | null
    status: string
    priority: number
    maintenance_category: MaintenanceCategory
    severity: MaintenanceSeverity
    failure_fingerprint: string
    occurrence_count: number
    first_occurred_at: string
    last_occurred_at: string
    native_href: string | null
    metadata: Record<string, unknown>
    assignee_ids: string[]
}

export function maintenanceCategoryLabel(category: MaintenanceCategory) {
    if (category === "leadgen") return "Lead Gen"
    if (category === "system_health") return "System Health"
    return category.slice(0, 1).toUpperCase() + category.slice(1)
}

export function platformFailureFingerprint(parts: Array<string | number | null | undefined>) {
    return parts.filter((part): part is string | number => part !== null && part !== undefined && String(part).trim().length > 0)
        .map((part) => String(part).trim().toLowerCase().replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, ":id").replace(/\d{4,}/g, ":n").replace(/[^a-z0-9:_-]+/g, "-").replace(/^-+|-+$/g, ""))
        .join(":")
        .slice(0, 240)
}

export async function reportPlatformFailure(input: PlatformFailureInput): Promise<{ ok: boolean; workItemId?: string; eventId?: string; occurrenceCount24h?: number; thresholdReached?: boolean }> {
    if (!input.workspaceId || !input.fingerprint.trim()) return { ok: false }
    try {
        const occurredAt = input.occurredAt ?? new Date().toISOString()
        const errorDefinition = resolveMaintenanceError(input)
        const title = maintenanceBugTitle(errorDefinition)
        const diagnostics = sanitizeAdminActivityPayload({
            ...(input.diagnostics ?? {}),
            error_code: errorDefinition.code,
            error_name: errorDefinition.name,
        }) as Record<string, unknown>
        console.error("Platform automation failure", {
            workspaceId: input.workspaceId,
            category: input.category,
            source: input.source,
            operation: input.operation,
            fingerprint: input.fingerprint,
            errorCode: errorDefinition.code,
            title,
            summary: input.summary,
            diagnostics,
        })
        const { data, error } = await supabaseAdmin.rpc("report_platform_failure", {
            p_workspace_id: input.workspaceId,
            p_category: input.category,
            p_source: input.source,
            p_operation: input.operation,
            p_fingerprint: input.fingerprint.trim(),
            p_severity: input.severity,
            p_summary: input.summary,
            p_diagnostics: diagnostics,
            p_occurred_at: occurredAt,
            p_source_href: input.sourceHref ?? null,
            p_actor_user_id: input.actorUserId ?? null,
            p_correlation_id: input.correlationId ?? null,
            p_idempotency_key: input.idempotencyKey ?? null,
        })
        const row = Array.isArray(data) ? data[0] : data
        if (error || !row?.ok) {
            console.warn("Could not record platform failure", { fingerprint: input.fingerprint, message: error?.message })
            return { ok: false }
        }
        return {
            ok: true,
            workItemId: typeof row.work_item_id === "string" ? row.work_item_id : undefined,
            eventId: typeof row.event_id === "string" ? row.event_id : undefined,
            occurrenceCount24h: Number(row.occurrence_count_24h ?? 0),
            thresholdReached: Boolean(row.threshold_reached),
        }
    } catch (error) {
        console.warn("Could not create maintenance Work Item after platform error", {
            fingerprint: input.fingerprint,
            error: sanitizeAdminActivityPayload(error instanceof Error ? error.message : error),
        })
        return { ok: false }
    }
}

export async function reportClientPlatformFailure(input: Omit<PlatformFailureInput, "workspaceId" | "sourceHref"> & { clientId: string }) {
    try {
        const { data: client } = await supabaseAdmin.from("clients").select("workspace_id, relationship_id").eq("id", input.clientId).maybeSingle()
        if (!client?.workspace_id) return { ok: false }
        const { data: workspace } = await supabaseAdmin.from("workspaces").select("slug").eq("id", client.workspace_id).maybeSingle()
        return reportPlatformFailure({
            ...input,
            workspaceId: client.workspace_id,
            sourceHref: workspace?.slug && client.relationship_id ? `/${workspace.slug}/relationships/${client.relationship_id}` : null,
        })
    } catch (error) {
        console.warn("Could not resolve client platform failure", {
            clientId: input.clientId,
            error: sanitizeAdminActivityPayload(error instanceof Error ? error.message : error),
        })
        return { ok: false }
    }
}

export async function listMaintenanceWorkItems(workspaceId: string): Promise<MaintenanceWorkItem[]> {
    const { data: items, error } = await supabaseAdmin.from("work_items")
        .select("id, title, description, status, priority, maintenance_category, severity, failure_fingerprint, occurrence_count, first_occurred_at, last_occurred_at, native_href, metadata")
        .eq("workspace_id", workspaceId).eq("area", "admin").eq("kind", "maintenance")
        .order("last_occurred_at", { ascending: false }).limit(200)
    if (error || !items?.length) return []
    const ids = items.map((item) => item.id)
    const { data: assignees } = await supabaseAdmin.from("work_item_assignees").select("work_item_id, user_id").eq("workspace_id", workspaceId).in("work_item_id", ids)
    const assigneesByItem = new Map<string, string[]>()
    for (const row of assignees ?? []) assigneesByItem.set(row.work_item_id, [...(assigneesByItem.get(row.work_item_id) ?? []), row.user_id])
    return items.map((item) => ({ ...item, occurrence_count: Number(item.occurrence_count ?? 1), assignee_ids: assigneesByItem.get(item.id) ?? [] })) as MaintenanceWorkItem[]
}

export async function listMaintenanceRouting(workspaceId: string) {
    const { data } = await supabaseAdmin.from("workspace_maintenance_routing").select("category, responsible_user_id").eq("workspace_id", workspaceId)
    return data ?? []
}
