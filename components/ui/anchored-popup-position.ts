export type PopupRect = {
    bottom?: number
    left: number
    right: number
    top: number
}

export type PopupViewport = {
    left: number
    top: number
    width: number
    height: number
}

export function anchoredPopupPosition({
    trigger,
    popupWidth,
    popupHeight,
    viewport,
    align,
    placement = "above",
    edge = 8,
    gap = 6,
}: {
    trigger: PopupRect
    popupWidth: number
    popupHeight: number
    viewport: PopupViewport
    align: "start" | "end"
    placement?: "above" | "below"
    edge?: number
    gap?: number
}) {
    const maxWidth = Math.max(0, viewport.width - edge * 2)
    const width = Math.min(popupWidth, maxWidth)
    const availableAbove = Math.max(0, trigger.top - gap - viewport.top - edge)
    const triggerBottom = trigger.bottom ?? trigger.top
    const availableBelow = Math.max(0, viewport.top + viewport.height - triggerBottom - gap - edge)
    const availableHeight = placement === "below" ? availableBelow : availableAbove
    const height = Math.min(popupHeight, availableHeight)
    const desiredLeft = align === "end" ? trigger.right - width : trigger.left
    const left = Math.max(viewport.left + edge, Math.min(desiredLeft, viewport.left + viewport.width - width - edge))
    const top = placement === "below"
        ? triggerBottom + gap
        : Math.max(viewport.top + edge, trigger.top - gap - height)

    return { left, top, maxHeight: availableHeight, maxWidth }
}
