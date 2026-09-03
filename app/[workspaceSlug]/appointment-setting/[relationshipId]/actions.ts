"use server"

import { revalidatePath } from "next/cache"
import {
    APPOINTMENT_FIELD_OPTIONS,
    formatUsPhone,
    type AppointmentFieldKey,
    type AppointmentMedium,
    type AppointmentSettingAppointment,
    type AppointmentSettingConfiguration,
    type AppointmentSettingInput,
} from "@/lib/appointment-setting"
import { loadAppointmentSettingConfiguration, loadAppointmentSettingRelationshipService } from "@/lib/appointment-setting-server"
import { getRelationship } from "@/lib/relationships"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspacePanel } from "@/lib/workspace-access"
import type { WorkspaceMutationResult } from "@/lib/workspace-mutations"

export type AppointmentUpdateField = "contact_name" | "appointment_at" | "meeting_medium" | "meeting_link" | `detail:${AppointmentFieldKey}`

const APPOINTMENT_SELECT = "id, workspace_id, relationship_id, service_id, contact_name, phone, appointment_at, appointment_timezone, meeting_medium, meeting_link, details, created_by, updated_by, created_at, updated_at"

function detailPath(workspaceSlug: string, relationshipId: string) {
    return `/${workspaceSlug}/appointment-setting/${relationshipId}`
}

function cleanText(value: string, maximum: number) {
    const cleaned = value.trim().replace(/\s+/g, " ")
    return cleaned && cleaned.length <= maximum ? cleaned : null
}

function cleanOptionalText(value: string, maximum: number) {
    const cleaned = value.trim().replace(/\s+/g, " ")
    return cleaned.length <= maximum ? cleaned : null
}

function cleanTimezone(value: string) {
    const cleaned = value.trim()
    if (!cleaned || cleaned.length > 100) return null
    try {
        new Intl.DateTimeFormat("en", { timeZone: cleaned }).format(new Date())
        return cleaned
    } catch {
        return null
    }
}

function cleanAppointmentAt(value: string) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function cleanMeetingLink(value: string) {
    const cleaned = value.trim()
    if (!cleaned) return ""
    try {
        const url = new URL(cleaned)
        return url.protocol === "https:" && cleaned.length <= 2_000 ? cleaned : null
    } catch {
        return null
    }
}

async function requireAppointmentSettingContext(workspaceSlug: string, relationshipId: string) {
    const context = await requireWorkspacePanel(workspaceSlug, "appointment-setting")
    const relationship = await getRelationship(context.workspace.id, relationshipId)
    if (!relationship || relationship.status === "archived" || relationship.lifecycle_phase !== "retention") {
        throw new Error("This relationship is not available for Appointment Setting.")
    }
    const serviceId = await loadAppointmentSettingRelationshipService(context.access, relationshipId)
    if (!serviceId) throw new Error("This relationship does not have an accessible Appointment Setting service.")
    const configuration = await loadAppointmentSettingConfiguration({ workspaceId: context.workspace.id, relationshipId, serviceId })
    return { ...context, relationship, serviceId, configuration }
}

function normalizeDetail(key: AppointmentFieldKey, value: string) {
    if (key === "phone") return value.trim() ? formatUsPhone(value) : ""
    const maximum = key === "notes" ? 1_000 : key === "address" ? 300 : 200
    const cleaned = cleanOptionalText(value, maximum)
    if (cleaned === null) return null
    if (key === "email" && cleaned && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) return null
    return cleaned
}

function normalizeDetails(input: AppointmentSettingInput["details"], configuration: AppointmentSettingConfiguration) {
    const details: Record<string, string> = {}
    let phone: string | null = null
    for (const requested of configuration.fields) {
        const cleaned = normalizeDetail(requested.key, String(input[requested.key] ?? ""))
        const label = APPOINTMENT_FIELD_OPTIONS.find((option) => option.key === requested.key)?.label ?? "This field"
        if (cleaned === null) return { ok: false as const, error: requested.key === "phone" ? "Add a valid 10-digit US phone number." : `Add a valid ${label.toLowerCase()}.` }
        if (requested.required && !cleaned) return { ok: false as const, error: `${label} is required.` }
        if (requested.key === "phone") phone = cleaned || null
        else if (cleaned) details[requested.key] = cleaned
    }
    return { ok: true as const, value: { phone, details } }
}

function normalizeInput(input: AppointmentSettingInput, configuration: AppointmentSettingConfiguration) {
    const contactName = cleanText(input.contactName, 160)
    const appointmentAt = cleanAppointmentAt(input.appointmentAt)
    const appointmentTimezone = cleanTimezone(input.appointmentTimezone)
    const meetingMedium = configuration.mediums.includes(input.meetingMedium) ? input.meetingMedium : null
    const meetingLink = cleanMeetingLink(input.meetingLink)
    const details = normalizeDetails(input.details, configuration)
    if (!contactName) return { ok: false as const, error: "Add a name of 160 characters or fewer." }
    if (!appointmentAt || !appointmentTimezone) return { ok: false as const, error: "Add a valid appointment date and time." }
    if (!meetingMedium) return { ok: false as const, error: "Choose an available appointment option." }
    if (meetingLink === null || (meetingMedium !== "phone" && !meetingLink)) return { ok: false as const, error: "Add a valid HTTPS meeting link." }
    if (!details.ok) return details
    return { ok: true as const, value: { contactName, appointmentAt, appointmentTimezone, meetingMedium, meetingLink: meetingLink || null, ...details.value } }
}

export async function createAppointmentSettingAppointment(workspaceSlug: string, relationshipId: string, input: AppointmentSettingInput): Promise<WorkspaceMutationResult<AppointmentSettingAppointment>> {
    const { workspace, user, serviceId, configuration } = await requireAppointmentSettingContext(workspaceSlug, relationshipId)
    const normalized = normalizeInput(input, configuration)
    if (!normalized.ok) return normalized
    const { data, error } = await supabaseAdmin.from("appointment_setting_appointments").insert({
        workspace_id: workspace.id,
        relationship_id: relationshipId,
        service_id: serviceId,
        contact_name: normalized.value.contactName,
        phone: normalized.value.phone,
        appointment_at: normalized.value.appointmentAt,
        appointment_timezone: normalized.value.appointmentTimezone,
        meeting_medium: normalized.value.meetingMedium,
        meeting_link: normalized.value.meetingLink,
        details: normalized.value.details,
        created_by: user.id,
        updated_by: user.id,
    }).select(APPOINTMENT_SELECT).single()
    if (error || !data) {
        console.error("Appointment Setting appointment could not be created", { workspaceId: workspace.id, relationshipId, code: error?.code })
        return { ok: false, error: "We couldn't add this appointment. Try again." }
    }
    revalidatePath(detailPath(workspaceSlug, relationshipId))
    return { ok: true, data: data as AppointmentSettingAppointment }
}

export async function updateAppointmentSettingAppointment(workspaceSlug: string, relationshipId: string, appointmentId: string, field: AppointmentUpdateField, value: string, appointmentTimezone = "UTC"): Promise<WorkspaceMutationResult<AppointmentSettingAppointment>> {
    const { workspace, user, serviceId, configuration } = await requireAppointmentSettingContext(workspaceSlug, relationshipId)
    const { data: current } = await supabaseAdmin.from("appointment_setting_appointments").select(APPOINTMENT_SELECT).eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).eq("service_id", serviceId).eq("id", appointmentId).maybeSingle()
    if (!current) return { ok: false, error: "That appointment is no longer available." }
    const update: Record<string, unknown> = { updated_by: user.id }
    if (field === "contact_name") {
        const cleaned = cleanText(value, 160)
        if (!cleaned) return { ok: false, error: "Add a name of 160 characters or fewer." }
        update.contact_name = cleaned
    } else if (field === "appointment_at") {
        const cleanedTime = cleanAppointmentAt(value)
        const cleanedTimezone = cleanTimezone(appointmentTimezone)
        if (!cleanedTime || !cleanedTimezone) return { ok: false, error: "Add a valid appointment date and time." }
        update.appointment_at = cleanedTime
        update.appointment_timezone = cleanedTimezone
    } else if (field === "meeting_medium") {
        if (!configuration.mediums.includes(value as AppointmentMedium)) return { ok: false, error: "Choose an available appointment option." }
        if (value !== "phone" && !current.meeting_link) return { ok: false, error: "Add the meeting link before changing to a video appointment." }
        update.meeting_medium = value
    } else if (field === "meeting_link") {
        const cleaned = cleanMeetingLink(value)
        if (cleaned === null || (current.meeting_medium !== "phone" && !cleaned)) return { ok: false, error: "Add a valid HTTPS meeting link." }
        update.meeting_link = cleaned || null
    } else {
        const key = field.slice("detail:".length) as AppointmentFieldKey
        const requested = configuration.fields.find((candidate) => candidate.key === key)
        if (!requested) return { ok: false, error: "That field is not configured for this client." }
        const cleaned = normalizeDetail(key, value)
        const label = APPOINTMENT_FIELD_OPTIONS.find((option) => option.key === key)?.label ?? "This field"
        if (cleaned === null) return { ok: false, error: key === "phone" ? "Add a valid 10-digit US phone number." : `Add a valid ${label.toLowerCase()}.` }
        if (requested.required && !cleaned) return { ok: false, error: `${label} is required.` }
        if (key === "phone") update.phone = cleaned || null
        else update.details = { ...(current.details && typeof current.details === "object" ? current.details : {}), [key]: cleaned || undefined }
    }

    const { data, error } = await supabaseAdmin.from("appointment_setting_appointments").update(update).eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).eq("service_id", serviceId).eq("id", appointmentId).select(APPOINTMENT_SELECT).maybeSingle()
    if (error || !data) {
        console.error("Appointment Setting appointment could not be updated", { workspaceId: workspace.id, relationshipId, appointmentId, code: error?.code })
        return { ok: false, error: "We couldn't save that appointment change. Try again." }
    }
    revalidatePath(detailPath(workspaceSlug, relationshipId))
    return { ok: true, data: data as AppointmentSettingAppointment }
}

export async function deleteAppointmentSettingAppointment(workspaceSlug: string, relationshipId: string, appointmentId: string): Promise<WorkspaceMutationResult> {
    const { workspace, serviceId } = await requireAppointmentSettingContext(workspaceSlug, relationshipId)
    const { data, error } = await supabaseAdmin.from("appointment_setting_appointments").delete().eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).eq("service_id", serviceId).eq("id", appointmentId).select("id").maybeSingle()
    if (error || !data) {
        console.error("Appointment Setting appointment could not be deleted", { workspaceId: workspace.id, relationshipId, appointmentId, code: error?.code })
        return { ok: false, error: "We couldn't remove this appointment. Try again." }
    }
    revalidatePath(detailPath(workspaceSlug, relationshipId))
    return { ok: true }
}
