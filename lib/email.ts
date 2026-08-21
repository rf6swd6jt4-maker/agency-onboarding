import { Resend, type CreateEmailOptions, type ErrorResponse } from "resend"

export type EmailDeliveryFailureKind = "authentication" | "connection" | "tls" | "sender" | "recipient" | "configuration" | "unknown"

export class EmailDeliveryError extends Error {
    constructor(
        message: string,
        readonly kind: EmailDeliveryFailureKind,
        readonly providerCode: string | null = null,
        readonly providerCommand: string | null = null,
        readonly providerResponseCode: number | null = null,
        readonly providerResponse: string | null = null,
    ) {
        super(message)
        this.name = "EmailDeliveryError"
    }
}

const RESEND_COMMAND = "POST /emails"

function getEmailEnv(name: string) {
    const value = process.env[name]?.trim()
    if (!value) {
        throw new EmailDeliveryError(`Email delivery is misconfigured. ${name} is missing.`, "configuration", name)
    }
    return value
}

function safeProviderResponse(response: string | undefined) {
    if (!response) return null
    return response
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
        .replace(/[\r\n]+/g, " ")
        .slice(0, 500)
}

function classifyResendApiError(error: ErrorResponse) {
    const providerCode = error.name
    const responseCode = error.statusCode
    const response = safeProviderResponse(error.message)
    const message = error.message.toLowerCase()

    if (providerCode === "missing_api_key") {
        return new EmailDeliveryError("Email delivery is misconfigured. RESEND_API_KEY is missing.", "configuration", providerCode, RESEND_COMMAND, responseCode, response)
    }
    if (["invalid_api_key", "restricted_api_key", "invalid_access", "security_error"].includes(providerCode) || responseCode === 401 || responseCode === 403) {
        return new EmailDeliveryError("Resend rejected Betelgeze's API credentials. Check RESEND_API_KEY in Vercel and redeploy.", "authentication", providerCode, RESEND_COMMAND, responseCode, response)
    }
    if (providerCode === "invalid_from_address" || message.includes("from address") || message.includes("sender") || message.includes("domain is not verified")) {
        return new EmailDeliveryError("Resend rejected Betelgeze's sender address. Confirm betelgeze.com is verified for sending in Resend.", "sender", providerCode, RESEND_COMMAND, responseCode, response)
    }
    if (message.includes("recipient") || message.includes("to address")) {
        return new EmailDeliveryError("Resend rejected the recipient address. Check the email address and try again.", "recipient", providerCode, RESEND_COMMAND, responseCode, response)
    }
    return new EmailDeliveryError(`Resend rejected the email${providerCode ? ` (${providerCode})` : ""}. Check the provider response in Vercel and try again.`, "unknown", providerCode, RESEND_COMMAND, responseCode, response)
}

function classifyResendFailure(error: unknown) {
    if (error instanceof EmailDeliveryError) return error
    const provider = error instanceof Error ? error : null
    const response = safeProviderResponse(provider?.message)
    return new EmailDeliveryError("Betelgeze could not reach Resend. Check the network connection and try again.", "connection", provider?.name ?? null, RESEND_COMMAND, null, response)
}

async function deliverEmail(message: CreateEmailOptions) {
    try {
        const resend = new Resend(getEmailEnv("RESEND_API_KEY"))
        const result = await resend.emails.send(message)
        if (result.error) throw classifyResendApiError(result.error)
        return result.data
    } catch (error) {
        throw classifyResendFailure(error)
    }
}

export function emailDeliveryFailureDetails(error: unknown) {
    const classified = classifyResendFailure(error)
    return {
        message: classified.message,
        kind: classified.kind,
        providerCode: classified.providerCode,
        providerCommand: classified.providerCommand,
        providerResponseCode: classified.providerResponseCode,
        providerResponse: classified.providerResponse,
    }
}

function escapeHtml(value: string) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;")
}

export function assertEmailDeliveryConfigured() {
    getEmailEnv("RESEND_API_KEY")
}

export async function sendWorkspaceInvitation({ to, workspaceName, inviteUrl }: { to: string; workspaceName: string; inviteUrl: string }) {
    await deliverEmail({
        from: process.env.EMAIL_FROM?.trim() || "Betelgeze <noreply@betelgeze.com>",
        to,
        subject: `You’re invited to ${workspaceName} on Betelgeze`,
        text: `You have been invited to ${workspaceName} on Betelgeze. Open your invitation: ${inviteUrl}`,
        html: `<p>You have been invited to <strong>${escapeHtml(workspaceName)}</strong> on Betelgeze.</p><p><a href="${escapeHtml(inviteUrl)}">Open your invitation</a></p><p>This invitation expires in seven days.</p>`,
    })
}
