"use server"

import type { ConfigurationActionResult, OnboardingServiceDefinition, OnboardingServiceState } from "@/lib/onboarding/configuration-types"
import { configurationRpc, configurationSchemaUnavailable, revalidateOnboardingConfiguration, unexpectedConfigurationError } from "@/lib/onboarding/configuration-actions"
import { normalizeServiceDefinition } from "@/lib/onboarding/configuration-validation"
import { SERVICE_TEMPLATES } from "@/lib/onboarding/service-templates"
import { requireWorkspace } from "@/lib/workspaces"

type SavedService = { service_id: string; revision_id: string; revision_number: number; state: OnboardingServiceState }

export async function saveOnboardingService(slug: string, serviceId: string | null, input: OnboardingServiceDefinition): Promise<ConfigurationActionResult<SavedService>> {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        if (configurationSchemaUnavailable(serviceId)) return { ok: false, error: "The editable service catalogue is still being prepared for this workspace." }
        const normalized = normalizeServiceDefinition(input)
        if (!normalized.ok) return normalized
        if (normalized.definition.thumbnailPath && !normalized.definition.thumbnailPath.startsWith(`${workspace.id}/service-thumbnails/`)) {
            return { ok: false, error: "The service thumbnail does not belong to this workspace." }
        }
        const template = !serviceId && normalized.definition.templateId
            ? SERVICE_TEMPLATES.find((candidate) => candidate.id === normalized.definition.templateId)
            : null
        const operation = template?.setup.kind === "connection"
            ? "install_onboarding_service_template"
            : "save_onboarding_service_revision"
        const definition = {
            ...normalized.definition,
            templateId: template?.id ?? normalized.definition.templateId,
            requiredConnectionKeys: template?.setup.kind === "connection" ? [template.setup.connectionKey] : normalized.definition.requiredConnectionKeys,
            defaultPriceCents: normalized.definition.defaultUpfrontPriceCents,
        }
        const outcome = await configurationRpc<SavedService>(operation, {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_service_id: serviceId || null,
            p_definition: definition,
            ...(template?.setup.kind === "connection" ? {
                p_template_id: template.id,
                p_connection_provider: template.setup.connectionKey,
            } : {}),
        })
        if (outcome.ok) revalidateOnboardingConfiguration(slug)
        return outcome
    } catch (error) {
        return unexpectedConfigurationError(error)
    }
}
export async function setOnboardingServiceState(slug: string, serviceId: string, state: OnboardingServiceState): Promise<ConfigurationActionResult<{ service_id: string; state: OnboardingServiceState }>> {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        if (configurationSchemaUnavailable(serviceId)) return { ok: false, error: "Legacy services cannot change state until the catalogue migration is complete." }
        if (!(["active", "retired", "archived"] as string[]).includes(state)) return { ok: false, error: "Unknown service state." }
        const outcome = await configurationRpc<{ service_id: string; state: OnboardingServiceState }>("set_onboarding_service_state", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_service_id: serviceId,
            p_state: state,
        })
        if (outcome.ok) revalidateOnboardingConfiguration(slug)
        return outcome
    } catch (error) {
        return unexpectedConfigurationError(error)
    }
}
