export type AccountErrorCode =
    | "auth_required"
    | "invalid_credentials"
    | "email_unconfirmed"
    | "invitation_unavailable"
    | "invitation_email_mismatch"
    | "onboarding_expired"
    | "username_unavailable"
    | "invalid_otp"
    | "expired_otp"
    | "rate_limited"
    | "verification_email_rate_limited"
    | "aal2_required"
    | "configuration_error"
    | "email_delivery_failed"
    | "unknown"

export function accountErrorMessage(code: AccountErrorCode) {
    switch (code) {
        case "auth_required": return "Your session has expired. Sign in and try again."
        case "invalid_credentials": return "That email, username, or password did not match."
        case "email_unconfirmed": return "Confirm your email before signing in."
        case "invitation_unavailable": return "This invitation is invalid, expired, accepted, or has been replaced."
        case "invitation_email_mismatch": return "Sign in with the email address that received this invitation."
        case "onboarding_expired": return "This setup session has expired. Open the newest invitation email to start again."
        case "username_unavailable": return "That username was just taken. Choose one of the available alternatives."
        case "invalid_otp": return "That six-digit code did not match. Check the newest email and try again."
        case "expired_otp": return "That code has expired. Request a fresh code and try again."
        case "rate_limited": return "Please wait a moment before requesting another email."
        case "verification_email_rate_limited": return "No verification email was sent. Email requests are temporarily limited; wait a minute, then press Create account and send code again."
        case "aal2_required": return "Confirm your authenticator before continuing."
        case "configuration_error": return "Betelgeze could not complete this security step. The problem has been recorded."
        case "email_delivery_failed": return "Betelgeze could not send your verification email, so no account was created. Please try again in a moment."
        default: return "Something interrupted this step. Your progress is safe; please try again."
    }
}

export function classifyAccountError(error: unknown): AccountErrorCode {
    const providerMessage = typeof error === "object" && error && "message" in error && typeof error.message === "string"
        ? error.message
        : null
    const message = (error instanceof Error ? error.message : providerMessage ?? String(error ?? "")).toLowerCase()
    if (message.includes("email_not_confirmed") || message.includes("email not confirmed")) return "email_unconfirmed"
    if (message.includes("auth_required")) return "auth_required"
    if (message.includes("aal2_required")) return "aal2_required"
    if (message.includes("invitation_email_mismatch")) return "invitation_email_mismatch"
    if (message.includes("invitation") || message.includes("workspace_unavailable")) return "invitation_unavailable"
    if (message.includes("onboarding_session")) return "onboarding_expired"
    if (message.includes("expired")) return "expired_otp"
    if (message.includes("over_email_send_rate_limit") || message.includes("email rate limit")) return "verification_email_rate_limited"
    if (message.includes("rate") || message.includes("too many")) return "rate_limited"
    if (message.includes("returned from hook") || message.includes("email delivery")) return "email_delivery_failed"
    return "unknown"
}
