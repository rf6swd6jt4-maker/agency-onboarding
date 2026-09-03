"use server"

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
} from "@/lib/relationships"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import { advanceRelationshipWorkflow, ensureRelationshipStage, ensureSalesStage, finalizeRelationshipSaleConfirmation, prepareRelationshipSale } from "@/lib/relationship-workflow"
import { sendSaleConsentTemplate } from "@/lib/client-sales/automation"
import { getSmsConsentUrl } from "@/lib/client-sales/sms-consent"
import type { StripeRecurringInterval } from "@/lib/stripe/api"
import { WORKSPACE_TAB_FRAME_PARAM, workspaceTabFrameUrl } from "@/lib/workspace-tabs"
import { isUsablePhoneNumber, normalizeProviderAddress, resolvePrimaryMessagingProvider } from "@/lib/client-messages/addresses"

const creatableRelationshipPhases = new Set(["potential_client", "retention"] as const)
const creatableAssetKinds = new Set(["file", "media", "document"])

export type WorkspaceCreateActionState = {
    ok: boolean
    href?: string
    error?: string
    notice?: string
}

export type RelationshipDealDetailsInput = {
    primaryPersonName: string
    businessName: string
    primaryContactRole: string
    primaryPhone: string
    whatsappPhone: string
    communicationPrimaryProvider: "meta_whatsapp" | "twilio_sms"
    communicationDeliveryMode: "primary_only" | "primary_with_fallback" | "mirror"
    primaryEmail: string
    sellerUserId: string
    fulfilmentManagerUserId: string
    fulfilmentTeamId: string
    projectTimeframeDays: number | null
    description: string
    services: Array<{
        code: string
        serviceId: string | null
        revisionId: string | null
        upfrontPriceCents: number
        recurringPriceCents: number
        currency: string
        assigneeUserId?: string | null
    }>
}

export type RelationshipBackgroundDetailsInput = Pick<RelationshipDealDetailsInput,
    "primaryPersonName" | "businessName" | "primaryContactRole" | "primaryPhone" | "whatsappPhone" | "communicationPrimaryProvider" | "communicationDeliveryMode" | "primaryEmail" | "description"
> & { expectedUpdatedAt: string }

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
    const requestedPhase = formString(formData, "lifecycle_phase")
    const phase = creatableRelationshipPhases.has(requestedPhase as "potential_client" | "retention")
        ? requestedPhase as "potential_client" | "retention"
        : null
    const isTest = formData.get("is_test") === "on"
    const primaryPhone = nullableFormString(formData, "primary_phone")
    const whatsappPhone = nullableFormString(formData, "whatsapp_phone")
    const requestedPrimaryProvider = formString(formData, "communication_primary_provider")

    if (!primaryPersonName || !phase) {
        return { ok: false, error: "missing-fields" }
    }
    if (phase === "retention") {
        if (requestedPrimaryProvider !== "twilio_sms" && requestedPrimaryProvider !== "meta_whatsapp") {
            return { ok: false, error: "Choose the client's preferred communication channel." }
        }
        if (!isUsablePhoneNumber(primaryPhone) && !isUsablePhoneNumber(whatsappPhone)) {
            return { ok: false, error: "Add a usable phone number or WhatsApp number." }
        }
        if (requestedPrimaryProvider === "twilio_sms" && !isUsablePhoneNumber(primaryPhone)) {
            return { ok: false, error: "Add a usable phone number for the selected SMS channel." }
        }
        if (requestedPrimaryProvider === "meta_whatsapp" && !isUsablePhoneNumber(whatsappPhone)) {
            return { ok: false, error: "Add a usable WhatsApp number for the selected WhatsApp channel." }
        }
    }
    const communicationPrimaryProvider = resolvePrimaryMessagingProvider({
        requestedProvider: requestedPrimaryProvider === "twilio_sms" ? "twilio_sms" : "meta_whatsapp",
        smsPhone: primaryPhone,
        whatsappPhone,
    })

    const { data: relationship, error } = await supabaseAdmin
        .from("relationships")
        .insert({
            workspace_id: workspace.id,
            source_type: "manual",
            primary_person_name: primaryPersonName,
            primary_email: nullableFormString(formData, "primary_email"),
            primary_phone: primaryPhone,
            whatsapp_phone: whatsappPhone,
            business_name: businessName,
            website_url: nullableFormString(formData, "website_url"),
            industry_value: nullableFormString(formData, "industry_value"),
            location_value: nullableFormString(formData, "location_value"),
            source_label: nullableFormString(formData, "source_label") ?? "Manual",
            primary_contact_role: nullableFormString(formData, "primary_contact_role"),
            notes_summary: nullableFormString(formData, "notes_summary"),
            lifecycle_phase: phase,
            status: "active",
            ...(phase === "retention" ? {
                communication_primary_provider: communicationPrimaryProvider,
                communication_delivery_mode: "primary_only",
            } : {}),
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

    let retentionConfirmationSaleId: string | null = null
    let retentionRequiresSmsConsent = false
    try {
        await ensureRelationshipStage({ workspaceId: workspace.id, relationshipId: relationship.id, phase, assigneeId: user.id })
        if (phase === "retention") {
            const confirmationAddress = communicationPrimaryProvider === "twilio_sms" ? primaryPhone : whatsappPhone
            const { data: sale, error: saleError } = await supabaseAdmin.from("client_sales").insert({
                workspace_id: workspace.id,
                relationship_id: relationship.id,
                client_name: businessName ?? primaryPersonName,
                client_email: nullableFormString(formData, "primary_email"),
                client_phone: normalizeProviderAddress(communicationPrimaryProvider, confirmationAddress ?? ""),
                service_keys: [],
                line_items: [],
                currency: "usd",
                total_amount: 0,
                status: "manual_consent_pending",
                created_by: user.id,
                raw_payload: {
                    flow: "retention_confirmation",
                    relationship_start_phase: "retention",
                },
            }).select("id").single()
            if (saleError || !sale) throw new Error(saleError?.message ?? "Could not prepare the client confirmation")
            retentionConfirmationSaleId = sale.id
            retentionRequiresSmsConsent = communicationPrimaryProvider === "twilio_sms"
        }
    } catch {
        await supabaseAdmin.from("relationships").delete().eq("workspace_id", workspace.id).eq("id", relationship.id)
        return { ok: false, error: "workflow-create-failed" }
    }

    if (retentionConfirmationSaleId && !retentionRequiresSmsConsent) {
        const confirmation = await sendSaleConsentTemplate(retentionConfirmationSaleId, workspace.id)
        if (!confirmation.ok) {
            relationshipRevalidatePaths(slug, relationship.id)
            return {
                ok: true,
                href: relationshipHubHref(slug, relationship.id),
                notice: "Relationship added, but the confirmation could not be sent. Check the messaging connection and contact details.",
            }
        }
    }

    relationshipRevalidatePaths(slug, relationship.id)

    return {
        ok: true,
        href: relationshipHubHref(slug, relationship.id),
        ...(phase === "retention" ? { notice: retentionRequiresSmsConsent ? "Relationship added. Copy its SMS consent link and share it outside SMS." : "Relationship added and confirmation sent" } : {}),
    }
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
    const { workspace, user, role } = await requireWorkspace(slug, "admin")
    const serviceKeys = [...new Set(formData.getAll("service_key").map(String).filter(Boolean))]
    let sellerId = nullableFormString(formData, "seller_user_id")
    const managerId = nullableFormString(formData, "fulfilment_manager_user_id")
    const submittedTeamId = nullableFormString(formData, "fulfilment_team_id")
    const whatsappPhone = nullableFormString(formData, "whatsapp_phone")
    const requestedPrimaryProvider = formString(formData, "communication_primary_provider") === "twilio_sms" ? "twilio_sms" : "meta_whatsapp"
    const requestedDeliveryMode = formString(formData, "communication_delivery_mode")
    const communicationDeliveryMode = (["primary_only", "primary_with_fallback", "mirror"] as const).includes(requestedDeliveryMode as "primary_only" | "primary_with_fallback" | "mirror")
        ? requestedDeliveryMode as "primary_only" | "primary_with_fallback" | "mirror"
        : "mirror"
    const timeframe = Number(formData.get("project_timeframe_days") ?? 0)
    const includesRelationshipDetails = formData.has("primary_person_name")
    const primaryPersonName = formString(formData, "primary_person_name")
    const businessName = nullableFormString(formData, "business_name")
    const primaryContactRole = nullableFormString(formData, "primary_contact_role")
    const primaryPhone = nullableFormString(formData, "primary_phone")
    const primaryEmail = nullableFormString(formData, "primary_email")
    const description = nullableFormString(formData, "description")
    const communicationPrimaryProvider = resolvePrimaryMessagingProvider({
        requestedProvider: requestedPrimaryProvider,
        smsPhone: primaryPhone,
        whatsappPhone,
    })
    if (includesRelationshipDetails && !primaryPersonName) throw new Error("Add the client's name before saving the relationship")
    const [{ data: relationship, error: relationshipError }, existingServicesResult, { data: frozenSales }, configuration] = await Promise.all([
        supabaseAdmin.from("relationships").select("lifecycle_phase, seller_user_id, fulfilment_team_id").eq("workspace_id", workspace.id).eq("id", relationshipId).maybeSingle(),
        supabaseAdmin.from("relationship_services").select("service_key, service_id, service_revision_id, upfront_price_cents, recurring_price_cents, currency, assignee_user_id").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId),
        supabaseAdmin.from("client_sales").select("id, status").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).in("status", [
            "invoice_sent", "payment_failed", "paid", "test_paid", "paid_consent_template_sending", "paid_awaiting_whatsapp_confirm",
            "paid_consent_template_failed", "whatsapp_confirmed", "onboarding_created", "onboarding_link_sent", "onboarding_link_failed",
            "sale_confirmation_pending", "sold_confirmation_sending", "sold_awaiting_whatsapp_confirm", "sold_confirmation_failed", "onboarding_payment_pending",
        ]).limit(1),
        loadPublishedOnboardingConfiguration(workspace.id),
    ])
    if (relationshipError || !relationship) throw new Error(relationshipError?.message ?? "Relationship not found")
    const canManageCommercialDetails = role === "owner" || role === "admin"
    if (!canManageCommercialDetails && relationship.seller_user_id !== user.id) {
        throw new Error("Only this relationship's seller or a workspace admin can update its commercial details")
    }
    if (!canManageCommercialDetails) sellerId = relationship.seller_user_id
    const fulfilmentTeamId = formData.has("fulfilment_team_id") ? submittedTeamId : relationship.fulfilment_team_id
    if (existingServicesResult.error) throw new Error(existingServicesResult.error.message)
    const existingServices = existingServicesResult.data ?? []
    const existingByKey = new Map((existingServices ?? []).map((service) => [service.service_key, service]))
    const catalogueByCode = new Map(configuration.services.map((service) => [service.code, service]))
    const submittedUpfrontPrices = new Map(serviceKeys.map((serviceKey) => [serviceKey, priceCents(formString(formData, `service_upfront_price_${serviceKey}`))]))
    const submittedRecurringPrices = new Map(serviceKeys.map((serviceKey) => [serviceKey, priceCents(formString(formData, `service_recurring_price_${serviceKey}`))]))
    const submittedCurrencies = new Map(serviceKeys.map((serviceKey) => [serviceKey, currencyCode(formString(formData, `service_currency_${serviceKey}`) || catalogueByCode.get(serviceKey)?.currency || existingByKey.get(serviceKey)?.currency || "USD")]))
    const existingUpfrontPrices = new Map(existingServices.map((service) => [service.service_key, Number(service.upfront_price_cents) || 0]))
    const existingRecurringPrices = new Map(existingServices.map((service) => [service.service_key, Number(service.recurring_price_cents) || 0]))
    const existingCurrencies = new Map((existingServices ?? []).map((service) => [service.service_key, String(service.currency ?? "USD").toUpperCase()]))
    const serviceIdentityChanged = configuration.schemaReady && serviceKeys.some((serviceKey) => {
        const existing = existingByKey.get(serviceKey)
        const current = catalogueByCode.get(serviceKey)
        return current?.state === "active" && Boolean(current.revisionId) && (
            existing?.service_id !== current.id || existing?.service_revision_id !== current.revisionId
        )
    })
    const commercialChanged = fulfilmentTeamId !== relationship.fulfilment_team_id || serviceIdentityChanged || serviceKeys.length !== existingUpfrontPrices.size || serviceKeys.some((serviceKey) => (
        existingUpfrontPrices.get(serviceKey) !== submittedUpfrontPrices.get(serviceKey)
        || existingRecurringPrices.get(serviceKey) !== submittedRecurringPrices.get(serviceKey)
        || existingCurrencies.get(serviceKey) !== submittedCurrencies.get(serviceKey)
    ))
    if (frozenSales?.length && commercialChanged) throw new Error("This sale is already frozen. Create a replacement sale before changing services or negotiated prices")

    for (const serviceKey of serviceKeys) {
        const existing = existingByKey.get(serviceKey)
        const catalogue = catalogueByCode.get(serviceKey)
        if (configuration.schemaReady && !existing && (!catalogue || catalogue.state !== "active" || !catalogue.revisionId)) {
            throw new Error(`${serviceKey} is not a current Active service and cannot be added to this relationship`)
        }
        const postedServiceId = nullableFormString(formData, `service_id_${serviceKey}`)
        const postedRevisionId = nullableFormString(formData, `service_revision_id_${serviceKey}`)
        const currentActive = catalogue?.state === "active" && catalogue.revisionId ? catalogue : null
        const expectedServiceId = currentActive?.id ?? existing?.service_id ?? catalogue?.id ?? null
        const expectedRevisionId = currentActive?.revisionId ?? existing?.service_revision_id ?? null
        if (configuration.schemaReady && (
            (postedServiceId && postedServiceId !== expectedServiceId)
            || (postedRevisionId && postedRevisionId !== expectedRevisionId)
        )) throw new Error(`The selected revision for ${serviceKey} changed. Reload and review the deal before saving`)
    }
    const teamAssigneeByService = new Map<string, string>()
    if (fulfilmentTeamId) {
        const [{ data: team }, { data: responsibilities, error: responsibilityError }] = await Promise.all([
            supabaseAdmin.from("workspace_teams").select("id").eq("workspace_id", workspace.id).eq("id", fulfilmentTeamId).eq("kind", "custom").is("archived_at", null).maybeSingle(),
            supabaseAdmin.from("workspace_team_service_responsibilities").select("service_id, responsible_user_id").eq("workspace_id", workspace.id).eq("team_id", fulfilmentTeamId),
        ])
        if (!team || responsibilityError) throw new Error("Choose an active fulfilment team")
        for (const responsibility of responsibilities ?? []) teamAssigneeByService.set(responsibility.service_id, responsibility.responsible_user_id)
        for (const serviceKey of serviceKeys) {
            const existing = existingByKey.get(serviceKey)
            const catalogue = catalogueByCode.get(serviceKey)
            const serviceId = catalogue?.state === "active" && catalogue.revisionId ? catalogue.id : existing?.service_id ?? catalogue?.id ?? null
            if (!serviceId || !teamAssigneeByService.has(serviceId)) throw new Error(`${catalogue?.name ?? serviceKey} is not assigned within the selected fulfilment team`)
        }
    }
    const versionedRows = serviceKeys.map((serviceKey) => {
        const existing = existingByKey.get(serviceKey)
        const service = catalogueByCode.get(serviceKey)
        const currentActive = service?.state === "active" && service.revisionId ? service : null
        const serviceId = currentActive?.id ?? existing?.service_id ?? service?.id ?? null
        const serviceRevisionId = currentActive?.revisionId ?? existing?.service_revision_id ?? null
        return {
            workspace_id: workspace.id,
            relationship_id: relationshipId,
            service_key: serviceKey,
            upfront_price_cents: submittedUpfrontPrices.get(serviceKey) ?? 0,
            recurring_price_cents: submittedRecurringPrices.get(serviceKey) ?? 0,
            price_cents: (submittedUpfrontPrices.get(serviceKey) ?? 0) + (submittedRecurringPrices.get(serviceKey) ?? 0),
            currency: submittedCurrencies.get(serviceKey) ?? "USD",
            assignee_user_id: fulfilmentTeamId && serviceId ? teamAssigneeByService.get(serviceId) ?? null : nullableFormString(formData, `service_assignee_${serviceKey}`) ?? existing?.assignee_user_id ?? service?.defaultAssigneeId ?? null,
            ...(configuration.schemaReady && serviceId && serviceRevisionId ? { service_id: serviceId, service_revision_id: serviceRevisionId } : {}),
        }
    })
    const { error: saveError } = await supabaseAdmin.rpc("save_relationship_dual_pricing_configuration", {
        p_workspace_id: workspace.id,
        p_actor_user_id: user.id,
        p_relationship_id: relationshipId,
        p_details: {
            seller_user_id: sellerId,
            fulfilment_manager_user_id: managerId,
            whatsapp_phone: whatsappPhone,
            project_timeframe_days: Number.isFinite(timeframe) && timeframe > 0 ? Math.round(timeframe) : null,
            ...(includesRelationshipDetails ? {
                primary_person_name: primaryPersonName,
                business_name: businessName,
                primary_contact_role: primaryContactRole,
                primary_phone: primaryPhone,
                primary_email: primaryEmail,
                description,
            } : {}),
        },
        p_services: versionedRows,
    })
    if (saveError) {
        const missingMigration = saveError.code === "42883" || saveError.code === "PGRST202"
        throw new Error(missingMigration
            ? "The dual-price sale migration is not applied yet"
            : saveError.message)
    }
    const { error: teamSaveError } = await supabaseAdmin.from("relationships").update({
        fulfilment_team_id: fulfilmentTeamId,
        communication_primary_provider: communicationPrimaryProvider,
        communication_delivery_mode: communicationDeliveryMode,
        updated_at: new Date().toISOString(),
    }).eq("workspace_id", workspace.id).eq("id", relationshipId)
    if (teamSaveError) throw new Error(teamSaveError.message)
    if (relationship.lifecycle_phase === "potential_client") await ensureSalesStage({ workspaceId: workspace.id, relationshipId, sellerId })
    relationshipRevalidatePaths(slug, relationshipId)
    const { data: savedRelationship, error: versionError } = await supabaseAdmin.from("relationships").select("updated_at").eq("workspace_id", workspace.id).eq("id", relationshipId).maybeSingle()
    if (versionError || !savedRelationship) throw new Error(versionError?.message ?? "The saved relationship version could not be verified")
    return savedRelationship.updated_at
}

export async function saveRelationshipDealDetails(slug: string, relationshipId: string, input: RelationshipDealDetailsInput): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
    const formData = new FormData()
    formData.set("primary_person_name", input.primaryPersonName)
    formData.set("business_name", input.businessName)
    formData.set("primary_contact_role", input.primaryContactRole)
    formData.set("primary_phone", input.primaryPhone)
    formData.set("whatsapp_phone", input.whatsappPhone)
    formData.set("communication_primary_provider", input.communicationPrimaryProvider)
    formData.set("communication_delivery_mode", input.communicationDeliveryMode)
    formData.set("primary_email", input.primaryEmail)
    formData.set("seller_user_id", input.sellerUserId)
    formData.set("fulfilment_manager_user_id", input.fulfilmentManagerUserId)
    formData.set("fulfilment_team_id", input.fulfilmentTeamId)
    formData.set("project_timeframe_days", input.projectTimeframeDays ? String(input.projectTimeframeDays) : "")
    formData.set("description", input.description)
    for (const service of input.services) {
        formData.append("service_key", service.code)
        formData.set(`service_upfront_price_${service.code}`, (service.upfrontPriceCents / 100).toFixed(2))
        formData.set(`service_recurring_price_${service.code}`, (service.recurringPriceCents / 100).toFixed(2))
        formData.set(`service_currency_${service.code}`, service.currency)
        if (service.serviceId) formData.set(`service_id_${service.code}`, service.serviceId)
        if (service.revisionId) formData.set(`service_revision_id_${service.code}`, service.revisionId)
        if (service.assigneeUserId) formData.set(`service_assignee_${service.code}`, service.assigneeUserId)
    }
    try {
        const version = await saveRelationshipCommercialDetails(slug, relationshipId, formData)
        return { ok: true, version }
    } catch (error) {
        const message = error instanceof Error ? error.message : "The relationship could not be saved"
        const safe = message.startsWith("Void and replace")
            || message.startsWith("Add the client's name")
            || message.includes("service")
            || message.includes("currency")
            ? message
            : "The relationship could not be saved. Review the details and try again."
        return { ok: false, error: safe }
    }
}

export async function saveRelationshipBackgroundDetails(slug: string, relationshipId: string, input: RelationshipBackgroundDetailsInput): Promise<{ ok: true; version: string } | { ok: false; error: string; conflict?: boolean; version?: string }> {
    const { workspace, user, role } = await requireWorkspace(slug, "admin")
    const primaryPersonName = input.primaryPersonName.trim()
    if (!primaryPersonName) return { ok: false, error: "Add the client's name before saving the relationship" }
    const { data: relationship, error: relationshipError } = await supabaseAdmin.from("relationships")
        .select("seller_user_id, updated_at").eq("workspace_id", workspace.id).eq("id", relationshipId).maybeSingle()
    if (relationshipError || !relationship) return { ok: false, error: relationshipError?.message ?? "The relationship could not be found" }
    if (role !== "owner" && role !== "admin" && relationship.seller_user_id !== user.id) {
        return { ok: false, error: "Only this relationship's seller or a workspace admin can update its details" }
    }
    if (input.expectedUpdatedAt && relationship.updated_at !== input.expectedUpdatedAt) {
        return { ok: false, conflict: true, version: relationship.updated_at, error: "Another user changed this relationship. Refresh to review their version before retrying your edits." }
    }

    const nextVersion = new Date().toISOString()
    const communicationPrimaryProvider = resolvePrimaryMessagingProvider({
        requestedProvider: input.communicationPrimaryProvider,
        smsPhone: input.primaryPhone,
        whatsappPhone: input.whatsappPhone,
    })
    let update = supabaseAdmin.from("relationships").update({
        primary_person_name: primaryPersonName,
        business_name: input.businessName.trim() || null,
        primary_contact_role: input.primaryContactRole.trim() || null,
        primary_phone: input.primaryPhone.trim() || null,
        whatsapp_phone: input.whatsappPhone.trim() || null,
        communication_primary_provider: communicationPrimaryProvider,
        communication_delivery_mode: input.communicationDeliveryMode,
        primary_email: input.primaryEmail.trim() || null,
        notes_summary: input.description.trim() || null,
        updated_at: nextVersion,
    }).eq("workspace_id", workspace.id).eq("id", relationshipId)
    if (input.expectedUpdatedAt) update = update.eq("updated_at", input.expectedUpdatedAt)
    const { data: saved, error } = await update.select("updated_at").maybeSingle()
    if (error) return { ok: false, error: `The database rejected this relationship change (${error.code}): ${error.message}` }
    if (!saved) {
        const { data: latest } = await supabaseAdmin.from("relationships").select("updated_at").eq("workspace_id", workspace.id).eq("id", relationshipId).maybeSingle()
        return { ok: false, conflict: true, version: latest?.updated_at, error: "Another user changed this relationship. Refresh to review their version before retrying your edits." }
    }
    relationshipRevalidatePaths(slug, relationshipId)
    return { ok: true, version: saved.updated_at }
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

export async function proceedRelationshipCurrentWork(
    slug: string,
    relationshipId: string,
    workItemId: string,
    payment?: { billingInterval?: StripeRecurringInterval; billingIntervalCount?: number }
) {
    let workflowAction: string | null = null
    let sale: Awaited<ReturnType<typeof prepareRelationshipSale>> | null = null
    let saleResult: { id: string; kind: "checkout" | "sms_consent"; href: string | null } | null = null
    try {
        const { workspace, user, role } = await requireWorkspace(slug, "admin")
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
        if (workflowAction === "sell_client") {
            sale = await prepareRelationshipSale({
                workspaceId: workspace.id,
                relationshipId,
                workItemId,
                actorId: user.id,
                billingInterval: payment?.billingInterval,
                billingIntervalCount: payment?.billingIntervalCount,
            })
            if (sale.requiresSmsConsent) {
                await finalizeRelationshipSaleConfirmation({ workspaceId: workspace.id, relationshipId, workItemId, actorId: user.id, saleId: sale.saleId })
                saleResult = {
                    id: sale.saleId,
                    kind: "sms_consent",
                    href: getSmsConsentUrl({
                        token: sale.smsConsentToken,
                        customDomain: workspace.custom_onboarding_domain,
                        customDomainVerified: workspace.custom_onboarding_domain_status === "verified",
                    }),
                }
            } else {
                const consent = await sendSaleConsentTemplate(sale.saleId, workspace.id)
                if (!consent.ok) throw new Error(consent.error ?? "The client confirmation could not be sent")
                if (!("inProgress" in consent && consent.inProgress)) {
                    await finalizeRelationshipSaleConfirmation({ workspaceId: workspace.id, relationshipId, workItemId, actorId: user.id, saleId: sale.saleId })
                }
                saleResult = { id: sale.saleId, kind: "checkout", href: null }
            }
        } else {
            if (workflowAction === "await_payment" || workflowAction === "await_onboarding") throw new Error("This stage advances automatically when the external step completes")
            await advanceRelationshipWorkflow({ workspaceId: workspace.id, relationshipId, workItemId, action: workflowAction, actorId: user.id })
        }
        relationshipRevalidatePaths(slug, relationshipId)
        return {
            ok: true as const,
            sale: saleResult,
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : "Could not proceed with this work item"
        const saleValidationMessage = workflowAction === "sell_client" && [
            "Add a billing",
            "Add a usable client WhatsApp",
            "Add a usable client phone",
            "This relationship has no connected messaging",
            "Verify and enable",
            "Every selected service",
            "Publish the mandatory",
            "Choose a current Active service revision",
            "Publish every onboarding module",
            "Onboarding welcome and completion",
            "The dual-price sale migration is incomplete",
            "This sale has too many separate Stripe Checkout line items",
            "Choose a recurring schedule",
            "ONBOARDING_",
        ].some((prefix) => message.startsWith(prefix))
        const safeMessage = saleValidationMessage || message.endsWith("is not connected for this workspace.") || message === "Work item not found" || message === "Work item does not belong to this relationship" || message === "This work item is not assigned to you" || message === "This stage advances automatically when the external step completes" || message === "Choose a fulfilment manager before completing onboarding review" || message === "Complete every required review work item before moving to fulfilment"
            ? message
            : workflowAction === "sell_client"
                ? "Could not send the client confirmation. Check the messaging connection and commercial details, then try again."
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
