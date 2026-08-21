import { NextRequest, NextResponse } from "next/server"
import { Resend } from "resend"
import type { EmailDeliveryStatus } from "@/lib/auth/account-flow-types"
import { supabaseAdmin } from "@/lib/supabase/admin"

function deliveryStatus(type: string): EmailDeliveryStatus | null {
    if (type === "email.sent" || type === "email.scheduled") return "sent"
    if (type === "email.delivered") return "delivered"
    if (type === "email.delivery_delayed") return "delayed"
    if (type === "email.bounced") return "bounced"
    if (type === "email.suppressed") return "suppressed"
    if (type === "email.failed" || type === "email.complained") return "failed"
    return null
}

export async function POST(request: NextRequest) {
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim()
    if (!webhookSecret) return NextResponse.json({ error: "Webhook not configured" }, { status: 500 })
    const payload = await request.text()
    let event
    try {
        event = new Resend(process.env.RESEND_API_KEY).webhooks.verify({
            payload,
            webhookSecret,
            headers: {
                id: request.headers.get("svix-id") ?? "",
                timestamp: request.headers.get("svix-timestamp") ?? "",
                signature: request.headers.get("svix-signature") ?? "",
            },
        })
    } catch {
        return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 })
    }
    const status = deliveryStatus(event.type)
    if (!status || !("email_id" in event.data)) return NextResponse.json({ ok: true })
    const providerMessageId = event.data.email_id
    const eventAt = event.created_at
    const tags = "tags" in event.data && event.data.tags && typeof event.data.tags === "object" && !Array.isArray(event.data.tags) ? event.data.tags as Record<string, string> : null
    const deliveryId = tags?.delivery_id
    if (deliveryId && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(deliveryId)) {
        await supabaseAdmin.from("account_email_deliveries").update({ provider_message_id: providerMessageId }).eq("id", deliveryId).is("provider_message_id", null)
    }
    const failed = ["failed", "bounced", "suppressed"].includes(status)
    const { error } = await supabaseAdmin.rpc("record_account_email_delivery_event", {
        p_provider_message_id: providerMessageId,
        p_status: status,
        p_event_at: eventAt,
        p_failure_code: failed ? event.type.replace("email.", "") : null,
    })
    if (error) {
        console.error("Resend delivery event could not be recorded", { providerMessageId, status, code: error.code })
        return NextResponse.json({ error: "Delivery event could not be recorded" }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
}
