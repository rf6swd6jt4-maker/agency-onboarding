export const MESSAGE_LONG_PRESS_MS = 450
export const MESSAGE_LONG_PRESS_SLOP_PX = 10

/** One timer per active gesture; movement permanently cancels that hold. */
export function createMessageLongPress() {
    let timer: ReturnType<typeof setTimeout> | null = null
    let origin: { x: number; y: number } | null = null
    let triggered = false

    function cancel() {
        if (timer !== null) clearTimeout(timer)
        timer = null
        origin = null
        triggered = false
    }

    return {
        get triggered() { return triggered },
        start(x: number, y: number, onPress: () => void) {
            cancel()
            origin = { x, y }
            timer = setTimeout(() => {
                timer = null
                triggered = true
                onPress()
            }, MESSAGE_LONG_PRESS_MS)
        },
        move(x: number, y: number) {
            if (!triggered && origin && Math.hypot(x - origin.x, y - origin.y) > MESSAGE_LONG_PRESS_SLOP_PX) cancel()
        },
        cancel,
    }
}
