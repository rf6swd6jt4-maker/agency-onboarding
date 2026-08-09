import { createAndSendStripeInvoice } from "@/lib/stripe/api"
import { getWorkspaceProviderConfig } from "@/lib/workspace-integrations"
import { SERVICES } from "@/lib/onboarding/services"
import { supabaseAdmin } from "@/lib/supabase/admin"
import type { RelationshipPhase } from "@/lib/relationship-phases"
import { normalizeMessageAddress } from "@/lib/client-messages/addresses"
import { recordAdminActivity } from "@/lib/admin/activity"

type WorkflowRole = "task" | "lifecycle_stage" | "service_group" | "review" | "automation"
type StagePhase = Exclude<RelationshipPhase, "nurturing" | "completed_lost">

const STAGES: Record<StagePhase, { title: string; action?: string; completionMode?: "manual" | "all_required_children" }> = {
    lead: { title: "Make Contact", action: "move_to_potential_client" },
    potential_client: { title: "Sell Client", action: "send_invoice" },
    invoiced: { title: "Collect Payment", action: "await_payment" },
    onboarding: { title: "Onboard Client", action: "await_onboarding", completionMode: "all_required_children" },
    onboarding_review: { title: "Review Onboarding Information", action: "begin_fulfilment", completionMode: "all_required_children" },
    fulfilment: { title: "Fulfil Client", action: "begin_retention", completionMode: "all_required_children" },
    retention: { title: "Retain Client" },
}
const STAGE_SEQUENCE: StagePhase[] = ["lead", "potential_client", "invoiced", "onboarding", "onboarding_review", "fulfilment", "retention"]
function today() {
    return new Date().toISOString().slice(0, 10)
}

function addDays(date: string, days: number) {
    const value = new Date(`${date}T12:00:00Z`)
    value.setUTCDate(value.getUTCDate() + Math.max(0, days))
    return value.toISOString().slice(0, 10)
}

async function dependencyCompletionStart(workspaceId: string, workItemId: string) {
    const { data: edges } = await supabaseAdmin.from("work_item_dependencies")
        .select("depends_on_work_item_id")
        .eq("workspace_id", workspaceId)
        .eq("work_item_id", workItemId)
    const predecessorIds = (edges ?? []).map((edge) => edge.depends_on_work_item_id)
    if (!predecessorIds.length) return null
    const { data: predecessors } = await supabaseAdmin.from("work_items")
        .select("actual_completed_at")
        .eq("workspace_id", workspaceId)
        .in("id", predecessorIds)
        .not("actual_completed_at", "is", null)
    return (predecessors ?? []).map((item) => item.actual_completed_at).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null
}

async function markWorkflowItemStarted(workspaceId: string, workItemId: string, fallback?: string) {
    const { data: item, error } = await supabaseAdmin.from("work_items")
        .select("actual_start_at, created_at")
        .eq("workspace_id", workspaceId).eq("id", workItemId).maybeSingle()
    if (error) throw new Error(error.message)
    if (!item || item.actual_start_at) return item?.actual_start_at ?? null
    const actualStartAt = await dependencyCompletionStart(workspaceId, workItemId) ?? fallback ?? item.created_at ?? new Date().toISOString()
    const { error: updateError } = await supabaseAdmin.from("work_items").update({
        actual_start_at: actualStartAt,
        actual_start_has_time: true,
    }).eq("workspace_id", workspaceId).eq("id", workItemId).is("actual_start_at", null)
    if (updateError) throw new Error(updateError.message)
    return actualStartAt
}

async function completeWorkflowItem(workspaceId: string, workItemId: string, completedAt = new Date().toISOString()) {
    await markWorkflowItemStarted(workspaceId, workItemId, completedAt)
    return supabaseAdmin.from("work_items").update({
        status: "done",
        actual_completed_at: completedAt,
        actual_completed_has_time: true,
    }).eq("workspace_id", workspaceId).eq("id", workItemId)
}

async function repairRelationshipWorkflowTimings(workspaceId: string, relationshipId: string) {
    const { data: links } = await supabaseAdmin.from("work_item_relationships")
        .select("work_item_id").eq("workspace_id", workspaceId).eq("relationship_id", relationshipId)
    const ids = (links ?? []).map((link) => link.work_item_id)
    if (!ids.length) return
    const { data: items, error } = await supabaseAdmin.from("work_items")
        .select("id, status, workflow_role, native_kind, planned_start_date, actual_start_at, actual_start_has_time, actual_completed_at, actual_completed_has_time, created_at")
        .eq("workspace_id", workspaceId).in("id", ids).eq("native_kind", "relationship_workflow")
    if (error) throw new Error(error.message)
    for (const item of items ?? []) {
        if (item.workflow_role === "lifecycle_stage" && !item.actual_start_at && (item.status === "done" || item.planned_start_date)) await markWorkflowItemStarted(workspaceId, item.id)
        if (item.workflow_role === "lifecycle_stage" && item.status === "done" && item.actual_completed_at && !item.actual_completed_has_time) {
            const { error: flagError } = await supabaseAdmin.from("work_items").update({ actual_completed_has_time: true })
                .eq("workspace_id", workspaceId).eq("id", item.id).eq("actual_completed_at", item.actual_completed_at)
            if (flagError) throw new Error(flagError.message)
        }
    }
}

async function linkItems(workspaceId: string, relationshipId: string, itemIds: string[]) {
    if (!itemIds.length) return
    const { error } = await supabaseAdmin.from("work_item_relationships").upsert(itemIds.map((workItemId) => ({
        workspace_id: workspaceId,
        relationship_id: relationshipId,
        work_item_id: workItemId,
    })), { onConflict: "work_item_id,relationship_id" })
    if (error) throw new Error(error.message)
}

export async function createWorkflowItem(input: {
    workspaceId: string
    relationshipId: string
    title: string
    phase: string
    role: WorkflowRole
    completionMode?: "manual" | "all_required_children"
    action?: string | null
    parentId?: string | null
    assigneeId?: string | null
    startDate?: string | null
    dueDate?: string | null
    sortOrder?: number
    nativeKey: string
    description?: string | null
}) {
    const { data: existing } = await supabaseAdmin.from("work_items")
        .select("id, planned_start_date, due_date")
        .eq("workspace_id", input.workspaceId)
        .eq("native_kind", "relationship_workflow")
        .eq("native_key", input.nativeKey)
        .maybeSingle()
    const payload = {
        workspace_id: input.workspaceId,
        title: input.title,
        description: input.description ?? null,
        lifecycle_phase: input.phase,
        workflow_role: input.role,
        completion_mode: input.completionMode ?? "manual",
        workflow_action: input.action ?? null,
        parent_work_item_id: input.parentId ?? null,
        planned_start_date: existing?.planned_start_date ?? input.startDate ?? null,
        due_date: existing?.due_date ?? input.dueDate ?? null,
        native_kind: "relationship_workflow",
        native_key: input.nativeKey,
        sort_order: input.sortOrder ?? 0,
        metadata: { relationship_id: input.relationshipId, created_from: "relationship_workflow" },
    }
    const { data: item, error } = existing
        ? await supabaseAdmin.from("work_items").update(payload).eq("workspace_id", input.workspaceId).eq("id", existing.id).select("id").single()
        : await supabaseAdmin.from("work_items").insert(payload).select("id").single()
    if (error || !item) throw new Error(error?.message ?? "Could not create workflow work")
    await linkItems(input.workspaceId, input.relationshipId, [item.id])
    await supabaseAdmin.from("work_item_assignees").delete().eq("workspace_id", input.workspaceId).eq("work_item_id", item.id)
    if (input.assigneeId) {
        await supabaseAdmin.from("work_item_assignees").upsert({
            workspace_id: input.workspaceId,
            work_item_id: item.id,
            user_id: input.assigneeId,
        }, { onConflict: "work_item_id,user_id" })
    }
    return item.id as string
}

export async function ensureRelationshipStage(input: {
    workspaceId: string
    relationshipId: string
    phase: StagePhase
    assigneeId?: string | null
}) {
    const stage = STAGES[input.phase]
    const stageId = await createWorkflowItem({
        workspaceId: input.workspaceId,
        relationshipId: input.relationshipId,
        title: stage.title,
        phase: input.phase,
        role: "lifecycle_stage",
        action: stage.action ?? null,
        completionMode: stage.completionMode ?? "manual",
        assigneeId: input.assigneeId ?? null,
        startDate: today(),
        nativeKey: `${input.relationshipId}:${input.phase}`,
    })
    await markWorkflowItemStarted(input.workspaceId, stageId)
    await ensureNextLifecycleStage({ workspaceId: input.workspaceId, relationshipId: input.relationshipId, phase: input.phase, stageId })
    return stageId
}

async function ensureNextLifecycleStage(input: { workspaceId: string; relationshipId: string; phase: StagePhase; stageId: string }) {
    const nextPhase = STAGE_SEQUENCE[STAGE_SEQUENCE.indexOf(input.phase) + 1]
    if (!nextPhase) return null
    const nextStage = STAGES[nextPhase]
    const nextStageId = await createWorkflowItem({
        workspaceId: input.workspaceId,
        relationshipId: input.relationshipId,
        title: nextStage.title,
        phase: nextPhase,
        role: "lifecycle_stage",
        action: nextStage.action ?? null,
        completionMode: nextStage.completionMode ?? "manual",
        nativeKey: `${input.relationshipId}:${nextPhase}`,
    })
    const { error } = await supabaseAdmin.from("work_item_dependencies").upsert({
        workspace_id: input.workspaceId,
        work_item_id: nextStageId,
        depends_on_work_item_id: input.stageId,
        source: "manual",
    }, { onConflict: "work_item_id,depends_on_work_item_id" })
    if (error) throw new Error(error.message)
    return nextStageId
}

export async function ensureCurrentRelationshipStage(input: {
    workspaceId: string
    relationshipId: string
    phase: RelationshipPhase
    assigneeId?: string | null
}) {
    if (input.phase === "nurturing" || input.phase === "completed_lost") return null
    const [{ data: links }, { data: items }] = await Promise.all([
        supabaseAdmin.from("work_item_relationships").select("work_item_id")
            .eq("workspace_id", input.workspaceId).eq("relationship_id", input.relationshipId),
        supabaseAdmin.from("work_items").select("id, lifecycle_phase, workflow_role")
            .eq("workspace_id", input.workspaceId).eq("workflow_role", "lifecycle_stage"),
    ])
    const linkedIds = new Set((links ?? []).map((link) => link.work_item_id))
    const existing = (items ?? []).find((item) => linkedIds.has(item.id) && item.lifecycle_phase === input.phase)
    if (existing) {
        await ensureNextLifecycleStage({ workspaceId: input.workspaceId, relationshipId: input.relationshipId, phase: input.phase, stageId: existing.id })
        await repairRelationshipWorkflowTimings(input.workspaceId, input.relationshipId)
        return existing.id
    }
    const stageId = await ensureRelationshipStage({
        workspaceId: input.workspaceId,
        relationshipId: input.relationshipId,
        phase: input.phase,
        assigneeId: input.assigneeId,
    })
    await repairRelationshipWorkflowTimings(input.workspaceId, input.relationshipId)
    return stageId
}

export async function ensureSalesStage(input: { workspaceId: string; relationshipId: string; sellerId: string | null }) {
    return ensureRelationshipStage({ ...input, phase: "potential_client", assigneeId: input.sellerId })
}

export async function completePaymentStage(input: { workspaceId: string; relationshipId: string }) {
    const stageId = await ensureRelationshipStage({ ...input, phase: "invoiced" })
    const { error } = await completeWorkflowItem(input.workspaceId, stageId)
    if (error) throw new Error(error.message)
}

async function moveRelationshipToStage(input: {
    workspaceId: string
    relationshipId: string
    phase: StagePhase
    assigneeId?: string | null
}) {
    const { data: relationship } = await supabaseAdmin.from("relationships")
        .select("seller_user_id")
        .eq("workspace_id", input.workspaceId).eq("id", input.relationshipId).maybeSingle()
    await supabaseAdmin.from("relationships").update({ lifecycle_phase: input.phase, updated_at: new Date().toISOString() })
        .eq("workspace_id", input.workspaceId).eq("id", input.relationshipId)
    return ensureRelationshipStage({ ...input, assigneeId: input.assigneeId ?? relationship?.seller_user_id ?? null })
}

export async function createOnboardingReviewWork(input: {
    workspaceId: string
    workspaceSlug: string
    relationshipId: string
    sessionId: string
}) {
    const [{ data: relationship }, { data: session }] = await Promise.all([
        supabaseAdmin.from("relationships")
            .select("fulfilment_manager_user_id")
            .eq("workspace_id", input.workspaceId).eq("id", input.relationshipId).maybeSingle(),
        supabaseAdmin.from("relationship_onboarding_sessions")
            .select("created_by")
            .eq("workspace_id", input.workspaceId).eq("id", input.sessionId).maybeSingle(),
    ])
    // Until a delivery manager is assigned, the person who initiated the
    // onboarding owns its review. This keeps the review sequence actionable
    // for the first clients without bypassing the eventual team assignment.
    const reviewerId = relationship?.fulfilment_manager_user_id ?? session?.created_by ?? null
    const reviewId = await ensureRelationshipStage({
        workspaceId: input.workspaceId,
        relationshipId: input.relationshipId,
        phase: "onboarding_review",
        assigneeId: reviewerId,
    })
    const { data: submitted } = await supabaseAdmin.from("work_items")
        .select("id, title, sort_order")
        .eq("workspace_id", input.workspaceId)
        .eq("native_kind", "onboarding_step")
        .like("native_key", `${input.sessionId}:%`)
        .eq("status", "done")
        .order("sort_order")

    let previousId: string | null = null
    for (const [index, step] of (submitted ?? []).entries()) {
        const reviewStepId = await createWorkflowItem({
            workspaceId: input.workspaceId,
            relationshipId: input.relationshipId,
            title: `Review ${step.title}`,
            phase: "onboarding_review",
            role: "review",
            parentId: reviewId,
            assigneeId: reviewerId,
            nativeKey: `${input.relationshipId}:onboarding-review:${input.sessionId}:${step.id}`,
            sortOrder: index * 10,
            startDate: today(),
            description: "Review the submitted onboarding information before fulfilment begins.",
        })
        if (previousId) {
            await supabaseAdmin.from("work_item_dependencies").upsert({
                workspace_id: input.workspaceId,
                work_item_id: reviewStepId,
                depends_on_work_item_id: previousId,
                source: "manual",
            }, { onConflict: "work_item_id,depends_on_work_item_id" })
        }
        previousId = reviewStepId
    }
    await supabaseAdmin.from("relationships").update({ lifecycle_phase: "onboarding_review", updated_at: new Date().toISOString() })
        .eq("workspace_id", input.workspaceId).eq("id", input.relationshipId)
    return reviewId
}

async function serviceRows(workspaceId: string, relationshipId: string) {
    const { data, error } = await supabaseAdmin.from("relationship_services")
        .select("service_key, assignee_user_id")
        .eq("workspace_id", workspaceId).eq("relationship_id", relationshipId)
        .order("created_at")
    if (error) throw new Error(error.message)
    return data ?? []
}

async function setRelationshipFulfilmentPhase(workspaceId: string, relationshipId: string) {
    const { error } = await supabaseAdmin.from("relationships")
        .update({ lifecycle_phase: "fulfilment", updated_at: new Date().toISOString() })
        .eq("workspace_id", workspaceId)
        .eq("id", relationshipId)
    if (error) throw new Error(`Could not enter fulfilment: ${error.message}`)
}

async function existingFulfilmentPlan(input: { workspaceId: string; relationshipId: string }) {
    const { data: stage, error: stageError } = await supabaseAdmin.from("work_items")
        .select("id")
        .eq("workspace_id", input.workspaceId)
        .eq("native_kind", "relationship_workflow")
        .eq("native_key", `${input.relationshipId}:fulfilment`)
        .maybeSingle()
    if (stageError) throw new Error(stageError.message)
    if (!stage) return null

    const services = await serviceRows(input.workspaceId, input.relationshipId)
    const { count, error: groupsError } = await supabaseAdmin.from("work_items")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", input.workspaceId)
        .eq("parent_work_item_id", stage.id)
        .eq("workflow_role", "service_group")
    if (groupsError) throw new Error(groupsError.message)
    return count === services.length ? stage.id : null
}

export async function createFulfilmentWork(input: {
    workspaceId: string
    relationshipId: string
    managerId: string
    timeframeDays: number | null
}) {
    const startDate = today()
    const timeframe = Math.max(1, input.timeframeDays ?? 30)
    const dueDate = addDays(startDate, timeframe - 1)
    const stageId = await createWorkflowItem({
        workspaceId: input.workspaceId,
        relationshipId: input.relationshipId,
        title: STAGES.fulfilment.title,
        phase: "fulfilment",
        role: "lifecycle_stage",
        completionMode: "all_required_children",
        action: STAGES.fulfilment.action,
        assigneeId: input.managerId,
        startDate,
        dueDate,
        nativeKey: `${input.relationshipId}:fulfilment`,
    })
    await ensureNextLifecycleStage({ workspaceId: input.workspaceId, relationshipId: input.relationshipId, phase: "fulfilment", stageId })
    const services = await serviceRows(input.workspaceId, input.relationshipId)
    let serviceIndex = 0
    for (const service of services) {
        const definition = SERVICES[service.service_key]
        const serviceId = await createWorkflowItem({
            workspaceId: input.workspaceId,
            relationshipId: input.relationshipId,
            title: definition?.title ?? service.service_key,
            phase: "fulfilment",
            role: "service_group",
            completionMode: "all_required_children",
            parentId: stageId,
            assigneeId: service.assignee_user_id,
            startDate,
            dueDate,
            nativeKey: `${input.relationshipId}:fulfilment:${service.service_key}`,
            sortOrder: serviceIndex++ * 10,
        })
        let previousStepId: string | null = null
        const steps = definition?.sopSteps?.length ? definition.sopSteps : [{ key: "complete", title: `Complete ${definition?.title ?? service.service_key}`, description: "Complete this service's delivery work." }]
        for (const [stepIndex, step] of steps.entries()) {
            const stepDays = Math.max(1, Math.floor(Math.max(1, timeframe) / Math.max(1, steps.length)))
            const stepId = await createWorkflowItem({
                workspaceId: input.workspaceId,
                relationshipId: input.relationshipId,
                title: step.title,
                description: step.description,
                phase: "fulfilment",
                role: "task",
                parentId: serviceId,
                assigneeId: service.assignee_user_id,
                startDate: addDays(startDate, stepIndex * stepDays),
                dueDate: stepIndex === steps.length - 1 ? dueDate : addDays(startDate, (stepIndex + 1) * stepDays - 1),
                nativeKey: `${input.relationshipId}:fulfilment:${service.service_key}:${step.key}`,
                sortOrder: stepIndex * 10,
            })
            if (previousStepId) await supabaseAdmin.from("work_item_dependencies").upsert({
                workspace_id: input.workspaceId, work_item_id: stepId, depends_on_work_item_id: previousStepId, source: "manual",
            }, { onConflict: "work_item_id,depends_on_work_item_id" })
            previousStepId = stepId
        }
    }
    await setRelationshipFulfilmentPhase(input.workspaceId, input.relationshipId)
    return stageId
}

export async function beginRelationshipFulfilment(input: { workspaceId: string; relationshipId: string }) {
    const { data: relationship } = await supabaseAdmin.from("relationships")
        .select("fulfilment_manager_user_id, project_timeframe_days")
        .eq("workspace_id", input.workspaceId).eq("id", input.relationshipId).maybeSingle()
    if (!relationship?.fulfilment_manager_user_id) throw new Error("Choose a fulfilment manager before completing onboarding review")
    const existingPlanId = await existingFulfilmentPlan(input)
    if (existingPlanId) {
        await setRelationshipFulfilmentPhase(input.workspaceId, input.relationshipId)
        return existingPlanId
    }
    return createFulfilmentWork({
        workspaceId: input.workspaceId,
        relationshipId: input.relationshipId,
        managerId: relationship.fulfilment_manager_user_id,
        timeframeDays: relationship.project_timeframe_days,
    })
}

async function assertRequiredChildrenCompleted(input: { workspaceId: string; workItemId: string }) {
    const { data: children, error } = await supabaseAdmin.from("work_items")
        .select("status, workflow_required")
        .eq("workspace_id", input.workspaceId)
        .eq("parent_work_item_id", input.workItemId)
    if (error) throw new Error(error.message)
    const requiredChildren = (children ?? []).filter((child) => child.workflow_required)
    if (requiredChildren.some((child) => child.status !== "done")) {
        throw new Error("Complete every required review work item before moving to fulfilment")
    }
}

export async function completeWorkflowParents(input: { workspaceId: string; relationshipId: string; workItemId: string }) {
    let childId: string | null = input.workItemId
    while (childId) {
        const childResult = await supabaseAdmin.from("work_items").select("parent_work_item_id").eq("id", childId).maybeSingle()
        const child = childResult.data as { parent_work_item_id: string | null } | null
        const parentId = child?.parent_work_item_id ?? null
        if (!parentId) return
        const { data: parent } = await supabaseAdmin.from("work_items")
            .select("id, completion_mode, workflow_action, status")
            .eq("workspace_id", input.workspaceId).eq("id", parentId).maybeSingle()
        if (!parent || parent.completion_mode !== "all_required_children" || parent.status === "done") return
        const { data: children } = await supabaseAdmin.from("work_items")
            .select("status, workflow_required").eq("workspace_id", input.workspaceId).eq("parent_work_item_id", parentId)
        if (!(children ?? []).filter((item) => item.workflow_required).every((item) => item.status === "done")) return
        const { error } = await completeWorkflowItem(input.workspaceId, parentId)
        if (error) throw new Error(error.message)
        if (parent.workflow_action === "begin_fulfilment") {
            await beginRelationshipFulfilment({ workspaceId: input.workspaceId, relationshipId: input.relationshipId })
        }
        if (parent.workflow_action === "begin_retention") {
            await moveRelationshipToStage({ workspaceId: input.workspaceId, relationshipId: input.relationshipId, phase: "retention" })
        }
        childId = parentId
    }
}

export async function sendRelationshipInvoice(input: {
    workspaceId: string
    relationshipId: string
    workItemId: string
    actorId: string
}) {
    const [{ data: relationship }, { data: services }] = await Promise.all([
        supabaseAdmin.from("relationships").select("primary_person_name, primary_email, primary_phone, whatsapp_phone, business_name, project_timeframe_days").eq("workspace_id", input.workspaceId).eq("id", input.relationshipId).single(),
        supabaseAdmin.from("relationship_services").select("service_key, price_cents, currency").eq("workspace_id", input.workspaceId).eq("relationship_id", input.relationshipId),
    ])
    const selectedServices = services ?? []
    const lineItems = selectedServices.filter((service) => typeof service.price_cents === "number" && service.price_cents > 0).map((service) => ({
        serviceKey: service.service_key,
        description: SERVICES[service.service_key]?.title ?? service.service_key,
        amount: service.price_cents,
    }))
    if (!relationship || !relationship.primary_email || !relationship.whatsapp_phone || !selectedServices.length || lineItems.length !== selectedServices.length) throw new Error("Add a billing email, WhatsApp phone, and a positive price for every selected service before sending the invoice")
    const currency = selectedServices[0]?.currency ?? "usd"
    // Validate the integration before creating a sale record. This keeps a missing
    // or disconnected Stripe setup from leaving a retryable-looking draft behind.
    const config = await getWorkspaceProviderConfig(input.workspaceId, "stripe")
    const { data: sale, error: saleError } = await supabaseAdmin.from("client_sales").insert({
        workspace_id: input.workspaceId,
        relationship_id: input.relationshipId,
        client_name: relationship.business_name ?? relationship.primary_person_name,
        client_email: relationship.primary_email,
        client_phone: normalizeMessageAddress(relationship.whatsapp_phone),
        service_keys: lineItems.map((item) => item.serviceKey),
        line_items: lineItems,
        project_timeframe_days: relationship.project_timeframe_days,
        currency,
        total_amount: lineItems.reduce((total, item) => total + item.amount, 0),
        status: "draft",
        created_by: input.actorId,
    }).select("id").single()
    if (saleError || !sale) throw new Error(saleError?.message ?? "Could not create invoice record")
    const invoice = await createAndSendStripeInvoice({
        saleId: sale.id,
        name: relationship.business_name ?? relationship.primary_person_name,
        email: relationship.primary_email,
        phone: relationship.whatsapp_phone,
        currency,
        lineItems,
        serviceKeys: lineItems.map((item) => item.serviceKey),
        projectTimeframeDays: relationship.project_timeframe_days,
        daysUntilDue: 7,
        secretKey: config.secret_key,
    })
    await recordAdminActivity({ workspaceId: input.workspaceId, category: "billing", eventKey: "stripe.invoice.sent", summary: "Stripe invoice sent", entityType: "stripe_invoice", entityId: invoice.invoiceId, direction: "outbound", actorUserId: input.actorId, metadata: { relationship_id: input.relationshipId, sale_id: sale.id } })
    await Promise.all([
        supabaseAdmin.from("client_sales").update({ status: "invoice_sent", stripe_customer_id: invoice.customerId, stripe_invoice_id: invoice.invoiceId, stripe_invoice_status: invoice.invoiceStatus, stripe_hosted_invoice_url: invoice.hostedInvoiceUrl, stripe_invoice_pdf: invoice.invoicePdf, raw_payload: invoice.rawInvoice }).eq("id", sale.id),
        completeWorkflowItem(input.workspaceId, input.workItemId),
    ])
    await moveRelationshipToStage({ workspaceId: input.workspaceId, relationshipId: input.relationshipId, phase: "invoiced" })
}

export async function advanceRelationshipWorkflow(input: { workspaceId: string; relationshipId: string; workItemId: string; action: string | null; actorId: string }) {
    const complete = () => completeWorkflowItem(input.workspaceId, input.workItemId)
    if (input.action === "move_to_potential_client") {
        const { error } = await complete()
        if (error) throw new Error(error.message)
        await moveRelationshipToStage({ workspaceId: input.workspaceId, relationshipId: input.relationshipId, phase: "potential_client", assigneeId: input.actorId })
        return
    }
    if (input.action === "begin_fulfilment") {
        await assertRequiredChildrenCompleted({ workspaceId: input.workspaceId, workItemId: input.workItemId })
        const { error } = await complete()
        if (error) throw new Error(error.message)
        await beginRelationshipFulfilment({ workspaceId: input.workspaceId, relationshipId: input.relationshipId })
        return
    }
    if (input.action === "begin_retention") {
        const { error } = await complete()
        if (error) throw new Error(error.message)
        await moveRelationshipToStage({ workspaceId: input.workspaceId, relationshipId: input.relationshipId, phase: "retention" })
        return
    }
    const { error } = await complete()
    if (error) throw new Error(error.message)
    await completeWorkflowParents(input)
}

export async function currentRelationshipWork(input: { workspaceId: string; relationshipId: string; userId: string; isManager: boolean }) {
    const [{ data: links }, { data: assignments }, { data: dependencies }] = await Promise.all([
        supabaseAdmin.from("work_item_relationships").select("work_item_id, work_items!work_item_relationships_work_item_id_fkey(id, title, status, workflow_role, workflow_action, parent_work_item_id, sort_order)").eq("workspace_id", input.workspaceId).eq("relationship_id", input.relationshipId),
        supabaseAdmin.from("work_item_assignees").select("work_item_id, user_id").eq("workspace_id", input.workspaceId),
        supabaseAdmin.from("work_item_dependencies").select("work_item_id, depends_on_work_item_id").eq("workspace_id", input.workspaceId),
    ])
    const items = (links ?? []).flatMap((link) => {
        const item = Array.isArray(link.work_items) ? link.work_items[0] : link.work_items
        return item ? [item as { id: string; title: string; status: string; workflow_role: WorkflowRole; workflow_action: string | null; parent_work_item_id: string | null; sort_order: number }] : []
    })
    const ids = new Set(items.map((item) => item.id))
    const assignees = new Map<string, string[]>()
    for (const row of assignments ?? []) if (ids.has(row.work_item_id)) assignees.set(row.work_item_id, [...(assignees.get(row.work_item_id) ?? []), row.user_id])
    const completed = new Set(items.filter((item) => item.status === "done" || item.status === "canceled").map((item) => item.id))
    const blockedByDependency = new Set((dependencies ?? []).filter((edge) => ids.has(edge.work_item_id) && !completed.has(edge.depends_on_work_item_id)).map((edge) => edge.work_item_id))
    const mine = items.filter((item) => assignees.get(item.id)?.includes(input.userId) && !completed.has(item.id)).sort((a, b) => a.sort_order - b.sort_order)
    const stage = mine.find((item) => item.workflow_role === "lifecycle_stage")
    const ready = mine.find((item) => item.workflow_role !== "lifecycle_stage" && !blockedByDependency.has(item.id))
    const selected = ready ?? stage ?? (input.isManager ? items.find((item) => item.workflow_role === "lifecycle_stage" && !completed.has(item.id)) ?? items.find((item) => item.workflow_role === "service_group" && !assignees.get(item.id)?.length && !completed.has(item.id)) : null)
    if (!selected) return null
    const unassignedCount = input.isManager ? items.filter((item) => item.workflow_role === "service_group" && !assignees.get(item.id)?.length && !completed.has(item.id)).length : 0
    return { id: selected.id, title: selected.title, action: selected.workflow_action, role: selected.workflow_role, status: selected.status, unassignedCount, blocked: blockedByDependency.has(selected.id) }
}
