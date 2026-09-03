import type { RelationshipRecord } from "@/lib/relationships"

export function filterAppointmentSettingRelationships(
    relationships: readonly RelationshipRecord[],
    accessibleIds: ReadonlySet<string> | null,
) {
    return relationships.filter((relationship) => (
        relationship.lifecycle_phase === "retention"
        && relationship.status !== "archived"
        && (!accessibleIds || accessibleIds.has(relationship.id))
    ))
}
