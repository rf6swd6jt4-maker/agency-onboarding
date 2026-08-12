import { getRequiredEnv } from "@/lib/env"
import { toMetaWhatsAppRecipient } from "@/lib/client-messages/addresses"
import { formatMetaWhatsAppApiError } from "@/lib/client-messages/meta-whatsapp-errors"
import { getWorkspaceProviderConfig } from "@/lib/workspace-integrations"

type SendMetaWhatsAppMessageInput = {
    workspaceId?: string
    to: string
    body: string
    replyToMessageId?: string | null
}

type SendMetaWhatsAppTemplateInput = {
    workspaceId?: string
    to: string
    templateName: string
    languageCode: string
    components?: unknown[]
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
}: SendMetaWhatsAppMessageInput) {
    const config = await metaConfig(workspaceId)
    const phoneNumberId = config.phone_number_id
    const accessToken = config.access_token

    const response = await fetch(
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

    const responseBody = await response.text()

    if (!response.ok) {
        throw new Error(
            formatMetaWhatsAppApiError({
                action: "Meta WhatsApp message",
                status: response.status,
                responseBody,
            })
        )
    }

    return responseBody ? JSON.parse(responseBody) : null
}

export async function sendMetaWhatsAppTemplate({
    workspaceId,
    to,
    templateName,
    languageCode,
    components,
}: SendMetaWhatsAppTemplateInput) {
    const config = await metaConfig(workspaceId)
    const phoneNumberId = config.phone_number_id
    const accessToken = config.access_token

    const response = await fetch(
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

    const responseBody = await response.text()

    if (!response.ok) {
        throw new Error(
            formatMetaWhatsAppApiError({
                action: "Meta WhatsApp template message",
                status: response.status,
                responseBody,
            })
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
