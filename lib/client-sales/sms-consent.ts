import "server-only"

import { headers } from "next/headers"

import { recordAdminActivity } from "@/lib/admin/activity"
import { normalizePhoneNumber, normalizeProviderAddress, toE164Recipient } from "@/lib/client-messages/addresses"
import { sendCommunicationDeliveries } from "@/lib/client-messages/omnichannel"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const SMS_CONSENT_DISCLOSURE_VERSION = "client-onboarding-v1"
export const SMS_CONSENT_DISCLOSURE = "I agree to receive service-related SMS messages from the named agency about my client onboarding through Betelgeze. Message frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out. Consent is not a condition of purchase."

const TOKEN_PATTERN = /^[a-f0-9]{64}$/i
const ELIGIBLE_SALE_STATUSES = [
    "sale_confirmation_pending",
    "sold_confirmation_failed",
    "sold_awaiting_whatsapp_confirm",
    "onboarding_payment_pending",
    "onboarding_link_sent",
    "manual_consent_pending",
    "manual_consent_template_failed",
]

type SmsConsentState = "available" | "sending" | "awaiting_confirmation" | "confirmed" | "opted_out" | "unavailable"

function publicSiteOrigin() {
    if (process.env.NODE_ENV === "production") return "https://www.betelgeze.com"
    return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
}

export function getSmsConsentUrl(input: {
    token: string
    customDomain?: string | null
    customDomainVerified?: boolean
}) {
    const origin = input.customDomain && input.customDomainVerified
        ? `https://${input.customDomain}`
        : publicSiteOrigin()
    const path = input.customDomain && input.customDomainVerified
        ? "/sms-consent"
        : "/onboarding/sms-consent"
    const url = new URL(path, origin)
    url.searchParams.set("token", input.token)
    return url.toString()
}

function maskPhone(value: string) {
    const normalized = normalizePhoneNumber(value)
    const ending = normalized.replace(/\D/g, "").slice(-4)
    return ending ? `ending in ${ending}` : "on file"
}

async function loadConsentSale(token: string) {
    if (!TOKEN_PATTERN.test(token)) return null
    const { data: sale, error } = await supabaseAdmin.from("client_sales")
        .select("id, workspace_id, relationship_id, client_name, client_phone, status, raw_payload, sms_consent_token")
        .eq("sms_consent_token", token.toLowerCase())
        .maybeSingle()
    if (error || !sale?.relationship_id) return null
    const [{ data: workspace }, { data: relationship }, { data: consent }] = await Promise.all([
        supabaseAdmin.from("workspaces")
            .select("id, slug, name, status, custom_onboarding_domain, custom_onboarding_domain_status")
            .eq("id", sale.workspace_id)
            .maybeSingle(),
        supabaseAdmin.from("relationships")
            .select("id, status, primary_person_name, primary_phone")
            .eq("workspace_id", sale.workspace_id)
            .eq("id", sale.relationship_id)
            .maybeSingle(),
        supabaseAdmin.from("relationship_sms_consents")
            .select("id, status, consented_at, confirmation_sent_at, confirmed_at, opted_out_at")
            .eq("workspace_id", sale.workspace_id)
            .eq("client_sale_id", sale.id)
            .maybeSingle(),
    ])
    if (!workspace || workspace.status !== "active" || !relationship || relationship.status === "archived") return null
    return { sale, workspace, relationship, consent }
}

export async function getSmsConsentPage(token: string, expectedWorkspaceSlug?: string | null) {
    const context = await loadConsentSale(token)
    if (!context || (expectedWorkspaceSlug && context.workspace.slug !== expectedWorkspaceSlug)) return null
    const status = context.consent?.status
    const state: SmsConsentState = status === "sending_confirmation" ? "sending"
        : status === "awaiting_confirmation" ? "awaiting_confirmation"
            : status === "confirmed" ? "confirmed"
                : status === "opted_out" ? "opted_out"
                    : ELIGIBLE_SALE_STATUSES.includes(context.sale.status) ? "available" : "unavailable"
    return {
        workspaceName: context.workspace.name,
        clientName: context.relationship.primary_person_name || context.sale.client_name,
        phoneHint: maskPhone(context.sale.client_phone),
        state,
    }
}

function safeRequestIp(value: string | null) {
    const candidate = value?.split(",", 1)[0]?.trim() ?? ""
    return candidate && candidate.length <= 200 ? candidate : null
}

function publicError() {
    return "We could not complete the SMS opt-in. Check the phone number and try again, or contact your agency for help."
}

export type SmsConsentActionState = {
    ok: boolean
    message: string
}

export async function submitSmsConsent(token: string, _state: SmsConsentActionState, formData: FormData): Promise<SmsConsentActionState> {
    try {
        if (!TOKEN_PATTERN.test(token) || formData.get("sms_consent") !== "yes") {
            return { ok: false, message: "Select the consent checkbox to opt in to SMS messages." }
        }
        const requestHeaders = await headers()
        const expectedWorkspaceSlug = requestHeaders.get("x-betelgeze-workspace-slug")
        const context = await loadConsentSale(token)
        if (!context || (expectedWorkspaceSlug && context.workspace.slug !== expectedWorkspaceSlug)) {
            return { ok: false, message: publicError() }
        }
        if (!ELIGIBLE_SALE_STATUSES.includes(context.sale.status)) {
            if (context.consent?.status === "awaiting_confirmation" || context.consent?.status === "confirmed") {
                return { ok: true, message: context.consent.status === "confirmed" ? "Your SMS number is already confirmed." : "The confirmation message was already sent. Reply CONFIRM to receive your secure onboarding link." }
            }
            return { ok: false, message: "This SMS consent link is no longer available." }
        }
        const submittedPhone = normalizePhoneNumber(String(formData.get("phone") ?? ""))
        const expectedPhone = toE164Recipient(context.sale.client_phone)
        if (!submittedPhone || submittedPhone !== expectedPhone) return { ok: false, message: publicError() }

        const now = new Date().toISOString()
        const sourceHost = requestHeaders.get("host")?.split(":", 1)[0]?.toLowerCase() ?? "unknown"
        const currentPath = requestHeaders.get("x-betelgeze-current-path") ?? "/onboarding/sms-consent"
        const sourceUrl = `https://${sourceHost}${currentPath}`.slice(0, 2_000)
        const inserted = await supabaseAdmin.from("relationship_sms_consents").insert({
            workspace_id: context.sale.workspace_id,
            relationship_id: context.sale.relationship_id,
            client_sale_id: context.sale.id,
            phone_e164: expectedPhone,
            status: "pending",
            disclosure_version: SMS_CONSENT_DISCLOSURE_VERSION,
            disclosure_text: SMS_CONSENT_DISCLOSURE.replace("the named agency", context.workspace.name),
            source_url: sourceUrl,
            source_host: sourceHost,
            source_ip: safeRequestIp(requestHeaders.get("x-forwarded-for") ?? requestHeaders.get("x-real-ip")),
            user_agent: requestHeaders.get("user-agent")?.slice(0, 1_000) ?? null,
            consented_at: now,
        }).select("id, status").maybeSingle()

        let consent = inserted.data
        if (inserted.error?.code === "23505") {
            const existing = await supabaseAdmin.from("relationship_sms_consents")
                .select("id, status")
                .eq("workspace_id", context.sale.workspace_id)
                .eq("client_sale_id", context.sale.id)
                .maybeSingle()
            if (existing.error || !existing.data) return { ok: false, message: publicError() }
            consent = existing.data
        } else if (inserted.error || !consent) {
            return { ok: false, message: publicError() }
        }

        if (consent.status === "awaiting_confirmation" || consent.status === "confirmed") {
            return { ok: true, message: consent.status === "confirmed" ? "Your SMS number is already confirmed." : "The confirmation message was already sent. Reply CONFIRM to receive your secure onboarding link." }
        }
        if (consent.status === "opted_out") {
            return { ok: false, message: "This number is opted out. Reply START to the agency's SMS number before trying again." }
        }

        if (consent.status === "pending" || consent.status === "send_failed") {
            const evidenceUpdate = await supabaseAdmin.from("relationship_sms_consents").update({
                phone_e164: expectedPhone,
                disclosure_version: SMS_CONSENT_DISCLOSURE_VERSION,
                disclosure_text: SMS_CONSENT_DISCLOSURE.replace("the named agency", context.workspace.name),
                source_url: sourceUrl,
                source_host: sourceHost,
                source_ip: safeRequestIp(requestHeaders.get("x-forwarded-for") ?? requestHeaders.get("x-real-ip")),
                user_agent: requestHeaders.get("user-agent")?.slice(0, 1_000) ?? null,
                consented_at: now,
            }).eq("id", consent.id).eq("workspace_id", context.sale.workspace_id)
            if (evidenceUpdate.error) return { ok: false, message: publicError() }
        }

        const claim = await supabaseAdmin.from("relationship_sms_consents").update({
            status: "sending_confirmation",
            last_error: null,
        }).eq("id", consent.id).eq("workspace_id", context.sale.workspace_id).in("status", ["pending", "send_failed"]).select("id").maybeSingle()
        if (claim.error) return { ok: false, message: publicError() }
        if (!claim.data) return { ok: true, message: "Your SMS opt-in is already being processed. Check your phone shortly." }

        const body = `${context.workspace.name}: You're opted in to receive SMS messages related to your client onboarding. Message frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out. Reply CONFIRM to receive your secure onboarding link.`
        const destination = normalizeProviderAddress("twilio_sms", expectedPhone)
        const existingMessage = await supabaseAdmin.from("client_messages")
            .select("id")
            .eq("workspace_id", context.sale.workspace_id)
            .contains("raw_payload", { sms_consent_id: consent.id })
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        let messageId = existingMessage.data?.id ?? null
        if (!messageId) {
            const message = await supabaseAdmin.from("client_messages").insert({
                workspace_id: context.sale.workspace_id,
                relationship_id: context.sale.relationship_id,
                direction: "outbound",
                provider: "twilio_sms",
                to_address: destination,
                body,
                status: "sending",
                sender_kind: "automation",
                automation_kind: "consent_template",
                automation_label: "SMS opt-in confirmation",
                raw_payload: { sms_consent_id: consent.id, client_sale_id: context.sale.id, disclosure_version: SMS_CONSENT_DISCLOSURE_VERSION },
            }).select("id").single()
            if (message.error || !message.data) throw new Error(message.error?.message ?? "Could not create the SMS confirmation log")
            messageId = message.data.id
        }
        await supabaseAdmin.from("relationship_sms_consents").update({ initial_message_id: messageId }).eq("id", consent.id)
        const delivery = await sendCommunicationDeliveries({
            workspaceId: context.sale.workspace_id,
            relationshipId: context.sale.relationship_id,
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
            }).eq("id", consent.id).eq("workspace_id", context.sale.workspace_id),
            supabaseAdmin.from("client_sales").update({
                status: context.sale.raw_payload && typeof context.sale.raw_payload === "object" && !Array.isArray(context.sale.raw_payload) && context.sale.raw_payload.flow === "retention_confirmation"
                    ? "manual_awaiting_whatsapp_confirm"
                    : "sold_awaiting_whatsapp_confirm",
                consent_template_sent_at: sentAt,
                consent_template_message_id: sent.providerMessageId,
                updated_at: sentAt,
            }).eq("id", context.sale.id).eq("workspace_id", context.sale.workspace_id),
        ])
        if (consentUpdate.error || saleUpdate.error) throw new Error(consentUpdate.error?.message ?? saleUpdate.error?.message ?? "Could not finish SMS consent")
        await recordAdminActivity({
            workspaceId: context.sale.workspace_id,
            category: "communications",
            eventKey: "client.sms_consent.web_opt_in",
            summary: "Client opted in to onboarding SMS",
            entityType: "relationship",
            entityId: context.sale.relationship_id,
            direction: "inbound",
            metadata: { client_sale_id: context.sale.id, consent_id: consent.id, disclosure_version: SMS_CONSENT_DISCLOSURE_VERSION },
            idempotencyKey: `client.sms_consent.web_opt_in:${consent.id}`,
        })
        return { ok: true, message: "You're opted in. Check your phone and reply CONFIRM to receive your secure onboarding link." }
    } catch (error) {
        const context = await loadConsentSale(token)
        if (context?.consent?.id) {
            await supabaseAdmin.from("relationship_sms_consents").update({
                status: "send_failed",
                last_error: error instanceof Error ? error.message.slice(0, 1_000) : "SMS confirmation failed",
            }).eq("id", context.consent.id).eq("workspace_id", context.sale.workspace_id)
        }
        return { ok: false, message: publicError() }
    }
}
