type VerticalBounds = { top: number; bottom: number; height: number }

export function visibleSwipeActionTop(message: VerticalBounds, viewport: Pick<VerticalBounds, "top" | "bottom">, edge = 12) {
    const visibleTop = Math.max(message.top, viewport.top + edge)
    const visibleBottom = Math.min(message.bottom, viewport.bottom - edge)
    if (visibleBottom <= visibleTop) return message.height / 2
    return Math.max(edge, Math.min(message.height - edge, (visibleTop + visibleBottom) / 2 - message.top))
}
