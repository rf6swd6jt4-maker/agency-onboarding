import { createHash } from "crypto"
import type {
    ConfiguredOnboardingField,
    ConfiguredOnboardingStep,
    MandatoryModuleConfiguration,
    OnboardingBookendDefinition,
    OnboardingModuleDefinition,
    OnboardingServiceDefinition,
} from "@/lib/onboarding/configuration-types"
import type { FileAccept, FormFieldType } from "@/lib/onboarding/forms"
import type { OnboardingBlock } from "@/lib/onboarding/block-definition"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { orderOnboardingServices, resolveOrderedModuleSources } from "./session-composition-order"

export type SessionSnapshotField = {
    id: string
    sourceFieldId: string | null
    legacyFieldName: string | null
    type: FormFieldType
    label: string
    required: boolean
    helpText: string
    placeholder: string
    accept: FileAccept
    multiple: boolean
    sortOrder: number
}

export type SessionSnapshotStep = {
    id: string
    sessionModuleId: string | null
    sourceStepId: string | null
    moduleRevisionId: string | null
    bookendRevisionId: string | null
    bookendKind: "welcome" | "completion" | null
    kind: "form" | "video" | "welcome" | "completion"
    title: string
    description: string
    moduleTitle: string
    estimatedTime: string
    why: string
    videoUrl: string
    videoPath: string | null
    sortOrder: number
    legacyStepKey: string | null
    legacyFormKey: string | null
    fields: SessionSnapshotField[]
    blocks: Array<OnboardingBlock & { sessionBlockId?: string; sourceBlockId?: string }>
    navigation: { backLabel: string; continueLabel: string }
    actionable: boolean
}

export type SessionSnapshotModule = {
    id: string
    moduleId: string
    moduleRevisionId: string
    sourceKind: "mandatory" | "service"
    sourceServiceRevisionId: string | null
    sortOrder: number
    title: string
    description: string
    isTest: boolean
    steps: SessionSnapshotStep[]
}

export type SessionCompositionSnapshot = {
    schemaVersion: 1 | 2
    configurationRevisionId: string | null
    welcomeRevisionId: string | null
    completionRevisionId: string | null
    serviceRevisionIds: string[]
    modules: Array<{
        moduleId: string
        moduleRevisionId: string
        sourceKind: "mandatory" | "service"
        sourceServiceRevisionId: string | null
        sortOrder: number
    }>
    stepCount: number
    fieldCount: number
}

export type ComposedOnboardingSession = {
    configurationRevisionId: string | null
    welcomeRevisionId: string | null
    completionRevisionId: string | null
    serviceRevisionIds: string[]
    modules: Array<Omit<SessionSnapshotModule, "id" | "steps"> & {
        steps: Array<Omit<SessionSnapshotStep, "id" | "sessionModuleId" | "fields"> & {
            fields: Array<Omit<SessionSnapshotField, "id">>
        }>
    }>
    bookends: Array<Omit<SessionSnapshotStep, "id" | "sessionModuleId" | "fields"> & {
        fields: Array<Omit<SessionSnapshotField, "id">>
    }>
    audit: SessionCompositionSnapshot
    compositionHash: string
}

type ComposeInput = {
    purchasedServices: OnboardingServiceDefinition[]
    modules: OnboardingModuleDefinition[]
    mandatory: MandatoryModuleConfiguration
    welcome: OnboardingBookendDefinition
    completion: OnboardingBookendDefinition
    configurationRevisionId?: string | null
}

function composedField(field: ConfiguredOnboardingField, sortOrder: number): Omit<SessionSnapshotField, "id"> {
    return {
        sourceFieldId: field.id || null,
        legacyFieldName: field.key || null,
        type: field.type,
        label: field.label,
        required: field.required,
        helpText: field.helpText,
        placeholder: field.placeholder,
        accept: field.accept,
        multiple: field.multiple,
        sortOrder,
    }
}

function composedStep(
    step: ConfiguredOnboardingStep,
    module: OnboardingModuleDefinition,
    sortOrder: number
): Omit<SessionSnapshotStep, "id" | "sessionModuleId" | "fields"> & { fields: Array<Omit<SessionSnapshotField, "id">> } {
    return {
        sourceStepId: step.id || null,
        moduleRevisionId: module.revisionId,
        bookendRevisionId: null,
        bookendKind: null,
        kind: step.kind,
        title: step.title,
        description: step.description,
        moduleTitle: module.name,
        estimatedTime: step.estimatedTime,
        why: step.why,
        videoUrl: step.videoUrl,
        videoPath: step.videoPath,
        sortOrder,
        legacyStepKey: step.key || null,
        legacyFormKey: step.kind === "form" ? step.key || null : null,
        fields: step.fields.map((field, index) => composedField(field, index * 10)),
        blocks: step.blocks ?? [],
        navigation: step.navigation ?? { backLabel: "Back", continueLabel: "Complete and continue" },
        actionable: true,
    }
}

function composedBookend(
    bookend: OnboardingBookendDefinition,
    kind: "welcome" | "completion",
    sortOrder: number
): Omit<SessionSnapshotStep, "id" | "sessionModuleId" | "fields"> & { fields: Array<Omit<SessionSnapshotField, "id">> } {
    return {
        sourceStepId: null,
        moduleRevisionId: null,
        bookendRevisionId: bookend.revisionId,
        bookendKind: kind,
        kind,
        title: bookend.title,
        description: bookend.body,
        moduleTitle: kind === "welcome" ? "General" : "Finished",
        estimatedTime: kind === "welcome" ? "2 minutes" : "No action needed",
        why: kind === "welcome"
            ? "This helps us make sure you know exactly what happens next before we ask for any business details."
            : "Once onboarding is complete, our team can review everything and start preparing your project properly.",
        videoUrl: bookend.videoUrl,
        videoPath: bookend.videoPath,
        sortOrder,
        legacyStepKey: kind === "welcome" ? "welcome-video" : "final",
        legacyFormKey: null,
        fields: [],
        blocks: [],
        navigation: { backLabel: "Back", continueLabel: kind === "welcome" ? "Start onboarding" : "Continue" },
        actionable: kind !== "completion",
    }
}

function hashComposition(value: SessionCompositionSnapshot) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

export function composeOnboardingSession(input: ComposeInput): ComposedOnboardingSession {
    const moduleById = new Map(input.modules.map((moduleDefinition) => [moduleDefinition.id, moduleDefinition]))
    const moduleByCode = new Map(input.modules.map((moduleDefinition) => [moduleDefinition.code, moduleDefinition]))
    const orderedServices = orderOnboardingServices(input.purchasedServices)
    const mandatoryIds = input.mandatory.publishedModuleIds.length
        ? input.mandatory.publishedModuleIds
        : input.modules.some((moduleDefinition) => moduleDefinition.code === "general-info" && moduleDefinition.id.startsWith("legacy:"))
            ? [moduleByCode.get("general-info")!.id]
            : []
    const orderedSources = resolveOrderedModuleSources({
        services: orderedServices,
        modules: input.modules,
        mandatoryModuleIds: mandatoryIds,
    })
    const modules = orderedSources.map((source, moduleIndex) => {
        const moduleDefinition = moduleById.get(source.moduleId)!
        return {
        moduleId: moduleDefinition.id,
        moduleRevisionId: moduleDefinition.revisionId!,
        sourceKind: source.sourceKind,
        sourceServiceRevisionId: source.sourceServiceRevisionId,
        sortOrder: moduleIndex * 10,
        title: moduleDefinition.name,
        description: moduleDefinition.description,
        isTest: moduleDefinition.isTest,
        steps: moduleDefinition.steps.map((step, stepIndex) => composedStep(step, moduleDefinition, stepIndex * 10)),
    }})
    const welcome = composedBookend(input.welcome, "welcome", 0)
    const completion = composedBookend(input.completion, "completion", (modules.reduce((count, module) => count + module.steps.length, 0) + 1) * 10)
    const schemaVersion = input.modules.some((module) => module.schemaVersion === 2)
        || input.welcome.schemaVersion === 2
        || input.completion.schemaVersion === 2 ? 2 : 1
    const bookendStepCount = (input.welcome.visualSteps?.length ?? 1) + (input.completion.visualSteps?.length ?? 1)
    const audit: SessionCompositionSnapshot = {
        schemaVersion,
        configurationRevisionId: input.configurationRevisionId ?? input.mandatory.publishedRevisionId,
        welcomeRevisionId: input.welcome.revisionId,
        completionRevisionId: input.completion.revisionId,
        serviceRevisionIds: orderedServices.map((service) => service.revisionId!).filter(Boolean),
        modules: modules.map((module) => ({
            moduleId: module.moduleId,
            moduleRevisionId: module.moduleRevisionId,
            sourceKind: module.sourceKind,
            sourceServiceRevisionId: module.sourceServiceRevisionId,
            sortOrder: module.sortOrder,
        })),
        stepCount: bookendStepCount + modules.reduce((count, module) => count + module.steps.length, 0),
        fieldCount: modules.reduce((count, module) => count + module.steps.reduce((stepCount, step) => stepCount + step.fields.length, 0), 0),
    }
    return {
        configurationRevisionId: audit.configurationRevisionId,
        welcomeRevisionId: audit.welcomeRevisionId,
        completionRevisionId: audit.completionRevisionId,
        serviceRevisionIds: audit.serviceRevisionIds,
        modules,
        bookends: [welcome, completion],
        audit,
        compositionHash: hashComposition(audit),
    }
}

type SnapshotSession = {
    id: string
    workspace_id: string
    snapshot_schema_version?: number | null
}

function text(value: unknown) {
    return typeof value === "string" ? value : null
}

function number(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function isMissingSnapshotSchema(error: { code?: string; message?: string } | null | undefined) {
    const message = error?.message?.toLowerCase() ?? ""
    return error?.code === "42P01" || error?.code === "42703" || message.includes("schema cache") || message.includes("does not exist")
}

export async function loadNormalizedSessionSnapshot(session: SnapshotSession) {
    if (!session.snapshot_schema_version) return null
    let stepQuery = supabaseAdmin.from("relationship_onboarding_session_steps").select("*").eq("workspace_id", session.workspace_id).eq("session_id", session.id).order("sort_order")
    if (Number(session.snapshot_schema_version) >= 2) stepQuery = stepQuery.is("superseded_at", null)
    const [moduleResult, stepResult, fieldResult, blockResult] = await Promise.all([
        supabaseAdmin.from("relationship_onboarding_session_modules").select("*").eq("workspace_id", session.workspace_id).eq("session_id", session.id).order("sort_order"),
        stepQuery,
        supabaseAdmin.from("relationship_onboarding_session_fields").select("*").eq("workspace_id", session.workspace_id).eq("session_id", session.id).order("sort_order"),
        supabaseAdmin.from("relationship_onboarding_session_blocks").select("*").eq("workspace_id", session.workspace_id).eq("session_id", session.id).order("sort_order"),
    ])
    const error = moduleResult.error ?? stepResult.error ?? fieldResult.error
    if (error) {
        if (isMissingSnapshotSchema(error)) return null
        throw new Error(error.message)
    }
    if (!stepResult.data?.length) return null

    const blocksByStep = new Map<string, Array<OnboardingBlock & { sessionBlockId?: string; sourceBlockId?: string }>>()
    if (!blockResult.error) {
        for (const row of blockResult.data ?? []) {
            const definition = row.definition && typeof row.definition === "object" && !Array.isArray(row.definition)
                ? row.definition as unknown as OnboardingBlock
                : null
            if (!definition || !["header", "form", "video", "button"].includes(String(definition.kind))) continue
            const stepId = String(row.session_step_id)
            blocksByStep.set(stepId, [...(blocksByStep.get(stepId) ?? []), {
                ...definition,
                id: String(row.source_block_id),
                sessionBlockId: String(row.id),
                sourceBlockId: String(row.source_block_id),
            }])
        }
    }

    const fieldsByStep = new Map<string, SessionSnapshotField[]>()
    for (const row of fieldResult.data ?? []) {
        const field: SessionSnapshotField = {
            id: String(row.id),
            sourceFieldId: text(row.source_field_id),
            legacyFieldName: text(row.legacy_field_name),
            type: ["text", "email", "tel", "url", "textarea", "file"].includes(String(row.type)) ? row.type as FormFieldType : "text",
            label: String(row.label ?? "Field"),
            required: Boolean(row.required),
            helpText: String(row.help_text ?? ""),
            placeholder: String(row.placeholder ?? ""),
            accept: ["image", "video", "document", "any"].includes(String(row.file_accept)) ? row.file_accept as FileAccept : "any",
            multiple: Boolean(row.multiple),
            sortOrder: number(row.sort_order),
        }
        const stepId = String(row.session_step_id)
        fieldsByStep.set(stepId, [...(fieldsByStep.get(stepId) ?? []), field])
    }

    const moduleRows = new Map((moduleResult.data ?? []).map((row) => [String(row.id), row]))
    const steps = (stepResult.data ?? []).map<SessionSnapshotStep>((row) => {
        const moduleRow = row.session_module_id ? moduleRows.get(String(row.session_module_id)) : null
        const legacyStepKey = text(row.legacy_step_key)
        const kind = ["form", "video", "welcome", "completion"].includes(String(row.kind))
            ? row.kind as SessionSnapshotStep["kind"]
            : legacyStepKey === "final" ? "completion" : "video"
        const bookendKind = kind === "welcome" || kind === "completion" ? kind : null
        return {
            id: String(row.id),
            sessionModuleId: text(row.session_module_id),
            sourceStepId: text(row.source_step_id),
            moduleRevisionId: text(row.module_revision_id),
            bookendRevisionId: text(row.bookend_revision_id),
            bookendKind,
            kind,
            title: String(row.title ?? "Onboarding step"),
            description: String(row.description ?? ""),
            moduleTitle: String(moduleRow?.title ?? (bookendKind === "completion" ? "Finished" : "General")),
            estimatedTime: String(row.estimated_time ?? (kind === "completion" ? "No action needed" : "2–3 minutes")),
            why: String(row.why_we_ask ?? ""),
            videoUrl: String(row.video_url ?? ""),
            videoPath: text(row.video_storage_path),
            sortOrder: number(row.sort_order),
            legacyStepKey,
            legacyFormKey: text(row.legacy_form_key),
            fields: fieldsByStep.get(String(row.id)) ?? [],
            blocks: blocksByStep.get(String(row.id)) ?? [],
            navigation: row.navigation && typeof row.navigation === "object" ? {
                backLabel: String((row.navigation as Record<string, unknown>).backLabel ?? "Back"),
                continueLabel: String((row.navigation as Record<string, unknown>).continueLabel ?? "Complete and continue"),
            } : { backLabel: "Back", continueLabel: "Complete and continue" },
            actionable: row.is_actionable !== false,
        }
    })
    const stepsByModule = new Map<string, SessionSnapshotStep[]>()
    for (const step of steps) {
        if (step.sessionModuleId) stepsByModule.set(step.sessionModuleId, [...(stepsByModule.get(step.sessionModuleId) ?? []), step])
    }
    const modules = (moduleResult.data ?? []).map<SessionSnapshotModule>((row) => ({
        id: String(row.id),
        moduleId: String(row.module_id),
        moduleRevisionId: String(row.module_revision_id),
        sourceKind: row.source_kind === "mandatory" ? "mandatory" : "service",
        sourceServiceRevisionId: text(row.source_service_revision_id),
        sortOrder: number(row.sort_order),
        title: String(row.title ?? "Onboarding module"),
        description: String(row.description ?? ""),
        isTest: Boolean(row.is_test),
        steps: stepsByModule.get(String(row.id)) ?? [],
    }))
    return {
        modules,
        steps,
        schemaVersion: Number(session.snapshot_schema_version ?? 1),
        actionableSteps: Number(session.snapshot_schema_version ?? 1) >= 2
            ? steps.filter((step) => step.actionable)
            : steps.filter((step) => step.kind !== "completion"),
        completionStep: Number(session.snapshot_schema_version ?? 1) >= 2
            ? null
            : steps.find((step) => step.kind === "completion") ?? null,
    }
}

export function formDefinitionFromSnapshot(step: SessionSnapshotStep) {
    if (step.kind !== "form") return null
    return {
        key: step.id,
        title: step.title,
        intro: step.description,
        fields: step.fields.map((field) => ({
            name: field.id,
            label: field.label,
            type: field.type,
            required: field.required,
            helpText: field.helpText || undefined,
            placeholder: field.placeholder || undefined,
            accept: field.accept,
            multiple: field.multiple,
        })),
    }
}
