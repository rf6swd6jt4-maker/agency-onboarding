import type { RelationshipRecord } from "@/lib/relationships"

export const APPOINTMENT_MEDIUM_OPTIONS = [
    { key: "phone", label: "Phone call", description: "The setter books a phone call with your team." },
    { key: "google_meet", label: "Google Meet", description: "The setter adds a Google Meet link to the appointment." },
    { key: "zoom", label: "Zoom", description: "The setter adds a Zoom link to the appointment." },
] as const

export type AppointmentMedium = (typeof APPOINTMENT_MEDIUM_OPTIONS)[number]["key"]

export const APPOINTMENT_FIELD_OPTIONS = [
    { key: "phone", label: "Phone number", description: "The best US number for reaching the lead.", inputType: "tel", placeholder: "(555) 123-4567" },
    { key: "email", label: "Email address", description: "Where the lead can receive confirmations.", inputType: "email", placeholder: "lead@example.com" },
    { key: "service", label: "Service requested", description: "The job or service the lead is interested in.", inputType: "text", placeholder: "Roof inspection" },
    { key: "address", label: "Property address", description: "The address connected to the requested work.", inputType: "text", placeholder: "123 Main St, Dallas, TX" },
    { key: "notes", label: "Setter notes", description: "Short context the client should know before the appointment.", inputType: "text", placeholder: "Decision-maker will attend" },
] as const

export type AppointmentFieldKey = (typeof APPOINTMENT_FIELD_OPTIONS)[number]["key"]
export type AppointmentRequestedField = { key: AppointmentFieldKey; required: boolean }

export type AppointmentSettingConfiguration = {
    mediums: AppointmentMedium[]
    fields: AppointmentRequestedField[]
}

export const DEFAULT_APPOINTMENT_SETTING_CONFIGURATION: AppointmentSettingConfiguration = {
    mediums: ["phone"],
    fields: [{ key: "phone", required: true }],
}

const APPOINTMENT_MEDIUM_KEYS = new Set<AppointmentMedium>(APPOINTMENT_MEDIUM_OPTIONS.map((option) => option.key))
const APPOINTMENT_FIELD_KEYS = new Set<AppointmentFieldKey>(APPOINTMENT_FIELD_OPTIONS.map((option) => option.key))

export function normalizeAppointmentMediums(value: unknown): AppointmentMedium[] {
    if (!Array.isArray(value)) return []
    return [...new Set(value.filter((item): item is AppointmentMedium => typeof item === "string" && APPOINTMENT_MEDIUM_KEYS.has(item as AppointmentMedium)))].slice(0, APPOINTMENT_MEDIUM_OPTIONS.length)
}

export function normalizeAppointmentRequestedFields(value: unknown, maximum = 4): AppointmentRequestedField[] {
    if (!Array.isArray(value)) return []
    const seen = new Set<AppointmentFieldKey>()
    const normalized: AppointmentRequestedField[] = []
    for (const item of value) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue
        const key = (item as { key?: unknown }).key
        if (typeof key !== "string" || !APPOINTMENT_FIELD_KEYS.has(key as AppointmentFieldKey) || seen.has(key as AppointmentFieldKey)) continue
        seen.add(key as AppointmentFieldKey)
        normalized.push({ key: key as AppointmentFieldKey, required: Boolean((item as { required?: unknown }).required) })
        if (normalized.length >= maximum) break
    }
    return normalized
}

export function formatUsPhone(value: string) {
    const digits = value.replace(/\D/g, "")
    const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
    if (national.length !== 10) return null
    return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`
}

export type AppointmentSettingAppointment = {
    id: string
    workspace_id: string
    relationship_id: string
    service_id: string
    contact_name: string
    phone: string | null
    appointment_at: string
    appointment_timezone: string
    meeting_medium: AppointmentMedium
    meeting_link: string | null
    details: Partial<Record<Exclude<AppointmentFieldKey, "phone">, string>>
    created_by: string | null
    updated_by: string | null
    created_at: string
    updated_at: string
}

export type AppointmentSettingInput = {
    contactName: string
    appointmentAt: string
    appointmentTimezone: string
    meetingMedium: AppointmentMedium
    meetingLink: string
    details: Partial<Record<AppointmentFieldKey, string>>
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
