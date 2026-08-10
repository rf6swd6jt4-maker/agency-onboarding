export function sanitizeOnboardingOutboxError(error: unknown) {
    const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown onboarding outbox failure"
    return raw
        .replace(/\b(authorization|access[_ -]?token|secret|password)\s*[:=]\s*[^\s,;]+/giu, "$1=[redacted]")
        .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer [redacted]")
        .replace(/https?:\/\/[^\s]+/giu, "[url]")
        .replace(/\b[0-9a-f]{32,}\b/giu, "[token]")
        .replace(/\+?\d[\d ()-]{7,}\d/gu, "[number]")
        .replace(/\s+/gu, " ")
        .trim()
        .slice(0, 600) || "Unknown onboarding outbox failure"
}

export type OnboardingStorageCleanupContext = {
    workspaceId: string
    sessionId: string
    relationshipId: string
    legacyClientId: string | null
}

function safeStorageSegments(storagePath: string) {
    const trimmed = storagePath.trim()
    if (!trimmed || trimmed !== storagePath || trimmed.includes("\\")) {
        throw new Error("Onboarding storage cleanup path is malformed")
    }

    const segments = trimmed.split("/")
    if (segments.some((segment) => !segment)) {
        throw new Error("Onboarding storage cleanup path is malformed")
    }

    for (const segment of segments) {
        let decoded: string
        try {
            decoded = decodeURIComponent(segment)
        } catch {
            throw new Error("Onboarding storage cleanup path is malformed")
        }
        if (
            decoded === "." ||
            decoded === ".." ||
            decoded.includes("/") ||
            decoded.includes("\\")
        ) {
            throw new Error("Onboarding storage cleanup path contains traversal")
        }
    }

    return segments
}

/**
 * Validates the exact R2 key before a cleanup worker deletes it. New uploads
 * include both relationship and session identity. Legacy uploads used the
 * relationship's client ID, so callers must resolve that ownership first.
 */
export function assertSafeOnboardingStorageCleanupPath(
    storagePath: string,
    context: OnboardingStorageCleanupContext
) {
    const segments = safeStorageSegments(storagePath)
    if (segments[0] !== context.workspaceId) {
        throw new Error("Onboarding storage cleanup path is outside its workspace")
    }

    if (segments[1] === "onboarding") {
        if (
            segments.length < 6 ||
            segments[2] !== context.relationshipId ||
            segments[3] !== context.sessionId
        ) {
            throw new Error("Onboarding storage cleanup path does not belong to its session")
        }
        return "canonical" as const
    }

    if (
        segments.length < 4 ||
        !context.legacyClientId ||
        segments[1] !== context.legacyClientId
    ) {
        throw new Error("Legacy onboarding storage cleanup path ownership could not be verified")
    }
    return "legacy" as const
}
