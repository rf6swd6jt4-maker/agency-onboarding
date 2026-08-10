"use server"

import type { ConfigurationActionResult } from "@/lib/onboarding/configuration-types"
import { configurationRpc, configurationSchemaUnavailable, revalidateOnboardingConfiguration, unexpectedConfigurationError } from "@/lib/onboarding/configuration-actions"
import { requireWorkspace } from "@/lib/workspaces"

type ConfigurationRevision = { configuration_revision_id: string; revision_number?: number; updated_at?: string }

function validModuleIds(ids: string[]) {
    return ids.length === new Set(ids).size && ids.every((id) => id && !configurationSchemaUnavailable(id))
}

export async function saveMandatoryModuleDraft(slug: string, moduleIds: string[], helpText?: string | null, whatsappEnabled?: boolean | null): Promise<ConfigurationActionResult<ConfigurationRevision>> {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        if (!validModuleIds(moduleIds)) return { ok: false, error: "The mandatory module order contains an unavailable or duplicate module." }
        const outcome = await configurationRpc<ConfigurationRevision>("save_onboarding_configuration_draft", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_module_ids: moduleIds,
            p_help_text: typeof helpText === "string" ? helpText.trim().slice(0, 2_000) : null,
            p_whatsapp_enabled: typeof whatsappEnabled === "boolean" ? whatsappEnabled : null,
        })
        if (outcome.ok) revalidateOnboardingConfiguration(slug)
        return outcome
    } catch (error) {
        return unexpectedConfigurationError(error)
    }
}

export async function publishMandatoryModuleConfiguration(slug: string): Promise<ConfigurationActionResult<ConfigurationRevision>> {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        const outcome = await configurationRpc<ConfigurationRevision>("publish_onboarding_configuration", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
        })
        if (outcome.ok) revalidateOnboardingConfiguration(slug)
        return outcome
    } catch (error) {
        return unexpectedConfigurationError(error)
    }
}

export async function saveOnboardingHelpSettings(slug: string, helpText: string, whatsappEnabled: boolean): Promise<ConfigurationActionResult<ConfigurationRevision>> {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        const outcome = await configurationRpc<ConfigurationRevision>("save_published_onboarding_help", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_help_text: helpText.trim().slice(0, 2_000),
            p_whatsapp_enabled: whatsappEnabled,
        })
        if (outcome.ok) revalidateOnboardingConfiguration(slug)
        return outcome
    } catch (error) {
        return unexpectedConfigurationError(error)
    }
}
