"use client"

import { useCallback, useEffect, useState } from "react"
import { CommunicationsWorkspace } from "@/components/communications/CommunicationsWorkspace"
import { TeamCommunicationsWorkspace } from "@/components/communications/TeamCommunicationsWorkspace"
import { CommunicationsActivityTracker } from "@/components/communications/CommunicationsActivityTracker"
import { DEFAULT_CONVERSATION_LIST_WIDTH } from "@/components/communications/ResizableConversationColumns"
import type { CommunicationsConnectionState } from "@/components/communications/useReliableCommunicationsRealtime"
import type { CommunicationsBootstrap } from "@/lib/communications/types"
import type { NativeCommunicationsBootstrap } from "@/lib/teams/types"
import { WORKSPACE_TAB_FRAME_PARAM, WORKSPACE_TAB_MESSAGE_SOURCE, type WorkspaceTabFrameMessage } from "@/lib/workspace-tabs"
import { useWorkspaceDocumentRuntime } from "@/components/workspace/WorkspaceDocumentRuntime"

export function CommunicationsPanel({ clientBootstrap, nativeBootstrap, initialMode }: {
    clientBootstrap: CommunicationsBootstrap
    nativeBootstrap: NativeCommunicationsBootstrap
    initialMode: "clients" | "team"
}) {
    const documentRuntime = useWorkspaceDocumentRuntime()
    const [mode, setModeState] = useState(initialMode)
    const [clientSelectedId, setClientSelectedId] = useState(clientBootstrap.selectedConversationId)
    const [nativeSelectedId, setNativeSelectedId] = useState(nativeBootstrap.requestedConversationId)
    const [clientConnectionState, setClientConnectionState] = useState<CommunicationsConnectionState>("connecting")
    const [nativeConnectionState, setNativeConnectionState] = useState<CommunicationsConnectionState>("connecting")
    const [clientUnreadCount, setClientUnreadCount] = useState(0)
    const [nativeUnreadCount, setNativeUnreadCount] = useState(0)
    const [conversationListWidth, setConversationListWidth] = useState(DEFAULT_CONVERSATION_LIST_WIDTH)
    const unreadCount = clientUnreadCount + nativeUnreadCount

    useEffect(() => {
        const stored = Number(localStorage.getItem(`betelgeze:communications:list-width:${clientBootstrap.workspaceId}`))
        if (!Number.isFinite(stored) || stored < 288 || stored > 448) return
        const timer = window.setTimeout(() => setConversationListWidth(stored), 0)
        return () => window.clearTimeout(timer)
    }, [clientBootstrap.workspaceId])

    useEffect(() => {
        if (documentRuntime?.active === false) return
        const tabId = new URL(window.location.href).searchParams.get(WORKSPACE_TAB_FRAME_PARAM) ?? documentRuntime?.tabId
        if (!tabId) return
        const message: WorkspaceTabFrameMessage = {
            source: WORKSPACE_TAB_MESSAGE_SOURCE,
            target: "host",
            tabId,
            type: "communications-unread",
            unreadCount,
        }
        window.parent.postMessage(message, window.location.origin)
    }, [documentRuntime?.active, documentRuntime?.tabId, unreadCount])

    useEffect(() => {
        if (documentRuntime?.active === false) return
        const url = new URL(window.location.href)
        url.searchParams.set("mode", mode)
        if (clientSelectedId) url.searchParams.set("conversation", clientSelectedId)
        else url.searchParams.delete("conversation")
        if (nativeSelectedId) {
            url.searchParams.set("nativeConversation", nativeSelectedId)
            url.searchParams.delete("dm")
        } else url.searchParams.delete("nativeConversation")

        const tabId = url.searchParams.get(WORKSPACE_TAB_FRAME_PARAM) ?? documentRuntime?.tabId
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
        if (!tabId) return
        const shellUrl = new URL(url)
        shellUrl.searchParams.delete(WORKSPACE_TAB_FRAME_PARAM)
        const message: WorkspaceTabFrameMessage = {
            source: WORKSPACE_TAB_MESSAGE_SOURCE,
            target: "host",
            tabId,
            type: "location-replace",
            url: `${shellUrl.pathname}${shellUrl.search}${shellUrl.hash}`,
        }
        window.parent.postMessage(message, window.location.origin)
    }, [clientSelectedId, documentRuntime?.active, documentRuntime?.tabId, mode, nativeSelectedId])

    const setMode = useCallback((next: "clients" | "team") => {
        setModeState(next)
    }, [])

    const setSharedConversationListWidth = useCallback((width: number) => {
        setConversationListWidth(width)
        localStorage.setItem(`betelgeze:communications:list-width:${clientBootstrap.workspaceId}`, String(width))
    }, [clientBootstrap.workspaceId])
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
                onUnreadCountChange={setClientUnreadCount}
                teamUnreadCount={nativeUnreadCount}
                conversationListWidth={conversationListWidth}
                onConversationListWidthChange={setSharedConversationListWidth}
            />
        </div>
        <div className={mode === "team" ? "absolute inset-0" : "hidden"} aria-hidden={mode !== "team"}>
            <TeamCommunicationsWorkspace
                active={mode === "team"}
                bootstrap={nativeBootstrap}
                onConnectionStateChange={setNativeConnectionState}
                onOpenClients={() => setMode("clients")}
                onSelectedConversationChange={setNativeSelectedId}
                onUnreadCountChange={setNativeUnreadCount}
                clientUnreadCount={clientUnreadCount}
                conversationListWidth={conversationListWidth}
                onConversationListWidthChange={setSharedConversationListWidth}
            />
        </div>
    </div>
}
