import { randomBytes } from "crypto"
import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { SERVICES, getModuleKeysForServices } from "@/lib/onboarding/services"
import { FormResponse, OnboardingFormDefinition, StoredUpload } from "@/lib/onboarding/forms"
import type { OnboardingHelpSettings, OnboardingThemeDefinition } from "@/lib/onboarding/configuration-types"
import type { OnboardingBlock } from "@/lib/onboarding/block-definition"
import { legacyPublishedOnboardingConfiguration, loadPublishedOnboardingConfiguration } from "@/lib/onboarding/configuration"
import { getOnboardingRuntimeMode } from "@/lib/onboarding/runtime-mode"
import {
    composeOnboardingSession,
    formDefinitionFromSnapshot,
    loadNormalizedSessionSnapshot,
    type ComposedOnboardingSession,
    type SessionSnapshotStep,
} from "@/lib/onboarding/session-snapshot"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { assetHref, onboardingDetailHref, relationshipHubHref, workItemHref } from "@/lib/relationships"
import { completeWorkflowParents, createOnboardingReviewWork, ensureRelationshipStage } from "@/lib/relationship-workflow"
import { platformFailureFingerprint, reportPlatformFailure } from "@/lib/admin/maintenance"
import { recordAdminActivity } from "@/lib/admin/activity"
import {
    classifyUploadAsset,
    FINAL_ONBOARDING_STEP,
    getOnboardingStepsForModules,
    onboardingSnapshotStepNativeKey,
    onboardingSnapshotSubmissionNativeKey,
    onboardingSnapshotUploadNativeKey,
    onboardingStepNativeKey,
    onboardingSubmissionNativeKey,
    onboardingUploadNativeKey,
    type CanonicalSessionStep,
} from "@/lib/onboarding/canonical-helpers"

export type OnboardingSessionStatus = "active" | "completed" | "archived"

export type CanonicalOnboardingSession = {
    id: string
    workspace_id: string
    relationship_id: string
    session_token: string
    status: OnboardingSessionStatus
    is_test: boolean
    project_timeframe_days: number | null
    legacy_client_id: string | null
    created_by: string | null
    archived_at: string | null
    completed_at: string | null
    created_at: string
    updated_at: string
    source_sale_id?: string | null
    configuration_revision_id?: string | null
    welcome_revision_id?: string | null
    completion_revision_id?: string | null
    snapshot_schema_version?: number | null
    composition_hash?: string | null
    composition_snapshot?: Record<string, unknown> | null
    token_version?: number | null
    token_revoked_at?: string | null
}

export type SessionStep = CanonicalSessionStep & {
    sessionStepId?: string | null
    sessionModuleId?: string | null
    sourceStepId?: string | null
    legacyStepKey?: string | null
    form?: OnboardingFormDefinition | null
    videoPath?: string | null
    workItemId?: string | null
    status?: "todo" | "doing" | "waiting" | "blocked" | "done" | "canceled"
    updatedAt?: string | null
    blocks?: Array<OnboardingBlock & { sessionBlockId?: string; sourceBlockId?: string }>
    navigation?: { backLabel: string; continueLabel: string }
    bookendKind?: "welcome" | "completion" | null
}

export type OnboardingSessionNotice = {
    id: string
    kind: "module" | "release"
    sessionModuleId: string | null
    affectedStepIds: string[]
    sections: string[]
    explanation: string
    requiresCompletion: boolean
    firstSeenAt: string | null
    moduleCompletedAt: string | null
}

export type PublicOnboardingSession = {
    session: CanonicalOnboardingSession
    workspace: { id: string; name: string; slug: string }
    relationship: {
        id: string
        primary_person_name: string
        primary_email: string | null
        primary_phone: string | null
        business_name: string | null
    }
    moduleKeys: string[]
    moduleTitles: string[]
    steps: SessionStep[]
    completableSteps: SessionStep[]
    completedKeys: Set<string>
    theme: OnboardingThemeDefinition
    help: OnboardingHelpSettings
    usesSnapshot: boolean
    notices: OnboardingSessionNotice[]
    satisfiedBlockIds: Set<string>
}

type CanonicalStepWorkItem = {
    id: string
    status: SessionStep["status"]
    actual_start_at: string | null
    parent_work_item_id: string | null
}

type QueryError = { message?: string; code?: string } | null | undefined

export const ONBOARDING_SESSION_UPDATED_MESSAGE = "Your onboarding session was updated. Reload this page to continue."

function isMissingCanonicalOnboarding(error: QueryError) {
    const message = error?.message?.toLowerCase() ?? ""
    return (
        error?.code === "42P01" ||
        error?.code === "42703" ||
        ["relationship_onboarding_sessions", "relationship_onboarding_modules", "relationship_services", "native_key"].some((part) =>
            message.includes(part) && (
                message.includes("does not exist") ||
                message.includes("schema cache") ||
                message.includes("could not find")
            )
        )
    )
}

function isMissingOnboardingMutationRpc(error: QueryError, functionName: string) {
    const message = error?.message?.toLowerCase() ?? ""
    return error?.code === "42883" || error?.code === "PGRST202" || (
        message.includes(functionName.toLowerCase()) && (
            message.includes("schema cache") || message.includes("does not exist") || message.includes("could not find")
        )
    )
}

function publicOnboardingMutationMessage(error: QueryError, fallback: string) {
    const message = error?.message?.trim()
    return message && (error?.code === "P0001" || error?.code === "22023") && message.length <= 300
        ? message
        : fallback
}

const LEGACY_SESSION_COLUMNS = "id, workspace_id, relationship_id, session_token, status, is_test, project_timeframe_days, legacy_client_id, created_by, archived_at, completed_at, created_at, updated_at"
const SNAPSHOT_SESSION_COLUMNS = `${LEGACY_SESSION_COLUMNS}, source_sale_id, configuration_revision_id, welcome_revision_id, completion_revision_id, snapshot_schema_version, composition_hash, composition_snapshot, token_version, token_revoked_at`

async function loadSessionByToken(token: string) {
    const snapshotResult = await supabaseAdmin
        .from("relationship_onboarding_sessions")
        .select(SNAPSHOT_SESSION_COLUMNS)
        .eq("session_token", token)
        .in("status", ["active", "completed"])
        .maybeSingle()
    if (!snapshotResult.error) {
        const session = snapshotResult.data as CanonicalOnboardingSession | null
        return session?.token_revoked_at ? null : session
    }
    if (!isMissingCanonicalOnboarding(snapshotResult.error)) return null
    const legacyResult = await supabaseAdmin
        .from("relationship_onboarding_sessions")
        .select(LEGACY_SESSION_COLUMNS)
        .eq("session_token", token)
        .in("status", ["active", "completed"])
        .maybeSingle()
    return legacyResult.error ? null : legacyResult.data as CanonicalOnboardingSession | null
}

function snapshotStepToSessionStep(step: SessionSnapshotStep, completionIsActionable = false): SessionStep {
    return {
        key: step.id,
        sessionStepId: step.id,
        sessionModuleId: step.sessionModuleId,
        sourceStepId: step.sourceStepId,
        legacyStepKey: step.legacyStepKey,
        title: step.title,
        description: step.description,
        moduleTitle: step.moduleTitle,
        estimatedTime: step.estimatedTime,
        why: step.why,
        kind: step.kind === "completion" && !completionIsActionable ? "final" : step.kind === "form" ? "form" : "video",
        formKey: step.legacyFormKey ?? (step.kind === "form" ? step.id : undefined),
        form: formDefinitionFromSnapshot(step),
        videoUrl: step.videoUrl,
        videoPath: step.videoPath,
        blocks: step.blocks,
        navigation: step.navigation,
        bookendKind: step.bookendKind,
    }
}

function stepIdentifier(step: Pick<SessionStep, "key" | "sessionStepId">) {
    return step.sessionStepId ?? step.key
}

function stepNativeKey(sessionId: string, step: Pick<SessionStep, "key" | "sessionStepId">) {
    return step.sessionStepId
        ? onboardingSnapshotStepNativeKey(sessionId, step.sessionStepId)
        : onboardingStepNativeKey(sessionId, step.key)
}

function submissionNativeKey(sessionId: string, step: Pick<SessionStep, "key" | "sessionStepId">) {
    return step.sessionStepId
        ? onboardingSnapshotSubmissionNativeKey(sessionId, step.sessionStepId)
        : onboardingSubmissionNativeKey(sessionId, step.key)
}

function uploadNativeKey(sessionId: string, step: Pick<SessionStep, "key" | "sessionStepId">, storagePath: string) {
    return step.sessionStepId
        ? onboardingSnapshotUploadNativeKey(sessionId, step.sessionStepId, storagePath)
        : onboardingUploadNativeKey(sessionId, step.key, storagePath)
}

function extractUploadsFromResponse(response: FormResponse) {
    const uploads: Array<StoredUpload & { fieldName: string }> = []
    for (const [fieldName, value] of Object.entries(response)) {
        if (!Array.isArray(value)) continue
        for (const item of value) {
            if (item && typeof item === "object" && "path" in item) {
                uploads.push({ ...(item as StoredUpload), fieldName })
            }
        }
    }
    return uploads
}

function validateFormResponse(form: OnboardingFormDefinition, response: FormResponse) {
    const allowedFields = new Set(form.fields.map((field) => field.name))
    if (Object.keys(response).some((key) => !allowedFields.has(key))) {
        throw new Error("This form changed while you were completing it. Reload and try again.")
    }
    for (const field of form.fields) {
        const value = response[field.name]
        if (field.type === "file") {
            const uploads = Array.isArray(value) ? value : []
            if (field.required && uploads.length === 0) throw new Error(`${field.label} is required.`)
            if (!field.multiple && uploads.length > 1) throw new Error(`${field.label} accepts one file.`)
            if (uploads.some((upload) => !upload || typeof upload !== "object" || typeof upload.path !== "string" || typeof upload.name !== "string")) {
                throw new Error(`${field.label} contains an invalid upload.`)
            }
            continue
        }
        const textValue = typeof value === "string" ? value.trim() : ""
        if (field.required && !textValue) throw new Error(`${field.label} is required.`)
        if (!textValue) continue
        try {
            if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(textValue)) throw new Error()
            if (field.type === "url") new URL(textValue)
        } catch {
            throw new Error(`${field.label} is not valid.`)
        }
    }
}

async function reportOnboardingFailure(input: {
    workspaceId: string
    workspaceSlug: string
    relationshipId: string
    operation: string
    error: unknown
    diagnostics?: Record<string, unknown>
}) {
    const message = input.error instanceof Error ? input.error.message : String(input.error)
    await reportPlatformFailure({
        workspaceId: input.workspaceId,
        category: "onboarding",
        source: "canonical_onboarding",
        operation: input.operation,
        fingerprint: platformFailureFingerprint(["onboarding", input.operation, message]),
        severity: "warning",
        summary: "Onboarding automation could not generate required work",
        diagnostics: { relationship_id: input.relationshipId, error: message, ...input.diagnostics },
        sourceHref: onboardingDetailHref(input.workspaceSlug, input.relationshipId),
    })
}

async function getWorkspaceSlugHeader() {
    return (await headers()).get("x-betelgeze-workspace-slug")
}

export async function getCanonicalSessionByToken(token: string): Promise<PublicOnboardingSession | null> {
    const workspaceSlug = await getWorkspaceSlugHeader()
    const session = await loadSessionByToken(token)
    if (!session) return null

    const workspaceQuery = supabaseAdmin
        .from("workspaces")
        .select("id, name, slug")
        .eq("id", session.workspace_id)
        .eq("status", "active")

    const [{ data: workspace }, { data: relationship }, { data: modules }, { data: workItems }, publishedConfiguration, normalizedSnapshot, noticeResult, releaseNoticeResult] = await Promise.all([
        workspaceSlug ? workspaceQuery.eq("slug", workspaceSlug).maybeSingle() : workspaceQuery.maybeSingle(),
        supabaseAdmin
            .from("relationships")
            .select("id, primary_person_name, primary_email, primary_phone, business_name")
            .eq("workspace_id", session.workspace_id)
            .eq("id", session.relationship_id)
            .maybeSingle(),
        supabaseAdmin
            .from("relationship_onboarding_modules")
            .select("module_key")
            .eq("workspace_id", session.workspace_id)
            .eq("relationship_id", session.relationship_id)
            .order("created_at", { ascending: true }),
        supabaseAdmin
            .from("work_items")
            .select("id, status, actual_start_at, actual_completed_at, updated_at, parent_work_item_id, metadata")
            .eq("workspace_id", session.workspace_id)
            .eq("native_kind", "onboarding_step")
            .like("native_key", `${session.id}:%`),
        loadPublishedOnboardingConfiguration(session.workspace_id),
        loadNormalizedSessionSnapshot(session),
        session.snapshot_schema_version
            ? supabaseAdmin
                .from("onboarding_session_notices")
                .select("id, session_module_id, explanation, requires_completion, first_seen_at, module_completed_at, consolidated_release_id")
                .eq("workspace_id", session.workspace_id)
                .eq("session_id", session.id)
                .order("created_at", { ascending: false })
            : Promise.resolve({ data: [], error: null }),
        session.snapshot_schema_version
            ? supabaseAdmin
                .from("onboarding_release_notices")
                .select("id, explanation, affected_sections, affected_session_step_ids, requires_completion, first_seen_at, completed_at")
                .eq("workspace_id", session.workspace_id)
                .eq("session_id", session.id)
                .order("created_at", { ascending: false })
            : Promise.resolve({ data: [], error: null }),
    ])

    if (!workspace || !relationship) return null

    type ModuleNoticeRow = {
        id: unknown
        session_module_id: unknown
        explanation: unknown
        requires_completion: unknown
        first_seen_at: unknown
        module_completed_at: unknown
        consolidated_release_id?: unknown
    }
    let effectiveModuleNotices: ModuleNoticeRow[] = noticeResult.error ? [] : noticeResult.data ?? []
    if (noticeResult.error && isMissingCanonicalOnboarding(noticeResult.error)) {
        const legacyNoticeResult = await supabaseAdmin
            .from("onboarding_session_notices")
            .select("id, session_module_id, explanation, requires_completion, first_seen_at, module_completed_at")
            .eq("workspace_id", session.workspace_id)
            .eq("session_id", session.id)
            .order("created_at", { ascending: false })
        effectiveModuleNotices = legacyNoticeResult.error ? [] : legacyNoticeResult.data ?? []
    }

    const moduleKeys = (modules ?? []).map((row) => row.module_key).filter((key): key is string => Boolean(key))
    const isVisualSnapshot = Number(normalizedSnapshot?.schemaVersion ?? session.snapshot_schema_version ?? 1) >= 2
    const canonicalSteps: SessionStep[] = normalizedSnapshot
        ? normalizedSnapshot.actionableSteps.map((step) => snapshotStepToSessionStep(step, isVisualSnapshot))
        : getOnboardingStepsForModules(moduleKeys)
    const completionStep: SessionStep | null = normalizedSnapshot?.completionStep
        ? snapshotStepToSessionStep(normalizedSnapshot.completionStep)
        : isVisualSnapshot ? null : FINAL_ONBOARDING_STEP
    let canonicalWorkItems = workItems ?? []

    if (session.status === "active") {
        try {
            const repaired = await reconcileCanonicalStepWindow({
                session,
                workspaceSlug: workspace.slug,
                steps: canonicalSteps,
                workItems: canonicalWorkItems,
            })
            if (repaired) {
                const { data: refreshedWorkItems } = await supabaseAdmin
                    .from("work_items")
                    .select("id, status, actual_start_at, actual_completed_at, updated_at, parent_work_item_id, metadata")
                    .eq("workspace_id", session.workspace_id)
                    .eq("native_kind", "onboarding_step")
                    .like("native_key", `${session.id}:%`)
                canonicalWorkItems = refreshedWorkItems ?? canonicalWorkItems
            }
        } catch (error) {
            // An existing session must remain usable even if a legacy data repair
            // cannot run on this request. The next write retries the same repair.
            await reportOnboardingFailure({
                workspaceId: session.workspace_id,
                workspaceSlug: workspace.slug,
                relationshipId: session.relationship_id,
                operation: "reconcile_step_window",
                error,
                diagnostics: { session_id: session.id },
            })
        }
    }

    const workItemByStepKey = new Map<string, { id: string; status: SessionStep["status"]; updated_at: string | null }>()
    for (const item of canonicalWorkItems) {
        const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata as Record<string, unknown> : {}
        const stepKey = typeof metadata.session_step_id === "string"
            ? metadata.session_step_id
            : typeof metadata.step_key === "string" ? metadata.step_key : null
        if (stepKey) workItemByStepKey.set(stepKey, { id: item.id, status: item.status as SessionStep["status"], updated_at: item.updated_at ?? null })
    }

    const completableSteps = canonicalSteps.map((step) => {
        const item = workItemByStepKey.get(stepIdentifier(step))
        return { ...step, workItemId: item?.id ?? null, status: item?.status ?? "todo", updatedAt: item?.updated_at ?? null }
    })
    const completedKeys = new Set(completableSteps.filter((step) => step.status === "done").map((step) => step.key))

    const requirementResult = isVisualSnapshot
        ? await supabaseAdmin.from("onboarding_block_requirements").select("session_block_id").eq("workspace_id", session.workspace_id).eq("session_id", session.id)
        : { data: [], error: null }

    return {
        session,
        workspace,
        relationship,
        moduleKeys,
        moduleTitles: normalizedSnapshot
            ? normalizedSnapshot.modules.map((snapshotModule) => snapshotModule.title)
            : moduleKeys.flatMap((key) => {
                const moduleDefinition = publishedConfiguration.modules.find((candidate) => candidate.code === key)
                return moduleDefinition ? [moduleDefinition.name] : []
            }),
        completableSteps,
        completedKeys,
        steps: completionStep ? [...completableSteps, completionStep] : completableSteps,
        theme: publishedConfiguration.theme,
        help: publishedConfiguration.help,
        usesSnapshot: Boolean(normalizedSnapshot),
        notices: [
            ...(releaseNoticeResult.error ? [] : (releaseNoticeResult.data ?? []).map((notice) => ({
                id: String(notice.id),
                kind: "release" as const,
                sessionModuleId: null,
                affectedStepIds: Array.isArray(notice.affected_session_step_ids) ? notice.affected_session_step_ids.map(String) : [],
                sections: Array.isArray(notice.affected_sections) ? notice.affected_sections.map(String) : [],
                explanation: String(notice.explanation ?? "Parts of this onboarding were updated. Please review them again."),
                requiresCompletion: Boolean(notice.requires_completion),
                firstSeenAt: typeof notice.first_seen_at === "string" ? notice.first_seen_at : null,
                moduleCompletedAt: typeof notice.completed_at === "string" ? notice.completed_at : null,
            }))),
            ...effectiveModuleNotices.filter((notice) => !notice.consolidated_release_id).map((notice) => ({
                id: String(notice.id),
                kind: "module" as const,
                sessionModuleId: String(notice.session_module_id),
                affectedStepIds: [],
                sections: [],
                explanation: String(notice.explanation ?? "This module was updated. Please review it again."),
                requiresCompletion: Boolean(notice.requires_completion),
                firstSeenAt: typeof notice.first_seen_at === "string" ? notice.first_seen_at : null,
                moduleCompletedAt: typeof notice.module_completed_at === "string" ? notice.module_completed_at : null,
            })),
        ],
        satisfiedBlockIds: new Set((requirementResult.data ?? []).map((row) => String(row.session_block_id))),
    }
}

export async function getFormResponseAsset(sessionId: string, step: Pick<SessionStep, "key" | "sessionStepId">): Promise<FormResponse | undefined> {
    const { data } = await supabaseAdmin
        .from("assets")
        .select("metadata")
        .eq("native_kind", "onboarding_form_submission")
        .eq("native_key", submissionNativeKey(sessionId, step))
        .maybeSingle()
    const metadata = data?.metadata && typeof data.metadata === "object" ? data.metadata as Record<string, unknown> : {}
    const response = metadata.response
    if (!response || typeof response !== "object" || Array.isArray(response)) return undefined
    if (!step.sessionStepId) return response as FormResponse
    const { data: fields, error } = await supabaseAdmin
        .from("relationship_onboarding_session_fields")
        .select("id, legacy_field_name")
        .eq("session_step_id", step.sessionStepId)
    if (error || !fields?.length) return response as FormResponse
    const remapped = { ...(response as FormResponse) }
    for (const field of fields) {
        const stableId = String(field.id)
        const legacyName = typeof field.legacy_field_name === "string" ? field.legacy_field_name : null
        if (stableId in remapped || !legacyName || !(legacyName in remapped)) continue
        remapped[stableId] = remapped[legacyName]
        if (legacyName !== stableId) delete remapped[legacyName]
    }
    return remapped
}

async function findStepWorkItem(workspaceId: string, sessionId: string, step: Pick<SessionStep, "key" | "sessionStepId">) {
    const { data } = await supabaseAdmin
        .from("work_items")
        .select("id, status, actual_start_at, parent_work_item_id")
        .eq("workspace_id", workspaceId)
        .eq("native_kind", "onboarding_step")
        .eq("native_key", stepNativeKey(sessionId, step))
        .maybeSingle()
    return data
}

async function createCanonicalStepWorkItem(input: {
    session: Pick<CanonicalOnboardingSession, "id" | "workspace_id" | "relationship_id">
    workspaceSlug: string
    parentWorkItemId: string
    step: SessionStep
    index: number
    predecessorId?: string | null
    startAt?: string | null
}) {
    const existing = await findStepWorkItem(input.session.workspace_id, input.session.id, input.step)
    let workItemId = existing?.id

    if (!workItemId) {
        const { data: item, error } = await supabaseAdmin
            .from("work_items")
            .insert({
                workspace_id: input.session.workspace_id,
                title: input.step.title,
                description: input.step.description,
                lifecycle_phase: "onboarding",
                status: "todo",
                priority: 3,
                is_key_task: true,
                native_kind: "onboarding_step",
                native_key: stepNativeKey(input.session.id, input.step),
                native_href: onboardingDetailHref(input.workspaceSlug, input.session.relationship_id),
                parent_work_item_id: input.parentWorkItemId,
                workflow_role: "task",
                // These are rolling, actual-time workflow steps. Giving a future
                // step an invented planned date lets the legacy schedule guard
                // reject it once its open parent spans more than one day.
                planned_start_date: null,
                actual_start_at: input.startAt ?? null,
                actual_start_has_time: Boolean(input.startAt),
                sort_order: input.index * 10,
                metadata: {
                    session_id: input.session.id,
                    relationship_id: input.session.relationship_id,
                    session_step_id: input.step.sessionStepId ?? null,
                    source_step_id: input.step.sourceStepId ?? null,
                    step_key: input.step.key,
                    legacy_step_key: input.step.legacyStepKey ?? input.step.key,
                    module_title: input.step.moduleTitle,
                    kind: input.step.kind,
                    form_key: input.step.formKey ?? null,
                    auto_created: true,
                },
            })
            .select("id")
            .single()

        if (error?.code === "23505") {
            // A duplicate submit may have won the insert race. Continue through
            // the relationship/dependency repair below using that item instead.
            workItemId = (await findStepWorkItem(input.session.workspace_id, input.session.id, input.step))?.id
        } else if (error || !item) {
            await reportOnboardingFailure({
                workspaceId: input.session.workspace_id,
                workspaceSlug: input.workspaceSlug,
                relationshipId: input.session.relationship_id,
                operation: "create_step_work_item",
                error: error?.message ?? "No work item was returned",
                diagnostics: { session_id: input.session.id, step_key: input.step.key, code: error?.code },
            })
            throw new Error("Could not create the next onboarding step")
        } else {
            workItemId = item.id
        }
    }

    if (!workItemId) {
        await reportOnboardingFailure({ workspaceId: input.session.workspace_id, workspaceSlug: input.workspaceSlug, relationshipId: input.session.relationship_id, operation: "resolve_step_work_item", error: "Could not resolve the created work item", diagnostics: { session_id: input.session.id, step_key: input.step.key } })
        throw new Error("Could not create the next onboarding step")
    }

    const { error: linkError } = await supabaseAdmin.from("work_item_relationships").upsert({
        workspace_id: input.session.workspace_id,
        work_item_id: workItemId,
        relationship_id: input.session.relationship_id,
    }, { onConflict: "work_item_id,relationship_id" })
    if (linkError) {
        await reportOnboardingFailure({ workspaceId: input.session.workspace_id, workspaceSlug: input.workspaceSlug, relationshipId: input.session.relationship_id, operation: "link_step_relationship", error: linkError, diagnostics: { session_id: input.session.id, step_key: input.step.key, work_item_id: workItemId } })
        throw new Error("link-onboarding-work-failed")
    }

    if (input.predecessorId) {
        const { error: dependencyError } = await supabaseAdmin.from("work_item_dependencies").upsert({
            workspace_id: input.session.workspace_id,
            work_item_id: workItemId,
            depends_on_work_item_id: input.predecessorId,
            source: "manual",
        }, { onConflict: "work_item_id,depends_on_work_item_id" })
        if (dependencyError) {
            await reportOnboardingFailure({ workspaceId: input.session.workspace_id, workspaceSlug: input.workspaceSlug, relationshipId: input.session.relationship_id, operation: "link_step_dependency", error: dependencyError, diagnostics: { session_id: input.session.id, step_key: input.step.key, work_item_id: workItemId } })
            throw new Error("link-onboarding-step-failed")
        }
    }
    return workItemId
}

type CanonicalStepWindowItem = {
    id: string
    status: SessionStep["status"]
    actual_start_at: string | null
    actual_completed_at: string | null
    updated_at: string | null
    parent_work_item_id: string | null
    metadata: unknown
}

function canonicalStepKey(item: Pick<CanonicalStepWindowItem, "metadata">) {
    const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata as Record<string, unknown> : {}
    return typeof metadata.session_step_id === "string"
        ? metadata.session_step_id
        : typeof metadata.step_key === "string" ? metadata.step_key : null
}

async function reconcileCanonicalStepWindow(input: {
    session: CanonicalOnboardingSession
    workspaceSlug: string
    steps: SessionStep[]
    workItems: CanonicalStepWindowItem[]
}) {
    const itemsByStepKey = new Map<string, CanonicalStepWindowItem>()
    for (const item of input.workItems) {
        const stepKey = canonicalStepKey(item)
        if (stepKey) itemsByStepKey.set(stepKey, item)
    }
    const currentIndex = input.steps.findIndex((step) => itemsByStepKey.get(stepIdentifier(step))?.status !== "done")
    if (currentIndex < 0) return false

    const currentStep = input.steps[currentIndex]
    const previousItem = currentIndex > 0 ? itemsByStepKey.get(stepIdentifier(input.steps[currentIndex - 1])) ?? null : null
    const currentItem = itemsByStepKey.get(stepIdentifier(currentStep)) ?? null
    const parentWorkItemId = currentItem?.parent_work_item_id
        ?? previousItem?.parent_work_item_id
        ?? (await ensureRelationshipStage({
            workspaceId: input.session.workspace_id,
            relationshipId: input.session.relationship_id,
            phase: "onboarding",
        }))
    const actualStartAt = previousItem?.actual_completed_at ?? previousItem?.updated_at ?? input.session.created_at
    let currentWorkItemId = currentItem?.id
    let changed = false

    if (!currentWorkItemId) {
        currentWorkItemId = await createCanonicalStepWorkItem({
            session: input.session,
            workspaceSlug: input.workspaceSlug,
            parentWorkItemId,
            step: currentStep,
            index: currentIndex,
            predecessorId: previousItem?.id,
            startAt: actualStartAt,
        })
        changed = true
    } else if (currentItem && !currentItem.actual_start_at) {
        const { error } = await supabaseAdmin.from("work_items").update({
            actual_start_at: actualStartAt,
            actual_start_has_time: true,
        }).eq("workspace_id", input.session.workspace_id).eq("id", currentWorkItemId).is("actual_start_at", null)
        if (error) throw new Error(error.message)
        changed = true
    }

    const nextStep = input.steps[currentIndex + 1]
    if (nextStep) {
        const nextItem = itemsByStepKey.get(stepIdentifier(nextStep))
        if (!nextItem) {
            await createCanonicalStepWorkItem({
                session: input.session,
                workspaceSlug: input.workspaceSlug,
                parentWorkItemId,
                step: nextStep,
                index: currentIndex + 1,
                predecessorId: currentWorkItemId,
            })
            changed = true
        }
    }

    return changed
}

async function linkAsset(assetId: string, workspaceId: string, relationshipId: string, workItemId: string) {
    await Promise.all([
        supabaseAdmin.from("asset_relationships").upsert({
            asset_id: assetId,
            relationship_id: relationshipId,
            workspace_id: workspaceId,
        }, { onConflict: "asset_id,relationship_id" }),
        supabaseAdmin.from("asset_work_items").upsert({
            asset_id: assetId,
            work_item_id: workItemId,
            workspace_id: workspaceId,
        }, { onConflict: "asset_id,work_item_id" }),
    ])
}

async function saveSubmissionAsset({
    session,
    step,
    form,
    response,
    workItemId,
}: {
    session: CanonicalOnboardingSession
    step: SessionStep
    form: OnboardingFormDefinition
    response: FormResponse
    workItemId: string
}) {
    const now = new Date().toISOString()
    const nativeKey = submissionNativeKey(session.id, step)
    const { data: asset, error } = await supabaseAdmin
        .from("assets")
        .upsert({
            workspace_id: session.workspace_id,
            title: `${form.title} submission`,
            description: "Onboarding form submission.",
            asset_kind: "form_submission",
            source_kind: "onboarding_submission",
            native_kind: "onboarding_form_submission",
            native_key: nativeKey,
            metadata: {
                session_id: session.id,
                relationship_id: session.relationship_id,
                session_step_id: step.sessionStepId ?? null,
                source_step_id: step.sourceStepId ?? null,
                step_key: step.key,
                legacy_step_key: step.legacyStepKey ?? step.key,
                form_key: form.key,
                response,
            },
            updated_at: now,
        }, { onConflict: "workspace_id,native_kind,native_key" })
        .select("id")
        .single()
    if (error || !asset) throw new Error("Could not save form response")
    await linkAsset(asset.id, session.workspace_id, session.relationship_id, workItemId)
}

async function saveUploadAssets({
    session,
    step,
    response,
    workItemId,
}: {
    session: CanonicalOnboardingSession
    step: SessionStep
    response: FormResponse
    workItemId: string
}) {
    const uploads = extractUploadsFromResponse(response)
    const activeNativeKeys = new Set(uploads.map((upload) => uploadNativeKey(session.id, step, upload.path)))

    const { data: existingAssets } = await supabaseAdmin
        .from("assets")
        .select("id, native_key")
        .eq("workspace_id", session.workspace_id)
        .eq("native_kind", "onboarding_upload")
        .like("native_key", step.sessionStepId
            ? `${session.id}:step:${step.sessionStepId}:upload:%`
            : `${session.id}:${step.key}:upload:%`)

    for (const upload of uploads) {
        const nativeKey = uploadNativeKey(session.id, step, upload.path)
        const { data: asset, error } = await supabaseAdmin
            .from("assets")
            .upsert({
                workspace_id: session.workspace_id,
                title: upload.name,
                description: `Uploaded during ${step.title} onboarding.`,
                asset_kind: classifyUploadAsset(upload),
                source_kind: "onboarding_submission",
                storage_path: upload.path,
                content_type: upload.type || "application/octet-stream",
                file_size: upload.size,
                native_kind: "onboarding_upload",
                native_key: nativeKey,
                metadata: {
                    session_id: session.id,
                    relationship_id: session.relationship_id,
                    session_step_id: step.sessionStepId ?? null,
                    source_step_id: step.sourceStepId ?? null,
                    step_key: step.key,
                    legacy_step_key: step.legacyStepKey ?? step.key,
                    field_name: upload.fieldName,
                    provider: upload.provider ?? "r2",
                },
            }, { onConflict: "workspace_id,native_kind,native_key" })
            .select("id")
            .single()
        if (error || !asset) throw new Error("Could not save uploaded asset")
        await linkAsset(asset.id, session.workspace_id, session.relationship_id, workItemId)
    }

    const staleAssets = (existingAssets ?? []).filter((asset) => asset.native_key && !activeNativeKeys.has(asset.native_key))
    if (staleAssets.length > 0) {
        await supabaseAdmin
            .from("asset_work_items")
            .delete()
            .eq("workspace_id", session.workspace_id)
            .eq("work_item_id", workItemId)
            .in("asset_id", staleAssets.map((asset) => asset.id))
    }
}

async function maybeCompleteOnboarding(session: CanonicalOnboardingSession, workspaceSlug: string) {
    const { data: items } = await supabaseAdmin
        .from("work_items")
        .select("id, status")
        .eq("workspace_id", session.workspace_id)
        .eq("native_kind", "onboarding_step")
        .like("native_key", `${session.id}:%`)

    const allDone = Boolean(items?.length) && items!.every((item) => item.status === "done")
    if (!allDone) return

    let completedWithRpc = false
    const completionIdempotencyKey = `onboarding.session.completed:${session.id}`
    const { error: completionRpcError } = await supabaseAdmin.rpc("complete_relationship_onboarding_session", {
        p_workspace_id: session.workspace_id,
        p_session_id: session.id,
        p_session_token: session.session_token,
        p_correlation_id: session.source_sale_id ?? session.id,
        p_idempotency_key: completionIdempotencyKey,
    })
    if (!completionRpcError) {
        completedWithRpc = true
    } else if (isMissingOnboardingMutationRpc(completionRpcError, "complete_relationship_onboarding_session")) {
        const now = new Date().toISOString()
        const { error: completionError } = await supabaseAdmin
            .from("relationship_onboarding_sessions")
            .update({ status: "completed", completed_at: now })
            .eq("id", session.id)
        if (completionError) {
            await reportOnboardingFailure({ workspaceId: session.workspace_id, workspaceSlug, relationshipId: session.relationship_id, operation: "complete_session", error: completionError, diagnostics: { session_id: session.id } })
            throw new Error("Could not complete onboarding session")
        }
    } else {
        await reportOnboardingFailure({ workspaceId: session.workspace_id, workspaceSlug, relationshipId: session.relationship_id, operation: "complete_session", error: completionRpcError, diagnostics: { session_id: session.id } })
        throw new Error(publicOnboardingMutationMessage(completionRpcError, "Could not complete onboarding session"))
    }
    if (!completedWithRpc) {
        // Rolling-migration fallback: the new RPC finalises the lifecycle and
        // review work in the same transaction as the completed session.
        try {
            const finalItem = items?.at(-1)
            if (finalItem) await completeWorkflowParents({ workspaceId: session.workspace_id, relationshipId: session.relationship_id, workItemId: finalItem.id })
            await createOnboardingReviewWork({
                workspaceId: session.workspace_id,
                workspaceSlug,
                relationshipId: session.relationship_id,
                sessionId: session.id,
            })
        } catch (error) {
            await reportOnboardingFailure({ workspaceId: session.workspace_id, workspaceSlug, relationshipId: session.relationship_id, operation: "complete_workflow", error, diagnostics: { session_id: session.id } })
            throw error
        }
        await recordAdminActivity({
            workspaceId: session.workspace_id,
            category: "onboarding",
            eventKey: "onboarding.session.completed",
            summary: "Client completed onboarding",
            entityType: "onboarding_session",
            entityId: session.id,
            sourceHref: onboardingDetailHref(workspaceSlug, session.relationship_id),
            actorKind: "client",
            correlationId: session.source_sale_id ?? session.id,
            idempotencyKey: completionIdempotencyKey,
            metadata: { relationship_id: session.relationship_id, session_id: session.id },
        })
    }
    revalidatePath(`/${workspaceSlug}/work`)
}

export async function completeCanonicalStep(
    token: string,
    stepKey: string,
    submission?: { form: OnboardingFormDefinition; response: FormResponse },
) {
    const resolved = await getCanonicalSessionByToken(token)
    if (!resolved) throw new Error("Invalid onboarding session")
    const stepIndex = resolved.completableSteps.findIndex((step) => step.key === stepKey)
    const step = resolved.completableSteps[stepIndex]
    if (resolved.session.status !== "active") throw new Error("This onboarding session is read-only")
    if (!step) throw new Error(resolved.usesSnapshot ? ONBOARDING_SESSION_UPDATED_MESSAGE : "Unknown onboarding step")
    if (resolved.completedKeys.has(step.key)) throw new Error("Submitted steps are locked")
    const firstIncompleteIndex = resolved.completableSteps.findIndex((candidate) => !resolved.completedKeys.has(candidate.key))
    if (stepIndex !== firstIncompleteIndex) throw new Error("Complete the earlier onboarding step first.")
    const workItem = await findStepWorkItem(resolved.session.workspace_id, resolved.session.id, step)
    if (!workItem?.parent_work_item_id) throw new Error("Invalid onboarding step")
    let now = new Date().toISOString()
    let completedWithRpc = false
    const stepCompletionIdempotencyKey = `onboarding.step.completed:${resolved.session.id}:${stepIdentifier(step)}`
    if (step.sessionStepId) {
        const uploads = submission
            ? extractUploadsFromResponse(submission.response).map((upload) => ({
                field_name: upload.fieldName,
                name: upload.name,
                path: upload.path,
                size: upload.size,
                type: upload.type,
                provider: upload.provider ?? "r2",
                asset_kind: classifyUploadAsset(upload),
            }))
            : []
        const { data: completionData, error: completionRpcError } = await supabaseAdmin.rpc("complete_onboarding_session_step", {
            p_workspace_id: resolved.session.workspace_id,
            p_session_id: resolved.session.id,
            p_session_step_id: step.sessionStepId,
            p_work_item_id: workItem.id,
            p_session_token: token,
            p_correlation_id: resolved.session.source_sale_id ?? resolved.session.id,
            p_idempotency_key: stepCompletionIdempotencyKey,
            p_form_response: submission?.response ?? null,
            p_form_title: submission?.form.title ?? null,
            p_form_key: submission?.form.key ?? null,
            p_uploads: uploads,
        })
        if (!completionRpcError) {
            completedWithRpc = true
            const completedAt = completionData && typeof completionData === "object" && "completed_at" in completionData
                ? (completionData as { completed_at?: unknown }).completed_at
                : null
            if (typeof completedAt === "string") now = completedAt
        } else if (!isMissingOnboardingMutationRpc(completionRpcError, "complete_onboarding_session_step")) {
            await reportOnboardingFailure({ workspaceId: resolved.session.workspace_id, workspaceSlug: resolved.workspace.slug, relationshipId: resolved.session.relationship_id, operation: "complete_step", error: completionRpcError, diagnostics: { session_id: resolved.session.id, session_step_id: step.sessionStepId, work_item_id: workItem.id } })
            throw new Error(publicOnboardingMutationMessage(completionRpcError, "Could not save progress"))
        }
    }
    if (!completedWithRpc) {
        if (submission) {
            await saveSubmissionAsset({
                session: resolved.session,
                step,
                form: submission.form,
                response: submission.response,
                workItemId: workItem.id,
            })
            await saveUploadAssets({
                session: resolved.session,
                step,
                response: submission.response,
                workItemId: workItem.id,
            })
            if (step.sessionStepId) {
                await supabaseAdmin.from("onboarding_step_drafts").delete()
                    .eq("workspace_id", resolved.session.workspace_id)
                    .eq("session_step_id", step.sessionStepId)
            }
        }
        const { data: predecessorEdges } = await supabaseAdmin
            .from("work_item_dependencies")
            .select("depends_on_work_item_id")
            .eq("workspace_id", resolved.session.workspace_id)
            .eq("work_item_id", workItem.id)
        const predecessorIds = (predecessorEdges ?? []).map((edge) => edge.depends_on_work_item_id)
        const { data: predecessors } = predecessorIds.length
            ? await supabaseAdmin.from("work_items").select("actual_completed_at").eq("workspace_id", resolved.session.workspace_id).in("id", predecessorIds)
            : { data: [] as Array<{ actual_completed_at: string | null }> }
        const predecessorFinishedAt = (predecessors ?? []).map((item) => item.actual_completed_at).filter((value): value is string => Boolean(value)).sort().at(-1)
        const { error } = await supabaseAdmin
            .from("work_items")
            .update({
                status: "done",
                actual_start_at: workItem.actual_start_at ?? predecessorFinishedAt ?? now,
                actual_start_has_time: true,
                actual_completed_at: now,
                actual_completed_has_time: true,
                updated_at: now,
            })
            .eq("id", workItem.id)
            .eq("workspace_id", resolved.session.workspace_id)
        if (error) {
            await reportOnboardingFailure({ workspaceId: resolved.session.workspace_id, workspaceSlug: resolved.workspace.slug, relationshipId: resolved.session.relationship_id, operation: "complete_step", error, diagnostics: { session_id: resolved.session.id, step_key: stepKey, work_item_id: workItem.id } })
            throw new Error("Could not save progress")
        }
        if (step.sessionModuleId) {
            const moduleSteps = resolved.completableSteps.filter((candidate) => candidate.sessionModuleId === step.sessionModuleId)
            const moduleIsComplete = moduleSteps.length > 0 && moduleSteps.every((candidate) => candidate.key === step.key || resolved.completedKeys.has(candidate.key))
            if (moduleIsComplete) {
                await supabaseAdmin
                    .from("onboarding_session_notices")
                    .update({ module_completed_at: now })
                    .eq("workspace_id", resolved.session.workspace_id)
                    .eq("session_id", resolved.session.id)
                    .eq("session_module_id", step.sessionModuleId)
                    .is("module_completed_at", null)
            }
        }
        await recordAdminActivity({
            workspaceId: resolved.session.workspace_id,
            category: "onboarding",
            eventKey: "onboarding.step.completed",
            summary: `Client completed onboarding step: ${resolved.completableSteps[stepIndex]?.title ?? stepKey}`,
            entityType: "work_item",
            entityId: workItem.id,
            sourceHref: onboardingDetailHref(resolved.workspace.slug, resolved.session.relationship_id),
            actorKind: "client",
            correlationId: resolved.session.source_sale_id ?? resolved.session.id,
            idempotencyKey: stepCompletionIdempotencyKey,
            metadata: {
                relationship_id: resolved.session.relationship_id,
                session_id: resolved.session.id,
                session_step_id: step.sessionStepId ?? null,
                step_key: step.legacyStepKey ?? step.key,
            },
        })
    }
    if (!completedWithRpc) {
        const nextStep = resolved.completableSteps[stepIndex + 1]
        let nextWorkItem: CanonicalStepWorkItem | null = null
        if (nextStep) {
            nextWorkItem = await findStepWorkItem(resolved.session.workspace_id, resolved.session.id, nextStep)
            if (!nextWorkItem) {
                const nextId = await createCanonicalStepWorkItem({
                    session: resolved.session,
                    workspaceSlug: resolved.workspace.slug,
                    parentWorkItemId: workItem.parent_work_item_id,
                    step: nextStep,
                    index: stepIndex + 1,
                    predecessorId: workItem.id,
                    startAt: now,
                })
                nextWorkItem = { id: nextId, status: "todo", actual_start_at: now, parent_work_item_id: workItem.parent_work_item_id }
            } else {
            const { error: startError } = await supabaseAdmin.from("work_items").update({ actual_start_at: now, actual_start_has_time: true })
                .eq("workspace_id", resolved.session.workspace_id).eq("id", nextWorkItem.id).is("actual_start_at", null)
                if (startError) {
                    await reportOnboardingFailure({ workspaceId: resolved.session.workspace_id, workspaceSlug: resolved.workspace.slug, relationshipId: resolved.session.relationship_id, operation: "start_next_step", error: startError, diagnostics: { session_id: resolved.session.id, step_key: nextStep.key, work_item_id: nextWorkItem.id } })
                    throw new Error("Could not start the next onboarding step")
                }
            }
        }
        const upcomingStep = resolved.completableSteps[stepIndex + 2]
        if (upcomingStep && nextWorkItem) {
            const existingUpcoming = await findStepWorkItem(resolved.session.workspace_id, resolved.session.id, upcomingStep)
            if (!existingUpcoming) {
                await createCanonicalStepWorkItem({
                    session: resolved.session,
                    workspaceSlug: resolved.workspace.slug,
                    parentWorkItemId: workItem.parent_work_item_id,
                    step: upcomingStep,
                    index: stepIndex + 2,
                    predecessorId: nextWorkItem.id,
                })
            }
        }
    }
    await maybeCompleteOnboarding(resolved.session, resolved.workspace.slug)
    revalidateOnboarding(resolved.workspace.slug, resolved.session.relationship_id, token)
}

export async function submitCanonicalFormStep(token: string, stepKey: string, response: FormResponse) {
    const resolved = await getCanonicalSessionByToken(token)
    if (!resolved) throw new Error("Invalid onboarding session")
    if (resolved.session.status !== "active") throw new Error("This onboarding session is read-only")
    const step = resolved.completableSteps.find((candidate) => candidate.key === stepKey)
    if (!step || step.kind !== "form") throw new Error(resolved.usesSnapshot ? ONBOARDING_SESSION_UPDATED_MESSAGE : "Unknown onboarding form")
    if (resolved.completedKeys.has(step.key)) throw new Error("Submitted steps are locked")
    const form = step.form
        ?? (step.formKey ? (await import("@/lib/onboarding/forms")).getOnboardingForm(step.formKey) : null)
    if (!form) throw new Error("Unknown onboarding form")
    validateFormResponse(form, response)
    const workItem = await findStepWorkItem(resolved.session.workspace_id, resolved.session.id, step)
    if (!workItem) throw new Error(resolved.usesSnapshot ? ONBOARDING_SESSION_UPDATED_MESSAGE : "Unknown onboarding step")
    await completeCanonicalStep(token, stepKey, { form, response })
}

function draftResponseForForm(form: OnboardingFormDefinition, response: FormResponse) {
    const draft: FormResponse = {}
    for (const field of form.fields) {
        const value = response[field.name]
        if (field.type === "file") {
            if (Array.isArray(value)) draft[field.name] = value.filter((item) => item && typeof item === "object" && typeof item.path === "string")
        } else if (typeof value === "string") {
            draft[field.name] = value.slice(0, 100_000)
        }
    }
    return draft
}

export async function getCanonicalStepDraft(token: string, stepKey: string): Promise<{ response: FormResponse; lockVersion: number } | null> {
    const resolved = await getCanonicalSessionByToken(token)
    if (!resolved) return null
    const step = resolved.completableSteps.find((candidate) => candidate.key === stepKey)
    if (!step?.sessionStepId || step.kind !== "form" || resolved.completedKeys.has(step.key)) return null
    const { data, error } = await supabaseAdmin
        .from("onboarding_step_drafts")
        .select("response, lock_version")
        .eq("workspace_id", resolved.session.workspace_id)
        .eq("session_id", resolved.session.id)
        .eq("session_step_id", step.sessionStepId)
        .maybeSingle()
    if (isMissingCanonicalOnboarding(error) || error || !data) return null
    return {
        response: data.response && typeof data.response === "object" ? data.response as FormResponse : {},
        lockVersion: Number(data.lock_version) || 1,
    }
}

export async function saveCanonicalStepDraft(token: string, stepKey: string, response: FormResponse) {
    const resolved = await getCanonicalSessionByToken(token)
    if (!resolved) throw new Error("Invalid onboarding session")
    if (resolved.session.status !== "active") throw new Error("This onboarding session is read-only")
    const stepIndex = resolved.completableSteps.findIndex((candidate) => candidate.key === stepKey)
    const step = resolved.completableSteps[stepIndex]
    if (!step && resolved.usesSnapshot) throw new Error(ONBOARDING_SESSION_UPDATED_MESSAGE)
    if (!step?.sessionStepId || step.kind !== "form" || !step.form) return { saved: false as const, lockVersion: 0 }
    if (resolved.completedKeys.has(step.key)) throw new Error("Submitted steps are locked")
    const firstIncompleteIndex = resolved.completableSteps.findIndex((candidate) => !resolved.completedKeys.has(candidate.key))
    if (stepIndex !== firstIncompleteIndex) throw new Error("Complete the earlier onboarding step first.")
    const { data: current, error: currentError } = await supabaseAdmin
        .from("onboarding_step_drafts")
        .select("lock_version")
        .eq("workspace_id", resolved.session.workspace_id)
        .eq("session_step_id", step.sessionStepId)
        .maybeSingle()
    if (isMissingCanonicalOnboarding(currentError)) return { saved: false as const, lockVersion: 0 }
    if (currentError) throw new Error("Could not save this draft")
    const lockVersion = (Number(current?.lock_version) || 0) + 1
    const { error } = await supabaseAdmin.from("onboarding_step_drafts").upsert({
        workspace_id: resolved.session.workspace_id,
        session_id: resolved.session.id,
        session_step_id: step.sessionStepId,
        response: draftResponseForForm(step.form, response),
        lock_version: lockVersion,
    }, { onConflict: "session_step_id" })
    if (isMissingCanonicalOnboarding(error)) return { saved: false as const, lockVersion: 0 }
    if (error) throw new Error("Could not save this draft")
    return { saved: true as const, lockVersion }
}

export async function requestCanonicalStepEdit(token: string, stepKey: string) {
    const resolved = await getCanonicalSessionByToken(token)
    if (!resolved) throw new Error("Invalid onboarding session")
    const step = resolved.completableSteps.find((candidate) => candidate.key === stepKey)
    if (!step && resolved.usesSnapshot) throw new Error(ONBOARDING_SESSION_UPDATED_MESSAGE)
    if (!step?.sessionStepId || !resolved.completedKeys.has(step.key)) throw new Error("Only submitted steps can have an edit request")
    const editRequestIdempotencyKey = `onboarding.edit_request.recorded:${resolved.session.id}:${step.sessionStepId}`
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc("record_onboarding_edit_request", {
        p_workspace_id: resolved.session.workspace_id,
        p_session_id: resolved.session.id,
        p_session_step_id: step.sessionStepId,
        p_session_token: token,
        p_correlation_id: resolved.session.source_sale_id ?? resolved.session.id,
        p_idempotency_key: editRequestIdempotencyKey,
    })
    if (!rpcError) {
        const alreadyRequested = Boolean(
            rpcData && typeof rpcData === "object" && "already_requested" in rpcData
                ? (rpcData as { already_requested?: unknown }).already_requested
                : false
        )
        return { requested: true as const, alreadyRequested }
    }
    if (!isMissingOnboardingMutationRpc(rpcError, "record_onboarding_edit_request")) {
        await reportOnboardingFailure({ workspaceId: resolved.session.workspace_id, workspaceSlug: resolved.workspace.slug, relationshipId: resolved.session.relationship_id, operation: "record_edit_request", error: rpcError, diagnostics: { session_id: resolved.session.id, session_step_id: step.sessionStepId } })
        throw new Error(publicOnboardingMutationMessage(rpcError, "Could not record your request"))
    }
    const { data: existing, error: existingError } = await supabaseAdmin
        .from("onboarding_edit_requests")
        .select("id")
        .eq("workspace_id", resolved.session.workspace_id)
        .eq("session_step_id", step.sessionStepId)
        .eq("status", "pending")
        .maybeSingle()
    if (isMissingCanonicalOnboarding(existingError)) throw new Error("Edit requests are not available for this session")
    if (existingError) throw new Error("Could not record your request")
    if (existing) return { requested: true as const, alreadyRequested: true as const }
    const { data: request, error } = await supabaseAdmin.from("onboarding_edit_requests").insert({
        workspace_id: resolved.session.workspace_id,
        relationship_id: resolved.session.relationship_id,
        session_id: resolved.session.id,
        session_step_id: step.sessionStepId,
        status: "pending",
    }).select("id").single()
    if (error || !request) throw new Error("Could not record your request")
    await recordAdminActivity({
        workspaceId: resolved.session.workspace_id,
        category: "onboarding",
        eventKey: "onboarding.edit_request.recorded",
        summary: `Client requested an edit to onboarding step: ${step.title}`,
        entityType: "onboarding_edit_request",
        entityId: request.id,
        sourceHref: onboardingDetailHref(resolved.workspace.slug, resolved.session.relationship_id),
        actorKind: "client",
        correlationId: resolved.session.source_sale_id ?? resolved.session.id,
        idempotencyKey: editRequestIdempotencyKey,
        metadata: { relationship_id: resolved.session.relationship_id, session_id: resolved.session.id, session_step_id: step.sessionStepId },
    })
    return { requested: true as const, alreadyRequested: false as const }
}

export async function markCanonicalSessionNoticeSeen(token: string, noticeId: string) {
    const resolved = await getCanonicalSessionByToken(token)
    if (!resolved) throw new Error("Invalid onboarding session")
    const notice = resolved.notices.find((candidate) => candidate.id === noticeId)
    if (!notice) return { seen: false as const }
    if (!notice.firstSeenAt) {
        const { error } = await supabaseAdmin
            .from(notice.kind === "release" ? "onboarding_release_notices" : "onboarding_session_notices")
            .update({ first_seen_at: new Date().toISOString() })
            .eq("workspace_id", resolved.session.workspace_id)
            .eq("session_id", resolved.session.id)
            .eq("id", noticeId)
            .is("first_seen_at", null)
        if (error && !isMissingCanonicalOnboarding(error)) throw new Error("Could not record this update notice")
    }
    return { seen: true as const }
}

export async function getPublicOnboardingPath(token: string) {
    return (await headers()).get("x-betelgeze-custom-onboarding-domain")
        ? `/${token}`
        : `/onboarding/session/${token}`
}

export function revalidateOnboarding(workspaceSlug: string, relationshipId: string, token: string) {
    revalidatePath(`/onboarding/session/${token}`)
    revalidatePath(`/${workspaceSlug}/onboarding`)
    revalidatePath(`/${workspaceSlug}/onboarding/${relationshipId}`)
    revalidatePath(relationshipHubHref(workspaceSlug, relationshipId))
}

function isUuid(value: string | null | undefined) {
    return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
}

function canMaterializeComposition(composition: ComposedOnboardingSession) {
    return isUuid(composition.configurationRevisionId)
        && isUuid(composition.welcomeRevisionId)
        && isUuid(composition.completionRevisionId)
        && composition.modules.every((module) =>
            isUuid(module.moduleId)
            && isUuid(module.moduleRevisionId)
            && (!module.sourceServiceRevisionId || isUuid(module.sourceServiceRevisionId))
            && module.steps.every((step) => isUuid(step.sourceStepId) && step.fields.every((field) => isUuid(field.sourceFieldId)))
        )
}

async function materializeNormalizedSnapshot(input: {
    session: Pick<CanonicalOnboardingSession, "id" | "workspace_id">
    composition: ComposedOnboardingSession
}) {
    const moduleIdBySourceId = new Map<string, string>()
    if (input.composition.modules.length) {
        const { data: moduleRows, error } = await supabaseAdmin
            .from("relationship_onboarding_session_modules")
            .insert(input.composition.modules.map((module) => ({
                workspace_id: input.session.workspace_id,
                session_id: input.session.id,
                module_id: module.moduleId,
                module_revision_id: module.moduleRevisionId,
                source_kind: module.sourceKind,
                source_service_revision_id: module.sourceServiceRevisionId,
                sort_order: module.sortOrder,
                title: module.title,
                description: module.description,
                is_test: module.isTest,
            })))
            .select("id, module_id")
        if (error) throw new Error(error.message)
        for (const row of moduleRows ?? []) moduleIdBySourceId.set(String(row.module_id), String(row.id))
    }

    const orderedSteps: Array<{
        step: ComposedOnboardingSession["bookends"][number] | ComposedOnboardingSession["modules"][number]["steps"][number]
        moduleId: string | null
        kind: "form" | "video" | "welcome" | "completion"
        sortOrder: number
    }> = []
    const welcome = input.composition.bookends.find((step) => step.bookendKind === "welcome")
    if (welcome) orderedSteps.push({ step: welcome, moduleId: null, kind: "welcome", sortOrder: 0 })
    let stepPosition = 1
    for (const snapshotModule of input.composition.modules) {
        for (const step of snapshotModule.steps) {
            orderedSteps.push({ step, moduleId: snapshotModule.moduleId, kind: step.kind, sortOrder: stepPosition * 10 })
            stepPosition += 1
        }
    }
    const completion = input.composition.bookends.find((step) => step.bookendKind === "completion")
    if (completion) orderedSteps.push({ step: completion, moduleId: null, kind: "completion", sortOrder: stepPosition * 10 })

    const { data: stepRows, error: stepError } = await supabaseAdmin
        .from("relationship_onboarding_session_steps")
        .insert(orderedSteps.map(({ step, moduleId, kind, sortOrder }) => ({
            workspace_id: input.session.workspace_id,
            session_id: input.session.id,
            session_module_id: moduleId ? moduleIdBySourceId.get(moduleId) : null,
            source_step_id: step.sourceStepId,
            module_revision_id: step.moduleRevisionId,
            bookend_revision_id: step.bookendRevisionId,
            kind,
            title: step.title,
            description: step.description,
            estimated_time: step.estimatedTime,
            why_we_ask: step.why,
            video_url: step.videoUrl || null,
            video_storage_path: step.videoPath,
            sort_order: sortOrder,
            legacy_step_key: step.legacyStepKey,
            legacy_form_key: step.legacyFormKey,
        })))
        .select("id, sort_order")
    if (stepError) throw new Error(stepError.message)
    const stepIdBySortOrder = new Map((stepRows ?? []).map((row) => [Number(row.sort_order), String(row.id)]))
    const fieldRows = orderedSteps.flatMap(({ step, sortOrder }) => step.fields.map((field) => ({
        workspace_id: input.session.workspace_id,
        session_id: input.session.id,
        session_step_id: stepIdBySortOrder.get(sortOrder),
        source_field_id: field.sourceFieldId,
        type: field.type,
        label: field.label,
        required: field.required,
        help_text: field.helpText,
        placeholder: field.placeholder,
        file_accept: field.accept,
        multiple: field.multiple,
        sort_order: field.sortOrder,
        legacy_field_name: field.legacyFieldName,
    })))
    if (fieldRows.length) {
        const { error } = await supabaseAdmin.from("relationship_onboarding_session_fields").insert(fieldRows)
        if (error) throw new Error(error.message)
    }
}

type CreateRelationshipOnboardingInput = {
    workspaceId: string
    workspaceSlug: string
    relationshipId: string
    serviceKeys: string[]
    moduleKeys?: string[]
    projectTimeframeDays?: number | null
    isTest?: boolean
    createdBy?: string | null
    sourceSaleId?: string | null
    compositionSource?: "versioned" | "legacy"
}

export async function createRelationshipOnboardingSession({
    workspaceId,
    workspaceSlug,
    relationshipId,
    serviceKeys,
    moduleKeys,
    projectTimeframeDays,
    isTest = false,
    createdBy,
    sourceSaleId,
    compositionSource,
}: CreateRelationshipOnboardingInput) {
    const now = new Date().toISOString()
    if (sourceSaleId) {
        const { data: existing, error: existingError } = await supabaseAdmin
            .from("relationship_onboarding_sessions")
            .select("id, relationship_id, session_token")
            .eq("workspace_id", workspaceId)
            .eq("source_sale_id", sourceSaleId)
            .maybeSingle()
        if (!existingError && existing) {
            return {
                id: existing.id,
                relationshipId: existing.relationship_id,
                sessionToken: existing.session_token,
                onboardingUrl: `/onboarding/session/${existing.session_token}`,
                created: false,
            }
        }
        if (existingError && !isMissingCanonicalOnboarding(existingError)) throw new Error("Could not resume paid onboarding")
    }

    const useLegacyComposition = compositionSource
        ? compositionSource === "legacy"
        : getOnboardingRuntimeMode() !== "versioned"
    const publishedConfiguration = useLegacyComposition
        ? legacyPublishedOnboardingConfiguration()
        : await loadPublishedOnboardingConfiguration(workspaceId)
    const selectedServiceDefinitions = serviceKeys.flatMap((serviceKey) => {
        const service = publishedConfiguration.services.find((candidate) => candidate.code === serviceKey && candidate.state === "active")
        return service ? [service] : []
    })
    const selectedServices = selectedServiceDefinitions.length
        ? selectedServiceDefinitions.map((service) => service.code)
        : serviceKeys.filter((serviceKey) => serviceKey in SERVICES)
    const composition = composeOnboardingSession({
        purchasedServices: selectedServiceDefinitions,
        modules: publishedConfiguration.modules,
        mandatory: publishedConfiguration.mandatory,
        welcome: publishedConfiguration.welcome,
        completion: publishedConfiguration.completion,
    })
    const normalizedComposition = publishedConfiguration.schemaReady && canMaterializeComposition(composition)
        ? composition
        : null
    const selectedModules = [...new Set(moduleKeys !== undefined
        ? moduleKeys
        : normalizedComposition
            ? normalizedComposition.modules.map((module) => publishedConfiguration.modules.find((candidate) => candidate.id === module.moduleId)?.code).filter((key): key is string => Boolean(key))
            : getModuleKeysForServices(selectedServices))]
    const { data: oldSessions } = await supabaseAdmin
        .from("relationship_onboarding_sessions")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("relationship_id", relationshipId)
        .eq("status", "active")

    if (oldSessions?.length) {
        await supabaseAdmin
            .from("relationship_onboarding_sessions")
            .update({ status: "archived", archived_at: now })
            .eq("workspace_id", workspaceId)
            .eq("relationship_id", relationshipId)
            .eq("status", "active")
        await Promise.all(oldSessions.map((session) =>
            supabaseAdmin
                .from("work_items")
                .update({ status: "canceled", updated_at: now })
                .eq("workspace_id", workspaceId)
                .eq("native_kind", "onboarding_step")
                .like("native_key", `${session.id}:%`)
                .neq("status", "done")
        ))
    }

    const sessionToken = randomBytes(32).toString("hex")
    const sessionInsert = {
        workspace_id: workspaceId,
        relationship_id: relationshipId,
        session_token: sessionToken,
        status: "active",
        is_test: isTest,
        project_timeframe_days: projectTimeframeDays ?? null,
        created_by: createdBy ?? null,
        source_sale_id: sourceSaleId ?? null,
        ...(normalizedComposition ? {
            configuration_revision_id: normalizedComposition.configurationRevisionId,
            welcome_revision_id: normalizedComposition.welcomeRevisionId,
            completion_revision_id: normalizedComposition.completionRevisionId,
            snapshot_schema_version: normalizedComposition.audit.schemaVersion,
            composition_hash: normalizedComposition.compositionHash,
            composition_snapshot: normalizedComposition.audit,
        } : {}),
    }
    let { data: session, error } = await supabaseAdmin
        .from("relationship_onboarding_sessions")
        .insert(sessionInsert)
        .select("id, session_token")
        .single()
    if (error && isMissingCanonicalOnboarding(error)) {
        const legacyInsert = await supabaseAdmin
            .from("relationship_onboarding_sessions")
            .insert({
                workspace_id: workspaceId,
                relationship_id: relationshipId,
                session_token: sessionToken,
                status: "active",
                is_test: isTest,
                project_timeframe_days: projectTimeframeDays ?? null,
                created_by: createdBy ?? null,
            })
            .select("id, session_token")
            .single()
        session = legacyInsert.data
        error = legacyInsert.error
    }
    if (error || !session) {
        await reportOnboardingFailure({ workspaceId, workspaceSlug, relationshipId, operation: "create_session", error: error?.message ?? "No onboarding session was returned" })
        throw new Error("create-session-failed")
    }

    if (normalizedComposition) {
        try {
            await materializeNormalizedSnapshot({
                session: { id: session.id, workspace_id: workspaceId },
                composition: normalizedComposition,
            })
        } catch (snapshotError) {
            await reportOnboardingFailure({ workspaceId, workspaceSlug, relationshipId, operation: "materialize_session_snapshot", error: snapshotError, diagnostics: { session_id: session.id } })
        }
    }

    await Promise.all([
        selectedModules.length
            ? supabaseAdmin.from("relationship_onboarding_modules").upsert(
                selectedModules.map((moduleKey) => ({
                    workspace_id: workspaceId,
                    relationship_id: relationshipId,
                    module_key: moduleKey,
                })),
                { onConflict: "relationship_id,module_key" }
            )
            : Promise.resolve(),
        selectedServices.length
            ? supabaseAdmin.from("relationship_services").upsert(
                selectedServices.map((serviceKey) => ({
                    workspace_id: workspaceId,
                    relationship_id: relationshipId,
                    service_key: serviceKey,
                })),
                { onConflict: "relationship_id,service_key" }
            )
            : Promise.resolve(),
    ])

    const normalizedSnapshot = normalizedComposition
        ? await loadNormalizedSessionSnapshot({ id: session.id, workspace_id: workspaceId, snapshot_schema_version: normalizedComposition.audit.schemaVersion })
        : null
    const steps: SessionStep[] = normalizedSnapshot
        ? normalizedSnapshot.actionableSteps.map((step) => snapshotStepToSessionStep(step))
        : getOnboardingStepsForModules(selectedModules)
    const onboardingStageId = await ensureRelationshipStage({
        workspaceId,
        relationshipId,
        phase: "onboarding",
    })
    let predecessorId: string | null = null
    for (const [index, step] of steps.slice(0, 2).entries()) {
        predecessorId = await createCanonicalStepWorkItem({
            session: { ...session, workspace_id: workspaceId, relationship_id: relationshipId },
            workspaceSlug,
            parentWorkItemId: onboardingStageId,
            step,
            index,
            predecessorId,
            startAt: index === 0 ? now : null,
        })
    }

    await supabaseAdmin
        .from("relationships")
        .update({
            lifecycle_phase: "onboarding",
            started_onboarding_at: now,
            updated_at: now,
        })
        .eq("workspace_id", workspaceId)
        .eq("id", relationshipId)

    const sessionCorrelationId = sourceSaleId ?? session.id
    await recordAdminActivity({
        workspaceId,
        category: "onboarding",
        eventKey: "onboarding.session.composed",
        summary: "Onboarding session composition resolved",
        entityType: "onboarding_session",
        entityId: session.id,
        sourceHref: onboardingDetailHref(workspaceSlug, relationshipId),
        actorUserId: createdBy ?? null,
        actorKind: createdBy ? "staff" : "automation",
        correlationId: sessionCorrelationId,
        idempotencyKey: `onboarding.session.composed:${session.id}`,
        metadata: normalizedComposition ? {
            relationship_id: relationshipId,
            session_id: session.id,
            configuration_revision_id: normalizedComposition.configurationRevisionId,
            welcome_revision_id: normalizedComposition.welcomeRevisionId,
            completion_revision_id: normalizedComposition.completionRevisionId,
            service_revision_ids: normalizedComposition.serviceRevisionIds,
            module_revision_ids: normalizedComposition.modules.map((module) => module.moduleRevisionId),
            service_count: normalizedComposition.serviceRevisionIds.length,
            module_count: normalizedComposition.modules.length,
            step_count: normalizedComposition.audit.stepCount,
            field_count: normalizedComposition.audit.fieldCount,
            composition_hash: normalizedComposition.compositionHash,
            snapshot_schema_version: 1,
        } : {
            relationship_id: relationshipId,
            session_id: session.id,
            service_count: selectedServices.length,
            module_count: selectedModules.length,
            step_count: steps.length,
            snapshot_schema_version: 0,
            migration_fallback: "legacy_hard_coded",
        },
    })
    await recordAdminActivity({
        workspaceId,
        category: "onboarding",
        eventKey: "onboarding.session.started",
        summary: "Client onboarding session started",
        entityType: "onboarding_session",
        entityId: session.id,
        sourceHref: onboardingDetailHref(workspaceSlug, relationshipId),
        actorUserId: createdBy ?? null,
        actorKind: createdBy ? "staff" : "automation",
        correlationId: sessionCorrelationId,
        idempotencyKey: `onboarding.session.started:${session.id}`,
        metadata: { relationship_id: relationshipId, modules: selectedModules, services: selectedServices, is_test: isTest },
    })

    return {
        id: session.id,
        relationshipId,
        sessionToken: session.session_token,
        onboardingUrl: `/onboarding/session/${session.session_token}`,
        created: true,
    }
}

export function assetLocation(workspaceSlug: string, assetId: string) {
    return assetHref(workspaceSlug, assetId)
}

export function stepLocation(workspaceSlug: string, workItemId: string | null | undefined, relationshipId: string) {
    return workItemId ? workItemHref(workspaceSlug, workItemId) : onboardingDetailHref(workspaceSlug, relationshipId)
}
