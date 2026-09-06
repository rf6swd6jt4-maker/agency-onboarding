export type MessageSwipeAction = "reply" | "delete"
export type MessageSwipe = {
    id: string
    touchId: number
    x: number
    y: number
    axis: "undecided" | "horizontal" | "vertical"
    action: MessageSwipeAction | null
    offset: number
}

export function beginMessageSwipe(id: string, touch: { identifier: number; clientX: number; clientY: number }): MessageSwipe {
    return { id, touchId: touch.identifier, x: touch.clientX, y: touch.clientY, axis: "undecided", action: null, offset: 0 }
}

/** Once a deliberate horizontal action is armed, release jitter cannot cancel it. */
export function moveMessageSwipe(swipe: MessageSwipe, touch: { identifier: number; clientX: number; clientY: number }, canReply: boolean, canDelete: boolean): MessageSwipe {
    if (touch.identifier !== swipe.touchId || swipe.axis === "vertical") return swipe
    const dx = touch.clientX - swipe.x, dy = Math.abs(touch.clientY - swipe.y)
    let axis = swipe.axis
    if (axis === "undecided") {
        if (dy > 12 && dy > Math.abs(dx) * 1.5) return { ...swipe, axis: "vertical", offset: 0 }
        if (Math.abs(dx) > 12 && Math.abs(dx) > dy * 1.5) axis = "horizontal"
    }
    let action = swipe.action
    if (axis === "horizontal" && !action && dy < 42) {
        if (canReply && dx > 52) action = "reply"
        else if (canDelete && dx < -52) action = "delete"
    }
    const offset = axis === "horizontal" ? Math.max(canDelete ? -82 : 0, Math.min(canReply ? 82 : 0, dx * 0.78)) : 0
    return { ...swipe, axis, action, offset }
}

export function finishMessageSwipe(swipe: MessageSwipe | null, touch: { identifier: number; clientX: number; clientY: number } | undefined, canReply: boolean, canDelete: boolean): MessageSwipeAction | null {
    if (!swipe || !touch || swipe.touchId !== touch.identifier) return null
    const final = moveMessageSwipe(swipe, touch, canReply, canDelete)
    if (final.axis !== "horizontal") return null
    // Permissions may change while a finger is down.
    return final.action === "reply" ? canReply ? "reply" : null : final.action === "delete" && canDelete ? "delete" : null
}
