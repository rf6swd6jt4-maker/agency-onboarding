import { supabaseAdmin } from "@/lib/supabase/admin"
import { RELATIONSHIP_PHASES, type RelationshipPhase } from "@/lib/relationship-phases"

export { RELATIONSHIP_PHASES, phaseLabel, type RelationshipPhase } from "@/lib/relationship-phases"
export type RelationshipStatus = "active" | "waiting" | "blocked" | "completed" | "lost" | "archived"
export type RelationshipWorkItemStatus = "todo" | "doing" | "waiting" | "blocked" | "done" | "canceled"
export type AssetKind = "file" | "media" | "document" | "invoice" | "form_submission" | "message" | "lead_evidence" | "other"
export type AssetSourceKind = "upload" | "stripe_invoice" | "onboarding_submission" | "message" | "lead_evidence" | "legacy_note" | "system" | "other"

export type RelationshipRecord = {
    id: string
    workspace_id: string
    client_id: string | null
    leadgen_company_id: string | null
    source_type: "manual" | "client" | "leadgen"
    primary_person_name: string
    primary_email: string | null
    primary_phone: string | null
    whatsapp_phone: string | null
    business_name: string | null
    website_url: string | null
    industry_value: string | null
    location_value: string | null
    address: Record<string, unknown>
    source_label: string | null
    primary_contact_role: string | null
    notes_summary: string | null
    started_onboarding_at: string | null
    seller_user_id: string | null
    fulfilment_manager_user_id: string | null
    project_timeframe_days: number | null
    lifecycle_phase: RelationshipPhase
    status: RelationshipStatus
    source_metadata: Record<string, unknown>
    created_at: string
    updated_at: string
    fallback?: boolean
}

export type RelationshipWorkItem = {
    id: string
    workspace_id: string
    relationship_id: string | null
    title: string
    description: string | null
    lifecycle_phase: RelationshipPhase
    area?: "workspace" | "admin"
    kind?: "standard" | "okr_action" | "maintenance"
    visibility?: "workspace" | "admins_only"
    status: RelationshipWorkItemStatus
    priority: number
    priority_override?: number | null
    execution_owner_id?: string | null
    is_key_task: boolean
    native_kind: string | null
    native_id: string | null
    native_key?: string | null
    native_href: string | null
    planned_start_date: string | null
    planned_start_time?: string | null
    due_date: string | null
    due_time?: string | null
    planned_end_date: string | null
    actual_start_at: string | null
    actual_start_has_time?: boolean
    actual_completed_at: string | null
    actual_completed_has_time?: boolean
    parent_work_item_id?: string | null
    sort_order: number
    metadata: Record<string, unknown>
    created_by?: string | null
    created_at: string
    updated_at: string
    synthesized?: boolean
}

export type WorkItemPerson = {
    user_id: string
    username: string
    avatar_path: string | null
}

export type WorkItemDependencyLink = {
    work_item_id: string
    source: "manual" | "parent_auto"
    work_item: Pick<RelationshipWorkItem, "id" | "title" | "status"> | null
}

export type WorkQueueItem = RelationshipWorkItem & {
    relationship: Pick<RelationshipRecord, "id" | "primary_person_name" | "business_name" | "client_id" | "lifecycle_phase"> | null
}

export type RelationshipAsset = {
    id: string
    workspace_id: string
    relationship_id: string | null
    asset_kind: AssetKind
    asset_type: AssetKind
    source_kind: AssetSourceKind
    title: string
    description: string | null
    storage_path: string | null
    external_url: string | null
    content_type: string | null
    file_size: number | null
    native_kind: string | null
    native_id: string | null
    native_key?: string | null
    metadata: Record<string, unknown>
    created_by: string | null
    created_at: string
    updated_at: string
}

export type AssetRelationshipLink = {
    relationship_id: string
    relationship: Pick<RelationshipRecord, "id" | "primary_person_name" | "business_name" | "client_id" | "lifecycle_phase"> | null
}

export type AssetWorkItemLink = {
    work_item_id: string
    work_item: Pick<RelationshipWorkItem, "id" | "title" | "status" | "lifecycle_phase"> | null
}

type QueryError = { message?: string; code?: string } | null | undefined
type ClientRow = {
    id: string
    workspace_id: string
    name: string | null
    email: string | null
    phone?: string | null
    created_at: string
    archived_at?: string | null
    is_test?: boolean | null
}

const RELATIONSHIP_SELECT = "id, workspace_id, client_id, leadgen_company_id, source_type, primary_person_name, primary_email, primary_phone, whatsapp_phone, business_name, website_url, industry_value, location_value, address, source_label, primary_contact_role, notes_summary, started_onboarding_at, seller_user_id, fulfilment_manager_user_id, project_timeframe_days, lifecycle_phase, status, source_metadata, created_at, updated_at"
const RELATIONSHIP_LEGACY_SELECT = "id, workspace_id, client_id, leadgen_company_id, source_type, primary_person_name, primary_email, primary_phone, business_name, website_url, lifecycle_phase, status, source_metadata, created_at, updated_at"

function isMissingRelationshipSchema(error: QueryError) {
    const message = error?.message?.toLowerCase() ?? ""
    return (
        error?.code === "42P01" ||
        message.includes("relationships") && (
            message.includes("does not exist") ||
            message.includes("schema cache") ||
            message.includes("could not find the table")
        )
    )
}

function isRelationshipColumnDrift(error: QueryError) {
    const message = error?.message?.toLowerCase() ?? ""
    return Boolean(error && (
        message.includes("industry_value") ||
        message.includes("location_value") ||
        message.includes("primary_contact_role") ||
        message.includes("started_onboarding_at") ||
        message.includes("whatsapp_phone") ||
        message.includes("seller_user_id") ||
        message.includes("fulfilment_manager_user_id") ||
        message.includes("project_timeframe_days") ||
        message.includes("relationship_assets")
    ))
}

export function normalizeRelationshipPhase(value: unknown, fallback: RelationshipPhase = "lead"): RelationshipPhase {
    if (value === "found" || value === "qualified") return "lead"
    if (value === "contacted") return "potential_client"
    return RELATIONSHIP_PHASES.some((phase) => phase.key === value)
        ? value as RelationshipPhase
        : fallback
}

function phaseIndex(phase: RelationshipPhase) {
    return RELATIONSHIP_PHASES.findIndex((item) => item.key === phase)
}

export function workspaceHref(workspaceSlug: string, suffix = "") {
    const cleanSuffix = suffix.replace(/^\/+/, "")
    return `/${workspaceSlug}${cleanSuffix ? `/${cleanSuffix}` : ""}`
}

export function relationshipHubHref(workspaceSlug: string, relationshipId: string) {
    return workspaceHref(workspaceSlug, `relationships/${relationshipId}`)
}

export function onboardingDetailHref(workspaceSlug: string, relationshipId: string) {
    return workspaceHref(workspaceSlug, `onboarding/${relationshipId}`)
}

export function fulfilmentDetailHref(workspaceSlug: string, relationshipId: string) {
    return workspaceHref(workspaceSlug, `work/${relationshipId}`)
}

export function workItemHref(workspaceSlug: string, workItemId: string) {
    return workspaceHref(workspaceSlug, `work-items/${workItemId}`)
}

export function assetHref(workspaceSlug: string, assetId: string) {
    return workspaceHref(workspaceSlug, `assets/${assetId}`)
}

export function communicationsHref(workspaceSlug: string) {
    return workspaceHref(workspaceSlug, "communications")
}

function fallbackRelationshipFromClient(client: ClientRow): RelationshipRecord {
    const identity = client.name?.trim() || client.email?.trim() || client.phone?.trim() || "Unknown relationship"
    return {
        id: client.id,
        workspace_id: client.workspace_id,
        client_id: client.id,
        leadgen_company_id: null,
        source_type: "client",
        primary_person_name: identity,
        primary_email: client.email ?? null,
        primary_phone: client.phone ?? null,
        whatsapp_phone: client.phone ?? null,
        business_name: client.name ?? null,
        website_url: null,
        industry_value: null,
        location_value: null,
        address: {},
        source_label: "Legacy onboarding",
        primary_contact_role: null,
        notes_summary: null,
        started_onboarding_at: client.archived_at ? null : client.created_at,
        seller_user_id: null,
        fulfilment_manager_user_id: null,
        project_timeframe_days: null,
        lifecycle_phase: client.archived_at ? "completed_lost" : "onboarding",
        status: client.archived_at ? "archived" : "active",
        source_metadata: { fallback_from: "clients", is_test: Boolean(client.is_test) },
        created_at: client.created_at,
        updated_at: client.created_at,
        fallback: true,
    }
}

async function listClientFallbackRelationships(workspaceId: string) {
    const { data } = await supabaseAdmin
        .from("clients")
        .select("id, workspace_id, name, email, phone, created_at, archived_at, is_test")
        .eq("workspace_id", workspaceId)
        .is("archived_at", null)
        .order("created_at", { ascending: false })

    return ((data ?? []) as ClientRow[]).map(fallbackRelationshipFromClient)
}

export async function listRelationshipsForWorkspace(workspaceId: string): Promise<RelationshipRecord[]> {
    const clientsPromise = listClientFallbackRelationships(workspaceId)
    let relationshipsResult: { data: unknown[] | null; error: { message?: string } | null } = await supabaseAdmin
        .from("relationships")
        .select(RELATIONSHIP_SELECT)
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false })

    if (isRelationshipColumnDrift(relationshipsResult.error)) {
        relationshipsResult = await supabaseAdmin
            .from("relationships")
            .select(RELATIONSHIP_LEGACY_SELECT)
            .eq("workspace_id", workspaceId)
            .order("updated_at", { ascending: false })
    }

    const clients = await clientsPromise

    if (isMissingRelationshipSchema(relationshipsResult.error)) {
        return clients
    }

    const relationships = ((relationshipsResult.data ?? []) as RelationshipRecord[]).map((relationship) => ({
        ...relationship,
        lifecycle_phase: normalizeRelationshipPhase(relationship.lifecycle_phase),
        source_metadata: relationship.source_metadata ?? {},
        address: relationship.address ?? {},
        industry_value: relationship.industry_value ?? null,
        location_value: relationship.location_value ?? null,
        source_label: relationship.source_label ?? null,
        primary_contact_role: relationship.primary_contact_role ?? null,
        notes_summary: relationship.notes_summary ?? null,
        started_onboarding_at: relationship.started_onboarding_at ?? null,
        whatsapp_phone: relationship.whatsapp_phone ?? null,
        seller_user_id: relationship.seller_user_id ?? null,
        fulfilment_manager_user_id: relationship.fulfilment_manager_user_id ?? null,
        project_timeframe_days: relationship.project_timeframe_days ?? null,
    }))
    const wrappedClientIds = new Set(relationships.map((relationship) => relationship.client_id).filter(Boolean))
    const missingClientFallbacks = clients.filter((client) => client.client_id && !wrappedClientIds.has(client.client_id))
    return [...relationships, ...missingClientFallbacks].sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())
}

export async function getRelationship(workspaceId: string, relationshipId: string): Promise<RelationshipRecord | null> {
    let byId: { data: unknown | null; error: { message?: string } | null } = await supabaseAdmin
        .from("relationships")
        .select(RELATIONSHIP_SELECT)
        .eq("workspace_id", workspaceId)
        .eq("id", relationshipId)
        .maybeSingle()

    if (isRelationshipColumnDrift(byId.error)) {
        byId = await supabaseAdmin
            .from("relationships")
            .select(RELATIONSHIP_LEGACY_SELECT)
            .eq("workspace_id", workspaceId)
            .eq("id", relationshipId)
            .maybeSingle()
    }

    if (byId.data) {
        const relationship = byId.data as RelationshipRecord
        return {
            ...relationship,
            lifecycle_phase: normalizeRelationshipPhase(relationship.lifecycle_phase),
            source_metadata: relationship.source_metadata ?? {},
            address: relationship.address ?? {},
            industry_value: relationship.industry_value ?? null,
            location_value: relationship.location_value ?? null,
            source_label: relationship.source_label ?? null,
            primary_contact_role: relationship.primary_contact_role ?? null,
            notes_summary: relationship.notes_summary ?? null,
            started_onboarding_at: relationship.started_onboarding_at ?? null,
            whatsapp_phone: relationship.whatsapp_phone ?? null,
            seller_user_id: relationship.seller_user_id ?? null,
            fulfilment_manager_user_id: relationship.fulfilment_manager_user_id ?? null,
            project_timeframe_days: relationship.project_timeframe_days ?? null,
        }
    }

    if (!isMissingRelationshipSchema(byId.error)) {
        const byClient = await supabaseAdmin
            .from("relationships")
            .select(RELATIONSHIP_SELECT)
            .eq("workspace_id", workspaceId)
            .eq("client_id", relationshipId)
            .maybeSingle()

        if (byClient.data) {
            const relationship = byClient.data as RelationshipRecord
            return {
                ...relationship,
                lifecycle_phase: normalizeRelationshipPhase(relationship.lifecycle_phase),
                source_metadata: relationship.source_metadata ?? {},
                address: relationship.address ?? {},
                industry_value: relationship.industry_value ?? null,
                location_value: relationship.location_value ?? null,
                source_label: relationship.source_label ?? null,
                primary_contact_role: relationship.primary_contact_role ?? null,
                notes_summary: relationship.notes_summary ?? null,
                started_onboarding_at: relationship.started_onboarding_at ?? null,
                whatsapp_phone: relationship.whatsapp_phone ?? null,
                seller_user_id: relationship.seller_user_id ?? null,
                fulfilment_manager_user_id: relationship.fulfilment_manager_user_id ?? null,
                project_timeframe_days: relationship.project_timeframe_days ?? null,
            }
        }
    }

    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("id, workspace_id, name, email, phone, created_at, archived_at, is_test")
        .eq("workspace_id", workspaceId)
        .eq("id", relationshipId)
        .maybeSingle()

    return client ? fallbackRelationshipFromClient(client as ClientRow) : null
}

export async function getRelationshipHubHrefForClient(workspaceSlug: string, workspaceId: string, clientId: string) {
    const result = await supabaseAdmin
        .from("relationships")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("client_id", clientId)
        .maybeSingle()

    const relationshipId = result.data?.id ?? clientId
    return relationshipHubHref(workspaceSlug, relationshipId)
}

function relationshipNativeHref(workspaceSlug: string, relationship: RelationshipRecord) {
    return relationshipHubHref(workspaceSlug, relationship.id)
}

function isMissingPrimitiveSchema(error: QueryError) {
    const message = error?.message?.toLowerCase() ?? ""
    return (
        error?.code === "42P01" ||
        error?.code === "42703" ||
        ["work_items", "work_item_relationships", "assets", "asset_relationships", "asset_work_items"].some((table) =>
            message.includes(table) && (
                message.includes("does not exist") ||
                message.includes("schema cache") ||
                message.includes("could not find the table") ||
                message.includes("could not find")
            )
        )
    )
}

function mapWorkItem(row: Record<string, unknown>, relationshipId: string | null = null): RelationshipWorkItem {
    const dueDate = typeof row.due_date === "string" ? row.due_date : typeof row.planned_end_date === "string" ? row.planned_end_date : null
    return {
        id: String(row.id),
        workspace_id: String(row.workspace_id),
        relationship_id: relationshipId,
        title: String(row.title ?? "Untitled work item"),
        description: typeof row.description === "string" ? row.description : null,
        lifecycle_phase: normalizeRelationshipPhase(row.lifecycle_phase),
        area: row.area === "admin" ? "admin" : "workspace",
        kind: row.kind === "okr_action" || row.kind === "maintenance" ? row.kind : "standard",
        visibility: row.visibility === "admins_only" ? "admins_only" : "workspace",
        status: String(row.status ?? "todo") as RelationshipWorkItemStatus,
        priority: typeof row.priority === "number" ? row.priority : Number(row.priority ?? 3),
        priority_override: typeof row.priority_override === "number" ? row.priority_override : row.priority_override === null ? null : undefined,
        execution_owner_id: typeof row.execution_owner_id === "string" ? row.execution_owner_id : null,
        is_key_task: Boolean(row.is_key_task ?? true),
        native_kind: typeof row.native_kind === "string" ? row.native_kind : null,
        native_id: typeof row.native_id === "string" ? row.native_id : null,
        native_key: typeof row.native_key === "string" ? row.native_key : null,
        native_href: typeof row.native_href === "string" ? row.native_href : null,
        planned_start_date: typeof row.planned_start_date === "string" ? row.planned_start_date : null,
        planned_start_time: typeof row.planned_start_time === "string" ? row.planned_start_time : null,
        due_date: dueDate,
        due_time: typeof row.due_time === "string" ? row.due_time : null,
        planned_end_date: dueDate,
        actual_start_at: typeof row.actual_start_at === "string" ? row.actual_start_at : null,
        actual_start_has_time: Boolean(row.actual_start_has_time),
        actual_completed_at: typeof row.actual_completed_at === "string" ? row.actual_completed_at : null,
        actual_completed_has_time: Boolean(row.actual_completed_has_time),
        parent_work_item_id: typeof row.parent_work_item_id === "string" ? row.parent_work_item_id : null,
        sort_order: typeof row.sort_order === "number" ? row.sort_order : Number(row.sort_order ?? 0),
        metadata: row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {},
        created_by: typeof row.created_by === "string" ? row.created_by : null,
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    }
}

function mapAsset(row: Record<string, unknown>, relationshipId: string | null = null): RelationshipAsset {
    const kind = String(row.asset_kind ?? row.asset_type ?? "other") as AssetKind
    return {
        id: String(row.id),
        workspace_id: String(row.workspace_id),
        relationship_id: relationshipId,
        asset_kind: kind,
        asset_type: kind,
        source_kind: String(row.source_kind ?? "other") as AssetSourceKind,
        title: String(row.title ?? "Untitled asset"),
        description: typeof row.description === "string" ? row.description : null,
        storage_path: typeof row.storage_path === "string" ? row.storage_path : null,
        external_url: typeof row.external_url === "string" ? row.external_url : null,
        content_type: typeof row.content_type === "string" ? row.content_type : null,
        file_size: typeof row.file_size === "number" ? row.file_size : Number.isFinite(Number(row.file_size)) ? Number(row.file_size) : null,
        native_kind: typeof row.native_kind === "string" ? row.native_kind : null,
        native_id: typeof row.native_id === "string" ? row.native_id : null,
        native_key: typeof row.native_key === "string" ? row.native_key : null,
        metadata: row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {},
        created_by: typeof row.created_by === "string" ? row.created_by : null,
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    }
}

function sortWorkItems(left: RelationshipWorkItem, right: RelationshipWorkItem) {
    const phaseDelta = phaseIndex(left.lifecycle_phase) - phaseIndex(right.lifecycle_phase)
    if (phaseDelta !== 0) return phaseDelta
    if (left.sort_order !== right.sort_order) return left.sort_order - right.sort_order
    const leftTime = left.planned_start_date ?? left.actual_start_at ?? left.created_at
    const rightTime = right.planned_start_date ?? right.actual_start_at ?? right.created_at
    return new Date(leftTime).getTime() - new Date(rightTime).getTime()
}

export async function listRelationshipTimelineItems(workspaceSlug: string, relationship: RelationshipRecord): Promise<RelationshipWorkItem[]> {
    const canonicalResult = relationship.fallback
        ? { data: null, error: { message: "fallback relationship" } }
        : await supabaseAdmin
            .from("work_item_relationships")
            .select("work_items!work_item_relationships_work_item_id_fkey(id, workspace_id, title, description, lifecycle_phase, status, priority, is_key_task, native_kind, native_id, native_href, planned_start_date, due_date, actual_start_at, actual_completed_at, sort_order, metadata, created_by, created_at, updated_at)")
            .eq("workspace_id", relationship.workspace_id)
            .eq("relationship_id", relationship.id)
            .order("created_at", { ascending: true })

    let storedItems = isMissingPrimitiveSchema(canonicalResult.error)
        ? []
        : ((canonicalResult.data ?? []) as Array<{ work_items: Record<string, unknown> | Record<string, unknown>[] }>).flatMap((row) => {
            const item = Array.isArray(row.work_items) ? row.work_items[0] : row.work_items
            return item ? [mapWorkItem(item, relationship.id)] : []
        })

    if (storedItems.length === 0 && !relationship.fallback) {
        const legacyResult = await supabaseAdmin
            .from("relationship_work_items")
            .select("id, workspace_id, relationship_id, title, description, lifecycle_phase, status, priority, is_key_task, native_kind, native_id, native_href, planned_start_date, planned_end_date, actual_start_at, actual_completed_at, sort_order, metadata, created_at, updated_at")
            .eq("workspace_id", relationship.workspace_id)
            .eq("relationship_id", relationship.id)
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: true })

        storedItems = isMissingRelationshipSchema(legacyResult.error)
            ? []
            : ((legacyResult.data ?? []) as Array<Record<string, unknown>>).map((item) => mapWorkItem(item, relationship.id))
    }

    const synthesized: RelationshipWorkItem[] = []
    const now = new Date().toISOString()

    if (relationship.source_type === "leadgen" || relationship.leadgen_company_id) {
        synthesized.push({
            id: `leadgen-${relationship.leadgen_company_id ?? relationship.id}`,
            workspace_id: relationship.workspace_id,
            relationship_id: relationship.id,
            title: "Qualified lead promoted",
            description: "Human-created Relationship from a qualified leadgen company.",
            lifecycle_phase: "lead",
            status: "done",
            priority: 2,
            is_key_task: true,
            native_kind: "leadgen_company",
            native_id: relationship.leadgen_company_id,
                native_href: workspaceHref(workspaceSlug, "leadgen"),
            planned_start_date: null,
            due_date: null,
            planned_end_date: null,
            actual_start_at: relationship.created_at,
            actual_completed_at: relationship.created_at,
            sort_order: 5,
            metadata: {},
            created_at: relationship.created_at,
            updated_at: relationship.updated_at,
            synthesized: true,
        })
    }

    if (relationship.client_id) {
        const [
            { data: progressRows },
            { data: activityRows },
            { data: saleRows },
        ] = await Promise.all([
            supabaseAdmin
                .from("client_progress")
                .select("id, step_key, completed_at, created_at")
                .eq("client_id", relationship.client_id)
                .order("created_at", { ascending: true }),
            supabaseAdmin
                .from("client_activity")
                .select("id, activity_type, activity_text, created_at")
                .eq("client_id", relationship.client_id)
                .order("created_at", { ascending: true })
                .limit(16),
            supabaseAdmin
                .from("client_sales")
                .select("id, status, upfront_total_amount, recurring_total_amount, currency, created_at, updated_at, stripe_checkout_url")
                .eq("client_id", relationship.client_id)
                .order("created_at", { ascending: true }),
        ])

        synthesized.push({
            id: `client-${relationship.client_id}`,
            workspace_id: relationship.workspace_id,
            relationship_id: relationship.id,
                title: "Onboarding opened",
                description: "Client onboarding record exists in Betelgeze.",
                lifecycle_phase: "onboarding",
            status: relationship.status === "archived" ? "done" : "doing",
            priority: 2,
            is_key_task: true,
            native_kind: "client",
            native_id: relationship.client_id,
            native_href: onboardingDetailHref(workspaceSlug, relationship.id),
            planned_start_date: relationship.created_at.slice(0, 10),
            due_date: null,
            planned_end_date: null,
            actual_start_at: relationship.created_at,
            actual_completed_at: null,
            sort_order: 10,
            metadata: {},
            created_at: relationship.created_at,
            updated_at: relationship.updated_at,
            synthesized: true,
        })

        for (const sale of saleRows ?? []) {
            const paid = ["paid", "test_paid", "paid_awaiting_whatsapp_confirm", "whatsapp_confirmed", "onboarding_created", "onboarding_link_sent"].includes(String(sale.status))
            synthesized.push({
                id: `sale-${sale.id}`,
                workspace_id: relationship.workspace_id,
                relationship_id: relationship.id,
                title: paid ? "Payment complete" : "Payment in progress",
                description: "Payment activity tracked by Betelgeze.",
                lifecycle_phase: "invoiced",
                status: paid ? "done" : "doing",
                priority: paid ? 3 : 1,
                is_key_task: true,
                native_kind: "client_sale",
                native_id: sale.id,
                native_href: relationshipHubHref(workspaceSlug, relationship.id),
                planned_start_date: String(sale.created_at).slice(0, 10),
                due_date: null,
                planned_end_date: null,
                actual_start_at: sale.created_at,
                actual_completed_at: paid ? sale.updated_at ?? sale.created_at : null,
                sort_order: 8,
                metadata: {},
                created_at: sale.created_at,
                updated_at: sale.updated_at ?? sale.created_at,
                synthesized: true,
            })
        }

        for (const row of progressRows ?? []) {
            synthesized.push({
                id: `progress-${row.id}`,
                workspace_id: relationship.workspace_id,
                relationship_id: relationship.id,
                title: `Completed ${String(row.step_key).replace(/-/g, " ")}`,
                description: "Completed onboarding step.",
                lifecycle_phase: "onboarding",
                status: "done",
                priority: 4,
                is_key_task: false,
                native_kind: "client_progress",
                native_id: row.id,
                native_href: onboardingDetailHref(workspaceSlug, relationship.id),
                planned_start_date: null,
                due_date: null,
                planned_end_date: null,
                actual_start_at: row.created_at,
                actual_completed_at: row.completed_at ?? row.created_at,
                sort_order: 20,
                metadata: {},
                created_at: row.created_at,
                updated_at: row.completed_at ?? row.created_at,
                synthesized: true,
            })
        }

        for (const row of activityRows ?? []) {
            synthesized.push({
                id: `activity-${row.id}`,
                workspace_id: relationship.workspace_id,
                relationship_id: relationship.id,
                title: row.activity_text,
                description: `Activity type: ${row.activity_type}`,
                lifecycle_phase: "onboarding",
                status: "done",
                priority: 5,
                is_key_task: false,
                native_kind: "client_activity",
                native_id: row.id,
                native_href: onboardingDetailHref(workspaceSlug, relationship.id),
                planned_start_date: null,
                due_date: null,
                planned_end_date: null,
                actual_start_at: row.created_at,
                actual_completed_at: row.created_at,
                sort_order: 30,
                metadata: {},
                created_at: row.created_at,
                updated_at: row.created_at,
                synthesized: true,
            })
        }
    }

    if (storedItems.length + synthesized.length === 0) {
        synthesized.push({
            id: `next-${relationship.id}`,
            workspace_id: relationship.workspace_id,
            relationship_id: relationship.id,
            title: "Decide next action",
            description: "No work items have been attached yet.",
            lifecycle_phase: relationship.lifecycle_phase,
            status: "todo",
            priority: 2,
            is_key_task: true,
            native_kind: "relationship",
            native_id: relationship.id,
            native_href: relationshipHubHref(workspaceSlug, relationship.id),
            planned_start_date: now.slice(0, 10),
            due_date: null,
            planned_end_date: null,
            actual_start_at: null,
            actual_completed_at: null,
            sort_order: 1,
            metadata: {},
            created_at: now,
            updated_at: now,
            synthesized: true,
        })
    }

    const deduped = new Map<string, RelationshipWorkItem>()
    for (const item of [...storedItems, ...synthesized]) {
        const key = `${item.native_kind ?? "item"}:${item.native_id ?? item.id}:${item.title}`
        if (!deduped.has(key)) deduped.set(key, item)
    }
    return [...deduped.values()].sort(sortWorkItems)
}

export async function listWorkQueueItems(workspaceSlug: string, workspaceId: string): Promise<WorkQueueItem[]> {
    const result = await supabaseAdmin
        .from("work_items")
        .select("id, workspace_id, title, description, lifecycle_phase, area, kind, visibility, status, priority, is_key_task, native_kind, native_id, native_href, planned_start_date, due_date, actual_start_at, actual_completed_at, sort_order, metadata, created_by, created_at, updated_at")
        .eq("workspace_id", workspaceId)
        .eq("visibility", "workspace")
        .not("status", "in", "(done,canceled)")
        .order("priority", { ascending: true })
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(80)

    if (!isMissingPrimitiveSchema(result.error) && result.data?.length) {
        const items = (result.data ?? []).map((row) => mapWorkItem(row as Record<string, unknown>))
        const itemIds = items.map((item) => item.id)
        const { data: links } = itemIds.length
            ? await supabaseAdmin
                .from("work_item_relationships")
                .select("work_item_id, relationship_id, relationships(id, primary_person_name, business_name, client_id, lifecycle_phase)")
                .eq("workspace_id", workspaceId)
                .in("work_item_id", itemIds)
            : { data: [] }
        const relationshipByWorkItem = new Map<string, WorkQueueItem["relationship"]>()
        for (const link of links ?? []) {
            if (relationshipByWorkItem.has(link.work_item_id)) continue
            const relationship = Array.isArray(link.relationships) ? link.relationships[0] : link.relationships
            relationshipByWorkItem.set(link.work_item_id, relationship ? {
                ...relationship,
                lifecycle_phase: normalizeRelationshipPhase(relationship.lifecycle_phase),
            } : null)
        }
        return items.map((item) => {
            const relationship = relationshipByWorkItem.get(item.id) ?? null
            return {
                ...item,
                relationship_id: relationship?.id ?? null,
                relationship,
            }
        })
    }

    const legacyResult = await supabaseAdmin
        .from("relationship_work_items")
        .select("id, workspace_id, relationship_id, title, description, lifecycle_phase, status, priority, is_key_task, native_kind, native_id, native_href, planned_start_date, planned_end_date, actual_start_at, actual_completed_at, sort_order, metadata, created_at, updated_at, relationships!inner(id, primary_person_name, business_name, client_id, lifecycle_phase)")
        .eq("workspace_id", workspaceId)
        .not("status", "in", "(done,canceled)")
        .order("priority", { ascending: true })
        .order("planned_end_date", { ascending: true, nullsFirst: false })
        .limit(80)

    if (!isMissingRelationshipSchema(legacyResult.error) && legacyResult.data?.length) {
        return legacyResult.data.map((row) => {
            const relationship = Array.isArray(row.relationships) ? row.relationships[0] : row.relationships
            return {
                ...mapWorkItem(row as Record<string, unknown>, row.relationship_id),
                relationship: {
                    ...relationship,
                    lifecycle_phase: normalizeRelationshipPhase(relationship.lifecycle_phase),
                },
            } as WorkQueueItem
        })
    }

    const relationships = await listRelationshipsForWorkspace(workspaceId)
    return relationships
        .filter((relationship) => relationship.status === "active" || relationship.status === "waiting" || relationship.status === "blocked")
        .slice(0, 50)
        .map((relationship) => ({
            id: `queue-${relationship.id}`,
            workspace_id: workspaceId,
            relationship_id: relationship.id,
            title: relationship.client_id ? "Continue onboarding" : "Decide next action",
            description: relationship.business_name ? `Relationship context: ${relationship.business_name}` : null,
            lifecycle_phase: relationship.lifecycle_phase,
            status: relationship.status === "blocked" ? "blocked" : "todo",
            priority: relationship.status === "blocked" ? 1 : 3,
            is_key_task: true,
            native_kind: relationship.client_id ? "client" : "relationship",
            native_id: relationship.client_id ?? relationship.id,
            native_href: relationship.client_id ? onboardingDetailHref(workspaceSlug, relationship.id) : relationshipHubHref(workspaceSlug, relationship.id),
            planned_start_date: relationship.created_at.slice(0, 10),
            due_date: null,
            planned_end_date: null,
            actual_start_at: null,
            actual_completed_at: null,
            sort_order: 0,
            metadata: {},
            created_at: relationship.created_at,
            updated_at: relationship.updated_at,
            synthesized: true,
            relationship: {
                id: relationship.id,
                primary_person_name: relationship.primary_person_name,
                business_name: relationship.business_name,
                client_id: relationship.client_id,
                lifecycle_phase: relationship.lifecycle_phase,
            },
        }))
}

export async function listWorkspaceWorkItems(workspaceId: string): Promise<RelationshipWorkItem[]> {
    const result = await supabaseAdmin
        .from("work_items")
        .select("id, workspace_id, title, description, lifecycle_phase, area, kind, visibility, status, priority, is_key_task, native_kind, native_id, native_href, planned_start_date, due_date, actual_start_at, actual_completed_at, sort_order, metadata, created_by, created_at, updated_at")
        .eq("workspace_id", workspaceId)
        .eq("visibility", "workspace")
        .order("updated_at", { ascending: false })
        .limit(160)

    if (isMissingPrimitiveSchema(result.error)) return []
    return ((result.data ?? []) as Array<Record<string, unknown>>).map((row) => mapWorkItem(row))
}

export async function listWorkspaceAssets(workspaceId: string): Promise<RelationshipAsset[]> {
    const result = await supabaseAdmin
        .from("assets")
        .select("id, workspace_id, title, description, asset_kind, source_kind, storage_path, external_url, content_type, file_size, native_kind, native_id, metadata, created_by, created_at, updated_at")
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false })
        .limit(160)

    if (isMissingPrimitiveSchema(result.error)) return []
    return ((result.data ?? []) as Array<Record<string, unknown>>).map((row) => mapAsset(row))
}

export function nativeItemHref(workspaceSlug: string, item: RelationshipWorkItem) {
    if (!item.synthesized) return workItemHref(workspaceSlug, item.id)
    if (item.relationship_id && (item.native_kind === "client" || item.native_href?.startsWith("/admin/client/"))) return relationshipHubHref(workspaceSlug, item.relationship_id)
    if (item.native_href?.startsWith("/")) return item.native_href
    return item.relationship_id ? relationshipHubHref(workspaceSlug, item.relationship_id) : workItemHref(workspaceSlug, item.id)
}

export function relationshipSearchHaystack(relationship: RelationshipRecord) {
    return [
        relationship.primary_person_name,
        relationship.primary_email,
        relationship.primary_phone,
        relationship.business_name,
        relationship.website_url,
        relationship.industry_value,
        relationship.location_value,
        relationship.source_label,
        relationship.primary_contact_role,
        relationship.notes_summary,
        relationship.lifecycle_phase,
    ].filter(Boolean).join(" ").toLowerCase()
}

export function relationshipNativeLocation(workspaceSlug: string, relationship: RelationshipRecord) {
    return relationshipNativeHref(workspaceSlug, relationship)
}

export function relationshipLocationLabel(relationship: Pick<RelationshipRecord, "address" | "location_value">) {
    const address = relationship.address && typeof relationship.address === "object" ? relationship.address : {}
    const city = typeof address.city === "string" && address.city.trim() ? address.city.trim() : ""
    const locality = typeof address.locality === "string" && address.locality.trim() ? address.locality.trim() : ""
    const state = typeof address.state === "string" && address.state.trim()
        ? address.state.trim()
        : typeof address.region === "string" && address.region.trim()
            ? address.region.trim()
            : ""
    const place = [city || locality, state].filter(Boolean).join(", ")
    if (place) return place
    return relationship.location_value ? relationship.location_value.replace(/_/g, " ") : null
}

export function relationshipIndustryLabel(value: string | null | undefined) {
    return value ? value.replace(/_/g, " ") : null
}

export async function listRelationshipAssets(workspaceId: string, relationshipId: string): Promise<RelationshipAsset[]> {
    const canonicalResult = await supabaseAdmin
        .from("asset_relationships")
        .select("assets!inner(id, workspace_id, title, description, asset_kind, source_kind, storage_path, external_url, content_type, file_size, native_kind, native_id, metadata, created_by, created_at, updated_at)")
        .eq("workspace_id", workspaceId)
        .eq("relationship_id", relationshipId)
        .order("created_at", { ascending: false })
        .limit(120)

    if (!isMissingPrimitiveSchema(canonicalResult.error)) {
        return ((canonicalResult.data ?? []) as Array<{ assets: Record<string, unknown> | Record<string, unknown>[] }>).flatMap((row) => {
            const asset = Array.isArray(row.assets) ? row.assets[0] : row.assets
            return asset ? [mapAsset(asset, relationshipId)] : []
        })
    }

    const legacyResult = await supabaseAdmin
        .from("relationship_assets")
        .select("id, workspace_id, relationship_id, asset_type, title, description, storage_path, external_url, native_kind, native_id, metadata, created_by, created_at, updated_at")
        .eq("workspace_id", workspaceId)
        .eq("relationship_id", relationshipId)
        .order("created_at", { ascending: false })
        .limit(120)

    if (isMissingRelationshipSchema(legacyResult.error) || isRelationshipColumnDrift(legacyResult.error)) return []

    return ((legacyResult.data ?? []) as Array<Record<string, unknown>>).map((asset) => mapAsset(asset, relationshipId))
}

export async function countOpenWorkItemsByRelationship(workspaceId: string) {
    const workResult = await supabaseAdmin
        .from("work_items")
        .select("id, status")
        .eq("workspace_id", workspaceId)
        .eq("visibility", "workspace")
        .not("status", "in", "(done,canceled)")
        .limit(500)

    const counts = new Map<string, number>()
    if (!isMissingPrimitiveSchema(workResult.error)) {
        const ids = (workResult.data ?? []).map((row) => row.id)
        const { data: links } = ids.length
            ? await supabaseAdmin
                .from("work_item_relationships")
                .select("relationship_id")
                .eq("workspace_id", workspaceId)
                .in("work_item_id", ids)
                .limit(1000)
            : { data: [] }
        for (const row of links ?? []) {
            counts.set(row.relationship_id, (counts.get(row.relationship_id) ?? 0) + 1)
        }
        return counts
    }

    const legacyResult = await supabaseAdmin
        .from("relationship_work_items")
        .select("relationship_id, status")
        .eq("workspace_id", workspaceId)
        .not("status", "in", "(done,canceled)")
        .limit(500)

    if (isMissingRelationshipSchema(legacyResult.error)) return counts
    for (const row of legacyResult.data ?? []) {
        counts.set(row.relationship_id, (counts.get(row.relationship_id) ?? 0) + 1)
    }
    return counts
}

export async function getWorkItem(workspaceId: string, workItemId: string): Promise<RelationshipWorkItem | null> {
    const result = await supabaseAdmin
        .from("work_items")
        .select("id, workspace_id, title, description, lifecycle_phase, area, kind, visibility, status, priority, priority_override, execution_owner_id, is_key_task, native_kind, native_id, native_href, planned_start_date, planned_start_time, due_date, due_time, actual_start_at, actual_start_has_time, actual_completed_at, actual_completed_has_time, parent_work_item_id, sort_order, metadata, created_by, created_at, updated_at")
        .eq("workspace_id", workspaceId)
        .eq("id", workItemId)
        .maybeSingle()

    if (isMissingPrimitiveSchema(result.error) || !result.data) return null
    return mapWorkItem(result.data as Record<string, unknown>)
}

export async function getWorkItemPlanningContext(workspaceId: string, item: RelationshipWorkItem) {
    const visibility = item.visibility
    const [parentResult, dependenciesResult, assigneesResult, membersResult, workItemsResult] = await Promise.all([
        item.parent_work_item_id
            ? supabaseAdmin.from("work_items").select("id, title, status").eq("workspace_id", workspaceId).eq("id", item.parent_work_item_id).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        supabaseAdmin.from("work_item_dependencies")
            .select("depends_on_work_item_id, source, work_items!work_item_dependencies_depends_on_work_item_id_fkey(id, title, status)")
            .eq("workspace_id", workspaceId).eq("work_item_id", item.id).order("created_at"),
        supabaseAdmin.from("work_item_assignees").select("user_id").eq("workspace_id", workspaceId).eq("work_item_id", item.id),
        visibility === "admins_only"
            ? supabaseAdmin.from("workspace_memberships").select("user_id").eq("workspace_id", workspaceId).in("role", ["owner", "admin"])
            : supabaseAdmin.from("workspace_memberships").select("user_id").eq("workspace_id", workspaceId),
        supabaseAdmin.from("work_items").select("id, title, status, parent_work_item_id").eq("workspace_id", workspaceId).eq("visibility", visibility).neq("id", item.id).order("title"),
    ])

    const memberIds = [...new Set([
        ...(membersResult.data ?? []).map((row) => row.user_id),
        item.created_by,
    ].filter((value): value is string => Boolean(value)))]
    const profilesResult = memberIds.length
        ? await supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", memberIds)
        : { data: [] }
    const people = (profilesResult.data ?? []) as WorkItemPerson[]
    const peopleById = new Map(people.map((person) => [person.user_id, person]))

    return {
        parent: parentResult.data ? mapWorkItem({ ...parentResult.data, workspace_id: workspaceId }) : null,
        dependencies: (dependenciesResult.data ?? []).map((row) => {
            const linked = Array.isArray(row.work_items) ? row.work_items[0] : row.work_items
            return {
                work_item_id: row.depends_on_work_item_id,
                source: row.source as "manual" | "parent_auto",
                work_item: linked ? {
                    id: linked.id,
                    title: linked.title,
                    status: linked.status as RelationshipWorkItemStatus,
                } : null,
            } satisfies WorkItemDependencyLink
        }),
        assignees: (assigneesResult.data ?? []).flatMap((row) => {
            const person = peopleById.get(row.user_id)
            return person ? [person] : []
        }),
        creator: item.created_by ? peopleById.get(item.created_by) ?? null : null,
        members: (membersResult.data ?? []).flatMap((row) => {
            const person = peopleById.get(row.user_id)
            return person ? [person] : []
        }),
        availableWorkItems: (workItemsResult.data ?? []).map((row) => ({
            id: row.id,
            title: row.title,
            status: row.status as RelationshipWorkItemStatus,
            parent_work_item_id: row.parent_work_item_id,
        })),
    }
}

export async function listWorkItemRelationships(workspaceId: string, workItemId: string): Promise<AssetRelationshipLink[]> {
    const result = await supabaseAdmin
        .from("work_item_relationships")
        .select("relationship_id, relationships(id, primary_person_name, business_name, client_id, lifecycle_phase)")
        .eq("workspace_id", workspaceId)
        .eq("work_item_id", workItemId)
        .order("created_at", { ascending: false })

    if (isMissingPrimitiveSchema(result.error)) return []

    return (result.data ?? []).map((row) => {
        const relationship = Array.isArray(row.relationships) ? row.relationships[0] : row.relationships
        return {
            relationship_id: row.relationship_id,
            relationship: relationship ? {
                ...relationship,
                lifecycle_phase: normalizeRelationshipPhase(relationship.lifecycle_phase),
            } : null,
        }
    })
}

export async function getAsset(workspaceId: string, assetId: string): Promise<RelationshipAsset | null> {
    const result = await supabaseAdmin
        .from("assets")
        .select("id, workspace_id, title, description, asset_kind, source_kind, storage_path, external_url, content_type, file_size, native_kind, native_id, metadata, created_by, created_at, updated_at")
        .eq("workspace_id", workspaceId)
        .eq("id", assetId)
        .maybeSingle()

    if (isMissingPrimitiveSchema(result.error) || !result.data) return null
    return mapAsset(result.data as Record<string, unknown>)
}

export async function listAssetRelationships(workspaceId: string, assetId: string): Promise<AssetRelationshipLink[]> {
    const result = await supabaseAdmin
        .from("asset_relationships")
        .select("relationship_id, relationships(id, primary_person_name, business_name, client_id, lifecycle_phase)")
        .eq("workspace_id", workspaceId)
        .eq("asset_id", assetId)
        .order("created_at", { ascending: false })

    if (isMissingPrimitiveSchema(result.error)) return []

    return (result.data ?? []).map((row) => {
        const relationship = Array.isArray(row.relationships) ? row.relationships[0] : row.relationships
        return {
            relationship_id: row.relationship_id,
            relationship: relationship ? {
                ...relationship,
                lifecycle_phase: normalizeRelationshipPhase(relationship.lifecycle_phase),
            } : null,
        }
    })
}

export async function listAssetWorkItems(workspaceId: string, assetId: string): Promise<AssetWorkItemLink[]> {
    const result = await supabaseAdmin
        .from("asset_work_items")
        .select("work_item_id, work_items(id, title, status, lifecycle_phase)")
        .eq("workspace_id", workspaceId)
        .eq("asset_id", assetId)
        .order("created_at", { ascending: false })

    if (isMissingPrimitiveSchema(result.error)) return []

    return (result.data ?? []).map((row) => {
        const workItem = Array.isArray(row.work_items) ? row.work_items[0] : row.work_items
        return {
            work_item_id: row.work_item_id,
            work_item: workItem ? {
                ...workItem,
                lifecycle_phase: normalizeRelationshipPhase(workItem.lifecycle_phase),
            } : null,
        }
    })
}

export async function listWorkItemAssets(workspaceId: string, workItemId: string): Promise<RelationshipAsset[]> {
    const result = await supabaseAdmin
        .from("asset_work_items")
        .select("assets!inner(id, workspace_id, title, description, asset_kind, source_kind, storage_path, external_url, content_type, file_size, native_kind, native_id, native_key, metadata, created_by, created_at, updated_at)")
        .eq("workspace_id", workspaceId)
        .eq("work_item_id", workItemId)
        .order("created_at", { ascending: false })

    if (isMissingPrimitiveSchema(result.error)) return []

    return ((result.data ?? []) as Array<{ assets: Record<string, unknown> | Record<string, unknown>[] }>).flatMap((row) => {
        const asset = Array.isArray(row.assets) ? row.assets[0] : row.assets
        return asset ? [mapAsset(asset)] : []
    })
}
