import { supabaseAdmin } from "@/lib/supabase/admin"
import { SERVICES } from "@/lib/onboarding/services"
import { createOnboardingClient, getOnboardingUrl } from "@/lib/onboarding/client-creation"
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

const CONSENT_TEMPLATE_TERMINAL_STATUSES = new Set([
    "paid_consent_template_sending",
    "paid_awaiting_whatsapp_confirm",
    "whatsapp_confirmed",
    "onboarding_created",
    "onboarding_link_sent",
    "manual_consent_template_sending",
    "manual_awaiting_whatsapp_confirm",
    "manual_workspace_created",
])

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

function getWhatsAppMessageId(response: unknown) {
    const messages =
        response && typeof response === "object" && !Array.isArray(response)
            ? (response as { messages?: Array<{ id?: string }> }).messages
            : null

    return messages?.[0]?.id ?? null
}

async function addSaleActivity(
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
}

async function reportSaleAutomationFailure(sale: Pick<ClientSale, "id" | "workspace_id" | "relationship_id">, operation: string, error: string) {
    const { data: workspace } = await supabaseAdmin.from("workspaces").select("slug").eq("id", sale.workspace_id).maybeSingle()
    await reportPlatformFailure({ workspaceId: sale.workspace_id, category: "communications", source: "client_sales", operation, fingerprint: platformFailureFingerprint(["client_sales", operation, error]), severity: "warning", summary: "Client sale automation failed", diagnostics: { sale_id: sale.id, relationship_id: sale.relationship_id, error }, sourceHref: workspace?.slug && sale.relationship_id ? `/${workspace.slug}/relationships/${sale.relationship_id}` : null })
}

export async function sendSaleConsentTemplate(saleId: string) {
    const { data: sale } = await supabaseAdmin
        .from("client_sales")
        .select("id, client_phone, status, consent_template_sent_at, raw_payload, workspace_id, relationship_id, client_id")
        .eq("id", saleId)
        .single()

    if (!sale) return { ok: false, error: "Sale not found" }
    const flow = getSaleFlow(sale.raw_payload)
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
                status: getConsentStatus(flow, "failed"),
                updated_at: new Date().toISOString(),
            })
            .eq("id", saleId)

        await reportSaleAutomationFailure(sale, "send_consent_template", "Missing META_WHATSAPP_CONSENT_TEMPLATE_NAME")

        return {
            ok: false,
            error: "Missing META_WHATSAPP_CONSENT_TEMPLATE_NAME",
        }
    }

    const { data: claimedSale, error: claimError } = await supabaseAdmin
        .from("client_sales")
        .update({
            status: getConsentStatus(flow, "sending"),
            updated_at: new Date().toISOString(),
        })
        .eq("id", saleId)
        .is("consent_template_sent_at", null)
        .not(
            "status",
            "in",
            "(paid_consent_template_sending,paid_awaiting_whatsapp_confirm,whatsapp_confirmed,onboarding_created,onboarding_link_sent,manual_consent_template_sending,manual_awaiting_whatsapp_confirm,manual_workspace_created)"
        )
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
            direction: "outbound",
            provider: "meta_whatsapp",
            to_address: sale.client_phone,
            body: "[WhatsApp consent template]",
            status: "sending",
            raw_payload: {
                client_sale_id: saleId,
                template_name: templateName,
                template_language: languageCode,
            },
        })
        .select("id")
        .single()
    if (messageLogError || !messageLog) {
        const message = messageLogError?.message ?? "Could not create WhatsApp message log"
        await reportSaleAutomationFailure(sale, "create_consent_message_log", message)
        return { ok: false, error: message }
    }

    try {
        const templateMessage = await sendMetaWhatsAppTemplate({
            to: sale.client_phone,
            templateName,
            languageCode,
        })
        const whatsappMessageId = getWhatsAppMessageId(templateMessage)

        await Promise.all([
            supabaseAdmin
                .from("client_messages")
                .update({
                    status: "sent",
                    provider_message_id: whatsappMessageId,
                    whatsapp_message_id: whatsappMessageId,
                    raw_payload: {
                        client_sale_id: saleId,
                        template_name: templateName,
                        template_language: languageCode,
                        meta_response: templateMessage,
                    },
                })
                .eq("id", messageLog?.id),
            supabaseAdmin
                .from("client_sales")
                .update({
                    status: getConsentStatus(flow, "awaiting"),
                    consent_template_sent_at: new Date().toISOString(),
                    consent_template_message_id: whatsappMessageId,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", saleId),
        ])

        await recordAdminActivity({ workspaceId: sale.workspace_id, category: "communications", eventKey: "whatsapp.consent_template.sent", summary: "WhatsApp consent template sent", entityType: "client_sale", entityId: saleId, metadata: { relationship_id: sale.relationship_id, client_id: sale.client_id, message_log_id: messageLog.id, whatsapp_message_id: whatsappMessageId } })

        return {
            ok: true,
            whatsappMessageId,
        }
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
                .eq("id", messageLog?.id),
            supabaseAdmin
                .from("client_sales")
                .update({
                    status: getConsentStatus(flow, "failed"),
                    updated_at: new Date().toISOString(),
                })
                .eq("id", saleId),
        ])

        await reportSaleAutomationFailure(sale, "send_consent_template", errorMessage)

        return {
            ok: false,
            error: errorMessage,
        }
    }
}

export async function handlePaidStripeInvoice(invoice: StripeInvoiceLike) {
    const invoiceId = typeof invoice.id === "string" ? invoice.id : null
    const saleId =
        typeof invoice.metadata?.client_sale_id === "string"
            ? invoice.metadata.client_sale_id
            : null

    let query = supabaseAdmin.from("client_sales").select("id, status, workspace_id, relationship_id").limit(1)

    if (saleId) {
        query = query.eq("id", saleId)
    } else if (invoiceId) {
        query = query.eq("stripe_invoice_id", invoiceId)
    } else {
        return { ok: false, error: "Invoice has no sale ID or invoice ID" }
    }

    const { data: sales } = await query
    const sale = sales?.[0]

    if (!sale) return { ok: false, error: "Sale not found for invoice" }

    if (CONSENT_TEMPLATE_TERMINAL_STATUSES.has(sale.status)) {
        return { ok: true, skipped: true }
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

        .eq("status", "invoice_sent")
        .select("id")
        .maybeSingle()

    if (claimPaidError) {
        return { ok: false, error: claimPaidError.message }
    }

    if (!claimedPaidSale) {
        return { ok: true, skipped: true }
    }

    if (sale.relationship_id) {
        await completePaymentStage({ workspaceId: sale.workspace_id, relationshipId: sale.relationship_id })
    }

    return sendSaleConsentTemplate(sale.id)
}

async function findPendingConfirmedSale(fromAddress: string) {
    const equivalentAddresses = getEquivalentSalePhoneAddresses(fromAddress)
    const { data: sales } = await supabaseAdmin
        .from("client_sales")
        .select(
            "id, client_id, relationship_id, client_name, client_email, client_phone, service_keys, project_timeframe_days, status, raw_payload, workspace_id, created_by"
        )
        .in("client_phone", equivalentAddresses)
        .in("status", [
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
        ])
        .order("created_at", { ascending: false })
        .limit(1)

    return (sales?.[0] as ClientSale | undefined) ?? null
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

    if (!clientId) {
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
        onboardingUrl = client.onboardingUrl

        await supabaseAdmin
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
    } else {
        const { data: client } = await supabaseAdmin
            .from("clients")
            .select("session_token, workspace_id, relationship_id")
            .eq("id", clientId)
            .single()
        relationshipId = client?.relationship_id ?? relationshipId

        const { data: workspace } = client
            ? await supabaseAdmin.from("workspaces").select("slug, custom_onboarding_domain, custom_onboarding_domain_status").eq("id", client.workspace_id).single()
            : { data: null }
        onboardingUrl = client?.session_token && workspace
            ? getOnboardingUrl(workspace.slug, client.session_token, workspace.custom_onboarding_domain, workspace.custom_onboarding_domain_status === "verified")
            : null

        await supabaseAdmin
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
    }

    if (relationshipId) {
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

    await supabaseAdmin.from("client_messages").insert({
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

    if (flow === "manual_migration") {
        await addSaleActivity(
            sale.id,
            "WhatsApp confirmed; relationship workspace is ready for manual migration"
        )
        return { handled: true, ok: true }
    }

    if (!onboardingUrl) {
        await addSaleActivity(sale.id, "WhatsApp confirmed but onboarding URL missing")
        return { handled: true, ok: false, error: "Onboarding URL missing" }
    }

    const outboundBody = [
        `Thanks ${sale.client_name}. Your onboarding link is ready:`,
        onboardingUrl,
    ].join("\n\n")
    const { data: messageLog } = await supabaseAdmin
        .from("client_messages")
        .insert({
            client_id: clientId,
            relationship_id: relationshipId,
            direction: "outbound",
            provider: "meta_whatsapp",
            to_address: fromAddress,
            body: outboundBody,
            status: "sending",
            raw_payload: {
                client_sale_id: sale.id,
                onboarding_url: onboardingUrl,
            },
        })
        .select("id")
        .single()

    try {
        const message = await sendMetaWhatsAppMessage({
            to: fromAddress,
            body: outboundBody,
        })
        const whatsappMessageId = getWhatsAppMessageId(message)

        await Promise.all([
            supabaseAdmin
                .from("client_messages")
                .update({
                    status: "sent",
                    provider_message_id: whatsappMessageId,
                    whatsapp_message_id: whatsappMessageId,
                })
                .eq("id", messageLog?.id),
            supabaseAdmin
                .from("client_sales")
                .update({
                    status: "onboarding_link_sent",
                    onboarding_link_sent_at: new Date().toISOString(),
                    onboarding_link_message_id: whatsappMessageId,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", sale.id),
        ])

        return { handled: true, ok: true }
    } catch (error) {
        const errorMessage =
            error instanceof Error
                ? error.message
                : "Unknown onboarding link send error"

        await Promise.all([
            supabaseAdmin
                .from("client_messages")
                .update({
                    status: "send_failed",
                    error: errorMessage,
                })
                .eq("id", messageLog?.id),
            supabaseAdmin
                .from("client_sales")
                .update({
                    status: "onboarding_link_failed",
                    updated_at: new Date().toISOString(),
                })
                .eq("id", sale.id),
        ])

        return { handled: true, ok: false, error: errorMessage }
    }
}
