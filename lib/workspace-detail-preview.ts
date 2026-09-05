export type WorkspaceDetailPreview = {
    category: string
    reference: string
    title: string
    subtitle?: string | null
    updated?: string | null
}

type StoredWorkspaceDetailPreview = {
    savedAt: number
    preview: WorkspaceDetailPreview
}

const DETAIL_PREVIEW_PREFIX = "betelgeze:detail-preview:"
const DETAIL_PREVIEW_MAX_AGE_MS = 10 * 60 * 1000

function cleanPreviewText(value: unknown, maximumLength: number) {
    if (typeof value !== "string") return null
    const cleaned = value.trim().slice(0, maximumLength)
    return cleaned || null
}

export function parseWorkspaceDetailPreview(value: unknown): WorkspaceDetailPreview | null {
    try {
        const candidate = typeof value === "string" ? JSON.parse(value) as Record<string, unknown> : value as Record<string, unknown>
        if (!candidate || typeof candidate !== "object") return null
        const category = cleanPreviewText(candidate.category, 48)
        const reference = cleanPreviewText(candidate.reference, 32)
        const title = cleanPreviewText(candidate.title, 160)
        if (!category || !reference || !title) return null
        return {
            category,
            reference,
            title,
            subtitle: cleanPreviewText(candidate.subtitle, 200),
            updated: cleanPreviewText(candidate.updated, 48),
        }
    } catch {
        return null
    }
}

export function serializeWorkspaceDetailPreview(preview: WorkspaceDetailPreview) {
    return JSON.stringify(preview)
}

export function workspaceDetailPreviewStorageKey(value: string, origin = "http://localhost") {
    const url = new URL(value, origin)
    return `${DETAIL_PREVIEW_PREFIX}${url.pathname}`
}

export function storeWorkspaceDetailPreview(value: string, preview: WorkspaceDetailPreview) {
    if (typeof window === "undefined") return
    try {
        const stored: StoredWorkspaceDetailPreview = { savedAt: Date.now(), preview }
        window.sessionStorage.setItem(workspaceDetailPreviewStorageKey(value, window.location.origin), JSON.stringify(stored))
    } catch {
        // Storage is an optional paint accelerator. Navigation must still work
        // when privacy settings or storage limits make it unavailable.
    }
}

export function readWorkspaceDetailPreview(value: string): WorkspaceDetailPreview | null {
    if (typeof window === "undefined") return null
    try {
        const raw = window.sessionStorage.getItem(workspaceDetailPreviewStorageKey(value, window.location.origin))
        if (!raw) return null
        const stored = JSON.parse(raw) as Partial<StoredWorkspaceDetailPreview>
        if (typeof stored.savedAt !== "number" || Date.now() - stored.savedAt > DETAIL_PREVIEW_MAX_AGE_MS) {
            window.sessionStorage.removeItem(workspaceDetailPreviewStorageKey(value, window.location.origin))
            return null
        }
        return parseWorkspaceDetailPreview(stored.preview)
    } catch {
        return null
    }
}
