"use client"

import { useEffect } from "react"
import { useWorkspaceTabActive } from "@/components/workspace/useWorkspaceTabActive"

const HEARTBEAT_MS = 20_000

export function CommunicationsActivityTracker() {
    const workspaceTabActive = useWorkspaceTabActive()

    useEffect(() => {
        const tabId = crypto.randomUUID()
        const body = (active: boolean) => JSON.stringify({ tabId, active })
        const update = (active: boolean, keepalive = false) => fetch("/api/communications/activity", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: body(active),
            keepalive,
        }).catch(() => undefined)
        const isActive = () => workspaceTabActive && document.visibilityState === "visible"
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
    }, [workspaceTabActive])
    return null
}
