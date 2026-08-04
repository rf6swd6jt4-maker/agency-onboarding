import { NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { platformFailureFingerprint, reportClientPlatformFailure } from "@/lib/admin/maintenance"
import {
    getEquivalentMessageAddresses,
    normalizeMessageAddress,
} from "@/lib/client-messages/addresses"
import {
    downloadMetaWhatsAppMedia,
    getMetaWhatsAppMedia,
} from "@/lib/client-messages/meta-whatsapp"
import { storeClientMessageMedia } from "@/lib/onboarding/uploads"
import { handleSaleConsentConfirmation } from "@/lib/client-sales/automation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type WhatsAppMediaPayload = {
    id?: string
    mime_type?: string
    sha256?: string
    caption?: string
    filename?: string
}

type WhatsAppMessage = {
    from?: string
    id?: string
    timestamp?: string
    type?: string
    context?: {
        id?: string
        from?: string
    }
    text?: {
        body?: string
    }
    button?: {
        text?: string
        payload?: string
    }
    interactive?: {
        type?: string
        button_reply?: {
            id?: string
            title?: string
        }
        list_reply?: {
            id?: string
            title?: string
            description?: string
        }
    }
    image?: WhatsAppMediaPayload
    video?: WhatsAppMediaPayload
    audio?: WhatsAppMediaPayload
    document?: WhatsAppMediaPayload
    sticker?: WhatsAppMediaPayload
}

type WhatsAppChangeValue = {
    metadata?: {
        display_phone_number?: string
        phone_number_id?: string
    }
    messages?: WhatsAppMessage[]
    statuses?: WhatsAppStatus[]
}

type WhatsAppStatus = {
    id?: string
    status?: string
    timestamp?: string
    recipient_id?: string
    errors?: Array<{
        code?: number
        title?: string
        message?: string
        error_data?: {
            details?: string
        }
    }>
}

type WhatsAppWebhookPayload = {
    entry?: Array<{
        changes?: Array<{
            field?: string
            value?: WhatsAppChangeValue
        }>
    }>
}

type InboundMessageContent = {
    body: string
    logBody?: string
    media?: {
        id: string
        type: string
        fileName: string
        mimeType: string
        storagePath: string
        url: string
    }
}

type ClientCommunicationChannel = {
    id: string
    client_id: string
    external_address: string
}

function logDiagnosticInsertError(context: string, error: unknown) {
    console.error(
        `Meta WhatsApp bridge diagnostic failed: ${context}`,
        error instanceof Error ? error.message : error
    )
}

async function resolveInboundChannel(fromAddress: string) {
    const equivalentAddresses = getEquivalentMessageAddresses(fromAddress)
    const { data: exactChannel, error: exactChannelError } = await supabaseAdmin
        .from("client_communication_channels")
        .select("id, client_id, external_address")
        .eq("provider", "meta_whatsapp")
        .in("external_address", equivalentAddresses)
        .eq("is_active", true)
        .maybeSingle()

    if (exactChannelError) {
        throw new Error(
            `Could not look up WhatsApp channel: ${exactChannelError.message}`
        )
    }

    if (exactChannel) {
        return await repairChannelAddress(
            exactChannel as ClientCommunicationChannel,
            fromAddress
        )
    }

    const { data: client, error: clientError } = await supabaseAdmin
        .from("clients")
        .select("id")
        .in("phone", equivalentAddresses)
        .is("archived_at", null)
        .maybeSingle()

    if (clientError) {
        throw new Error(
            `Could not look up client by WhatsApp phone: ${clientError.message}`
        )
    }

    if (!client) return null

    const { data: clientChannel, error: clientChannelError } =
        await supabaseAdmin
            .from("client_communication_channels")
            .select("id, client_id, external_address")
            .eq("client_id", client.id)
            .eq("provider", "meta_whatsapp")
            .eq("is_active", true)
            .maybeSingle()

    if (clientChannelError) {
        throw new Error(
            `Could not look up client WhatsApp channel: ${clientChannelError.message}`
        )
    }

    if (!clientChannel) return null

    return await repairChannelAddress(
        clientChannel as ClientCommunicationChannel,
        fromAddress
    )
}

async function repairChannelAddress(
    channel: ClientCommunicationChannel,
    normalizedAddress: string
) {
    if (channel.external_address === normalizedAddress) return channel

    const { error: updateError } = await supabaseAdmin
        .from("client_communication_channels")
        .update({
            external_address: normalizedAddress,
            updated_at: new Date().toISOString(),
        })
        .eq("id", channel.id)

    if (updateError) {
        console.error(
            "Meta WhatsApp bridge could not repair channel address",
            updateError.message
        )
    }

    return {
        ...channel,
        external_address: normalizedAddress,
    }
}

async function logWebhookError({
    message,
    payload,
    fromAddress,
    toAddress,
    providerMessageId,
}: {
    message: string
    payload: unknown
    fromAddress?: string | null
    toAddress?: string | null
    providerMessageId?: string | null
}) {
    try {
        const { error } = await supabaseAdmin.from("client_messages").insert({
            direction: "inbound",
            provider: "meta_whatsapp",
            provider_message_id: providerMessageId ?? null,
            from_address: fromAddress ?? null,
            to_address: toAddress ?? null,
            body: "[Webhook error]",
            status: "webhook_failed",
            error: message,
            raw_payload: payload,
        })

        if (error) logDiagnosticInsertError("webhook_failed insert", error)
    } catch (error) {
        logDiagnosticInsertError("webhook_failed insert threw", error)
        // Meta webhooks must still be acknowledged even if diagnostics fail.
    }
}

async function logWebhookNotice({
    message,
    payload,
    fromAddress,
    toAddress,
}: {
    message: string
    payload: unknown
    fromAddress?: string | null
    toAddress?: string | null
}) {
    try {
        const { error } = await supabaseAdmin.from("client_messages").insert({
            direction: "inbound",
            provider: "meta_whatsapp",
            from_address: fromAddress ?? null,
            to_address: toAddress ?? null,
            body: message,
            status: "webhook_ignored",
            raw_payload: payload,
        })

        if (error) logDiagnosticInsertError("webhook_ignored insert", error)
    } catch (error) {
        logDiagnosticInsertError("webhook_ignored insert threw", error)
        // Meta webhooks must still be acknowledged even if diagnostics fail.
    }
}

function getFirstStatusRecipientAddress(payload: WhatsAppWebhookPayload) {
    const statuses =
        payload.entry
            ?.flatMap((entry) => entry.changes ?? [])
            .flatMap((change) => change.value?.statuses ?? []) ?? []

    for (const status of statuses) {
        if (!status || typeof status !== "object") continue

        const recipientId = (status as { recipient_id?: unknown }).recipient_id

        if (typeof recipientId === "string") {
            return normalizeMessageAddress(`whatsapp:${recipientId}`)
        }
    }

    return null
}

function getStatusError(status: WhatsAppStatus) {
    const error = status.errors?.[0]

    if (!error) return null

    return [
        error.title,
        error.message,
        error.error_data?.details,
        error.code ? `Meta code ${error.code}` : null,
    ]
        .filter(Boolean)
        .join(": ")
}

async function handleStatusUpdate({
    status,
    payload,
}: {
    status: WhatsAppStatus
    payload: WhatsAppWebhookPayload
}) {
    const messageId = status.id

    if (!messageId) return

    const messageStatus = status.status ?? "status_update"
    const errorMessage = getStatusError(status)
    const { data: message } = await supabaseAdmin
        .from("client_messages")
        .select("id, client_id, raw_payload")
        .or(
            `provider_message_id.eq.${messageId},whatsapp_message_id.eq.${messageId}`
        )
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

    if (message) {
        await supabaseAdmin
            .from("client_messages")
            .update({
                status:
                    messageStatus === "failed"
                        ? "delivery_failed"
                        : `whatsapp_${messageStatus}`,
                error: errorMessage,
                raw_payload: {
                    ...(message.raw_payload &&
                    typeof message.raw_payload === "object" &&
                    !Array.isArray(message.raw_payload)
                        ? message.raw_payload
                        : {}),
                    meta_status: status,
                    meta_status_payload: payload,
                },
            })
            .eq("id", message.id)
    }

    if (messageStatus === "failed") {
        await supabaseAdmin
            .from("client_sales")
            .update({
                status: "paid_consent_template_failed",
                raw_payload: {
                    meta_status: status,
                    meta_status_payload: payload,
                },
                updated_at: new Date().toISOString(),
            })
            .eq("consent_template_message_id", messageId)
        if (message?.client_id) {
            await reportClientPlatformFailure({
                clientId: message.client_id,
                category: "communications",
                source: "meta_whatsapp",
                operation: "delivery_status",
                fingerprint: platformFailureFingerprint(["whatsapp", "delivery", status.errors?.[0]?.code ?? errorMessage ?? "failed"]),
                severity: "warning",
                summary: "WhatsApp reported a message delivery failure",
                diagnostics: { provider_message_id: messageId, error: errorMessage, status },
            })
        }
    }
}

function getFirstBusinessAddress(payload: WhatsAppWebhookPayload) {
    const metadata =
        payload.entry
            ?.flatMap((entry) => entry.changes ?? [])
            .map((change) => change.value?.metadata)
            .find(Boolean) ?? null
    const displayPhoneNumber = metadata?.display_phone_number

    return displayPhoneNumber
        ? normalizeMessageAddress(`whatsapp:${displayPhoneNumber}`)
        : null
}

function getMessageTimestampMs(message: WhatsAppMessage) {
    const timestamp = Number(message.timestamp)

    return Number.isFinite(timestamp) ? timestamp * 1000 : Date.now()
}

function getMediaPayload(message: WhatsAppMessage) {
    switch (message.type) {
        case "image":
            return message.image ? { type: "image", media: message.image } : null
        case "video":
            return message.video ? { type: "video", media: message.video } : null
        case "audio":
            return message.audio ? { type: "audio", media: message.audio } : null
        case "document":
            return message.document
                ? { type: "document", media: message.document }
                : null
        case "sticker":
            return message.sticker
                ? { type: "sticker", media: message.sticker }
                : null
        default:
            return null
    }
}

function getInboundText(message: WhatsAppMessage) {
    const textBody = message.text?.body?.trim()

    if (textBody) return textBody

    const buttonText = message.button?.text ?? message.button?.payload

    if (typeof buttonText === "string" && buttonText.trim()) {
        return buttonText.trim()
    }

    const buttonReply =
        message.interactive?.button_reply?.title ??
        message.interactive?.button_reply?.id

    if (typeof buttonReply === "string" && buttonReply.trim()) {
        return buttonReply.trim()
    }

    const listReply =
        message.interactive?.list_reply?.title ??
        message.interactive?.list_reply?.id

    if (typeof listReply === "string" && listReply.trim()) {
        return listReply.trim()
    }

    return null
}

function getExtensionFromMimeType(mimeType: string) {
    const extensionByMimeType: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "video/mp4": "mp4",
        "audio/aac": "aac",
        "audio/mp4": "m4a",
        "audio/mpeg": "mp3",
        "audio/ogg": "ogg",
        "application/pdf": "pdf",
        "text/plain": "txt",
    }

    return extensionByMimeType[mimeType.toLowerCase()] ?? "bin"
}

function titleCase(value: string) {
    return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatMediaMessageForLog({
    type,
    url,
    caption,
    fileName,
}: {
    type: string
    url: string
    caption?: string
    fileName?: string
}) {
    const mediaName = titleCase(type)
    const mediaLink =
        type === "image"
            ? `![${caption?.trim() || mediaName}](${url})\n[Open image](${url})`
            : `${mediaName}: [${fileName || `open ${type}`}](${url})`
    const captionLines = caption?.trim()
        ? ["", caption.trim()]
        : []

    return [mediaLink, ...captionLines].join("\n")
}

async function getInboundMessageContent({
    clientId,
    workspaceId,
    message,
    appBaseUrl,
}: {
    clientId: string
    workspaceId: string
    message: WhatsAppMessage
    appBaseUrl: string
}): Promise<InboundMessageContent | null> {
    const textBody = message.text?.body?.trim()

    if (message.type === "text" && textBody) {
        return {
            body: textBody,
            logBody: textBody,
        }
    }

    const mediaPayload = getMediaPayload(message)

    if (!mediaPayload?.media.id) return null

    const mediaInfo = await getMetaWhatsAppMedia(mediaPayload.media.id)
    const mediaUrl =
        typeof mediaInfo?.url === "string" ? mediaInfo.url : null
    const mimeType =
        mediaPayload.media.mime_type ??
        (typeof mediaInfo?.mime_type === "string"
            ? mediaInfo.mime_type
            : "application/octet-stream")

    if (!mediaUrl) {
        throw new Error("Meta WhatsApp media lookup did not return a URL")
    }

    const downloadedMedia = await downloadMetaWhatsAppMedia(mediaUrl)
    const contentType =
        downloadedMedia.contentType === "application/octet-stream"
            ? mimeType
            : downloadedMedia.contentType
    const fileName =
        mediaPayload.media.filename ??
        `whatsapp-${mediaPayload.type}-${mediaPayload.media.id}.${getExtensionFromMimeType(contentType)}`
    const storedMedia = await storeClientMessageMedia({
        clientId,
        workspaceId,
        mediaId: mediaPayload.media.id,
        fileName,
        contentType,
        body: downloadedMedia.bytes,
        appBaseUrl,
    })
    const caption = mediaPayload.media.caption?.trim()
    const logBody = formatMediaMessageForLog({
        type: mediaPayload.type,
        url: storedMedia.url,
        caption,
        fileName,
    })

    return {
        body: caption
            ? `[${titleCase(mediaPayload.type)}] ${caption}`
            : `[${titleCase(mediaPayload.type)}] ${fileName}`,
        logBody,
        media: {
            id: mediaPayload.media.id,
            type: mediaPayload.type,
            fileName,
            mimeType: contentType,
            storagePath: storedMedia.path,
            url: storedMedia.url,
        },
    }
}

async function handleInboundMessage({
    message,
    value,
    payload,
    appBaseUrl,
}: {
    message: WhatsAppMessage
    value: WhatsAppChangeValue
    payload: WhatsAppWebhookPayload
    appBaseUrl: string
}) {
    const from = normalizeMessageAddress(`whatsapp:${message.from ?? ""}`)
    const to = value.metadata?.display_phone_number
        ? normalizeMessageAddress(`whatsapp:${value.metadata.display_phone_number}`)
        : null
    const messageId = message.id ?? null
    const replyToWhatsAppMessageId = message.context?.id ?? null

    if (!from) return

    const { data: existingMessage } = messageId
        ? await supabaseAdmin
              .from("client_messages")
              .select("id")
              .eq("provider", "meta_whatsapp")
              .eq("provider_message_id", messageId)
              .maybeSingle()
        : { data: null }

    if (existingMessage) return

    const pendingSaleConfirmation = await handleSaleConsentConfirmation({
        fromAddress: from,
        messageId,
        body: getInboundText(message) ?? "",
        rawPayload: payload,
    })

    if (pendingSaleConfirmation.handled) return

    const channel = await resolveInboundChannel(from)

    if (!channel) {
        const unmatchedBody =
            getInboundText(message) ||
            `[Unsupported ${message.type ?? "message"}]`

        const { error } = await supabaseAdmin.from("client_messages").insert({
            direction: "inbound",
            provider: "meta_whatsapp",
            provider_message_id: messageId,
            whatsapp_message_id: messageId,
            reply_to_whatsapp_message_id: replyToWhatsAppMessageId,
            from_address: from,
            to_address: to,
            body: unmatchedBody,
            status: "unmatched",
            raw_payload: payload,
        })

        if (error) {
            throw new Error(
                `Could not record unmatched WhatsApp message: ${error.message}`
            )
        }

        return
    }

    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("name, workspace_id, relationship_id")
        .eq("id", channel.client_id)
        .single()
    const initialBody =
        getInboundText(message) || `[${titleCase(message.type ?? "message")}]`
    const { data: insertedMessage, error: insertError } = await supabaseAdmin
        .from("client_messages")
        .insert({
            client_id: channel.client_id,
            relationship_id: client?.relationship_id ?? null,
            communication_channel_id: channel.id,
            direction: "inbound",
            provider: "meta_whatsapp",
            provider_message_id: messageId,
            whatsapp_message_id: messageId,
            reply_to_whatsapp_message_id: replyToWhatsAppMessageId,
            from_address: from,
            to_address: to,
            body: initialBody,
            status: "received",
            raw_payload: payload,
        })
        .select("id")
        .single()

    if (insertError || !insertedMessage) {
        throw new Error(
            insertError
                ? `Could not record inbound WhatsApp message: ${insertError.message}`
                : "Could not record inbound WhatsApp message"
        )
    }

    let content: InboundMessageContent | null = null

    try {
        content = await getInboundMessageContent({
            clientId: channel.client_id,
            workspaceId: client?.workspace_id ?? "",
            message,
            appBaseUrl,
        })
    } catch (error) {
        const errorMessage =
            error instanceof Error
                ? error.message
                : "Unknown WhatsApp media error"
        const fallbackBody =
            message.text?.body?.trim() || `[${titleCase(message.type ?? "media")}]`

        await supabaseAdmin
            .from("client_messages")
            .update({
                body: fallbackBody,
                status: "media_failed",
                error: errorMessage,
            })
            .eq("id", insertedMessage.id)

        return
    }

    if (!content) {
        await supabaseAdmin
            .from("client_messages")
            .update({
                status: "unsupported",
                error: `Unsupported WhatsApp message type: ${message.type ?? "unknown"}`,
            })
            .eq("id", insertedMessage.id)

        return
    }

    await supabaseAdmin
        .from("client_messages")
        .update({
            body: content.body,
            raw_payload: {
                ...payload,
                log_body: content.logBody ?? content.body,
                bridge_media: content.media ?? null,
            },
        })
        .eq("id", insertedMessage.id)
}

export async function GET(request: NextRequest) {
    const url = new URL(request.url)
    const mode = url.searchParams.get("hub.mode")
    const token = url.searchParams.get("hub.verify_token")
    const challenge = url.searchParams.get("hub.challenge")

    if (
        mode === "subscribe" &&
        token === process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN &&
        challenge
    ) {
        return new Response(challenge, { status: 200 })
    }

    return new Response("Forbidden", { status: 403 })
}

export async function POST(request: NextRequest) {
    try {
        const appBaseUrl = new URL(request.url).origin
        const payload = (await request.json()) as WhatsAppWebhookPayload
        const inboundMessages =
            payload.entry
                ?.flatMap((entry) => entry.changes ?? [])
                .flatMap((change) =>
                    (change.value?.messages ?? []).map((message) => ({
                        message,
                        value: change.value ?? {},
                    }))
                ) ?? []

        inboundMessages.sort(
            (left, right) =>
                getMessageTimestampMs(left.message) -
                getMessageTimestampMs(right.message)
        )

        if (inboundMessages.length === 0) {
            const statusUpdates =
                payload.entry
                    ?.flatMap((entry) => entry.changes ?? [])
                    .flatMap((change) => change.value?.statuses ?? []) ?? []

            for (const status of statusUpdates) {
                await handleStatusUpdate({
                    status,
                    payload,
                })
            }

            const changeFields =
                payload.entry
                    ?.flatMap((entry) => entry.changes ?? [])
                    .map((change) => change.field ?? "unknown")
                    .join(", ") || "none"
            const statusCount =
                payload.entry
                    ?.flatMap((entry) => entry.changes ?? [])
                    .reduce(
                        (total, change) =>
                            total + (change.value?.statuses?.length ?? 0),
                        0
                    ) ?? 0
            const notice =
                statusCount > 0
                    ? `[Webhook received status update, not a client message: ${changeFields}]`
                    : `[Webhook received without WhatsApp messages: ${changeFields}]`

            console.info("Meta WhatsApp webhook had no messages", {
                changeFields,
                statusCount,
            })

            await logWebhookNotice({
                message: notice,
                payload,
                fromAddress: getFirstBusinessAddress(payload),
                toAddress: getFirstStatusRecipientAddress(payload),
            })
        }

        const errors: string[] = []

        for (const { message, value } of inboundMessages) {
            try {
                await handleInboundMessage({
                    message,
                    value,
                    payload,
                    appBaseUrl,
                })
            } catch (error) {
                const messageText =
                    error instanceof Error
                        ? error.message
                        : "Unknown inbound WhatsApp error"
                errors.push(messageText)

                await logWebhookError({
                    message: messageText,
                    payload,
                    fromAddress: message.from
                        ? normalizeMessageAddress(`whatsapp:${message.from}`)
                        : null,
                    toAddress: value.metadata?.display_phone_number
                        ? normalizeMessageAddress(
                              `whatsapp:${value.metadata.display_phone_number}`
                          )
                        : null,
                    providerMessageId: message.id ?? null,
                })
            }
        }

        return Response.json({
            ok: true,
            processed: inboundMessages.length,
            errors,
        })
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : "Unknown WhatsApp webhook error"

        await logWebhookError({
            message,
            payload: {},
        })

        return Response.json({
            ok: true,
            ignored: true,
            error: message,
        })
    }
}
