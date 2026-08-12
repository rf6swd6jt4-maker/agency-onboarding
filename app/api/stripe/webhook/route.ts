import { NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import {
    StripeWebhookEvent,
    verifyStripeWebhookSignature,
} from "@/lib/stripe/api"
import { handlePaidStripeInvoice } from "@/lib/client-sales/automation"
import { getStripeWebhookCandidates, getWorkspaceIdForConnectedAccount, recordWorkspaceConnectionWebhook } from "@/lib/workspace-integrations"
import { platformFailureFingerprint, reportPlatformFailure } from "@/lib/admin/maintenance"
import { recordAdminActivity } from "@/lib/admin/activity"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isPaidInvoiceEvent(type: string) {
    // Stripe can emit either event for a successful invoice payment. Both
    // contain the invoice object and must advance the same sale workflow.
    return type === "invoice.paid" || type === "invoice.payment_succeeded"
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

    if (duplicateEvent && !isPaidInvoiceEvent(event.type)) return Response.json({ ok: true, duplicate: true })

    if (!duplicateEvent) await recordAdminActivity({ workspaceId, category: "billing", eventKey: "stripe.webhook.received", summary: `Stripe event received: ${event.type}`, entityType: "stripe_event", entityId: event.id, direction: "inbound", metadata: { event_type: event.type, sale_id: saleId } })

    if (isPaidInvoiceEvent(event.type)) {
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
            const invoiceStatus = typeof invoice?.status === "string" ? invoice.status : null
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
                await recordAdminActivity({ workspaceId, category: "billing", level: event.type === "invoice.payment_failed" ? "warning" : "info", eventKey: `stripe.invoice.${event.type.split(".").at(-1)}`, summary: `Invoice status updated: ${nextSaleStatus.replace(/_/g, " ")}`, entityType: "stripe_invoice", entityId: invoiceId, metadata: { stripe_event_id: event.id, event_type: event.type, sale_status: nextSaleStatus } })
            } else if (statusRpc.error) {
                await reportStripeAutomationFailure(workspaceId, event.id, "update_invoice_status", statusRpc.error.message)
                return Response.json({ error: "Could not update invoice status" }, { status: 500 })
            }
        }
    }

    return Response.json({ ok: true, duplicate: duplicateEvent })
}
