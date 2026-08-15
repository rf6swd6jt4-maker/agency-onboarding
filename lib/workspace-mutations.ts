"use client"

export const WORKSPACE_MUTATION_INTENT_START = "betelgeze:workspace-mutation-intent-start"
export const WORKSPACE_MUTATION_INTENT_END = "betelgeze:workspace-mutation-intent-end"
export const WORKSPACE_MUTATION_START = "betelgeze:workspace-mutation-start"
export const WORKSPACE_MUTATION_END = "betelgeze:workspace-mutation-end"

export type WorkspaceMutationSuccess<T = undefined> = {
    ok: true
    data?: T
    version?: string
}

export type WorkspaceMutationFailure = {
    ok: false
    error: string
    fieldErrors?: Record<string, string>
    conflict?: boolean
    version?: string
}

export type WorkspaceMutationResult<T = undefined> = WorkspaceMutationSuccess<T> | WorkspaceMutationFailure

export type WorkspaceMutationEventDetail = {
    mutationId: string
    failed: boolean
    error?: string
}

export type WorkspaceMutationOptions = {
    mutationId?: string
    path?: string
    category?: "onboarding" | "services" | "leadgen" | "billing" | "communications" | "gantt" | "integrations" | "maintenance" | "system"
}

type AutosaveFlusher = () => Promise<void>

const autosaveFlushers = new Set<AutosaveFlusher>()

function newMutationId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `mutation-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isMutationFailure(value: unknown): value is WorkspaceMutationFailure {
    return Boolean(value && typeof value === "object" && "ok" in value && (value as { ok?: unknown }).ok === false)
}

function categoryForPath(pathname: string): WorkspaceMutationOptions["category"] {
    const section = pathname.split("/").filter(Boolean)[1] ?? ""
    if (section === "onboarding" || section === "onboarding-builder") return "onboarding"
    if (section === "leadgen") return "leadgen"
    if (section === "communications") return "communications"
    if (section === "work" || section === "work-items") return "gantt"
    if (section === "relationships") return "services"
    if (section === "admin") return "maintenance"
    return "system"
}

export function registerWorkspaceAutosaveFlusher(flusher: AutosaveFlusher) {
    autosaveFlushers.add(flusher)
    return () => autosaveFlushers.delete(flusher)
}

export async function flushWorkspaceAutosaves(timeoutMs = 1500) {
    if (!autosaveFlushers.size) return
    let timeoutId: number | null = null
    await Promise.race([
        Promise.allSettled([...autosaveFlushers].map((flush) => flush())),
        new Promise<void>((resolve) => {
            timeoutId = window.setTimeout(resolve, timeoutMs)
        }),
    ])
    if (timeoutId !== null) window.clearTimeout(timeoutId)
}

export async function reportWorkspaceMutation(input: {
    mutationId: string
    method?: string
    path: string
    category?: WorkspaceMutationOptions["category"]
    failed: boolean
    aborted?: boolean
    background?: boolean
    status?: number
    durationMs: number
    error?: string
}) {
    const workspaceSlug = window.location.pathname.split("/").filter(Boolean)[0] ?? ""
    if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(workspaceSlug)) return
    await window.fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/activity/mutations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            requestId: input.mutationId,
            method: input.method ?? "POST",
            path: input.path,
            category: input.category ?? categoryForPath(window.location.pathname),
            status: input.status ?? (input.failed ? 500 : 200),
            durationMs: input.durationMs,
            background: input.background !== false,
            failed: input.failed,
            aborted: input.aborted === true,
            error: input.error,
        }),
        keepalive: true,
    })
}

export async function runWorkspaceMutation<T>(operation: () => Promise<T>, options: WorkspaceMutationOptions = {}): Promise<T> {
    const id = options.mutationId ?? newMutationId()
    const path = options.path ?? `${window.location.pathname}${window.location.search}`
    const startedAt = performance.now()
    window.dispatchEvent(new Event(WORKSPACE_MUTATION_INTENT_START))
    window.dispatchEvent(new CustomEvent<WorkspaceMutationEventDetail>(WORKSPACE_MUTATION_START, {
        detail: { mutationId: id, failed: false },
    }))
    try {
        const result = await operation()
        const failure = isMutationFailure(result) ? result : null
        const detail: WorkspaceMutationEventDetail = { mutationId: id, failed: Boolean(failure), error: failure?.error }
        window.dispatchEvent(new CustomEvent<WorkspaceMutationEventDetail>(WORKSPACE_MUTATION_END, { detail }))
        void reportWorkspaceMutation({ mutationId: id, path, category: options.category, failed: detail.failed, durationMs: performance.now() - startedAt, error: detail.error }).catch(() => undefined)
        return result
    } catch (error) {
        const message = error instanceof Error ? error.message : "Workspace mutation failed"
        window.dispatchEvent(new CustomEvent<WorkspaceMutationEventDetail>(WORKSPACE_MUTATION_END, { detail: { mutationId: id, failed: true, error: message } }))
        void reportWorkspaceMutation({ mutationId: id, path, category: options.category, failed: true, durationMs: performance.now() - startedAt, error: message }).catch(() => undefined)
        throw error
    } finally {
        window.dispatchEvent(new Event(WORKSPACE_MUTATION_INTENT_END))
    }
}
