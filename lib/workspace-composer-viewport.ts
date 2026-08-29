export const WORKSPACE_COMPOSER_FOCUS_EVENT = "betelgeze:workspace-composer-focus"

export type WorkspaceComposerFocusEventDetail = {
    focused: boolean
}

export function reportWorkspaceComposerFocus(focused: boolean) {
    if (typeof window === "undefined") return
    const hostWindow = window.parent === window ? window : window.parent
    hostWindow.dispatchEvent(new CustomEvent<WorkspaceComposerFocusEventDetail>(WORKSPACE_COMPOSER_FOCUS_EVENT, {
        detail: { focused },
    }))
}
