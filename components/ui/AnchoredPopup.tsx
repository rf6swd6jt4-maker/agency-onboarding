"use client"

import { createPortal } from "react-dom"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { anchoredPopupPosition } from "./anchored-popup-position"

type PopupPosition = {
    left: number
    top: number
    maxHeight: number
    maxWidth: number
}

function popupHost(anchor: HTMLElement) {
    const sourceDocument = anchor.ownerDocument
    const sourceWindow = sourceDocument.defaultView ?? window
    if (sourceWindow.parent === sourceWindow) return { document: sourceDocument, window: sourceWindow, frameRect: null }

    try {
        const parentDocument = sourceWindow.parent.document
        const frameRect = sourceWindow.frameElement?.getBoundingClientRect() ?? null
        return { document: parentDocument, window: sourceWindow.parent, frameRect }
    } catch {
        return { document: sourceDocument, window: sourceWindow, frameRect: null }
    }
}

function anchorRectInHost(anchor: HTMLElement, frameRect: DOMRect | null) {
    const rect = anchor.getBoundingClientRect()
    if (!frameRect) return rect
    return new DOMRect(frameRect.left + rect.left, frameRect.top + rect.top, rect.width, rect.height)
}

export function AnchoredPopup({
    anchor,
    children,
    align = "start",
    placement = "above",
    className = "",
    role,
    onDismiss,
    workItemPopup = false,
}: {
    anchor: HTMLElement | null
    children: ReactNode
    align?: "start" | "end"
    placement?: "above" | "below"
    className?: string
    role?: string
    onDismiss?: () => void
    workItemPopup?: boolean
}) {
    const popupRef = useRef<HTMLDivElement>(null)
    const [position, setPosition] = useState<PopupPosition | null>(null)
    const host = useMemo(() => anchor ? popupHost(anchor) : null, [anchor])

    const updatePosition = useCallback(() => {
        const popup = popupRef.current
        if (!anchor || !popup) return
        const currentHost = popupHost(anchor)
        const triggerRect = anchorRectInHost(anchor, currentHost.frameRect)
        const visualViewport = currentHost.window.visualViewport
        const viewportLeft = visualViewport?.offsetLeft ?? 0
        const viewportTop = visualViewport?.offsetTop ?? 0
        const viewportWidth = visualViewport?.width ?? currentHost.window.innerWidth
        const viewportHeight = visualViewport?.height ?? currentHost.window.innerHeight
        setPosition(anchoredPopupPosition({
            trigger: triggerRect,
            popupWidth: popup.scrollWidth || popup.offsetWidth,
            popupHeight: popup.scrollHeight || popup.offsetHeight,
            viewport: { left: viewportLeft, top: viewportTop, width: viewportWidth, height: viewportHeight },
            align,
            placement,
        }))
    }, [align, anchor, placement])

    useLayoutEffect(() => {
        updatePosition()
        const popup = popupRef.current
        if (!anchor || !popup) return
        const resizeObserver = new ResizeObserver(updatePosition)
        resizeObserver.observe(anchor)
        resizeObserver.observe(popup)
        return () => resizeObserver.disconnect()
    }, [anchor, updatePosition])

    useEffect(() => {
        if (!anchor || !host) return
        const sourceDocument = anchor.ownerDocument
        const documents = sourceDocument === host.document ? [sourceDocument] : [sourceDocument, host.document]
        const sourceWindow = sourceDocument.defaultView
        const visualViewport = host.window.visualViewport
        const dismiss = (event: MouseEvent) => {
            const target = event.target as Node
            if (popupRef.current?.contains(target) || anchor.contains(target)) return
            onDismiss?.()
        }
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") onDismiss?.()
        }

        for (const document of documents) {
            document.addEventListener("mousedown", dismiss)
            document.addEventListener("keydown", escape)
        }
        sourceWindow?.addEventListener("scroll", updatePosition, true)
        sourceWindow?.addEventListener("resize", updatePosition)
        if (host.window !== sourceWindow) {
            host.window.addEventListener("scroll", updatePosition, true)
            host.window.addEventListener("resize", updatePosition)
        }
        visualViewport?.addEventListener("resize", updatePosition)
        visualViewport?.addEventListener("scroll", updatePosition)
        return () => {
            for (const document of documents) {
                document.removeEventListener("mousedown", dismiss)
                document.removeEventListener("keydown", escape)
            }
            sourceWindow?.removeEventListener("scroll", updatePosition, true)
            sourceWindow?.removeEventListener("resize", updatePosition)
            if (host.window !== sourceWindow) {
                host.window.removeEventListener("scroll", updatePosition, true)
                host.window.removeEventListener("resize", updatePosition)
            }
            visualViewport?.removeEventListener("resize", updatePosition)
            visualViewport?.removeEventListener("scroll", updatePosition)
        }
    }, [anchor, host, onDismiss, updatePosition])

    if (!anchor || !host) return null
    return createPortal(<div
        ref={popupRef}
        role={role}
        data-anchored-popup
        data-work-item-popup={workItemPopup ? "" : undefined}
        style={position ? {
            left: position.left,
            top: position.top,
            maxHeight: position.maxHeight,
            maxWidth: position.maxWidth,
        } : { visibility: "hidden" }}
        className={`fixed z-[2147483646] overflow-y-auto overscroll-contain ${className}`}
    >{children}</div>, host.document.body)
}
