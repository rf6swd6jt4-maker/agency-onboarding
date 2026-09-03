import "server-only"

import { cache } from "react"
import { notFound } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { combineWorkspaceCapabilities, WORKSPACE_CAPABILITIES, type WorkspaceCapability } from "@/lib/workspace-capabilities"
import { canAccessWorkspacePanel, workspacePanelByKey, workspacePanelHref, WORKSPACE_PANELS, type WorkspacePanelKey } from "@/lib/workspace-panels"
import type { WorkspaceRole } from "@/lib/workspace-roles"
import { requireWorkspace } from "@/lib/workspaces"

export type WorkspaceAccess = {
    workspaceId: string
    workspaceSlug: string
    userId: string
    role: WorkspaceRole
    capabilities: WorkspaceCapability[]
    allowedServiceIds: string[]
    serviceAccessSchemaReady: boolean
}

function isAdminRole(role: WorkspaceRole) {
    return role === "owner" || role === "admin"
}

const APPOINTMENT_SETTING_CAPABILITY = "appointment_setting.manage" satisfies WorkspaceCapability
const APPOINTMENT_SETTING_TEMPLATE_ID = "appointment-setting"

function serviceTemplateId(definition: unknown) {
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) return null
    const value = (definition as Record<string, unknown>).templateId ?? (definition as Record<string, unknown>).template_id
    return typeof value === "string" ? value : null
}

export const loadAppointmentSettingServiceIds = cache(async (workspaceId: string) => {
    const { data: services, error: serviceError } = await supabaseAdmin
        .from("onboarding_services")
        .select("id")
        .eq("workspace_id", workspaceId)
        .neq("state", "archived")
    if (serviceError) {
        console.error("Appointment Setting service activation could not be loaded", { workspaceId, code: serviceError.code })
        return { ids: new Set<string>(), ready: false }
    }
    const serviceIds = (services ?? []).map((service) => service.id).filter(Boolean)
    if (!serviceIds.length) return { ids: new Set<string>(), ready: true }

    const { data: revisions, error: revisionError } = await supabaseAdmin
        .from("onboarding_service_revisions")
        .select("service_id, definition")
        .eq("workspace_id", workspaceId)
        .in("service_id", serviceIds)
    if (revisionError) {
        console.error("Appointment Setting service revisions could not be loaded", { workspaceId, code: revisionError.code })
        return { ids: new Set<string>(), ready: false }
    }
    return {
        ids: new Set((revisions ?? [])
            .filter((revision) => serviceTemplateId(revision.definition) === APPOINTMENT_SETTING_TEMPLATE_ID)
            .map((revision) => revision.service_id)
            .filter(Boolean)),
        ready: true,
    }
})

export async function loadWorkspaceAccess(input: {
    workspaceId: string
    workspaceSlug: string
    userId: string
    role: WorkspaceRole
}): Promise<WorkspaceAccess> {
    const appointmentSettingServices = await loadAppointmentSettingServiceIds(input.workspaceId)
    if (isAdminRole(input.role)) {
        return {
            ...input,
            capabilities: WORKSPACE_CAPABILITIES.filter((capability) => (
                capability !== APPOINTMENT_SETTING_CAPABILITY || appointmentSettingServices.ids.size > 0
            )),
            allowedServiceIds: [],
            serviceAccessSchemaReady: appointmentSettingServices.ready,
        }
    }

    const { data: assignments, error: assignmentError } = await supabaseAdmin
        .from("workspace_member_service_access")
        .select("service_id")
        .eq("workspace_id", input.workspaceId)
        .eq("user_id", input.userId)

    if (assignmentError) {
        console.error("Workspace service access could not be loaded", {
            workspaceId: input.workspaceId,
            userId: input.userId,
            code: assignmentError.code,
        })
        return { ...input, capabilities: [], allowedServiceIds: [], serviceAccessSchemaReady: false }
    }

    const allowedServiceIds = [...new Set((assignments ?? []).map((item) => item.service_id).filter(Boolean))]
    if (!allowedServiceIds.length) {
        return { ...input, capabilities: [], allowedServiceIds: [], serviceAccessSchemaReady: appointmentSettingServices.ready }
    }

    const { data: grants, error: capabilityError } = await supabaseAdmin
        .from("workspace_service_capabilities")
        .select("capability")
        .eq("workspace_id", input.workspaceId)
        .in("service_id", allowedServiceIds)

    if (capabilityError) {
        console.error("Workspace service capabilities could not be loaded", {
            workspaceId: input.workspaceId,
            userId: input.userId,
            code: capabilityError.code,
        })
        return { ...input, capabilities: [], allowedServiceIds, serviceAccessSchemaReady: false }
    }

    const assignedAppointmentSettingService = allowedServiceIds.some((serviceId) => appointmentSettingServices.ids.has(serviceId))
    const capabilities = combineWorkspaceCapabilities((grants ?? []).map((item) => [item.capability])).filter((capability) => (
        capability !== APPOINTMENT_SETTING_CAPABILITY || assignedAppointmentSettingService
    ))

    return { ...input, capabilities, allowedServiceIds, serviceAccessSchemaReady: appointmentSettingServices.ready }
}

export async function requireWorkspaceAccess(slug: string) {
    const membership = await requireWorkspace(slug)
    const access = await loadWorkspaceAccess({
        workspaceId: membership.workspace.id,
        workspaceSlug: membership.workspace.slug,
        userId: membership.user.id,
        role: membership.role,
    })
    return { ...membership, access }
}

export function workspaceAccessHasCapability(access: WorkspaceAccess, capability: WorkspaceCapability) {
    if (capability === APPOINTMENT_SETTING_CAPABILITY) return access.capabilities.includes(capability)
    return isAdminRole(access.role) || access.capabilities.includes(capability)
}

export async function requireWorkspaceCapability(slug: string, capability: WorkspaceCapability) {
    const context = await requireWorkspaceAccess(slug)
    if (!workspaceAccessHasCapability(context.access, capability)) notFound()
    return context
}

export async function requireWorkspacePanel(slug: string, panelKey: WorkspacePanelKey) {
    const context = await requireWorkspaceAccess(slug)
    const panel = workspacePanelByKey(panelKey)
    if (!canAccessWorkspacePanel(panel, context.role, context.access.capabilities)) notFound()
    return context
}

export function defaultWorkspaceHref(access: WorkspaceAccess) {
    const panel = WORKSPACE_PANELS.find((candidate) => canAccessWorkspacePanel(candidate, access.role, access.capabilities))
    return panel ? workspacePanelHref(access.workspaceSlug, panel) : `/${access.workspaceSlug}/no-access`
}

async function loadRelationshipScope(access: WorkspaceAccess): Promise<{
    accessibleIds: Set<string>
    fullyAccessibleIds: Set<string>
}> {
    if (!access.allowedServiceIds.length) return { accessibleIds: new Set(), fullyAccessibleIds: new Set() }
    const { data, error } = await supabaseAdmin
        .from("relationship_services")
        .select("relationship_id, service_id")
        .eq("workspace_id", access.workspaceId)
    if (error) {
        console.error("Relationship service scope could not be loaded", { workspaceId: access.workspaceId, userId: access.userId, code: error.code })
        return { accessibleIds: new Set(), fullyAccessibleIds: new Set() }
    }
    const allowedServiceIds = new Set(access.allowedServiceIds)
    const servicesByRelationship = new Map<string, Set<string>>()
    for (const row of data ?? []) {
        if (!row.relationship_id || !row.service_id) continue
        const serviceIds = servicesByRelationship.get(row.relationship_id) ?? new Set<string>()
        serviceIds.add(row.service_id)
        servicesByRelationship.set(row.relationship_id, serviceIds)
    }
    const accessibleIds = new Set<string>()
    const fullyAccessibleIds = new Set<string>()
    for (const [relationshipId, serviceIds] of servicesByRelationship) {
        if ([...serviceIds].some((serviceId) => allowedServiceIds.has(serviceId))) accessibleIds.add(relationshipId)
        if (serviceIds.size > 0 && [...serviceIds].every((serviceId) => allowedServiceIds.has(serviceId))) fullyAccessibleIds.add(relationshipId)
    }
    return { accessibleIds, fullyAccessibleIds }
}

export async function accessibleRelationshipIds(access: WorkspaceAccess): Promise<Set<string> | null> {
    if (isAdminRole(access.role)) return null
    return (await loadRelationshipScope(access)).accessibleIds
}

export async function fullyAccessibleRelationshipIds(access: WorkspaceAccess): Promise<Set<string> | null> {
    if (isAdminRole(access.role)) return null
    return (await loadRelationshipScope(access)).fullyAccessibleIds
}

export async function workspaceAccessCanRelationship(access: WorkspaceAccess, relationshipId: string) {
    if (isAdminRole(access.role)) return true
    const ids = await accessibleRelationshipIds(access)
    return Boolean(ids?.has(relationshipId))
}

export async function requireRelationshipAccess(access: WorkspaceAccess, relationshipId: string) {
    if (!await workspaceAccessCanRelationship(access, relationshipId)) notFound()
}

export async function accessibleWorkItemIds(access: WorkspaceAccess, relationshipIds?: Set<string> | null): Promise<Set<string> | null> {
    if (isAdminRole(access.role)) return null
    if (!access.allowedServiceIds.length) return new Set()
    const relationshipScope = await loadRelationshipScope(access)
    const scopedRelationshipIds = relationshipIds === undefined
        ? relationshipScope.accessibleIds
        : new Set([...relationshipScope.accessibleIds].filter((id) => relationshipIds?.has(id)))
    const fullyScopedRelationshipIds = new Set([...relationshipScope.fullyAccessibleIds].filter((id) => scopedRelationshipIds.has(id)))
    const [itemResult, linkResult, moduleResult, stepResult] = await Promise.all([
        supabaseAdmin.from("work_items").select("id, service_id, native_kind, metadata").eq("workspace_id", access.workspaceId),
        supabaseAdmin.from("work_item_relationships").select("work_item_id, relationship_id").eq("workspace_id", access.workspaceId),
        supabaseAdmin.from("relationship_onboarding_session_modules").select("id, source_kind").eq("workspace_id", access.workspaceId),
        supabaseAdmin.from("relationship_onboarding_session_steps").select("id, session_module_id").eq("workspace_id", access.workspaceId),
    ])
    if (itemResult.error || linkResult.error || moduleResult.error || stepResult.error) {
        console.error("Work-item service scope could not be loaded", {
            workspaceId: access.workspaceId,
            userId: access.userId,
            code: itemResult.error?.code ?? linkResult.error?.code ?? moduleResult.error?.code ?? stepResult.error?.code,
        })
        return new Set()
    }
    const allowedServiceIds = new Set(access.allowedServiceIds)
    const mandatoryModuleIds = new Set((moduleResult.data ?? []).filter((row) => row.source_kind === "mandatory").map((row) => row.id))
    const sharedStepIds = new Set((stepResult.data ?? []).filter((row) => !row.session_module_id || mandatoryModuleIds.has(row.session_module_id)).map((row) => row.id))
    const relationshipIdsByItem = new Map<string, Set<string>>()
    for (const link of linkResult.data ?? []) {
        const ids = relationshipIdsByItem.get(link.work_item_id) ?? new Set<string>()
        ids.add(link.relationship_id)
        relationshipIdsByItem.set(link.work_item_id, ids)
    }
    const allowedItemIds = new Set<string>()
    for (const item of itemResult.data ?? []) {
        const linkedRelationshipIds = relationshipIdsByItem.get(item.id) ?? new Set<string>()
        if (item.service_id && allowedServiceIds.has(item.service_id)) {
            if (!linkedRelationshipIds.size || [...linkedRelationshipIds].some((id) => scopedRelationshipIds.has(id))) {
                allowedItemIds.add(item.id)
            }
            continue
        }
        if (item.service_id) continue
        const metadata = item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
            ? item.metadata as Record<string, unknown>
            : {}
        const sessionStepId = typeof metadata.session_step_id === "string" ? metadata.session_step_id : null
        const isSharedOnboardingStep = item.native_kind === "onboarding_step" && Boolean(sessionStepId && sharedStepIds.has(sessionStepId))
        if (isSharedOnboardingStep && [...linkedRelationshipIds].some((id) => scopedRelationshipIds.has(id))) {
            allowedItemIds.add(item.id)
            continue
        }
        if ([...linkedRelationshipIds].some((id) => fullyScopedRelationshipIds.has(id))) allowedItemIds.add(item.id)
    }
    return allowedItemIds
}

export async function requireWorkItemAccess(access: WorkspaceAccess, workItemId: string) {
    if (!await workspaceAccessCanWorkItem(access, workItemId)) notFound()
}

export async function workspaceAccessCanWorkItem(access: WorkspaceAccess, workItemId: string) {
    const ids = await accessibleWorkItemIds(access)
    return !ids || ids.has(workItemId)
}

export async function accessibleAssetIds(access: WorkspaceAccess, relationshipIds?: Set<string> | null, workItemIds?: Set<string> | null): Promise<Set<string> | null> {
    if (isAdminRole(access.role)) return null
    const relationshipScope = await loadRelationshipScope(access)
    const scopedRelationshipIds = relationshipIds === undefined
        ? relationshipScope.accessibleIds
        : new Set([...relationshipScope.accessibleIds].filter((id) => relationshipIds?.has(id)))
    const fullyScopedRelationshipIds = new Set([...relationshipScope.fullyAccessibleIds].filter((id) => scopedRelationshipIds.has(id)))
    const scopedWorkItemIds = workItemIds === undefined ? await accessibleWorkItemIds(access, scopedRelationshipIds) : workItemIds
    const relationshipIdList = [...fullyScopedRelationshipIds]
    const workItemIdList = [...(scopedWorkItemIds ?? [])]
    const [relationshipLinks, workItemLinks] = await Promise.all([
        relationshipIdList.length
            ? supabaseAdmin.from("asset_relationships").select("asset_id").eq("workspace_id", access.workspaceId).in("relationship_id", relationshipIdList)
            : Promise.resolve({ data: [] as Array<{ asset_id: string }>, error: null }),
        workItemIdList.length
            ? supabaseAdmin.from("asset_work_items").select("asset_id").eq("workspace_id", access.workspaceId).in("work_item_id", workItemIdList)
            : Promise.resolve({ data: [] as Array<{ asset_id: string }>, error: null }),
    ])
    if (relationshipLinks.error || workItemLinks.error) return new Set()
    return new Set([
        ...(relationshipLinks.data ?? []).map((item) => item.asset_id),
        ...(workItemLinks.data ?? []).map((item) => item.asset_id),
    ])
}

export async function requireAssetAccess(access: WorkspaceAccess, assetId: string) {
    if (!await workspaceAccessCanAsset(access, assetId)) notFound()
}

export async function workspaceAccessCanAsset(access: WorkspaceAccess, assetId: string) {
    const ids = await accessibleAssetIds(access)
    return !ids || ids.has(assetId)
}
