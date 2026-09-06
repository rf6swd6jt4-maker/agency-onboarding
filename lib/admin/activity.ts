import type { AdminActivityMetricEvent } from "@/lib/admin/activity-metrics"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { sanitizeAdminActivityPayload } from "@/lib/admin/activity-sanitizer"

export const ADMIN_ACTIVITY_CATEGORIES = ["onboarding", "services", "leadgen", "billing", "communications", "gantt", "integrations", "maintenance", "system"] as const
export type AdminActivityCategory = (typeof ADMIN_ACTIVITY_CATEGORIES)[number]
export type AdminActivityLevel = "info" | "warning" | "error"
export type AdminActivityDirection = "outbound" | "inbound"
export type AdminActivityActorKind = "staff" | "client" | "automation"
export type AdminActivityOutcome = "succeeded" | "failed" | "rejected" | "queued" | "skipped"
export type AdminActivityMetricClassification = "audit" | "operational" | "internal_call" | "external_call"

export type AdminActivityEventInput = {
    workspaceId: string | null | undefined
    category: AdminActivityCategory
    level?: AdminActivityLevel
    eventKey: string
    summary: string
    entityType?: string | null
    entityId?: string | null
    sourceHref?: string | null
    actorUserId?: string | null
    actorKind?: AdminActivityActorKind
    metadata?: Record<string, unknown>
    diagnostics?: Record<string, unknown>
    occurredAt?: string
    correlationId?: string | null
    causationEventId?: string | null
    idempotencyKey?: string | null
    outcome?: AdminActivityOutcome
    metricClassification?: AdminActivityMetricClassification
    failureFingerprint?: string | null
    maintenanceWorkItemId?: string | null
    coalesce?: boolean
    direction?: AdminActivityDirection
}

export type AdminActivityEvent = {
    id: string
    workspace_id?: string
    category: AdminActivityCategory
    level: AdminActivityLevel
    event_key: string
    summary: string
    entity_type: string | null
    entity_id: string | null
    source_href: string | null
    actor_user_id: string | null
    actor_kind?: AdminActivityActorKind
    metadata: Record<string, unknown>
    diagnostics?: Record<string, unknown>
    occurred_at: string
    created_at: string
    correlation_id?: string
    causation_event_id?: string | null
    idempotency_key?: string | null
    outcome?: AdminActivityOutcome
    metric_classification?: AdminActivityMetricClassification
    failure_fingerprint?: string | null
    maintenance_work_item_id?: string | null
}

export type AdminActivityCursor = { occurredAt: string; id: string }
export type AdminActivityListOptions = {
    limit?: number
    category?: AdminActivityCategory | null
    level?: AdminActivityLevel | null
    cursor?: AdminActivityCursor | null
}
export type AdminActivityPageResult = { events: AdminActivityEvent[]; nextCursor: AdminActivityCursor | null }
export type AdminActivityFacets = {
    levelTotal: number
    categoryTotal: number
    byLevel: Record<AdminActivityLevel, number>
    byCategory: Record<AdminActivityCategory, number>
}

const ACTIVITY_SELECT = "id, workspace_id, category, level, event_key, summary, entity_type, entity_id, source_href, actor_user_id, actor_kind, metadata, diagnostics, occurred_at, created_at, correlation_id, causation_event_id, idempotency_key, outcome, metric_classification, failure_fingerprint, maintenance_work_item_id"

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function numberValue(value: unknown) {
    const number = Number(value)
    return Number.isFinite(number) ? number : 0
}

export function adminActivityCategoryLabel(category: AdminActivityCategory) {
    if (category === "leadgen") return "Lead Gen"
    return category.slice(0, 1).toUpperCase() + category.slice(1)
}

export function encodeAdminActivityCursor(cursor: AdminActivityCursor) {
    return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
}

export function decodeAdminActivityCursor(value: string | null | undefined): AdminActivityCursor | null {
    if (!value) return null
    try {
        const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<AdminActivityCursor>
        if (typeof parsed.id !== "string" || typeof parsed.occurredAt !== "string" || !Number.isFinite(new Date(parsed.occurredAt).getTime())) return null
        return { id: parsed.id, occurredAt: parsed.occurredAt }
    } catch {
        return null
    }
}

export async function recordAdminActivity(input: AdminActivityEventInput) {
    if (!input.workspaceId || !input.eventKey.trim() || !input.summary.trim()) return false
    const metricClassification = input.metricClassification
        ?? (input.direction === "outbound" ? "internal_call" : input.direction === "inbound" ? "external_call" : "audit")
    const actorKind = input.actorKind
        ?? (input.actorUserId ? "staff" : ["onboarding.step.completed", "onboarding.session.completed", "onboarding.edit_request.recorded"].includes(input.eventKey) ? "client" : "automation")
    const outcome = input.outcome ?? (input.level === "error" ? "failed" : "succeeded")
    const metadata = sanitizeAdminActivityPayload(
        input.direction ? { ...(input.metadata ?? {}), request_direction: input.direction } : input.metadata ?? {}
    ) as Record<string, unknown>
    const diagnostics = sanitizeAdminActivityPayload(input.diagnostics ?? {}) as Record<string, unknown>
    try {
        const { error } = await supabaseAdmin.rpc("record_workspace_admin_activity", {
            p_workspace_id: input.workspaceId,
            p_category: input.category,
            p_event_key: input.eventKey.trim(),
            p_summary: input.summary.trim(),
            p_level: input.level ?? "info",
            p_entity_type: input.entityType ?? null,
            p_entity_id: input.entityId ?? null,
            p_source_href: input.sourceHref ?? null,
            p_actor_user_id: input.actorUserId ?? null,
            p_actor_kind: actorKind,
            p_metadata: metadata,
            p_diagnostics: diagnostics,
            p_occurred_at: input.occurredAt ?? new Date().toISOString(),
            p_correlation_id: input.correlationId ?? null,
            p_causation_event_id: input.causationEventId ?? null,
            p_idempotency_key: input.idempotencyKey ?? null,
            p_outcome: outcome,
            p_metric_classification: metricClassification,
            p_failure_fingerprint: input.failureFingerprint ?? null,
            p_maintenance_work_item_id: input.maintenanceWorkItemId ?? null,
            p_coalesce: input.coalesce ?? false,
        })
        if (!error) return true

        // Deployments apply database migrations before application code, but a
        // legacy fallback keeps Activity available during a rolling cutover.
        const { error: fallbackError } = await supabaseAdmin.from("workspace_admin_activity").insert({
            workspace_id: input.workspaceId,
            category: input.category,
            level: input.level ?? "info",
            event_key: input.eventKey.trim(),
            summary: input.summary.trim(),
            entity_type: input.entityType ?? null,
            entity_id: input.entityId ?? null,
            source_href: input.sourceHref ?? null,
            actor_user_id: input.actorUserId ?? null,
            metadata,
            occurred_at: input.occurredAt ?? new Date().toISOString(),
        })
        if (fallbackError) console.warn("Could not record Admin activity", { eventKey: input.eventKey, message: error.message, fallbackMessage: fallbackError.message })
        return !fallbackError
    } catch (error) {
        console.warn("Could not record Admin activity", { eventKey: input.eventKey, error })
        return false
    }
}

export async function recordClientAdminActivity(input: Omit<AdminActivityEventInput, "workspaceId" | "sourceHref"> & { clientId: string }) {
    try {
        const { data: client } = await supabaseAdmin.from("clients").select("workspace_id, relationship_id").eq("id", input.clientId).maybeSingle()
        if (!client?.workspace_id) return false
        const { data: workspace } = await supabaseAdmin.from("workspaces").select("slug").eq("id", client.workspace_id).maybeSingle()
        return recordAdminActivity({
            ...input,
            workspaceId: client.workspace_id,
            sourceHref: workspace?.slug && client.relationship_id ? `/${workspace.slug}/relationships/${client.relationship_id}` : null,
        })
    } catch (error) {
        console.warn("Could not resolve client Admin activity", { clientId: input.clientId, error })
        return false
    }
}

export async function listAdminActivityPage(workspaceId: string, options: AdminActivityListOptions = {}): Promise<AdminActivityPageResult> {
    const limit = Math.max(1, Math.min(500, options.limit ?? 100))
    const { data, error } = await supabaseAdmin.rpc("list_workspace_admin_activity", {
        p_workspace_id: workspaceId,
        p_category: options.category ?? null,
        p_level: options.level ?? null,
        p_before_occurred_at: options.cursor?.occurredAt ?? null,
        p_before_id: options.cursor?.id ?? null,
        p_limit: limit + 1,
    })
    if (!error) {
        const rows = (data ?? []) as AdminActivityEvent[]
        const hasMore = rows.length > limit
        const events = rows.slice(0, limit)
        const last = hasMore ? events.at(-1) : null
        return { events, nextCursor: last ? { occurredAt: last.occurred_at, id: last.id } : null }
    }

    let query = supabaseAdmin.from("workspace_admin_activity")
        .select(ACTIVITY_SELECT)
        .eq("workspace_id", workspaceId)
    if (options.category) query = query.eq("category", options.category)
    if (options.level) query = query.eq("level", options.level)
    if (options.cursor) query = query.or(`occurred_at.lt.${options.cursor.occurredAt},and(occurred_at.eq.${options.cursor.occurredAt},id.lt.${options.cursor.id})`)
    const fallback = await query.order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1)
    if (fallback.error) return { events: [], nextCursor: null }
    const rows = (fallback.data ?? []) as AdminActivityEvent[]
    const hasMore = rows.length > limit
    const events = rows.slice(0, limit)
    const last = hasMore ? events.at(-1) : null
    return { events, nextCursor: last ? { occurredAt: last.occurred_at, id: last.id } : null }
}

export async function listAdminActivity(workspaceId: string, limit = 250): Promise<AdminActivityEvent[]> {
    return (await listAdminActivityPage(workspaceId, { limit })).events
}

export async function getAdminActivityFacets(workspaceId: string, category: AdminActivityCategory | null, level: AdminActivityLevel | null): Promise<AdminActivityFacets> {
    const emptyCategories = Object.fromEntries(ADMIN_ACTIVITY_CATEGORIES.map((item) => [item, 0])) as Record<AdminActivityCategory, number>
    const empty: AdminActivityFacets = { levelTotal: 0, categoryTotal: 0, byLevel: { info: 0, warning: 0, error: 0 }, byCategory: emptyCategories }
    const { data, error } = await supabaseAdmin.rpc("workspace_admin_activity_facets", { p_workspace_id: workspaceId, p_category: category, p_level: level })
    if (error) return empty
    const row = asRecord(Array.isArray(data) ? data[0] : data)
    const byLevel = asRecord(row.by_level)
    const byCategory = asRecord(row.by_category)
    return {
        levelTotal: numberValue(row.level_total),
        categoryTotal: numberValue(row.category_total),
        byLevel: { info: numberValue(byLevel.info), warning: numberValue(byLevel.warning), error: numberValue(byLevel.error) },
        byCategory: Object.fromEntries(ADMIN_ACTIVITY_CATEGORIES.map((item) => [item, numberValue(byCategory[item])])) as Record<AdminActivityCategory, number>,
    }
}

export async function getAdminActivityEvent(workspaceId: string, eventId: string) {
    const { data, error } = await supabaseAdmin.from("workspace_admin_activity")
        .select(ACTIVITY_SELECT).eq("workspace_id", workspaceId).eq("id", eventId).maybeSingle()
    if (error || !data) return null
    return data as AdminActivityEvent
}

export async function listCorrelatedAdminActivity(workspaceId: string, correlationId: string): Promise<AdminActivityEvent[]> {
    const { data, error } = await supabaseAdmin.from("workspace_admin_activity")
        .select(ACTIVITY_SELECT).eq("workspace_id", workspaceId).eq("correlation_id", correlationId)
        .order("occurred_at", { ascending: true }).order("id", { ascending: true }).limit(500)
    return error ? [] : (data ?? []) as AdminActivityEvent[]
}

export async function listAdminActivitySince(workspaceId: string, since: string, until = new Date().toISOString()): Promise<AdminActivityMetricEvent[]> {
    const pageSize = 1000
    const events: AdminActivityMetricEvent[] = []
    for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabaseAdmin.from("workspace_admin_activity")
            .select("id, occurred_at, event_key, metric_classification, outcome, level, metadata")
            .eq("workspace_id", workspaceId)
            .or("metric_classification.in.(internal_call,external_call),and(metric_classification.eq.operational,event_key.like.workspace.mutation.*),and(metric_classification.is.null,metadata->>request_direction.in.(inbound,outbound))")
            .gte("occurred_at", since)
            .lte("occurred_at", until)
            .order("occurred_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, from + pageSize - 1)
        if (error) throw new Error("Unable to load activity metrics", { cause: error })
        const page = (data ?? []) as AdminActivityMetricEvent[]
        events.push(...page)
        if (page.length < pageSize) return events
    }
}
