import { NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import {
    StripeWebhookEvent,
    verifyStripeWebhookSignature,
} from "@/lib/stripe/api"
import { handlePaidStripeInvoice } from "@/lib/client-sales/automation"
import { getStripeWebhookCandidates } from "@/lib/workspace-integrations"
import { platformFailureFingerprint, reportPlatformFailure } from "@/lib/admin/maintenance"
import { recordAdminActivity } from "@/lib/admin/activity"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isPaidInvoiceEvent(type: string) {
    // Stripe can emit either event for a successful invoice payment. Both
    // contain the invoice object and must advance the same sale workflow.
    return type === "invoice.paid" || type === "invoice.payment_succeeded"
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
    const candidates = await getStripeWebhookCandidates()
    const matchedCandidate = candidates.find((candidate) => verifyStripeWebhookSignature({ payload, signatureHeader: signature, secret: candidate.webhookSecret }))
    if (!matchedCandidate) {
        return Response.json({ error: "Invalid signature" }, { status: 400 })
    }

    const event = JSON.parse(payload) as StripeWebhookEvent
    const invoice = event.data?.object
    const saleId =
        invoice && typeof invoice === "object" && !Array.isArray(invoice) &&
        typeof (invoice as { metadata?: { client_sale_id?: unknown } }).metadata?.client_sale_id === "string"
            ? (invoice as { metadata: { client_sale_id: string } }).metadata.client_sale_id
            : null
    const { data: sale } = saleId
        ? await supabaseAdmin.from("client_sales").select("workspace_id").eq("id", saleId).maybeSingle()
        : { data: null }
    const workspaceId = sale?.workspace_id ?? matchedCandidate.workspaceId

    if (!workspaceId || workspaceId !== matchedCandidate.workspaceId) {
        return Response.json({ error: "Could not resolve workspace for Stripe event" }, { status: 500 })
    }
    const { error: eventInsertError } = await supabaseAdmin
        .from("stripe_events")
        .insert({
            id: event.id,
            event_type: event.type,
            raw_payload: event,
            workspace_id: workspaceId,
        })

    if (eventInsertError) {
        if (eventInsertError.message.toLowerCase().includes("duplicate")) {
            return Response.json({ ok: true, duplicate: true })
        }

        await reportStripeAutomationFailure(workspaceId, event.id, "record_event", eventInsertError.message)

        return Response.json(
            { error: `Could not record Stripe event: ${eventInsertError.message}` },
            { status: 500 }
        )
    }

    await recordAdminActivity({ workspaceId, category: "billing", eventKey: "stripe.webhook.received", summary: `Stripe event received: ${event.type}`, entityType: "stripe_event", entityId: event.id, metadata: { event_type: event.type, sale_id: saleId } })

    if (isPaidInvoiceEvent(event.type)) {
        if (!invoice) {
            await reportStripeAutomationFailure(workspaceId, event.id, "paid_invoice_payload", "Paid invoice event missing invoice object")
            return Response.json(
                { error: "Paid invoice event missing invoice object" },
                { status: 400 }
            )
        }

        const result = await handlePaidStripeInvoice(invoice)

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
                { status: 202 }
            )
        }
        await recordAdminActivity({ workspaceId, category: "billing", eventKey: "stripe.invoice.paid_processed", summary: "Paid invoice automation processed", entityType: "stripe_event", entityId: event.id, metadata: { sale_id: saleId, skipped: "skipped" in result ? Boolean(result.skipped) : false } })
    } else if (
        event.type === "invoice.payment_failed" ||
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
            const nextSaleStatus = event.type === "invoice.payment_failed" ? "payment_failed" : "invoice_inactive"
            const { error: saleUpdateError } = await supabaseAdmin
                .from("client_sales")
                .update({
                    status: nextSaleStatus,
                    stripe_invoice_status:
                        typeof invoice?.status === "string"
                            ? invoice.status
                            : null,
                    raw_payload: event,
                    updated_at: new Date().toISOString(),
                })
                .eq("stripe_invoice_id", invoiceId)
            if (saleUpdateError) await reportStripeAutomationFailure(workspaceId, event.id, "update_invoice_status", saleUpdateError.message)
            else await recordAdminActivity({ workspaceId, category: "billing", level: event.type === "invoice.payment_failed" ? "warning" : "info", eventKey: `stripe.invoice.${event.type.split(".").at(-1)}`, summary: `Invoice status updated: ${nextSaleStatus.replace(/_/g, " ")}`, entityType: "stripe_invoice", entityId: invoiceId, metadata: { stripe_event_id: event.id, event_type: event.type, sale_status: nextSaleStatus } })
        }
    }

    return Response.json({ ok: true })
}
