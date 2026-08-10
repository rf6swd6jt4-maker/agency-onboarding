import { MODULES } from "./modules"
import type { StepKind } from "./modules"
export {
    classifyUploadAsset,
    onboardingSnapshotStepNativeKey,
    onboardingSnapshotSubmissionNativeKey,
    onboardingSnapshotUploadNativeKey,
    onboardingStepNativeKey,
    onboardingSubmissionNativeKey,
    onboardingUploadNativeKey,
} from "./canonical-keys"

export type CanonicalSessionStep = {
    key: string
    title: string
    description: string
    moduleTitle: string
    estimatedTime: string
    why: string
    kind: StepKind | "final"
    formKey?: string
    videoUrl?: string
}

export const BASE_ONBOARDING_STEPS: CanonicalSessionStep[] = [
    {
        key: "welcome-video",
        title: "Welcome",
        description: "We’ll explain how this onboarding works and what we need from you.",
        moduleTitle: "General",
        estimatedTime: "2 minutes",
        why: "This helps us make sure you know exactly what happens next before we ask for any business details.",
        kind: "video",
        videoUrl: "",
    },
]

export const FINAL_ONBOARDING_STEP: CanonicalSessionStep = {
    key: "final",
    title: "All done",
    description: "You have completed the onboarding steps.",
    moduleTitle: "Finished",
    estimatedTime: "No action needed",
    why: "Once onboarding is complete, our team can review everything and start preparing your project properly.",
    kind: "final",
}

export function getOnboardingStepsForModules(moduleKeys: string[]) {
    const moduleSteps: CanonicalSessionStep[] = moduleKeys.flatMap((moduleKey) => {
        const moduleDefinition = MODULES[moduleKey]
        if (!moduleDefinition) return []
        return moduleDefinition.steps.map((step) => ({
            ...step,
            moduleTitle: moduleDefinition.title,
            estimatedTime: step.kind === "video" ? "2 minutes" : "2–3 minutes",
            why: step.kind === "video"
                ? "This video shows you exactly what to do, so you do not need to guess your way through account settings."
                : "This information helps us set up your project correctly and avoid delays later.",
        }))
    })
    return [...BASE_ONBOARDING_STEPS, ...moduleSteps]
}
