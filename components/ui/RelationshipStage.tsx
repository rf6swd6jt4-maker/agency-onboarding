import { phaseLabel, type RelationshipPhase } from "@/lib/relationship-phases"
import { pillTones, type PillTone } from "./pill-styles"
import styles from "./RelationshipStage.module.css"

export const relationshipPhaseTones: Record<RelationshipPhase, PillTone> = {
    lead: "sky",
    nurturing: "violet",
    potential_client: "amber",
    sold: "emerald",
    invoiced: "yellow",
    onboarding: "violet",
    onboarding_review: "emerald",
    fulfilment: "red",
    retention: "neutral",
    completed_lost: "neutral",
}

export function relationshipPhaseColours(phase: RelationshipPhase) {
    return pillTones[relationshipPhaseTones[phase]]
}

export function RelationshipStage({ phase, className = "" }: { phase: RelationshipPhase; className?: string }) {
    const colours = relationshipPhaseColours(phase)
    return (
        <span style={{ backgroundColor: colours.border }} className={`inline-flex h-6 w-fit p-px ${styles.outer} ${className}`}>
            <span style={{ backgroundColor: colours.background, color: colours.text }} className={`inline-flex h-full items-center px-3.5 text-xs leading-4 ${styles.inner}`}>
                {phaseLabel(phase)}
            </span>
        </span>
    )
}
