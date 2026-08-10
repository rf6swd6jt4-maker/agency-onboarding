"use server"

import type { ConfigurationActionResult, OnboardingServiceDefinition, OnboardingServiceState } from "@/lib/onboarding/configuration-types"
import { configurationRpc, configurationSchemaUnavailable, revalidateOnboardingConfiguration, unexpectedConfigurationError } from "@/lib/onboarding/configuration-actions"
import { normalizeServiceDefinition } from "@/lib/onboarding/configuration-validation"
import { requireWorkspace } from "@/lib/workspaces"

type SavedService = { service_id: string; revision_id: string; revision_number: number; state: OnboardingServiceState }

export async function saveOnboardingService(slug: string, serviceId: string | null, input: OnboardingServiceDefinition): Promise<ConfigurationActionResult<SavedService>> {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        if (configurationSchemaUnavailable(serviceId)) return { ok: false, error: "The editable service catalogue is still being prepared for this workspace." }
        const normalized = normalizeServiceDefinition(input)
        if (!normalized.ok) return normalized
        const outcome = await configurationRpc<SavedService>("save_onboarding_service_revision", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_service_id: serviceId || null,
            p_definition: normalized.definition,
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
