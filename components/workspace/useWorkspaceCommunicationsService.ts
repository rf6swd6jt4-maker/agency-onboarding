"use client"

import { useEffect, useRef } from "react"
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js"

const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000]
const SAFETY_SYNC_MS = 20_000
const EVENT_SYNC_DELAY_MS = 120

type UnreadResponse = {
    clientUnread?: number
    nativeUnread?: number
    unreadCount?: number
}

export function useWorkspaceCommunicationsService({
    enabled,
    nativeRealtime,
    onUnreadCountChange,
    supabase,
    workspaceId,
    workspaceSlug,
}: {
    enabled: boolean
    nativeRealtime: boolean
    onUnreadCountChange: (count: number) => void
    supabase: SupabaseClient
    workspaceId: string
    workspaceSlug: string
}) {
    const onUnreadCountChangeRef = useRef(onUnreadCountChange)
    useEffect(() => { onUnreadCountChangeRef.current = onUnreadCountChange }, [onUnreadCountChange])

    useEffect(() => {
        if (!enabled) return

        let disposed = false
        let connecting = false
        let retryAttempt = 0
        let retryTimer: number | null = null
        let eventSyncTimer: number | null = null
        let safetyTimer: number | null = null
        let syncPromise: Promise<void> | null = null
        let channels: RealtimeChannel[] = []
        let subscribedChannels = 0

        async function synchronize() {
            if (disposed) return
            if (syncPromise) return syncPromise
            syncPromise = fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/communications/unread`, {
                cache: "no-store",
                credentials: "same-origin",
            }).then(async (response) => {
                const result = await response.json().catch(() => null) as UnreadResponse | null
                if (!response.ok || !result) throw new Error("Unread messages could not be checked.")
                const count = Number(result.unreadCount ?? (result.clientUnread ?? 0) + (result.nativeUnread ?? 0))
                if (!disposed && Number.isSafeInteger(count) && count >= 0) onUnreadCountChangeRef.current(count)
            }).finally(() => { syncPromise = null })
            return syncPromise
        }

        function scheduleEventSync() {
            if (disposed || eventSyncTimer !== null) return
            eventSyncTimer = window.setTimeout(() => {
                eventSyncTimer = null
                void synchronize().catch(() => scheduleReconnect())
            }, EVENT_SYNC_DELAY_MS)
        }

        async function refreshRealtimeAuth() {
            const session = await supabase.auth.getSession()
            const accessToken = session.data.session?.access_token
            if (!accessToken) throw new Error("Workspace session expired.")
            await supabase.realtime.setAuth(accessToken)
        }

        function removeChannels() {
            const previous = channels
            channels = []
            subscribedChannels = 0
            previous.forEach((channel) => { void supabase.removeChannel(channel) })
        }

        function scheduleReconnect() {
            if (disposed || retryTimer !== null || !navigator.onLine) return
            retryAttempt += 1
            const delay = RETRY_DELAYS_MS[Math.min(retryAttempt - 1, RETRY_DELAYS_MS.length - 1)]
            retryTimer = window.setTimeout(() => {
                retryTimer = null
                void connect()
            }, delay)
        }

        function registerDurableEvents(channel: RealtimeChannel, tables: string[]) {
            return tables.reduce((registered, table) => registered.on(
                "postgres_changes",
                { event: "*", schema: "public", table, filter: `workspace_id=eq.${workspaceId}` },
                scheduleEventSync,
            ), channel)
        }

        async function connect() {
            if (disposed || connecting) return
            if (!navigator.onLine) return
            connecting = true
            if (retryTimer !== null) {
                window.clearTimeout(retryTimer)
                retryTimer = null
            }
            removeChannels()
            try {
                // The before/after snapshots close both sides of the subscribe
                // race. Realtime is only a prompt to re-count durable rows.
                await synchronize()
                await refreshRealtimeAuth()
                if (disposed) return

                const nextChannels = [registerDurableEvents(
                    supabase.channel(`communications-client:${workspaceSlug}`, { config: { private: false } }),
                    ["client_messages", "communication_read_cursors", "relationships"],
                )]
                if (nativeRealtime) nextChannels.push(registerDurableEvents(
                    supabase.channel(`communications:${workspaceSlug}`, { config: { private: true } }),
                    [
                        "workspace_native_messages",
                        "workspace_native_read_cursors",
                        "workspace_native_conversations",
                        "workspace_native_conversation_visibility",
                        "workspace_team_members",
                    ],
                ))
                channels = nextChannels
                const expectedSubscriptions = nextChannels.length
                nextChannels.forEach((candidate) => candidate.subscribe((status) => {
                    if (disposed || !channels.includes(candidate)) return
                    if (status === "SUBSCRIBED") {
                        subscribedChannels += 1
                        if (subscribedChannels === expectedSubscriptions) {
                            retryAttempt = 0
                            void synchronize().catch(() => scheduleReconnect())
                        }
                    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
                        scheduleReconnect()
                    }
                }))
            } catch {
                scheduleReconnect()
            } finally {
                connecting = false
            }
        }

        function recoverWhenAvailable() {
            if (disposed || document.visibilityState !== "visible" || !navigator.onLine) return
            if (channels.length && subscribedChannels === channels.length) {
                void synchronize().catch(() => scheduleReconnect())
            } else {
                void connect()
            }
        }

        const authSubscription = supabase.auth.onAuthStateChange((_event, session) => {
            if (!session?.access_token || disposed) return
            window.setTimeout(() => { void connect() }, 0)
        })
        safetyTimer = window.setInterval(recoverWhenAvailable, SAFETY_SYNC_MS)
        window.addEventListener("online", recoverWhenAvailable)
        window.addEventListener("focus", recoverWhenAvailable)
        document.addEventListener("visibilitychange", recoverWhenAvailable)
        void connect()

        return () => {
            disposed = true
            if (retryTimer !== null) window.clearTimeout(retryTimer)
            if (eventSyncTimer !== null) window.clearTimeout(eventSyncTimer)
            if (safetyTimer !== null) window.clearInterval(safetyTimer)
            authSubscription.data.subscription.unsubscribe()
            window.removeEventListener("online", recoverWhenAvailable)
            window.removeEventListener("focus", recoverWhenAvailable)
            document.removeEventListener("visibilitychange", recoverWhenAvailable)
            removeChannels()
        }
    }, [enabled, nativeRealtime, supabase, workspaceId, workspaceSlug])
}
