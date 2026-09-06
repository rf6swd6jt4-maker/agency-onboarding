"use client"

import { useEffect, useRef, type ComponentProps } from "react"
import { WORKSPACE_COMPOSER_FOCUS_EVENT, type WorkspaceComposerFocusEventDetail } from "@/lib/workspace-composer-viewport"

export function NativeChatViewport(props: ComponentProps<"div">) {
    const rootRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const root = rootRef.current
        if (!root) return
        // The shell resizes same-origin chat frames for the keyboard. Measure
        // the whole conversation (header, messages, composer) before that starts.
        const hostWindow = window.parent === window ? window : window.parent
        let frozen = false
        let settleTimer = 0
        const measure = () => {
            const height = root.getBoundingClientRect().height
            if (!frozen && height > 0) {
                root.style.setProperty("--native-video-max-height", `${Math.min(height * 0.85, 480)}px`)
            }
        }
        const onComposerFocus = (event: Event) => {
            const focused = (event as CustomEvent<WorkspaceComposerFocusEventDetail>).detail?.focused
            if (typeof focused !== "boolean") return
            window.clearTimeout(settleTimer)
            if (focused) {
                measure()
                frozen = true
            } else {
                // Keep the captured size through the shell's keyboard-close
                // animation and Safari's late browser-chrome resize events.
                settleTimer = window.setTimeout(() => { frozen = false; measure() }, 700)
            }
        }
        const observer = new ResizeObserver(measure)
        observer.observe(root)
        hostWindow.addEventListener(WORKSPACE_COMPOSER_FOCUS_EVENT, onComposerFocus)
        measure()
        return () => {
            observer.disconnect()
            window.clearTimeout(settleTimer)
            hostWindow.removeEventListener(WORKSPACE_COMPOSER_FOCUS_EVENT, onComposerFocus)
        }
    }, [])

    return <div {...props} ref={rootRef} />
}
