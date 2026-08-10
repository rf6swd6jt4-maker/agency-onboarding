import type { ConfiguredOnboardingField, OnboardingThemeDefinition } from "@/lib/onboarding/configuration-types"
import {
    DEFAULT_BLOCK_LAYOUT,
    ONBOARDING_BLOCK_SCHEMA_VERSION,
    bookendV2Definition,
    moduleV2WithLegacyProjection,
    stepHeader,
    type OnboardingBlock,
    type OnboardingBookendDefinitionV2,
    type OnboardingModuleDefinitionV2,
    type OnboardingStepV2,
} from "@/lib/onboarding/block-definition"
import { normalizeHexColour } from "@/lib/onboarding/theme"

const fieldTypes = new Set(["text", "email", "tel", "url", "textarea", "file"])
const fileAcceptTypes = new Set(["image", "video", "document", "any"])
const widths = new Set(["narrow", "standard", "wide", "full"])
const alignments = new Set(["left", "center"])
const spacings = new Set(["compact", "normal", "spacious"])

function text(value: unknown, maximum: number) {
    return String(value ?? "").trim().slice(0, maximum)
}

function uuid(value: unknown, message: string) {
    const id = String(value ?? "")
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error(message)
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

function normalizeField(field: ConfiguredOnboardingField, seen: Set<string>) {
    const id = uuid(field.id, "Every form field needs a stable ID.")
    if (seen.has(id)) throw new Error("Field IDs must be unique within a definition.")
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

function normalizeStep(step: OnboardingStepV2, options: { bookend: boolean; firstWelcomeStep: boolean; blockIds: Set<string>; fieldIds: Set<string> }) {
    const id = uuid(step.id, "Every onboarding step needs a stable ID.")
    if (!Array.isArray(step.blocks) || !step.blocks.length) throw new Error("Every step needs a Header block.")
    let headerCount = 0
    let formCount = 0
    const blocks = step.blocks.map((block, index): OnboardingBlock => {
        const blockId = uuid(block.id, "Every onboarding block needs a stable ID.")
        if (options.blockIds.has(blockId)) throw new Error("Block IDs must be unique within a definition.")
        options.blockIds.add(blockId)
        if (block.kind === "header") {
            headerCount += 1
            if (index !== 0 || headerCount > 1) throw new Error("The Header must remain the first block in every step.")
            const title = text(block.title, 160)
            if (!title) throw new Error("Every step needs a title.")
            return {
                id: blockId,
                kind: "header",
                title,
                description: text(block.description, 4_000),
                estimatedTime: text(block.estimatedTime, 80),
                showComposedModuleSummary: options.firstWelcomeStep && Boolean(block.showComposedModuleSummary),
                layout: layout(block),
            }
        }
        if (block.kind === "form") {
            if (options.bookend) throw new Error("Welcome and Completion steps cannot contain forms.")
            formCount += 1
            if (formCount > 1) throw new Error("A step can contain only one Form block.")
            const fields = Array.isArray(block.fields) ? block.fields : []
            return { id: blockId, kind: "form", whyWeAsk: text(block.whyWeAsk, 2_000), fields: fields.map((field) => normalizeField(field, options.fieldIds)), layout: layout(block) }
        }
        if (block.kind === "video") {
            if (block.legacyEmbedUrl) throw new Error("Replace embedded videos with a workspace upload before publishing.")
            if (!block.upload?.path) throw new Error("Upload every video before publishing.")
            if (!block.upload.type.startsWith("video/")) throw new Error("Builder video blocks require a video upload.")
            return {
                id: blockId,
                kind: "video",
                upload: {
                    name: text(block.upload.name, 255),
                    path: text(block.upload.path, 2_000),
                    size: Number(block.upload.size) || 0,
                    type: text(block.upload.type, 160),
                    provider: "r2",
                },
                requirement: block.requirement === "finish" ? "finish" : "none",
                layout: layout(block),
            }
        }
        const label = text(block.label, 120)
        const rawUrl = text(block.url, 2_000)
        let url: URL
        try { url = new URL(rawUrl) } catch { throw new Error("Every Button needs a valid URL.") }
        if (url.protocol !== "https:") throw new Error("Button destinations must use HTTPS.")
        if (!label) throw new Error("Every Button needs a label.")
        return { id: blockId, kind: "button", label, url: url.toString(), required: Boolean(block.required), appearance: block.appearance === "secondary" ? "secondary" : "primary", layout: layout(block) }
    })
    if (headerCount !== 1) throw new Error("Every step needs exactly one Header block.")
    return {
        id,
        key: text(step.key, 120) || `step-${id.replaceAll("-", "").slice(-12)}`,
        blocks,
        navigation: {
            backLabel: text(step.navigation?.backLabel, 60) || "Back",
            continueLabel: text(step.navigation?.continueLabel, 60) || "Complete and continue",
        },
    } satisfies OnboardingStepV2
}

export function normalizeVisualModule(module: OnboardingModuleDefinitionV2) {
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
            steps: module.steps.map((step) => {
                const result = normalizeStep(step, { bookend: false, firstWelcomeStep: false, blockIds, fieldIds })
                if (stepIds.has(result.id)) throw new Error("Step IDs must be unique within a module.")
                stepIds.add(result.id)
                return result
            }),
        }
        return { ok: true as const, definition: normalized, persistedDefinition: moduleV2WithLegacyProjection(normalized) }
    } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : "The visual module is invalid." }
    }
}

export function normalizeVisualBookend(bookend: OnboardingBookendDefinitionV2) {
    try {
        if (!bookend.steps.length) throw new Error(`${bookend.kind === "welcome" ? "Welcome" : "Completion"} must contain at least one step.`)
        const stepIds = new Set<string>()
        const blockIds = new Set<string>()
        const fieldIds = new Set<string>()
        const normalized: OnboardingBookendDefinitionV2 = {
            ...bookend,
            schemaVersion: ONBOARDING_BLOCK_SCHEMA_VERSION,
            steps: bookend.steps.map((step, index) => {
                const result = normalizeStep(step, { bookend: true, firstWelcomeStep: bookend.kind === "welcome" && index === 0, blockIds, fieldIds })
                if (stepIds.has(result.id)) throw new Error("Bookend step IDs must be unique.")
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
