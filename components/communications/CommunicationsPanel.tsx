"use client"

import { useCallback, useLayoutEffect, useRef, useState } from "react"
import { CommunicationsWorkspace } from "@/components/communications/CommunicationsWorkspace"
import { TeamCommunicationsWorkspace } from "@/components/communications/TeamCommunicationsWorkspace"
import { CommunicationsActivityTracker } from "@/components/communications/CommunicationsActivityTracker"
import type { CommunicationsBootstrap } from "@/lib/communications/types"
import type { NativeCommunicationsBootstrap } from "@/lib/teams/types"

export function CommunicationsPanel({ clientBootstrap, nativeBootstrap, initialMode }: {
    clientBootstrap: CommunicationsBootstrap
    nativeBootstrap: NativeCommunicationsBootstrap
    initialMode: "clients" | "team"
}) {
    const panelRef = useRef<HTMLDivElement>(null)
    const [mode, setModeState] = useState(initialMode)

    useLayoutEffect(() => {
        const panel = panelRef.current
        if (!panel) return
        const root = document.documentElement
        let viewportHost: Window & typeof globalThis = window
        let frameElement: HTMLElement | null = null
        try {
            if (window.parent !== window && window.parent.location.origin === window.location.origin) {
                viewportHost = window.parent as Window & typeof globalThis
                frameElement = window.frameElement as HTMLElement | null
            }
        } catch {
            viewportHost = window
        }
        const viewport = viewportHost.visualViewport
        const frameMutationObserver = frameElement ? new viewportHost.MutationObserver(updateViewportAfterFrameChange) : null
        const frameResizeObserver = frameElement ? new viewportHost.ResizeObserver(updateViewportAfterFrameChange) : null
        let frame = 0

        root.dataset.communicationsViewportLocked = "true"

        const updateViewport = () => {
            window.cancelAnimationFrame(frame)
            frame = window.requestAnimationFrame(() => {
                const viewportHeight = viewport?.height ?? viewportHost.innerHeight
                const viewportWidth = viewport?.width ?? viewportHost.innerWidth
                const viewportTop = viewport?.offsetTop ?? 0
                const viewportLeft = viewport?.offsetLeft ?? 0
                const frameRect = frameElement?.getBoundingClientRect()
                const visibleTop = frameRect ? Math.max(frameRect.top, viewportTop) : viewportTop
                const visibleLeft = frameRect ? Math.max(frameRect.left, viewportLeft) : viewportLeft
                const visibleBottom = frameRect ? Math.min(frameRect.bottom, viewportTop + viewportHeight) : viewportTop + viewportHeight
                const visibleRight = frameRect ? Math.min(frameRect.right, viewportLeft + viewportWidth) : viewportLeft + viewportWidth
                const height = Math.max(0, frameRect ? visibleBottom - visibleTop : viewportHeight)
                const width = Math.max(0, frameRect ? visibleRight - visibleLeft : viewportWidth)
                const top = frameRect ? visibleTop - frameRect.top : visibleTop
                const left = frameRect ? visibleLeft - frameRect.left : visibleLeft
                panel.style.height = `${Math.round(height)}px`
                panel.style.width = `${Math.round(width)}px`
                panel.style.transform = `translate3d(${Math.round(left)}px,${Math.round(top)}px,0)`
                if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0)
            })
        }

        function updateViewportAfterFrameChange() {
            updateViewport()
        }

        updateViewport()
        frameMutationObserver?.observe(frameElement!, { attributes: true, attributeFilter: ["hidden", "aria-hidden", "class", "style"] })
        frameResizeObserver?.observe(frameElement!)
        window.addEventListener("resize", updateViewport)
        window.addEventListener("scroll", updateViewport, { passive: true })
        if (viewportHost !== window) {
            viewportHost.addEventListener("resize", updateViewport)
            viewportHost.addEventListener("scroll", updateViewport, { passive: true })
        }
        viewport?.addEventListener("resize", updateViewport)
        viewport?.addEventListener("scroll", updateViewport)
        document.addEventListener("focusin", updateViewport)

        return () => {
            window.cancelAnimationFrame(frame)
            window.removeEventListener("resize", updateViewport)
            window.removeEventListener("scroll", updateViewport)
            if (viewportHost !== window) {
                viewportHost.removeEventListener("resize", updateViewport)
                viewportHost.removeEventListener("scroll", updateViewport)
            }
            viewport?.removeEventListener("resize", updateViewport)
            viewport?.removeEventListener("scroll", updateViewport)
            document.removeEventListener("focusin", updateViewport)
            frameMutationObserver?.disconnect()
            frameResizeObserver?.disconnect()
            delete root.dataset.communicationsViewportLocked
        }
    }, [])

    const setMode = useCallback((next: "clients" | "team") => {
        setModeState(next)
        const url = new URL(window.location.href)
        if (next === "team") url.searchParams.set("mode", "team")
        else {
            url.searchParams.delete("mode")
            url.searchParams.delete("nativeConversation")
            url.searchParams.delete("dm")
        }
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
    }, [])
    return <div ref={panelRef} data-communications-panel className="fixed left-0 top-0 isolate h-full w-full overflow-hidden overscroll-none bg-black [contain:paint]">
        <CommunicationsActivityTracker />
        {mode === "team"
            ? <TeamCommunicationsWorkspace bootstrap={nativeBootstrap} onOpenClients={() => setMode("clients")} />
            : <CommunicationsWorkspace bootstrap={clientBootstrap} onOpenTeam={() => setMode("team")} />}
    </div>
}
