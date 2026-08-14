"use server"

import { createHash, randomBytes, randomUUID } from "crypto"
import { revalidatePath } from "next/cache"
import type { OnboardingBookendDefinitionV2, OnboardingModuleDefinitionV2, OnboardingPaymentDefinitionV2 } from "@/lib/onboarding/block-definition"
import { normalizeThemeDraft, normalizeVisualBookend, normalizeVisualModule, normalizeVisualPaymentGate } from "@/lib/onboarding/block-validation"
import type { ConfigurationActionResult, OnboardingThemeDefinition } from "@/lib/onboarding/configuration-types"
import { recordAdminActivity } from "@/lib/admin/activity"
import { platformFailureFingerprint, reportPlatformFailure } from "@/lib/admin/maintenance"
import { configurationRpc, unexpectedConfigurationError } from "@/lib/onboarding/configuration-actions"
import { processWorkspaceOnboardingOutbox } from "@/lib/onboarding/outbox"
import { createSignedBuilderMediaUpload } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

function visualVideoPaths(module: { steps: OnboardingModuleDefinitionV2["steps"] }) {
    return module.steps.flatMap((step) => step.blocks.flatMap((block) => block.kind === "video" && block.upload ? [block.upload.path] : []))
}

function pathsBelongToDraft(paths: string[], workspaceId: string, entityId: string, revisionId: string | null) {
    if (!revisionId) return paths.length === 0
    const prefix = `${workspaceId}/onboarding-builder/${entityId}/${revisionId}/`
    return paths.every((path) => path.startsWith(prefix) && !path.includes("\\") && !path.split("/").some((part) => part === "." || part === ".."))
}

async function rejectVisualRelease(input: {
    workspaceId: string
    workspaceSlug: string
    actorUserId: string
    error: string
}) {
    await recordAdminActivity({
        workspaceId: input.workspaceId,
        category: "onboarding",
        level: "warning",
        eventKey: "onboarding.release.rejected",
        summary: "Onboarding release rejected before publishing",
        sourceHref: `/${input.workspaceSlug}/onboarding-builder`,
        actorUserId: input.actorUserId,
        actorKind: "staff",
        outcome: "rejected",
        metricClassification: "audit",
        metadata: { reason: input.error.slice(0, 400) },
    })
    return { ok: false as const, error: input.error }
}

export async function publishVisualOnboardingRelease(slug: string, input: {
    modules: OnboardingModuleDefinitionV2[]
    bookends: OnboardingBookendDefinitionV2[]
    theme: OnboardingThemeDefinition | null
    payment: OnboardingPaymentDefinitionV2 | null
    expectedDocumentVersion: number
    applyToActive: boolean
    explanation: string
}): Promise<ConfigurationActionResult<{ release_id: string; results: unknown[] }>> {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        const normalizedModules = input.modules.map((module) => normalizeVisualModule(module))
        const moduleError = normalizedModules.find((result) => !result.ok)
        if (moduleError && !moduleError.ok) return rejectVisualRelease({ workspaceId: workspace.id, workspaceSlug: slug, actorUserId: user.id, error: moduleError.error })
        const normalizedBookends = input.bookends.map((bookend) => normalizeVisualBookend(bookend))
        const bookendError = normalizedBookends.find((result) => !result.ok)
        if (bookendError && !bookendError.ok) return rejectVisualRelease({ workspaceId: workspace.id, workspaceSlug: slug, actorUserId: user.id, error: bookendError.error })
        const normalizedPayment = input.payment ? normalizeVisualPaymentGate(input.payment) : null
        if (normalizedPayment && !normalizedPayment.ok) return rejectVisualRelease({ workspaceId: workspace.id, workspaceSlug: slug, actorUserId: user.id, error: normalizedPayment.error })

        for (const result of normalizedModules) {
            if (!result.ok) continue
            if (!pathsBelongToDraft(visualVideoPaths(result.definition), workspace.id, result.definition.id, result.definition.revisionId)) {
                return rejectVisualRelease({ workspaceId: workspace.id, workspaceSlug: slug, actorUserId: user.id, error: `The video in “${result.definition.name}” belongs to an older draft. Open that Video block, upload the video again, then publish.` })
            }
        }
        for (const result of normalizedBookends) {
            if (!result.ok) continue
            const paths = result.definition.steps.flatMap((step) => step.blocks.flatMap((block) => block.kind === "video" && block.upload ? [block.upload.path] : []))
            if (!pathsBelongToDraft(paths, workspace.id, `bookend-${result.definition.kind}`, result.definition.revisionId)) {
                const definitionName = result.definition.kind === "welcome" ? "Welcome" : "Completion"
                return rejectVisualRelease({ workspaceId: workspace.id, workspaceSlug: slug, actorUserId: user.id, error: `The video in “${definitionName}” belongs to an older draft. Open that Video block, upload the video again, then publish.` })
            }
        }
        if (normalizedPayment?.ok) {
            const paths = visualVideoPaths(normalizedPayment.definition)
            if (!pathsBelongToDraft(paths, workspace.id, "payment-gate", normalizedPayment.definition.id)) {
                return rejectVisualRelease({ workspaceId: workspace.id, workspaceSlug: slug, actorUserId: user.id, error: "The video in Payment belongs to an older draft. Open that Video block, upload it again, then publish." })
            }
        }
        let normalizedTheme: ReturnType<typeof normalizeThemeDraft> | null = null
        if (input.theme) {
            normalizedTheme = normalizeThemeDraft(input.theme)
            if (!normalizedTheme.ok) return rejectVisualRelease({ workspaceId: workspace.id, workspaceSlug: slug, actorUserId: user.id, error: normalizedTheme.error })
        }

        const releaseId = randomUUID()
        const outcome = await configurationRpc<{ release_id: string; results: unknown[] }>("publish_visual_onboarding_release_v3", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_expected_document_version: input.expectedDocumentVersion,
            p_modules: normalizedModules.flatMap((result) => result.ok ? [{ id: result.definition.id, definition: result.persistedDefinition }] : []),
            p_bookends: normalizedBookends.flatMap((result) => result.ok ? [{ kind: result.definition.kind, definition: result.persistedDefinition }] : []),
            p_theme: normalizedTheme?.ok ? normalizedTheme.definition : null,
            p_payment_gate: normalizedPayment?.ok ? normalizedPayment.persistedDefinition : null,
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
    | { kind: "bookend"; definition: OnboardingBookendDefinitionV2 | OnboardingPaymentDefinitionV2 }
    | { kind: "payment"; definition: OnboardingPaymentDefinitionV2 }
), file: { name: string; size: number; type: string }): Promise<ConfigurationActionResult<{
    uploadUrl: string
    previewUrl: string
    storedVideo: { name: string; path: string; size: number; type: string; provider: "r2" }
    draftRevisionId: string
}>> {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    try {
        let entityId: string
        let draftRevisionId: string
        if (target.kind === "module") {
            const normalized = normalizeVisualModule(target.definition, { allowPendingVideo: true })
            if (!normalized.ok) return rejectVisualRelease({ workspaceId: workspace.id, workspaceSlug: slug, actorUserId: user.id, error: normalized.error })
            const saved = await configurationRpc<{ draft_revision_id: string }>("save_onboarding_module_draft", {
                p_workspace_id: workspace.id,
                p_actor_user_id: user.id,
                p_module_id: normalized.definition.id,
                p_definition: normalized.persistedDefinition,
            })
            if (!saved.ok) return saved
            if (!saved.data?.draft_revision_id) return { ok: false, error: "Betelgeze could not prepare this module draft for upload. The failure was recorded for an administrator." }
            entityId = normalized.definition.id
            draftRevisionId = saved.data.draft_revision_id
        } else if (target.kind === "payment" || !("kind" in target.definition)) {
            const normalized = normalizeVisualPaymentGate(target.definition as OnboardingPaymentDefinitionV2, { allowPendingVideo: true })
            if (!normalized.ok) return rejectVisualRelease({ workspaceId: workspace.id, workspaceSlug: slug, actorUserId: user.id, error: normalized.error })
            entityId = "payment-gate"
            draftRevisionId = normalized.definition.id
        } else {
            const normalized = normalizeVisualBookend(target.definition, { allowPendingVideo: true })
            if (!normalized.ok) return rejectVisualRelease({ workspaceId: workspace.id, workspaceSlug: slug, actorUserId: user.id, error: normalized.error })
            const saved = await configurationRpc<{ bookend_revision_id: string }>("save_onboarding_bookend_draft", {
                p_workspace_id: workspace.id,
                p_actor_user_id: user.id,
                p_kind: normalized.definition.kind,
                p_definition: normalized.persistedDefinition,
            })
            if (!saved.ok) return saved
            if (!saved.data?.bookend_revision_id) return { ok: false, error: "Betelgeze could not prepare this page draft for upload. The failure was recorded for an administrator." }
            entityId = `bookend-${normalized.definition.kind}`
            draftRevisionId = saved.data.bookend_revision_id
        }
        return { ok: true, data: { ...(await createSignedBuilderMediaUpload(workspace.id, entityId, draftRevisionId, file)), draftRevisionId } }
    } catch (error) {
        const message = error instanceof Error ? error.message : "Video upload preparation failed"
        const expected = message.startsWith("Builder video uploads") || message.includes("500MB upload limit")
        if (!expected) {
            await reportPlatformFailure({
                workspaceId: workspace.id,
                category: "onboarding",
                source: "onboarding_builder",
                operation: "prepare_video_upload",
                fingerprint: platformFailureFingerprint(["onboarding-builder", "video-upload", error instanceof Error ? error.name : "unknown"]),
                severity: "warning",
                summary: "The Builder could not prepare a video upload",
                diagnostics: { error_type: error instanceof Error ? error.name : typeof error },
                sourceHref: `/${slug}/onboarding-builder`,
                actorUserId: user.id,
            })
        }
        return { ok: false, error: expected ? message : "Betelgeze could not prepare the video upload. The failure was added to Admin Activity for investigation." }
    }
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
