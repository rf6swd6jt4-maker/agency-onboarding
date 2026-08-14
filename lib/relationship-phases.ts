export const RELATIONSHIP_PHASES = [
    { key: "lead", label: "Lead" },
    { key: "nurturing", label: "Nurturing" },
    { key: "potential_client", label: "Potential Client" },
    { key: "sold", label: "Sold" },
    { key: "invoiced", label: "Invoiced" },
    { key: "onboarding", label: "Onboarding" },
    { key: "onboarding_review", label: "Onboarding Review" },
    { key: "fulfilment", label: "Fulfilment" },
    { key: "retention", label: "Retention" },
    { key: "completed_lost", label: "Completed/Lost" },
] as const

export type RelationshipPhase = (typeof RELATIONSHIP_PHASES)[number]["key"]

export function phaseLabel(phase: RelationshipPhase) {
    return RELATIONSHIP_PHASES.find((item) => item.key === phase)?.label ?? phase
}
