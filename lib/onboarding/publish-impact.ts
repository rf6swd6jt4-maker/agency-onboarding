import type { OnboardingModuleDefinition } from "./configuration-types"

export function modulePublishDiff(draft: OnboardingModuleDefinition, published?: OnboardingModuleDefinition) {
    const publishedSteps = published?.steps ?? []
    const draftStepIds = draft.steps.map((step) => step.id)
    const publishedStepIds = publishedSteps.map((step) => step.id)
    const draftFields = draft.steps.flatMap((step) => step.fields)
    const publishedFields = publishedSteps.flatMap((step) => step.fields)
    const draftFieldIds = new Set(draftFields.map((field) => field.id))
    const publishedFieldIds = new Set(publishedFields.map((field) => field.id))
    const sharedStepOrderChanged = draftStepIds.filter((id) => publishedStepIds.includes(id)).join("|")
        !== publishedStepIds.filter((id) => draftStepIds.includes(id)).join("|")
    const sharedFieldOrderChanged = draft.steps.some((step) => {
        const previous = publishedSteps.find((candidate) => candidate.id === step.id)
        if (!previous) return false
        const currentIds = step.fields.map((field) => field.id)
        const previousIds = previous.fields.map((field) => field.id)
        return currentIds.filter((id) => previousIds.includes(id)).join("|")
            !== previousIds.filter((id) => currentIds.includes(id)).join("|")
    })
    return {
        publishedVersion: published?.version ?? null,
        publishedStepCount: publishedSteps.length,
        draftStepCount: draft.steps.length,
        publishedFieldCount: publishedFields.length,
        draftFieldCount: draftFields.length,
        addedSteps: draftStepIds.filter((id) => !publishedStepIds.includes(id)).length,
        removedSteps: publishedStepIds.filter((id) => !draftStepIds.includes(id)).length,
        addedFields: [...draftFieldIds].filter((id) => !publishedFieldIds.has(id)).length,
        removedFields: [...publishedFieldIds].filter((id) => !draftFieldIds.has(id)).length,
        orderChanged: sharedStepOrderChanged || sharedFieldOrderChanged,
    }
}
