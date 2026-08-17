"use client"

import { useCallback, useState } from "react"
import { CommunicationsWorkspace } from "@/components/communications/CommunicationsWorkspace"
import { TeamCommunicationsWorkspace } from "@/components/communications/TeamCommunicationsWorkspace"
import { CommunicationsActivityTracker } from "@/components/communications/CommunicationsActivityTracker"
import type { CommunicationsConnectionState } from "@/components/communications/useReliableCommunicationsRealtime"
import type { CommunicationsBootstrap } from "@/lib/communications/types"
import type { NativeCommunicationsBootstrap } from "@/lib/teams/types"

export function CommunicationsPanel({ clientBootstrap, nativeBootstrap, initialMode }: {
    clientBootstrap: CommunicationsBootstrap
    nativeBootstrap: NativeCommunicationsBootstrap
    initialMode: "clients" | "team"
}) {
    const [mode, setModeState] = useState(initialMode)
    const [clientSelectedId, setClientSelectedId] = useState(clientBootstrap.selectedConversationId)
    const [nativeSelectedId, setNativeSelectedId] = useState(nativeBootstrap.requestedConversationId)
    const [clientConnectionState, setClientConnectionState] = useState<CommunicationsConnectionState>("connecting")
    const [nativeConnectionState, setNativeConnectionState] = useState<CommunicationsConnectionState>("connecting")

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
    return <div data-communications-panel className="fixed inset-0 isolate overflow-hidden overscroll-none bg-black [contain:paint]">
        <CommunicationsActivityTracker
            connectionState={mode === "clients" ? clientConnectionState : nativeConnectionState}
            conversationId={mode === "clients" ? clientSelectedId : nativeSelectedId}
            conversationKind={mode === "clients" ? "client" : "native"}
            workspaceId={clientBootstrap.workspaceId}
        />
        <div className={mode === "clients" ? "absolute inset-0" : "hidden"} aria-hidden={mode !== "clients"}>
            <CommunicationsWorkspace
                active={mode === "clients"}
                bootstrap={clientBootstrap}
                onConnectionStateChange={setClientConnectionState}
                onOpenTeam={() => setMode("team")}
                onSelectedConversationChange={setClientSelectedId}
            />
        </div>
        <div className={mode === "team" ? "absolute inset-0" : "hidden"} aria-hidden={mode !== "team"}>
            <TeamCommunicationsWorkspace
                active={mode === "team"}
                bootstrap={nativeBootstrap}
                onConnectionStateChange={setNativeConnectionState}
                onOpenClients={() => setMode("clients")}
                onSelectedConversationChange={setNativeSelectedId}
            />
        </div>
    </div>
}
