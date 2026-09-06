/** Stop composer drags from panning the keyboard's visual viewport on iOS. */
export function containComposerTouch(surface: HTMLElement) {
    let previousY: number | null = null
    let scrollable: HTMLElement | null = null
    const reset = () => { previousY = null; scrollable = null }
    const start = (event: TouchEvent) => {
        reset()
        if (event.touches.length !== 1) return
        previousY = event.touches[0].clientY
        const target = event.target as HTMLElement | null
        scrollable = target?.closest?.<HTMLElement>("textarea, [data-composer-scroll]") ?? null
    }
    const move = (event: TouchEvent) => {
        if (event.touches.length !== 1 || previousY === null) return
        const y = event.touches[0].clientY
        const delta = previousY - y
        previousY = y
        // Native scrolling is safe while a draft or sticker tray can consume the gesture.
        // At either edge (or for an empty draft), Safari otherwise pans the page.
        if (scrollable && scrollable.scrollHeight > scrollable.clientHeight && (
            (delta > 0 && scrollable.scrollTop < scrollable.scrollHeight - scrollable.clientHeight - 1) ||
            (delta < 0 && scrollable.scrollTop > 1)
        )) return
        if (event.cancelable) event.preventDefault()
    }
    surface.addEventListener("touchstart", start, { passive: true })
    surface.addEventListener("touchmove", move, { passive: false })
    surface.addEventListener("touchend", reset)
    surface.addEventListener("touchcancel", reset)
    return () => {
        surface.removeEventListener("touchstart", start)
        surface.removeEventListener("touchmove", move)
        surface.removeEventListener("touchend", reset)
        surface.removeEventListener("touchcancel", reset)
    }
}
