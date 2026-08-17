import { createHmac, timingSafeEqual } from "crypto"

import { toE164Recipient } from "@/lib/client-messages/addresses"
import { getWorkspaceProviderConfig } from "@/lib/workspace-integrations"

type TwilioMessageResponse = {
    sid?: string
    status?: string
    error_code?: number | null
    error_message?: string | null
    message?: string
}

export class TwilioMessagingError extends Error {
    status: number
    code: number | null
    safeToRetry: boolean

    constructor(message: string, status: number, code?: number | null) {
        super(message)
        this.name = "TwilioMessagingError"
        this.status = status
        this.code = code ?? null
        this.safeToRetry = status >= 400 && status < 500 && status !== 429
    }
}

function basicAuthorization(accountSid: string, authToken: string) {
    return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`
}

export async function sendTwilioMessage(input: {
    workspaceId: string
    to: string
    body: string
    mediaUrls?: string[]
    callbackData?: string | null
}) {
    const config = await getWorkspaceProviderConfig(input.workspaceId, "twilio_sms")
    if (!config.account_sid || !config.auth_token || !config.phone_number) {
        throw new Error("Twilio is missing its Account SID, Auth Token, or sending number.")
    }
    const to = toE164Recipient(input.to)
    if (!to) throw new Error("The SMS destination is invalid.")
    const body = new URLSearchParams({ To: to, Body: input.body })
    body.set("From", toE164Recipient(config.phone_number))
    const statusCallback = new URL("/api/client-messages/twilio", process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.betelgeze.com")
    if (input.callbackData) statusCallback.searchParams.set("messageId", input.callbackData)
    body.set("StatusCallback", statusCallback.toString())
    for (const mediaUrl of input.mediaUrls?.slice(0, 10) ?? []) body.append("MediaUrl", mediaUrl)

    let response: Response
    try {
        response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.account_sid)}/Messages.json`, {
            method: "POST",
            headers: {
                Authorization: basicAuthorization(config.account_sid, config.auth_token),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
            cache: "no-store",
        })
    } catch (error) {
        throw new TwilioMessagingError(error instanceof Error ? error.message : "Twilio did not return a response.", 0)
    }
    const payload = await response.json().catch(() => ({})) as TwilioMessageResponse
    if (!response.ok || !payload.sid) {
        throw new TwilioMessagingError(payload.message || payload.error_message || `Twilio rejected the message (${response.status}).`, response.status, payload.error_code)
    }
    return payload
}

export function twilioFailureIsSafeToRetry(error: unknown) {
    return error instanceof TwilioMessagingError ? error.safeToRetry : false
}

export async function downloadTwilioMedia(workspaceId: string, rawUrl: string) {
    const config = await getWorkspaceProviderConfig(workspaceId, "twilio_sms")
    if (!config.account_sid || !config.auth_token) throw new Error("Twilio media credentials are unavailable.")
    let url: URL
    try {
        url = new URL(rawUrl)
    } catch {
        throw new Error("Twilio returned an invalid media URL.")
    }
    const requiredPrefix = `/2010-04-01/Accounts/${encodeURIComponent(config.account_sid)}/Messages/`
    if (url.protocol !== "https:" || url.hostname !== "api.twilio.com" || !url.pathname.startsWith(requiredPrefix) || !url.pathname.includes("/Media/")) {
        throw new Error("Twilio returned a media URL outside the connected account.")
    }
    const response = await fetch(url, {
        headers: { Authorization: basicAuthorization(config.account_sid, config.auth_token) },
        cache: "no-store",
        redirect: "error",
    })
    if (!response.ok) throw new Error(`Twilio media download failed (${response.status}).`)
    return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get("content-type")?.split(";", 1)[0] ?? "application/octet-stream",
    }
}

export async function validateTwilioSignature(input: {
    workspaceId: string
    url: string
    params: URLSearchParams
    signature: string | null
}) {
    if (!input.signature) return false
    const config = await getWorkspaceProviderConfig(input.workspaceId, "twilio_sms")
    if (!config.auth_token) return false
    const sortedNames = [...new Set(input.params.keys())].sort()
    let signed = input.url
    for (const name of sortedNames) {
        for (const value of input.params.getAll(name).sort()) signed += `${name}${value}`
    }
    const expected = createHmac("sha1", config.auth_token).update(signed).digest("base64")
    const expectedBuffer = Buffer.from(expected)
    const receivedBuffer = Buffer.from(input.signature)
    return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer)
}
