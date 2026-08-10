"use server"

import { createHash, randomBytes, randomUUID } from "crypto"
import * as Y from "yjs"
import { revalidatePath } from "next/cache"
import type { OnboardingBookendDefinitionV2, OnboardingModuleDefinitionV2 } from "@/lib/onboarding/block-definition"
import { normalizeThemeDraft, normalizeVisualBookend, normalizeVisualModule } from "@/lib/onboarding/block-validation"
import type { ConfigurationActionResult, OnboardingThemeDefinition } from "@/lib/onboarding/configuration-types"
import { configurationRpc, unexpectedConfigurationError } from "@/lib/onboarding/configuration-actions"
import { processWorkspaceOnboardingOutbox } from "@/lib/onboarding/outbox"
import { createSignedBuilderMediaUpload } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

type CollaborativeUpdateResult = { sequence: number; version: number }

function decodeUpdate(base64: string) {
    return new Uint8Array(Buffer.from(base64, "base64"))
}

async function maybeCompactBuilderDocument(workspaceId: string, userId: string) {
    const [{ data: document }, { data: updates }] = await Promise.all([
        supabaseAdmin.from("onboarding_builder_documents").select("snapshot_base64, snapshot_sequence").eq("workspace_id", workspaceId).maybeSingle(),
        supabaseAdmin.from("onboarding_builder_updates").select("sequence, update_base64").eq("workspace_id", workspaceId).order("sequence").limit(300),
    ])
    if (!updates || updates.length < 250) return
    const ydoc = new Y.Doc()
    if (document?.snapshot_base64) Y.applyUpdate(ydoc, decodeUpdate(document.snapshot_base64))
    for (const update of updates) Y.applyUpdate(ydoc, decodeUpdate(update.update_base64))
    const snapshot = Buffer.from(Y.encodeStateAsUpdate(ydoc)).toString("base64")
    await configurationRpc("compact_onboarding_builder_document", {
        p_workspace_id: workspaceId,
        p_actor_user_id: userId,
        p_snapshot_base64: snapshot,
        p_snapshot_sequence: Number(updates.at(-1)?.sequence ?? document?.snapshot_sequence ?? 0),
    })
}

export async function persistVisualBuilderUpdate(slug: string, updateId: string, updateBase64: string, definitionIds: string[]): Promise<ConfigurationActionResult<CollaborativeUpdateResult>> {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        if (!/^[0-9a-f-]{36}:[0-9]+$/i.test(updateId) || !/^[A-Za-z0-9+/=]+$/.test(updateBase64) || updateBase64.length > 1_400_000 || definitionIds.some((id) => !/^[a-zA-Z0-9:_-]{1,160}$/.test(id))) {
            return { ok: false, error: "The collaborative update was invalid." }
        }
        const outcome = await configurationRpc<CollaborativeUpdateResult>("append_onboarding_builder_update", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_update_id: updateId,
            p_update_base64: updateBase64,
            p_definition_ids: [...new Set(definitionIds)].slice(0, 100),
        })
        if (outcome.ok) await maybeCompactBuilderDocument(workspace.id, user.id)
        return outcome
    } catch (error) {
        return unexpectedConfigurationError(error)
    }
}

function visualVideoPaths(module: OnboardingModuleDefinitionV2) {
    return module.steps.flatMap((step) => step.blocks.flatMap((block) => block.kind === "video" && block.upload ? [block.upload.path] : []))
}

function pathsBelongToDraft(paths: string[], workspaceId: string, entityId: string, revisionId: string | null) {
    if (!revisionId) return paths.length === 0
    const prefix = `${workspaceId}/onboarding-builder/${entityId}/${revisionId}/`
    return paths.every((path) => path.startsWith(prefix) && !path.includes("\\") && !path.split("/").some((part) => part === "." || part === ".."))
}

export async function publishVisualOnboardingRelease(slug: string, input: {
    modules: OnboardingModuleDefinitionV2[]
    bookends: OnboardingBookendDefinitionV2[]
    theme: OnboardingThemeDefinition | null
    expectedDocumentVersion: number
    applyToActive: boolean
    explanation: string
}): Promise<ConfigurationActionResult<{ release_id: string; results: unknown[] }>> {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        const normalizedModules = input.modules.map(normalizeVisualModule)
        const moduleError = normalizedModules.find((result) => !result.ok)
        if (moduleError && !moduleError.ok) return { ok: false, error: moduleError.error }
        const normalizedBookends = input.bookends.map(normalizeVisualBookend)
        const bookendError = normalizedBookends.find((result) => !result.ok)
        if (bookendError && !bookendError.ok) return { ok: false, error: bookendError.error }

        for (const result of normalizedModules) {
            if (!result.ok) continue
            if (!pathsBelongToDraft(visualVideoPaths(result.definition), workspace.id, result.definition.id, result.definition.revisionId)) {
                return { ok: false, error: `An uploaded video in ${result.definition.name} does not belong to its current draft.` }
            }
        }
        for (const result of normalizedBookends) {
            if (!result.ok) continue
            const paths = result.definition.steps.flatMap((step) => step.blocks.flatMap((block) => block.kind === "video" && block.upload ? [block.upload.path] : []))
            if (!pathsBelongToDraft(paths, workspace.id, `bookend-${result.definition.kind}`, result.definition.revisionId)) {
                return { ok: false, error: `An uploaded video in ${result.definition.kind} does not belong to its current draft.` }
            }
        }
        let normalizedTheme: ReturnType<typeof normalizeThemeDraft> | null = null
        if (input.theme) {
            normalizedTheme = normalizeThemeDraft(input.theme)
            if (!normalizedTheme.ok) return normalizedTheme
        }

        const releaseId = randomUUID()
        const outcome = await configurationRpc<{ release_id: string; results: unknown[] }>("publish_visual_onboarding_release", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_expected_document_version: input.expectedDocumentVersion,
            p_modules: normalizedModules.flatMap((result) => result.ok ? [{ id: result.definition.id, definition: result.persistedDefinition }] : []),
            p_bookends: normalizedBookends.flatMap((result) => result.ok ? [{ kind: result.definition.kind, definition: result.persistedDefinition }] : []),
            p_theme: normalizedTheme?.ok ? normalizedTheme.definition : null,
            p_apply_to_active: input.applyToActive,
            p_explanation: input.explanation.trim().slice(0, 2_000),
            p_release_id: releaseId,
            p_idempotency_key: `onboarding.release.published:${releaseId}`,
        })
        if (outcome.ok) {
            revalidatePath(`/${slug}/onboarding-builder`)
            revalidatePath(`/${slug}/settings`)
            try { await processWorkspaceOnboardingOutbox(workspace.id, 25) } catch { /* durable retry route owns recovery */ }
        }
        return outcome
    } catch (error) {
        return unexpectedConfigurationError(error)
    }
}

export async function prepareVisualBuilderVideoUpload(slug: string, target: (
    { kind: "module"; definition: OnboardingModuleDefinitionV2 }
    | { kind: "bookend"; definition: OnboardingBookendDefinitionV2 }
), file: { name: string; size: number; type: string }) {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    let entityId: string
    let draftRevisionId: string
    if (target.kind === "module") {
        const normalized = normalizeVisualModule(target.definition)
        if (!normalized.ok) throw new Error(normalized.error)
        const saved = await configurationRpc<{ draft_revision_id: string }>("save_onboarding_module_draft", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_module_id: normalized.definition.id,
            p_definition: normalized.persistedDefinition,
        })
        if (!saved.ok) throw new Error(saved.error)
        if (!saved.data?.draft_revision_id) throw new Error("The module draft could not be prepared for upload.")
        entityId = normalized.definition.id
        draftRevisionId = saved.data.draft_revision_id
    } else {
        const normalized = normalizeVisualBookend(target.definition)
        if (!normalized.ok) throw new Error(normalized.error)
        const saved = await configurationRpc<{ bookend_revision_id: string }>("save_onboarding_bookend_draft", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_kind: normalized.definition.kind,
            p_definition: normalized.persistedDefinition,
        })
        if (!saved.ok) throw new Error(saved.error)
        if (!saved.data?.bookend_revision_id) throw new Error("The bookend draft could not be prepared for upload.")
        entityId = `bookend-${normalized.definition.kind}`
        draftRevisionId = saved.data.bookend_revision_id
    }
    return { ...(await createSignedBuilderMediaUpload(workspace.id, entityId, draftRevisionId, file)), draftRevisionId }
}

export async function rotateVisualOnboardingPreview(slug: string, snapshot: Record<string, unknown>) {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    const serialized = JSON.stringify(snapshot)
    if (serialized.length > 2_000_000) return { ok: false as const, error: "The composed preview is too large." }
    const token = randomBytes(32).toString("hex")
    const tokenHash = createHash("sha256").update(token).digest("hex")
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString()
    const outcome = await configurationRpc("rotate_visual_onboarding_preview_token", {
        p_workspace_id: workspace.id,
        p_actor_user_id: user.id,
        p_token_hash: tokenHash,
        p_snapshot: snapshot,
        p_expires_at: expiresAt,
    })
    if (!outcome.ok) return { ok: false as const, error: outcome.error }
    return { ok: true as const, data: { token, expiresAt } }
}

export async function saveVisualThemeDraft(slug: string, theme: OnboardingThemeDefinition) {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        const normalized = normalizeThemeDraft(theme)
        if (!normalized.ok) return normalized
        return configurationRpc("save_onboarding_theme_draft", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_definition: normalized.definition,
        })
    } catch (error) {
        return unexpectedConfigurationError(error)
    }
}

export async function publishVisualThemeDraft(slug: string, theme?: OnboardingThemeDefinition) {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        if (!theme) return { ok: false as const, error: "The current Style draft is required." }
        const normalized = normalizeThemeDraft(theme)
        if (!normalized.ok) return normalized
        const { data: document } = await supabaseAdmin.from("onboarding_builder_documents").select("version").eq("workspace_id", workspace.id).maybeSingle()
        const releaseId = randomUUID()
        const outcome = await configurationRpc("publish_visual_onboarding_release", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_expected_document_version: Number(document?.version ?? 0),
            p_modules: [],
            p_bookends: [],
            p_theme: normalized.definition,
            p_apply_to_active: false,
            p_explanation: "",
            p_release_id: releaseId,
            p_idempotency_key: `onboarding.style.published:${releaseId}`,
        })
        if (outcome.ok) {
            revalidatePath(`/${slug}/settings`)
            revalidatePath(`/${slug}/onboarding-builder`)
        }
        return outcome
    } catch (error) {
        return unexpectedConfigurationError(error)
    }
}
