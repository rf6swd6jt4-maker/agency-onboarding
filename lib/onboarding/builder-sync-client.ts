import type { ConfigurationActionResult } from "@/lib/onboarding/configuration-types"

type Fetch = typeof fetch
type CollaborativeUpdateResult = { sequence: number; version: number }
type CollaborativeUpdate = { sequence: number; updateId: string; updateBase64: string }

function updatesUrl(workspaceSlug: string, afterSequence?: number) {
    const path = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/onboarding-builder/updates`
    return afterSequence === undefined ? path : `${path}?after=${Math.max(0, Math.floor(afterSequence))}`
}

async function resultJson<T>(response: Response): Promise<ConfigurationActionResult<T>> {
    const payload = await response.json().catch(() => null) as ConfigurationActionResult<T> | null
    if (response.ok && payload?.ok) return payload
    return { ok: false, error: payload && !payload.ok ? payload.error : "The Builder could not reach the server." }
}

export async function persistBuilderUpdate(fetcher: Fetch, workspaceSlug: string, input: {
    updateId: string
    updateBase64: string
    definitionIds: string[]
}) {
    const response = await fetcher(updatesUrl(workspaceSlug), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        cache: "no-store",
    })
    return resultJson<CollaborativeUpdateResult>(response)
}

export async function refreshBuilderUpdates(fetcher: Fetch, workspaceSlug: string, afterSequence: number) {
    const response = await fetcher(updatesUrl(workspaceSlug, afterSequence), { cache: "no-store" })
    return resultJson<{ version: number; snapshotBase64: string | null; snapshotSequence: number; updates: CollaborativeUpdate[] }>(response)
}
