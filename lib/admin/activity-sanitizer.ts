const SENSITIVE_ACTIVITY_KEYS = new Set([
    "password", "passwords", "secret", "secrets", "credential", "credentials",
    "access_token", "refresh_token", "session_token", "answer", "answers",
    "response", "form_response", "definition", "file_contents", "raw_payload",
    "authorization", "proxy_authorization", "cookie", "cookies", "set_cookie",
    "token", "tokens", "id_token", "api_token", "bearer_token", "client_secret",
    "api_key", "apikey", "x_api_key", "body", "request_body", "response_body",
    "payload", "request_payload", "response_payload", "phone", "client_phone",
    "primary_phone", "email", "client_email", "primary_email",
])

const SAFE_ACTIVITY_IDENTIFIER_KEYS = new Set([
    "error_code", "provider_message_id", "composition_hash", "definition_hash", "failure_fingerprint",
])

function sanitizeActivityString(value: string) {
    return value.slice(0, 1_000)
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
        .replace(/(?:authorization|password|secret|client[_-]?secret|api[_-]?key|token|answer|response|body|payload)\s*[:=]\s*[^\s,;]+/giu, "[REDACTED CREDENTIAL]")
        .replace(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/giu, "[REDACTED EMAIL]")
        .replace(/\+[0-9][0-9 ()-]{7,}[0-9]/gu, "[REDACTED PHONE]")
        .replace(/[A-Fa-f0-9]{32,}/gu, "[REDACTED TOKEN]")
}

function sanitizeActivityValue(value: unknown, key?: string): unknown {
    if (typeof value === "string") {
        if (key && SAFE_ACTIVITY_IDENTIFIER_KEYS.has(key.toLowerCase())) return value.slice(0, 200)
        return sanitizeActivityString(value)
    }
    if (Array.isArray(value)) return value.map((entry) => sanitizeActivityValue(entry))
    if (!value || typeof value !== "object") return value
    const result: Record<string, unknown> = {}
    for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
        const normalized = entryKey.toLowerCase()
        if (SENSITIVE_ACTIVITY_KEYS.has(normalized) || /(^|_)(password|secret|credential|token|phone|email)$/u.test(normalized)) continue
        result[entryKey] = sanitizeActivityValue(entryValue, entryKey)
    }
    return result
}

export function sanitizeAdminActivityPayload(value: unknown): unknown {
    return sanitizeActivityValue(value)
}
