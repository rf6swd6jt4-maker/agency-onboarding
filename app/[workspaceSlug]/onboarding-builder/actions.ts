"use server"

import { createHash, randomBytes } from "crypto"
import type {
    ConfigurationActionResult,
    OnboardingBookendDefinition,
    OnboardingBookendKind,
    OnboardingModuleDefinition,
} from "@/lib/onboarding/configuration-types"
import { configurationRpc, configurationSchemaUnavailable, revalidateOnboardingConfiguration, unexpectedConfigurationError } from "@/lib/onboarding/configuration-actions"
import { defaultOnboardingModuleDefinition, isAllowedOnboardingVideoUrl, isScopedBuilderVideoPath, normalizeModuleDefinition } from "@/lib/onboarding/configuration-validation"
import { createSignedBuilderMediaUpload } from "@/lib/onboarding/uploads"
import { processWorkspaceOnboardingOutbox } from "@/lib/onboarding/outbox"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

type ModuleDraftResult = { module_id: string; draft_revision_id: string; updated_at?: string }
type PublishedModuleResult = { module_id: string; revision_id: string; revision_number: number; affected_active_sessions: number }

function normalizeBookend(input: OnboardingBookendDefinition) {
    const title = input.title.trim().slice(0, 160)
    const body = input.body.trim().slice(0, 6_000)
    const videoUrl = input.videoUrl.trim().slice(0, 2_000)
    if (!title) return { ok: false as const, error: "Give this bookend a title before saving." }
    if (videoUrl && !isAllowedOnboardingVideoUrl(videoUrl)) return { ok: false as const, error: "Use a Loom, YouTube, Vimeo, or direct HTTPS video URL." }
    if (input.videoPath) return { ok: false as const, error: "Bookend videos must use a supported HTTPS URL." }
    return { ok: true as const, definition: { title, body, videoUrl, videoPath: null } }
}

async function validateModuleVideoPaths(
    workspaceId: string,
    moduleId: string,
    input: OnboardingModuleDefinition,
    definition: { steps: Array<{ videoPath: string | null }> }
) {
    const paths = definition.steps.map((step) => step.videoPath).filter((path): path is string => Boolean(path))
    if (!paths.length) return null
    if (!input.revisionId || paths.some((path) => !isScopedBuilderVideoPath(path, workspaceId, moduleId, input.revisionId))) {
        return "The uploaded video does not belong to this module draft. Upload it again before saving."
    }
    const { data: revision, error } = await supabaseAdmin
        .from("onboarding_module_revisions")
        .select("id, status")
        .eq("workspace_id", workspaceId)
        .eq("module_id", moduleId)
        .eq("id", input.revisionId)
        .eq("status", "draft")
        .maybeSingle()
    if (error || !revision) return "The uploaded video does not belong to this module draft. Upload it again before saving."
    return null
}

export async function createOnboardingModule(slug: string): Promise<ConfigurationActionResult<ModuleDraftResult>> {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        const outcome = await configurationRpc<ModuleDraftResult>("create_onboarding_module", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_definition: defaultOnboardingModuleDefinition(),
        })
        if (outcome.ok) revalidateOnboardingConfiguration(slug)
        return outcome
    } catch (error) {
        return unexpectedConfigurationError(error)
    }
}

export async function saveOnboardingModuleDraft(slug: string, moduleId: string, input: OnboardingModuleDefinition): Promise<ConfigurationActionResult<ModuleDraftResult>> {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        if (configurationSchemaUnavailable(moduleId)) return { ok: false, error: "This legacy module will become editable after the workspace catalogue migration." }
        const normalized = normalizeModuleDefinition(input)
        if (!normalized.ok) return normalized
        const videoPathError = await validateModuleVideoPaths(workspace.id, moduleId, input, normalized.definition)
        if (videoPathError) return { ok: false, error: videoPathError }
        const outcome = await configurationRpc<ModuleDraftResult>("save_onboarding_module_draft", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_module_id: moduleId,
            p_definition: normalized.definition,
        })
        if (outcome.ok) revalidateOnboardingConfiguration(slug)
        return outcome
    } catch (error) {
        return unexpectedConfigurationError(error)
    }
}

export async function duplicateOnboardingModule(slug: string, moduleId: string): Promise<ConfigurationActionResult<ModuleDraftResult>> {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        if (configurationSchemaUnavailable(moduleId)) return { ok: false, error: "Legacy modules cannot be duplicated until the catalogue migration is complete." }
        const outcome = await configurationRpc<ModuleDraftResult>("duplicate_onboarding_module", { p_workspace_id: workspace.id, p_actor_user_id: user.id, p_module_id: moduleId })
        if (outcome.ok) revalidateOnboardingConfiguration(slug)
        return outcome
    } catch (error) {
        return unexpectedConfigurationError(error)
    }
}

export async function deleteOnboardingModuleDraft(slug: string, moduleId: string): Promise<ConfigurationActionResult<{ module_id: string; deleted: boolean }>> {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        if (configurationSchemaUnavailable(moduleId)) return { ok: false, error: "Legacy modules cannot be deleted." }
        const outcome = await configurationRpc<{ module_id: string; deleted: boolean }>("delete_onboarding_module_draft", { p_workspace_id: workspace.id, p_actor_user_id: user.id, p_module_id: moduleId })
        if (outcome.ok) revalidateOnboardingConfiguration(slug)
        return outcome
    } catch (error) {
        return unexpectedConfigurationError(error)
    }
}

export async function publishOnboardingModule(slug: string, moduleId: string, input: OnboardingModuleDefinition, applyToActive: boolean, explanation: string): Promise<ConfigurationActionResult<PublishedModuleResult>> {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        if (configurationSchemaUnavailable(moduleId)) return { ok: false, error: "Legacy modules are already live and cannot be published from Builder." }
        const normalized = normalizeModuleDefinition(input)
        if (!normalized.ok) return normalized
        const videoPathError = await validateModuleVideoPaths(workspace.id, moduleId, input, normalized.definition)
        if (videoPathError) return { ok: false, error: videoPathError }
        const saved = await configurationRpc<ModuleDraftResult>("save_onboarding_module_draft", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_module_id: moduleId,
            p_definition: normalized.definition,
        })
        if (!saved.ok) return saved
        const outcome = await configurationRpc<PublishedModuleResult>("publish_onboarding_module", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_module_id: moduleId,
            p_apply_to_active: applyToActive,
            p_explanation: applyToActive ? explanation.trim().slice(0, 2_000) || "We updated this part of your onboarding so we can collect the right information. Please complete it again." : null,
        })
        if (outcome.ok) {
            revalidateOnboardingConfiguration(slug)
            // The publish RPC commits the revision, active-session resets,
            // notices, Activity, and outbox rows atomically. Delivery starts
            // only after that boundary and can never invalidate the publish.
            try {
                await processWorkspaceOnboardingOutbox(workspace.id, 25)
            } catch {
                // The protected retry endpoint will reclaim due or stale rows.
            }
        }
        return outcome
    } catch (error) {
        return unexpectedConfigurationError(error)
    }
}

async function setModuleArchiveState(slug: string, moduleId: string, action: "archive_onboarding_module" | "restore_onboarding_module") {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        if (configurationSchemaUnavailable(moduleId)) return { ok: false as const, error: "Legacy modules cannot change state until migration is complete." }
        const outcome = await configurationRpc<{ module_id: string; status: string }>(action, { p_workspace_id: workspace.id, p_actor_user_id: user.id, p_module_id: moduleId })
        if (outcome.ok) revalidateOnboardingConfiguration(slug)
        return outcome
    } catch (error) {
        return unexpectedConfigurationError(error)
    }
}

export async function archiveOnboardingModule(slug: string, moduleId: string) {
    return setModuleArchiveState(slug, moduleId, "archive_onboarding_module")
}

export async function restoreOnboardingModule(slug: string, moduleId: string) {
    return setModuleArchiveState(slug, moduleId, "restore_onboarding_module")
}

export async function saveOnboardingBookendDraft(slug: string, kind: OnboardingBookendKind, input: OnboardingBookendDefinition): Promise<ConfigurationActionResult<{ bookend_revision_id: string; updated_at: string }>> {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        const normalized = normalizeBookend(input)
        if (!normalized.ok) return normalized
        const outcome = await configurationRpc<{ bookend_revision_id: string; updated_at: string }>("save_onboarding_bookend_draft", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_kind: kind,
            p_definition: normalized.definition,
        })
        if (outcome.ok) revalidateOnboardingConfiguration(slug)
        return outcome
    } catch (error) {
        return unexpectedConfigurationError(error)
    }
}

export async function publishOnboardingBookend(slug: string, kind: OnboardingBookendKind, input: OnboardingBookendDefinition): Promise<ConfigurationActionResult<{ bookend_revision_id: string; revision_number: number }>> {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        const normalized = normalizeBookend(input)
        if (!normalized.ok) return normalized
        const saved = await configurationRpc("save_onboarding_bookend_draft", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_kind: kind,
            p_definition: normalized.definition,
        })
        if (!saved.ok) return saved
        const outcome = await configurationRpc<{ bookend_revision_id: string; revision_number: number }>("publish_onboarding_bookend", { p_workspace_id: workspace.id, p_actor_user_id: user.id, p_kind: kind })
        if (outcome.ok) revalidateOnboardingConfiguration(slug)
        return outcome
    } catch (error) {
        return unexpectedConfigurationError(error)
    }
}

export async function rotateOnboardingModulePreview(slug: string, moduleId: string, input: OnboardingModuleDefinition): Promise<ConfigurationActionResult<{ token: string; expiresAt: string }>> {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        if (configurationSchemaUnavailable(moduleId)) return { ok: false, error: "Preview links are available after this module is migrated into Builder." }
        const normalized = normalizeModuleDefinition(input)
        if (!normalized.ok) return normalized
        const videoPathError = await validateModuleVideoPaths(workspace.id, moduleId, input, normalized.definition)
        if (videoPathError) return { ok: false, error: videoPathError }
        const saved = await configurationRpc<ModuleDraftResult>("save_onboarding_module_draft", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_module_id: moduleId,
            p_definition: normalized.definition,
        })
        if (!saved.ok) return saved
        const token = randomBytes(32).toString("hex")
        const tokenHash = createHash("sha256").update(token).digest("hex")
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString()
        const outcome = await configurationRpc<{ preview_token_id: string; expires_at: string }>("rotate_onboarding_preview_token", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_module_id: moduleId,
            p_token_hash: tokenHash,
            p_expires_at: expiresAt,
        })
        if (!outcome.ok) return outcome
        revalidateOnboardingConfiguration(slug)
        return { ok: true, data: { token, expiresAt: outcome.data?.expires_at ?? expiresAt } }
    } catch (error) {
        return unexpectedConfigurationError(error)
    }
}

export async function revokeOnboardingModulePreview(slug: string, moduleId: string): Promise<ConfigurationActionResult> {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        if (configurationSchemaUnavailable(moduleId)) return { ok: false, error: "Legacy preview links cannot be revoked until the catalogue migration is complete." }
        const outcome = await configurationRpc<undefined>("record_onboarding_preview_revoked", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_module_id: moduleId,
        })
        if (outcome.ok) revalidateOnboardingConfiguration(slug)
        return outcome
    } catch (error) {
        return unexpectedConfigurationError(error)
    }
}

export async function prepareBuilderVideoUpload(slug: string, moduleId: string, revisionId: string, file: { name: string; size: number; type: string }) {
    const { workspace } = await requireWorkspace(slug, "admin")
    if (configurationSchemaUnavailable(moduleId)) throw new Error("Legacy modules cannot receive Builder uploads.")
    const [{ data: module }, { data: revision }] = await Promise.all([
        supabaseAdmin.from("onboarding_modules").select("id").eq("workspace_id", workspace.id).eq("id", moduleId).maybeSingle(),
        supabaseAdmin.from("onboarding_module_revisions").select("id, status").eq("workspace_id", workspace.id).eq("module_id", moduleId).eq("id", revisionId).eq("status", "draft").maybeSingle(),
    ])
    if (!module || !revision) throw new Error("This module draft is no longer available.")
    return createSignedBuilderMediaUpload(workspace.id, moduleId, revisionId, file)
}
