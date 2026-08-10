"use server"

import type { ConfigurationActionResult, OnboardingBrandSwatch, OnboardingThemeSlot } from "@/lib/onboarding/configuration-types"
import { ONBOARDING_THEME_SLOTS } from "@/lib/onboarding/configuration-types"
import { configurationRpc, revalidateOnboardingConfiguration, unexpectedConfigurationError } from "@/lib/onboarding/configuration-actions"
import { normalizeHexColour } from "@/lib/onboarding/theme"
import { requireWorkspace } from "@/lib/workspaces"

export async function saveAgencyBranding(slug: string, swatches: OnboardingBrandSwatch[], assignments: Record<OnboardingThemeSlot, string>): Promise<ConfigurationActionResult<{ theme_revision_id: string; updated_at: string }>> {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        if (swatches.length > 50) return { ok: false, error: "Keep the onboarding palette to 50 colours or fewer." }
        const cleaned = swatches.map((swatch) => ({ id: swatch.id, name: swatch.name.trim().slice(0, 80), hex: normalizeHexColour(swatch.hex), hidden: Boolean(swatch.hidden) }))
        if (cleaned.some((swatch) => !swatch.id || !swatch.name || !swatch.hex)) return { ok: false, error: "Every colour needs a name and valid hex value." }
        const swatchIds = new Set(cleaned.map((swatch) => swatch.id))
        if (ONBOARDING_THEME_SLOTS.some((slot) => !swatchIds.has(assignments[slot]))) return { ok: false, error: "Assign an existing colour to every theme role." }
        const outcome = await configurationRpc<{ theme_revision_id: string; updated_at: string }>("save_onboarding_theme_draft", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_definition: { swatches: cleaned, assignments, updatedAt: new Date().toISOString(), updatedBy: user.id },
        })
        if (outcome.ok) revalidateOnboardingConfiguration(slug)
        return outcome
    } catch (error) {
        return unexpectedConfigurationError(error)
    }
}
