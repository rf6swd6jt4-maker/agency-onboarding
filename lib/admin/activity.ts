import { supabaseAdmin } from "@/lib/supabase/admin"

export const ADMIN_ACTIVITY_CATEGORIES = ["onboarding", "leadgen", "billing", "communications", "gantt", "integrations", "maintenance", "system"] as const
export type AdminActivityCategory = (typeof ADMIN_ACTIVITY_CATEGORIES)[number]
export type AdminActivityLevel = "info" | "warning" | "error"
export type AdminActivityDirection = "outbound" | "inbound"

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
    metadata?: Record<string, unknown>
    occurredAt?: string
    direction?: AdminActivityDirection
}

export type AdminActivityEvent = {
    id: string
    category: AdminActivityCategory
    level: AdminActivityLevel
    event_key: string
    summary: string
    entity_type: string | null
    entity_id: string | null
    source_href: string | null
    actor_user_id: string | null
    metadata: Record<string, unknown>
    occurred_at: string
    created_at: string
}

export function adminActivityCategoryLabel(category: AdminActivityCategory) {
    if (category === "leadgen") return "Lead Gen"
    return category.slice(0, 1).toUpperCase() + category.slice(1)
}

export async function recordAdminActivity(input: AdminActivityEventInput) {
    if (!input.workspaceId || !input.eventKey.trim() || !input.summary.trim()) return false
    try {
        const { error } = await supabaseAdmin.from("workspace_admin_activity").insert({
            workspace_id: input.workspaceId,
            category: input.category,
            level: input.level ?? "info",
            event_key: input.eventKey.trim(),
            summary: input.summary.trim(),
            entity_type: input.entityType ?? null,
            entity_id: input.entityId ?? null,
            source_href: input.sourceHref ?? null,
            actor_user_id: input.actorUserId ?? null,
            metadata: input.direction ? { ...(input.metadata ?? {}), request_direction: input.direction } : input.metadata ?? {},
            occurred_at: input.occurredAt ?? new Date().toISOString(),
        })
        if (error) console.warn("Could not record Admin activity", { eventKey: input.eventKey, message: error.message })
        return !error
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

export async function listAdminActivity(workspaceId: string, limit = 250): Promise<AdminActivityEvent[]> {
    const { data, error } = await supabaseAdmin.from("workspace_admin_activity")
        .select("id, category, level, event_key, summary, entity_type, entity_id, source_href, actor_user_id, metadata, occurred_at, created_at")
        .eq("workspace_id", workspaceId)
        .order("occurred_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(Math.max(1, Math.min(500, limit)))
    if (error) return []
    return (data ?? []) as AdminActivityEvent[]
}

export async function listAdminActivitySince(workspaceId: string, since: string): Promise<AdminActivityEvent[]> {
    const pageSize = 1000
    const events: AdminActivityEvent[] = []
    for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabaseAdmin.from("workspace_admin_activity")
            .select("id, category, level, event_key, summary, entity_type, entity_id, source_href, actor_user_id, metadata, occurred_at, created_at")
            .eq("workspace_id", workspaceId)
            .gte("occurred_at", since)
            .order("occurred_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, from + pageSize - 1)
        if (error) return events
        const page = (data ?? []) as AdminActivityEvent[]
        events.push(...page)
        if (page.length < pageSize) return events
    }
}
