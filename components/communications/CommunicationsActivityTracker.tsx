"use client"

import { useEffect, useRef, useState } from "react"
import type { CommunicationsConnectionState } from "@/components/communications/useReliableCommunicationsRealtime"
import { useWorkspaceTabActive } from "@/components/workspace/useWorkspaceTabActive"

const HEARTBEAT_MS = 20_000

export function CommunicationsActivityTracker({ connectionState, conversationId, conversationKind, workspaceId }: {
    connectionState: CommunicationsConnectionState
    conversationId: string | null
    conversationKind: "client" | "native"
    workspaceId: string
}) {
    const workspaceTabActive = useWorkspaceTabActive()
    const [tabId] = useState(() => crypto.randomUUID())
    const contextRef = useRef({ connectionState, conversationId, conversationKind, workspaceId, workspaceTabActive })

    useEffect(() => {
        contextRef.current = { connectionState, conversationId, conversationKind, workspaceId, workspaceTabActive }
        const active = workspaceTabActive && document.visibilityState === "visible" && Boolean(conversationId) && connectionState === "live"
        void fetch("/api/communications/activity", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tabId, active, workspaceId, conversationId, conversationKind, connectionLive: connectionState === "live" }),
            keepalive: !active,
        }).catch(() => undefined)
    }, [connectionState, conversationId, conversationKind, tabId, workspaceId, workspaceTabActive])

    useEffect(() => {
        const body = (active: boolean) => {
            const context = contextRef.current
            return JSON.stringify({ tabId, active, workspaceId: context.workspaceId, conversationId: context.conversationId, conversationKind: context.conversationKind, connectionLive: context.connectionState === "live" })
        }
        const update = (active: boolean, keepalive = false) => fetch("/api/communications/activity", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: body(active),
            keepalive,
        }).catch(() => undefined)
        const isActive = () => {
            const context = contextRef.current
            return context.workspaceTabActive && document.visibilityState === "visible" && Boolean(context.conversationId) && context.connectionState === "live"
        }
        const reconcile = () => {
            const active = isActive()
            void update(active, !active)
        }
        const close = () => {
            const payload = new Blob([body(false)], { type: "application/json" })
            if (!navigator.sendBeacon("/api/communications/activity", payload)) void update(false, true)
        }

        reconcile()
        const timer = window.setInterval(() => { if (isActive()) void update(true) }, HEARTBEAT_MS)
        document.addEventListener("visibilitychange", reconcile)
        window.addEventListener("pageshow", reconcile)
        window.addEventListener("pagehide", close)
        return () => {
            window.clearInterval(timer)
            document.removeEventListener("visibilitychange", reconcile)
            window.removeEventListener("pageshow", reconcile)
            window.removeEventListener("pagehide", close)
            void update(false, true)
        }
    }, [tabId])
    return null
}
