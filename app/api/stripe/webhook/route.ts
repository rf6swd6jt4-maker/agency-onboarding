import { NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import {
    StripeWebhookEvent,
    verifyStripeWebhookSignature,
} from "@/lib/stripe/api"
import { handleCompletedStripeCheckout } from "@/lib/client-sales/automation"
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
        || type === "checkout.session.async_payment_failed"
        || type === "checkout.session.expired"
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
        ? await supabaseAdmin.from("client_sales").select("workspace_id, initial_payment_received_at, status, stripe_subscription_id, deleted_at").eq("id", saleId).maybeSingle()
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

    if (sale && (sale.deleted_at || sale.status === "retired_billing_model")) {
        await recordAdminActivity({
            workspaceId,
            category: "billing",
            eventKey: "stripe.retired_sale_event_ignored",
            summary: "Stripe event for a retired billing record ignored",
            entityType: "stripe_event",
            entityId: event.id,
            actorKind: "automation",
            correlationId: event.id,
            idempotencyKey: `stripe.retired_sale_event_ignored:${event.id}`,
            outcome: "skipped",
            metadata: { sale_id: saleId, event_type: event.type },
        })
        return Response.json({ ok: true, ignored: true, reason: "retired_billing_model" })
    }

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
            const result = await handleCompletedStripeCheckout(checkout, workspaceId)
            if (!result.ok) {
                await reportStripeAutomationFailure(workspaceId, event.id, "checkout_payment_automation", result.error ?? "Could not unlock onboarding")
                return Response.json({ error: result.error ?? "Could not unlock onboarding" }, { status: 500 })
            }
            await recordAdminActivity({ workspaceId, category: "billing", eventKey: "stripe.checkout.completed", summary: "Stripe Checkout completed", entityType: "stripe_checkout_session", entityId: checkoutId ?? event.id, actorKind: "automation", correlationId: event.id, idempotencyKey: `stripe.checkout.completed:${event.id}`, outcome: "succeeded", metadata: { sale_id: saleId, subscription_id: subscriptionId } })
        }
    } else if (event.type === "checkout.session.async_payment_failed" || event.type === "checkout.session.expired") {
        const checkout = event.data?.object
        const checkoutId = stripeObjectId(checkout?.id)
        if (saleId && checkoutId) {
            const { error } = await supabaseAdmin.from("client_sales").update({
                status: "payment_failed",
                stripe_checkout_status: event.type === "checkout.session.expired" ? "expired" : "async_payment_failed",
                stripe_checkout_url: null,
                stripe_checkout_expires_at: null,
                raw_payload: event,
                updated_at: new Date().toISOString(),
            }).eq("workspace_id", workspaceId).eq("id", saleId)
                .eq("stripe_checkout_session_id", checkoutId)
                .in("status", ["onboarding_payment_pending", "onboarding_link_sent", "onboarding_link_failed", "payment_failed"])
            if (error) {
                await reportStripeAutomationFailure(workspaceId, event.id, "release_onboarding_checkout", error.message)
                return Response.json({ error: "Could not release the unavailable Checkout page" }, { status: 500 })
            }
            await recordAdminActivity({ workspaceId, category: "billing", level: "warning", eventKey: event.type === "checkout.session.expired" ? "stripe.checkout.expired" : "stripe.checkout.payment_failed", summary: event.type === "checkout.session.expired" ? "Stripe Checkout expired" : "Stripe Checkout payment failed", entityType: "stripe_checkout_session", entityId: checkoutId, actorKind: "automation", correlationId: event.id, idempotencyKey: `stripe.checkout.unavailable:${event.id}`, outcome: "succeeded", metadata: { sale_id: saleId, event_type: event.type } })
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
        const invoiceId = stripeObjectId(invoice?.id)
        if (!saleId) {
            await recordAdminActivity({
                workspaceId,
                category: "billing",
                eventKey: "stripe.invoice.paid_ignored",
                summary: "Non-Betelgeze Stripe invoice payment ignored",
                entityType: "stripe_invoice",
                entityId: invoiceId ?? event.id,
                actorKind: "automation",
                correlationId: event.id,
                idempotencyKey: `stripe.invoice.paid_ignored:${event.id}`,
                outcome: "skipped",
                metadata: { stripe_event_id: event.id, reason: "no_client_sale_id" },
            })
            return Response.json({ ok: true, ignored: true, duplicate: duplicateEvent })
        }
        if (!sale) {
            await reportStripeAutomationFailure(
                workspaceId,
                event.id,
                "subscription_invoice_payment",
                "Stripe invoice references an unknown Betelgeze sale",
            )
            return Response.json(
                { error: "Stripe invoice references an unknown Betelgeze sale" },
                { status: 500 },
            )
        }
        const subscriptionId = stripeObjectSubscriptionId(invoice)
            ?? sale.stripe_subscription_id
        const paidAt = new Date().toISOString()
        const invoiceStatus =
            typeof invoice?.status === "string" ? invoice.status : "paid"
        const { error: renewalError } = await supabaseAdmin.from("client_sales").update({
            stripe_subscription_id: subscriptionId,
            stripe_subscription_status: subscriptionId ? "active" : null,
            latest_payment_at: paidAt,
            latest_invoice_id: invoiceId,
            latest_invoice_status: invoiceStatus,
            raw_payload: event,
            updated_at: paidAt,
        }).eq("id", saleId).eq("workspace_id", workspaceId)
        if (renewalError) {
            await reportStripeAutomationFailure(
                workspaceId,
                event.id,
                "subscription_invoice_payment",
                renewalError.message,
            )
            return Response.json({ error: "Could not record subscription payment" }, { status: 500 })
        }
        await recordAdminActivity({
            workspaceId,
            category: "billing",
            eventKey: sale.initial_payment_received_at
                ? "stripe.subscription.renewal_paid"
                : "stripe.subscription.initial_invoice_paid",
            summary: sale.initial_payment_received_at
                ? "Recurring service renewal paid"
                : "Initial Checkout invoice paid",
            entityType: "stripe_invoice",
            entityId: invoiceId ?? event.id,
            actorKind: "automation",
            correlationId: event.id,
            idempotencyKey: `stripe.subscription.invoice_paid:${event.id}`,
            outcome: "succeeded",
            metadata: { sale_id: saleId, subscription_id: subscriptionId },
        })
    } else if (
        event.type === "invoice.payment_failed" ||
        event.type === "invoice.payment_action_required" ||
        event.type === "invoice.voided" ||
        event.type === "invoice.marked_uncollectible"
    ) {
        const invoiceId = stripeObjectId(invoice?.id)
        if (!saleId) {
            return Response.json({ ok: true, ignored: true, reason: "unrelated_invoice" })
        }
        if (!sale) {
            await reportStripeAutomationFailure(
                workspaceId,
                event.id,
                "subscription_invoice_failure",
                "Stripe invoice references an unknown Betelgeze sale",
            )
            return Response.json(
                { error: "Stripe invoice references an unknown Betelgeze sale" },
                { status: 500 },
            )
        }
        const renewalFailure = Boolean(sale.initial_payment_received_at)
        const subscriptionId = stripeObjectSubscriptionId(invoice)
            ?? sale.stripe_subscription_id
        const invoiceStatus =
            typeof invoice?.status === "string" ? invoice.status : event.type.split(".").at(-1) ?? null
        const { error: updateError } = await supabaseAdmin.from("client_sales").update({
            ...(renewalFailure ? {} : { status: "payment_failed" }),
            stripe_subscription_id: subscriptionId,
            stripe_subscription_status:
                event.type === "invoice.payment_failed" ||
                event.type === "invoice.payment_action_required"
                    ? "past_due"
                    : invoiceStatus,
            latest_invoice_id: invoiceId,
            latest_invoice_status: invoiceStatus,
            raw_payload: event,
            updated_at: new Date().toISOString(),
        }).eq("id", saleId).eq("workspace_id", workspaceId)
        if (updateError) {
            await reportStripeAutomationFailure(
                workspaceId,
                event.id,
                "subscription_invoice_failure",
                updateError.message,
            )
            return Response.json({ error: "Could not record subscription payment failure" }, { status: 500 })
        }
        await recordAdminActivity({
            workspaceId,
            category: "billing",
            level: "warning",
            eventKey: renewalFailure
                ? "stripe.subscription.renewal_failed"
                : "stripe.subscription.initial_payment_failed",
            summary: renewalFailure
                ? "Recurring service renewal failed"
                : "Initial Checkout payment failed",
            entityType: "stripe_invoice",
            entityId: invoiceId ?? event.id,
            actorKind: "automation",
            correlationId: event.id,
            idempotencyKey: `stripe.subscription.invoice_failed:${event.id}`,
            outcome: "failed",
            metadata: { sale_id: saleId, subscription_id: subscriptionId, event_type: event.type },
        })
    }

    return Response.json({ ok: true, duplicate: duplicateEvent })
}
