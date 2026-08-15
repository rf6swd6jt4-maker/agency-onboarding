import { getRequiredEnv } from "@/lib/env"
import { toMetaWhatsAppRecipient } from "@/lib/client-messages/addresses"
import { formatMetaWhatsAppApiError } from "@/lib/client-messages/meta-whatsapp-errors"
import { getWorkspaceProviderConfig } from "@/lib/workspace-integrations"

type SendMetaWhatsAppMessageInput = {
    workspaceId?: string
    to: string
    body: string
    replyToMessageId?: string | null
    callbackData?: string | null
}

type SendMetaWhatsAppTemplateInput = {
    workspaceId?: string
    to: string
    templateName: string
    languageCode: string
    components?: unknown[]
    callbackData?: string | null
}

type SendMetaWhatsAppMediaInput = {
    workspaceId?: string
    to: string
    kind: "image" | "video" | "document"
    link: string
    caption?: string | null
    fileName?: string | null
    replyToMessageId?: string | null
    callbackData?: string | null
}

type SendMetaWhatsAppStickerInput = {
    workspaceId?: string
    to: string
    link: string
    replyToMessageId?: string | null
    callbackData?: string | null
}

type SendMetaWhatsAppReactionInput = {
    workspaceId?: string
    to: string
    messageId: string
    emoji: string
}

export class MetaWhatsAppSendError extends Error {
    safeToRetry: boolean

    constructor(message: string, safeToRetry: boolean) {
        super(message)
        this.name = "MetaWhatsAppSendError"
        this.safeToRetry = safeToRetry
    }
}

export function metaWhatsAppFailureIsSafeToRetry(error: unknown) {
    return error instanceof MetaWhatsAppSendError && error.safeToRetry
}

export function metaWhatsAppFailureIsUncertain(error: unknown) {
    return error instanceof MetaWhatsAppSendError && !error.safeToRetry
}

export function hasMetaWhatsAppConfig() {
    return Boolean(
        process.env.META_WHATSAPP_ACCESS_TOKEN &&
            process.env.META_WHATSAPP_PHONE_NUMBER_ID
    )
}

async function metaConfig(workspaceId?: string) {
    if (workspaceId) return getWorkspaceProviderConfig(workspaceId, "meta_whatsapp")
    return {
        access_token: getRequiredEnv("META_WHATSAPP_ACCESS_TOKEN"),
        phone_number_id: getRequiredEnv("META_WHATSAPP_PHONE_NUMBER_ID"),
    }
}

export async function sendMetaWhatsAppMessage({
    workspaceId,
    to,
    body,
    replyToMessageId,
    callbackData,
}: SendMetaWhatsAppMessageInput) {
    let config: Awaited<ReturnType<typeof metaConfig>>
    try {
        config = await metaConfig(workspaceId)
    } catch (error) {
        throw new MetaWhatsAppSendError(error instanceof Error ? error.message : "WhatsApp is not configured", true)
    }
    const phoneNumberId = config.phone_number_id
    const accessToken = config.access_token

    let response: Response
    try {
        response = await fetch(
            `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`,
            {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: toMetaWhatsAppRecipient(to),
                biz_opaque_callback_data: callbackData || undefined,
                context: replyToMessageId
                    ? {
                          message_id: replyToMessageId,
                      }
                    : undefined,
                type: "text",
                text: {
                    preview_url: false,
                    body,
                },
            }),
            }
        )
    } catch (error) {
        throw new MetaWhatsAppSendError(error instanceof Error ? error.message : "Meta WhatsApp request did not return a response", false)
    }

    const responseBody = await response.text()

    if (!response.ok) {
        throw new MetaWhatsAppSendError(
            formatMetaWhatsAppApiError({
                action: "Meta WhatsApp message",
                status: response.status,
                responseBody,
            }),
            true
        )
    }

    return responseBody ? JSON.parse(responseBody) : null
}

export async function sendMetaWhatsAppMedia({
    workspaceId,
    to,
    kind,
    link,
    caption,
    fileName,
    replyToMessageId,
    callbackData,
}: SendMetaWhatsAppMediaInput) {
    let config: Awaited<ReturnType<typeof metaConfig>>
    try {
        config = await metaConfig(workspaceId)
    } catch (error) {
        throw new MetaWhatsAppSendError(error instanceof Error ? error.message : "WhatsApp is not configured", true)
    }
    const media = {
        link,
        caption: caption || undefined,
        ...(kind === "document" && fileName ? { filename: fileName } : {}),
    }
    let response: Response
    try {
        response = await fetch(`https://graph.facebook.com/v25.0/${config.phone_number_id}/messages`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${config.access_token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: toMetaWhatsAppRecipient(to),
                biz_opaque_callback_data: callbackData || undefined,
                context: replyToMessageId ? { message_id: replyToMessageId } : undefined,
                type: kind,
                [kind]: media,
            }),
        })
    } catch (error) {
        throw new MetaWhatsAppSendError(error instanceof Error ? error.message : "Meta WhatsApp media request did not return a response", false)
    }
    const responseBody = await response.text()
    if (!response.ok) {
        throw new MetaWhatsAppSendError(formatMetaWhatsAppApiError({
            action: "Meta WhatsApp media message",
            status: response.status,
            responseBody,
        }), true)
    }
    return responseBody ? JSON.parse(responseBody) : null
}

export async function sendMetaWhatsAppSticker({
    workspaceId,
    to,
    link,
    replyToMessageId,
    callbackData,
}: SendMetaWhatsAppStickerInput) {
    let config: Awaited<ReturnType<typeof metaConfig>>
    try {
        config = await metaConfig(workspaceId)
    } catch (error) {
        throw new MetaWhatsAppSendError(error instanceof Error ? error.message : "WhatsApp is not configured", true)
    }
    let response: Response
    try {
        response = await fetch(`https://graph.facebook.com/v25.0/${config.phone_number_id}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${config.access_token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: toMetaWhatsAppRecipient(to),
                biz_opaque_callback_data: callbackData || undefined,
                context: replyToMessageId ? { message_id: replyToMessageId } : undefined,
                type: "sticker",
                sticker: { link },
            }),
        })
    } catch (error) {
        throw new MetaWhatsAppSendError(error instanceof Error ? error.message : "Meta WhatsApp sticker request did not return a response", false)
    }
    const responseBody = await response.text()
    if (!response.ok) throw new MetaWhatsAppSendError(formatMetaWhatsAppApiError({ action: "Meta WhatsApp sticker message", status: response.status, responseBody }), true)
    return responseBody ? JSON.parse(responseBody) : null
}

export async function sendMetaWhatsAppReaction({ workspaceId, to, messageId, emoji }: SendMetaWhatsAppReactionInput) {
    let config: Awaited<ReturnType<typeof metaConfig>>
    try {
        config = await metaConfig(workspaceId)
    } catch (error) {
        throw new MetaWhatsAppSendError(error instanceof Error ? error.message : "WhatsApp is not configured", true)
    }
    let response: Response
    try {
        response = await fetch(`https://graph.facebook.com/v25.0/${config.phone_number_id}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${config.access_token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: toMetaWhatsAppRecipient(to),
                type: "reaction",
                reaction: { message_id: messageId, emoji },
            }),
        })
    } catch (error) {
        throw new MetaWhatsAppSendError(error instanceof Error ? error.message : "Meta WhatsApp reaction request did not return a response", false)
    }
    const responseBody = await response.text()
    if (!response.ok) throw new MetaWhatsAppSendError(formatMetaWhatsAppApiError({ action: "Meta WhatsApp reaction", status: response.status, responseBody }), true)
    return responseBody ? JSON.parse(responseBody) : null
}

export async function sendMetaWhatsAppTemplate({
    workspaceId,
    to,
    templateName,
    languageCode,
    components,
    callbackData,
}: SendMetaWhatsAppTemplateInput) {
    let config: Awaited<ReturnType<typeof metaConfig>>
    try {
        config = await metaConfig(workspaceId)
    } catch (error) {
        throw new MetaWhatsAppSendError(error instanceof Error ? error.message : "WhatsApp is not configured", true)
    }
    const phoneNumberId = config.phone_number_id
    const accessToken = config.access_token

    let response: Response
    try {
        response = await fetch(
            `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`,
            {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: toMetaWhatsAppRecipient(to),
                biz_opaque_callback_data: callbackData || undefined,
                type: "template",
                template: {
                    name: templateName,
                    language: {
                        code: languageCode,
                    },
                    components:
                        components && components.length > 0
                            ? components
                            : undefined,
                },
            }),
            }
        )
    } catch (error) {
        throw new MetaWhatsAppSendError(error instanceof Error ? error.message : "Meta WhatsApp template request did not return a response", false)
    }

    const responseBody = await response.text()

    if (!response.ok) {
        throw new MetaWhatsAppSendError(
            formatMetaWhatsAppApiError({
                action: "Meta WhatsApp template message",
                status: response.status,
                responseBody,
            }),
            true
        )
    }

    return responseBody ? JSON.parse(responseBody) : null
}

export async function getMetaWhatsAppMedia(mediaId: string, workspaceId?: string) {
    const config = await metaConfig(workspaceId)
    const phoneNumberId = config.phone_number_id
    const accessToken = config.access_token
    const params = new URLSearchParams({
        phone_number_id: phoneNumberId,
    })

    const response = await fetch(
        `https://graph.facebook.com/v25.0/${mediaId}?${params.toString()}`,
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                accept: "application/json",
            },
        }
    )
    const responseBody = await response.text()

    if (!response.ok) {
        throw new Error(
            formatMetaWhatsAppApiError({
                action: "Meta WhatsApp media lookup",
                status: response.status,
                responseBody,
            })
        )
    }

    return responseBody ? JSON.parse(responseBody) : null
}

export async function downloadMetaWhatsAppMedia(mediaUrl: string, workspaceId?: string) {
    const config = await metaConfig(workspaceId)
    const accessToken = config.access_token
    const response = await fetch(mediaUrl, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    })

    if (!response.ok) {
        const responseBody = await response.text()

        throw new Error(
            formatMetaWhatsAppApiError({
                action: "Meta WhatsApp media download",
                status: response.status,
                responseBody,
            })
        )
    }

    return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType:
            response.headers.get("content-type") ??
            "application/octet-stream",
    }
}

export async function checkMetaWhatsAppAccess(workspaceId?: string) {
    const config = await metaConfig(workspaceId)
    const phoneNumberId = config.phone_number_id
    const accessToken = config.access_token
    const params = new URLSearchParams({
        fields: "id,display_phone_number,verified_name",
    })
    const response = await fetch(
        `https://graph.facebook.com/v25.0/${phoneNumberId}?${params.toString()}`,
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                accept: "application/json",
            },
        }
    )
    const responseBody = await response.text()

    if (!response.ok) {
        throw new Error(
            formatMetaWhatsAppApiError({
                action: "Meta WhatsApp connection check",
                status: response.status,
                responseBody,
            })
        )
    }

    return responseBody ? JSON.parse(responseBody) : null
}
