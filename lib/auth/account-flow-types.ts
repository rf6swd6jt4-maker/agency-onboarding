import type { StatusTone } from "@/components/ui"

export const AUTH_STEPS = [
    "review",
    "email",
    "username",
    "password",
    "verify-email",
    "about",
    "profile",
    "2fa",
    "complete",
] as const

export type AuthStep = (typeof AUTH_STEPS)[number]

export type AuthStepState = {
    step: AuthStep
    completed: boolean
    available: boolean
}
export type FieldValidationState = {
    tone: StatusTone
    message: string
    state: "idle" | "checking" | "valid" | "invalid"
}

export type AccountEmailPurpose =
    | "workspace_invitation"
    | "signup_otp"
    | "password_recovery_otp"
    | "email_change_current"
    | "email_change_new"
    | "password_changed"
    | "reauthentication"
    | "security_notice"

export type EmailDeliveryStatus =
    | "queued"
    | "sent"
    | "delivered"
    | "delayed"
    | "failed"
    | "bounced"
    | "suppressed"

export type OnboardingAnalyticsResponse = {
    questionVersion: 1
    intendedUses: string[]
    roleAnswer: string | null
}

export type OnboardingContext = {
    sessionId: string
    invitationId: string
    email: string
    workspaceId: string
    workspaceName: string
    workspaceSlug: string
    role: "admin" | "staff"
    currentStep: AuthStep
    usernameCandidate: string | null
    existingAccount: boolean
    expiresAt: string
}
