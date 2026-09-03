"use server"

import { revalidatePath } from "next/cache"
import type { AppointmentSettingAppointment, AppointmentSettingInput } from "@/lib/appointment-setting"
import { loadAppointmentSettingRelationshipService } from "@/lib/appointment-setting-server"
import { getRelationship } from "@/lib/relationships"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspacePanel } from "@/lib/workspace-access"
import type { WorkspaceMutationResult } from "@/lib/workspace-mutations"

type AppointmentField = "contact_name" | "phone" | "appointment_at"

function detailPath(workspaceSlug: string, relationshipId: string) {
    return `/${workspaceSlug}/appointment-setting/${relationshipId}`
}

function cleanText(value: string, maximum: number) {
    const cleaned = value.trim().replace(/\s+/g, " ")
    return cleaned && cleaned.length <= maximum ? cleaned : null
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

async function requireAppointmentSettingContext(workspaceSlug: string, relationshipId: string) {
    const context = await requireWorkspacePanel(workspaceSlug, "appointment-setting")
    const relationship = await getRelationship(context.workspace.id, relationshipId)
    if (!relationship || relationship.status === "archived" || relationship.lifecycle_phase !== "retention") {
        throw new Error("This relationship is not available for Appointment Setting.")
    }
    const serviceId = await loadAppointmentSettingRelationshipService(context.access, relationshipId)
    if (!serviceId) throw new Error("This relationship does not have an accessible Appointment Setting service.")
    return { ...context, relationship, serviceId }
}

function normalizeInput(input: AppointmentSettingInput) {
    const contactName = cleanText(input.contactName, 160)
    const phone = cleanText(input.phone, 64)
    const appointmentAt = cleanAppointmentAt(input.appointmentAt)
    const appointmentTimezone = cleanTimezone(input.appointmentTimezone)
    if (!contactName) return { ok: false as const, error: "Add a name of 160 characters or fewer." }
    if (!phone) return { ok: false as const, error: "Add a phone number of 64 characters or fewer." }
    if (!appointmentAt || !appointmentTimezone) return { ok: false as const, error: "Add a valid appointment date and time." }
    return { ok: true as const, value: { contactName, phone, appointmentAt, appointmentTimezone } }
}

export async function createAppointmentSettingAppointment(
    workspaceSlug: string,
    relationshipId: string,
    input: AppointmentSettingInput,
): Promise<WorkspaceMutationResult<AppointmentSettingAppointment>> {
    const normalized = normalizeInput(input)
    if (!normalized.ok) return normalized
    const { workspace, user, serviceId } = await requireAppointmentSettingContext(workspaceSlug, relationshipId)
    const { data, error } = await supabaseAdmin
        .from("appointment_setting_appointments")
        .insert({
            workspace_id: workspace.id,
            relationship_id: relationshipId,
            service_id: serviceId,
            contact_name: normalized.value.contactName,
            phone: normalized.value.phone,
            appointment_at: normalized.value.appointmentAt,
            appointment_timezone: normalized.value.appointmentTimezone,
            created_by: user.id,
            updated_by: user.id,
        })
        .select("id, workspace_id, relationship_id, service_id, contact_name, phone, appointment_at, appointment_timezone, created_by, updated_by, created_at, updated_at")
        .single()
    if (error || !data) {
        console.error("Appointment Setting appointment could not be created", { workspaceId: workspace.id, relationshipId, code: error?.code })
        return { ok: false, error: "We couldn't add this appointment. Try again." }
    }
    revalidatePath(detailPath(workspaceSlug, relationshipId))
    return { ok: true, data: data as AppointmentSettingAppointment }
}

export async function updateAppointmentSettingAppointment(
    workspaceSlug: string,
    relationshipId: string,
    appointmentId: string,
    field: AppointmentField,
    value: string,
    appointmentTimezone = "UTC",
): Promise<WorkspaceMutationResult<AppointmentSettingAppointment>> {
    const { workspace, user, serviceId } = await requireAppointmentSettingContext(workspaceSlug, relationshipId)
    const update: Record<string, string> = { updated_by: user.id }
    if (field === "contact_name") {
        const cleaned = cleanText(value, 160)
        if (!cleaned) return { ok: false, error: "Add a name of 160 characters or fewer." }
        update.contact_name = cleaned
    } else if (field === "phone") {
        const cleaned = cleanText(value, 64)
        if (!cleaned) return { ok: false, error: "Add a phone number of 64 characters or fewer." }
        update.phone = cleaned
    } else {
        const cleanedTime = cleanAppointmentAt(value)
        const cleanedTimezone = cleanTimezone(appointmentTimezone)
        if (!cleanedTime || !cleanedTimezone) return { ok: false, error: "Add a valid appointment date and time." }
        update.appointment_at = cleanedTime
        update.appointment_timezone = cleanedTimezone
    }

    const { data, error } = await supabaseAdmin
        .from("appointment_setting_appointments")
        .update(update)
        .eq("workspace_id", workspace.id)
        .eq("relationship_id", relationshipId)
        .eq("service_id", serviceId)
        .eq("id", appointmentId)
        .select("id, workspace_id, relationship_id, service_id, contact_name, phone, appointment_at, appointment_timezone, created_by, updated_by, created_at, updated_at")
        .maybeSingle()
    if (error || !data) {
        console.error("Appointment Setting appointment could not be updated", { workspaceId: workspace.id, relationshipId, appointmentId, code: error?.code })
        return { ok: false, error: "We couldn't save that appointment change. Try again." }
    }
    revalidatePath(detailPath(workspaceSlug, relationshipId))
    return { ok: true, data: data as AppointmentSettingAppointment }
}

export async function deleteAppointmentSettingAppointment(
    workspaceSlug: string,
    relationshipId: string,
    appointmentId: string,
): Promise<WorkspaceMutationResult> {
    const { workspace, serviceId } = await requireAppointmentSettingContext(workspaceSlug, relationshipId)
    const { data, error } = await supabaseAdmin
        .from("appointment_setting_appointments")
        .delete()
        .eq("workspace_id", workspace.id)
        .eq("relationship_id", relationshipId)
        .eq("service_id", serviceId)
        .eq("id", appointmentId)
        .select("id")
        .maybeSingle()
    if (error || !data) {
        console.error("Appointment Setting appointment could not be deleted", { workspaceId: workspace.id, relationshipId, appointmentId, code: error?.code })
        return { ok: false, error: "We couldn't remove this appointment. Try again." }
    }
    revalidatePath(detailPath(workspaceSlug, relationshipId))
    return { ok: true }
}
