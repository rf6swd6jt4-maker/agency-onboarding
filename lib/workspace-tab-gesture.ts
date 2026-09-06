export const WORKSPACE_TAB_HOLD_MS = 650
const TOUCH_SLOP_PX = 10

/** Let native touch scrolling win until a stationary long press lifts the tab. */
export function beginWorkspaceTabGesture(
    target: HTMLElement,
    pointer: Pick<PointerEvent, "pointerId" | "pointerType" | "clientX" | "clientY">,
    callbacks: {
        onLift: (clientX: number) => void
        onMove: (clientX: number) => void
        onFinish: (result: "tap" | "scroll" | "drop" | "cancel") => void
    },
) {
    const host = target.ownerDocument.defaultView!
    const touch = pointer.pointerType === "touch"
    // Capture on the stable strip: individual tab nodes move during reordering.
    const captureTarget = target.closest<HTMLElement>('[role="tablist"]') ?? target
    let lifted = false
    let finished = false
    let holdTimer = 0
    let lastX = pointer.clientX

    const lift = () => {
        if (finished) return
        lifted = true
        captureTarget.setPointerCapture(pointer.pointerId)
        callbacks.onLift(lastX)
    }
    const finish = (result: "tap" | "scroll" | "drop" | "cancel") => {
        if (finished) return
        finished = true
        host.clearTimeout(holdTimer)
        host.removeEventListener("pointermove", move)
        host.removeEventListener("pointerup", up)
        host.removeEventListener("pointercancel", cancel)
        host.removeEventListener("blur", abort)
        target.removeEventListener("touchmove", containTouch)
        target.removeEventListener("touchstart", additionalTouch)
        target.removeEventListener("contextmenu", contextMenu)
        captureTarget.removeEventListener("lostpointercapture", abort)
        if (captureTarget.hasPointerCapture(pointer.pointerId)) captureTarget.releasePointerCapture(pointer.pointerId)
        callbacks.onFinish(result)
    }
    const move = (event: PointerEvent) => {
        if (event.pointerId !== pointer.pointerId) return
        lastX = event.clientX
        const dx = event.clientX - pointer.clientX
        const dy = event.clientY - pointer.clientY
        if (!lifted) {
            if (touch) {
                if (Math.hypot(dx, dy) > TOUCH_SLOP_PX) finish("scroll")
                return
            }
            if (Math.abs(dx) < 6 || Math.abs(dx) <= Math.abs(dy)) return
            lift()
        }
        if (event.cancelable) event.preventDefault()
        callbacks.onMove(event.clientX)
    }
    const up = (event: PointerEvent) => {
        if (event.pointerId === pointer.pointerId) finish(lifted ? "drop" : "tap")
    }
    const cancel = (event: PointerEvent) => {
        if (event.pointerId === pointer.pointerId) finish("cancel")
    }
    const abort = () => finish("cancel")
    const additionalTouch = (event: TouchEvent) => {
        if (event.touches.length > 1) abort()
    }
    const containTouch = (event: TouchEvent) => {
        // touch-action cannot be changed after a gesture begins. Cancel native
        // movement only after the hold has won; ordinary swipes stay passive.
        if (event.touches.length > 1) { abort(); return }
        if (lifted && event.touches.length === 1 && event.cancelable) event.preventDefault()
    }
    const contextMenu = (event: Event) => { if (touch) event.preventDefault() }
    host.addEventListener("pointermove", move, { passive: false })
    host.addEventListener("pointerup", up)
    host.addEventListener("pointercancel", cancel)
    host.addEventListener("blur", abort)
    target.addEventListener("touchmove", containTouch, { passive: false })
    target.addEventListener("touchstart", additionalTouch, { passive: true })
    target.addEventListener("contextmenu", contextMenu)
    captureTarget.addEventListener("lostpointercapture", abort)
    if (touch) holdTimer = host.setTimeout(lift, WORKSPACE_TAB_HOLD_MS)
    return abort
}
