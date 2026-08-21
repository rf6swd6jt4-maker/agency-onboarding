export const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/

export function normalizeUsername(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 30)
        .replace(/-+$/g, "")
}

export function usernameValidationMessage(value: string) {
    if (!value) return "Choose a username for your Betelgeze profile."
    if (value.length < 3) return "Use at least 3 characters."
    if (value.length > 30) return "Use no more than 30 characters."
    if (!USERNAME_PATTERN.test(value)) return "Use lowercase letters, numbers, and single hyphens between characters."
    return null
}

export function usernameFromEmail(email: string) {
    const localPart = email.split("@", 1)[0] ?? ""
    const normalized = normalizeUsername(localPart)
    if (normalized.length >= 3 && USERNAME_PATTERN.test(normalized)) return normalized
    const padded = normalizeUsername(`user-${normalized || "account"}`)
    return padded.slice(0, 30)
}

export function usernameAlternatives(username: string) {
    const base = normalizeUsername(username).slice(0, 25).replace(/-+$/g, "") || "account"
    return [`${base}-team`, `${base}-work`, `${base}-2`]
}
