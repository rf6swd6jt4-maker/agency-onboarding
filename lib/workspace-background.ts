"use client"

export const WORKSPACE_BACKGROUND_INTENT_START = "betelgeze:workspace-background-intent-start"
export const WORKSPACE_BACKGROUND_INTENT_END = "betelgeze:workspace-background-intent-end"

export async function runWorkspaceBackgroundMutation<T>(operation: () => Promise<T>) {
    window.dispatchEvent(new Event(WORKSPACE_BACKGROUND_INTENT_START))
    try {
        return await operation()
    } finally {
        window.dispatchEvent(new Event(WORKSPACE_BACKGROUND_INTENT_END))
    }
}
