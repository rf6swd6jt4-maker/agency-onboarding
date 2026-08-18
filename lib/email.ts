import nodemailer from "nodemailer"

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

function getSmtpEnv(name: string) {
    const value = process.env[name]?.trim()
    if (!value) throw new Error(`Missing ${name}`)
    return value
}

function smtpTransporter() {
    const port = Number(process.env.SMTP_PORT ?? "587")
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new EmailDeliveryError("Email delivery is misconfigured. SMTP_PORT must be a valid port number.", "configuration", "SMTP_PORT")
    }
    const secure = process.env.SMTP_SECURE?.trim().toLowerCase() === "true"
    return nodemailer.createTransport({
        host: getSmtpEnv("SMTP_HOST"),
        port,
        secure,
        requireTLS: port === 587 && !secure,
        authMethod: "LOGIN",
        auth: { user: getSmtpEnv("SMTP_USER"), pass: getSmtpEnv("SMTP_PASSWORD") },
    })
}

type MailProviderError = Error & {
    code?: string
    command?: string
    responseCode?: number
    response?: string
}

function safeProviderResponse(response: string | undefined) {
    if (!response) return null
    return response
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
        .replace(/[\r\n]+/g, " ")
        .slice(0, 500)
}

function classifiedEmailError(error: unknown) {
    if (error instanceof EmailDeliveryError) return error
    const provider = error instanceof Error ? error as MailProviderError : null
    const code = provider?.code?.toUpperCase() ?? null
    const responseCode = provider?.responseCode ?? null
    const command = provider?.command ?? null
    const response = safeProviderResponse(provider?.response)
    const providerCode = code ?? (responseCode ? String(responseCode) : null)
    if (code === "EAUTH" || responseCode === 530 || responseCode === 534 || responseCode === 535) {
        return new EmailDeliveryError("Email delivery authentication failed. Check SMTP credentials and the provider response in Vercel.", "authentication", providerCode, command, responseCode, response)
    }
    if (["ECONNECTION", "ECONNREFUSED", "ETIMEDOUT", "EDNS"].includes(code ?? "")) {
        return new EmailDeliveryError("Betelgeze could not reach the email server. Check SMTP_HOST, SMTP_PORT and SMTP_SECURE in Vercel, then redeploy.", "connection", providerCode, command, responseCode, response)
    }
    if (code === "ESOCKET" || provider?.message.toLowerCase().includes("tls") || provider?.message.toLowerCase().includes("certificate")) {
        return new EmailDeliveryError("The email server rejected the secure connection. Use SMTP_PORT 587 with SMTP_SECURE=false, or port 465 with SMTP_SECURE=true.", "tls", providerCode, command, responseCode, response)
    }
    if (provider?.command === "MAIL FROM" || responseCode === 553) {
        return new EmailDeliveryError("The email server rejected Betelgeze's sender address. Check SMTP_FROM and make sure it uses the authenticated mailbox.", "sender", providerCode, command, responseCode, response)
    }
    if (provider?.command === "RCPT TO" || responseCode === 550 || responseCode === 551) {
        return new EmailDeliveryError("The email server rejected the recipient address. Check the client's billing email and try again.", "recipient", providerCode, command, responseCode, response)
    }
    return new EmailDeliveryError(`Email delivery failed${providerCode ? ` (${providerCode})` : ""}. Check the SMTP connection in Vercel and try again.`, "unknown", providerCode, command, responseCode, response)
}

async function deliverEmail(message: Parameters<ReturnType<typeof smtpTransporter>["sendMail"]>[0]) {
    try {
        return await smtpTransporter().sendMail(message)
    } catch (error) {
        throw classifiedEmailError(error)
    }
}

export function emailDeliveryFailureDetails(error: unknown) {
    const classified = classifiedEmailError(error)
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
    for (const name of ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"]) getSmtpEnv(name)
}

export async function sendWorkspaceInvitation({ to, workspaceName, inviteUrl }: { to: string; workspaceName: string; inviteUrl: string }) {
    await deliverEmail({
        from: process.env.SMTP_FROM ?? "Betelgeze <noreply@betelgeze.com>",
        to,
        subject: `You’re invited to ${workspaceName} on Betelgeze`,
        text: `You have been invited to ${workspaceName} on Betelgeze. Open your invitation: ${inviteUrl}`,
        html: `<p>You have been invited to <strong>${escapeHtml(workspaceName)}</strong> on Betelgeze.</p><p><a href="${escapeHtml(inviteUrl)}">Open your invitation</a></p><p>This invitation expires in seven days.</p>`,
    })
}
