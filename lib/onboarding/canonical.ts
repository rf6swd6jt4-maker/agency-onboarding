import { randomBytes } from "crypto"
import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { SERVICES, getModuleKeysForServices } from "@/lib/onboarding/services"
import { FormResponse, OnboardingFormDefinition, StoredUpload } from "@/lib/onboarding/forms"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { assetHref, onboardingDetailHref, relationshipHubHref, workItemHref } from "@/lib/relationships"
import { completeWorkflowParents, createOnboardingReviewWork, ensureRelationshipStage } from "@/lib/relationship-workflow"
import { platformFailureFingerprint, reportPlatformFailure } from "@/lib/admin/maintenance"
import {
    classifyUploadAsset,
    FINAL_ONBOARDING_STEP,
    getOnboardingStepsForModules,
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
}

export type SessionStep = CanonicalSessionStep & {
    workItemId?: string | null
    status?: "todo" | "doing" | "waiting" | "blocked" | "done" | "canceled"
    updatedAt?: string | null
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
    steps: SessionStep[]
    completableSteps: SessionStep[]
    completedKeys: Set<string>
}

type CanonicalStepWorkItem = {
    id: string
    status: SessionStep["status"]
    actual_start_at: string | null
    parent_work_item_id: string | null
}

type QueryError = { message?: string; code?: string } | null | undefined

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
    const { data: session, error } = await supabaseAdmin
        .from("relationship_onboarding_sessions")
        .select("id, workspace_id, relationship_id, session_token, status, is_test, project_timeframe_days, legacy_client_id, created_by, archived_at, completed_at, created_at, updated_at")
        .eq("session_token", token)
        .in("status", ["active", "completed"])
        .maybeSingle()

    if (isMissingCanonicalOnboarding(error) || error || !session) return null

    const workspaceQuery = supabaseAdmin
        .from("workspaces")
        .select("id, name, slug")
        .eq("id", session.workspace_id)
        .eq("status", "active")

    const [{ data: workspace }, { data: relationship }, { data: modules }, { data: workItems }] = await Promise.all([
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
    ])

    if (!workspace || !relationship) return null

    const moduleKeys = (modules ?? []).map((row) => row.module_key).filter((key): key is string => Boolean(key))
    const canonicalSteps = getOnboardingStepsForModules(moduleKeys)
    let canonicalWorkItems = workItems ?? []

    if (session.status === "active") {
        try {
            const repaired = await reconcileCanonicalStepWindow({
                session: session as CanonicalOnboardingSession,
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
            console.error("Could not reconcile canonical onboarding work window", {
                sessionId: session.id,
                message: error instanceof Error ? error.message : String(error),
            })
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
        const stepKey = typeof metadata.step_key === "string" ? metadata.step_key : null
        if (stepKey) workItemByStepKey.set(stepKey, { id: item.id, status: item.status as SessionStep["status"], updated_at: item.updated_at ?? null })
    }

    const completableSteps = canonicalSteps.map((step) => {
        const item = workItemByStepKey.get(step.key)
        return { ...step, workItemId: item?.id ?? null, status: item?.status ?? "todo", updatedAt: item?.updated_at ?? null }
    })
    const completedKeys = new Set(completableSteps.filter((step) => step.status === "done").map((step) => step.key))

    return {
        session: session as CanonicalOnboardingSession,
        workspace,
        relationship,
        moduleKeys,
        completableSteps,
        completedKeys,
        steps: [...completableSteps, FINAL_ONBOARDING_STEP],
    }
}

export async function getFormResponseAsset(sessionId: string, stepKey: string): Promise<FormResponse | undefined> {
    const { data } = await supabaseAdmin
        .from("assets")
        .select("metadata")
        .eq("native_kind", "onboarding_form_submission")
        .eq("native_key", onboardingSubmissionNativeKey(sessionId, stepKey))
        .maybeSingle()
    const metadata = data?.metadata && typeof data.metadata === "object" ? data.metadata as Record<string, unknown> : {}
    const response = metadata.response
    return response && typeof response === "object" ? response as FormResponse : undefined
}

async function findStepWorkItem(workspaceId: string, sessionId: string, stepKey: string) {
    const { data } = await supabaseAdmin
        .from("work_items")
        .select("id, status, actual_start_at, parent_work_item_id")
        .eq("workspace_id", workspaceId)
        .eq("native_kind", "onboarding_step")
        .eq("native_key", onboardingStepNativeKey(sessionId, stepKey))
        .maybeSingle()
    return data
}

async function createCanonicalStepWorkItem(input: {
    session: Pick<CanonicalOnboardingSession, "id" | "workspace_id" | "relationship_id">
    workspaceSlug: string
    parentWorkItemId: string
    step: CanonicalSessionStep
    index: number
    predecessorId?: string | null
    startAt?: string | null
}) {
    const existing = await findStepWorkItem(input.session.workspace_id, input.session.id, input.step.key)
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
                native_key: onboardingStepNativeKey(input.session.id, input.step.key),
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
                    step_key: input.step.key,
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
            workItemId = (await findStepWorkItem(input.session.workspace_id, input.session.id, input.step.key))?.id
        } else if (error || !item) {
            console.error("Could not create canonical onboarding work item", {
                sessionId: input.session.id,
                stepKey: input.step.key,
                code: error?.code,
                message: error?.message,
            })
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
    return typeof metadata.step_key === "string" ? metadata.step_key : null
}

async function reconcileCanonicalStepWindow(input: {
    session: CanonicalOnboardingSession
    workspaceSlug: string
    steps: CanonicalSessionStep[]
    workItems: CanonicalStepWindowItem[]
}) {
    const itemsByStepKey = new Map<string, CanonicalStepWindowItem>()
    for (const item of input.workItems) {
        const stepKey = canonicalStepKey(item)
        if (stepKey) itemsByStepKey.set(stepKey, item)
    }
    const currentIndex = input.steps.findIndex((step) => itemsByStepKey.get(step.key)?.status !== "done")
    if (currentIndex < 0) return false

    const currentStep = input.steps[currentIndex]
    const previousItem = currentIndex > 0 ? itemsByStepKey.get(input.steps[currentIndex - 1].key) ?? null : null
    const currentItem = itemsByStepKey.get(currentStep.key) ?? null
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
        const nextItem = itemsByStepKey.get(nextStep.key)
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
    stepKey,
    form,
    response,
    workItemId,
}: {
    session: CanonicalOnboardingSession
    stepKey: string
    form: OnboardingFormDefinition
    response: FormResponse
    workItemId: string
}) {
    const now = new Date().toISOString()
    const nativeKey = onboardingSubmissionNativeKey(session.id, stepKey)
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
                step_key: stepKey,
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
    stepKey,
    response,
    workItemId,
}: {
    session: CanonicalOnboardingSession
    stepKey: string
    response: FormResponse
    workItemId: string
}) {
    const uploads = extractUploadsFromResponse(response)
    const activeNativeKeys = new Set(uploads.map((upload) => onboardingUploadNativeKey(session.id, stepKey, upload.path)))

    const { data: existingAssets } = await supabaseAdmin
        .from("assets")
        .select("id, native_key")
        .eq("workspace_id", session.workspace_id)
        .eq("native_kind", "onboarding_upload")
        .like("native_key", `${session.id}:${stepKey}:upload:%`)

    for (const upload of uploads) {
        const nativeKey = onboardingUploadNativeKey(session.id, stepKey, upload.path)
        const { data: asset, error } = await supabaseAdmin
            .from("assets")
            .upsert({
                workspace_id: session.workspace_id,
                title: upload.name,
                description: `Uploaded during ${stepKey.replace(/-/g, " ")} onboarding.`,
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
                    step_key: stepKey,
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

    const now = new Date().toISOString()
    await supabaseAdmin
        .from("relationship_onboarding_sessions")
        .update({ status: "completed", completed_at: now })
        .eq("id", session.id)
    // Complete the open onboarding lifecycle stage before materialising the
    // review stage. Review already depends on onboarding, so this gives it the
    // final step's exact completion timestamp rather than its old ghost-creation
    // time when ensureRelationshipStage activates it.
    const finalItem = items?.at(-1)
    if (finalItem) await completeWorkflowParents({ workspaceId: session.workspace_id, relationshipId: session.relationship_id, workItemId: finalItem.id })
    await createOnboardingReviewWork({
        workspaceId: session.workspace_id,
        workspaceSlug,
        relationshipId: session.relationship_id,
        sessionId: session.id,
    })
    revalidatePath(`/${workspaceSlug}/work`)
}

export async function completeCanonicalStep(token: string, stepKey: string) {
    const resolved = await getCanonicalSessionByToken(token)
    if (!resolved) throw new Error("Invalid onboarding session")
    const workItem = await findStepWorkItem(resolved.session.workspace_id, resolved.session.id, stepKey)
    if (!workItem) throw new Error("Unknown onboarding step")
    const stepIndex = resolved.completableSteps.findIndex((step) => step.key === stepKey)
    if (stepIndex < 0 || !workItem.parent_work_item_id) throw new Error("Invalid onboarding step")
    const now = new Date().toISOString()
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
    if (error) throw new Error("Could not save progress")
    const nextStep = resolved.completableSteps[stepIndex + 1]
    let nextWorkItem: CanonicalStepWorkItem | null = null
    if (nextStep) {
        nextWorkItem = await findStepWorkItem(resolved.session.workspace_id, resolved.session.id, nextStep.key)
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
            if (startError) throw new Error("Could not start the next onboarding step")
        }
    }
    const upcomingStep = resolved.completableSteps[stepIndex + 2]
    if (upcomingStep && nextWorkItem) {
        const existingUpcoming = await findStepWorkItem(resolved.session.workspace_id, resolved.session.id, upcomingStep.key)
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
    await maybeCompleteOnboarding(resolved.session, resolved.workspace.slug)
    revalidateOnboarding(resolved.workspace.slug, resolved.session.relationship_id, token)
}

export async function submitCanonicalFormStep(token: string, stepKey: string, form: OnboardingFormDefinition, response: FormResponse) {
    const resolved = await getCanonicalSessionByToken(token)
    if (!resolved) throw new Error("Invalid onboarding session")
    const workItem = await findStepWorkItem(resolved.session.workspace_id, resolved.session.id, stepKey)
    if (!workItem) throw new Error("Unknown onboarding step")
    await saveSubmissionAsset({ session: resolved.session, stepKey, form, response, workItemId: workItem.id })
    await saveUploadAssets({ session: resolved.session, stepKey, response, workItemId: workItem.id })
    await completeCanonicalStep(token, stepKey)
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

type CreateRelationshipOnboardingInput = {
    workspaceId: string
    workspaceSlug: string
    relationshipId: string
    serviceKeys: string[]
    moduleKeys?: string[]
    projectTimeframeDays?: number | null
    isTest?: boolean
    createdBy?: string | null
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
}: CreateRelationshipOnboardingInput) {
    const now = new Date().toISOString()
    const selectedServices = serviceKeys.filter((serviceKey) => serviceKey in SERVICES)
    const selectedModules = [...new Set(moduleKeys?.length ? moduleKeys : getModuleKeysForServices(selectedServices))]
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
    const { data: session, error } = await supabaseAdmin
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
    if (error || !session) {
        await reportOnboardingFailure({ workspaceId, workspaceSlug, relationshipId, operation: "create_session", error: error?.message ?? "No onboarding session was returned" })
        throw new Error("create-session-failed")
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

    const steps = getOnboardingStepsForModules(selectedModules)
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

    return {
        id: session.id,
        relationshipId,
        sessionToken: session.session_token,
        onboardingUrl: `/onboarding/session/${session.session_token}`,
    }
}

export function assetLocation(workspaceSlug: string, assetId: string) {
    return assetHref(workspaceSlug, assetId)
}

export function stepLocation(workspaceSlug: string, workItemId: string | null | undefined, relationshipId: string) {
    return workItemId ? workItemHref(workspaceSlug, workItemId) : onboardingDetailHref(workspaceSlug, relationshipId)
}
