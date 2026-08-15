export const CHAT_DISPLAY_NAME_MAX_LENGTH = 50

export function normalizeChatDisplayName(value: unknown) {
    if (typeof value !== "string") return null
    const normalized = value
        .normalize("NFKC")
        .replace(/[\u0000-\u001f\u007f]/gu, " ")
        .replace(/\s+/gu, " ")
        .trim()
    return normalized && normalized.length <= CHAT_DISPLAY_NAME_MAX_LENGTH
        ? normalized
        : null
}

export function formatWhatsAppAttributedMessage(
    displayName: unknown,
    body: string,
    fallback = "Scaylup"
) {
    const normalizedFallback = normalizeChatDisplayName(fallback) ?? "Scaylup"
    const safeName = (normalizeChatDisplayName(displayName) ?? normalizedFallback)
        .replace(/[*_~`]/gu, "")
        .trim() || normalizedFallback
    const message = body.trim()
    return `*~ ${safeName}*${message ? `\n${message}` : ""}`
}
