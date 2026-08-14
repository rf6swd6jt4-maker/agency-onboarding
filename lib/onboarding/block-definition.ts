import type { ConfiguredOnboardingField, ConfiguredOnboardingStep, OnboardingBookendDefinition, OnboardingModuleDefinition } from "@/lib/onboarding/configuration-types"

export const ONBOARDING_BLOCK_SCHEMA_VERSION = 2 as const

function stableUuid() {
    return globalThis.crypto.randomUUID()
}

export type OnboardingBlockWidth = "narrow" | "standard" | "wide" | "full"
export type OnboardingBlockAlignment = "left" | "center"
export type OnboardingBlockSpacing = "compact" | "normal" | "spacious"

export type OnboardingBlockLayout = {
    width: OnboardingBlockWidth
    alignment: OnboardingBlockAlignment
    spacingBefore: OnboardingBlockSpacing
    spacingAfter: OnboardingBlockSpacing
}

export type WorkspaceVideoDescriptor = {
    name: string
    path: string
    size: number
    type: string
    provider: "r2"
    resolvedUrl?: string | null
}

type BlockBase = {
    id: string
    name?: string
    layout: OnboardingBlockLayout
}

export type HeaderBlock = BlockBase & {
    kind: "header"
    title: string
    description: string
    /** Kept as a V1 persistence mirror while estimated time is its own block. */
    estimatedTime: string
    showComposedModuleSummary?: boolean
}

export type EstimateBlock = BlockBase & {
    kind: "estimate"
    estimatedTime: string
}

export type ChecklistBlock = BlockBase & {
    kind: "checklist"
    title: string
    source: "modules" | "custom"
    items: string[]
    footer: string
}

export type FormBlock = BlockBase & {
    kind: "form"
    whyWeAsk: string
    fields: ConfiguredOnboardingField[]
}

export type VideoBlock = BlockBase & {
    kind: "video"
    upload: WorkspaceVideoDescriptor | null
    requirement: "none" | "finish"
    legacyEmbedUrl?: string | null
}

export type ButtonBlock = BlockBase & {
    kind: "button"
    label: string
    url: string
    required: boolean
    appearance: "primary" | "secondary"
    openInSameTab?: boolean
}

export type OnboardingBlock = HeaderBlock | EstimateBlock | ChecklistBlock | FormBlock | VideoBlock | ButtonBlock

export type OnboardingStepV2 = {
    id: string
    key: string
    blocks: OnboardingBlock[]
    navigation: {
        backLabel: string
        continueLabel: string
    }
}

export type OnboardingModuleDefinitionV2 = Omit<OnboardingModuleDefinition, "steps"> & {
    schemaVersion: typeof ONBOARDING_BLOCK_SCHEMA_VERSION
    steps: OnboardingStepV2[]
}

export type OnboardingBookendDefinitionV2 = Omit<OnboardingBookendDefinition, "title" | "body" | "videoUrl" | "videoPath"> & {
    schemaVersion: typeof ONBOARDING_BLOCK_SCHEMA_VERSION
    steps: OnboardingStepV2[]
}

export type OnboardingPaymentDefinitionV2 = {
    id: string
    schemaVersion: typeof ONBOARDING_BLOCK_SCHEMA_VERSION
    steps: [OnboardingStepV2]
}

export const ONBOARDING_PAYMENT_DEFINITION_ID = "00000000-0000-4000-8000-000000000100"
export const ONBOARDING_PAYMENT_STEP_ID = "00000000-0000-4000-8000-000000000101"
export const ONBOARDING_PAYMENT_HEADER_ID = "00000000-0000-4000-8000-000000000102"
export const ONBOARDING_PAYMENT_ESTIMATE_ID = "00000000-0000-4000-8000-000000000103"
export const ONBOARDING_PAYMENT_BUTTON_ID = "00000000-0000-4000-8000-000000000104"
export const ONBOARDING_PAYMENT_PLACEHOLDER_URL = "https://checkout.stripe.com/"

export const DEFAULT_BLOCK_LAYOUT: OnboardingBlockLayout = {
    width: "standard",
    alignment: "left",
    spacingBefore: "normal",
    spacingAfter: "normal",
}

function stableKey(id: string, prefix: string) {
    return `${prefix}-${id.replace(/[^a-zA-Z0-9]/g, "").slice(-12).toLowerCase()}`
}

export function createHeaderBlock(input: Partial<HeaderBlock> = {}): HeaderBlock {
    return {
        id: input.id ?? stableUuid(),
        name: input.name ?? "Header block",
        kind: "header",
        title: input.title ?? "Untitled step",
        description: input.description ?? "",
        estimatedTime: input.estimatedTime ?? "2–3 minutes",
        showComposedModuleSummary: input.showComposedModuleSummary ?? false,
        layout: input.layout ?? DEFAULT_BLOCK_LAYOUT,
    }
}

export function createEstimateBlock(estimatedTime = "2–3 minutes", id = stableUuid()): EstimateBlock {
    return {
        id,
        name: "Estimated time",
        kind: "estimate",
        estimatedTime,
        layout: { ...DEFAULT_BLOCK_LAYOUT, spacingBefore: "compact", spacingAfter: "compact" },
    }
}

export function createChecklistBlock(input: Partial<ChecklistBlock> = {}): ChecklistBlock {
    return {
        id: input.id ?? stableUuid(),
        name: input.name ?? "Checklist",
        kind: "checklist",
        title: input.title ?? "What happens next?",
        source: input.source === "modules" ? "modules" : "custom",
        items: input.items ?? ["Our team reviews your information.", "Your project moves into fulfilment.", "We’ll contact you if anything else is needed."],
        footer: input.footer ?? "",
        layout: input.layout ?? { ...DEFAULT_BLOCK_LAYOUT, width: "wide" },
    }
}

export function createFormBlock(fields?: ConfiguredOnboardingField[]): FormBlock {
    return {
        id: stableUuid(),
        name: "Form",
        kind: "form",
        whyWeAsk: "",
        fields: fields ?? [createOnboardingField()],
        layout: DEFAULT_BLOCK_LAYOUT,
    }
}

export function createVideoBlock(): VideoBlock {
    return { id: stableUuid(), name: "Video", kind: "video", upload: null, requirement: "none", layout: { ...DEFAULT_BLOCK_LAYOUT, width: "wide" } }
}

export function createButtonBlock(): ButtonBlock {
    return { id: stableUuid(), name: "Button", kind: "button", label: "Open link", url: "", required: false, appearance: "primary", layout: DEFAULT_BLOCK_LAYOUT }
}

export function defaultOnboardingPaymentDefinition(): OnboardingPaymentDefinitionV2 {
    return {
        id: ONBOARDING_PAYMENT_DEFINITION_ID,
        schemaVersion: ONBOARDING_BLOCK_SCHEMA_VERSION,
        steps: [{
            id: ONBOARDING_PAYMENT_STEP_ID,
            key: "payment",
            blocks: [
                createHeaderBlock({
                    id: ONBOARDING_PAYMENT_HEADER_ID,
                    title: "Payment",
                    description: "Complete payment securely with Stripe to begin your onboarding.",
                    estimatedTime: "2 minutes",
                }),
                createEstimateBlock("2 minutes", ONBOARDING_PAYMENT_ESTIMATE_ID),
                {
                    id: ONBOARDING_PAYMENT_BUTTON_ID,
                    name: "Pay button",
                    kind: "button",
                    label: "Pay with Stripe",
                    url: ONBOARDING_PAYMENT_PLACEHOLDER_URL,
                    required: true,
                    appearance: "primary",
                    layout: { ...DEFAULT_BLOCK_LAYOUT, width: "wide" },
                },
            ],
            navigation: { backLabel: "Back", continueLabel: "Continue" },
        }],
    }
}

export function createOnboardingField(): ConfiguredOnboardingField {
    const id = stableUuid()
    return { id, key: stableKey(id, "field"), label: "Short answer", type: "text", required: false, helpText: "", placeholder: "", accept: "any", multiple: false }
}

export function createOnboardingStepV2(options: { bookend?: boolean; title?: string; showComposedModuleSummary?: boolean } = {}): OnboardingStepV2 {
    const id = stableUuid()
    return {
        id,
        key: stableKey(id, "step"),
        blocks: [
            createHeaderBlock({ title: options.title, showComposedModuleSummary: options.showComposedModuleSummary }),
            createEstimateBlock(),
            ...(options.bookend ? [] : [createFormBlock()]),
        ],
        navigation: { backLabel: "Back", continueLabel: options.bookend ? "Continue" : "Complete and continue" },
    }
}

export function stepHeader(step: OnboardingStepV2) {
    return step.blocks.find((block): block is HeaderBlock => block.kind === "header") ?? createHeaderBlock()
}

export function stepEstimate(step: OnboardingStepV2) {
    return step.blocks.find((block): block is EstimateBlock => block.kind === "estimate") ?? null
}

function estimateBlockId(stepId: string) {
    const hex = stepId.replaceAll("-", "").padEnd(32, "0").slice(0, 32)
    const prefix = ((Number.parseInt(hex.slice(0, 8), 16) ^ 0x45535449) >>> 0).toString(16).padStart(8, "0")
    return `${prefix}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export function ensureEstimateBlock(step: OnboardingStepV2): OnboardingStepV2 {
    if (stepEstimate(step)) return step
    const header = stepHeader(step)
    const [first, ...rest] = step.blocks
    return {
        ...step,
        blocks: [first, createEstimateBlock(header.estimatedTime, estimateBlockId(step.id)), ...rest],
    }
}


function ensureBookendChecklist(step: OnboardingStepV2, kind: "welcome" | "completion"): OnboardingStepV2 {
    if (step.blocks.some((block) => block.kind === "checklist")) return step
    const header = stepHeader(step)
    if (kind === "welcome" && !header.showComposedModuleSummary) return step
    const checklist = kind === "welcome"
        ? createChecklistBlock({ title: "Your onboarding includes:", source: "modules", items: [], footer: "" })
        : createChecklistBlock({
            title: "What happens next?",
            items: ["Our team reviews your information.", "Your project moves into fulfilment.", "We’ll contact you if anything else is needed."],
            footer: "You can close this page now. There is nothing else you need to do at this stage.",
        })
    return {
        ...step,
        blocks: [...step.blocks, checklist].map((block) => block.kind === "header" ? { ...block, showComposedModuleSummary: false } : block),
    }
}

export function mirrorEstimatedTime(step: OnboardingStepV2): OnboardingStepV2 {
    const estimatedTime = stepEstimate(step)?.estimatedTime ?? ""
    return {
        ...step,
        blocks: step.blocks.map((block) => block.kind === "header" ? { ...block, estimatedTime } : block),
    }
}

export function stepForm(step: OnboardingStepV2) {
    return step.blocks.find((block): block is FormBlock => block.kind === "form") ?? null
}

export function isOnboardingModuleV2(input: OnboardingModuleDefinition | OnboardingModuleDefinitionV2): input is OnboardingModuleDefinitionV2 {
    return Number((input as { schemaVersion?: number }).schemaVersion) === ONBOARDING_BLOCK_SCHEMA_VERSION
}

export function isOnboardingBookendV2(input: OnboardingBookendDefinition | OnboardingBookendDefinitionV2): input is OnboardingBookendDefinitionV2 {
    return Number((input as { schemaVersion?: number }).schemaVersion) === ONBOARDING_BLOCK_SCHEMA_VERSION
        && Array.isArray((input as { steps?: unknown }).steps)
}

function legacyStepToV2(step: ConfiguredOnboardingStep): OnboardingStepV2 {
    const header = createHeaderBlock({ title: step.title, description: step.description, estimatedTime: step.estimatedTime })
    const content: OnboardingBlock[] = step.kind === "form"
        ? [{ id: stableUuid(), kind: "form", whyWeAsk: step.why, fields: step.fields, layout: DEFAULT_BLOCK_LAYOUT }]
        : [{
            id: stableUuid(),
            kind: "video",
            upload: step.videoPath ? { name: "Uploaded video", path: step.videoPath, size: 0, type: "video/*", provider: "r2", resolvedUrl: step.resolvedVideoUrl } : null,
            requirement: "none",
            legacyEmbedUrl: step.videoUrl || null,
            layout: { ...DEFAULT_BLOCK_LAYOUT, width: "wide" },
        }]
    return { id: step.id, key: step.key, blocks: [header, createEstimateBlock(step.estimatedTime, estimateBlockId(step.id)), ...content], navigation: { backLabel: "Back", continueLabel: "Complete and continue" } }
}

export function upgradeModuleToV2(module: OnboardingModuleDefinition | OnboardingModuleDefinitionV2): OnboardingModuleDefinitionV2 {
    if (isOnboardingModuleV2(module)) return { ...module, steps: module.steps.map(ensureEstimateBlock) }
    return { ...module, schemaVersion: ONBOARDING_BLOCK_SCHEMA_VERSION, steps: module.steps.map(legacyStepToV2) }
}

export function upgradeBookendToV2(bookend: OnboardingBookendDefinition | OnboardingBookendDefinitionV2): OnboardingBookendDefinitionV2 {
    if (isOnboardingBookendV2(bookend)) return { ...bookend, steps: bookend.steps.map((step) => ensureBookendChecklist(ensureEstimateBlock(step), bookend.kind)) }
    if (bookend.schemaVersion === ONBOARDING_BLOCK_SCHEMA_VERSION && Array.isArray(bookend.visualSteps)) {
        return {
            ...bookend,
            schemaVersion: ONBOARDING_BLOCK_SCHEMA_VERSION,
            steps: bookend.visualSteps.map((step) => ensureBookendChecklist(ensureEstimateBlock(step), bookend.kind)),
        }
    }
    const id = stableUuid()
    const blocks: OnboardingBlock[] = [createHeaderBlock({
        title: bookend.title,
        description: bookend.body,
        estimatedTime: bookend.kind === "welcome" ? "2 minutes" : "A few moments",
        showComposedModuleSummary: bookend.kind === "welcome",
    }), createEstimateBlock(bookend.kind === "welcome" ? "2 minutes" : "A few moments", estimateBlockId(id))]
    if (bookend.videoPath || bookend.videoUrl) {
        blocks.push({
            id: stableUuid(),
            kind: "video",
            upload: bookend.videoPath ? { name: "Uploaded video", path: bookend.videoPath, size: 0, type: "video/*", provider: "r2", resolvedUrl: bookend.resolvedVideoUrl } : null,
            legacyEmbedUrl: bookend.videoUrl || null,
            requirement: "none",
            layout: { ...DEFAULT_BLOCK_LAYOUT, width: "wide" },
        })
    }
    const upgraded = {
        id: bookend.id,
        revisionId: bookend.revisionId,
        kind: bookend.kind,
        version: bookend.version,
        status: bookend.status,
        lastEditedAt: bookend.lastEditedAt,
        lastEditedBy: bookend.lastEditedBy,
        schemaVersion: ONBOARDING_BLOCK_SCHEMA_VERSION,
        steps: [{ id, key: stableKey(id, "step"), blocks, navigation: { backLabel: "Back", continueLabel: bookend.kind === "welcome" ? "Start onboarding" : "Continue" } }],
    }
    return { ...upgraded, steps: upgraded.steps.map((step) => ensureBookendChecklist(step, bookend.kind)) }
}

/**
 * V2 definitions retain a server-derived V1 projection on each step. Existing
 * invoice/session materialisers can therefore roll forward without losing the
 * full ordered block document, while V2-aware renderers read `blocks`.
 */
export function moduleV2WithLegacyProjection(module: OnboardingModuleDefinitionV2) {
    return {
        name: module.name,
        description: module.description,
        isTest: module.isTest,
        mandatory: Boolean(module.mandatory),
        sortOrder: module.sortOrder,
        serviceIds: module.serviceIds ?? [],
        schemaVersion: ONBOARDING_BLOCK_SCHEMA_VERSION,
        steps: module.steps.map((sourceStep) => {
            const step = mirrorEstimatedTime(sourceStep)
            const header = stepHeader(step)
            const estimate = stepEstimate(step)
            const form = stepForm(step)
            const video = step.blocks.find((block): block is VideoBlock => block.kind === "video")
            return {
                id: step.id,
                key: step.key,
                kind: form ? "form" : "video",
                title: header.title,
                description: header.description,
                estimatedTime: estimate?.estimatedTime ?? header.estimatedTime,
                why: form?.whyWeAsk ?? "",
                videoUrl: "",
                videoPath: video?.upload?.path ?? null,
                fields: form?.fields ?? [],
                navigation: step.navigation,
                blocks: step.blocks.map((block) => {
                    if (block.kind !== "video") return block
                    const upload = block.upload ? {
                        name: block.upload.name,
                        path: block.upload.path,
                        size: block.upload.size,
                        type: block.upload.type,
                        provider: block.upload.provider,
                    } : null
                    return { ...block, upload }
                }),
            }
        }),
    }
}

export function bookendV2Definition(bookend: OnboardingBookendDefinitionV2) {
    const firstHeader = stepHeader(bookend.steps[0] ?? createOnboardingStepV2({ bookend: true }))
    return {
        schemaVersion: ONBOARDING_BLOCK_SCHEMA_VERSION,
        title: firstHeader.title,
        body: firstHeader.description,
        videoUrl: "",
        videoPath: null,
        steps: bookend.steps,
    }
}
