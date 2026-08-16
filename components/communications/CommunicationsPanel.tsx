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
        const viewport = window.visualViewport
        let frame = 0

        root.dataset.communicationsViewportLocked = "true"

        const updateViewport = () => {
            window.cancelAnimationFrame(frame)
            frame = window.requestAnimationFrame(() => {
                panel.style.height = `${Math.round(viewport?.height ?? window.innerHeight)}px`
                panel.style.transform = `translate3d(0,${Math.round(viewport?.offsetTop ?? 0)}px,0)`
                if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0)
            })
        }

        updateViewport()
        window.addEventListener("resize", updateViewport)
        window.addEventListener("scroll", updateViewport, { passive: true })
        viewport?.addEventListener("resize", updateViewport)
        viewport?.addEventListener("scroll", updateViewport)
        document.addEventListener("focusin", updateViewport)

        return () => {
            window.cancelAnimationFrame(frame)
            window.removeEventListener("resize", updateViewport)
            window.removeEventListener("scroll", updateViewport)
            viewport?.removeEventListener("resize", updateViewport)
            viewport?.removeEventListener("scroll", updateViewport)
            document.removeEventListener("focusin", updateViewport)
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
