"use client"

import { useCallback, useState } from "react"
import { CommunicationsWorkspace } from "@/components/communications/CommunicationsWorkspace"
import { TeamCommunicationsWorkspace } from "@/components/communications/TeamCommunicationsWorkspace"
import type { CommunicationsBootstrap } from "@/lib/communications/types"
import type { NativeCommunicationsBootstrap } from "@/lib/teams/types"

export function CommunicationsPanel({ clientBootstrap, nativeBootstrap, initialMode }: {
    clientBootstrap: CommunicationsBootstrap
    nativeBootstrap: NativeCommunicationsBootstrap
    initialMode: "clients" | "team"
}) {
    const [mode, setModeState] = useState(initialMode)
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
    return <div data-communications-panel className="fixed inset-0 isolate overflow-hidden bg-black">
        {mode === "team"
            ? <TeamCommunicationsWorkspace bootstrap={nativeBootstrap} onOpenClients={() => setMode("clients")} />
            : <CommunicationsWorkspace bootstrap={clientBootstrap} onOpenTeam={() => setMode("team")} />}
    </div>
}
