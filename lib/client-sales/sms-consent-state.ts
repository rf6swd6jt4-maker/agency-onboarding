import "server-only"

import { toE164Recipient } from "@/lib/client-messages/addresses"
import { supabaseAdmin } from "@/lib/supabase/admin"

export async function smsConsentAllowsDelivery(input: {
    workspaceId: string
    relationshipId: string
    address: string
    includeSending?: boolean
}) {
    const statuses = input.includeSending
        ? ["sending_confirmation", "awaiting_confirmation", "confirmed"]
        : ["awaiting_confirmation", "confirmed"]
    const { data, error } = await supabaseAdmin.from("relationship_sms_consents")
        .select("id")
        .eq("workspace_id", input.workspaceId)
        .eq("relationship_id", input.relationshipId)
        .eq("phone_e164", toE164Recipient(input.address))
        .in("status", statuses)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    if (error) throw new Error("SMS consent could not be verified.")
    return Boolean(data)
}

export async function smsConsentForConfirmation(input: { workspaceId: string; saleId: string; fromAddress: string }) {
    const { data, error } = await supabaseAdmin.from("relationship_sms_consents")
        .select("id, relationship_id, status")
        .eq("workspace_id", input.workspaceId)
        .eq("client_sale_id", input.saleId)
        .eq("phone_e164", toE164Recipient(input.fromAddress))
        .eq("status", "awaiting_confirmation")
        .maybeSingle()
    if (error) throw new Error(error.message)
    return data
}

export async function markSmsConsentConfirmed(input: { workspaceId: string; consentId: string; messageId?: string | null }) {
    const confirmedAt = new Date().toISOString()
    const { error } = await supabaseAdmin.from("relationship_sms_consents").update({
        status: "confirmed",
        confirmed_at: confirmedAt,
        confirmation_provider_message_id: input.messageId ?? null,
        last_error: null,
    }).eq("workspace_id", input.workspaceId).eq("id", input.consentId).eq("status", "awaiting_confirmation")
    if (error) throw new Error(error.message)
}

export async function recordSmsOptOut(input: { workspaceId: string; fromAddress: string }) {
    const optedOutAt = new Date().toISOString()
    const { error } = await supabaseAdmin.from("relationship_sms_consents").update({
        status: "opted_out",
        opted_out_at: optedOutAt,
        last_error: null,
    }).eq("workspace_id", input.workspaceId)
        .eq("phone_e164", toE164Recipient(input.fromAddress))
        .in("status", ["sending_confirmation", "awaiting_confirmation", "confirmed"])
    if (error) throw new Error(error.message)
}

export async function recordSmsStart(input: { workspaceId: string; fromAddress: string }) {
    const { error } = await supabaseAdmin.from("relationship_sms_consents").update({
        status: "pending",
        opted_out_at: null,
        last_error: null,
    }).eq("workspace_id", input.workspaceId)
        .eq("phone_e164", toE164Recipient(input.fromAddress))
        .eq("status", "opted_out")
    if (error) throw new Error(error.message)
}
