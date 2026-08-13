import nodemailer from "nodemailer"

function getSmtpEnv(name: string) {
    const value = process.env[name]?.trim()
    if (!value) throw new Error(`Missing ${name}`)
    return value
}

function smtpTransporter() {
    return nodemailer.createTransport({
        host: getSmtpEnv("SMTP_HOST"),
        port: Number(process.env.SMTP_PORT ?? "587"),
        secure: process.env.SMTP_SECURE === "true",
        auth: { user: getSmtpEnv("SMTP_USER"), pass: getSmtpEnv("SMTP_PASSWORD") },
    })
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
    await smtpTransporter().sendMail({
        from: process.env.SMTP_FROM ?? "Betelgeze <noreply@betelgeze.com>",
        to,
        subject: `You’re invited to ${workspaceName} on Betelgeze`,
        text: `You have been invited to ${workspaceName} on Betelgeze. Open your invitation: ${inviteUrl}`,
        html: `<p>You have been invited to <strong>${escapeHtml(workspaceName)}</strong> on Betelgeze.</p><p><a href="${escapeHtml(inviteUrl)}">Open your invitation</a></p><p>This invitation expires in seven days.</p>`,
    })
}

export async function sendRecurringCheckoutRequest(input: {
    to: string
    clientName: string
    workspaceName: string
    checkoutUrl: string
    services: string[]
    totalLabel: string
    cadenceLabel: string
}) {
    const serviceText = input.services.join(", ")
    await smtpTransporter().sendMail({
        from: process.env.SMTP_FROM ?? "Betelgeze <noreply@betelgeze.com>",
        to: input.to,
        subject: `${input.workspaceName} recurring service checkout`,
        text: [
            `Hello ${input.clientName},`,
            "",
            `${input.workspaceName} has prepared your recurring service checkout for ${serviceText}.`,
            `${input.totalLabel} ${input.cadenceLabel}.`,
            "",
            `Review the details and subscribe securely with Stripe: ${input.checkoutUrl}`,
            "",
            "Your first successful payment starts onboarding. Future payments follow the schedule shown by Stripe.",
        ].join("\n"),
        html: `<p>Hello ${escapeHtml(input.clientName)},</p><p><strong>${escapeHtml(input.workspaceName)}</strong> has prepared your recurring service checkout for ${escapeHtml(serviceText)}.</p><p><strong>${escapeHtml(input.totalLabel)}</strong> ${escapeHtml(input.cadenceLabel)}.</p><p><a href="${escapeHtml(input.checkoutUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#111;color:#fff;text-decoration:none;font-weight:600">Review and subscribe</a></p><p>Your first successful payment starts onboarding. Future payments follow the schedule shown by Stripe.</p>`,
    })
}
