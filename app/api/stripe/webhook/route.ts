import { NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import {
    StripeWebhookEvent,
    verifyStripeWebhookSignature,
} from "@/lib/stripe/api"
import { handleCompletedStripeCheckout, handlePaidStripeInvoice } from "@/lib/client-sales/automation"
import { disconnectWorkspaceIntegration, getStripeWebhookCandidates, getWorkspaceIdForConnectedAccount, recordWorkspaceConnectionWebhook } from "@/lib/workspace-integrations"
import { platformFailureFingerprint, reportPlatformFailure } from "@/lib/admin/maintenance"
import { recordAdminActivity } from "@/lib/admin/activity"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isPaidInvoiceEvent(type: string) {
    // Stripe can emit either event for a successful invoice payment. Both
    // contain the invoice object and must advance the same sale workflow.
    return type === "invoice.paid" || type === "invoice.payment_succeeded"
}

function isResumableAutomationEvent(type: string) {
    return isPaidInvoiceEvent(type)
        || type === "account.application.deauthorized"
        || type === "checkout.session.completed"
        || type === "checkout.session.async_payment_succeeded"
        || type.startsWith("customer.subscription.")
        || ["invoice.payment_failed", "invoice.payment_action_required", "invoice.voided", "invoice.marked_uncollectible"].includes(type)
}

function stripeObjectSaleId(value: Record<string, unknown> | undefined) {
    if (!value) return null
    const metadata = value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
        ? value.metadata as Record<string, unknown>
        : null
    if (typeof metadata?.client_sale_id === "string") return metadata.client_sale_id
    const parent = value.parent && typeof value.parent === "object" && !Array.isArray(value.parent)
        ? value.parent as Record<string, unknown>
        : null
    const parentDetails = parent?.subscription_details && typeof parent.subscription_details === "object" && !Array.isArray(parent.subscription_details)
        ? parent.subscription_details as Record<string, unknown>
        : null
    const legacyDetails = value.subscription_details && typeof value.subscription_details === "object" && !Array.isArray(value.subscription_details)
        ? value.subscription_details as Record<string, unknown>
        : null
    for (const details of [parentDetails, legacyDetails]) {
        const detailsMetadata = details?.metadata && typeof details.metadata === "object" && !Array.isArray(details.metadata)
            ? details.metadata as Record<string, unknown>
            : null
        if (typeof detailsMetadata?.client_sale_id === "string") return detailsMetadata.client_sale_id
    }
    return null
}

function stripeObjectId(value: unknown) {
    if (typeof value === "string") return value
    return value && typeof value === "object" && !Array.isArray(value) && typeof (value as { id?: unknown }).id === "string"
        ? (value as { id: string }).id
        : null
}

function stripeObjectSubscriptionId(value: Record<string, unknown> | undefined) {
    if (!value) return null
    const direct = stripeObjectId(value.subscription)
    if (direct) return direct
    const parent = value.parent && typeof value.parent === "object" && !Array.isArray(value.parent)
        ? value.parent as Record<string, unknown>
        : null
    for (const source of [parent?.subscription_details, value.subscription_details]) {
        if (source && typeof source === "object" && !Array.isArray(source)) {
            const id = stripeObjectId((source as Record<string, unknown>).subscription)
            if (id) return id
        }
    }
    return null
}

function isMissingStripeStatusRpc(error: { code?: string; message?: string } | null | undefined) {
    const message = error?.message?.toLowerCase() ?? ""
    return error?.code === "42883" || error?.code === "PGRST202" || (
        message.includes("record_stripe_invoice_status_event") && (
            message.includes("schema cache") || message.includes("does not exist")
        )
    )
}

async function reportStripeAutomationFailure(workspaceId: string, eventId: string, operation: string, error: string) {
    const { data: workspace } = await supabaseAdmin.from("workspaces").select("slug").eq("id", workspaceId).maybeSingle()
    await reportPlatformFailure({
        workspaceId,
        category: "billing",
        source: "stripe_webhook",
        operation,
        fingerprint: platformFailureFingerprint(["stripe", operation, error]),
        severity: "warning",
        summary: "Stripe automation could not process an event",
        diagnostics: { stripe_event_id: eventId, error },
        sourceHref: workspace?.slug ? `/${workspace.slug}/settings#connections` : null,
    })
}

export async function POST(request: NextRequest) {
    const payload = await request.text()
    const signature = request.headers.get("stripe-signature")
    let event: StripeWebhookEvent
    try {
        event = JSON.parse(payload) as StripeWebhookEvent
    } catch {
        return Response.json({ error: "Invalid Stripe event payload" }, { status: 400 })
    }
    const candidates = await getStripeWebhookCandidates()
    const matchedCandidate = candidates.find((candidate) =>
        (candidate.livemode === null || candidate.livemode === event.livemode) &&
        verifyStripeWebhookSignature({ payload, signatureHeader: signature, secret: candidate.webhookSecret })
    )
    if (!matchedCandidate) {
        return Response.json({ error: "Invalid signature" }, { status: 400 })
    }

    const invoice = event.data?.object
    const saleId = stripeObjectSaleId(invoice)
    const { data: sale } = saleId
        ? await supabaseAdmin.from("client_sales").select("workspace_id, billing_model, initial_payment_received_at, status, stripe_subscription_id, checkout_flow").eq("id", saleId).maybeSingle()
        : { data: null }
    const externalAccountId = event.account ?? event.context ?? null
    const connectedWorkspaceId = matchedCandidate.shared && externalAccountId
        ? await getWorkspaceIdForConnectedAccount("stripe", externalAccountId)
        : null
    if (sale?.workspace_id && connectedWorkspaceId && sale.workspace_id !== connectedWorkspaceId) {
        return Response.json({ error: "Stripe event account does not own the referenced Betelgeze sale" }, { status: 400 })
    }
    const workspaceId = matchedCandidate.shared
        ? connectedWorkspaceId
        : sale?.workspace_id ?? matchedCandidate.workspaceId

    if (!workspaceId) {
        return Response.json({ ok: true, ignored: true, reason: "unresolved_workspace" })
    }
    if (matchedCandidate.workspaceId && workspaceId !== matchedCandidate.workspaceId) {
        return Response.json({ error: "Could not resolve workspace for Stripe event" }, { status: 500 })
    }
    await recordWorkspaceConnectionWebhook(workspaceId, "stripe")
    const { error: eventInsertError } = await supabaseAdmin
        .from("stripe_events")
        .insert({
            id: event.id,
            event_type: event.type,
            raw_payload: event,
            workspace_id: workspaceId,
        })

    const duplicateEvent = eventInsertError?.code === "23505" || eventInsertError?.message.toLowerCase().includes("duplicate") === true
    if (eventInsertError && !duplicateEvent) {

        await reportStripeAutomationFailure(workspaceId, event.id, "record_event", eventInsertError.message)

        return Response.json(
            { error: `Could not record Stripe event: ${eventInsertError.message}` },
            { status: 500 }
        )
    }

    if (duplicateEvent && !isResumableAutomationEvent(event.type)) return Response.json({ ok: true, duplicate: true })

    if (!duplicateEvent) await recordAdminActivity({ workspaceId, category: "billing", eventKey: "stripe.webhook.received", summary: `Stripe event received: ${event.type}`, entityType: "stripe_event", entityId: event.id, direction: "inbound", metadata: { event_type: event.type, sale_id: saleId } })

    if (event.type === "account.application.deauthorized") {
        await disconnectWorkspaceIntegration(workspaceId, "stripe")
        await recordAdminActivity({
            workspaceId,
            category: "billing",
            level: "warning",
            eventKey: "stripe.connection.deauthorized",
            summary: "Stripe disconnected the workspace authorization",
            entityType: "stripe_account",
            entityId: externalAccountId ?? event.id,
            actorKind: "automation",
            correlationId: event.id,
            idempotencyKey: `stripe.connection.deauthorized:${event.id}`,
            outcome: "succeeded",
            metadata: { stripe_event_id: event.id, account_id: externalAccountId },
        })
    } else if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
        const checkout = event.data?.object
        if (saleId && checkout) {
            const checkoutId = stripeObjectId(checkout.id)
            const subscriptionId = stripeObjectId(checkout.subscription)
            const { error } = await supabaseAdmin.from("client_sales").update({
                stripe_checkout_session_id: checkoutId,
                stripe_checkout_status: typeof checkout.status === "string" ? checkout.status : "complete",
                stripe_subscription_id: subscriptionId,
                stripe_subscription_status: subscriptionId ? "active" : null,
                stripe_customer_id: stripeObjectId(checkout.customer),
                raw_payload: event,
                updated_at: new Date().toISOString(),
            }).eq("workspace_id", workspaceId).eq("id", saleId)
            if (error) {
                await reportStripeAutomationFailure(workspaceId, event.id, "record_checkout_completion", error.message)
                return Response.json({ error: "Could not record Checkout completion" }, { status: 500 })
            }
            if (sale?.checkout_flow === "onboarding_payment_gate") {
                const result = await handleCompletedStripeCheckout(checkout, workspaceId)
                if (!result.ok) {
                    await reportStripeAutomationFailure(workspaceId, event.id, "checkout_payment_automation", result.error ?? "Could not unlock onboarding")
                    return Response.json({ error: result.error ?? "Could not unlock onboarding" }, { status: 500 })
                }
            }
            await recordAdminActivity({ workspaceId, category: "billing", eventKey: "stripe.checkout.completed", summary: "Stripe Checkout completed", entityType: "stripe_checkout_session", entityId: checkoutId ?? event.id, actorKind: "automation", correlationId: event.id, idempotencyKey: `stripe.checkout.completed:${event.id}`, outcome: "succeeded", metadata: { sale_id: saleId, subscription_id: subscriptionId } })
        }
    } else if (event.type.startsWith("customer.subscription.")) {
        const subscription = event.data?.object
        const subscriptionId = stripeObjectId(subscription?.id)
        if (subscriptionId) {
            const status = typeof subscription?.status === "string" ? subscription.status : null
            const update = { stripe_subscription_id: subscriptionId, stripe_subscription_status: status, raw_payload: event, updated_at: new Date().toISOString() }
            const query = supabaseAdmin.from("client_sales").update(update).eq("workspace_id", workspaceId)
            const { error } = saleId ? await query.eq("id", saleId) : await query.eq("stripe_subscription_id", subscriptionId)
            if (error) {
                await reportStripeAutomationFailure(workspaceId, event.id, "record_subscription_status", error.message)
                return Response.json({ error: "Could not record subscription status" }, { status: 500 })
            }
            await recordAdminActivity({ workspaceId, category: "billing", level: event.type === "customer.subscription.deleted" ? "warning" : "info", eventKey: event.type === "customer.subscription.deleted" ? "stripe.subscription.cancelled" : "stripe.subscription.updated", summary: event.type === "customer.subscription.deleted" ? "Recurring retainer cancelled" : "Recurring retainer status updated", entityType: "stripe_subscription", entityId: subscriptionId, actorKind: "automation", correlationId: event.id, idempotencyKey: `stripe.subscription.status:${event.id}`, outcome: "succeeded", metadata: { sale_id: saleId, subscription_status: status, event_type: event.type } })
        }
    } else if (isPaidInvoiceEvent(event.type)) {
        if (!invoice) {
            await reportStripeAutomationFailure(workspaceId, event.id, "paid_invoice_payload", "Paid invoice event missing invoice object")
            return Response.json(
                { error: "Paid invoice event missing invoice object" },
                { status: 400 }
            )
        }

        const result = await handlePaidStripeInvoice(invoice, workspaceId)

        if (!result?.ok) {
            const error =
                result && "error" in result
                    ? result.error ?? "Could not process paid invoice"
                    : "Could not process paid invoice"

            await reportStripeAutomationFailure(workspaceId, event.id, "paid_invoice_automation", error)

            return Response.json(
                {
                    error,
                },
                { status: 500 }
            )
        }
        if ("reason" in result && result.reason === "not_betelgeze_invoice") {
            await recordAdminActivity({
                workspaceId,
                category: "billing",
                eventKey: "stripe.invoice.paid_ignored",
                summary: "Non-Betelgeze Stripe invoice payment ignored",
                entityType: "stripe_invoice",
                entityId: typeof (invoice as { id?: unknown }).id === "string"
                    ? (invoice as { id: string }).id
                    : event.id,
                actorKind: "automation",
                correlationId: event.id,
                idempotencyKey: `stripe.invoice.paid_ignored:${event.id}`,
                outcome: "skipped",
                metadata: {
                    stripe_event_id: event.id,
                    duplicate_event: duplicateEvent,
                    reason: result.reason,
                },
            })
            return Response.json({ ok: true, ignored: true, duplicate: duplicateEvent })
        }
        await recordAdminActivity({
            workspaceId,
            category: "billing",
            eventKey: "stripe.invoice.paid_processed",
            summary: duplicateEvent ? "Paid invoice automation resumed and completed" : "Paid invoice automation processed",
            entityType: "stripe_event",
            entityId: event.id,
            actorKind: "automation",
            correlationId: "correlationId" in result ? result.correlationId : saleId,
            idempotencyKey: `stripe.invoice.paid_processed:${event.id}`,
            outcome: "succeeded",
            metadata: { sale_id: saleId, duplicate_resume: duplicateEvent, skipped: "skipped" in result ? Boolean(result.skipped) : false, onboarding_session_id: "onboardingSessionId" in result ? result.onboardingSessionId : null },
        })
    } else if (
        event.type === "invoice.payment_failed" ||
        event.type === "invoice.payment_action_required" ||
        event.type === "invoice.voided" ||
        event.type === "invoice.marked_uncollectible"
    ) {
        const invoice = event.data?.object as
            | {
                  id?: unknown
                  status?: unknown
              }
            | undefined
        const invoiceId = typeof invoice?.id === "string" ? invoice.id : null

        if (invoiceId) {
            const nextSaleStatus = event.type === "invoice.payment_failed" || event.type === "invoice.payment_action_required" ? "payment_failed" : "invoice_inactive"
            const invoiceStatus = typeof invoice?.status === "string" ? invoice.status : null
            if (saleId && sale?.billing_model === "recurring") {
                const renewalFailure = Boolean(sale.initial_payment_received_at)
                const subscriptionId = stripeObjectSubscriptionId(invoice as Record<string, unknown> | undefined)
                    ?? sale.stripe_subscription_id
                const { error: recurringError } = await supabaseAdmin.from("client_sales").update({
                    ...(renewalFailure ? {} : { status: nextSaleStatus, stripe_invoice_id: invoiceId, stripe_invoice_status: invoiceStatus }),
                    stripe_subscription_id: subscriptionId,
                    stripe_subscription_status: event.type === "invoice.payment_failed" || event.type === "invoice.payment_action_required" ? "past_due" : invoiceStatus,
                    latest_invoice_id: invoiceId,
                    latest_invoice_status: invoiceStatus,
                    raw_payload: event,
                    updated_at: new Date().toISOString(),
                }).eq("id", saleId).eq("workspace_id", workspaceId)
                if (recurringError) {
                    await reportStripeAutomationFailure(workspaceId, event.id, "update_subscription_invoice_status", recurringError.message)
                    return Response.json({ error: "Could not update recurring payment status" }, { status: 500 })
                }
                await recordAdminActivity({ workspaceId, category: "billing", level: "warning", eventKey: renewalFailure ? "stripe.subscription.renewal_failed" : "stripe.subscription.initial_payment_failed", summary: renewalFailure ? "Recurring retainer renewal failed" : "Initial recurring retainer payment failed", entityType: "stripe_subscription", entityId: subscriptionId ?? invoiceId, actorKind: "automation", correlationId: event.id, idempotencyKey: `stripe.subscription.payment_failed:${event.id}`, outcome: "failed", metadata: { sale_id: saleId, invoice_id: invoiceId, renewal: renewalFailure } })
                return Response.json({ ok: true, duplicate: duplicateEvent })
            }
            const statusRpc = await supabaseAdmin.rpc("record_stripe_invoice_status_event", {
                p_workspace_id: workspaceId,
                p_invoice_id: invoiceId,
                p_stripe_event_id: event.id,
                p_event_type: event.type,
                p_sale_status: nextSaleStatus,
                p_invoice_status: invoiceStatus,
                p_raw_payload: event,
            })
            if (statusRpc.error && isMissingStripeStatusRpc(statusRpc.error)) {
                const { error: saleUpdateError } = await supabaseAdmin
                    .from("client_sales")
                    .update({
                        status: nextSaleStatus,
                        stripe_invoice_status: invoiceStatus,
                        raw_payload: event,
                        updated_at: new Date().toISOString(),
                    })
                    .eq("stripe_invoice_id", invoiceId)
                    .eq("workspace_id", workspaceId)
                if (saleUpdateError) {
                    await reportStripeAutomationFailure(workspaceId, event.id, "update_invoice_status", saleUpdateError.message)
                    return Response.json({ error: "Could not update invoice status" }, { status: 500 })
                }
                await recordAdminActivity({ workspaceId, category: "billing", level: nextSaleStatus === "payment_failed" ? "warning" : "info", eventKey: `stripe.invoice.${event.type.split(".").at(-1)}`, summary: `Invoice status updated: ${nextSaleStatus.replace(/_/g, " ")}`, entityType: "stripe_invoice", entityId: invoiceId, metadata: { stripe_event_id: event.id, event_type: event.type, sale_status: nextSaleStatus } })
            } else if (statusRpc.error) {
                await reportStripeAutomationFailure(workspaceId, event.id, "update_invoice_status", statusRpc.error.message)
                return Response.json({ error: "Could not update invoice status" }, { status: 500 })
            }
        }
    }

    return Response.json({ ok: true, duplicate: duplicateEvent })
}
