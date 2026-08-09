import { supabaseAdmin } from "@/lib/supabase/admin"
import { sendMetaWhatsAppMessage } from "@/lib/client-messages/meta-whatsapp"
import { shouldIgnoreClickUpMessage } from "@/lib/client-messages/clickup-message-filters"
import { platformFailureFingerprint, reportClientPlatformFailure } from "@/lib/admin/maintenance"
import { recordClientAdminActivity } from "@/lib/admin/activity"

export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

type BridgeChannel = {
    id: string
    client_id: string
    external_address: string
}

type SendLoggedClickUpMessageToWhatsAppInput = {
    channel: BridgeChannel
    messageId?: string | null
    body: string
    rawPayload: JsonObject
    replyToWhatsAppMessageId?: string | null
}

type SendClickUpMessageEditToWhatsAppInput = {
    channel: BridgeChannel
    messageId: string
    body: string
    rawPayload: JsonObject
}

type BridgeRequest = {
    headers: {
        get(name: string): string | null
    }
    url: string
}

export function isBridgeRequestAuthorized(
    request: BridgeRequest,
    { allowQuerySecret = false }: { allowQuerySecret?: boolean } = {}
) {
    const secret = process.env.CLIENT_MESSAGES_BRIDGE_SECRET

    if (!secret) return false

    const authorization = request.headers.get("authorization")
    const bridgeSecret = request.headers.get("x-bridge-secret")
    const querySecret = allowQuerySecret
        ? new URL(request.url).searchParams.get("secret")
        : null

    return (
        authorization === `Bearer ${secret}` ||
        bridgeSecret === secret ||
        querySecret === secret
    )
}

export function getByPath(payload: JsonValue, path: string) {
    return path.split(".").reduce<JsonValue | undefined>((current, key) => {
        if (!current || typeof current !== "object" || Array.isArray(current)) {
            return undefined
        }

        return current[key]
    }, payload)
}

export function firstString(payload: JsonValue, paths: string[]) {
    for (const path of paths) {
        const value = getByPath(payload, path)

        if (typeof value === "string" && value.trim()) {
            return value.trim()
        }

        if (typeof value === "number") {
            return String(value)
        }
    }

    return null
}

export function getMessagesFromResponse(response: JsonValue): JsonObject[] {
    const candidates = [
        response,
        getByPath(response, "data"),
        getByPath(response, "messages"),
        getByPath(response, "data.messages"),
    ]

    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate.filter(
                (item): item is JsonObject =>
                    Boolean(item) &&
                    typeof item === "object" &&
                    !Array.isArray(item)
            )
        }
    }

    return []
}

export { shouldIgnoreClickUpMessage }


function stripBoldHeader(value: string) {
    return value.replace(/^\*\*[^*]+\*\*\s*/u, "").trim()
}

export async function wasClickUpMessageProcessed(messageId: string) {
    const { data: duplicate } = await supabaseAdmin
        .from("client_messages")
        .select("id")
        .or(
            `provider_message_id.eq.${messageId},clickup_message_id.eq.${messageId}`
        )
        .maybeSingle()

    return Boolean(duplicate)
}

function asJsonObject(value: JsonValue | undefined) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {}
}

export async function isRecentInboundEcho({
    clientId,
    body,
}: {
    clientId: string
    body: string
}) {
    const { data: lastInbound } = await supabaseAdmin
        .from("client_messages")
        .select("body, raw_payload, created_at")
        .eq("client_id", clientId)
        .eq("direction", "inbound")
        .eq("provider", "meta_whatsapp")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

    if (!lastInbound) return false

    const twoMinutesAgo = Date.now() - 2 * 60 * 1000

    if (new Date(lastInbound.created_at).getTime() < twoMinutesAgo) {
        return false
    }

    const normalizedBody = body.trim()
    const normalizedBodyWithoutHeader = stripBoldHeader(normalizedBody)
    const bridgeMedia = getByPath(lastInbound.raw_payload, "bridge_media")
    const bridgeMediaUrl =
        bridgeMedia && typeof bridgeMedia === "object" && !Array.isArray(bridgeMedia)
            ? (bridgeMedia.url as JsonValue)
            : null

    return (
        normalizedBody === lastInbound.body ||
        normalizedBodyWithoutHeader === lastInbound.body ||
        Boolean(
            typeof bridgeMediaUrl === "string" &&
                bridgeMediaUrl &&
                normalizedBody.includes(bridgeMediaUrl)
        )
    )
}

export async function getWhatsAppMessageIdForClickUpMessage({
    clientId,
    clickupMessageId,
}: {
    clientId: string
    clickupMessageId: string
}) {
    const { data: message } = await supabaseAdmin
        .from("client_messages")
        .select("whatsapp_message_id")
        .eq("client_id", clientId)
        .eq("clickup_message_id", clickupMessageId)
        .not("whatsapp_message_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

    return message?.whatsapp_message_id ?? null
}

export async function sendLoggedClickUpMessageToWhatsApp({
    channel,
    messageId,
    body,
    rawPayload,
    replyToWhatsAppMessageId,
}: SendLoggedClickUpMessageToWhatsAppInput) {
    const { data: messageLog } = await supabaseAdmin
        .from("client_messages")
        .insert({
            client_id: channel.client_id,
            communication_channel_id: channel.id,
            direction: "outbound",
            provider: "clickup_chat",
            provider_message_id: messageId,
            clickup_message_id: messageId,
            to_address: channel.external_address,
            body,
            status: "sending",
            reply_to_whatsapp_message_id: replyToWhatsAppMessageId ?? null,
            raw_payload: rawPayload,
        })
        .select("id")
        .single()

    try {
        const whatsappMessage = await sendMetaWhatsAppMessage({
            to: channel.external_address,
            body,
            replyToMessageId: replyToWhatsAppMessageId,
        })
        const whatsappMessageId = whatsappMessage?.messages?.[0]?.id

        await supabaseAdmin
            .from("client_messages")
            .update({
                status: "sent",
                provider_message_id: messageId ?? whatsappMessageId ?? null,
                clickup_message_id: messageId ?? null,
                whatsapp_message_id: whatsappMessageId ?? null,
                raw_payload: {
                    ...rawPayload,
                    bridge_whatsapp_message_id: whatsappMessageId ?? null,
                    bridge_reply_to_whatsapp_message_id:
                        replyToWhatsAppMessageId ?? null,
                },
            })
            .eq("id", messageLog?.id)

        await recordClientAdminActivity({ clientId: channel.client_id, category: "communications", eventKey: "whatsapp.message.sent", summary: "WhatsApp message sent by ClickUp automation", entityType: "client_message", entityId: messageLog?.id ?? whatsappMessageId ?? null, direction: "outbound", metadata: { whatsapp_message_id: whatsappMessageId ?? null, clickup_message_id: messageId ?? null } })

        return {
            ok: true,
            messageLogId: messageLog?.id,
            whatsappMessageId,
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown Meta WhatsApp error"
        await supabaseAdmin
            .from("client_messages")
            .update({
                status: "send_failed",
                error: message,
            })
            .eq("id", messageLog?.id)

        await reportClientPlatformFailure({
            clientId: channel.client_id,
            category: "communications",
            source: "clickup_whatsapp_bridge",
            operation: "send_whatsapp_message",
            fingerprint: platformFailureFingerprint(["whatsapp", "send", message]),
            severity: "warning",
            summary: "WhatsApp message delivery automation failed",
            diagnostics: { error: message, clickup_message_id: messageId ?? null, message_log_id: messageLog?.id ?? null },
        })

        return {
            ok: false,
            messageLogId: messageLog?.id,
            error,
        }
    }
}

export async function sendClickUpMessageEditToWhatsApp({
    channel,
    messageId,
    body,
    rawPayload,
}: SendClickUpMessageEditToWhatsAppInput) {
    const { data: existingMessage } = await supabaseAdmin
        .from("client_messages")
        .select("id, body, whatsapp_message_id, raw_payload")
        .eq("client_id", channel.client_id)
        .eq("direction", "outbound")
        .eq("provider", "clickup_chat")
        .or(
            `provider_message_id.eq.${messageId},clickup_message_id.eq.${messageId}`
        )
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

    if (!existingMessage) {
        return {
            handled: false,
            ok: false,
            reason: "not_previously_sent",
        }
    }

    if (existingMessage.body === body) {
        return {
            handled: true,
            ok: true,
            sent: false,
            reason: "unchanged",
        }
    }

    if (!existingMessage.whatsapp_message_id) {
        return {
            handled: true,
            ok: false,
            sent: false,
            reason: "missing_whatsapp_message_id",
        }
    }

    try {
        const whatsappMessage = await sendMetaWhatsAppMessage({
            to: channel.external_address,
            body: `${body} *`,
            replyToMessageId: existingMessage.whatsapp_message_id,
        })
        const editWhatsAppMessageId = whatsappMessage?.messages?.[0]?.id ?? null

        await supabaseAdmin
            .from("client_messages")
            .update({
                body,
                status: "sent",
                error: null,
                raw_payload: {
                    ...asJsonObject(existingMessage.raw_payload),
                    bridge_last_edit_payload: rawPayload,
                    bridge_last_edit_sent_body: body,
                    bridge_last_edit_whatsapp_message_id:
                        editWhatsAppMessageId,
                },
            })
            .eq("id", existingMessage.id)

        await recordClientAdminActivity({ clientId: channel.client_id, category: "communications", eventKey: "whatsapp.message.edit_sent", summary: "WhatsApp message edit sent by ClickUp automation", entityType: "client_message", entityId: existingMessage.id, direction: "outbound", metadata: { whatsapp_message_id: editWhatsAppMessageId, clickup_message_id: messageId } })

        return {
            handled: true,
            ok: true,
            sent: true,
            editWhatsAppMessageId,
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown Meta WhatsApp edit send error"
        await supabaseAdmin
            .from("client_messages")
            .update({
                status: "edit_send_failed",
                error: message,
            })
            .eq("id", existingMessage.id)

        await reportClientPlatformFailure({
            clientId: channel.client_id,
            category: "communications",
            source: "clickup_whatsapp_bridge",
            operation: "send_whatsapp_edit",
            fingerprint: platformFailureFingerprint(["whatsapp", "edit", message]),
            severity: "warning",
            summary: "WhatsApp message edit automation failed",
            diagnostics: { error: message, clickup_message_id: messageId, message_log_id: existingMessage.id },
        })

        return {
            handled: true,
            ok: false,
            sent: false,
            error,
        }
    }
}
