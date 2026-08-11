import { ONBOARDING_FORMS } from "@/lib/onboarding/forms"
import * as Y from "yjs"
import { MODULES } from "@/lib/onboarding/modules"
import { SERVICES } from "@/lib/onboarding/services"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import { supabaseAdmin } from "@/lib/supabase/admin"
import type {
    ConfiguredOnboardingField,
    ConfiguredOnboardingStep,
    MandatoryModuleConfiguration,
    OnboardingBookendDefinition,
    OnboardingBuilderData,
    OnboardingHelpSettings,
    OnboardingModuleDefinition,
    OnboardingModuleSummary,
    PublishedOnboardingConfiguration,
    OnboardingServiceDefinition,
    OnboardingSettingsPageData,
    OnboardingThemeDefinition,
    OnboardingThemeSlot,
} from "@/lib/onboarding/configuration-types"
import { DEFAULT_ONBOARDING_THEME } from "@/lib/onboarding/theme"
import { createPrivateUploadSignedUrl } from "@/lib/onboarding/uploads"
import { modulePublishDiff } from "@/lib/onboarding/publish-impact"
import {
    upgradeBookendToV2,
    upgradeModuleToV2,
    type OnboardingBlock,
    type OnboardingBookendDefinitionV2,
    type OnboardingModuleDefinitionV2,
    type OnboardingStepV2,
    type VideoBlock,
} from "@/lib/onboarding/block-definition"

type UnknownRow = Record<string, unknown>

function record(value: unknown): UnknownRow {
    return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRow : {}
}

function text(...values: unknown[]) {
    return values.find((value) => typeof value === "string") as string | undefined
}

function integer(...values: unknown[]) {
    const value = values.find((item) => typeof item === "number" && Number.isFinite(item))
    return typeof value === "number" ? Math.round(value) : 0
}

function bool(...values: unknown[]) {
    const value = values.find((item) => typeof item === "boolean")
    return value === true
}

function array(value: unknown) {
    return Array.isArray(value) ? value : []
}

function stableLegacyId(kind: string, key: string) {
    return `legacy:${kind}:${key}`
}

function fallbackField(formKey: string, field: (typeof ONBOARDING_FORMS)[string]["fields"][number]): ConfiguredOnboardingField {
    return {
        id: stableLegacyId("field", `${formKey}:${field.name}`),
        key: field.name,
        label: field.label,
        type: field.type,
        required: Boolean(field.required),
        helpText: field.helpText ?? "",
        placeholder: field.placeholder ?? "",
        accept: field.accept ?? "any",
        multiple: Boolean(field.multiple),
    }
}

function fallbackModules() {
    return Object.values(MODULES).map<OnboardingModuleDefinition>((module) => ({
        id: stableLegacyId("module", module.key),
        revisionId: stableLegacyId("module-revision", module.key),
        code: module.key,
        name: module.title,
        description: "",
        isTest: false,
        status: "published",
        version: 1,
        lastEditedAt: null,
        lastEditedBy: null,
        steps: module.steps.map((step) => {
            const form = step.formKey ? ONBOARDING_FORMS[step.formKey] : null
            return {
                id: stableLegacyId("step", `${module.key}:${step.key}`),
                key: step.key,
                kind: step.kind,
                title: step.title,
                description: step.description,
                estimatedTime: step.kind === "video" ? "2 minutes" : "2–3 minutes",
                why: step.kind === "video"
                    ? "This video shows you exactly what to do, so you do not need to guess your way through account settings."
                    : "This information helps us set up your project correctly and avoid delays later.",
                videoUrl: step.videoUrl ?? "",
                videoPath: null,
                fields: form?.fields.map((field) => fallbackField(form.key, field)) ?? [],
            }
        }),
    }))
}

function fallbackServices(modules: OnboardingModuleDefinition[]) {
    const moduleByCode = new Map(modules.map((moduleDefinition) => [moduleDefinition.code, moduleDefinition]))
    return Object.values(SERVICES).map<OnboardingServiceDefinition>((service, index) => ({
        id: stableLegacyId("service", service.key),
        revisionId: stableLegacyId("service-revision", service.key),
        code: service.key,
        name: service.title,
        description: service.description,
        state: "active",
        version: 1,
        isTest: false,
        defaultPriceCents: 0,
        currency: "USD",
        defaultAssigneeId: null,
        displayPriority: index + 1,
        modules: service.requiredModuleKeys.flatMap((moduleCode, sortOrder) => {
            const moduleDefinition = moduleByCode.get(moduleCode)
            return moduleDefinition ? [{ moduleId: moduleDefinition.id, moduleCode, moduleName: moduleDefinition.name, sortOrder }] : []
        }),
        archiveBlockers: [],
        lastEditedAt: null,
    }))
}

function defaultBookend(kind: "welcome" | "completion"): OnboardingBookendDefinition {
    return {
        id: stableLegacyId("bookend", kind),
        revisionId: stableLegacyId("bookend-revision", kind),
        kind,
        title: kind === "welcome" ? "Welcome" : "All done",
        body: kind === "welcome"
            ? "We’ll explain how this onboarding works and what we need from you."
            : "You have completed the onboarding steps.",
        videoUrl: "",
        videoPath: null,
        version: 1,
        status: "published",
        lastEditedAt: null,
        lastEditedBy: null,
    }
}

function defaultTheme(): OnboardingThemeDefinition {
    const swatches = Object.entries(DEFAULT_ONBOARDING_THEME).map(([slot, hex]) => ({ id: `default-${slot}`, name: slot.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()), hex, hidden: false }))
    return {
        id: null,
        swatches,
        assignments: Object.fromEntries(swatches.map((swatch) => [swatch.id.replace("default-", ""), swatch.id])) as OnboardingThemeDefinition["assignments"],
        updatedAt: null,
        updatedBy: null,
    }
}

export function legacyPublishedOnboardingConfiguration(): PublishedOnboardingConfiguration {
    const modules = fallbackModules()
    return {
        schemaReady: false,
        modules,
        services: fallbackServices(modules),
        mandatory: mapMandatory([], []),
        welcome: defaultBookend("welcome"),
        completion: defaultBookend("completion"),
        theme: defaultTheme(),
        help: mapHelp([], false, null, false),
    }
}

function mapField(value: unknown, index: number, stepKey: string): ConfiguredOnboardingField {
    const field = record(value)
    const key = text(field.key, field.name) ?? `field-${index + 1}`
    const fieldType = text(field.type)
    return {
        id: text(field.id) ?? `${stepKey}:${key}`,
        key,
        label: text(field.label) ?? `Field ${index + 1}`,
        type: ["text", "email", "tel", "url", "textarea", "file"].includes(fieldType ?? "") ? fieldType as ConfiguredOnboardingField["type"] : "text",
        required: bool(field.required),
        helpText: text(field.helpText, field.help_text) ?? "",
        placeholder: text(field.placeholder) ?? "",
        accept: ["image", "video", "document", "any"].includes(text(field.accept) ?? "") ? text(field.accept) as ConfiguredOnboardingField["accept"] : "any",
        multiple: bool(field.multiple),
    }
}

function mapStep(value: unknown, index: number, moduleCode: string): ConfiguredOnboardingStep {
    const step = record(value)
    const key = text(step.key, step.code) ?? `step-${index + 1}`
    const kind = text(step.kind, step.type) === "video" ? "video" : "form"
    return {
        id: text(step.id) ?? `${moduleCode}:${key}`,
        key,
        kind,
        title: text(step.title, step.name) ?? `Step ${index + 1}`,
        description: text(step.description) ?? "",
        estimatedTime: text(step.estimatedTime, step.estimated_time) ?? (kind === "video" ? "2 minutes" : "2–3 minutes"),
        why: text(step.why, step.why_we_ask) ?? "",
        videoUrl: text(step.videoUrl, step.video_url) ?? "",
        videoPath: text(step.videoPath, step.video_path) ?? null,
        fields: array(step.fields).map((field, fieldIndex) => mapField(field, fieldIndex, key)),
        blocks: Number(step.schemaVersion) === 2 || Array.isArray(step.blocks) ? array(step.blocks) as OnboardingBlock[] : undefined,
        navigation: step.navigation && typeof step.navigation === "object" ? {
            backLabel: text(record(step.navigation).backLabel) ?? "Back",
            continueLabel: text(record(step.navigation).continueLabel) ?? "Complete and continue",
        } : undefined,
    }
}

function moduleStatus(row: UnknownRow, revision: UnknownRow): OnboardingModuleDefinition["status"] {
    const status = text(revision.state, revision.status, row.status)
    if (status === "archived" || row.archived_at) return "archived"
    if (status === "published" || revision.published_at || bool(revision.is_published)) return "published"
    return "draft"
}

function mapModule(row: UnknownRow, revision?: UnknownRow): OnboardingModuleDefinition {
    const source = revision ?? {}
    const definition = record(source.definition ?? source.content)
    const code = text(row.internal_code, row.code, row.key) ?? text(definition.code) ?? text(row.id) ?? "module"
    const steps = array(definition.steps ?? source.steps)
    return {
        id: text(row.id) ?? stableLegacyId("module", code),
        revisionId: text(source.id) ?? null,
        code,
        name: text(source.name, source.title, definition.name, definition.title, row.name, row.title) ?? code,
        description: text(source.description, definition.description, row.description) ?? "",
        isTest: bool(source.is_test, definition.isTest, definition.is_test, row.is_test),
        status: moduleStatus(row, source),
        version: Math.max(1, integer(source.revision_number, source.version, row.version)),
        steps: steps.map((step, index) => mapStep(step, index, code)),
        lastEditedAt: text(source.updated_at, source.created_at, row.updated_at) ?? null,
        lastEditedBy: text(source.updated_by, source.created_by, row.updated_by) ?? null,
        schemaVersion: Number(definition.schemaVersion) === 2 ? 2 : 1,
    }
}

function selectRevision(row: UnknownRow, revisions: UnknownRow[], preferDraft: boolean) {
    const rowId = text(row.id)
    const candidates = revisions.filter((revision) => text(revision.module_id, revision.onboarding_module_id) === rowId)
    const explicitId = preferDraft
        ? text(row.draft_revision_id, row.current_draft_revision_id)
        : text(row.published_revision_id, row.current_revision_id)
    const explicit = explicitId ? revisions.find((revision) => text(revision.id) === explicitId) : null
    if (explicit) return explicit
    const sorted = [...candidates].sort((left, right) => integer(right.version, right.revision_number) - integer(left.version, left.revision_number))
    if (preferDraft) return sorted.find((revision) => text(revision.state, revision.status) === "draft") ?? sorted.find((revision) => text(revision.state, revision.status) === "published") ?? sorted[0]
    return sorted.find((revision) => text(revision.state, revision.status) === "published" || Boolean(revision.published_at))
}

function mapBookend(rows: UnknownRow[], kind: "welcome" | "completion", preferDraft = true): OnboardingBookendDefinition {
    const candidates = rows.filter((row) => text(row.kind, row.configuration_type, row.type) === kind)
    const ordered = [...candidates].sort((left, right) => integer(right.revision_number, right.version) - integer(left.revision_number, left.version))
    const source = preferDraft
        ? ordered.find((row) => text(row.state, row.status) === "draft") ?? ordered.find((row) => text(row.state, row.status) === "published")
        : ordered.find((row) => text(row.state, row.status) === "published" || Boolean(row.published_at))
    if (!source) return defaultBookend(kind)
    const definition = record(source.definition ?? source.content)
    return {
        id: text(source.configuration_id, source.id) ?? stableLegacyId("bookend", kind),
        revisionId: text(source.id) ?? null,
        kind,
        title: text(definition.title, source.title) ?? defaultBookend(kind).title,
        body: text(definition.body, definition.description, source.body) ?? defaultBookend(kind).body,
        videoUrl: text(definition.video_url, definition.videoUrl, source.video_url) ?? "",
        videoPath: text(definition.video_path, definition.videoPath, source.video_path) ?? null,
        version: Math.max(1, integer(source.revision_number, source.version)),
        status: text(source.state, source.status) === "draft" ? "draft" as const : "published" as const,
        lastEditedAt: text(source.updated_at, source.created_at) ?? null,
        lastEditedBy: text(source.updated_by, source.created_by) ?? null,
        schemaVersion: Number(definition.schemaVersion) === 2 ? 2 : 1,
        visualSteps: Number(definition.schemaVersion) === 2 ? array(definition.steps) as OnboardingStepV2[] : undefined,
    }
}

function mapMandatory(rows: UnknownRow[], assignmentRows: UnknownRow[]): MandatoryModuleConfiguration {
    const typed = rows.filter((row) => ["mandatory_modules", "mandatory"].includes(text(row.configuration_type, row.kind, row.type) ?? ""))
    const matching = typed.length ? typed : rows
    const sorted = [...matching].sort((left, right) => integer(right.version, right.revision_number) - integer(left.version, left.revision_number))
    const draft = sorted.find((row) => text(row.state, row.status) === "draft")
    const published = sorted.find((row) => text(row.state, row.status) === "published" || Boolean(row.published_at))
    const moduleIds = (row?: UnknownRow) => {
        const revisionId = text(row?.id)
        const relational = revisionId ? assignmentRows.filter((assignment) => text(assignment.configuration_revision_id) === revisionId).sort((left, right) => integer(left.sort_order) - integer(right.sort_order)).map((assignment) => text(assignment.module_id)).filter((id): id is string => Boolean(id)) : []
        return relational.length ? relational : array(record(row?.definition ?? row?.content).module_ids ?? row?.module_ids).filter((id): id is string => typeof id === "string")
    }
    return {
        draftRevisionId: text(draft?.id) ?? null,
        publishedRevisionId: text(published?.id) ?? null,
        draftModuleIds: moduleIds(draft ?? published),
        publishedModuleIds: moduleIds(published),
        draftVersion: Math.max(1, integer(draft?.version, draft?.revision_number, published?.version)),
        publishedVersion: Math.max(1, integer(published?.version, published?.revision_number)),
    }
}

function mapHelp(
    rows: UnknownRow[],
    whatsappVerified: boolean,
    whatsappNumber: string | null,
    preferDraft = true,
): OnboardingHelpSettings {
    const typed = rows.filter((row) => ["mandatory_modules", "mandatory"].includes(text(row.configuration_type, row.kind, row.type) ?? ""))
    const ordered = [...typed].sort((left, right) => integer(right.revision_number, right.version) - integer(left.revision_number, left.version))
    const draft = ordered.find((row) => text(row.state, row.status) === "draft")
    const published = ordered.find((row) => text(row.state, row.status) === "published" || Boolean(row.published_at))
    const source = preferDraft ? draft ?? published : published
    const definition = record(source?.definition ?? source?.content)
    return {
        text: text(source?.help_text, definition.text, definition.help_text) ?? "Not sure what we’re asking for? Don’t worry. We can walk you through it.",
        whatsappEnabled: bool(source?.whatsapp_enabled, definition.whatsapp_enabled),
        whatsappVerified,
        whatsappNumber,
    }
}

function mapTheme(themeRow: UnknownRow | undefined, swatchRows: UnknownRow[]) {
    if (!themeRow && !swatchRows.length) return defaultTheme()
    const swatches = swatchRows.map((row) => ({
        id: text(row.id) ?? "",
        name: text(row.name, row.label) ?? "Colour",
        hex: text(row.hex_color, row.hex, row.hex_value, row.colour) ?? "#000000",
        hidden: bool(row.hidden, row.is_hidden) || Boolean(row.hidden_at),
    })).filter((swatch) => swatch.id)
    const rawAssignments = record(themeRow?.assignments ?? themeRow?.semantic_assignments)
    const columnNames: Record<OnboardingThemeSlot, string[]> = {
        primary: ["primary_swatch_id", "primary"],
        accent: ["progress_accent_swatch_id", "accent_swatch_id", "progress_swatch_id", "accent"],
        pageBackground: ["page_background_swatch_id", "page_background"],
        surface: ["cards_surface_swatch_id", "surface_swatch_id", "surface"],
        text: ["main_text_swatch_id", "text_swatch_id", "text"],
        mutedText: ["muted_text_swatch_id", "muted_text"],
    }
    const fallback = defaultTheme()
    const allSwatches = swatches.length ? swatches : fallback.swatches
    const assignments = Object.fromEntries(Object.entries(columnNames).map(([slot, aliases]) => {
        const value = aliases.map((alias) => text(rawAssignments[alias], themeRow?.[alias])).find(Boolean)
        return [slot, value ?? fallback.assignments[slot as OnboardingThemeSlot]]
    })) as OnboardingThemeDefinition["assignments"]
    return {
        id: text(themeRow?.id) ?? null,
        swatches: allSwatches,
        assignments,
        updatedAt: text(themeRow?.updated_at, themeRow?.created_at) ?? null,
        updatedBy: text(themeRow?.updated_by, themeRow?.created_by) ?? null,
    }
}

function mapThemeDraftDefinition(value: unknown): OnboardingThemeDefinition | null {
    const definition = record(value)
    if (!Array.isArray(definition.swatches) || !definition.assignments || typeof definition.assignments !== "object") return null
    return {
        id: text(definition.id) ?? null,
        swatches: definition.swatches as OnboardingThemeDefinition["swatches"],
        assignments: record(definition.assignments) as OnboardingThemeDefinition["assignments"],
        updatedAt: text(definition.updatedAt) ?? null,
        updatedBy: text(definition.updatedBy) ?? null,
    }
}

function collaborativeTheme(snapshotBase64: unknown, updates: Array<{ update_base64?: unknown }>) {
    try {
        const document = new Y.Doc()
        if (typeof snapshotBase64 === "string" && snapshotBase64) Y.applyUpdate(document, new Uint8Array(Buffer.from(snapshotBase64, "base64")))
        for (const update of updates) if (typeof update.update_base64 === "string") Y.applyUpdate(document, new Uint8Array(Buffer.from(update.update_base64, "base64")))
        const value = document.getMap("builder").get("theme")
        return mapThemeDraftDefinition(value instanceof Y.AbstractType ? value.toJSON() : value)
    } catch {
        return null
    }
}

function newestTheme(...themes: Array<OnboardingThemeDefinition | null>) {
    return themes.filter((theme): theme is OnboardingThemeDefinition => Boolean(theme)).sort((left, right) => Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? ""))[0] ?? null
}

async function queryRawConfiguration(workspaceId: string) {
    const [moduleResult, revisionResult, serviceResult, serviceRevisionResult, assignmentResult, configurationResult, configurationAssignmentResult, swatchResult, themeResult, integrationResult, relationshipServiceResult, saleItemResult, saleResult, relationshipResult, workItemResult, sessionModuleResult, activeSessionResult] = await Promise.all([
        supabaseAdmin.from("onboarding_modules").select("*").eq("workspace_id", workspaceId),
        supabaseAdmin.from("onboarding_module_revisions").select("*").eq("workspace_id", workspaceId),
        supabaseAdmin.from("onboarding_services").select("*").eq("workspace_id", workspaceId),
        supabaseAdmin.from("onboarding_service_revisions").select("*").eq("workspace_id", workspaceId),
        supabaseAdmin.from("onboarding_service_revision_modules").select("*").eq("workspace_id", workspaceId),
        supabaseAdmin.from("onboarding_configuration_revisions").select("*").eq("workspace_id", workspaceId),
        supabaseAdmin.from("onboarding_configuration_revision_modules").select("*").eq("workspace_id", workspaceId),
        supabaseAdmin.from("onboarding_brand_swatches").select("*").eq("workspace_id", workspaceId),
        supabaseAdmin.from("onboarding_themes").select("*").eq("workspace_id", workspaceId).limit(1),
        supabaseAdmin.from("workspace_integrations").select("provider, enabled, mode, config_hint").eq("workspace_id", workspaceId).eq("provider", "meta_whatsapp").maybeSingle(),
        supabaseAdmin.from("relationship_services").select("service_id, relationship_id").eq("workspace_id", workspaceId).not("service_id", "is", null),
        supabaseAdmin.from("client_sale_items").select("service_id, client_sale_id").eq("workspace_id", workspaceId),
        supabaseAdmin.from("client_sales").select("id, relationship_id, status").eq("workspace_id", workspaceId),
        supabaseAdmin.from("relationships").select("id, status").eq("workspace_id", workspaceId),
        supabaseAdmin.from("work_items").select("status, metadata").eq("workspace_id", workspaceId).not("status", "in", "(done,canceled)"),
        supabaseAdmin.from("relationship_onboarding_session_modules").select("module_id, session_id").eq("workspace_id", workspaceId),
        supabaseAdmin.from("relationship_onboarding_sessions").select("id").eq("workspace_id", workspaceId).eq("status", "active"),
    ])
    const schemaResults = [moduleResult, revisionResult, serviceResult, serviceRevisionResult, assignmentResult, configurationResult, configurationAssignmentResult, swatchResult, themeResult]
    return {
        schemaReady: schemaResults.every((result) => !result.error),
        modules: (moduleResult.data ?? []) as UnknownRow[],
        revisions: (revisionResult.data ?? []) as UnknownRow[],
        services: (serviceResult.data ?? []) as UnknownRow[],
        serviceRevisions: (serviceRevisionResult.data ?? []) as UnknownRow[],
        assignments: (assignmentResult.data ?? []) as UnknownRow[],
        configurations: (configurationResult.data ?? []) as UnknownRow[],
        configurationAssignments: (configurationAssignmentResult.data ?? []) as UnknownRow[],
        swatches: (swatchResult.data ?? []) as UnknownRow[],
        themes: (themeResult.data ?? []) as UnknownRow[],
        whatsapp: integrationResult.data as UnknownRow | null,
        relationshipServices: (relationshipServiceResult.data ?? []) as UnknownRow[],
        saleItems: (saleItemResult.data ?? []) as UnknownRow[],
        sales: (saleResult.data ?? []) as UnknownRow[],
        relationships: (relationshipResult.data ?? []) as UnknownRow[],
        openWorkItems: (workItemResult.data ?? []) as UnknownRow[],
        archiveChecksReady: [relationshipServiceResult, saleItemResult, saleResult, relationshipResult, workItemResult].every((result) => !result.error),
        sessionModules: (sessionModuleResult.data ?? []) as UnknownRow[],
        activeSessions: (activeSessionResult.data ?? []) as UnknownRow[],
    }
}

async function rawConfiguration(workspaceId: string) {
    const raw = await queryRawConfiguration(workspaceId)
    if (!raw.schemaReady || (raw.modules.length > 0 && raw.services.length > 0)) return raw

    const seedModules = fallbackModules()
    const seedServices = fallbackServices(seedModules)
    const seedTheme = defaultTheme()
    const { error } = await supabaseAdmin.rpc("ensure_workspace_onboarding_seeded", {
        p_workspace_id: workspaceId,
        p_actor_user_id: null,
        p_modules: seedModules.map((moduleDefinition) => ({
            code: moduleDefinition.code,
            name: moduleDefinition.name,
            description: moduleDefinition.description,
            isTest: moduleDefinition.isTest,
            steps: moduleDefinition.steps,
        })),
        p_services: seedServices.map((service) => ({
            code: service.code,
            name: service.name,
            description: service.description,
            defaultPriceCents: service.defaultPriceCents,
            currency: service.currency,
            defaultAssigneeUserId: service.defaultAssigneeId,
            isTest: service.isTest,
            displayPriority: service.displayPriority,
            modules: service.modules.map((assignment) => ({ moduleCode: assignment.moduleCode })),
        })),
        p_mandatory_module_codes: ["general-info"],
        p_welcome: defaultBookend("welcome"),
        p_completion: defaultBookend("completion"),
        p_swatches: seedTheme.swatches,
        p_assignments: seedTheme.assignments,
    })
    if (error) return { ...raw, schemaReady: false }
    return queryRawConfiguration(workspaceId)
}

function currentServiceRevision(service: UnknownRow, revisions: UnknownRow[]) {
    const serviceId = text(service.id)
    const revisionId = text(service.current_revision_id, service.published_revision_id)
    return revisions.find((revision) => text(revision.id) === revisionId)
        ?? revisions.filter((revision) => text(revision.service_id, revision.onboarding_service_id) === serviceId).sort((left, right) => integer(right.version, right.revision_number) - integer(left.version, left.revision_number))[0]
}

function serviceArchiveBlockers(raw: Awaited<ReturnType<typeof queryRawConfiguration>>) {
    const blockers = new Map<string, string[]>()
    const add = (serviceId: string, message: string) => blockers.set(serviceId, [...(blockers.get(serviceId) ?? []), message])
    const terminalRelationshipStatuses = new Set(["completed", "lost", "archived"])
    const terminalSaleStatuses = new Set([
        "void",
        "voided",
        "canceled",
        "cancelled",
        "uncollectible",
        "marked_uncollectible",
        "invoice_inactive",
    ])
    const relationshipStatus = new Map(raw.relationships.map((relationship) => [text(relationship.id), text(relationship.status)]))
    const saleById = new Map(raw.sales.map((sale) => [text(sale.id), sale]))

    if (!raw.archiveChecksReady) {
        for (const service of raw.services) {
            const serviceId = text(service.id)
            if (serviceId) add(serviceId, "Archive availability could not be verified.")
        }
        return blockers
    }

    const activeRelationshipCounts = new Map<string, number>()
    for (const selection of raw.relationshipServices) {
        const serviceId = text(selection.service_id)
        const status = relationshipStatus.get(text(selection.relationship_id))
        if (!serviceId || (status && terminalRelationshipStatuses.has(status))) continue
        activeRelationshipCounts.set(serviceId, (activeRelationshipCounts.get(serviceId) ?? 0) + 1)
    }
    for (const [serviceId, count] of activeRelationshipCounts) add(serviceId, `${count} active relationship obligation${count === 1 ? "" : "s"}`)

    const saleCounts = new Map<string, number>()
    for (const item of raw.saleItems) {
        const serviceId = text(item.service_id)
        const sale = saleById.get(text(item.client_sale_id))
        const relatedStatus = sale ? relationshipStatus.get(text(sale.relationship_id)) : undefined
        const saleStatus = text(sale?.status)
        if (!serviceId || (saleStatus && terminalSaleStatuses.has(saleStatus)) || (relatedStatus && terminalRelationshipStatuses.has(relatedStatus))) continue
        saleCounts.set(serviceId, (saleCounts.get(serviceId) ?? 0) + 1)
    }
    for (const [serviceId, count] of saleCounts) add(serviceId, `${count} open invoice or sale obligation${count === 1 ? "" : "s"}`)

    const workCounts = new Map<string, number>()
    for (const item of raw.openWorkItems) {
        const serviceId = text(record(item.metadata).service_id)
        if (!serviceId) continue
        workCounts.set(serviceId, (workCounts.get(serviceId) ?? 0) + 1)
    }
    for (const [serviceId, count] of workCounts) add(serviceId, `${count} open service-linked work item${count === 1 ? "" : "s"}`)
    return blockers
}

function mapServices(rows: UnknownRow[], revisions: UnknownRow[], assignments: UnknownRow[], modules: OnboardingModuleDefinition[], computedBlockers = new Map<string, string[]>()) {
    const moduleById = new Map(modules.map((moduleDefinition) => [moduleDefinition.id, moduleDefinition]))
    return rows.map<OnboardingServiceDefinition>((row, rowIndex) => {
        const revision = currentServiceRevision(row, revisions) ?? {}
        const definition = record(revision.definition ?? revision.content)
        const revisionId = text(revision.id)
        const serviceAssignments = assignments.filter((assignment) => text(assignment.service_revision_id, assignment.onboarding_service_revision_id) === revisionId)
            .sort((left, right) => integer(left.sort_order, left.position) - integer(right.sort_order, right.position))
        const embeddedModuleIds = array(definition.module_ids).filter((id): id is string => typeof id === "string")
        const moduleIds = serviceAssignments.length
            ? serviceAssignments.map((assignment) => text(assignment.module_id, assignment.onboarding_module_id)).filter((id): id is string => Boolean(id))
            : embeddedModuleIds
        const status = text(row.state, row.status)
        const code = text(row.internal_code, row.code, row.key) ?? text(row.id) ?? `service-${rowIndex + 1}`
        return {
            id: text(row.id) ?? stableLegacyId("service", code),
            revisionId: revisionId ?? null,
            code,
            name: text(revision.name, revision.title, definition.name, row.name, row.title) ?? code,
            description: text(revision.description, definition.description, row.description) ?? "",
            state: status === "archived" || row.archived_at ? "archived" : status === "retired" || row.retired_at ? "retired" : "active",
            version: Math.max(1, integer(revision.version, revision.revision_number, row.version)),
            isTest: bool(revision.is_test, definition.isTest, definition.is_test, row.is_test),
            defaultPriceCents: Math.max(0, integer(revision.default_price_cents, definition.default_price_cents, row.default_price_cents)),
            currency: (text(revision.currency, definition.currency, row.currency) ?? "USD").toUpperCase(),
            defaultAssigneeId: text(revision.default_assignee_user_id, revision.default_assignee_id, definition.default_assignee_user_id, definition.default_assignee_id, row.default_assignee_id) ?? null,
            displayPriority: integer(revision.display_priority, definition.display_priority, row.display_priority) || rowIndex + 1,
            modules: moduleIds.flatMap((moduleId, sortOrder) => {
                const moduleDefinition = moduleById.get(moduleId)
                return moduleDefinition ? [{ moduleId, moduleCode: moduleDefinition.code, moduleName: moduleDefinition.name, sortOrder }] : []
            }),
            archiveBlockers: [...array(row.archive_blockers).filter((item): item is string => typeof item === "string"), ...(computedBlockers.get(text(row.id) ?? "") ?? [])],
            lastEditedAt: text(revision.updated_at, revision.created_at, row.updated_at) ?? null,
        }
    })
}

async function loadAssignees(workspaceId: string) {
    const { data: memberships } = await supabaseAdmin.from("workspace_memberships").select("user_id, role").eq("workspace_id", workspaceId).order("created_at")
    const userIds = (memberships ?? []).map((membership) => membership.user_id)
    if (!userIds.length) return []
    const { data: profiles } = await supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", userIds)
    const profileById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]))
    return userIds.map((id) => {
        const profile = profileById.get(id)
        const name = profile?.username ?? id
        return { id, name, avatarSrc: profile?.avatar_path ? profileAvatarUrl(name, profile.avatar_path) : null }
    })
}

async function loadBuilderCollaborators(workspaceId: string) {
    const { data: memberships } = await supabaseAdmin.from("workspace_memberships").select("user_id, role").eq("workspace_id", workspaceId).in("role", ["owner", "admin"]).order("created_at")
    const userIds = (memberships ?? []).map((membership) => membership.user_id)
    if (!userIds.length) return []
    const { data: profiles } = await supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", userIds)
    const profileById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]))
    return userIds.map((id) => {
        const profile = profileById.get(id)
        const name = profile?.username ?? id
        return { id, name, avatarSrc: profile?.avatar_path ? profileAvatarUrl(name, profile.avatar_path) : null }
    })
}

export async function loadOnboardingSettingsPageData(workspaceId: string): Promise<OnboardingSettingsPageData> {
    const [raw, assignees, themeDraftResult, builderDocumentResult, builderUpdatesResult] = await Promise.all([
        rawConfiguration(workspaceId),
        loadAssignees(workspaceId),
        supabaseAdmin.from("onboarding_theme_revisions").select("definition").eq("workspace_id", workspaceId).eq("status", "draft").maybeSingle(),
        supabaseAdmin.from("onboarding_builder_documents").select("snapshot_base64").eq("workspace_id", workspaceId).maybeSingle(),
        supabaseAdmin.from("onboarding_builder_updates").select("update_base64").eq("workspace_id", workspaceId).order("sequence").limit(2_000),
    ])
    const publishedModules = raw.modules.length
        ? raw.modules.map((row) => mapModule(row, selectRevision(row, raw.revisions, false)))
        : fallbackModules()
    const services = raw.services.length ? mapServices(raw.services, raw.serviceRevisions, raw.assignments, publishedModules, serviceArchiveBlockers(raw)) : fallbackServices(publishedModules)
    const mandatory = mapMandatory(raw.configurations, raw.configurationAssignments)
    const usage = new Map<string, Array<{ id: string; name: string }>>()
    for (const service of services) {
        if (service.state !== "active") continue
        for (const assignment of service.modules) usage.set(assignment.moduleId, [...(usage.get(assignment.moduleId) ?? []), { id: service.id, name: service.name }])
    }
    const mandatoryIds = new Set(mandatory.publishedModuleIds)
    const modules = publishedModules.map<OnboardingModuleSummary>((moduleDefinition) => ({
        ...moduleDefinition,
        stepCount: moduleDefinition.steps.length,
        fieldCount: moduleDefinition.steps.reduce((count, step) => count + step.fields.length, 0),
        mandatory: mandatoryIds.has(moduleDefinition.id),
        usedBy: usage.get(moduleDefinition.id) ?? [],
    }))
    const whatsappHint = record(raw.whatsapp?.config_hint)
    const whatsappVerified = bool(raw.whatsapp?.enabled) && Boolean(whatsappHint.verified_at)
    return {
        schemaReady: raw.schemaReady,
        services,
        modules,
        mandatory,
        welcome: mapBookend(raw.configurations, "welcome"),
        completion: mapBookend(raw.configurations, "completion"),
        theme: newestTheme(
            mapThemeDraftDefinition(themeDraftResult.data?.definition),
            collaborativeTheme(builderDocumentResult.data?.snapshot_base64, builderUpdatesResult.data ?? []),
            mapTheme(raw.themes[0], raw.swatches),
        ) ?? defaultTheme(),
        help: mapHelp(raw.configurations, whatsappVerified, text(whatsappHint.phone_number, whatsappHint.display_phone_number) ?? null),
        assignees,
    }
}

async function hydrateVisualModule(
    base: OnboardingModuleDefinition,
    rawDefinition: UnknownRow,
): Promise<OnboardingModuleDefinitionV2> {
    const visual = Number(rawDefinition.schemaVersion) === 2
        ? upgradeModuleToV2({ ...base, schemaVersion: 2 as const, steps: array(rawDefinition.steps) } as OnboardingModuleDefinitionV2)
        : upgradeModuleToV2(base)
    return {
        ...visual,
        steps: await Promise.all(visual.steps.map(async (step) => ({
            ...step,
            blocks: await Promise.all(step.blocks.map(async (block) => {
                if (block.kind !== "video" || !block.upload?.path) return block
                return { ...block, upload: { ...block.upload, resolvedUrl: await createPrivateUploadSignedUrl(block.upload.path) } } as VideoBlock
            })),
        }))),
    }
}

async function hydrateVisualBookend(
    base: OnboardingBookendDefinition,
    rawDefinition: UnknownRow,
): Promise<OnboardingBookendDefinitionV2> {
    const visual = Number(rawDefinition.schemaVersion) === 2
        ? upgradeBookendToV2({ ...upgradeBookendToV2(base), schemaVersion: 2 as const, steps: array(rawDefinition.steps) } as OnboardingBookendDefinitionV2)
        : upgradeBookendToV2(base)
    return {
        ...visual,
        steps: await Promise.all(visual.steps.map(async (step) => ({
            ...step,
            blocks: await Promise.all(step.blocks.map(async (block) => {
                if (block.kind !== "video" || !block.upload?.path) return block
                return { ...block, upload: { ...block.upload, resolvedUrl: await createPrivateUploadSignedUrl(block.upload.path) } } as VideoBlock
            })),
        }))),
    }
}

export async function loadOnboardingBuilderData(workspaceId: string, selectedModuleId?: string | null, currentUserId?: string | null): Promise<OnboardingBuilderData> {
    const raw = await rawConfiguration(workspaceId)
    const rawEditableModules = raw.modules.length
        ? raw.modules.map((row) => mapModule(row, selectRevision(row, raw.revisions, true)))
        : fallbackModules()
    const editableModules = await Promise.all(rawEditableModules.map(async (moduleDefinition) => ({
        ...moduleDefinition,
        steps: await Promise.all(moduleDefinition.steps.map(async (step) => ({
            ...step,
            resolvedVideoUrl: step.videoPath ? await createPrivateUploadSignedUrl(step.videoPath) : step.videoUrl,
        }))),
    })))
    const services = raw.services.length ? mapServices(raw.services, raw.serviceRevisions, raw.assignments, editableModules) : fallbackServices(editableModules)
    const mandatory = mapMandatory(raw.configurations, raw.configurationAssignments)
    const mandatoryIds = new Set([...mandatory.draftModuleIds, ...mandatory.publishedModuleIds])
    const usage = new Map<string, Array<{ id: string; name: string }>>()
    for (const service of services) {
        if (service.state !== "active") continue
        for (const assignment of service.modules) usage.set(assignment.moduleId, [...(usage.get(assignment.moduleId) ?? []), { id: service.id, name: service.name }])
    }
    const modules = editableModules.map<OnboardingModuleSummary>((moduleDefinition) => ({
        ...moduleDefinition,
        stepCount: moduleDefinition.steps.length,
        fieldCount: moduleDefinition.steps.reduce((count, step) => count + step.fields.length, 0),
        mandatory: mandatoryIds.has(moduleDefinition.id),
        usedBy: usage.get(moduleDefinition.id) ?? [],
    }))
    const editorIds = [...new Set(editableModules.map((moduleDefinition) => moduleDefinition.lastEditedBy).filter((id): id is string => Boolean(id)))]
    const { data: profiles } = editorIds.length ? await supabaseAdmin.from("user_profiles").select("user_id, username").in("user_id", editorIds) : { data: [] }
    const activeSessionIds = new Set(raw.activeSessions.map((session) => text(session.id)).filter((id): id is string => Boolean(id)))
    const publishedByModuleId = new Map(raw.modules.flatMap((row) => {
        const publishedRevision = selectRevision(row, raw.revisions, false)
        return publishedRevision ? [[text(row.id) ?? "", mapModule(row, publishedRevision)] as const] : []
    }))
    const publishImpactByModule = Object.fromEntries(editableModules.map((draft) => {
        const serviceNames = services
            .filter((service) => service.state === "active" && service.modules.some((assignment) => assignment.moduleId === draft.id))
            .map((service) => service.name)
        const affectedSessionIds = new Set(raw.sessionModules
            .filter((assignment) => text(assignment.module_id) === draft.id && activeSessionIds.has(text(assignment.session_id) ?? ""))
            .map((assignment) => text(assignment.session_id))
            .filter((id): id is string => Boolean(id)))
        return [draft.id, {
            serviceNames,
            activeSessionCount: affectedSessionIds.size,
            ...modulePublishDiff(draft, publishedByModuleId.get(draft.id)),
        }]
    }))
    const welcome = mapBookend(raw.configurations, "welcome")
    const completion = mapBookend(raw.configurations, "completion")
    const rawRevisionByModuleId = new Map(raw.modules.map((row) => [
        text(row.id) ?? "",
        record(selectRevision(row, raw.revisions, true)?.definition),
    ]))
    const visualModules = await Promise.all(editableModules.map((moduleDefinition) => hydrateVisualModule(
        moduleDefinition,
        rawRevisionByModuleId.get(moduleDefinition.id) ?? {},
    )))
    const selectedWelcomeRow = [...raw.configurations]
        .filter((row) => text(row.configuration_type) === "welcome")
        .sort((left, right) => integer(right.revision_number) - integer(left.revision_number))
        .find((row) => text(row.status) === "draft")
        ?? raw.configurations.find((row) => text(row.configuration_type) === "welcome" && text(row.status) === "published")
    const selectedCompletionRow = [...raw.configurations]
        .filter((row) => text(row.configuration_type) === "completion")
        .sort((left, right) => integer(right.revision_number) - integer(left.revision_number))
        .find((row) => text(row.status) === "draft")
        ?? raw.configurations.find((row) => text(row.configuration_type) === "completion" && text(row.status) === "published")
    const [visualWelcome, visualCompletion, documentResult, updateResult, profileResult, themeDraftResult, collaborators] = await Promise.all([
        hydrateVisualBookend(welcome, record(selectedWelcomeRow?.definition)),
        hydrateVisualBookend(completion, record(selectedCompletionRow?.definition)),
        supabaseAdmin.from("onboarding_builder_documents").select("visual_enabled, version, published_version, snapshot_base64, snapshot_sequence").eq("workspace_id", workspaceId).maybeSingle(),
        supabaseAdmin.from("onboarding_builder_updates").select("sequence, update_id, update_base64").eq("workspace_id", workspaceId).order("sequence").limit(2_000),
        currentUserId ? supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").eq("user_id", currentUserId).maybeSingle() : Promise.resolve({ data: null, error: null }),
        supabaseAdmin.from("onboarding_theme_revisions").select("definition").eq("workspace_id", workspaceId).eq("status", "draft").maybeSingle(),
        loadBuilderCollaborators(workspaceId),
    ])
    const builderTheme = mapThemeDraftDefinition(themeDraftResult.data?.definition) ?? mapTheme(raw.themes[0], raw.swatches)
    const whatsappHint = record(raw.whatsapp?.config_hint)
    const whatsappVerified = bool(raw.whatsapp?.enabled) && Boolean(whatsappHint.verified_at)
    return {
        schemaReady: raw.schemaReady,
        modules,
        moduleDefinitions: editableModules,
        publishedModuleDefinitions: Object.fromEntries(editableModules.map((moduleDefinition) => [moduleDefinition.id, publishedByModuleId.get(moduleDefinition.id) ?? null])),
        selectedModule: editableModules.find((moduleDefinition) => moduleDefinition.id === selectedModuleId) ?? editableModules[0] ?? null,
        welcome: { ...welcome, resolvedVideoUrl: welcome.videoPath ? await createPrivateUploadSignedUrl(welcome.videoPath) : welcome.videoUrl },
        completion: { ...completion, resolvedVideoUrl: completion.videoPath ? await createPrivateUploadSignedUrl(completion.videoPath) : completion.videoUrl },
        theme: builderTheme,
        help: mapHelp(raw.configurations, whatsappVerified, text(whatsappHint.phone_number, whatsappHint.display_phone_number) ?? null, false),
        editors: Object.fromEntries((profiles ?? []).map((profile) => [profile.user_id, profile.username])),
        publishImpactByModule,
        services,
        mandatory,
        visualModules,
        visualWelcome,
        visualCompletion,
        collaboration: {
            visualEnabled: documentResult.data?.visual_enabled !== false,
            version: integer(documentResult.data?.version),
            publishedVersion: integer(documentResult.data?.published_version),
            snapshotBase64: text(documentResult.data?.snapshot_base64) ?? null,
            snapshotSequence: integer(documentResult.data?.snapshot_sequence),
            updates: (updateResult.data ?? []).map((update) => ({
                sequence: Number(update.sequence),
                updateId: String(update.update_id),
                updateBase64: String(update.update_base64),
            })),
            collaborators,
            currentUser: currentUserId ? {
                id: currentUserId,
                name: String(profileResult.data?.username ?? currentUserId),
                avatarSrc: profileResult.data?.avatar_path
                    ? profileAvatarUrl(String(profileResult.data.username ?? currentUserId), String(profileResult.data.avatar_path))
                    : null,
            } : null,
        },
    }
}

export async function loadPublishedOnboardingConfiguration(workspaceId: string): Promise<PublishedOnboardingConfiguration> {
    const raw = await rawConfiguration(workspaceId)
    const modules = raw.modules.length
        ? raw.modules.map((row) => mapModule(row, selectRevision(row, raw.revisions, false))).filter((moduleDefinition) => moduleDefinition.status === "published")
        : fallbackModules()
    const services = raw.services.length ? mapServices(raw.services, raw.serviceRevisions, raw.assignments, modules) : fallbackServices(modules)
    const whatsappHint = record(raw.whatsapp?.config_hint)
    const whatsappVerified = bool(raw.whatsapp?.enabled) && Boolean(whatsappHint.verified_at)
    return {
        schemaReady: raw.schemaReady,
        modules,
        services,
        mandatory: mapMandatory(raw.configurations, raw.configurationAssignments),
        welcome: mapBookend(raw.configurations, "welcome", false),
        completion: mapBookend(raw.configurations, "completion", false),
        theme: mapTheme(raw.themes[0], raw.swatches),
        help: mapHelp(raw.configurations, whatsappVerified, text(whatsappHint.phone_number, whatsappHint.display_phone_number) ?? null, false),
    }
}
