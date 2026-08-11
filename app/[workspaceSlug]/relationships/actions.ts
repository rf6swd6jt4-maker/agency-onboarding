"use server"

import { randomUUID } from "crypto"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createOnboardingClient } from "@/lib/onboarding/client-creation"
import { platformFailureFingerprint, reportPlatformFailure } from "@/lib/admin/maintenance"
import { loadPublishedOnboardingConfiguration } from "@/lib/onboarding/configuration"
import {
    assetHref,
    normalizeRelationshipPhase,
    relationshipHubHref,
    workItemHref,
    workspaceHref,
    type RelationshipPhase,
} from "@/lib/relationships"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import { advanceRelationshipWorkflow, ensureRelationshipStage, ensureSalesStage, sendRelationshipInvoice } from "@/lib/relationship-workflow"
import { getWorkspaceProviderConfig } from "@/lib/workspace-integrations"
import { voidStripeInvoice } from "@/lib/stripe/api"
import { WORKSPACE_TAB_FRAME_PARAM, workspaceTabFrameUrl } from "@/lib/workspace-tabs"

const creatablePhases = new Set<RelationshipPhase>([
    "lead",
    "nurturing",
    "potential_client",
    "invoiced",
    "onboarding",
    "onboarding_review",
    "fulfilment",
    "retention",
    "completed_lost",
])
const creatableAssetKinds = new Set(["file", "media", "document"])

export type WorkspaceCreateActionState = {
    ok: boolean
    href?: string
    error?: string
}

function formString(formData: FormData, key: string) {
    return String(formData.get(key) ?? "").trim()
}

function nullableFormString(formData: FormData, key: string) {
    const value = formString(formData, key)
    return value || null
}

function relationshipRevalidatePaths(slug: string, relationshipId?: string) {
    revalidatePath(workspaceHref(slug, "relationships"))
    revalidatePath(workspaceHref(slug, "onboarding"))
    revalidatePath(workspaceHref(slug, "work"))
    if (relationshipId) {
        revalidatePath(relationshipHubHref(slug, relationshipId))
    }
}

export async function createRelationship(slug: string, formData: FormData) {
    const result = await createRelationshipFromModal(slug, formData)
    if (!result.ok) redirect(workspaceHref(slug, `relationships?error=${result.error ?? "create-failed"}`))
    redirect(result.href ?? workspaceHref(slug, "relationships"))
}

export async function createRelationshipFromModal(slug: string, formData: FormData): Promise<WorkspaceCreateActionState> {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    const primaryPersonName = formString(formData, "primary_person_name")
    const businessName = nullableFormString(formData, "business_name")
    const phase = normalizeRelationshipPhase(formString(formData, "lifecycle_phase"))
    const isTest = formData.get("is_test") === "on"

    if (!primaryPersonName || !creatablePhases.has(phase)) {
        return { ok: false, error: "missing-fields" }
    }
    if (phase === "onboarding" && !isTest) return { ok: false, error: "payment-required" }

    const { data: relationship, error } = await supabaseAdmin
        .from("relationships")
        .insert({
            workspace_id: workspace.id,
            source_type: "manual",
            primary_person_name: primaryPersonName,
            primary_email: nullableFormString(formData, "primary_email"),
            primary_phone: nullableFormString(formData, "primary_phone"),
            whatsapp_phone: nullableFormString(formData, "whatsapp_phone"),
            business_name: businessName,
            website_url: nullableFormString(formData, "website_url"),
            industry_value: nullableFormString(formData, "industry_value"),
            location_value: nullableFormString(formData, "location_value"),
            source_label: nullableFormString(formData, "source_label") ?? "Manual",
            primary_contact_role: nullableFormString(formData, "primary_contact_role"),
            notes_summary: nullableFormString(formData, "notes_summary"),
            lifecycle_phase: phase,
            status: phase === "completed_lost" ? "lost" : "active",
            source_metadata: {
                created_from: "manual_relationship_form",
                created_by: user.id,
                is_test: isTest,
            },
        })
        .select("id")
        .single()

    if (error || !relationship) {
        return { ok: false, error: "create-failed" }
    }

    try {
        if (phase === "onboarding") {
            await createOnboardingClient({
                workspaceId: workspace.id,
                workspaceSlug: workspace.slug,
                customOnboardingDomain: workspace.custom_onboarding_domain,
                customOnboardingDomainVerified: workspace.custom_onboarding_domain_status === "verified",
                relationshipId: relationship.id,
                name: businessName ?? primaryPersonName,
                email: nullableFormString(formData, "primary_email"),
                phone: nullableFormString(formData, "primary_phone") ?? "",
                serviceKeys: [],
                createClickUpResources: false,
                createOnboardingWork: false,
                activitySource: "Relationship manual creation",
                createdBy: user.id,
                isTest,
            })
        } else if (!["nurturing", "completed_lost"].includes(phase)) {
            await ensureRelationshipStage({ workspaceId: workspace.id, relationshipId: relationship.id, phase: phase as Exclude<RelationshipPhase, "nurturing" | "completed_lost">, assigneeId: user.id })
        }
    } catch {
        await supabaseAdmin.from("relationships").delete().eq("workspace_id", workspace.id).eq("id", relationship.id)
        return { ok: false, error: "workflow-create-failed" }
    }

    relationshipRevalidatePaths(slug, relationship.id)

    return { ok: true, href: relationshipHubHref(slug, relationship.id) }
}

function priceCents(value: string) {
    const amount = Number(value)
    return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0
}

function currencyCode(value: string) {
    const currency = value.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Use a three-letter currency code, such as USD")
    return currency
}

export async function saveRelationshipCommercialDetails(slug: string, relationshipId: string, formData: FormData) {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    const serviceKeys = [...new Set(formData.getAll("service_key").map(String).filter(Boolean))]
    const sellerId = nullableFormString(formData, "seller_user_id")
    const managerId = nullableFormString(formData, "fulfilment_manager_user_id")
    const whatsappPhone = nullableFormString(formData, "whatsapp_phone")
    const timeframe = Number(formData.get("project_timeframe_days") ?? 0)
    const [{ data: relationship, error: relationshipError }, existingServicesResult, { data: frozenSales }, configuration] = await Promise.all([
        supabaseAdmin.from("relationships").select("lifecycle_phase").eq("workspace_id", workspace.id).eq("id", relationshipId).maybeSingle(),
        supabaseAdmin.from("relationship_services").select("service_key, service_id, service_revision_id, price_cents, currency, assignee_user_id").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId),
        supabaseAdmin.from("client_sales").select("id, status").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).in("status", [
            "invoice_sent", "payment_failed", "paid", "test_paid", "paid_consent_template_sending", "paid_awaiting_whatsapp_confirm",
            "paid_consent_template_failed", "whatsapp_confirmed", "onboarding_created", "onboarding_link_sent", "onboarding_link_failed",
        ]).limit(1),
        loadPublishedOnboardingConfiguration(workspace.id),
    ])
    if (relationshipError || !relationship) throw new Error(relationshipError?.message ?? "Relationship not found")
    let existingServices = existingServicesResult.data ?? []
    if (existingServicesResult.error) {
        if (existingServicesResult.error.code !== "42703" && !existingServicesResult.error.message.toLowerCase().includes("schema cache")) throw new Error(existingServicesResult.error.message)
        const legacy = await supabaseAdmin.from("relationship_services")
            .select("service_key, price_cents, currency, assignee_user_id")
            .eq("workspace_id", workspace.id).eq("relationship_id", relationshipId)
        if (legacy.error) throw new Error(legacy.error.message)
        existingServices = (legacy.data ?? []).map((service) => ({ ...service, service_id: null, service_revision_id: null }))
    }
    const existingByKey = new Map((existingServices ?? []).map((service) => [service.service_key, service]))
    const catalogueByCode = new Map(configuration.services.map((service) => [service.code, service]))
    const submittedPrices = new Map(serviceKeys.map((serviceKey) => [serviceKey, priceCents(formString(formData, `service_price_${serviceKey}`))]))
    const submittedCurrencies = new Map(serviceKeys.map((serviceKey) => [serviceKey, currencyCode(formString(formData, `service_currency_${serviceKey}`) || catalogueByCode.get(serviceKey)?.currency || existingByKey.get(serviceKey)?.currency || "USD")]))
    const existingPrices = new Map((existingServices ?? []).map((service) => [service.service_key, Number(service.price_cents) || 0]))
    const existingCurrencies = new Map((existingServices ?? []).map((service) => [service.service_key, String(service.currency ?? "USD").toUpperCase()]))
    const commercialChanged = serviceKeys.length !== existingPrices.size || serviceKeys.some((serviceKey) => (
        existingPrices.get(serviceKey) !== submittedPrices.get(serviceKey)
        || existingCurrencies.get(serviceKey) !== submittedCurrencies.get(serviceKey)
    ))
    if (frozenSales?.length && commercialChanged) throw new Error("Void and replace the sent invoice before changing services or negotiated prices")

    for (const serviceKey of serviceKeys) {
        const existing = existingByKey.get(serviceKey)
        const catalogue = catalogueByCode.get(serviceKey)
        if (configuration.schemaReady && !existing && (!catalogue || catalogue.state !== "active" || !catalogue.revisionId)) {
            throw new Error(`${serviceKey} is not a current Active service and cannot be added to this relationship`)
        }
        const postedServiceId = nullableFormString(formData, `service_id_${serviceKey}`)
        const postedRevisionId = nullableFormString(formData, `service_revision_id_${serviceKey}`)
        const expectedServiceId = existing?.service_id ?? catalogue?.id ?? null
        const expectedRevisionId = existing?.service_revision_id ?? catalogue?.revisionId ?? null
        if (configuration.schemaReady && (
            (postedServiceId && postedServiceId !== expectedServiceId)
            || (postedRevisionId && postedRevisionId !== expectedRevisionId)
        )) throw new Error(`The selected revision for ${serviceKey} changed. Reload and review the deal before saving`)
    }
    const versionedRows = serviceKeys.map((serviceKey) => {
        const existing = existingByKey.get(serviceKey)
        const service = catalogueByCode.get(serviceKey)
        const serviceId = existing?.service_id ?? service?.id ?? null
        const serviceRevisionId = existing?.service_revision_id ?? service?.revisionId ?? null
        return {
            workspace_id: workspace.id,
            relationship_id: relationshipId,
            service_key: serviceKey,
            price_cents: submittedPrices.get(serviceKey) ?? 0,
            currency: submittedCurrencies.get(serviceKey) ?? "USD",
            assignee_user_id: nullableFormString(formData, `service_assignee_${serviceKey}`),
            ...(configuration.schemaReady && serviceId && serviceRevisionId ? { service_id: serviceId, service_revision_id: serviceRevisionId } : {}),
        }
    })
    let savedTransactionally = false
    if (configuration.schemaReady) {
        const { error: rpcError } = await supabaseAdmin.rpc("save_relationship_commercial_configuration", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_relationship_id: relationshipId,
            p_details: {
                seller_user_id: sellerId,
                fulfilment_manager_user_id: managerId,
                whatsapp_phone: whatsappPhone,
                project_timeframe_days: Number.isFinite(timeframe) && timeframe > 0 ? Math.round(timeframe) : null,
            },
            p_services: versionedRows.map((row) => ({
                service_key: row.service_key,
                service_id: "service_id" in row ? row.service_id : null,
                service_revision_id: "service_revision_id" in row ? row.service_revision_id : null,
                price_cents: row.price_cents,
                currency: row.currency,
                assignee_user_id: row.assignee_user_id,
            })),
        })
        if (rpcError) {
            const missingRpc = rpcError.code === "42883" || rpcError.code === "PGRST202" || rpcError.message.toLowerCase().includes("schema cache")
            if (!missingRpc) throw new Error(rpcError.message)
        } else {
            savedTransactionally = true
        }
    }
    if (!savedTransactionally) {
        const { error } = await supabaseAdmin.from("relationships").update({
            seller_user_id: sellerId,
            fulfilment_manager_user_id: managerId,
            whatsapp_phone: whatsappPhone,
            project_timeframe_days: Number.isFinite(timeframe) && timeframe > 0 ? Math.round(timeframe) : null,
            updated_at: new Date().toISOString(),
        }).eq("workspace_id", workspace.id).eq("id", relationshipId)
        if (error) throw new Error(error.message)
        if (!frozenSales?.length) {
            const { error: deleteError } = await supabaseAdmin.from("relationship_services").delete().eq("workspace_id", workspace.id).eq("relationship_id", relationshipId)
            if (deleteError) throw new Error(deleteError.message)
        }
    }
    if (!savedTransactionally && !frozenSales?.length && versionedRows.length) {
        let { error: serviceError } = await supabaseAdmin.from("relationship_services").insert(versionedRows)
        if (serviceError?.code === "42703") {
            const legacyRows = versionedRows.map((row) => ({
                workspace_id: row.workspace_id,
                relationship_id: row.relationship_id,
                service_key: row.service_key,
                price_cents: row.price_cents,
                currency: row.currency,
                assignee_user_id: row.assignee_user_id,
            }))
            serviceError = (await supabaseAdmin.from("relationship_services").insert(legacyRows)).error
        }
        if (serviceError) throw new Error(serviceError.message)
    }
    if (relationship.lifecycle_phase === "potential_client") await ensureSalesStage({ workspaceId: workspace.id, relationshipId, sellerId })
    relationshipRevalidatePaths(slug, relationshipId)
}

export async function voidAndReopenRelationshipInvoice(slug: string, relationshipId: string, saleId: string): Promise<{ ok: boolean; error?: string }> {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        const { data: sale, error: saleError } = await supabaseAdmin.from("client_sales")
            .select("id, relationship_id, status, stripe_invoice_id, stripe_invoice_status, correlation_id, onboarding_session_id")
            .eq("workspace_id", workspace.id)
            .eq("relationship_id", relationshipId)
            .eq("id", saleId)
            .maybeSingle()
        if (saleError || !sale) throw new Error(saleError?.message ?? "Invoice not found")
        const alreadyVoided = sale.status === "invoice_inactive" && ["void", "voided"].includes(String(sale.stripe_invoice_status ?? "").toLowerCase())
        if (!sale.stripe_invoice_id || (!alreadyVoided && !["invoice_sent", "payment_failed"].includes(sale.status))) {
            return { ok: false, error: sale.onboarding_session_id || sale.status.startsWith("paid") ? "Paid or onboarding invoices cannot be voided from this deal." : "This invoice is no longer eligible to be voided." }
        }

        const correlationId = sale.correlation_id ?? randomUUID()
        const providerResult = alreadyVoided
            ? { invoiceId: sale.stripe_invoice_id, invoiceStatus: "void" }
            : await (async () => {
                const config = await getWorkspaceProviderConfig(workspace.id, "stripe")
                return voidStripeInvoice({
                    invoiceId: sale.stripe_invoice_id!,
                    secretKey: config.secret_key,
                    idempotencyKey: `${sale.id}:staff-void`,
                })
            })()
        const { error: reopenError } = await supabaseAdmin.rpc("reopen_voided_client_sale", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_relationship_id: relationshipId,
            p_sale_id: sale.id,
            p_correlation_id: correlationId,
            p_provider_summary: {
                invoice_id: providerResult.invoiceId,
                invoice_status: providerResult.invoiceStatus,
            },
        })
        if (reopenError) throw new Error(`Stripe voided the invoice, but Betelgeze could not reopen the deal: ${reopenError.message}`)
        relationshipRevalidatePaths(slug, relationshipId)
        return { ok: true }
    } catch (error) {
        const message = error instanceof Error ? error.message : "The invoice could not be voided."
        if (message.startsWith("Stripe voided the invoice")) return { ok: false, error: message }
        if (message.endsWith("is not connected for this workspace.")) return { ok: false, error: message }
        return { ok: false, error: "The invoice could not be voided in Stripe. Review the connection and invoice status, then try again." }
    }
}

type ArchiveRelationshipState = { error?: string }

export async function archiveRelationship(
    slug: string,
    relationshipId: string,
    _state: ArchiveRelationshipState,
    _formData: FormData,
): Promise<ArchiveRelationshipState> {
    void _state
    void _formData
    const { workspace, user } = await requireWorkspace(slug, "admin")
    const { data, error } = await supabaseAdmin.rpc("archive_workspace_relationship", {
        p_workspace_id: workspace.id,
        p_relationship_id: relationshipId,
        p_actor_user_id: user.id,
    })

    if (error) {
        const missingMigration = error.code === "42883" || error.code === "PGRST202" || error.message.toLowerCase().includes("schema cache")
        await reportPlatformFailure({
            workspaceId: workspace.id,
            category: "onboarding",
            source: "relationship_action",
            operation: "archive_relationship",
            fingerprint: platformFailureFingerprint(["relationship", "archive", error.code]),
            severity: "warning",
            summary: "A relationship could not be archived",
            diagnostics: { error_code: error.code },
            sourceHref: relationshipHubHref(slug, relationshipId),
            actorUserId: user.id,
        })
        return {
            error: missingMigration
                ? "The relationship archive database update has not been applied yet. Apply the latest migration, then try again."
                : "This relationship could not be archived. The failure was added to Admin Activity for investigation.",
        }
    }
    if (!data) return { error: "This relationship no longer exists." }

    relationshipRevalidatePaths(slug, relationshipId)
    const relationshipsHref = workspaceHref(slug, "relationships")
    const tabId = formString(_formData, WORKSPACE_TAB_FRAME_PARAM)
    redirect(tabId ? workspaceTabFrameUrl(relationshipsHref, tabId, "http://localhost") : relationshipsHref)
}

export async function proceedRelationshipCurrentWork(slug: string, relationshipId: string, workItemId: string) {
    let workflowAction: string | null = null
    try {
        const { workspace, user, role } = await requireWorkspace(slug)
        const { data: item } = await supabaseAdmin.from("work_items")
            .select("id, workflow_action")
            .eq("workspace_id", workspace.id).eq("id", workItemId).maybeSingle()
        if (!item) throw new Error("Work item not found")
        workflowAction = item.workflow_action
        const { data: link } = await supabaseAdmin.from("work_item_relationships")
            .select("work_item_id").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).eq("work_item_id", workItemId).maybeSingle()
        if (!link) throw new Error("Work item does not belong to this relationship")
        if (role !== "owner" && role !== "admin") {
            const { data: assignment } = await supabaseAdmin.from("work_item_assignees")
                .select("user_id").eq("workspace_id", workspace.id).eq("work_item_id", workItemId).eq("user_id", user.id).maybeSingle()
            if (!assignment) throw new Error("This work item is not assigned to you")
        }
        if (workflowAction === "send_invoice") {
            await sendRelationshipInvoice({ workspaceId: workspace.id, relationshipId, workItemId, actorId: user.id })
        } else {
            if (workflowAction === "await_payment" || workflowAction === "await_onboarding") throw new Error("This stage advances automatically when the external step completes")
            await advanceRelationshipWorkflow({ workspaceId: workspace.id, relationshipId, workItemId, action: workflowAction, actorId: user.id })
        }
        relationshipRevalidatePaths(slug, relationshipId)
        return { ok: true as const }
    } catch (error) {
        const message = error instanceof Error ? error.message : "Could not proceed with this work item"
        const invoiceValidationMessage = workflowAction === "send_invoice" && [
            "Add a billing",
            "Add a usable client WhatsApp",
            "Verify and enable",
            "Every selected service",
            "Publish the mandatory",
            "Choose a current Active service revision",
            "Publish every onboarding module",
            "Onboarding welcome and completion",
            "The onboarding invoice migration is incomplete",
            "INVOICE_",
            "ONBOARDING_",
        ].some((prefix) => message.startsWith(prefix))
        const safeMessage = invoiceValidationMessage || message.endsWith("is not connected for this workspace.") || message === "Work item not found" || message === "Work item does not belong to this relationship" || message === "This work item is not assigned to you" || message === "This stage advances automatically when the external step completes" || message === "Choose a fulfilment manager before completing onboarding review" || message === "Complete every required review work item before moving to fulfilment"
            ? message
            : workflowAction === "send_invoice"
                ? "Could not send the invoice. Check the Stripe connection and commercial details, then try again."
                : "Could not proceed with this work item. Please try again."
        return { ok: false as const, error: safeMessage }
    }
}

export async function startRelationshipOnboarding(slug: string, relationshipId: string) {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    const { data: relationship } = await supabaseAdmin
        .from("relationships")
        .select("id, primary_person_name, primary_email, primary_phone, business_name, source_metadata")
        .eq("workspace_id", workspace.id)
        .eq("id", relationshipId)
        .maybeSingle()

    if (!relationship) redirect(workspaceHref(slug, "relationships?error=missing-relationship"))
    const isTestRelationship = Boolean(relationship.source_metadata && typeof relationship.source_metadata === "object" && relationship.source_metadata.is_test === true)
    if (!isTestRelationship) redirect(`${relationshipHubHref(slug, relationshipId)}?error=payment-required`)
    await createOnboardingClient({
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        customOnboardingDomain: workspace.custom_onboarding_domain,
        customOnboardingDomainVerified: workspace.custom_onboarding_domain_status === "verified",
        relationshipId: relationship.id,
        name: relationship.business_name ?? relationship.primary_person_name,
        email: relationship.primary_email,
        phone: relationship.primary_phone ?? "",
        serviceKeys: [],
        createClickUpResources: false,
        createOnboardingWork: false,
        activitySource: "Relationship onboarding start",
        createdBy: user.id,
        isTest: isTestRelationship,
    })

    relationshipRevalidatePaths(slug, relationshipId)
    redirect(relationshipHubHref(slug, relationshipId))
}

export async function createRelationshipWorkItem(slug: string, relationshipId: string, formData: FormData) {
    const result = await createWorkItemFromModal(slug, formData, relationshipId)
    if (result.href) redirect(result.href)
    redirect(relationshipHubHref(slug, relationshipId))
}

export async function createWorkItemFromModal(slug: string, formData: FormData, relationshipId?: string | null): Promise<WorkspaceCreateActionState> {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    const title = formString(formData, "title")
    if (!title) return { ok: false, error: "missing-title" }
    const lifecyclePhase = normalizeRelationshipPhase(formString(formData, "lifecycle_phase"))
    const parentWorkItemId = nullableFormString(formData, "parent_work_item_id")
    const waitForParent = parentWorkItemId ? formData.get("wait_for_parent") !== "off" : false
    const assigneeIds = [...new Set(formData.getAll("assigned_to").map(String).filter(Boolean))]

    const { data: item, error } = await supabaseAdmin.from("work_items").insert({
        workspace_id: workspace.id,
        title,
        description: nullableFormString(formData, "description"),
        lifecycle_phase: lifecyclePhase,
        status: nullableFormString(formData, "status") ?? "todo",
        priority: Number(formData.get("priority") ?? 3),
        is_key_task: formData.get("is_key_task") === "on",
        native_kind: "manual_task",
        parent_work_item_id: parentWorkItemId,
        planned_start_date: nullableFormString(formData, "planned_start_date"),
        planned_start_time: nullableFormString(formData, "planned_start_time"),
        due_date: nullableFormString(formData, "due_date"),
        due_time: nullableFormString(formData, "due_time"),
        metadata: { created_from: relationshipId ? "relationship_page" : "global_create" },
        created_by: user.id,
    })
        .select("id")
        .single()

    if (error || !item) return { ok: false, error: "create-failed" }

    const submittedRelationshipId = nullableFormString(formData, "relationship_id")
    const relationshipToLink = relationshipId ?? submittedRelationshipId
    if (relationshipToLink) {
        await supabaseAdmin.from("work_item_relationships").insert({
            workspace_id: workspace.id,
            work_item_id: item.id,
            relationship_id: relationshipToLink,
        })
    }

    if (parentWorkItemId && waitForParent) {
        const { error: dependencyError } = await supabaseAdmin.from("work_item_dependencies").insert({
            workspace_id: workspace.id,
            work_item_id: item.id,
            depends_on_work_item_id: parentWorkItemId,
            source: "parent_auto",
            created_by: user.id,
        })
        if (dependencyError) {
            await supabaseAdmin.from("work_items").delete().eq("workspace_id", workspace.id).eq("id", item.id)
            return { ok: false, error: "invalid-parent" }
        }
    }

    if (assigneeIds.length) {
        const { error: assigneeError } = await supabaseAdmin.from("work_item_assignees").insert(assigneeIds.map((userId) => ({
            workspace_id: workspace.id,
            work_item_id: item.id,
            user_id: userId,
            assigned_by: user.id,
        })))
        if (assigneeError) {
            await supabaseAdmin.from("work_items").delete().eq("workspace_id", workspace.id).eq("id", item.id)
            return { ok: false, error: "invalid-assignee" }
        }
    }

    relationshipRevalidatePaths(slug, relationshipToLink ?? undefined)
    return { ok: true, href: workItemHref(slug, item.id) }
}

export async function createRelationshipAsset(slug: string, relationshipId: string, formData: FormData) {
    const result = await createAssetFromModal(slug, formData, relationshipId)
    if (result.href) redirect(result.href)
    redirect(relationshipHubHref(slug, relationshipId))
}

export async function createAssetFromModal(slug: string, formData: FormData, relationshipId?: string | null, workItemId?: string | null): Promise<WorkspaceCreateActionState> {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    const title = formString(formData, "title")
    const assetKind = formString(formData, "asset_kind") || "file"
    if (!title) return { ok: false, error: "missing-title" }
    if (!creatableAssetKinds.has(assetKind)) return { ok: false, error: "invalid-kind" }
    const storagePath = nullableFormString(formData, "storage_path")
    if (!storagePath) return { ok: false, error: "missing-upload" }

    const { data: asset, error } = await supabaseAdmin.from("assets").insert({
        workspace_id: workspace.id,
        title,
        asset_kind: assetKind,
        source_kind: "upload",
        description: nullableFormString(formData, "description"),
        storage_path: storagePath,
        content_type: nullableFormString(formData, "content_type"),
        file_size: Number(formData.get("file_size") ?? 0) || null,
        native_kind: "manual_upload",
        metadata: {
            created_from: relationshipId || workItemId ? "context_create" : "global_create",
            original_name: nullableFormString(formData, "original_name"),
        },
        created_by: user.id,
    })
        .select("id")
        .single()

    if (error || !asset) return { ok: false, error: "create-failed" }

    const submittedRelationshipId = nullableFormString(formData, "relationship_id")
    const relationshipToLink = relationshipId ?? submittedRelationshipId
    if (relationshipToLink) {
        await supabaseAdmin.from("asset_relationships").insert({
            workspace_id: workspace.id,
            asset_id: asset.id,
            relationship_id: relationshipToLink,
        })
    }

    const submittedWorkItemId = nullableFormString(formData, "work_item_id")
    const workItemToLink = workItemId ?? submittedWorkItemId
    if (workItemToLink) {
        await supabaseAdmin.from("asset_work_items").insert({
            workspace_id: workspace.id,
            asset_id: asset.id,
            work_item_id: workItemToLink,
        })
    }

    relationshipRevalidatePaths(slug, relationshipToLink ?? undefined)
    return { ok: true, href: assetHref(slug, asset.id) }
}
