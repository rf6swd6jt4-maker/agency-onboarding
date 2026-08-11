"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import * as Y from "yjs"
import { upgradeBookendToV2, upgradeModuleToV2, type OnboardingBookendDefinitionV2, type OnboardingModuleDefinitionV2 } from "@/lib/onboarding/block-definition"
import { visibleBuilderPresence, type BuilderPresence } from "@/lib/onboarding/builder-presence"
import { persistBuilderUpdate, refreshBuilderUpdates } from "@/lib/onboarding/builder-sync-client"
import type { OnboardingBuilderData, OnboardingThemeDefinition } from "@/lib/onboarding/configuration-types"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"

export type VisualBuilderDocument = {
    modules: OnboardingModuleDefinitionV2[]
    welcome: OnboardingBookendDefinitionV2
    completion: OnboardingBookendDefinitionV2
    theme: OnboardingThemeDefinition
    linkedChangeSets: Array<{ id: string; definitionIds: string[]; createdVersion?: number }>
}

export type BuilderSyncState = "syncing" | "synced" | "offline" | "error" | "publishing"
export type BuilderRealtimeState = "connecting" | "connected" | "reconnecting" | "unavailable"

type BuilderCollaboratorActivity = Pick<BuilderPresence, "selection" | "cursor"> & {
    clientId: string
    userId: string
}

const collaboratorColours = ["#67E8F9", "#A7F3D0", "#FDE68A", "#F9A8D4", "#C4B5FD", "#FDBA74"]
const KEYED_ARRAY_KIND = "betelgeze-keyed-array"

function colourForUser(userId: string) {
    let hash = 0
    for (const character of userId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
    return collaboratorColours[hash % collaboratorColours.length]
}

function uint8ToBase64(value: Uint8Array) {
    let binary = ""
    for (let index = 0; index < value.length; index += 0x8000) binary += String.fromCharCode(...value.subarray(index, index + 0x8000))
    return btoa(binary)
}

function base64ToUint8(value: string) {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
}

function toYValue(value: unknown): unknown {
    if (typeof value === "string") {
        const text = new Y.Text()
        text.insert(0, value)
        return text
    }
    if (Array.isArray(value)) {
        const keyed = value.length > 0 && value.every((item) => item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string")
        if (keyed) {
            const container = new Y.Map<unknown>()
            const order = new Y.Array<string>()
            const items = new Y.Map<unknown>()
            const ids = value.map((item) => String((item as { id: string }).id))
            if (ids.length) order.insert(0, ids)
            for (const item of value) items.set(String((item as { id: string }).id), toYValue(item))
            container.set("__kind", KEYED_ARRAY_KIND)
            container.set("order", order)
            container.set("items", items)
            return container
        }
        const array = new Y.Array<unknown>()
        array.insert(0, value.map(toYValue))
        return array
    }
    if (value && typeof value === "object") {
        const map = new Y.Map<unknown>()
        for (const [key, item] of Object.entries(value)) map.set(key, toYValue(item))
        return map
    }
    return value
}

function plain(value: unknown): unknown {
    if (value instanceof Y.Map && value.get("__kind") === KEYED_ARRAY_KIND) {
        const orderValue = value.get("order")
        const itemsValue = value.get("items")
        const order = orderValue instanceof Y.Array ? orderValue.toArray().map(String) : []
        if (!(itemsValue instanceof Y.Map)) return []
        const ids = [...new Set([...order, ...itemsValue.keys()])]
        return ids.flatMap((id) => {
            const item = itemsValue.get(id)
            return item === undefined ? [] : [plain(item)]
        })
    }
    if (value instanceof Y.Map) return Object.fromEntries([...value.entries()].map(([key, item]) => [key, plain(item)]))
    if (value instanceof Y.Array) return value.toArray().map(plain)
    if (value instanceof Y.Text) return value.toString()
    if (value instanceof Y.AbstractType) return value.toJSON()
    return value
}

function reconcileText(current: Y.Text, next: string) {
    const previous = current.toString()
    if (previous === next) return
    let prefix = 0
    while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1
    let suffix = 0
    while (suffix < previous.length - prefix && suffix < next.length - prefix && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix += 1
    if (previous.length - prefix - suffix > 0) current.delete(prefix, previous.length - prefix - suffix)
    const insertion = next.slice(prefix, next.length - suffix)
    if (insertion) current.insert(prefix, insertion)
}

function reconcileMap(current: Y.Map<unknown>, next: Record<string, unknown>) {
    for (const key of current.keys()) if (!(key in next)) current.delete(key)
    for (const [key, value] of Object.entries(next)) {
        const existing = current.get(key)
        if (typeof value === "string" && existing instanceof Y.Text) reconcileText(existing, value)
        else if (Array.isArray(value) && existing instanceof Y.Map && existing.get("__kind") === KEYED_ARRAY_KIND) reconcileKeyedArray(existing, value)
        else if (Array.isArray(value) && existing instanceof Y.Array) {
            const keyed = value.length > 0 && value.every((item) => item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string")
            if (keyed) current.set(key, toYValue(value))
            else reconcileArray(existing, value)
        }
        else if (value && typeof value === "object" && !Array.isArray(value) && existing instanceof Y.Map) reconcileMap(existing, value as Record<string, unknown>)
        else if (JSON.stringify(plain(existing)) !== JSON.stringify(value)) current.set(key, toYValue(value))
    }
}

function reconcileKeyedArray(container: Y.Map<unknown>, next: unknown[]) {
    const existingOrder = container.get("order")
    const existingItems = container.get("items")
    let order: Y.Array<string>
    let items: Y.Map<unknown>
    if (existingOrder instanceof Y.Array) {
        order = existingOrder as Y.Array<string>
    } else {
        order = new Y.Array<string>()
        container.set("order", order)
    }
    if (existingItems instanceof Y.Map) {
        items = existingItems as Y.Map<unknown>
    } else {
        items = new Y.Map<unknown>()
        container.set("items", items)
    }
    const nextItems = next as Array<Record<string, unknown> & { id: string }>
    const nextIds = nextItems.map((item) => String(item.id))
    const nextIdSet = new Set(nextIds)
    for (const id of items.keys()) if (!nextIdSet.has(id)) items.delete(id)
    for (const item of nextItems) {
        const id = String(item.id)
        const existing = items.get(id)
        if (existing instanceof Y.Map) reconcileMap(existing, item)
        else items.set(id, toYValue(item))
    }
    const seen = new Set<string>()
    for (let index = order.length - 1; index >= 0; index -= 1) {
        const id = String(order.get(index))
        if (!nextIdSet.has(id) || seen.has(id)) order.delete(index, 1)
        else seen.add(id)
    }
    for (let index = 0; index < nextIds.length; index += 1) {
        const id = nextIds[index]
        const currentOrder = order.toArray().map(String)
        const currentIndex = currentOrder.indexOf(id)
        if (currentIndex === index) continue
        if (currentIndex >= 0) order.delete(currentIndex, 1)
        order.insert(Math.min(index, order.length), [id])
    }
}

function reconcileArray(current: Y.Array<unknown>, next: unknown[]) {
    const existing = current.toArray()
    const keyed = next.every((item) => item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string")
        && existing.every((item) => item instanceof Y.Map && typeof item.get("id")?.toString() === "string")
    if (!keyed) {
        if (JSON.stringify(current.toJSON()) === JSON.stringify(next)) return
        if (current.length) current.delete(0, current.length)
        if (next.length) current.insert(0, next.map(toYValue))
        return
    }
    const existingIds = existing.map((item) => String((item as Y.Map<unknown>).get("id")))
    const nextIds = next.map((item) => String((item as { id: string }).id))
    if (existingIds.join("|") !== nextIds.join("|")) {
        const byId = new Map(existing.map((item) => [String((item as Y.Map<unknown>).get("id")), item as Y.Map<unknown>]))
        const replacements = next.map((item) => {
            const map = byId.get(String((item as { id: string }).id))
            if (map) {
                reconcileMap(map, item as Record<string, unknown>)
                return toYValue(map.toJSON())
            }
            return toYValue(item)
        })
        if (current.length) current.delete(0, current.length)
        if (replacements.length) current.insert(0, replacements)
        return
    }
    next.forEach((item, index) => reconcileMap(existing[index] as Y.Map<unknown>, item as Record<string, unknown>))
}

function writeDocument(root: Y.Map<unknown>, document: VisualBuilderDocument) {
    const moduleIds = new Set(document.modules.map((module) => module.id))
    for (const key of root.keys()) if (key.startsWith("module:") && !moduleIds.has(key.slice(7))) root.delete(key)
    for (const moduleDefinition of document.modules) {
        const key = `module:${moduleDefinition.id}`
        const existing = root.get(key)
        if (existing instanceof Y.Map) reconcileMap(existing, moduleDefinition as unknown as Record<string, unknown>)
        else root.set(key, toYValue(moduleDefinition))
    }
    for (const [key, value] of [["welcome", document.welcome], ["completion", document.completion], ["theme", document.theme], ["linkedChangeSets", document.linkedChangeSets]] as const) {
        const existing = root.get(key)
        if (Array.isArray(value) && existing instanceof Y.Map && existing.get("__kind") === KEYED_ARRAY_KIND) reconcileKeyedArray(existing, value)
        else if (Array.isArray(value) && existing instanceof Y.Array) reconcileArray(existing, value)
        else if (value && typeof value === "object" && !Array.isArray(value) && existing instanceof Y.Map) reconcileMap(existing, value as unknown as Record<string, unknown>)
        else root.set(key, toYValue(value))
    }
    const order = document.modules.map((module) => module.id)
    const existingOrder = root.get("moduleOrder")
    if (existingOrder instanceof Y.Array) reconcileArray(existingOrder, order)
    else root.set("moduleOrder", toYValue(order))
}

function readDocument(root: Y.Map<unknown>, fallback: VisualBuilderDocument): VisualBuilderDocument {
    const order = (plain(root.get("moduleOrder")) as string[] | undefined) ?? fallback.modules.map((module) => module.id)
    const modules = order.flatMap((id) => {
        const value = plain(root.get(`module:${id}`))
        return value && typeof value === "object" ? [upgradeModuleToV2(value as OnboardingModuleDefinitionV2)] : []
    })
    const restoredIds = new Set(modules.map((module) => module.id))
    const restoredModules = [...modules, ...fallback.modules.filter((module) => !restoredIds.has(module.id)).map(upgradeModuleToV2)]
    const fallbackOrder = new Map(fallback.modules.map((module, index) => [module.id, index]))
    const orderedModules = restoredModules.every((module) => typeof module.sortOrder === "number")
        ? [...restoredModules].sort((left, right) => left.sortOrder! - right.sortOrder!)
        : [...restoredModules].sort((left, right) => (fallbackOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (fallbackOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER) || left.name.localeCompare(right.name))
    return {
        modules: orderedModules.length ? orderedModules : fallback.modules.map(upgradeModuleToV2),
        welcome: upgradeBookendToV2((plain(root.get("welcome")) as OnboardingBookendDefinitionV2 | undefined) ?? fallback.welcome),
        completion: upgradeBookendToV2((plain(root.get("completion")) as OnboardingBookendDefinitionV2 | undefined) ?? fallback.completion),
        theme: (plain(root.get("theme")) as OnboardingThemeDefinition | undefined) ?? fallback.theme,
        linkedChangeSets: (plain(root.get("linkedChangeSets")) as VisualBuilderDocument["linkedChangeSets"] | undefined) ?? [],
    }
}

function changedDefinitions(before: VisualBuilderDocument, after: VisualBuilderDocument) {
    const changed = new Set<string>()
    const beforeModules = new Map(before.modules.map((module) => [module.id, JSON.stringify(module)]))
    for (const moduleDefinition of after.modules) if (JSON.stringify(moduleDefinition) !== beforeModules.get(moduleDefinition.id)) changed.add(moduleDefinition.id)
    if (JSON.stringify(before.welcome) !== JSON.stringify(after.welcome)) changed.add("bookend:welcome")
    if (JSON.stringify(before.completion) !== JSON.stringify(after.completion)) changed.add("bookend:completion")
    if (JSON.stringify(before.theme) !== JSON.stringify(after.theme)) changed.add("theme")
    return changed
}

export function useCollaborativeOnboardingDocument({
    workspaceSlug,
    initial,
    collaboration,
}: {
    workspaceSlug: string
    initial: VisualBuilderDocument
    collaboration: OnboardingBuilderData["collaboration"]
}) {
    const initialRef = useRef(initial)
    const docRef = useRef<Y.Doc | null>(null)
    const rootRef = useRef<Y.Map<unknown> | null>(null)
    const undoManagerRef = useRef<Y.UndoManager | null>(null)
    const channelRef = useRef<ReturnType<ReturnType<typeof createSupabaseBrowserClient>["channel"]> | null>(null)
    const clientIdRef = useRef(crypto.randomUUID())
    const updateCounterRef = useRef(0)
    const lastSequenceRef = useRef(Math.max(collaboration.snapshotSequence, ...collaboration.updates.map((update) => update.sequence), 0))
    const pendingUpdatesRef = useRef<Uint8Array[]>([])
    const pendingDefinitionIdsRef = useRef(new Set<string>())
    const retryUpdateRef = useRef<{ update: Uint8Array; definitionIds: string[]; updateId: string } | null>(null)
    const flushingRef = useRef<Promise<number> | null>(null)
    const refreshingRef = useRef<Promise<boolean> | null>(null)
    const persistTimerRef = useRef<number | null>(null)
    const localOriginRef = useRef({ actor: collaboration.currentUser?.id ?? "anonymous" })
    const localPresenceRef = useRef<BuilderPresence | null>(null)
    const localActivityRef = useRef<BuilderCollaboratorActivity | null>(null)
    const activityTimerRef = useRef<number | null>(null)
    const activityExpiryTimersRef = useRef(new Map<string, number>())
    const presenceRetryTimerRef = useRef<number | null>(null)
    const [document, setDocument] = useState(initial)
    const [syncState, setSyncState] = useState<BuilderSyncState>("synced")
    const [realtimeState, setRealtimeState] = useState<BuilderRealtimeState>("connecting")
    const [realtimeError, setRealtimeError] = useState<string | null>(null)
    const [serverVersion, setServerVersion] = useState(collaboration.version)
    const serverVersionRef = useRef(collaboration.version)
    const [presenceMembers, setPresenceMembers] = useState<BuilderPresence[]>([])
    const [remoteActivity, setRemoteActivity] = useState<Record<string, BuilderCollaboratorActivity>>({})
    const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false })
    const presence = useMemo(() => presenceMembers.map((person) => {
        const activity = remoteActivity[person.clientId]
        return activity?.userId === person.userId ? { ...person, selection: activity.selection, cursor: activity.cursor } : person
    }), [presenceMembers, remoteActivity])

    const persistNextBatch = useCallback(async () => {
        const retry = retryUpdateRef.current
        const updates = retry ? [] : pendingUpdatesRef.current.splice(0)
        if (!retry && !updates.length) return serverVersionRef.current
        const batch = retry ?? {
            update: Y.mergeUpdates(updates),
            definitionIds: [...pendingDefinitionIdsRef.current],
            updateId: `${clientIdRef.current}:${++updateCounterRef.current}`,
        }
        if (!retry) pendingDefinitionIdsRef.current.clear()
        setSyncState("syncing")
        const outcome = await persistBuilderUpdate(window.fetch, workspaceSlug, {
            updateId: batch.updateId,
            updateBase64: uint8ToBase64(batch.update),
            definitionIds: batch.definitionIds,
        }).catch(() => ({ ok: false as const, error: "The Builder could not reach the server." }))
        if (!outcome.ok) {
            retryUpdateRef.current = batch
            setSyncState(navigator.onLine ? "error" : "offline")
            return serverVersionRef.current
        }
        retryUpdateRef.current = null
        const version = Number(outcome.data?.version ?? 0)
        serverVersionRef.current = Math.max(serverVersionRef.current, version)
        setServerVersion((current) => Math.max(current, version))
        await channelRef.current?.send({
            type: "broadcast",
            event: "document-update",
            payload: { update: uint8ToBase64(batch.update), sequence: outcome.data?.sequence, version, sender: clientIdRef.current },
        }).catch(() => "error")
        setSyncState("synced")
        return serverVersionRef.current
    }, [workspaceSlug])

    const flush = useCallback(async () => {
        if (flushingRef.current) return flushingRef.current
        const pump = async () => {
            let version = serverVersionRef.current
            do {
                version = await persistNextBatch()
            } while (!retryUpdateRef.current && pendingUpdatesRef.current.length > 0)
            return version
        }
        const pending = pump().finally(() => { flushingRef.current = null })
        flushingRef.current = pending
        return pending
    }, [persistNextBatch])

    const refreshFromServer = useCallback(async () => {
        if (refreshingRef.current) return refreshingRef.current
        const refresh = (async () => {
            const outcome = await refreshBuilderUpdates(window.fetch, workspaceSlug, lastSequenceRef.current).catch(() => ({ ok: false as const, error: "The Builder could not reach the server." }))
            if (!outcome.ok || !docRef.current) return false
            if (outcome.data?.snapshotBase64) {
                Y.applyUpdate(docRef.current, base64ToUint8(outcome.data.snapshotBase64), "remote")
                lastSequenceRef.current = Math.max(lastSequenceRef.current, outcome.data.snapshotSequence)
            }
            for (const update of outcome.data?.updates ?? []) {
                Y.applyUpdate(docRef.current, base64ToUint8(update.updateBase64), "remote")
                lastSequenceRef.current = Math.max(lastSequenceRef.current, update.sequence)
            }
            const version = Number(outcome.data?.version ?? serverVersionRef.current)
            serverVersionRef.current = Math.max(serverVersionRef.current, version)
            setServerVersion(serverVersionRef.current)
            return true
        })().finally(() => { refreshingRef.current = null })
        refreshingRef.current = refresh
        return refresh
    }, [workspaceSlug])

    useEffect(() => {
        const activityExpiryTimers = activityExpiryTimersRef.current
        const ydoc = new Y.Doc()
        const root = ydoc.getMap("builder")
        docRef.current = ydoc
        rootRef.current = root
        if (collaboration.snapshotBase64) Y.applyUpdate(ydoc, base64ToUint8(collaboration.snapshotBase64), "bootstrap")
        for (const update of collaboration.updates) Y.applyUpdate(ydoc, base64ToUint8(update.updateBase64), "bootstrap")
        const initialWasEmpty = root.size === 0
        setDocument(readDocument(root, initialRef.current))
        const undoManager = new Y.UndoManager(root, { trackedOrigins: new Set([localOriginRef.current]), captureTimeout: 600 })
        undoManagerRef.current = undoManager
        const updateUndoState = () => setUndoState({ canUndo: undoManager.canUndo(), canRedo: undoManager.canRedo() })
        undoManager.on("stack-item-added", updateUndoState)
        undoManager.on("stack-item-popped", updateUndoState)
        const handleUpdate = (update: Uint8Array, origin: unknown) => {
            setDocument(readDocument(root, initialRef.current))
            updateUndoState()
            if (origin === "remote" || origin === "bootstrap") return
            pendingUpdatesRef.current.push(update)
            if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current)
            persistTimerRef.current = window.setTimeout(() => void flush(), 800)
        }
        ydoc.on("update", handleUpdate)
        if (initialWasEmpty) ydoc.transact(() => writeDocument(root, initialRef.current), "initialise")
        else {
            const persistedTheme = plain(root.get("theme")) as OnboardingThemeDefinition | undefined
            const initialTime = Date.parse(initialRef.current.theme.updatedAt ?? "")
            const persistedTime = Date.parse(persistedTheme?.updatedAt ?? "")
            if (Number.isFinite(initialTime) && (!Number.isFinite(persistedTime) || initialTime > persistedTime)) {
                ydoc.transact(() => {
                    const currentTheme = root.get("theme")
                    if (currentTheme instanceof Y.Map) reconcileMap(currentTheme, initialRef.current.theme as unknown as Record<string, unknown>)
                    else root.set("theme", toYValue(initialRef.current.theme))
                }, "settings-sync")
            }
        }

        const supabase = createSupabaseBrowserClient()
        const user = collaboration.currentUser
        let channel: ReturnType<typeof supabase.channel> | null = null
        let disposed = false
        let realtimeConnected = false
        let realtimeAccessToken: string | null = null

        const clearActivityExpiry = (clientId: string) => {
            const timer = activityExpiryTimers.get(clientId)
            if (timer) window.clearTimeout(timer)
            activityExpiryTimers.delete(clientId)
        }

        const receiveActivity = (activity: BuilderCollaboratorActivity) => {
            if (!activity.clientId || activity.clientId === clientIdRef.current || !activity.userId) return
            setRemoteActivity((current) => ({ ...current, [activity.clientId]: activity }))
            clearActivityExpiry(activity.clientId)
            if (!activity.cursor) return
            activityExpiryTimers.set(activity.clientId, window.setTimeout(() => {
                activityExpiryTimers.delete(activity.clientId)
                setRemoteActivity((current) => {
                    const existing = current[activity.clientId]
                    if (!existing?.cursor) return current
                    return { ...current, [activity.clientId]: { ...existing, cursor: null } }
                })
            }, 2_500))
        }

        const sendLocalActivity = () => {
            if (!channel || !localActivityRef.current) return
            void channel.send({
                type: "broadcast",
                event: "collaborator-activity",
                payload: localActivityRef.current,
            }).catch(() => "error")
        }

        const trackLocalPresence = async () => {
            if (!channel || !localPresenceRef.current || disposed) return
            const status = await channel.track(localPresenceRef.current).catch(() => "error" as const)
            if (disposed) return
            if (status === "ok") {
                realtimeConnected = true
                if (presenceRetryTimerRef.current) window.clearTimeout(presenceRetryTimerRef.current)
                presenceRetryTimerRef.current = null
                setRealtimeState("connected")
                setRealtimeError(null)
                sendLocalActivity()
                return
            }
            realtimeConnected = false
            setRealtimeState(navigator.onLine ? "reconnecting" : "unavailable")
            setRealtimeError("Live presence could not connect. Changes will continue saving in the background.")
            if (!presenceRetryTimerRef.current) {
                presenceRetryTimerRef.current = window.setTimeout(() => {
                    presenceRetryTimerRef.current = null
                    void trackLocalPresence()
                }, 8_000)
            }
        }

        const refreshRealtimeAuth = async () => {
            const sessionResult = await supabase.auth.getSession().catch(() => null)
            const accessToken = sessionResult?.data?.session?.access_token
            if (!accessToken || accessToken === realtimeAccessToken || disposed) return Boolean(accessToken)
            try {
                await supabase.realtime.setAuth(accessToken)
                realtimeAccessToken = accessToken
                return true
            } catch {
                if (!disposed) {
                    setRealtimeState("unavailable")
                    setRealtimeError("Live presence could not authenticate. Changes will continue saving in the background.")
                }
                return false
            }
        }

        async function connectRealtime() {
            setRealtimeState("connecting")
            setRealtimeError(null)
            const authenticated = await refreshRealtimeAuth()
            if (disposed) return
            if (!authenticated || !user) {
                setRealtimeState("unavailable")
                setRealtimeError("Live presence could not authenticate. Changes will continue saving in the background.")
                return
            }
            if (disposed) return
            channel = supabase.channel(`onboarding-builder:${workspaceSlug}`, {
                config: { private: true, broadcast: { self: false, ack: false }, presence: { key: clientIdRef.current } },
            })
            channelRef.current = channel
            channel
                .on("broadcast", { event: "document-update" }, ({ payload }) => {
                    if (!payload?.update || payload.sender === clientIdRef.current) return
                    Y.applyUpdate(ydoc, base64ToUint8(String(payload.update)), "remote")
                    const version = Number(payload.version) || serverVersionRef.current
                    serverVersionRef.current = Math.max(serverVersionRef.current, version)
                    setServerVersion(serverVersionRef.current)
                    void refreshFromServer()
                })
                .on("broadcast", { event: "release-lock" }, ({ payload }) => {
                    setSyncState(payload?.locked ? "publishing" : navigator.onLine ? "synced" : "offline")
                })
                .on("broadcast", { event: "collaborator-activity" }, ({ payload }) => {
                    if (!payload || typeof payload !== "object") return
                    receiveActivity({
                        clientId: String(payload.clientId ?? ""),
                        userId: String(payload.userId ?? ""),
                        selection: typeof payload.selection === "string" ? payload.selection : null,
                        cursor: payload.cursor && Number.isFinite(Number(payload.cursor.xRatio)) && Number.isFinite(Number(payload.cursor.yRatio))
                            ? { xRatio: Math.max(0, Math.min(1, Number(payload.cursor.xRatio))), yRatio: Math.max(0, Math.min(1, Number(payload.cursor.yRatio))) }
                            : null,
                    })
                })
                .on("presence", { event: "sync" }, () => {
                    if (!channel) return
                    const visible = visibleBuilderPresence(channel.presenceState<BuilderPresence>(), clientIdRef.current)
                    const activeClientIds = new Set(visible.map((person) => person.clientId))
                    setPresenceMembers(visible)
                    setRemoteActivity((current) => Object.fromEntries(Object.entries(current).filter(([clientId]) => activeClientIds.has(clientId))))
                    for (const clientId of activityExpiryTimers.keys()) if (!activeClientIds.has(clientId)) clearActivityExpiry(clientId)
                })
                .subscribe(async (status, error) => {
                    if (disposed || !channel) return
                    if (status === "SUBSCRIBED") {
                        localPresenceRef.current = { clientId: clientIdRef.current, userId: user.id, name: user.name, avatarSrc: user.avatarSrc, color: colourForUser(user.id), selection: null, cursor: null }
                        localActivityRef.current = { clientId: clientIdRef.current, userId: user.id, selection: null, cursor: null }
                        await Promise.all([trackLocalPresence(), refreshFromServer()])
                        if (initialWasEmpty) void flush()
                    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
                        realtimeConnected = false
                        setPresenceMembers([])
                        setRemoteActivity({})
                        for (const clientId of activityExpiryTimers.keys()) clearActivityExpiry(clientId)
                        setRealtimeState(navigator.onLine ? "reconnecting" : "unavailable")
                        setRealtimeError(error?.message ?? "Live presence disconnected. Changes will continue saving while it reconnects.")
                    }
                })
        }
        void connectRealtime()
        const connectionTimeout = window.setTimeout(() => {
            if (realtimeConnected) return
            setRealtimeState("unavailable")
            setRealtimeError((message) => message ?? "Live presence is taking too long to connect. Changes will continue saving in the background.")
        }, 8_000)
        const refreshTimer = window.setInterval(() => {
            if (!navigator.onLine) return
            void refreshFromServer()
        }, 4_000)
        const authRefreshTimer = window.setInterval(() => {
            if (!navigator.onLine) return
            void refreshRealtimeAuth()
        }, 60_000)
        const updateOnlineState = () => {
            if (!navigator.onLine) {
                realtimeConnected = false
                setSyncState("offline")
                setRealtimeState("unavailable")
                setRealtimeError("Offline — changes will save when the connection returns.")
                setPresenceMembers([])
                setRemoteActivity({})
                return
            }
            setSyncState("syncing")
            setRealtimeState("reconnecting")
            void flush().then(() => setSyncState("synced"))
            void refreshFromServer()
            void refreshRealtimeAuth().then((authenticated) => {
                if (authenticated) void trackLocalPresence()
            })
        }
        window.addEventListener("online", updateOnlineState)
        window.addEventListener("offline", updateOnlineState)
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (!pendingUpdatesRef.current.length && !retryUpdateRef.current) return
            event.preventDefault()
        }
        window.addEventListener("beforeunload", beforeUnload)
        return () => {
            disposed = true
            if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current)
            if (activityTimerRef.current) window.clearTimeout(activityTimerRef.current)
            if (presenceRetryTimerRef.current) window.clearTimeout(presenceRetryTimerRef.current)
            for (const timer of activityExpiryTimers.values()) window.clearTimeout(timer)
            activityExpiryTimers.clear()
            window.clearTimeout(connectionTimeout)
            window.clearInterval(refreshTimer)
            window.clearInterval(authRefreshTimer)
            void flush()
            window.removeEventListener("online", updateOnlineState)
            window.removeEventListener("offline", updateOnlineState)
            window.removeEventListener("beforeunload", beforeUnload)
            if (channel) void supabase.removeChannel(channel)
            channelRef.current = null
            undoManager.destroy()
            undoManagerRef.current = null
            ydoc.destroy()
        }
    }, [collaboration, flush, refreshFromServer, workspaceSlug])

    const updateDocument = useCallback((recipe: (current: VisualBuilderDocument) => VisualBuilderDocument) => {
        if (!rootRef.current || !docRef.current || !navigator.onLine || !["synced", "syncing"].includes(syncState)) return
        const current = readDocument(rootRef.current, initialRef.current)
        let next = recipe(current)
        if (JSON.stringify(current.theme) !== JSON.stringify(next.theme)) next = { ...next, theme: { ...next.theme, updatedAt: new Date().toISOString() } }
        changedDefinitions(current, next).forEach((id) => pendingDefinitionIdsRef.current.add(id))
        docRef.current.transact(() => writeDocument(rootRef.current!, next), localOriginRef.current)
    }, [syncState])

    const updateActivity = useCallback((update: Partial<Pick<BuilderPresence, "selection" | "cursor">>) => {
        const user = collaboration.currentUser
        if (!user || realtimeState !== "connected") return
        localActivityRef.current = { clientId: clientIdRef.current, userId: user.id, selection: null, cursor: null, ...localActivityRef.current, ...update }
        if (activityTimerRef.current) return
        activityTimerRef.current = window.setTimeout(() => {
            activityTimerRef.current = null
            if (!localActivityRef.current || !channelRef.current) return
            void channelRef.current.send({
                type: "broadcast",
                event: "collaborator-activity",
                payload: localActivityRef.current,
            }).catch(() => "error")
        }, 80)
    }, [collaboration.currentUser, realtimeState])

    return {
        document,
        updateDocument,
        syncState,
        setSyncState,
        realtimeState,
        realtimeError,
        serverVersion,
        presence,
        editable: ["synced", "syncing"].includes(syncState),
        updateActivity,
        setReleaseLock: async (locked: boolean) => {
            setSyncState(locked ? "publishing" : navigator.onLine ? "synced" : "offline")
            await channelRef.current?.send({ type: "broadcast", event: "release-lock", payload: { locked, sender: clientIdRef.current } })
        },
        undoState,
        undo: () => undoManagerRef.current?.undo(),
        redo: () => undoManagerRef.current?.redo(),
        flush,
    }
}
