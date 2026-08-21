import { after, NextRequest } from "next/server"

import { handleSaleConsentConfirmation } from "@/lib/client-sales/automation"
import { getEquivalentMessageAddresses, normalizeProviderAddress } from "@/lib/client-messages/addresses"
import { downloadTwilioMedia, validateTwilioSignature } from "@/lib/client-messages/twilio"
import { communicationAttachmentKind } from "@/lib/communications/attachments"
import { storeClientMessageMedia } from "@/lib/onboarding/uploads"
import { notifyClientChatMessage } from "@/lib/push/chat-notifications"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getWorkspaceIdForTwilioNumber, recordWorkspaceConnectionWebhook } from "@/lib/workspace-integrations"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function twimlResponse() {
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        headers: { "Content-Type": "text/xml; charset=utf-8" },
    })
}

function equivalentPhoneValues(address: string) {
    return [...new Set(getEquivalentMessageAddresses(address).flatMap((value) => [value, value.split(":", 2)[1]]))]
}

async function resolveDestination(workspaceId: string, fromAddress: string) {
    const phoneValues = equivalentPhoneValues(fromAddress)
    const { data: relationships, error } = await supabaseAdmin
        .from("relationships")
        .select("id, client_id, created_at")
        .eq("workspace_id", workspaceId)
        .neq("status", "archived")
        .in("primary_phone", phoneValues)
        .order("created_at", { ascending: false })
        .limit(1)
    if (error) throw new Error(error.message)
    const relationship = relationships?.[0]
    if (!relationship) return null
    if (!relationship.client_id) return { relationshipId: relationship.id, clientId: null, channelId: null }
    const { data: channel, error: channelError } = await supabaseAdmin.from("client_communication_channels").upsert({
        workspace_id: workspaceId,
        relationship_id: relationship.id,
        client_id: relationship.client_id,
        provider: "twilio_sms",
        external_address: fromAddress,
        clickup_channel_id: null,
        is_active: true,
        updated_at: new Date().toISOString(),
    }, { onConflict: "workspace_id,client_id,provider" }).select("id").single()
    if (channelError) throw new Error(channelError.message)
    return { relationshipId: relationship.id, clientId: relationship.client_id, channelId: channel.id as string }
}

function mediaFileName(contentType: string, messageSid: string, index: number) {
    const extension: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "video/mp4": "mp4",
        "audio/mpeg": "mp3",
        "audio/mp4": "m4a",
        "application/pdf": "pdf",
        "text/plain": "txt",
    }
    return `twilio-${messageSid}-${index}.${extension[contentType] ?? "bin"}`
}

async function firstInboundMedia(input: {
    workspaceId: string
    clientId: string | null
    relationshipId: string
    messageSid: string
    params: URLSearchParams
    appBaseUrl: string
}) {
    const count = Math.max(0, Math.min(Number(input.params.get("NumMedia") ?? 0) || 0, 10))
    if (!count) return null
    const url = input.params.get("MediaUrl0")
    const declaredType = input.params.get("MediaContentType0")?.split(";", 1)[0].toLowerCase() ?? "application/octet-stream"
    if (!url) return null
    const downloaded = await downloadTwilioMedia(input.workspaceId, url)
    const contentType = downloaded.contentType === "application/octet-stream" ? declaredType : downloaded.contentType
    const kind = communicationAttachmentKind(contentType) ?? "document"
    const fileName = mediaFileName(contentType, input.messageSid, 0)
    const stored = await storeClientMessageMedia({
        clientId: input.clientId,
        relationshipId: input.relationshipId,
        workspaceId: input.workspaceId,
        mediaId: `${input.messageSid}-0`,
        fileName,
        contentType,
        body: downloaded.bytes,
        appBaseUrl: input.appBaseUrl,
    })
    return {
        kind,
        fileName,
        mimeType: contentType,
        size: downloaded.bytes.byteLength,
        storagePath: stored.path,
        url: stored.url,
        count,
    }
}

async function refreshAggregateStatus(workspaceId: string, messageId: string) {
    const { data: deliveries } = await supabaseAdmin
        .from("communication_message_deliveries")
        .select("status, error, sent_at, delivered_at, failed_at")
        .eq("workspace_id", workspaceId)
        .eq("client_message_id", messageId)
    if (!deliveries?.length) return
    const successful = deliveries.filter((delivery) => ["sent", "delivered", "read"].includes(delivery.status))
    const failed = deliveries.filter((delivery) => ["failed", "undelivered", "send_failed", "delivery_failed"].includes(delivery.status))
    const status = failed.length && successful.length ? "partial_sent"
        : failed.length === deliveries.length ? "delivery_failed"
            : deliveries.every((delivery) => delivery.status === "delivered" || delivery.status === "read") ? "delivered"
                : successful.length ? "sent" : "sending"
    await supabaseAdmin.from("client_messages").update({
        status,
        error: failed.map((delivery) => delivery.error).filter(Boolean).join(" · ") || null,
        sent_at: successful[0]?.sent_at ?? null,
        delivered_at: deliveries.every((delivery) => delivery.delivered_at) ? deliveries[0].delivered_at : null,
        failed_at: failed.length === deliveries.length ? failed[0]?.failed_at ?? new Date().toISOString() : null,
    }).eq("workspace_id", workspaceId).eq("id", messageId)
}

async function handleStatus(workspaceId: string, params: URLSearchParams, callbackMessageId: string | null) {
    const providerId = params.get("MessageSid")
    const providerStatus = params.get("MessageStatus")?.toLowerCase() ?? "sent"
    const failed = providerStatus === "failed" || providerStatus === "undelivered"
    let query = supabaseAdmin
        .from("communication_message_deliveries")
        .select("id, client_message_id, sent_at, delivered_at")
        .eq("workspace_id", workspaceId)
        .eq("provider", "twilio_sms")
    query = callbackMessageId && UUID_PATTERN.test(callbackMessageId)
        ? query.eq("client_message_id", callbackMessageId)
        : query.eq("provider_message_id", providerId ?? "")
    const { data: delivery, error } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle()
    if (error || !delivery) return
    const now = new Date().toISOString()
    await supabaseAdmin.from("communication_message_deliveries").update({
        provider_message_id: providerId,
        status: failed ? "delivery_failed" : providerStatus,
        error: failed ? [params.get("ErrorMessage"), params.get("ErrorCode") ? `Twilio code ${params.get("ErrorCode")}` : null].filter(Boolean).join(": ") : null,
        sent_at: delivery.sent_at ?? (["sent", "delivered"].includes(providerStatus) ? now : null),
        delivered_at: delivery.delivered_at ?? (providerStatus === "delivered" ? now : null),
        failed_at: failed ? now : null,
        raw_payload: Object.fromEntries(params.entries()),
        updated_at: now,
    }).eq("id", delivery.id)
    await refreshAggregateStatus(workspaceId, delivery.client_message_id)
}

export async function POST(request: NextRequest) {
    const rawBody = await request.text()
    const params = new URLSearchParams(rawBody)
    const isStatus = Boolean(params.get("MessageStatus"))
    const businessNumber = isStatus ? params.get("From") : params.get("To")
    if (!businessNumber) return twimlResponse()
    const workspaceId = await getWorkspaceIdForTwilioNumber(businessNumber)
    if (!workspaceId) return twimlResponse()
    const publicUrl = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.betelgeze.com").toString()
    const signatureValid = await validateTwilioSignature({
        workspaceId,
        url: publicUrl,
        params,
        signature: request.headers.get("x-twilio-signature"),
    })
    if (!signatureValid) return new Response("Invalid Twilio signature", { status: 403 })
    await recordWorkspaceConnectionWebhook(workspaceId, "twilio_sms")
    if (isStatus) {
        await handleStatus(workspaceId, params, request.nextUrl.searchParams.get("messageId"))
        return twimlResponse()
    }

    const messageSid = params.get("MessageSid")
    const from = normalizeProviderAddress("twilio_sms", params.get("From") ?? "")
    const to = normalizeProviderAddress("twilio_sms", params.get("To") ?? "")
    const body = params.get("Body")?.trim() ?? ""
    if (!messageSid || !from) return twimlResponse()
    const existing = await supabaseAdmin.from("client_messages").select("id").eq("workspace_id", workspaceId).eq("provider", "twilio_sms").eq("provider_message_id", messageSid).maybeSingle()
    if (existing.data) return twimlResponse()

    const confirmation = await handleSaleConsentConfirmation({
        workspaceId,
        fromAddress: from,
        provider: "twilio_sms",
        messageId: messageSid,
        body,
        rawPayload: Object.fromEntries(params.entries()),
    })
    if (confirmation.handled) return twimlResponse()
    const destination = await resolveDestination(workspaceId, from)
    if (!destination) {
        await supabaseAdmin.from("client_messages").insert({
            workspace_id: workspaceId,
            direction: "inbound",
            provider: "twilio_sms",
            provider_message_id: messageSid,
            from_address: from,
            to_address: to,
            body: body || "[MMS]",
            status: "unmatched",
            sender_kind: "client",
            raw_payload: Object.fromEntries(params.entries()),
        })
        return twimlResponse()
    }

    const media = await firstInboundMedia({
        workspaceId,
        clientId: destination.clientId,
        relationshipId: destination.relationshipId,
        messageSid,
        params,
        appBaseUrl: process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin,
    })
    const displayBody = body || (media ? `[${media.kind[0].toUpperCase()}${media.kind.slice(1)}] ${media.fileName}` : "[SMS]")
    const { data: message, error: insertError } = await supabaseAdmin.from("client_messages").insert({
        workspace_id: workspaceId,
        client_id: destination.clientId,
        relationship_id: destination.relationshipId,
        communication_channel_id: destination.channelId,
        direction: "inbound",
        provider: "twilio_sms",
        provider_message_id: messageSid,
        from_address: from,
        to_address: to,
        body: displayBody,
        status: "received",
        sender_kind: "client",
        raw_payload: {
            twilio: Object.fromEntries(params.entries()),
            ...(media ? { bridge_media: media, media_count: media.count } : {}),
        },
    }).select("id").single()
    if (insertError || !message) throw new Error(insertError?.message ?? "Could not store inbound SMS")
    await supabaseAdmin.from("communication_message_deliveries").insert({
        workspace_id: workspaceId,
        relationship_id: destination.relationshipId,
        client_message_id: message.id,
        communication_channel_id: destination.channelId,
        provider: "twilio_sms",
        provider_message_id: messageSid,
        destination: from,
        status: "received",
        raw_payload: Object.fromEntries(params.entries()),
    })
    after(() => notifyClientChatMessage({
        workspaceId,
        relationshipId: destination.relationshipId,
        messageId: message.id,
        senderName: "A client",
        previewBody: body,
        attachment: media ? { kind: media.kind, fileName: media.fileName } : null,
    }))
    return twimlResponse()
}
