import type { OnboardingRenderStep } from "@/components/onboarding/OnboardingSessionRenderer"
import type {
    ConfiguredOnboardingStep,
    OnboardingBookendDefinition,
    OnboardingModuleDefinition,
} from "@/lib/onboarding/configuration-types"
import type { OnboardingStepV2 } from "@/lib/onboarding/block-definition"

export function configuredStepToRenderStep(
    moduleDefinition: OnboardingModuleDefinition,
    step: ConfiguredOnboardingStep,
    resolvedVideoUrl?: string | null,
): OnboardingRenderStep {
    return {
        key: step.id,
        kind: step.kind,
        title: step.title,
        description: step.description,
        moduleTitle: moduleDefinition.name,
        estimatedTime: step.estimatedTime || "A few minutes",
        why: step.why,
        videoUrl: (resolvedVideoUrl ?? step.videoUrl) || step.videoPath,
        form: step.kind === "form" ? {
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
        } : null,
        blocks: step.blocks,
        navigation: step.navigation,
    }
}

export function visualStepToRenderStep(
    groupTitle: string,
    step: OnboardingStepV2,
): OnboardingRenderStep {
    const header = step.blocks.find((block) => block.kind === "header")
    const estimate = step.blocks.find((block) => block.kind === "estimate")
    const form = step.blocks.find((block) => block.kind === "form")
    return {
        key: step.id,
        kind: form?.kind === "form" ? "form" : "video",
        title: header?.kind === "header" ? header.title : "Untitled step",
        description: header?.kind === "header" ? header.description : "",
        moduleTitle: groupTitle,
        estimatedTime: estimate?.kind === "estimate" ? estimate.estimatedTime : header?.kind === "header" ? header.estimatedTime : "",
        why: "",
        blocks: step.blocks,
        navigation: step.navigation,
    }
}

export function bookendToRenderStep(
    bookend: OnboardingBookendDefinition,
    resolvedVideoUrl?: string | null,
): OnboardingRenderStep {
    return {
        key: bookend.id,
        kind: bookend.kind === "completion" ? "final" : "video",
        title: bookend.title,
        description: bookend.body,
        moduleTitle: bookend.kind === "completion" ? "Finished" : "Welcome",
        estimatedTime: bookend.kind === "completion" ? "Complete" : "2 minutes",
        why: "",
        videoUrl: (resolvedVideoUrl ?? bookend.videoUrl) || bookend.videoPath,
        form: null,
    }
}
