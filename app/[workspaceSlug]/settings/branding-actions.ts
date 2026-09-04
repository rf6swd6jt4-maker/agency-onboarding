"use server"

import { revalidatePath } from "next/cache"

import { recordAdminActivity } from "@/lib/admin/activity"
import type { ConfigurationActionResult, OnboardingBrandSwatch, OnboardingThemeSlot } from "@/lib/onboarding/configuration-types"
import { ONBOARDING_THEME_SLOTS } from "@/lib/onboarding/configuration-types"
import { configurationRpc, revalidateOnboardingConfiguration, unexpectedConfigurationError } from "@/lib/onboarding/configuration-actions"
import { normalizeHexColour } from "@/lib/onboarding/theme"
import { deleteOnboardingUploads, storeClientBrandFavicon, storeClientBrandLogo } from "@/lib/onboarding/uploads"
import type { WorkspaceMutationResult } from "@/lib/workspace-mutations"
import { requireWorkspace } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"

function cleanOptionalText(formData: FormData, key: string, maximum: number) {
    const value = String(formData.get(key) ?? "").trim().replace(/\s+/gu, " ")
    if (!value) return null
    if (value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("One of the public branding fields is not valid.")
    return value
}

function cleanPolicyUrl(formData: FormData, key: string, label: string) {
    const value = String(formData.get(key) ?? "").trim()
    if (!value) return null
    if (value.length > 2_000) throw new Error(`${label} is too long.`)
    try {
        const url = new URL(value)
        if (url.protocol !== "https:" || url.username || url.password) throw new Error()
        return url.toString()
    } catch {
        throw new Error(`${label} must be a public HTTPS URL.`)
    }
}

async function saveAgencyBrandAsset(input: {
    slug: string
    formData: FormData
    formKey: "agency_logo" | "agency_favicon"
    column: "agency_logo_path" | "agency_favicon_path"
    label: "logo" | "favicon"
}) {
    const { workspace, user } = await requireWorkspace(input.slug, "admin")
    const file = input.formData.get(input.formKey)
    if (!(file instanceof File) || file.size === 0) throw new Error(`Choose an agency ${input.label} to upload.`)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const storagePath = input.label === "logo"
        ? await storeClientBrandLogo(workspace.id, { name: file.name, size: file.size, type: file.type, bytes })
        : await storeClientBrandFavicon(workspace.id, { name: file.name, size: file.size, type: file.type, bytes })
    const { data: previous, error } = await supabaseAdmin.from("workspaces")
        .update({ [input.column]: storagePath, updated_at: new Date().toISOString() })
        .eq("id", workspace.id)
        .select(input.column)
        .maybeSingle()
    if (error || !previous) {
        await deleteOnboardingUploads([storagePath]).catch(() => undefined)
        const schemaMissing = error?.code === "42703" || error?.code === "PGRST204" || /schema cache|could not find/iu.test(error?.message ?? "")
        throw new Error(schemaMissing ? "Deploy the client branding database update before uploading artwork." : `The ${input.label} uploaded, but could not be saved to this workspace.`)
    }
    await recordAdminActivity({
        workspaceId: workspace.id,
        category: "onboarding",
        eventKey: `agency.${input.label}.updated`,
        summary: `Public agency ${input.label} updated`,
        sourceHref: `/${input.slug}/settings#agency-branding`,
        actorUserId: user.id,
        metadata: { storage_path: storagePath },
    })
    revalidatePath(`/${input.slug}/settings`)
}

export async function uploadAgencyLogo(slug: string, formData: FormData) {
    await saveAgencyBrandAsset({ slug, formData, formKey: "agency_logo", column: "agency_logo_path", label: "logo" })
}

export async function uploadAgencyFavicon(slug: string, formData: FormData) {
    await saveAgencyBrandAsset({ slug, formData, formKey: "agency_favicon", column: "agency_favicon_path", label: "favicon" })
}

export async function saveAgencyPublicBranding(slug: string, formData: FormData): Promise<WorkspaceMutationResult> {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        const displayName = cleanOptionalText(formData, "agency_display_name", 100)
        const metadataTitle = cleanOptionalText(formData, "agency_metadata_title", 100)
        const metadataDescription = cleanOptionalText(formData, "agency_metadata_description", 300)
        if (!displayName || displayName.length < 2) return { ok: false, error: "Agency display names must be between 2 and 100 characters." }
        if (metadataTitle && metadataTitle.length < 2) return { ok: false, error: "Page title names must be between 2 and 100 characters." }
        if (metadataDescription && metadataDescription.length < 10) return { ok: false, error: "Page descriptions must be at least 10 characters." }
        const privacyPolicyUrl = cleanPolicyUrl(formData, "agency_privacy_policy_url", "Privacy policy URL")
        const termsOfServiceUrl = cleanPolicyUrl(formData, "agency_terms_of_service_url", "Terms of service URL")

        const { error } = await supabaseAdmin.from("workspaces").update({
            agency_display_name: displayName,
            agency_privacy_policy_url: privacyPolicyUrl,
            agency_terms_of_service_url: termsOfServiceUrl,
            agency_metadata_title: metadataTitle,
            agency_metadata_description: metadataDescription,
            updated_at: new Date().toISOString(),
        }).eq("id", workspace.id)
        if (error) {
            const schemaMissing = error.code === "42703" || error.code === "PGRST204" || /schema cache|could not find/iu.test(error.message)
            return { ok: false, error: schemaMissing ? "Deploy the public branding database update before saving these fields." : "Could not save public agency branding." }
        }

        await recordAdminActivity({
            workspaceId: workspace.id,
            category: "onboarding",
            eventKey: "agency.public_branding.updated",
            summary: "Public agency branding updated",
            sourceHref: `/${slug}/settings#agency-branding`,
            actorUserId: user.id,
            metadata: {
                display_name: displayName,
                privacy_policy_configured: Boolean(privacyPolicyUrl),
                terms_of_service_configured: Boolean(termsOfServiceUrl),
                metadata_title_configured: Boolean(metadataTitle),
                metadata_description_configured: Boolean(metadataDescription),
            },
        })
        revalidatePath(`/${slug}/settings`)
        return { ok: true }
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Could not save public agency branding." }
    }
}

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
