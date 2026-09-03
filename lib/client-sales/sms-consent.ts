import "server-only"

import { headers } from "next/headers"

import { recordAdminActivity } from "@/lib/admin/activity"
import { isUsablePhoneNumber, normalizeProviderAddress, toE164Recipient } from "@/lib/client-messages/addresses"
import { sendCommunicationDeliveries } from "@/lib/client-messages/omnichannel"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const SMS_OPT_IN_DISCLOSURE_VERSION = "agency-client-messaging-v2"
export const SMS_OPT_IN_DISCLOSURE = "I agree to receive service-related SMS messages from the named agency about my client onboarding and services through Betelgeze. Messages may include confirmation requests, secure onboarding or payment links, and service updates. Message frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out. Consent is optional and is not a condition of purchase."

const CLAIM_TIMEOUT_MS = 15 * 60 * 1_000
const PENDING_SALE_STATUSES = [
    "sale_confirmation_pending",
    "sold_confirmation_failed",
    "manual_consent_pending",
    "manual_consent_template_failed",
]

type SmsOptInActionState = {
    ok: boolean
    message: string
}

function safeRequestIp(value: string | null) {
    const candidate = value?.split(",", 1)[0]?.trim() ?? ""
    return candidate && candidate.length <= 200 ? candidate : null
}

function publicError() {
    return "We could not save your SMS opt-in. Check the information and try again, or contact the agency for help."
}

function disclosureFor(workspaceName: string) {
    return SMS_OPT_IN_DISCLOSURE.replace("the named agency", workspaceName)
}

function saleFlow(rawPayload: unknown) {
    if (rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)) {
        const flow = (rawPayload as { flow?: unknown }).flow
        if (flow === "manual_migration" || flow === "retention_confirmation") return flow
    }
    return "onboarding_payment_gate"
}

function awaitingSaleStatus(rawPayload: unknown) {
    const flow = saleFlow(rawPayload)
    return flow === "manual_migration" || flow === "retention_confirmation"
        ? "manual_awaiting_whatsapp_confirm"
        : "sold_awaiting_whatsapp_confirm"
}

function failedSaleStatus(rawPayload: unknown) {
    const flow = saleFlow(rawPayload)
    return flow === "manual_migration" || flow === "retention_confirmation"
        ? "manual_consent_template_failed"
        : "sold_confirmation_failed"
}

export async function getPublicSmsOptInWorkspace(workspaceSlug: string | null) {
    if (!workspaceSlug) return null
    const { data: workspace, error } = await supabaseAdmin.from("workspaces")
        .select("id, slug, name, status")
        .eq("slug", workspaceSlug)
        .maybeSingle()
    if (error || !workspace || workspace.status !== "active") return null
    const { data: twilio } = await supabaseAdmin.from("workspace_integrations")
        .select("enabled, connection_status")
        .eq("workspace_id", workspace.id)
        .eq("provider", "twilio_sms")
        .maybeSingle()
    if (!twilio?.enabled || twilio.connection_status !== "connected") return null
    return workspace
}

async function activeWorkspaceOptIn(workspaceId: string, phoneE164: string) {
    const { data, error } = await supabaseAdmin.from("workspace_sms_opt_ins")
        .select("id, submitted_name, phone_e164, disclosure_version, disclosure_text, source_url, source_host, source_ip, user_agent, consented_at")
        .eq("workspace_id", workspaceId)
        .eq("phone_e164", phoneE164)
        .eq("status", "active")
        .maybeSingle()
    if (error) throw new Error(error.message)
    return data
}

export async function sendSaleSmsConfirmationIfOptedIn(input: { workspaceId: string; saleId: string }) {
    const { data: sale, error: saleError } = await supabaseAdmin.from("client_sales")
        .select("id, workspace_id, relationship_id, client_phone, sms_recipient_e164, status, raw_payload")
        .eq("workspace_id", input.workspaceId)
        .eq("id", input.saleId)
        .maybeSingle()
    if (saleError) throw new Error(saleError.message)
    if (!sale?.relationship_id) return { ok: false as const, error: "Sale relationship is missing" }

    const [{ data: relationship }, { data: workspace }] = await Promise.all([
        supabaseAdmin.from("relationships").select("id, status, primary_phone").eq("workspace_id", input.workspaceId).eq("id", sale.relationship_id).maybeSingle(),
        supabaseAdmin.from("workspaces").select("name").eq("id", input.workspaceId).maybeSingle(),
    ])
    if (!relationship || relationship.status === "archived" || !workspace) {
        return { ok: true as const, skipped: true as const, sent: false as const }
    }
    const phoneE164 = sale.sms_recipient_e164 || toE164Recipient(relationship.primary_phone || sale.client_phone)
    const optIn = await activeWorkspaceOptIn(input.workspaceId, phoneE164)
    if (!optIn) return { ok: true as const, waitingForOptIn: true as const, sent: false as const }

    const existing = await supabaseAdmin.from("relationship_sms_consents")
        .select("id, status, updated_at")
        .eq("workspace_id", input.workspaceId)
        .eq("client_sale_id", sale.id)
        .maybeSingle()
    if (existing.error) throw new Error(existing.error.message)
    if (existing.data && ["awaiting_confirmation", "confirmed"].includes(existing.data.status)) {
        return { ok: true as const, skipped: true as const, sent: true as const }
    }
    if (existing.data?.status === "sending_confirmation") {
        const claimedAt = Date.parse(existing.data.updated_at)
        if (Number.isFinite(claimedAt) && Date.now() - claimedAt < CLAIM_TIMEOUT_MS) {
            return { ok: true as const, inProgress: true as const, sent: false as const }
        }
    }

    const now = new Date().toISOString()
    const consentEvidence = {
        workspace_id: input.workspaceId,
        relationship_id: sale.relationship_id,
        client_sale_id: sale.id,
        workspace_sms_opt_in_id: optIn.id,
        phone_e164: phoneE164,
        status: "pending",
        disclosure_version: optIn.disclosure_version,
        disclosure_text: optIn.disclosure_text,
        source_url: optIn.source_url,
        source_host: optIn.source_host,
        source_ip: optIn.source_ip,
        user_agent: optIn.user_agent,
        consented_at: optIn.consented_at,
        opted_out_at: null,
        last_error: null,
        updated_at: now,
    }
    let consentId = existing.data?.id ?? null
    if (!consentId) {
        const inserted = await supabaseAdmin.from("relationship_sms_consents").insert(consentEvidence).select("id").maybeSingle()
        if (inserted.error?.code === "23505") {
            const concurrent = await supabaseAdmin.from("relationship_sms_consents")
                .select("id, status, updated_at")
                .eq("workspace_id", input.workspaceId)
                .eq("client_sale_id", sale.id)
                .maybeSingle()
            if (concurrent.error || !concurrent.data) throw new Error(concurrent.error?.message ?? "Could not reconcile SMS confirmation")
            if (["sending_confirmation", "awaiting_confirmation", "confirmed"].includes(concurrent.data.status)) {
                return { ok: true as const, inProgress: concurrent.data.status === "sending_confirmation", sent: concurrent.data.status !== "sending_confirmation" }
            }
            consentId = concurrent.data.id
        } else if (inserted.error || !inserted.data) {
            throw new Error(inserted.error?.message ?? "Could not save SMS consent evidence")
        } else {
            consentId = inserted.data.id
        }
    }
    if (!consentId) throw new Error("Could not save SMS consent evidence")

    const releaseStatuses = existing.data?.status === "sending_confirmation" ? ["sending_confirmation"] : ["pending", "send_failed", "opted_out"]
    let evidenceUpdate = supabaseAdmin.from("relationship_sms_consents").update(consentEvidence)
        .eq("workspace_id", input.workspaceId)
        .eq("id", consentId)
        .in("status", releaseStatuses)
    if (existing.data?.status === "sending_confirmation") evidenceUpdate = evidenceUpdate.eq("updated_at", existing.data.updated_at)
    const evidenceResult = await evidenceUpdate
    if (evidenceResult.error) throw new Error(evidenceResult.error.message)

    const claim = await supabaseAdmin.from("relationship_sms_consents").update({
        status: "sending_confirmation",
        last_error: null,
    }).eq("workspace_id", input.workspaceId).eq("id", consentId).eq("status", "pending").select("id").maybeSingle()
    if (claim.error) throw new Error(claim.error.message)
    if (!claim.data) return { ok: true as const, inProgress: true as const, sent: false as const }

    const body = `${workspace.name}: You're opted in to receive SMS messages related to your client onboarding. Message frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out. Reply CONFIRM to receive your secure onboarding link.`
    const destination = normalizeProviderAddress("twilio_sms", phoneE164)
    let messageId: string | null = null
    try {
        const previousMessage = await supabaseAdmin.from("client_messages")
            .select("id")
            .eq("workspace_id", input.workspaceId)
            .contains("raw_payload", { sms_consent_id: consentId })
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        if (previousMessage.error) throw previousMessage.error
        messageId = previousMessage.data?.id ?? null
        if (messageId) {
            const update = await supabaseAdmin.from("client_messages").update({ body, status: "sending", error: null })
                .eq("workspace_id", input.workspaceId).eq("id", messageId)
            if (update.error) throw update.error
        } else {
            const message = await supabaseAdmin.from("client_messages").insert({
                workspace_id: input.workspaceId,
                relationship_id: sale.relationship_id,
                direction: "outbound",
                provider: "twilio_sms",
                to_address: destination,
                body,
                status: "sending",
                sender_kind: "automation",
                automation_kind: "consent_template",
                automation_label: "SMS opt-in confirmation",
                raw_payload: {
                    sms_consent_id: consentId,
                    workspace_sms_opt_in_id: optIn.id,
                    client_sale_id: sale.id,
                    disclosure_version: optIn.disclosure_version,
                },
            }).select("id").single()
            if (message.error) throw message.error
            messageId = message.data.id
        }
        if (!messageId) throw new Error("Could not create the SMS confirmation log")
        await supabaseAdmin.from("relationship_sms_consents").update({ initial_message_id: messageId }).eq("workspace_id", input.workspaceId).eq("id", consentId)
        const delivery = await sendCommunicationDeliveries({
            workspaceId: input.workspaceId,
            relationshipId: sale.relationship_id,
            messageId,
            body,
            destinations: [{ provider: "twilio_sms", address: destination, channelId: null, primary: true }],
            smsConsentContext: "web_opt_in",
        })
        const sent = delivery.results.find((result) => result.provider === "twilio_sms" && result.ok)
        if (!sent) throw new Error(delivery.error ?? "Twilio did not accept the SMS confirmation")
        const sentAt = new Date().toISOString()
        const [consentUpdate, saleUpdate] = await Promise.all([
            supabaseAdmin.from("relationship_sms_consents").update({
                status: "awaiting_confirmation",
                confirmation_sent_at: sentAt,
                initial_provider_message_id: sent.providerMessageId,
                last_error: null,
            }).eq("workspace_id", input.workspaceId).eq("id", consentId),
            supabaseAdmin.from("client_sales").update({
                status: awaitingSaleStatus(sale.raw_payload),
                consent_template_sent_at: sentAt,
                consent_template_message_id: sent.providerMessageId,
                updated_at: sentAt,
            }).eq("workspace_id", input.workspaceId).eq("id", sale.id),
        ])
        if (consentUpdate.error || saleUpdate.error) throw new Error(consentUpdate.error?.message ?? saleUpdate.error?.message ?? "Could not finish SMS confirmation")
        await recordAdminActivity({
            workspaceId: input.workspaceId,
            category: "communications",
            eventKey: "client.sms_opt_in.confirmation_sent",
            summary: "SMS confirmation sent after public opt-in",
            entityType: "client_sale",
            entityId: sale.id,
            direction: "outbound",
            metadata: { relationship_id: sale.relationship_id, consent_id: consentId, workspace_sms_opt_in_id: optIn.id, message_id: messageId },
            idempotencyKey: `client.sms_opt_in.confirmation_sent:${consentId}`,
        })
        return { ok: true as const, sent: true as const, providerMessageId: sent.providerMessageId }
    } catch (error) {
        const message = error instanceof Error ? error.message : "SMS confirmation failed"
        await Promise.all([
            supabaseAdmin.from("relationship_sms_consents").update({ status: "send_failed", last_error: message.slice(0, 1_000) }).eq("workspace_id", input.workspaceId).eq("id", consentId),
            supabaseAdmin.from("client_sales").update({ status: failedSaleStatus(sale.raw_payload), updated_at: new Date().toISOString() }).eq("workspace_id", input.workspaceId).eq("id", sale.id),
        ])
        return { ok: false as const, error: message }
    }
}

async function sendPendingSaleSmsConfirmations(workspaceId: string, phoneE164: string) {
    const { data: sales, error } = await supabaseAdmin.from("client_sales")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("sms_recipient_e164", phoneE164)
        .in("status", PENDING_SALE_STATUSES)
        .is("consent_template_sent_at", null)
        .order("created_at", { ascending: false })
        .limit(100)
    if (error) throw new Error(error.message)
    const results = []
    for (const sale of sales ?? []) {
        results.push(await sendSaleSmsConfirmationIfOptedIn({ workspaceId, saleId: sale.id }))
    }
    return {
        matched: sales?.length ?? 0,
        sent: results.filter((result) => result.ok && result.sent).length,
        failed: results.filter((result) => !result.ok).length,
    }
}

export async function submitPublicSmsOptIn(_state: SmsOptInActionState, formData: FormData): Promise<SmsOptInActionState> {
    try {
        if (formData.get("sms_consent") !== "yes") {
            return { ok: false, message: "Select the consent checkbox to opt in to SMS messages." }
        }
        const submittedName = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ")
        const submittedPhone = toE164Recipient(String(formData.get("phone") ?? ""))
        if (submittedName.length < 2 || submittedName.length > 200 || !isUsablePhoneNumber(submittedPhone) || !/^\+[1-9]\d{7,14}$/.test(submittedPhone)) {
            return { ok: false, message: "Enter your name and a valid mobile number including its country code." }
        }

        const requestHeaders = await headers()
        const workspace = await getPublicSmsOptInWorkspace(requestHeaders.get("x-betelgeze-workspace-slug"))
        if (!workspace) return { ok: false, message: publicError() }
        const now = new Date().toISOString()
        const sourceHost = requestHeaders.get("host")?.split(":", 1)[0]?.toLowerCase() ?? "unknown"
        const sourcePath = requestHeaders.get("x-betelgeze-current-path") ?? "/smsoptin"
        const protocol = requestHeaders.get("x-forwarded-proto")?.split(",", 1)[0] || "https"
        const sourceUrl = `${protocol}://${sourceHost}${sourcePath}`.slice(0, 2_000)
        const optIn = await supabaseAdmin.from("workspace_sms_opt_ins").upsert({
            workspace_id: workspace.id,
            submitted_name: submittedName,
            phone_e164: submittedPhone,
            status: "active",
            disclosure_version: SMS_OPT_IN_DISCLOSURE_VERSION,
            disclosure_text: disclosureFor(workspace.name),
            source_url: sourceUrl,
            source_host: sourceHost,
            source_ip: safeRequestIp(requestHeaders.get("x-forwarded-for") ?? requestHeaders.get("x-real-ip")),
            user_agent: requestHeaders.get("user-agent")?.slice(0, 1_000) ?? null,
            consented_at: now,
            opted_out_at: null,
            updated_at: now,
        }, { onConflict: "workspace_id,phone_e164" }).select("id").single()
        if (optIn.error) throw new Error(optIn.error.message)

        await recordAdminActivity({
            workspaceId: workspace.id,
            category: "communications",
            eventKey: "client.sms_opt_in.public",
            summary: "Public SMS opt-in recorded",
            entityType: "workspace_sms_opt_in",
            entityId: optIn.data.id,
            direction: "inbound",
            metadata: { disclosure_version: SMS_OPT_IN_DISCLOSURE_VERSION, source_host: sourceHost },
        })
        const delivery = await sendPendingSaleSmsConfirmations(workspace.id, submittedPhone)
        if (delivery.failed) {
            return { ok: false, message: "Your opt-in was saved, but the confirmation text could not be sent. Please try again shortly." }
        }
        return {
            ok: true,
            message: delivery.sent
                ? "You're opted in. Check your phone and reply CONFIRM to receive your secure onboarding link."
                : "You're opted in. When the agency starts your onboarding, the confirmation text will be sent to this number.",
        }
    } catch {
        return { ok: false, message: publicError() }
    }
}
