"use client"

import { type RefObject, useEffect } from "react"

const PORTAL_KEYBOARD_MOTION_MS = 300
const PORTAL_KEYBOARD_SETTLE_MS = PORTAL_KEYBOARD_MOTION_MS + 340
const PORTAL_KEYBOARD_MINIMUM_SHIFT_PX = 64
const PORTAL_KEYBOARD_EASING = "cubic-bezier(0.32, 0.72, 0, 1)"

export function useClientPortalComposerViewport(composerRef: RefObject<HTMLTextAreaElement | null>) {
    useEffect(() => {
        const composer = composerRef.current
        const panel = composer?.closest<HTMLElement>("[data-client-portal-panel]") ?? null
        if (!composer || !panel) return

        const mobile = window.matchMedia("(max-width: 1023px)")
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
        const originalViewportBottom = panel.style.getPropertyValue("--client-portal-viewport-bottom")
        const originalTransition = panel.style.transition
        const originalWillChange = panel.style.willChange
        const readViewportBottom = () => {
            const visualViewport = window.visualViewport
            return Math.round((visualViewport?.offsetTop ?? 0) + (visualViewport?.height ?? window.innerHeight))
        }
        let restingViewportBottom = readViewportBottom()
        let keyboardViewportBottom: number | null = null
        let composerFocused = document.activeElement === composer
        let viewportMode: "idle" | "pending" | "continuous" | "synthetic" | "closing" | "suspended" = composerFocused ? "pending" : "idle"
        let syntheticTargetCommitted = false
        let animationFrame = 0
        let closeTimer = 0

        const setMotion = (enabled: boolean) => {
            panel.style.transition = enabled && !reducedMotion.matches
                ? `height ${PORTAL_KEYBOARD_MOTION_MS}ms ${PORTAL_KEYBOARD_EASING}`
                : "none"
        }
        const writeViewportBottom = (viewportBottom: number) => {
            panel.style.setProperty("--client-portal-viewport-bottom", `${viewportBottom}px`)
        }
        const scheduleSyntheticViewport = () => {
            if (animationFrame || syntheticTargetCommitted) return
            animationFrame = window.requestAnimationFrame(() => {
                animationFrame = 0
                if (viewportMode !== "synthetic" || keyboardViewportBottom === null || syntheticTargetCommitted) return
                syntheticTargetCommitted = true
                writeViewportBottom(keyboardViewportBottom)
            })
        }
        const holdPortalViewport = () => {
            if (document.visibilityState === "hidden") return
            const viewportBottom = readViewportBottom()
            if (viewportMode === "closing" || viewportMode === "suspended") return
            if (!composerFocused) {
                restingViewportBottom = viewportBottom
                keyboardViewportBottom = null
                syntheticTargetCommitted = false
                viewportMode = "idle"
                setMotion(false)
                writeViewportBottom(viewportBottom)
                return
            }

            const keyboardShift = restingViewportBottom - viewportBottom
            if (keyboardShift <= 1) {
                keyboardViewportBottom = null
                syntheticTargetCommitted = false
                viewportMode = "pending"
                setMotion(false)
                writeViewportBottom(restingViewportBottom)
                return
            }
            if (viewportMode === "pending") {
                viewportMode = mobile.matches && keyboardShift >= PORTAL_KEYBOARD_MINIMUM_SHIFT_PX ? "synthetic" : "continuous"
                setMotion(viewportMode === "synthetic")
            }
            // Browser chrome and caret tracking can briefly report a taller visual
            // viewport after the keyboard settles. Keep the smallest open-keyboard
            // edge so that noise cannot push the chat back down while typing.
            keyboardViewportBottom = Math.min(keyboardViewportBottom ?? viewportBottom, viewportBottom)
            if (viewportMode === "synthetic") {
                scheduleSyntheticViewport()
            } else {
                writeViewportBottom(keyboardViewportBottom)
            }
        }
        const handleComposerFocus = () => {
            if (document.visibilityState === "hidden") return
            if (closeTimer) window.clearTimeout(closeTimer)
            closeTimer = 0
            composerFocused = true
            if (viewportMode === "closing" && keyboardViewportBottom !== null) {
                viewportMode = "synthetic"
                syntheticTargetCommitted = true
                setMotion(true)
                writeViewportBottom(keyboardViewportBottom)
                return
            }
            restingViewportBottom = readViewportBottom()
            keyboardViewportBottom = null
            syntheticTargetCommitted = false
            viewportMode = "pending"
            setMotion(false)
            writeViewportBottom(restingViewportBottom)
        }
        const handleComposerBlur = () => {
            composerFocused = false
            if (document.visibilityState === "hidden") return
            if (viewportMode !== "synthetic" || keyboardViewportBottom === null) {
                viewportMode = "idle"
                setMotion(false)
                holdPortalViewport()
                return
            }
            if (animationFrame) window.cancelAnimationFrame(animationFrame)
            animationFrame = 0
            viewportMode = "closing"
            setMotion(true)
            writeViewportBottom(restingViewportBottom)
            closeTimer = window.setTimeout(() => {
                closeTimer = 0
                viewportMode = "idle"
                keyboardViewportBottom = null
                syntheticTargetCommitted = false
                setMotion(false)
                holdPortalViewport()
            }, PORTAL_KEYBOARD_SETTLE_MS)
        }
        const suspendPortalViewport = () => {
            composer.blur()
            composerFocused = false
            if (animationFrame) window.cancelAnimationFrame(animationFrame)
            animationFrame = 0
            if (closeTimer) window.clearTimeout(closeTimer)
            closeTimer = 0
            viewportMode = "suspended"
            keyboardViewportBottom = null
            syntheticTargetCommitted = false
            setMotion(false)
            writeViewportBottom(restingViewportBottom)
        }
        const resumePortalViewport = () => {
            if (document.visibilityState !== "visible" || viewportMode !== "suspended") return
            setMotion(false)
            writeViewportBottom(restingViewportBottom)
            closeTimer = window.setTimeout(() => {
                closeTimer = 0
                viewportMode = "idle"
                holdPortalViewport()
            }, PORTAL_KEYBOARD_SETTLE_MS)
        }
        const handleVisibility = () => {
            if (document.visibilityState === "hidden") suspendPortalViewport()
            else resumePortalViewport()
        }

        panel.style.willChange = "height"
        setMotion(false)
        writeViewportBottom(restingViewportBottom)
        composer.addEventListener("focus", handleComposerFocus)
        composer.addEventListener("blur", handleComposerBlur)
        window.addEventListener("resize", holdPortalViewport)
        window.visualViewport?.addEventListener("resize", holdPortalViewport)
        window.visualViewport?.addEventListener("scroll", holdPortalViewport)
        document.addEventListener("visibilitychange", handleVisibility)
        window.addEventListener("pagehide", suspendPortalViewport)
        window.addEventListener("pageshow", resumePortalViewport)

        return () => {
            composer.removeEventListener("focus", handleComposerFocus)
            composer.removeEventListener("blur", handleComposerBlur)
            window.removeEventListener("resize", holdPortalViewport)
            window.visualViewport?.removeEventListener("resize", holdPortalViewport)
            window.visualViewport?.removeEventListener("scroll", holdPortalViewport)
            document.removeEventListener("visibilitychange", handleVisibility)
            window.removeEventListener("pagehide", suspendPortalViewport)
            window.removeEventListener("pageshow", resumePortalViewport)
            if (animationFrame) window.cancelAnimationFrame(animationFrame)
            if (closeTimer) window.clearTimeout(closeTimer)
            panel.style.transition = originalTransition
            panel.style.willChange = originalWillChange
            if (originalViewportBottom) panel.style.setProperty("--client-portal-viewport-bottom", originalViewportBottom)
            else panel.style.removeProperty("--client-portal-viewport-bottom")
        }
    }, [composerRef])
}
