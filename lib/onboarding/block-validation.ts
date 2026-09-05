import type { ConfiguredOnboardingField, OnboardingThemeDefinition } from "@/lib/onboarding/configuration-types"
import {
    DEFAULT_BLOCK_LAYOUT,
    ONBOARDING_PAYMENT_BUTTON_ID,
    ONBOARDING_PAYMENT_DEFINITION_ID,
    ONBOARDING_PAYMENT_PLACEHOLDER_URL,
    ONBOARDING_PAYMENT_STEP_ID,
    ONBOARDING_BLOCK_SCHEMA_VERSION,
    bookendV2Definition,
    mirrorEstimatedTime,
    moduleV2WithLegacyProjection,
    stepHeader,
    type OnboardingBlock,
    type OnboardingBookendDefinitionV2,
    type OnboardingModuleDefinitionV2,
    type OnboardingPaymentDefinitionV2,
    type OnboardingStepV2,
} from "@/lib/onboarding/block-definition"
import { normalizeHexColour } from "@/lib/onboarding/theme"
import { isStableOnboardingId } from "@/lib/onboarding/stable-id"
import {
    APPOINTMENT_FIELD_OPTIONS,
    normalizeAppointmentMediums,
} from "@/lib/appointment-setting"

const fieldTypes = new Set(["text", "email", "tel", "url", "textarea", "file"])
const fileAcceptTypes = new Set(["image", "video", "document", "any"])
const widths = new Set(["narrow", "standard", "wide", "full"])
const alignments = new Set(["left", "center"])
const spacings = new Set(["compact", "normal", "spacious"])

function text(value: unknown, maximum: number) {
    return String(value ?? "").trim().slice(0, maximum)
}

export function normalizeVisualPaymentGate(payment: OnboardingPaymentDefinitionV2, options: { allowPendingVideo?: boolean } = {}) {
    try {
        if (payment.id !== ONBOARDING_PAYMENT_DEFINITION_ID || payment.steps.length !== 1 || payment.steps[0]?.id !== ONBOARDING_PAYMENT_STEP_ID) {
            throw new Error("The fixed Payment step has damaged internal data. Reload the Builder and try again.")
        }
        const blockIds = new Set<string>()
        const fieldIds = new Set<string>()
        const step = normalizeStep(payment.steps[0], {
            bookend: true,
            firstWelcomeStep: false,
            blockIds,
            fieldIds,
            definitionName: "Payment",
            stepIndex: 0,
            allowPendingVideo: Boolean(options.allowPendingVideo),
        })
        const button = step.blocks.find((block) => block.id === ONBOARDING_PAYMENT_BUTTON_ID)
        if (!button || button.kind !== "button") throw new Error("Payment must retain its fixed Pay button.")
        const normalized: OnboardingPaymentDefinitionV2 = {
            id: ONBOARDING_PAYMENT_DEFINITION_ID,
            schemaVersion: ONBOARDING_BLOCK_SCHEMA_VERSION,
            steps: [{
                ...step,
                id: ONBOARDING_PAYMENT_STEP_ID,
                key: "payment",
                blocks: step.blocks.map((block) => block.id === ONBOARDING_PAYMENT_BUTTON_ID && block.kind === "button"
                    ? { ...block, label: "Pay with Stripe", url: ONBOARDING_PAYMENT_PLACEHOLDER_URL, required: true }
                    : block),
            }],
        }
        return { ok: true as const, definition: normalized, persistedDefinition: normalized }
    } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : "The Payment step is invalid." }
    }
}

function uuid(value: unknown, message: string) {
    const id = String(value ?? "").trim()
    // PostgreSQL UUID columns accept the full UUID-shaped 128-bit space. Older
    // Betelgeze seeds used deterministic UUID-shaped IDs without RFC version
    // bits, so requiring a version/variant here incorrectly rejected safe,
    // stable definitions that the database can store.
    if (!isStableOnboardingId(id)) throw new Error(message)
    return id
}

function layout(block: OnboardingBlock) {
    return {
        width: widths.has(block.layout?.width) ? block.layout.width : DEFAULT_BLOCK_LAYOUT.width,
        alignment: alignments.has(block.layout?.alignment) ? block.layout.alignment : DEFAULT_BLOCK_LAYOUT.alignment,
        spacingBefore: spacings.has(block.layout?.spacingBefore) ? block.layout.spacingBefore : DEFAULT_BLOCK_LAYOUT.spacingBefore,
        spacingAfter: spacings.has(block.layout?.spacingAfter) ? block.layout.spacingAfter : DEFAULT_BLOCK_LAYOUT.spacingAfter,
    }
}

function name(block: OnboardingBlock, fallback: string) {
    return text(block.name, 120) || fallback
}

function normalizeField(field: ConfiguredOnboardingField, seen: Set<string>, location: string) {
    const fieldName = text(field.label, 160) || "Untitled field"
    const id = uuid(field.id, `${location}, field “${fieldName}” has damaged internal data. Reload the Builder and try publishing again. If it remains, the failure will appear in Admin Activity.`)
    if (seen.has(id)) throw new Error(`${location} contains two fields with the same internal ID. Duplicate or recreate the affected field, then publish again.`)
    seen.add(id)
    const type = fieldTypes.has(field.type) ? field.type : "text"
    return {
        id,
        key: text(field.key, 120) || `field-${id.replaceAll("-", "").slice(-12)}`,
        label: text(field.label, 160) || "Untitled field",
        type,
        required: Boolean(field.required),
        helpText: text(field.helpText, 1_000),
        placeholder: text(field.placeholder, 500),
        accept: fileAcceptTypes.has(field.accept) ? field.accept : "any",
        multiple: type === "file" ? Boolean(field.multiple) : false,
    } satisfies ConfiguredOnboardingField
}

function normalizeStep(step: OnboardingStepV2, options: { bookend: boolean; firstWelcomeStep: boolean; blockIds: Set<string>; fieldIds: Set<string>; definitionName: string; stepIndex: number; allowPendingVideo: boolean }) {
    const rawHeader = Array.isArray(step.blocks) ? step.blocks.find((block) => block.kind === "header") : null
    const stepName = rawHeader?.kind === "header" ? text(rawHeader.title, 160) || `Step ${options.stepIndex + 1}` : `Step ${options.stepIndex + 1}`
    const location = `“${options.definitionName}” → “${stepName}”`
    const id = uuid(step.id, `${location} has damaged internal step data. Reload the Builder and try publishing again. If it remains, the failure will appear in Admin Activity.`)
    if (!Array.isArray(step.blocks) || !step.blocks.length) throw new Error("Every step needs a Header block.")
    let headerCount = 0
    let estimateCount = 0
    let formCount = 0
    let checklistCount = 0
    let videoCount = 0
    let buttonCount = 0
    let calendarCount = 0
    let connectionCount = 0
    let appointmentMediumCount = 0
    let appointmentFieldsCount = 0
    const blocks = step.blocks.map((block, index): OnboardingBlock => {
        const blockName = name(block, block.kind === "header" ? "Header block" : block.kind)
        const blockId = uuid(block.id, `${location}, block “${blockName}” has damaged internal data. Reload the Builder and try publishing again. If it remains, the failure will appear in Admin Activity.`)
        if (options.blockIds.has(blockId)) throw new Error(`${location} contains a duplicated “${blockName}” block ID. Remove and re-add that block, then publish again.`)
        options.blockIds.add(blockId)
        if (block.kind === "header") {
            headerCount += 1
            if (index !== 0 || headerCount > 1) throw new Error("The Header must remain the first block in every step.")
            const title = text(block.title, 160)
            if (!title) throw new Error("Every step needs a title.")
            return {
                id: blockId,
                name: name(block, "Header block"),
                kind: "header",
                title,
                description: text(block.description, 4_000),
                estimatedTime: text(block.estimatedTime, 80),
                showComposedModuleSummary: options.firstWelcomeStep && Boolean(block.showComposedModuleSummary),
                layout: layout(block),
            }
        }
        if (block.kind === "estimate") {
            estimateCount += 1
            if (estimateCount > 1) throw new Error("A step can contain only one Estimated time block.")
            return { id: blockId, name: name(block, "Estimated time"), kind: "estimate", estimatedTime: text(block.estimatedTime, 80), layout: layout(block) }
        }
        if (block.kind === "form") {
            formCount += 1
            if (formCount > 1) throw new Error("A step can contain only one Form block.")
            const fields = Array.isArray(block.fields) ? block.fields : []
            return { id: blockId, name: name(block, "Form"), kind: "form", whyWeAsk: text(block.whyWeAsk, 2_000), fields: fields.map((field) => normalizeField(field, options.fieldIds, location)), layout: layout(block) }
        }
        if (block.kind === "checklist") {
            checklistCount += 1
            if (checklistCount > 1) throw new Error("A step can contain only one Checklist block.")
            const items = Array.isArray(block.items) ? block.items.map((item) => text(item, 500)).filter(Boolean).slice(0, 30) : []
            return {
                id: blockId,
                name: name(block, "Checklist"),
                kind: "checklist",
                title: text(block.title, 160) || "Checklist",
                source: block.source === "modules" ? "modules" : "custom",
                items,
                footer: text(block.footer, 2_000),
                layout: layout(block),
            }
        }
        if (block.kind === "video") {
            videoCount += 1
            if (videoCount > 1) throw new Error("A step can contain only one Video block.")
            if (!options.allowPendingVideo && block.legacyEmbedUrl) throw new Error(`${location} still uses an embedded video. Open its Video block, upload the video file, then publish again.`)
            if (!options.allowPendingVideo && !block.upload?.path) throw new Error(`${location} contains a Video block without a file. Open that Video block, choose Upload, and select a video before publishing.`)
            if (block.upload && !block.upload.type.startsWith("video/")) throw new Error(`${location} has a non-video file in its Video block. Replace it with a video file, then publish again.`)
            return {
                id: blockId,
                name: name(block, "Video"),
                kind: "video",
                upload: block.upload ? {
                    name: text(block.upload.name, 255),
                    path: text(block.upload.path, 2_000),
                    size: Number(block.upload.size) || 0,
                    type: text(block.upload.type, 160),
                    provider: "r2",
                } : null,
                legacyEmbedUrl: options.allowPendingVideo ? text(block.legacyEmbedUrl, 2_000) || null : null,
                requirement: block.requirement === "finish" ? "finish" : "none",
                layout: layout(block),
            }
        }
        if (block.kind === "connection") {
            connectionCount += 1
            if (connectionCount > 1) throw new Error("A step can contain only one Connection block.")
            if (block.provider !== "meta_ads") throw new Error("That onboarding connection is not supported.")
            return {
                id: blockId,
                name: name(block, "Facebook connection"),
                kind: "connection",
                provider: "meta_ads",
                label: text(block.label, 120) || "Connect Facebook",
                description: text(block.description, 1_000),
                required: true,
                layout: layout(block),
            }
        }
        if (block.kind === "calendar") {
            calendarCount += 1
            if (calendarCount > 1) throw new Error("A step can contain only one Calendar block.")
            return {
                id: blockId,
                name: name(block, "Calendar"),
                kind: "calendar",
                title: text(block.title, 160) || "Choose a date and time",
                description: text(block.description, 1_000),
                timeLabel: text(block.timeLabel, 120) || "Preferred time",
                required: true,
                layout: layout(block),
            }
        }
        if (block.kind === "appointment_medium") {
            appointmentMediumCount += 1
            if (appointmentMediumCount > 1) throw new Error("A step can contain only one Appointment medium block.")
            const options = normalizeAppointmentMediums(block.options)
            if (!options.length) throw new Error("Appointment medium must offer at least one option.")
            return {
                id: blockId,
                name: name(block, "Appointment medium"),
                kind: "appointment_medium",
                title: text(block.title, 160) || "How can appointments take place?",
                description: text(block.description, 1_000),
                options,
                required: true,
                layout: layout(block),
            }
        }
        if (block.kind === "appointment_fields") {
            appointmentFieldsCount += 1
            if (appointmentFieldsCount > 1) throw new Error("A step can contain only one Appointment information block.")
            const allowed = new Set(APPOINTMENT_FIELD_OPTIONS.map((option) => option.key))
            const options = [...new Set((Array.isArray(block.options) ? block.options : []).filter((option) => allowed.has(option)))].slice(0, APPOINTMENT_FIELD_OPTIONS.length)
            const maximumFields = Math.min(4, Math.max(1, Math.trunc(Number(block.maximumFields) || 4)))
            if (!options.length) throw new Error("Appointment information must offer at least one field.")
            return {
                id: blockId,
                name: name(block, "Appointment information"),
                kind: "appointment_fields",
                title: text(block.title, 160) || "What should setters add to each appointment?",
                description: text(block.description, 1_000),
                options,
                maximumFields,
                required: true,
                layout: layout(block),
            }
        }
        buttonCount += 1
        if (buttonCount > 1) throw new Error("A step can contain only one Button block.")
        const label = text(block.label, 120)
        const rawUrl = text(block.url, 2_000)
        let url: URL
        try { url = new URL(rawUrl) } catch { throw new Error("Every Button needs a valid URL.") }
        if (url.protocol !== "https:") throw new Error("Button destinations must use HTTPS.")
        if (!label) throw new Error("Every Button needs a label.")
        return { id: blockId, name: name(block, "Button"), kind: "button", label, url: url.toString(), required: Boolean(block.required), appearance: block.appearance === "secondary" ? "secondary" : "primary", layout: layout(block) }
    })
    if (headerCount !== 1) throw new Error("Every step needs exactly one Header block.")
    if (estimateCount !== 1) throw new Error("Every step needs exactly one Estimated time block.")
    return mirrorEstimatedTime({
        id,
        key: text(step.key, 120) || `step-${id.replaceAll("-", "").slice(-12)}`,
        blocks,
        navigation: {
            backLabel: text(step.navigation?.backLabel, 60) || "Back",
            continueLabel: text(step.navigation?.continueLabel, 60) || "Complete and continue",
        },
    } satisfies OnboardingStepV2)
}

export function normalizeVisualModule(module: OnboardingModuleDefinitionV2, options: { allowPendingVideo?: boolean } = {}) {
    try {
        const name = text(module.name, 120)
        if (!name) throw new Error("Give this module a name before publishing.")
        if (!module.steps.length) throw new Error("A module must contain at least one step.")
        const stepIds = new Set<string>()
        const blockIds = new Set<string>()
        const fieldIds = new Set<string>()
        const normalized: OnboardingModuleDefinitionV2 = {
            ...module,
            name,
            description: text(module.description, 2_000),
            isTest: Boolean(module.isTest),
            schemaVersion: ONBOARDING_BLOCK_SCHEMA_VERSION,
            steps: module.steps.map((step, stepIndex) => {
                const result = normalizeStep(step, { bookend: false, firstWelcomeStep: false, blockIds, fieldIds, definitionName: name, stepIndex, allowPendingVideo: Boolean(options.allowPendingVideo) })
                if (stepIds.has(result.id)) throw new Error(`“${name}” contains two steps with the same internal ID. Duplicate or recreate one of those steps, then publish again.`)
                stepIds.add(result.id)
                return result
            }),
        }
        return { ok: true as const, definition: normalized, persistedDefinition: moduleV2WithLegacyProjection(normalized) }
    } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : "The visual module is invalid." }
    }
}

export function normalizeVisualBookend(bookend: OnboardingBookendDefinitionV2, options: { allowPendingVideo?: boolean } = {}) {
    try {
        if (!bookend.steps.length) throw new Error(`${bookend.kind === "welcome" ? "Welcome" : "Completion"} must contain at least one step.`)
        const stepIds = new Set<string>()
        const blockIds = new Set<string>()
        const fieldIds = new Set<string>()
        const normalized: OnboardingBookendDefinitionV2 = {
            ...bookend,
            schemaVersion: ONBOARDING_BLOCK_SCHEMA_VERSION,
            steps: bookend.steps.map((step, index) => {
                const definitionName = bookend.kind === "welcome" ? "Welcome" : "Completion"
                const result = normalizeStep(step, { bookend: true, firstWelcomeStep: bookend.kind === "welcome" && index === 0, blockIds, fieldIds, definitionName, stepIndex: index, allowPendingVideo: Boolean(options.allowPendingVideo) })
                if (stepIds.has(result.id)) throw new Error(`“${definitionName}” contains two steps with the same internal ID. Duplicate or recreate one of those steps, then publish again.`)
                stepIds.add(result.id)
                return result
            }),
        }
        return { ok: true as const, definition: normalized, persistedDefinition: bookendV2Definition(normalized) }
    } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : "The bookend is invalid." }
    }
}

export function normalizeThemeDraft(theme: OnboardingThemeDefinition) {
    const swatches = theme.swatches.slice(0, 50).map((swatch) => ({ ...swatch, name: text(swatch.name, 80), hex: normalizeHexColour(swatch.hex) }))
    if (swatches.some((swatch) => !swatch.id || !swatch.name || !swatch.hex)) return { ok: false as const, error: "Every colour needs a name and valid hex value." }
    const ids = new Set(swatches.map((swatch) => swatch.id))
    if (Object.values(theme.assignments).some((id) => !ids.has(id))) return { ok: false as const, error: "Assign an existing colour to every theme role." }
    return { ok: true as const, definition: { swatches, assignments: theme.assignments, updatedAt: new Date().toISOString(), updatedBy: theme.updatedBy } }
}

export function visualStepTitle(step: OnboardingStepV2) {
    return stepHeader(step).title
}
