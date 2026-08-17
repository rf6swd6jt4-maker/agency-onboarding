"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js"

import { useWorkspaceTabActive, WORKSPACE_TAB_VISIBILITY_EVENT } from "@/components/workspace/useWorkspaceTabActive"

export type CommunicationsConnectionState = "connecting" | "syncing" | "live" | "reconnecting" | "offline" | "error"

const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000]
const SAFETY_SYNC_MS = 20_000
const COMMUNICATIONS_RECOVERY_EVENT = "betelgeze:communications-recover"

export function useReliableCommunicationsRealtime({
    active,
    connectionKey,
    register,
    schemaReady,
    supabase,
    synchronize,
}: {
    active: boolean
    connectionKey: string
    register: (channel: RealtimeChannel) => RealtimeChannel
    schemaReady: boolean
    supabase: SupabaseClient
    synchronize: () => Promise<void>
}) {
    const workspaceTabActive = useWorkspaceTabActive()
    const activeRef = useRef(active)
    const workspaceTabActiveRef = useRef(workspaceTabActive)
    const registerRef = useRef(register)
    const synchronizeRef = useRef(synchronize)
    const stateRef = useRef<CommunicationsConnectionState>(schemaReady ? "connecting" : "offline")
    const [state, setState] = useState<CommunicationsConnectionState>(() => schemaReady ? "connecting" : "offline")
    const [error, setError] = useState<string | null>(schemaReady ? null : "Communications database updates are unavailable.")

    useEffect(() => { registerRef.current = register }, [register])
    useEffect(() => { synchronizeRef.current = synchronize }, [synchronize])
    useEffect(() => { activeRef.current = active; if (active) window.dispatchEvent(new Event(COMMUNICATIONS_RECOVERY_EVENT)) }, [active])
    useEffect(() => { workspaceTabActiveRef.current = workspaceTabActive; if (workspaceTabActive) window.dispatchEvent(new Event(COMMUNICATIONS_RECOVERY_EVENT)) }, [workspaceTabActive])

    const updateState = useCallback((next: CommunicationsConnectionState, nextError: string | null = null) => {
        stateRef.current = next
        setState(next)
        setError(nextError)
    }, [])

    useEffect(() => {
        if (!schemaReady) {
            const timer = window.setTimeout(() => updateState("offline", "Communications database updates are unavailable."), 0)
            return () => window.clearTimeout(timer)
        }

        let disposed = false
        let connecting = false
        let channel: RealtimeChannel | null = null
        let retryTimer: number | null = null
        let retryAttempt = 0
        let syncPromise: Promise<void> | null = null
        let subscribed = false

        function visibleAndActive() {
            return activeRef.current && workspaceTabActiveRef.current && document.visibilityState === "visible"
        }

        async function runSync(showState: boolean) {
            if (disposed) return
            if (syncPromise) return syncPromise
            if (showState) updateState("syncing")
            syncPromise = synchronizeRef.current()
                .then(() => {
                    if (!disposed && subscribed) updateState("live")
                })
                .finally(() => { syncPromise = null })
            return syncPromise
        }

        function scheduleReconnect(message: string) {
            if (disposed || retryTimer !== null) return
            subscribed = false
            if (!navigator.onLine) {
                updateState("offline", "Offline. Messages will be checked when the connection returns.")
                return
            }
            retryAttempt += 1
            const delay = RETRY_DELAYS_MS[Math.min(retryAttempt - 1, RETRY_DELAYS_MS.length - 1)]
            updateState(retryAttempt >= RETRY_DELAYS_MS.length ? "error" : "reconnecting", message)
            retryTimer = window.setTimeout(() => {
                retryTimer = null
                void connect()
            }, delay)
        }

        async function connect() {
            if (disposed || connecting) return
            if (!navigator.onLine) {
                updateState("offline", "Offline. Messages will be checked when the connection returns.")
                return
            }
            connecting = true
            subscribed = false
            if (retryTimer !== null) {
                window.clearTimeout(retryTimer)
                retryTimer = null
            }
            updateState(retryAttempt ? "reconnecting" : "connecting")
            try {
                if (channel) {
                    const previous = channel
                    channel = null
                    await supabase.removeChannel(previous)
                }
                const session = await supabase.auth.getSession()
                if (!session.data.session?.access_token) {
                    updateState("offline", "Sign in again to restore live messages.")
                    return
                }
                // Use the client's access-token callback instead of pinning this
                // channel to one JWT for the lifetime of a mounted workspace tab.
                await supabase.realtime.setAuth()
                if (disposed) return
                const candidate = registerRef.current(supabase.channel(`communications:${connectionKey}`, { config: { private: true } }))
                channel = candidate
                candidate.subscribe((status, subscribeError) => {
                    if (disposed || channel !== candidate) return
                    if (status === "SUBSCRIBED") {
                        subscribed = true
                        retryAttempt = 0
                        void runSync(true).catch((syncError) => {
                            scheduleReconnect(syncError instanceof Error ? syncError.message : "Messages connected, but missed updates could not be checked.")
                        })
                    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
                        scheduleReconnect(subscribeError?.message || `Live messages ${status.toLowerCase().replaceAll("_", " ")}.`)
                    }
                })
            } catch (connectError) {
                scheduleReconnect(connectError instanceof Error ? connectError.message : "Live messages could not connect.")
            } finally {
                connecting = false
            }
        }

        function recoverWhenAvailable() {
            if (!visibleAndActive()) return
            if (!navigator.onLine) {
                updateState("offline", "Offline. Messages will be checked when the connection returns.")
                return
            }
            if (stateRef.current === "live") {
                void runSync(false).catch((syncError) => {
                    scheduleReconnect(syncError instanceof Error ? syncError.message : "Could not check for missed messages.")
                })
            } else {
                void connect()
            }
        }

        const authSubscription = supabase.auth.onAuthStateChange((_event, session) => {
            if (!session?.access_token || disposed) return
            window.setTimeout(() => { void connect() }, 0)
        })
        const interval = window.setInterval(() => {
            if (visibleAndActive()) recoverWhenAvailable()
        }, SAFETY_SYNC_MS)
        const handleOffline = () => { subscribed = false; updateState("offline", "Offline. Messages will be checked when the connection returns.") }
        window.addEventListener("online", recoverWhenAvailable)
        window.addEventListener("offline", handleOffline)
        window.addEventListener("focus", recoverWhenAvailable)
        window.addEventListener(WORKSPACE_TAB_VISIBILITY_EVENT, recoverWhenAvailable)
        window.addEventListener(COMMUNICATIONS_RECOVERY_EVENT, recoverWhenAvailable)
        document.addEventListener("visibilitychange", recoverWhenAvailable)
        void connect()

        return () => {
            disposed = true
            if (retryTimer !== null) window.clearTimeout(retryTimer)
            window.clearInterval(interval)
            authSubscription.data.subscription.unsubscribe()
            window.removeEventListener("online", recoverWhenAvailable)
            window.removeEventListener("offline", handleOffline)
            window.removeEventListener("focus", recoverWhenAvailable)
            window.removeEventListener(WORKSPACE_TAB_VISIBILITY_EVENT, recoverWhenAvailable)
            window.removeEventListener(COMMUNICATIONS_RECOVERY_EVENT, recoverWhenAvailable)
            document.removeEventListener("visibilitychange", recoverWhenAvailable)
            if (channel) void supabase.removeChannel(channel)
        }
    }, [connectionKey, schemaReady, supabase, updateState])

    return { state, error, workspaceTabActive }
}
