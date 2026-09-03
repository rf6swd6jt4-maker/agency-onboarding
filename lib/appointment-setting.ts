import type { RelationshipRecord } from "@/lib/relationships"

export type AppointmentSettingAppointment = {
    id: string
    workspace_id: string
    relationship_id: string
    service_id: string
    contact_name: string
    phone: string
    appointment_at: string
    appointment_timezone: string
    created_by: string | null
    updated_by: string | null
    created_at: string
    updated_at: string
}

export type AppointmentSettingInput = {
    contactName: string
    phone: string
    appointmentAt: string
    appointmentTimezone: string
}

export function appointmentSettingDetailHref(workspaceSlug: string, relationshipId: string) {
    return `/${workspaceSlug}/appointment-setting/${relationshipId}`
}

export function filterAppointmentSettingRelationships(
    relationships: readonly RelationshipRecord[],
    accessibleIds: ReadonlySet<string> | null,
    appointmentSettingRelationshipIds: ReadonlySet<string>,
) {
    return relationships.filter((relationship) => (
        relationship.lifecycle_phase === "retention"
        && relationship.status !== "archived"
        && appointmentSettingRelationshipIds.has(relationship.id)
        && (!accessibleIds || accessibleIds.has(relationship.id))
    ))
}
