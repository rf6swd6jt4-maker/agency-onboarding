import "server-only"

import {
    DEFAULT_APPOINTMENT_SETTING_CONFIGURATION,
    normalizeAppointmentMediums,
    normalizeAppointmentRequestedFields,
    type AppointmentSettingAppointment,
    type AppointmentSettingConfiguration,
} from "@/lib/appointment-setting"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { loadAppointmentSettingServiceIds, type WorkspaceAccess } from "@/lib/workspace-access"

export async function loadAppointmentSettingRelationshipServices(access: WorkspaceAccess) {
    const appointmentSettingServices = await loadAppointmentSettingServiceIds(access.workspaceId)
    const allowedServiceIds = access.role === "staff"
        ? new Set(access.allowedServiceIds)
        : null
    const serviceIds = [...appointmentSettingServices.ids].filter((serviceId) => (
        !allowedServiceIds || allowedServiceIds.has(serviceId)
    ))
    if (!serviceIds.length) return new Map<string, string>()

    const { data, error } = await supabaseAdmin
        .from("relationship_services")
        .select("relationship_id, service_id, created_at")
        .eq("workspace_id", access.workspaceId)
        .in("service_id", serviceIds)
        .order("created_at", { ascending: true })
    if (error) throw new Error(error.message)

    const servicesByRelationship = new Map<string, string>()
    for (const row of data ?? []) {
        if (!row.relationship_id || !row.service_id || servicesByRelationship.has(row.relationship_id)) continue
        servicesByRelationship.set(row.relationship_id, row.service_id)
    }
    return servicesByRelationship
}

export async function loadAppointmentSettingRelationshipService(access: WorkspaceAccess, relationshipId: string) {
    return (await loadAppointmentSettingRelationshipServices(access)).get(relationshipId) ?? null
}

export async function listAppointmentSettingAppointments(input: {
    workspaceId: string
    relationshipId: string
    serviceId: string
}): Promise<AppointmentSettingAppointment[]> {
    const { data, error } = await supabaseAdmin
        .from("appointment_setting_appointments")
        .select("id, workspace_id, relationship_id, service_id, contact_name, phone, appointment_at, appointment_timezone, meeting_medium, meeting_link, details, created_by, updated_by, created_at, updated_at")
        .eq("workspace_id", input.workspaceId)
        .eq("relationship_id", input.relationshipId)
        .eq("service_id", input.serviceId)
        .order("appointment_at", { ascending: true })
        .order("created_at", { ascending: true })
    if (error) throw new Error(error.message)
    return (data ?? []) as AppointmentSettingAppointment[]
}

export async function loadAppointmentSettingConfiguration(input: {
    workspaceId: string
    relationshipId: string
    serviceId: string
}): Promise<AppointmentSettingConfiguration> {
    const { data, error } = await supabaseAdmin
        .from("relationship_appointment_setting_configs")
        .select("mediums, requested_fields")
        .eq("workspace_id", input.workspaceId)
        .eq("relationship_id", input.relationshipId)
        .eq("service_id", input.serviceId)
        .maybeSingle()
    if (error) {
        if (error.code === "42P01" || error.code === "PGRST205") return DEFAULT_APPOINTMENT_SETTING_CONFIGURATION
        throw new Error(error.message)
    }
    if (!data) return DEFAULT_APPOINTMENT_SETTING_CONFIGURATION
    const mediums = normalizeAppointmentMediums(data.mediums)
    return {
        mediums: mediums.length ? mediums : DEFAULT_APPOINTMENT_SETTING_CONFIGURATION.mediums,
        fields: normalizeAppointmentRequestedFields(data.requested_fields),
    }
}
