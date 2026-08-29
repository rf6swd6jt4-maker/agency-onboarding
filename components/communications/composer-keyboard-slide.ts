"use client"

import { type RefObject, useEffect } from "react"

const KEYBOARD_SLIDE_DURATION_MS = 220
const MINIMUM_ANIMATED_SHIFT_PX = 24
const KEYBOARD_SLIDE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)"

export function useComposerKeyboardSlide(
    footerRef: RefObject<HTMLElement | null>,
    messagePaneRef?: RefObject<HTMLDivElement | null>,
    messageContentRef?: RefObject<HTMLElement | null>,
) {
    useEffect(() => {
        const currentFooter = footerRef.current
        if (!currentFooter || typeof currentFooter.animate !== "function") return
        const footer: HTMLElement = currentFooter
        const messagePane = messagePaneRef?.current ?? null
        const messageContent = messageContentRef?.current ?? null

        const hostWindow = window.parent === window ? window : window.parent
        const mobile = hostWindow.matchMedia("(max-width: 1023px)")
        const reducedMotion = hostWindow.matchMedia("(prefers-reduced-motion: reduce)")
        let previousBottom = footer.getBoundingClientRect().bottom
        let previousPaneHeight = messagePane?.clientHeight ?? 0
        let previousPaneScrollTop = messagePane?.scrollTop ?? 0
        let frame = 0
        let animations: Animation[] = []

        function cancelAnimations() {
            animations.forEach((animation) => animation.cancel())
            animations = []
            footer.style.willChange = ""
            if (messageContent) messageContent.style.willChange = ""
        }

        function rememberPosition() {
            previousBottom = footer.getBoundingClientRect().bottom
            previousPaneHeight = messagePane?.clientHeight ?? 0
            previousPaneScrollTop = messagePane?.scrollTop ?? 0
        }

        function rememberPaneScroll() {
            if (!messagePane) return
            previousPaneHeight = messagePane.clientHeight
            previousPaneScrollTop = messagePane.scrollTop
        }

        function scheduleKeyboardSlide() {
            if (frame) return
            const startingBottom = previousBottom
            const startingPaneHeight = previousPaneHeight
            const startingPaneScrollTop = previousPaneScrollTop
            frame = window.requestAnimationFrame(() => {
                frame = 0
                const nextBottom = footer.getBoundingClientRect().bottom
                previousBottom = nextBottom
                const shift = startingBottom - nextBottom
                const keyboardActive = mobile.matches && footer.contains(document.activeElement)
                let contentShift = 0

                if (keyboardActive && messagePane) {
                    const nextPaneHeight = messagePane.clientHeight
                    const heightShift = startingPaneHeight - nextPaneHeight
                    const maximumScrollTop = Math.max(0, messagePane.scrollHeight - nextPaneHeight)
                    messagePane.scrollTop = Math.max(0, Math.min(maximumScrollTop, startingPaneScrollTop + heightShift))
                    contentShift = messagePane.scrollTop - startingPaneScrollTop
                    previousPaneHeight = nextPaneHeight
                    previousPaneScrollTop = messagePane.scrollTop
                }

                if (!keyboardActive || reducedMotion.matches || Math.abs(shift) < MINIMUM_ANIMATED_SHIFT_PX) return

                cancelAnimations()
                footer.style.willChange = "transform"
                const timing: KeyframeAnimationOptions = {
                    duration: KEYBOARD_SLIDE_DURATION_MS,
                    easing: KEYBOARD_SLIDE_EASING,
                }
                const footerAnimation = footer.animate([
                    { transform: `translate3d(0, ${shift}px, 0)` },
                    { transform: "translate3d(0, 0, 0)" },
                ], timing)
                animations.push(footerAnimation)

                if (messageContent && Math.abs(contentShift) > 0.5) {
                    messageContent.style.willChange = "transform"
                    animations.push(messageContent.animate([
                        { transform: `translate3d(0, ${contentShift}px, 0)` },
                        { transform: "translate3d(0, 0, 0)" },
                    ], timing))
                }

                messagePane?.parentElement?.querySelectorAll<HTMLElement>("[data-jump-to-latest]").forEach((button) => {
                    animations.push(button.animate([
                        { transform: `translate3d(0, ${shift}px, 0)` },
                        { transform: "translate3d(0, 0, 0)" },
                    ], timing))
                })

                const currentAnimations = animations
                Promise.allSettled(currentAnimations.map((animation) => animation.finished)).then(() => {
                    if (animations !== currentAnimations) return
                    animations = []
                    footer.style.willChange = ""
                    if (messageContent) messageContent.style.willChange = ""
                })
            })
        }

        footer.addEventListener("pointerdown", rememberPosition, { passive: true })
        footer.addEventListener("focusin", rememberPosition)
        messagePane?.addEventListener("scroll", rememberPaneScroll, { passive: true })
        window.addEventListener("resize", scheduleKeyboardSlide)
        hostWindow.visualViewport?.addEventListener("resize", scheduleKeyboardSlide)

        return () => {
            if (frame) window.cancelAnimationFrame(frame)
            cancelAnimations()
            footer.removeEventListener("pointerdown", rememberPosition)
            footer.removeEventListener("focusin", rememberPosition)
            messagePane?.removeEventListener("scroll", rememberPaneScroll)
            window.removeEventListener("resize", scheduleKeyboardSlide)
            hostWindow.visualViewport?.removeEventListener("resize", scheduleKeyboardSlide)
        }
    }, [footerRef, messageContentRef, messagePaneRef])
}
