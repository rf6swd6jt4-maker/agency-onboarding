import type { FileAccept, FormFieldType } from "@/lib/onboarding/forms"

export type OnboardingDefinitionStatus = "draft" | "published" | "archived"
export type OnboardingServiceState = "active" | "retired" | "archived"
export type OnboardingBookendKind = "welcome" | "completion"
export type OnboardingStepKind = "form" | "video"

export type ConfiguredOnboardingField = {
    id: string
    key: string
    label: string
    type: FormFieldType
    required: boolean
    helpText: string
    placeholder: string
    accept: FileAccept
    multiple: boolean
}

export type ConfiguredOnboardingStep = {
    id: string
    key: string
    kind: OnboardingStepKind
    title: string
    description: string
    estimatedTime: string
    why: string
    videoUrl: string
    videoPath: string | null
    resolvedVideoUrl?: string | null
    fields: ConfiguredOnboardingField[]
}

export type OnboardingModuleDefinition = {
    id: string
    revisionId: string | null
    code: string
    name: string
    description: string
    isTest: boolean
    status: OnboardingDefinitionStatus
    version: number
    steps: ConfiguredOnboardingStep[]
    lastEditedAt: string | null
    lastEditedBy: string | null
}

export type OnboardingModuleSummary = Omit<OnboardingModuleDefinition, "steps"> & {
    stepCount: number
    fieldCount: number
    mandatory: boolean
    usedBy: Array<{ id: string; name: string }>
}

export type OnboardingServiceModuleAssignment = {
    moduleId: string
    moduleCode: string
    moduleName: string
    sortOrder: number
}

export type OnboardingServiceDefinition = {
    id: string
    revisionId: string | null
    code: string
    name: string
    description: string
    state: OnboardingServiceState
    version: number
    isTest: boolean
    defaultPriceCents: number
    currency: string
    defaultAssigneeId: string | null
    displayPriority: number
    modules: OnboardingServiceModuleAssignment[]
    archiveBlockers: string[]
    lastEditedAt: string | null
}

export type OnboardingBookendDefinition = {
    id: string
    revisionId: string | null
    kind: OnboardingBookendKind
    title: string
    body: string
    videoUrl: string
    videoPath: string | null
    resolvedVideoUrl?: string | null
    version: number
    status: "draft" | "published"
    lastEditedAt: string | null
    lastEditedBy: string | null
}

export type MandatoryModuleConfiguration = {
    draftRevisionId: string | null
    publishedRevisionId: string | null
    draftModuleIds: string[]
    publishedModuleIds: string[]
    draftVersion: number
    publishedVersion: number
}

export const ONBOARDING_THEME_SLOTS = [
    "primary",
    "accent",
    "pageBackground",
    "surface",
    "text",
    "mutedText",
] as const

export type OnboardingThemeSlot = (typeof ONBOARDING_THEME_SLOTS)[number]

export type OnboardingBrandSwatch = {
    id: string
    name: string
    hex: string
    hidden: boolean
}

export type OnboardingThemeDefinition = {
    id: string | null
    swatches: OnboardingBrandSwatch[]
    assignments: Record<OnboardingThemeSlot, string>
    updatedAt: string | null
    updatedBy: string | null
}

export type OnboardingHelpSettings = {
    text: string
    whatsappEnabled: boolean
    whatsappVerified: boolean
    whatsappNumber: string | null
}

export type OnboardingAssigneeOption = {
    id: string
    name: string
    avatarSrc: string | null
}

export type OnboardingSettingsPageData = {
    schemaReady: boolean
    services: OnboardingServiceDefinition[]
    modules: OnboardingModuleSummary[]
    mandatory: MandatoryModuleConfiguration
    welcome: OnboardingBookendDefinition
    completion: OnboardingBookendDefinition
    theme: OnboardingThemeDefinition
    help: OnboardingHelpSettings
    assignees: OnboardingAssigneeOption[]
}

export type OnboardingBuilderData = {
    schemaReady: boolean
    modules: OnboardingModuleSummary[]
    moduleDefinitions: OnboardingModuleDefinition[]
    publishedModuleDefinitions: Record<string, OnboardingModuleDefinition | null>
    selectedModule: OnboardingModuleDefinition | null
    welcome: OnboardingBookendDefinition
    completion: OnboardingBookendDefinition
    theme: OnboardingThemeDefinition
    help: OnboardingHelpSettings
    editors: Record<string, string>
    publishImpactByModule: Record<string, OnboardingModulePublishImpact>
}

export type OnboardingModulePublishImpact = {
    serviceNames: string[]
    activeSessionCount: number
    publishedVersion: number | null
    publishedStepCount: number
    draftStepCount: number
    publishedFieldCount: number
    draftFieldCount: number
    addedSteps: number
    removedSteps: number
    addedFields: number
    removedFields: number
    orderChanged: boolean
}

export type PublishedOnboardingConfiguration = {
    schemaReady: boolean
    modules: OnboardingModuleDefinition[]
    services: OnboardingServiceDefinition[]
    mandatory: MandatoryModuleConfiguration
    welcome: OnboardingBookendDefinition
    completion: OnboardingBookendDefinition
    theme: OnboardingThemeDefinition
    help: OnboardingHelpSettings
}

export type ConfigurationActionResult<T = undefined> =
    | { ok: true; data?: T; message?: string }
    | { ok: false; error: string; fieldErrors?: Record<string, string> }
