import { createHash } from "crypto"
import type {
    OnboardingServiceDefinition,
    PublishedOnboardingConfiguration,
} from "@/lib/onboarding/configuration-types"
import {
    composeOnboardingSession,
    type ComposedOnboardingSession,
} from "@/lib/onboarding/session-snapshot"

export type OnboardingRuntimeMode = "versioned" | "shadow" | "legacy"

export type DealOnboardingService = {
    service_key: string
    service_id?: string | null
    service_revision_id?: string | null
}

export function getOnboardingRuntimeMode(
    rawMode = process.env.ONBOARDING_RUNTIME_MODE
): OnboardingRuntimeMode {
    const normalized = rawMode?.trim().toLowerCase()
    if (!normalized || normalized === "versioned") return "versioned"
    if (normalized === "shadow" || normalized === "legacy") return normalized
    throw new Error(
        "ONBOARDING_RUNTIME_MODE must be versioned, shadow, or legacy"
    )
}

export function resolveDealOnboardingComposition(
    configuration: PublishedOnboardingConfiguration,
    selectedServices: DealOnboardingService[],
    identity: "versioned" | "legacy"
) {
    const purchasedServices = selectedServices.flatMap((selected, index) => {
        const service = configuration.services.find((candidate) =>
            identity === "versioned"
                ? candidate.id === selected.service_id || candidate.code === selected.service_key
                : candidate.code === selected.service_key
        )
        if (!service) return []
        return [{
            ...service,
            // The legacy live resolver walks the selected service keys in deal
            // order. Mirror that order in shadow projections so comparisons do
            // not report false drift caused by catalogue priority.
            displayPriority: identity === "legacy"
                ? selectedServices.length - index
                : service.displayPriority,
        }]
    })
    return {
        purchasedServices,
        composition: composeOnboardingSession({
            purchasedServices,
            modules: configuration.modules,
            mandatory: configuration.mandatory,
            welcome: configuration.welcome,
            completion: configuration.completion,
            bookendsMigrated: configuration.bookendsMigrated,
        }),
    }
}

function renderProjection(composition: ComposedOnboardingSession) {
    const step = (value: ComposedOnboardingSession["bookends"][number] | ComposedOnboardingSession["modules"][number]["steps"][number]) => ({
        kind: value.kind,
        title: value.title,
        description: value.description,
        estimatedTime: value.estimatedTime,
        why: value.why,
        videoUrl: value.videoUrl,
        videoPath: value.videoPath,
        legacyStepKey: value.legacyStepKey,
        legacyFormKey: value.legacyFormKey,
        fields: value.fields.map((field) => ({
            legacyFieldName: field.legacyFieldName,
            type: field.type,
            label: field.label,
            required: field.required,
            helpText: field.helpText,
            placeholder: field.placeholder,
            accept: field.accept,
            multiple: field.multiple,
        })),
    })
    return {
        bookends: composition.bookends.map(step),
        modules: composition.modules.map((moduleDefinition) => ({
            title: moduleDefinition.title,
            description: moduleDefinition.description,
            isTest: moduleDefinition.isTest,
            steps: moduleDefinition.steps.map(step),
        })),
    }
}

function hash(value: unknown) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

export function summarizeOnboardingComposition(composition: ComposedOnboardingSession) {
    return {
        identity_hash: composition.compositionHash,
        render_hash: hash(renderProjection(composition)),
        configuration_revision_id: composition.configurationRevisionId,
        welcome_revision_id: composition.welcomeRevisionId,
        completion_revision_id: composition.completionRevisionId,
        service_revision_ids: composition.serviceRevisionIds,
        module_revision_ids: composition.modules.map((moduleDefinition) => moduleDefinition.moduleRevisionId),
        service_count: composition.serviceRevisionIds.length,
        module_count: composition.modules.length,
        step_count: composition.audit.stepCount,
        field_count: composition.audit.fieldCount,
    }
}

export function compareOnboardingCompositions(
    versioned: ComposedOnboardingSession,
    legacy: ComposedOnboardingSession
) {
    const versionedSummary = summarizeOnboardingComposition(versioned)
    const legacySummary = summarizeOnboardingComposition(legacy)
    return {
        matches: versionedSummary.render_hash === legacySummary.render_hash,
        versioned: versionedSummary,
        legacy: legacySummary,
    }
}

export function versionedServiceDefinitionForDeal(
    configuration: PublishedOnboardingConfiguration,
    selected: DealOnboardingService
): OnboardingServiceDefinition | undefined {
    return configuration.services.find((service) =>
        service.id === selected.service_id || service.code === selected.service_key
    )
}
