"use client"

import { type RefObject, useEffect } from "react"

const KEYBOARD_SLIDE_DURATION_MS = 220
const MINIMUM_ANIMATED_SHIFT_PX = 24

export function useComposerKeyboardSlide(footerRef: RefObject<HTMLElement | null>) {
    useEffect(() => {
        const currentFooter = footerRef.current
        if (!currentFooter || typeof currentFooter.animate !== "function") return
        const footer: HTMLElement = currentFooter

        const hostWindow = window.parent === window ? window : window.parent
        const mobile = hostWindow.matchMedia("(max-width: 1023px)")
        const reducedMotion = hostWindow.matchMedia("(prefers-reduced-motion: reduce)")
        let previousBottom = footer.getBoundingClientRect().bottom
        let frame = 0
        let animation: Animation | null = null

        function rememberPosition() {
            previousBottom = footer.getBoundingClientRect().bottom
        }

        function scheduleKeyboardSlide() {
            if (frame) return
            const startingBottom = previousBottom
            frame = window.requestAnimationFrame(() => {
                frame = 0
                const nextBottom = footer.getBoundingClientRect().bottom
                previousBottom = nextBottom
                const shift = startingBottom - nextBottom
                if (!mobile.matches || reducedMotion.matches || !footer.contains(document.activeElement) || Math.abs(shift) < MINIMUM_ANIMATED_SHIFT_PX) return

                animation?.cancel()
                footer.style.willChange = "transform"
                animation = footer.animate([
                    { transform: `translate3d(0, ${shift}px, 0)` },
                    { transform: "translate3d(0, 0, 0)" },
                ], {
                    duration: KEYBOARD_SLIDE_DURATION_MS,
                    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
                })
                animation.addEventListener("finish", () => { footer.style.willChange = "" }, { once: true })
            })
        }

        footer.addEventListener("pointerdown", rememberPosition, { passive: true })
        footer.addEventListener("focusin", rememberPosition)
        window.addEventListener("resize", scheduleKeyboardSlide)
        hostWindow.visualViewport?.addEventListener("resize", scheduleKeyboardSlide)

        return () => {
            if (frame) window.cancelAnimationFrame(frame)
            animation?.cancel()
            footer.style.willChange = ""
            footer.removeEventListener("pointerdown", rememberPosition)
            footer.removeEventListener("focusin", rememberPosition)
            window.removeEventListener("resize", scheduleKeyboardSlide)
            hostWindow.visualViewport?.removeEventListener("resize", scheduleKeyboardSlide)
        }
    }, [footerRef])
}
