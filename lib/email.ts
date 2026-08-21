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

function emailHeaderText(value: string) {
    return value.replace(/[\r\n]+/g, " ").trim()
}

export function assertEmailDeliveryConfigured() {
    getEmailEnv("RESEND_API_KEY")
}

export async function sendWorkspaceInvitation({ to, workspaceName, inviterName, inviteUrl }: { to: string; workspaceName: string; inviterName: string; inviteUrl: string }) {
    const safeWorkspaceName = escapeHtml(workspaceName)
    const safeInviterName = escapeHtml(inviterName)
    await deliverEmail({
        from: process.env.EMAIL_FROM?.trim() || "Betelgeze <noreply@betelgeze.com>",
        replyTo: process.env.EMAIL_REPLY_TO?.trim() || "hello@betelgeze.com",
        to,
        subject: `Invitation to join ${emailHeaderText(workspaceName)} on Betelgeze`,
        text: `${inviterName} has invited you to join the ${workspaceName} workspace on Betelgeze.\n\nReview your invitation: ${inviteUrl}\n\nThis invitation expires in seven days. The link opens betelgeze.com.\n\nIf you were not expecting this invitation, you can safely ignore this email. No account will be created unless you accept it.\n\nBetelgeze\nhttps://betelgeze.com`,
        html: `<!doctype html><html><body style="margin:0;background:#f5f5f4;color:#171717;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:40px 20px"><div style="background:#ffffff;border:1px solid #e5e5e5;border-radius:16px;padding:36px"><p style="margin:0 0 24px;color:#059669;font-size:13px;font-weight:700;letter-spacing:0.18em">BETELGEZE</p><h1 style="margin:0 0 18px;font-size:28px;line-height:1.2">Join ${safeWorkspaceName}</h1><p style="margin:0 0 24px;color:#404040;font-size:16px;line-height:1.6"><strong>${safeInviterName}</strong> has invited you to join the ${safeWorkspaceName} workspace on Betelgeze.</p><p style="margin:0 0 24px"><a href="${escapeHtml(inviteUrl)}" style="display:inline-block;background:#171717;color:#ffffff;text-decoration:none;border-radius:10px;padding:14px 20px;font-size:16px;font-weight:700">Review invitation</a></p><p style="margin:0;color:#737373;font-size:14px;line-height:1.6">This invitation expires in seven days. The button opens betelgeze.com.</p><hr style="border:0;border-top:1px solid #e5e5e5;margin:28px 0"><p style="margin:0;color:#737373;font-size:13px;line-height:1.6">If you were not expecting this invitation, you can safely ignore this email. No account will be created unless you accept it.</p></div><p style="margin:18px 0 0;text-align:center;color:#737373;font-size:12px">Betelgeze · <a href="https://betelgeze.com" style="color:#525252">betelgeze.com</a></p></div></body></html>`,
    })
}
