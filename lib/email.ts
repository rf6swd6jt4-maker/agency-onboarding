import "server-only"

import { Resend, type ErrorResponse } from "resend"
import { hashAccountToken } from "@/lib/auth/account-tokens"
import type { AccountEmailPurpose } from "@/lib/auth/account-flow-types"
import { renderAccountEmail } from "@/lib/email/render-account-email"
import type { AccountEmailTemplateProps } from "@/lib/email/AccountEmail"
import { supabaseAdmin } from "@/lib/supabase/admin"

export type EmailDeliveryFailureKind = "authentication" | "connection" | "tls" | "sender" | "recipient" | "configuration" | "unknown"

export class EmailDeliveryError extends Error {
    constructor(message: string, readonly kind: EmailDeliveryFailureKind, readonly providerCode: string | null = null, readonly providerCommand: string | null = null, readonly providerResponseCode: number | null = null, readonly providerResponse: string | null = null) {
        super(message); this.name = "EmailDeliveryError"
    }
}

const RESEND_COMMAND = "POST /emails"
const EMAIL_TONES: Record<AccountEmailPurpose, NonNullable<AccountEmailTemplateProps["tone"]>> = {
    workspace_invitation: "yellow",
    signup_otp: "green",
    password_recovery_otp: "yellow",
    email_change_current: "yellow",
    email_change_new: "green",
    password_changed: "green",
    reauthentication: "yellow",
    security_notice: "red",
}

function getEmailEnv(name: string) {
    const value = process.env[name]?.trim()
    if (!value) throw new EmailDeliveryError(`Email delivery is misconfigured. ${name} is missing.`, "configuration", name)
    return value
}

function safeProviderResponse(response: string | undefined) {
    if (!response) return null
    return response.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]").replace(/[\r\n]+/g, " ").slice(0, 500)
}

function classifyResendApiError(error: ErrorResponse) {
    const providerCode = error.name
    const responseCode = error.statusCode
    const response = safeProviderResponse(error.message)
    const message = error.message.toLowerCase()
    if (providerCode === "missing_api_key") return new EmailDeliveryError("Email delivery is misconfigured. RESEND_API_KEY is missing.", "configuration", providerCode, RESEND_COMMAND, responseCode, response)
    if (["invalid_api_key", "restricted_api_key", "invalid_access", "security_error"].includes(providerCode) || responseCode === 401 || responseCode === 403) return new EmailDeliveryError("Resend rejected Betelgeze's API credentials.", "authentication", providerCode, RESEND_COMMAND, responseCode, response)
    if (providerCode === "invalid_from_address" || message.includes("from address") || message.includes("sender") || message.includes("domain is not verified")) return new EmailDeliveryError("Resend rejected Betelgeze's sender address.", "sender", providerCode, RESEND_COMMAND, responseCode, response)
    if (message.includes("recipient") || message.includes("to address")) return new EmailDeliveryError("Resend rejected the recipient address.", "recipient", providerCode, RESEND_COMMAND, responseCode, response)
    return new EmailDeliveryError("Resend rejected the account email.", "unknown", providerCode, RESEND_COMMAND, responseCode, response)
}

function classifyResendFailure(error: unknown) {
    if (error instanceof EmailDeliveryError) return error
    const provider = error instanceof Error ? error : null
    return new EmailDeliveryError("Betelgeze could not reach Resend.", "connection", provider?.name ?? null, RESEND_COMMAND, null, safeProviderResponse(provider?.message))
}

export function emailDeliveryFailureDetails(error: unknown) {
    const classified = classifyResendFailure(error)
    return { message: classified.message, kind: classified.kind, providerCode: classified.providerCode, providerCommand: classified.providerCommand, providerResponseCode: classified.providerResponseCode, providerResponse: classified.providerResponse }
}

export function assertEmailDeliveryConfigured() { getEmailEnv("RESEND_API_KEY") }

export async function sendAccountEmail({
    to,
    subject,
    purpose,
    template,
    userId = null,
    invitationId = null,
}: {
    to: string
    subject: string
    purpose: AccountEmailPurpose
    template: AccountEmailTemplateProps
    userId?: string | null
    invitationId?: string | null
}) {
    const recipientHash = hashAccountToken(to.trim().toLowerCase())
    const { data: delivery, error: auditError } = await supabaseAdmin.from("account_email_deliveries").insert({ purpose, status: "queued", user_id: userId, invitation_id: invitationId, recipient_hash: recipientHash }).select("id").single()
    if (auditError || !delivery) {
        throw new EmailDeliveryError("Betelgeze could not create the required email delivery record, so no email was sent.", "configuration", auditError?.code ?? "delivery_audit_unavailable")
    }
    try {
        const rendered = await renderAccountEmail({ tone: EMAIL_TONES[purpose], ...template })
        const resend = new Resend(getEmailEnv("RESEND_API_KEY"))
        const result = await resend.emails.send({
            from: process.env.EMAIL_FROM?.trim() || "Betelgeze <noreply@betelgeze.com>",
            replyTo: process.env.EMAIL_REPLY_TO?.trim() || "hello@betelgeze.com",
            to,
            subject: subject.replace(/[\r\n]+/g, " ").trim(),
            html: rendered.html,
            text: rendered.text,
            tags: [{ name: "purpose", value: purpose }, { name: "delivery_id", value: delivery.id }],
        })
        if (result.error) throw classifyResendApiError(result.error)
        const now = new Date().toISOString()
        const { error: sentAuditError } = await supabaseAdmin.from("account_email_deliveries").update({ provider_message_id: result.data?.id ?? null, status: "sent", sent_at: now, updated_at: now }).eq("id", delivery.id)
        if (sentAuditError) console.error("Account email was sent but its delivery record could not be advanced", { deliveryId: delivery.id, providerMessageId: result.data?.id ?? null, code: sentAuditError.code })
        return { providerMessageId: result.data?.id ?? null, deliveryId: delivery.id }
    } catch (error) {
        const classified = classifyResendFailure(error)
        await supabaseAdmin.from("account_email_deliveries").update({ status: "failed", failed_at: new Date().toISOString(), failure_code: classified.providerCode ?? classified.kind, diagnostics: { kind: classified.kind, response_code: classified.providerResponseCode }, updated_at: new Date().toISOString() }).eq("id", delivery.id)
        throw classified
    }
}

export async function sendWorkspaceInvitation({ to, workspaceName, inviterName, inviteUrl, invitationId }: { to: string; workspaceName: string; inviterName: string; inviteUrl: string; invitationId: string }) {
    return sendAccountEmail({
        to,
        invitationId,
        purpose: "workspace_invitation",
        subject: `Invitation to join ${workspaceName} on Betelgeze`,
        template: {
            preview: `${inviterName} invited you to join ${workspaceName}.`,
            heading: `Join ${workspaceName}`,
            body: `${inviterName} invited you to join the ${workspaceName} workspace. Betelgeze will guide you through signing in or creating and securing your account.`,
            actionLabel: "Review invitation",
            actionUrl: inviteUrl,
            expires: "This invitation expires in seven days. If a newer invitation is sent, this link stops working.",
            detail: "If you were not expecting this invitation, you can safely ignore it. No account or workspace access is created until the secured flow is completed.",
        },
    })
}

export async function sendSecurityNotice({ to, userId, heading, body }: { to: string; userId: string; heading: string; body: string }) {
    return sendAccountEmail({ to, userId, purpose: "security_notice", subject: heading, template: { preview: heading, heading, body, detail: "If you did not make or approve this change, contact hello@betelgeze.com immediately." } })
}

export async function sendPasswordChangedNotice({ to, userId }: { to: string; userId: string }) {
    return sendAccountEmail({
        to,
        userId,
        purpose: "password_changed",
        subject: "Your Betelgeze password was changed",
        template: {
            preview: "The password for your Betelgeze account was changed.",
            heading: "Password changed",
            body: "The password for your Betelgeze account was changed through the recovery flow. Existing authenticator requirements remain in place.",
            detail: "If you did not make this change, contact hello@betelgeze.com immediately.",
        },
    })
}
