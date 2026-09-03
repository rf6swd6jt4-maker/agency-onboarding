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

export function closeWorkspaceComposer(composer: HTMLTextAreaElement | null) {
    composer?.blur()
    // A focused element can be removed before React delivers its blur handler.
    // Always release the shell viewport so a hidden keyboard cannot leave the
    // conversation list constrained to the keyboard-open height.
    reportWorkspaceComposerFocus(false)
}
