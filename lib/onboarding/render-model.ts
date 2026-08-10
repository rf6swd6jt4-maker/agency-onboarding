import type { OnboardingRenderStep } from "@/components/onboarding/OnboardingSessionRenderer"
import type {
    ConfiguredOnboardingStep,
    OnboardingBookendDefinition,
    OnboardingModuleDefinition,
} from "@/lib/onboarding/configuration-types"

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
