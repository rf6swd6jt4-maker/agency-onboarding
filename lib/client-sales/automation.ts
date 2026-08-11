import { randomUUID } from "crypto"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { SERVICES } from "@/lib/onboarding/services"
import { createOnboardingClient, getOnboardingUrl } from "@/lib/onboarding/client-creation"
import { createRelationshipOnboardingSession } from "@/lib/onboarding/canonical"
import { processWorkspaceOnboardingOutbox } from "@/lib/onboarding/outbox"
import { getOnboardingRuntimeMode } from "@/lib/onboarding/runtime-mode"
import { getEquivalentMessageAddresses } from "@/lib/client-messages/addresses"
import {
    sendMetaWhatsAppMessage,
    sendMetaWhatsAppTemplate,
} from "@/lib/client-messages/meta-whatsapp"
import { isConsentConfirmationText } from "@/lib/client-sales/consent"
import { completePaymentStage } from "@/lib/relationship-workflow"
import { recordAdminActivity } from "@/lib/admin/activity"
import { platformFailureFingerprint, reportPlatformFailure } from "@/lib/admin/maintenance"

type ClientSale = {
    id: string
    client_id: string | null
    relationship_id: string | null
    client_name: string
    client_email: string | null
    client_phone: string
    service_keys: unknown
    project_timeframe_days: number | null
    status: string
    raw_payload: unknown
    workspace_id: string
    created_by: string | null
    correlation_id?: string | null
    onboarding_session_id?: string | null
    snapshot_frozen_at?: string | null
}

type StripeInvoiceLike = {
    id?: unknown
    status?: unknown
    customer?: unknown
    amount_paid?: unknown
    hosted_invoice_url?: unknown
    invoice_pdf?: unknown
    metadata?: {
        client_sale_id?: string
    }
}

type ConfirmationInput = {
    fromAddress: string
    messageId?: string | null
    body: string
    rawPayload: unknown
}

const CONSENT_TEMPLATE_SENDING_STATUSES = new Set([
    "paid_consent_template_sending",
    "manual_consent_template_sending",
])

const CONSENT_TEMPLATE_TERMINAL_STATUSES = new Set([
    "paid_awaiting_whatsapp_confirm",
    "whatsapp_confirmed",
    "onboarding_created",
    "onboarding_link_sent",
    "manual_awaiting_whatsapp_confirm",
    "manual_workspace_created",
])

const CONSENT_TEMPLATE_CLAIM_TIMEOUT_MS = 15 * 60 * 1_000

type SaleFlow = "paid" | "manual_migration"

function getSaleFlow(rawPayload: unknown): SaleFlow {
    if (
        rawPayload &&
        typeof rawPayload === "object" &&
        !Array.isArray(rawPayload) &&
        (rawPayload as { flow?: unknown }).flow === "manual_migration"
    ) {
        return "manual_migration"
    }

    return "paid"
}

function getConsentStatus(flow: SaleFlow, state: "sending" | "awaiting" | "failed") {
    if (flow === "manual_migration") {
        return {
            sending: "manual_consent_template_sending",
            awaiting: "manual_awaiting_whatsapp_confirm",
            failed: "manual_consent_template_failed",
        }[state]
    }

    return {
        sending: "paid_consent_template_sending",
        awaiting: "paid_awaiting_whatsapp_confirm",
        failed: "paid_consent_template_failed",
    }[state]
}

function getEquivalentSalePhoneAddresses(value: string) {
    const addresses = new Set(getEquivalentMessageAddresses(value))
    // Older sales store the bridge address; relationship-created sales used to
    // store the same phone without that prefix. Treat them as the same recipient.
    for (const address of [...addresses]) {
        if (address.startsWith("whatsapp:")) addresses.add(address.slice("whatsapp:".length))
    }
    return [...addresses]
}

function asStringArray(value: unknown) {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : []
}

function isMissingPaidSessionRpc(error: { code?: string; message?: string } | null | undefined) {
    const message = error?.message?.toLowerCase() ?? ""
    return error?.code === "42883" || error?.code === "PGRST202" || message.includes("create_paid_onboarding_session") && (message.includes("schema cache") || message.includes("does not exist"))
}

function isMissingOnboardingLinkOutboxRpc(error: { code?: string; message?: string } | null | undefined) {
    const message = error?.message?.toLowerCase() ?? ""
    return error?.code === "42883" || error?.code === "PGRST202" || message.includes("enqueue_onboarding_link_delivery") && (message.includes("schema cache") || message.includes("does not exist"))
}

function isMissingOnboardingRuntimeColumn(error: { code?: string; message?: string } | null | undefined) {
    const message = error?.message?.toLowerCase() ?? ""
    return error?.code === "42703" || error?.code === "PGRST204" || message.includes("schema cache") || message.includes("could not find")
}

async function ensurePaidOnboardingSession(sale: ClientSale) {
    const runtimeMode = getOnboardingRuntimeMode()
    const snapshotStateAvailable = Object.prototype.hasOwnProperty.call(
        sale,
        "snapshot_frozen_at"
    )
    const usesVersionedSaleSnapshot = Boolean(sale.snapshot_frozen_at)
    const shouldUseVersionedRuntime = usesVersionedSaleSnapshot || (
        runtimeMode === "versioned" && !snapshotStateAvailable
    )

    if (!shouldUseVersionedRuntime) {
        return createCompatibilityOnboardingSession(sale, "legacy")
    }

    const correlationId = sale.correlation_id ?? randomUUID()
    const { data, error } = await supabaseAdmin.rpc("create_paid_onboarding_session", {
        p_workspace_id: sale.workspace_id,
        p_sale_id: sale.id,
        p_correlation_id: correlationId,
        p_idempotency_key: `onboarding.payment:${sale.id}`,
    })
    if (!error && data && typeof data === "object") {
        const result = data as Record<string, unknown>
        const sessionId = typeof result.session_id === "string" ? result.session_id : null
        const sessionToken = typeof result.session_token === "string" ? result.session_token : null
        const relationshipId = typeof result.relationship_id === "string" ? result.relationship_id : sale.relationship_id
        if (!sessionId || !sessionToken || !relationshipId) throw new Error("Paid onboarding session RPC returned an incomplete result")
        return { sessionId, sessionToken, relationshipId, created: result.created === true }
    }
    if (!isMissingPaidSessionRpc(error)) throw new Error(error?.message ?? "Could not create paid onboarding session")

    // Compatibility for deployments where the new migration has not reached
    // the database yet. A frozen sale stays on the versioned definition even
    // if the global runtime mode is rolled back after the invoice was sent.
    return createCompatibilityOnboardingSession(sale, "versioned")
}

async function createCompatibilityOnboardingSession(
    sale: ClientSale,
    compositionSource: "versioned" | "legacy"
) {
    if (!sale.relationship_id) throw new Error("Paid sale has no relationship")
    const { data: workspace } = await supabaseAdmin.from("workspaces").select("slug").eq("id", sale.workspace_id).single()
    if (!workspace) throw new Error("Paid sale workspace was not found")
    const legacy = await createRelationshipOnboardingSession({
        workspaceId: sale.workspace_id,
        workspaceSlug: workspace.slug,
        relationshipId: sale.relationship_id,
        serviceKeys: asStringArray(sale.service_keys),
        projectTimeframeDays: sale.project_timeframe_days,
        createdBy: sale.created_by,
        sourceSaleId: sale.id,
        compositionSource,
    })
    return { sessionId: legacy.id, sessionToken: legacy.sessionToken, relationshipId: legacy.relationshipId, created: legacy.created }
}

async function loadSaleForPaidInvoice(expectedWorkspaceId: string, saleId: string | null, invoiceId: string | null) {
    let snapshotQuery = supabaseAdmin.from("client_sales")
        .select("id, client_id, relationship_id, client_name, client_email, client_phone, service_keys, project_timeframe_days, status, raw_payload, workspace_id, created_by, correlation_id, onboarding_session_id, snapshot_frozen_at")
        .eq("workspace_id", expectedWorkspaceId)
        .limit(1)
    snapshotQuery = saleId ? snapshotQuery.eq("id", saleId) : snapshotQuery.eq("stripe_invoice_id", invoiceId!)
    const snapshotResult = await snapshotQuery
    if (!snapshotResult.error) return snapshotResult.data?.[0] as ClientSale | undefined
    if (snapshotResult.error.code !== "42703" && !snapshotResult.error.message.toLowerCase().includes("schema cache")) throw new Error(snapshotResult.error.message)
    let legacyQuery = supabaseAdmin.from("client_sales")
        .select("id, client_id, relationship_id, client_name, client_email, client_phone, service_keys, project_timeframe_days, status, raw_payload, workspace_id, created_by")
        .eq("workspace_id", expectedWorkspaceId)
        .limit(1)
    legacyQuery = saleId ? legacyQuery.eq("id", saleId) : legacyQuery.eq("stripe_invoice_id", invoiceId!)
    const legacyResult = await legacyQuery
    if (legacyResult.error) throw new Error(legacyResult.error.message)
    return legacyResult.data?.[0] as ClientSale | undefined
}

function getWhatsAppMessageId(response: unknown) {
    const messages =
        response && typeof response === "object" && !Array.isArray(response)
            ? (response as { messages?: Array<{ id?: string }> }).messages
            : null

    return messages?.[0]?.id ?? null
}

async function addSaleActivity(
    workspaceId: string,
    saleId: string,
    activityText: string,
    rawPayload?: unknown
) {
    await supabaseAdmin
        .from("client_sales")
        .update({
            updated_at: new Date().toISOString(),
            raw_payload: rawPayload
                ? {
                      last_activity: activityText,
                      last_payload: rawPayload,
                  }
                : undefined,
        })
        .eq("id", saleId)
        .eq("workspace_id", workspaceId)
}

async function reportSaleAutomationFailure(sale: Pick<ClientSale, "id" | "workspace_id" | "relationship_id">, operation: string, error: string) {
    const { data: workspace } = await supabaseAdmin.from("workspaces").select("slug").eq("id", sale.workspace_id).maybeSingle()
    await reportPlatformFailure({ workspaceId: sale.workspace_id, category: "communications", source: "client_sales", operation, fingerprint: platformFailureFingerprint(["client_sales", operation, error]), severity: "warning", summary: "Client sale automation failed", diagnostics: { sale_id: sale.id, relationship_id: sale.relationship_id, error }, sourceHref: workspace?.slug && sale.relationship_id ? `/${workspace.slug}/relationships/${sale.relationship_id}` : null })
}

export async function sendSaleConsentTemplate(saleId: string, expectedWorkspaceId: string) {
    const { data: sale } = await supabaseAdmin
        .from("client_sales")
        .select("id, client_phone, status, consent_template_sent_at, raw_payload, workspace_id, relationship_id, client_id, updated_at")
        .eq("id", saleId)
        .eq("workspace_id", expectedWorkspaceId)
        .single()

    if (!sale) return { ok: false, error: "Sale not found" }
    const flow = getSaleFlow(sale.raw_payload)
    const sendingStatus = getConsentStatus(flow, "sending")
    const awaitingStatus = getConsentStatus(flow, "awaiting")
    const failedStatus = getConsentStatus(flow, "failed")
    if (
        sale.consent_template_sent_at ||
        CONSENT_TEMPLATE_TERMINAL_STATUSES.has(sale.status)
    ) {
        return { ok: true, skipped: true }
    }

    const templateName =
        process.env.META_WHATSAPP_CONSENT_TEMPLATE_NAME ??
        process.env.META_WHATSAPP_ONBOARDING_TEMPLATE_NAME
    const languageCode =
        process.env.META_WHATSAPP_CONSENT_TEMPLATE_LANGUAGE ??
        process.env.META_WHATSAPP_ONBOARDING_TEMPLATE_LANGUAGE ??
        "en"

    if (!templateName) {
        await supabaseAdmin
            .from("client_sales")
            .update({
                status: failedStatus,
                updated_at: new Date().toISOString(),
            })
            .eq("id", saleId)
            .eq("workspace_id", sale.workspace_id)

        await reportSaleAutomationFailure(sale, "send_consent_template", "Missing META_WHATSAPP_CONSENT_TEMPLATE_NAME")

        return {
            ok: false,
            error: "Missing META_WHATSAPP_CONSENT_TEMPLATE_NAME",
        }
    }

    if (sale.status === sendingStatus) {
        const claimedAt = Date.parse(sale.updated_at)
        if (Number.isFinite(claimedAt) && Date.now() - claimedAt < CONSENT_TEMPLATE_CLAIM_TIMEOUT_MS) {
            return { ok: true, skipped: true, inProgress: true }
        }

        const { data: previousMessage, error: previousMessageError } = await supabaseAdmin
            .from("client_messages")
            .select("id, status, provider_message_id, whatsapp_message_id, created_at")
            .eq("workspace_id", sale.workspace_id)
            .eq("provider", "meta_whatsapp")
            .eq("direction", "outbound")
            .contains("raw_payload", { client_sale_id: saleId })
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        if (previousMessageError) {
            await reportSaleAutomationFailure(sale, "recover_consent_send", previousMessageError.message)
            return { ok: false, error: "Could not verify the previous WhatsApp consent send" }
        }

        if (previousMessage?.status === "sent") {
            const messageId = previousMessage.provider_message_id ?? previousMessage.whatsapp_message_id
            const reconciledAt = new Date().toISOString()
            const { error: reconcileError } = await supabaseAdmin
                .from("client_sales")
                .update({
                    status: awaitingStatus,
                    consent_template_sent_at: previousMessage.created_at ?? reconciledAt,
                    consent_template_message_id: messageId,
                    updated_at: reconciledAt,
                })
                .eq("id", saleId)
                .eq("workspace_id", sale.workspace_id)
                .eq("status", sendingStatus)
                .eq("updated_at", sale.updated_at)
            if (reconcileError) {
                await reportSaleAutomationFailure(sale, "reconcile_consent_send", reconcileError.message)
                return { ok: false, error: "Could not reconcile the previous WhatsApp consent send" }
            }
            return { ok: true, skipped: true, reconciled: true, whatsappMessageId: messageId }
        }

        if (previousMessage?.status === "sending") {
            const message = "The previous WhatsApp consent send has an unknown provider outcome and needs review before retrying"
            await reportSaleAutomationFailure(sale, "recover_consent_send", message)
            return { ok: false, error: message }
        }

        const releasedAt = new Date().toISOString()
        const { data: releasedSale, error: releaseError } = await supabaseAdmin
            .from("client_sales")
            .update({ status: failedStatus, updated_at: releasedAt })
            .eq("id", saleId)
            .eq("workspace_id", sale.workspace_id)
            .eq("status", sendingStatus)
            .eq("updated_at", sale.updated_at)
            .select("id")
            .maybeSingle()
        if (releaseError) {
            await reportSaleAutomationFailure(sale, "release_consent_claim", releaseError.message)
            return { ok: false, error: "Could not release the stale WhatsApp consent claim" }
        }
        if (!releasedSale) return { ok: true, skipped: true, inProgress: true }
    }

    const claimStartedAt = new Date().toISOString()
    const claimableStatuses = flow === "manual_migration"
        ? ["manual_consent_pending", "manual_consent_template_failed"]
        : ["paid", "paid_consent_template_failed"]
    const { data: claimedSale, error: claimError } = await supabaseAdmin
        .from("client_sales")
        .update({
            status: sendingStatus,
            updated_at: claimStartedAt,
        })
        .eq("id", saleId)
        .eq("workspace_id", sale.workspace_id)
        .is("consent_template_sent_at", null)
        .in("status", claimableStatuses)
        .select("id")
        .maybeSingle()

    if (claimError) {
        await reportSaleAutomationFailure(sale, "claim_consent_send", claimError.message)
        return { ok: false, error: claimError.message }
    }

    if (!claimedSale) {
        return { ok: true, skipped: true }
    }

    const { data: messageLog, error: messageLogError } = await supabaseAdmin
        .from("client_messages")
        .insert({
            workspace_id: sale.workspace_id,
            relationship_id: sale.relationship_id,
            client_id: sale.client_id,
            direction: "outbound",
            provider: "meta_whatsapp",
            to_address: sale.client_phone,
            body: "[WhatsApp consent template]",
            status: "sending",
            raw_payload: {
                client_sale_id: saleId,
                template_name: templateName,
                template_language: languageCode,
                consent_claimed_at: claimStartedAt,
            },
        })
        .select("id")
        .single()
    if (messageLogError || !messageLog) {
        const message = messageLogError?.message ?? "Could not create WhatsApp message log"
        await supabaseAdmin
            .from("client_sales")
            .update({ status: failedStatus, updated_at: new Date().toISOString() })
            .eq("id", saleId)
            .eq("workspace_id", sale.workspace_id)
            .eq("status", sendingStatus)
            .eq("updated_at", claimStartedAt)
        await reportSaleAutomationFailure(sale, "create_consent_message_log", message)
        return { ok: false, error: message }
    }

    const { data: activeClaim, error: activeClaimError } = await supabaseAdmin
        .from("client_sales")
        .select("id")
        .eq("id", saleId)
        .eq("workspace_id", sale.workspace_id)
        .eq("status", sendingStatus)
        .eq("updated_at", claimStartedAt)
        .maybeSingle()
    if (activeClaimError || !activeClaim) {
        const message = activeClaimError?.message ?? "WhatsApp consent send claim is no longer active"
        await supabaseAdmin.from("client_messages")
            .update({ status: "send_failed", error: message })
            .eq("id", messageLog.id)
            .eq("workspace_id", sale.workspace_id)
        await reportSaleAutomationFailure(sale, "verify_consent_claim", message)
        return { ok: false, error: message }
    }

    let templateMessage: unknown
    try {
        templateMessage = await sendMetaWhatsAppTemplate({
            to: sale.client_phone,
            templateName,
            languageCode,
        })
    } catch (error) {
        const errorMessage =
            error instanceof Error
                ? error.message
                : "Unknown Meta WhatsApp template error"

        await Promise.all([
            supabaseAdmin
                .from("client_messages")
                .update({
                    status: "send_failed",
                    error: errorMessage,
                })
                .eq("id", messageLog.id)
                .eq("workspace_id", sale.workspace_id),
            supabaseAdmin
                .from("client_sales")
                .update({
                    status: failedStatus,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", saleId)
                .eq("workspace_id", sale.workspace_id)
                .eq("status", sendingStatus)
                .eq("updated_at", claimStartedAt),
        ])

        await reportSaleAutomationFailure(sale, "send_consent_template", errorMessage)

        return {
            ok: false,
            error: errorMessage,
        }
    }

    const whatsappMessageId = getWhatsAppMessageId(templateMessage)
    const sentAt = new Date().toISOString()
    const { error: messageUpdateError } = await supabaseAdmin
        .from("client_messages")
        .update({
            status: "sent",
            provider_message_id: whatsappMessageId,
            whatsapp_message_id: whatsappMessageId,
            raw_payload: {
                client_sale_id: saleId,
                template_name: templateName,
                template_language: languageCode,
                consent_claimed_at: claimStartedAt,
                meta_response: templateMessage,
            },
        })
        .eq("id", messageLog.id)
        .eq("workspace_id", sale.workspace_id)

    const { data: finalizedSale, error: finalizeError } = await supabaseAdmin
        .from("client_sales")
        .update({
            status: awaitingStatus,
            consent_template_sent_at: sentAt,
            consent_template_message_id: whatsappMessageId,
            updated_at: sentAt,
        })
        .eq("id", saleId)
        .eq("workspace_id", sale.workspace_id)
        .eq("status", sendingStatus)
        .eq("updated_at", claimStartedAt)
        .select("id")
        .maybeSingle()
    if (finalizeError || !finalizedSale) {
        const message = finalizeError?.message ?? "WhatsApp consent send claim changed before it was finalized"
        await reportSaleAutomationFailure(sale, "finalize_consent_send", message)
        return { ok: false, error: message }
    }

    if (messageUpdateError) {
        // Meta confirmed delivery, so the sale must stay advanced to prevent a
        // duplicate template. Maintenance retains the message-log repair signal.
        await reportSaleAutomationFailure(sale, "record_consent_send", messageUpdateError.message)
    }

    await recordAdminActivity({ workspaceId: sale.workspace_id, category: "communications", eventKey: "whatsapp.consent_template.sent", summary: "WhatsApp consent template sent", entityType: "client_sale", entityId: saleId, direction: "outbound", metadata: { relationship_id: sale.relationship_id, client_id: sale.client_id, message_log_id: messageLog.id, message_log_updated: !messageUpdateError, whatsapp_message_id: whatsappMessageId } })

    return {
        ok: true,
        whatsappMessageId,
    }
}

export async function handlePaidStripeInvoice(invoice: StripeInvoiceLike, expectedWorkspaceId: string) {
    const invoiceId = typeof invoice.id === "string" ? invoice.id : null
    const saleId =
        typeof invoice.metadata?.client_sale_id === "string"
            ? invoice.metadata.client_sale_id
            : null

    if (!saleId && !invoiceId) {
        return { ok: true, skipped: true, reason: "not_betelgeze_invoice" as const }
    }

    let sale: ClientSale | undefined
    try {
        sale = await loadSaleForPaidInvoice(expectedWorkspaceId, saleId, invoiceId)
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Could not load sale" }
    }

    if (!sale) {
        // A shared Stripe account can receive payments for invoices created
        // outside Betelgeze. Only a Betelgeze sale reference should turn a
        // missing sale into an automation failure; an unrelated invoice is a
        // successful no-op.
        return saleId
            ? { ok: false, error: "Betelgeze invoice references an unknown sale" }
            : { ok: true, skipped: true, reason: "not_betelgeze_invoice" as const }
    }

    // Stripe commonly delivers invoice.paid and invoice.payment_succeeded at
    // nearly the same time. Claim the pre-payment state atomically so the
    // second event cannot reset consent_template_sending back to paid.
    const { data: claimedPaidSale, error: claimPaidError } = await supabaseAdmin
        .from("client_sales")
        .update({
            status: "paid",
            stripe_invoice_status:
                typeof invoice.status === "string" ? invoice.status : "paid",
            stripe_customer_id:
                typeof invoice.customer === "string" ? invoice.customer : null,
            stripe_hosted_invoice_url:
                typeof invoice.hosted_invoice_url === "string"
                    ? invoice.hosted_invoice_url
                    : null,
            stripe_invoice_pdf:
                typeof invoice.invoice_pdf === "string"
                    ? invoice.invoice_pdf
                    : null,
            raw_payload: invoice,
            updated_at: new Date().toISOString(),
        })
        .eq("id", sale.id)
        .eq("workspace_id", expectedWorkspaceId)
        .eq("status", "invoice_sent")
        .select("id")
        .maybeSingle()

    if (claimPaidError) {
        return { ok: false, error: claimPaidError.message }
    }

    const resumableStatuses = new Set([
        "paid",
        "paid_consent_template_failed",
        "onboarding_link_failed",
        ...CONSENT_TEMPLATE_SENDING_STATUSES,
        ...CONSENT_TEMPLATE_TERMINAL_STATUSES,
    ])
    if (!claimedPaidSale && !resumableStatuses.has(sale.status)) return { ok: true, skipped: true, correlationId: sale.correlation_id ?? sale.id }

    let onboardingSession: Awaited<ReturnType<typeof ensurePaidOnboardingSession>>
    try {
        onboardingSession = await ensurePaidOnboardingSession(sale)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Could not create paid onboarding session"
        await reportSaleAutomationFailure(sale, "create_paid_onboarding_session", message)
        return { ok: false, error: message }
    }

    if (onboardingSession.relationshipId) {
        await completePaymentStage({ workspaceId: sale.workspace_id, relationshipId: onboardingSession.relationshipId })
    }

    const consent = await sendSaleConsentTemplate(sale.id, sale.workspace_id)
    return {
        ...consent,
        onboardingSessionId: onboardingSession.sessionId,
        sessionCreated: onboardingSession.created,
        correlationId: sale.correlation_id ?? sale.id,
    }
}

async function findPendingConfirmedSale(fromAddress: string) {
    const equivalentAddresses = getEquivalentSalePhoneAddresses(fromAddress)
    const statuses = [
        "test_paid",
        "paid",
        "paid_awaiting_whatsapp_confirm",
        "paid_consent_template_failed",
        "whatsapp_confirmed",
        "onboarding_created",
        "onboarding_link_failed",
        "manual_consent_pending",
        "manual_consent_template_failed",
        "manual_awaiting_whatsapp_confirm",
    ]
    const snapshotResult = await supabaseAdmin
        .from("client_sales")
        .select(
            "id, client_id, relationship_id, client_name, client_email, client_phone, service_keys, project_timeframe_days, status, raw_payload, workspace_id, created_by, correlation_id, onboarding_session_id, snapshot_frozen_at"
        )
        .in("client_phone", equivalentAddresses)
        .in("status", statuses)
        .order("created_at", { ascending: false })
        .limit(50)
    if (!snapshotResult.error) return firstUnarchivedRelationshipSale(snapshotResult.data ?? [])
    if (!isMissingOnboardingRuntimeColumn(snapshotResult.error)) throw new Error(snapshotResult.error.message)

    const { data: legacySales, error } = await supabaseAdmin
        .from("client_sales")
        .select("id, client_id, relationship_id, client_name, client_email, client_phone, service_keys, project_timeframe_days, status, raw_payload, workspace_id, created_by")
        .in("client_phone", equivalentAddresses)
        .in("status", statuses)
        .order("created_at", { ascending: false })
        .limit(50)
    if (error) throw new Error(error.message)
    return firstUnarchivedRelationshipSale(legacySales ?? [])
}

async function firstUnarchivedRelationshipSale(candidates: Array<Record<string, unknown>>) {
    const relationshipIds = [...new Set(candidates.flatMap((candidate) => (
        typeof candidate.relationship_id === "string" ? [candidate.relationship_id] : []
    )))]
    if (!relationshipIds.length) return (candidates[0] as ClientSale | undefined) ?? null

    const { data: relationships, error } = await supabaseAdmin
        .from("relationships")
        .select("id, status")
        .in("id", relationshipIds)
    if (error) throw new Error(error.message)
    const statusById = new Map((relationships ?? []).map((relationship) => [relationship.id, relationship.status]))

    return (candidates.find((candidate) => (
        typeof candidate.relationship_id !== "string"
        || statusById.get(candidate.relationship_id) !== "archived"
    )) as ClientSale | undefined) ?? null
}

async function enqueueOnboardingLinkDelivery(input: {
    sale: ClientSale
    relationshipId: string
    sessionId: string
    destination: string
    message: string
}) {
    const correlationId = input.sale.correlation_id ?? input.sale.id
    const { data, error } = await supabaseAdmin.rpc("enqueue_onboarding_link_delivery", {
        p_workspace_id: input.sale.workspace_id,
        p_sale_id: input.sale.id,
        p_relationship_id: input.relationshipId,
        p_session_id: input.sessionId,
        p_destination: input.destination,
        p_body: input.message.slice(0, 2_000),
        p_correlation_id: correlationId,
        p_idempotency_key: `onboarding-link:${input.sale.id}`,
    })
    if (error) {
        if (isMissingOnboardingLinkOutboxRpc(error)) return { supported: false as const }
        throw new Error(error.message)
    }
    const outcome = data && typeof data === "object" ? data as Record<string, unknown> : {}
    const outboxId = typeof outcome.outbox_id === "string" ? outcome.outbox_id : null
    if (!outboxId) throw new Error("Onboarding link outbox RPC returned an incomplete result")
    let processing: Awaited<ReturnType<typeof processWorkspaceOnboardingOutbox>> | null = null
    try {
        processing = await processWorkspaceOnboardingOutbox(input.sale.workspace_id, 25)
    } catch (processingError) {
        await reportSaleAutomationFailure(
            input.sale,
            "wake_onboarding_link_outbox",
            processingError instanceof Error ? processingError.message : "Could not wake onboarding link delivery"
        )
    }
    return {
        supported: true as const,
        outboxId,
        created: outcome.created === true,
        status: typeof outcome.status === "string" ? outcome.status : "queued",
        processing,
    }
}

async function sendLegacyOnboardingLink(input: {
    sale: ClientSale
    clientId: string | null
    relationshipId: string
    destination: string
    onboardingUrl: string
}) {
    const outboundBody = [
        `Thanks ${input.sale.client_name}. Your onboarding link is ready:`,
        input.onboardingUrl,
    ].join("\n\n")
    const { data: messageLog, error: messageLogError } = await supabaseAdmin
        .from("client_messages")
        .insert({
            workspace_id: input.sale.workspace_id,
            client_id: input.clientId,
            relationship_id: input.relationshipId,
            direction: "outbound",
            provider: "meta_whatsapp",
            to_address: input.destination,
            body: outboundBody,
            status: "sending",
            raw_payload: {
                client_sale_id: input.sale.id,
                onboarding_url: input.onboardingUrl,
            },
        })
        .select("id")
        .single()
    if (messageLogError || !messageLog) {
        const errorMessage = messageLogError?.message ?? "Could not create onboarding link message log"
        await reportSaleAutomationFailure(input.sale, "create_legacy_onboarding_link_log", errorMessage)
        return { handled: true as const, ok: false as const, error: errorMessage, legacyDelivery: true as const }
    }

    try {
        const message = await sendMetaWhatsAppMessage({ to: input.destination, body: outboundBody })
        const whatsappMessageId = getWhatsAppMessageId(message)
        const [messageUpdate, saleUpdate] = await Promise.all([
            supabaseAdmin.from("client_messages").update({
                status: "sent",
                provider_message_id: whatsappMessageId,
                whatsapp_message_id: whatsappMessageId,
            }).eq("id", messageLog.id).eq("workspace_id", input.sale.workspace_id),
            supabaseAdmin.from("client_sales").update({
                status: "onboarding_link_sent",
                onboarding_link_sent_at: new Date().toISOString(),
                onboarding_link_message_id: whatsappMessageId,
                updated_at: new Date().toISOString(),
            }).eq("id", input.sale.id).eq("workspace_id", input.sale.workspace_id),
        ])
        if (saleUpdate.error) {
            await reportSaleAutomationFailure(input.sale, "finalize_legacy_onboarding_link", saleUpdate.error.message)
            return { handled: true as const, ok: false as const, error: saleUpdate.error.message, legacyDelivery: true as const }
        }
        if (messageUpdate.error) await reportSaleAutomationFailure(input.sale, "record_legacy_onboarding_link", messageUpdate.error.message)
        return { handled: true as const, ok: true as const, legacyDelivery: true as const }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown onboarding link send error"
        await Promise.all([
            supabaseAdmin.from("client_messages").update({ status: "send_failed", error: errorMessage }).eq("id", messageLog.id).eq("workspace_id", input.sale.workspace_id),
            supabaseAdmin.from("client_sales").update({ status: "onboarding_link_failed", updated_at: new Date().toISOString() }).eq("id", input.sale.id).eq("workspace_id", input.sale.workspace_id),
        ])
        return { handled: true as const, ok: false as const, error: errorMessage, legacyDelivery: true as const }
    }
}

export async function handleSaleConsentConfirmation({
    fromAddress,
    messageId,
    body,
    rawPayload,
}: ConfirmationInput) {
    if (!isConsentConfirmationText(body)) {
        return { handled: false }
    }

    const sale = await findPendingConfirmedSale(fromAddress)

    if (!sale) return { handled: false }

    const flow = getSaleFlow(sale.raw_payload)

    let clientId = sale.client_id
    let relationshipId = sale.relationship_id
    let onboardingUrl: string | null = null
    let onboardingSessionId = sale.onboarding_session_id ?? null
    let durableOutboxSchemaAvailable = Object.prototype.hasOwnProperty.call(
        sale,
        "onboarding_session_id"
    )
    const { data: relationship } = relationshipId
        ? await supabaseAdmin
            .from("relationships")
            .select("source_metadata")
            .eq("workspace_id", sale.workspace_id)
            .eq("id", relationshipId)
            .maybeSingle()
        : { data: null }
    const isTestRelationship = Boolean(
        relationship?.source_metadata &&
        typeof relationship.source_metadata === "object" &&
        relationship.source_metadata.is_test === true
    )

    if (!clientId && flow === "paid") {
        const { data: workspace } = await supabaseAdmin
            .from("workspaces")
            .select("slug, custom_onboarding_domain, custom_onboarding_domain_status")
            .eq("id", sale.workspace_id)
            .single()
        if (!workspace) return { handled: false }
        try {
            const onboarding = await ensurePaidOnboardingSession(sale)
            relationshipId = onboarding.relationshipId
            onboardingSessionId = onboarding.sessionId
            onboardingUrl = getOnboardingUrl(
                workspace.slug,
                onboarding.sessionToken,
                workspace.custom_onboarding_domain,
                workspace.custom_onboarding_domain_status === "verified"
            )
        } catch (error) {
            const message = error instanceof Error ? error.message : "Could not resume paid onboarding"
            await reportSaleAutomationFailure(sale, "resume_paid_onboarding", message)
            return { handled: true, ok: false, error: message }
        }
        const { error: consentUpdateError } = await supabaseAdmin
            .from("client_sales")
            .update({
                relationship_id: relationshipId,
                client_phone: fromAddress,
                status: "onboarding_created",
                consent_confirmed_at: new Date().toISOString(),
                consent_confirmed_message_id: messageId ?? null,
                updated_at: new Date().toISOString(),
            })
            .eq("id", sale.id)
            .eq("workspace_id", sale.workspace_id)
        if (consentUpdateError) {
            await reportSaleAutomationFailure(sale, "record_paid_consent_confirmation", consentUpdateError.message)
            return { handled: true, ok: false, error: consentUpdateError.message }
        }
    } else if (!clientId) {
        const { data: workspace } = await supabaseAdmin
            .from("workspaces")
            .select("slug, custom_onboarding_domain, custom_onboarding_domain_status")
            .eq("id", sale.workspace_id)
            .single()
        if (!workspace) return { handled: false }
        const client = await createOnboardingClient({
            workspaceId: sale.workspace_id,
            workspaceSlug: workspace.slug,
            customOnboardingDomain: workspace.custom_onboarding_domain,
            customOnboardingDomainVerified: workspace.custom_onboarding_domain_status === "verified",
            name: sale.client_name,
            email: sale.client_email,
            phone: fromAddress,
            relationshipId,
            serviceKeys:
                flow === "manual_migration"
                    ? []
                    : asStringArray(sale.service_keys).filter(
                          (serviceKey) => serviceKey in SERVICES
                      ),
            projectTimeframeDays: sale.project_timeframe_days,
            isTest: isTestRelationship,
            createClickUpResources: false,
            createOnboardingModules: flow !== "manual_migration",
            createOnboardingWork: flow !== "manual_migration",
            activitySource:
                flow === "manual_migration"
                    ? "Manual client migration"
                    : `Stripe sale ${sale.id}`,
            createdBy: sale.created_by,
        })
        clientId = null
        relationshipId = client.relationshipId
        if (flow === "paid") onboardingSessionId = client.id
        onboardingUrl = client.onboardingUrl

        const { error: consentUpdateError } = await supabaseAdmin
            .from("client_sales")
            .update({
                relationship_id: relationshipId,
                client_phone: fromAddress,
                status:
                    flow === "manual_migration"
                        ? "manual_workspace_created"
                        : "onboarding_created",
                consent_confirmed_at: new Date().toISOString(),
                consent_confirmed_message_id: messageId ?? null,
                updated_at: new Date().toISOString(),
            })
            .eq("id", sale.id)
            .eq("workspace_id", sale.workspace_id)
        if (consentUpdateError) {
            await reportSaleAutomationFailure(sale, "record_consent_confirmation", consentUpdateError.message)
            return { handled: true, ok: false, error: consentUpdateError.message }
        }
    } else {
        const { data: client } = await supabaseAdmin
            .from("clients")
            .select("session_token, workspace_id, relationship_id")
            .eq("id", clientId)
            .eq("workspace_id", sale.workspace_id)
            .single()
        relationshipId = client?.relationship_id ?? relationshipId

        const { data: workspace } = client
            ? await supabaseAdmin.from("workspaces").select("slug, custom_onboarding_domain, custom_onboarding_domain_status").eq("id", client.workspace_id).single()
            : { data: null }
        onboardingUrl = client?.session_token && workspace
            ? getOnboardingUrl(workspace.slug, client.session_token, workspace.custom_onboarding_domain, workspace.custom_onboarding_domain_status === "verified")
            : null

        const { error: consentUpdateError } = await supabaseAdmin
            .from("client_sales")
            .update({
                relationship_id: relationshipId,
                status:
                    flow === "manual_migration"
                        ? "manual_workspace_created"
                        : "onboarding_created",
                consent_confirmed_at: new Date().toISOString(),
                consent_confirmed_message_id: messageId ?? null,
                updated_at: new Date().toISOString(),
            })
            .eq("id", sale.id)
            .eq("workspace_id", sale.workspace_id)
        if (consentUpdateError) {
            await reportSaleAutomationFailure(sale, "record_consent_confirmation", consentUpdateError.message)
            return { handled: true, ok: false, error: consentUpdateError.message }
        }
    }

    if (relationshipId && flow === "manual_migration") {
        await supabaseAdmin
            .from("relationships")
            .update({
                lifecycle_phase: "onboarding",
                started_onboarding_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq("id", relationshipId)
            .eq("workspace_id", sale.workspace_id)
    }

    const { error: inboundMessageError } = await supabaseAdmin.from("client_messages").insert({
        workspace_id: sale.workspace_id,
        client_id: clientId,
        relationship_id: relationshipId,
        direction: "inbound",
        provider: "meta_whatsapp",
        provider_message_id: messageId ?? null,
        whatsapp_message_id: messageId ?? null,
        from_address: fromAddress,
        body,
        status: "whatsapp_consent_confirmed",
        raw_payload: rawPayload,
    })
    if (inboundMessageError && flow === "paid") {
        await reportSaleAutomationFailure(sale, "record_consent_message", inboundMessageError.message)
        return { handled: true, ok: false, error: inboundMessageError.message }
    }

    if (flow === "manual_migration") {
        await addSaleActivity(
            sale.workspace_id,
            sale.id,
            "WhatsApp confirmed; relationship workspace is ready for manual migration"
        )
        return { handled: true, ok: true }
    }

    if (!relationshipId) return { handled: true, ok: false, error: "Onboarding relationship missing" }
    if (!onboardingSessionId) {
        const sessionResult = await supabaseAdmin.from("relationship_onboarding_sessions")
            .select("id")
            .eq("workspace_id", sale.workspace_id)
            .eq("relationship_id", relationshipId)
            .in("status", ["active", "completed"])
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        if (!sessionResult.error) {
            onboardingSessionId = sessionResult.data?.id ?? null
            if (!onboardingSessionId && durableOutboxSchemaAvailable) {
                const message = "Paid onboarding session missing after consent confirmation"
                await reportSaleAutomationFailure(sale, "resolve_onboarding_link_session", message)
                return { handled: true, ok: false, error: message }
            }
        }
        else if (!isMissingOnboardingRuntimeColumn(sessionResult.error)) {
            const message = sessionResult.error.message
            await reportSaleAutomationFailure(sale, "resolve_onboarding_link_session", message)
            return { handled: true, ok: false, error: message }
        } else {
            durableOutboxSchemaAvailable = false
        }
    }

    if (onboardingSessionId) {
        try {
            const queued = await enqueueOnboardingLinkDelivery({
                sale,
                relationshipId,
                sessionId: onboardingSessionId,
                destination: fromAddress,
                message: `Thanks ${sale.client_name}. Your onboarding link is ready:`,
            })
            if (queued.supported) {
                return {
                    handled: true,
                    ok: true,
                    queued: true,
                    outboxId: queued.outboxId,
                    created: queued.created,
                }
            }
            durableOutboxSchemaAvailable = false
        } catch (error) {
            const message = error instanceof Error ? error.message : "Could not queue onboarding link delivery"
            await reportSaleAutomationFailure(sale, "enqueue_onboarding_link", message)
            return { handled: true, ok: false, error: message }
        }
    }

    if (durableOutboxSchemaAvailable) {
        const message = "Paid onboarding session is unavailable for durable link delivery"
        await reportSaleAutomationFailure(sale, "resolve_onboarding_link_session", message)
        return { handled: true, ok: false, error: message }
    }

    if (!onboardingUrl) {
        await addSaleActivity(sale.workspace_id, sale.id, "WhatsApp confirmed but onboarding URL missing")
        return { handled: true, ok: false, error: "Onboarding URL missing" }
    }

    // Rolling-deploy compatibility: databases without the durable outbox RPC
    // retain the existing direct delivery behavior until migrations arrive.
    return sendLegacyOnboardingLink({
        sale,
        clientId,
        relationshipId,
        destination: fromAddress,
        onboardingUrl,
    })
}
