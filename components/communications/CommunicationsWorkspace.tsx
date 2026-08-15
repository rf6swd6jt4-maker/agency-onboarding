"use client"

import Link from "next/link"
import Image from "next/image"
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Avatar } from "@/components/account/Avatar"
import type { CommunicationAttachment, CommunicationMessage, CommunicationReadCursor, CommunicationsBootstrap } from "@/lib/communications/types"
import { communicationAttachmentFromRawPayload } from "@/lib/communications/attachments"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"
import { formatRelativeTime } from "@/lib/ui/relative-time"
import { WORKSPACE_TAB_FRAME_PARAM, WORKSPACE_TAB_MESSAGE_SOURCE, type WorkspaceTabFrameMessage } from "@/lib/workspace-tabs"

type RealtimeState = "connecting" | "live" | "offline"
type Presence = { clientId: string; userId: string; name: string; avatarSrc: string | null; conversationId: string | null }

function record(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : null
}

function realtimeMessage(value: unknown): CommunicationMessage | null {
    const row = record(value)
    const id = stringValue(row.id)
    const relationshipId = stringValue(row.relationship_id)
    const body = stringValue(row.body)
    const createdAt = stringValue(row.created_at)
    const direction = row.direction === "inbound" ? "inbound" : row.direction === "outbound" ? "outbound" : null
    if (!id || !relationshipId || body === null || !createdAt || !direction) return null
    const raw = record(row.raw_payload)
    const senderKind = row.sender_kind === "client" || row.sender_kind === "staff" || row.sender_kind === "automation" || row.sender_kind === "legacy"
        ? row.sender_kind
        : direction === "inbound" ? "client" : raw.outbox_id || raw.template_name || raw.onboarding_url ? "automation" : "legacy"
    return {
        id,
        clientRequestId: stringValue(row.client_request_id),
        relationshipId,
        body,
        direction,
        provider: stringValue(row.provider) ?? "meta_whatsapp",
        status: stringValue(row.status) ?? (direction === "inbound" ? "received" : "sent"),
        error: stringValue(row.error),
        senderKind,
        senderUserId: stringValue(row.sender_user_id),
        automationKind: stringValue(row.automation_kind) ?? stringValue(raw.kind),
        automationLabel: stringValue(row.automation_label) ?? (raw.template_name ? "Consent request" : raw.outbox_id || raw.onboarding_url ? "Onboarding link" : null),
        attachment: communicationAttachmentFromRawPayload(row.raw_payload),
        providerMessageId: stringValue(row.whatsapp_message_id) ?? stringValue(row.provider_message_id),
        replyToProviderMessageId: stringValue(row.reply_to_whatsapp_message_id),
        createdAt,
        sentAt: stringValue(row.sent_at),
        deliveredAt: stringValue(row.delivered_at),
        readAt: stringValue(row.read_at),
        failedAt: stringValue(row.failed_at),
    }
}

function mergeMessages(current: CommunicationMessage[], incoming: CommunicationMessage[]) {
    const byKey = new Map<string, CommunicationMessage>()
    for (const message of [...current, ...incoming]) {
        const requestKey = message.clientRequestId ? `request:${message.clientRequestId}` : `id:${message.id}`
        const existing = byKey.get(requestKey)
        byKey.set(requestKey, existing ? { ...existing, ...message } : message)
    }
    return [...byKey.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

function initials(value: string) {
    return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?"
}

function messageTime(value: string) {
    return new Intl.DateTimeFormat("en-IE", { hour: "2-digit", minute: "2-digit" }).format(new Date(value))
}

function messageDay(value: string) {
    return new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value))
}

function sameDay(left: string, right: string) {
    return new Date(left).toDateString() === new Date(right).toDateString()
}

function MessageBody({ body }: { body: string }) {
    const parts = body.split(/(https?:\/\/[^\s)]+)/g)
    return <p className="whitespace-pre-wrap break-words leading-5">{parts.map((part, index) => /^https?:\/\//.test(part)
        ? <a key={`${part}:${index}`} href={part} target="_blank" rel="noreferrer" className="underline decoration-current/40 underline-offset-2 hover:decoration-current">{part}</a>
        : <Fragment key={index}>{part}</Fragment>)}</p>
}

function DeliveryTicks({ message }: { message: CommunicationMessage }) {
    const status = message.status.toLowerCase()
    if (status === "sending" || status.includes("queued") || status.includes("pending")) return <span title="Sending" aria-label="Sending">◷</span>
    if (status === "send_failed" || status === "delivery_failed" || status.includes("error")) return <span className="text-red-500" title={message.error ?? "Message failed"} aria-label="Message failed">!</span>
    if (status === "send_uncertain") return <span className="text-amber-600" title="Delivery is being confirmed. Betelgeze will not resend automatically." aria-label="Delivery confirmation pending">?</span>
    if (message.readAt || status.includes("read")) return <span className="font-bold text-sky-600" title="Read in WhatsApp" aria-label="Read in WhatsApp">✓✓</span>
    if (message.deliveredAt || status.includes("delivered")) return <span className="font-bold" title="Delivered to WhatsApp" aria-label="Delivered to WhatsApp">✓✓</span>
    return <span className="font-bold" title="Sent to WhatsApp" aria-label="Sent to WhatsApp">✓</span>
}

function SearchIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
}

function BackIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="m15 6-6 6 6 6" /></svg>
}

function SendIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="m4 4 17 8-17 8 3-8-3-8Z" /><path d="M7 12h14" /></svg>
}

function AttachmentIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="m8.5 12.5 6.8-6.8a3 3 0 0 1 4.2 4.2l-9.2 9.2a5 5 0 0 1-7.1-7.1l9-9" /></svg>
}

function formatFileSize(size: number | null) {
    if (!size) return "Attachment"
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))}KB`
    return `${(size / 1024 / 1024).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)}MB`
}

function attachmentPlaceholder(attachment: CommunicationAttachment) {
    return `[${attachment.kind[0].toUpperCase()}${attachment.kind.slice(1)}] ${attachment.fileName}`
}

function messagePreview(message: CommunicationMessage) {
    if (message.attachment) return `${message.attachment.kind === "image" ? "Image" : message.attachment.kind === "video" ? "Video" : "File"}: ${message.attachment.fileName}`
    return message.body || "Message"
}

function MessageAttachment({ attachment }: { attachment: CommunicationAttachment }) {
    if (attachment.kind === "image") {
        return <a href={attachment.url} target="_blank" rel="noreferrer" className="mb-2 block overflow-hidden rounded-xl bg-black/10"><Image unoptimized src={attachment.url} alt={attachment.fileName} width={800} height={600} className="max-h-80 h-auto w-full object-contain" /></a>
    }
    if (attachment.kind === "video") {
        return <video src={attachment.url} controls preload="metadata" className="mb-2 max-h-80 w-full rounded-xl bg-black" />
    }
    return <a href={attachment.url} target="_blank" rel="noreferrer" className="mb-2 flex items-center gap-3 rounded-xl border border-current/10 bg-black/5 px-3 py-2.5 hover:bg-black/10"><span className="text-xl">↗</span><span className="min-w-0"><span className="block truncate text-xs font-semibold">{attachment.fileName}</span><span className="mt-0.5 block text-[10px] opacity-60">{formatFileSize(attachment.size)}</span></span></a>
}

function mergeCursor(current: CommunicationReadCursor[], incoming: CommunicationReadCursor) {
    return [...current.filter((cursor) => !(cursor.relationshipId === incoming.relationshipId && cursor.userId === incoming.userId)), incoming]
}

export function CommunicationsWorkspace({ bootstrap }: { bootstrap: CommunicationsBootstrap }) {
    const supabase = useMemo(() => createSupabaseBrowserClient(), [])
    const [conversations, setConversations] = useState(bootstrap.conversations)
    const [selectedId, setSelectedId] = useState(bootstrap.selectedConversationId)
    const [search, setSearch] = useState("")
    const [draft, setDraft] = useState("")
    const [attachment, setAttachment] = useState<CommunicationAttachment | null>(null)
    const [attachmentState, setAttachmentState] = useState<"idle" | "uploading">("idle")
    const [attachmentError, setAttachmentError] = useState<string | null>(null)
    const [replyingTo, setReplyingTo] = useState<CommunicationMessage | null>(null)
    const [actionMessageId, setActionMessageId] = useState<string | null>(null)
    const [readCursors, setReadCursors] = useState(bootstrap.readCursors)
    const [presence, setPresence] = useState<Presence[]>([])
    const [realtimeState, setRealtimeState] = useState<RealtimeState>("connecting")
    const messagePaneRef = useRef<HTMLDivElement | null>(null)
    const searchRef = useRef<HTMLInputElement | null>(null)
    const attachmentInputRef = useRef<HTMLInputElement | null>(null)
    const composerRef = useRef<HTMLTextAreaElement | null>(null)
    const attachmentRef = useRef<CommunicationAttachment | null>(null)
    const swipeStartRef = useRef<{ id: string; x: number; y: number } | null>(null)
    const swipedMessageRef = useRef<string | null>(null)
    const selectedRef = useRef(selectedId)
    const clientIdRef = useRef(crypto.randomUUID())
    const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
    const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null

    useEffect(() => {
        selectedRef.current = selectedId
    }, [selectedId])

    useEffect(() => {
        attachmentRef.current = attachment
    }, [attachment])

    const updateConversationMessages = useCallback((relationshipId: string, incoming: CommunicationMessage[]) => {
        setConversations((current) => current.map((conversation) => conversation.id === relationshipId
            ? { ...conversation, messages: mergeMessages(conversation.messages, incoming) }
            : conversation).sort((left, right) => (right.messages.at(-1)?.createdAt ?? "").localeCompare(left.messages.at(-1)?.createdAt ?? "") || left.title.localeCompare(right.title)))
    }, [])

    const syncConversationUrl = useCallback((conversationId: string | null) => {
        const url = new URL(window.location.href)
        if (conversationId) url.searchParams.set("conversation", conversationId)
        else url.searchParams.delete("conversation")
        const frameId = url.searchParams.get(WORKSPACE_TAB_FRAME_PARAM)
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
        if (frameId && window.parent !== window) {
            const shellUrl = new URL(url)
            shellUrl.searchParams.delete(WORKSPACE_TAB_FRAME_PARAM)
            const message: WorkspaceTabFrameMessage = { source: WORKSPACE_TAB_MESSAGE_SOURCE, target: "host", tabId: frameId, type: "location-replace", url: `${shellUrl.pathname}${shellUrl.search}${shellUrl.hash}` }
            window.parent.postMessage(message, window.location.origin)
        }
    }, [])

    const selectConversation = useCallback((conversationId: string | null) => {
        const pendingAttachment = attachmentRef.current
        const previousRelationshipId = selectedRef.current
        if (pendingAttachment && previousRelationshipId) {
            void fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/attachments`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ relationshipId: previousRelationshipId, storagePath: pendingAttachment.storagePath }),
            }).catch(() => undefined)
        }
        setSelectedId(conversationId)
        setAttachment(null)
        setAttachmentError(null)
        setReplyingTo(null)
        setActionMessageId(null)
        setDraft(conversationId ? localStorage.getItem(`betelgeze:communications:draft:${bootstrap.workspaceId}:${conversationId}`) ?? "" : "")
        syncConversationUrl(conversationId)
    }, [bootstrap.workspaceId, bootstrap.workspaceSlug, syncConversationUrl])

    function beginReply(message: CommunicationMessage) {
        if (!message.providerMessageId) return
        setReplyingTo(message)
        setActionMessageId(null)
        window.requestAnimationFrame(() => composerRef.current?.focus())
    }

    async function removeAttachment(target = attachment, relationshipId = selectedId) {
        setAttachment(null)
        setAttachmentError(null)
        if (!target || !relationshipId) return
        await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/attachments`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ relationshipId, storagePath: target.storagePath }),
        }).catch(() => undefined)
    }

    async function uploadAttachment(file: File) {
        if (!selected || attachmentState === "uploading") return
        const relationshipId = selected.id
        if (attachment) await removeAttachment(attachment, relationshipId)
        setAttachmentState("uploading")
        setAttachmentError(null)
        try {
            const prepareResponse = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/attachments`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ relationshipId, name: file.name, size: file.size, type: file.type }),
            })
            const prepared = await prepareResponse.json().catch(() => null) as { uploadUrl?: string; attachment?: CommunicationAttachment; error?: string } | null
            if (!prepareResponse.ok || !prepared?.uploadUrl || !prepared.attachment) throw new Error(prepared?.error ?? "Could not prepare attachment.")
            const uploadResponse = await fetch(prepared.uploadUrl, {
                method: "PUT",
                headers: { "Content-Type": prepared.attachment.mimeType },
                body: file,
            })
            if (!uploadResponse.ok) throw new Error("Could not upload attachment.")
            if (selectedRef.current !== relationshipId) {
                await removeAttachment(prepared.attachment, relationshipId)
                return
            }
            setAttachment(prepared.attachment)
        } catch (error) {
            setAttachmentError(error instanceof Error ? error.message : "Could not upload attachment.")
        } finally {
            setAttachmentState("idle")
            if (attachmentInputRef.current) attachmentInputRef.current.value = ""
        }
    }

    useEffect(() => {
        const key = selectedId ? `betelgeze:communications:draft:${bootstrap.workspaceId}:${selectedId}` : null
        const timer = window.setTimeout(() => setDraft(key ? localStorage.getItem(key) ?? "" : ""), 0)
        return () => window.clearTimeout(timer)
    }, [bootstrap.workspaceId, selectedId])

    useEffect(() => {
        if (!selectedId) return
        localStorage.setItem(`betelgeze:communications:draft:${bootstrap.workspaceId}:${selectedId}`, draft)
    }, [bootstrap.workspaceId, draft, selectedId])

    useEffect(() => {
        if (!selectedId) return
        const controller = new AbortController()
        void fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/messages?relationshipId=${encodeURIComponent(selectedId)}`, { signal: controller.signal })
            .then(async (response) => response.ok ? response.json() as Promise<{ messages?: CommunicationMessage[] }> : null)
            .then((result) => { if (result?.messages) updateConversationMessages(selectedId, result.messages) })
            .catch(() => undefined)
        return () => controller.abort()
    }, [bootstrap.workspaceSlug, selectedId, updateConversationMessages])

    useEffect(() => {
        if (!selectedId || !selected?.messages.length || !bootstrap.schemaReady) return
        const latest = selected.messages.at(-1)!
        const cursor: CommunicationReadCursor = { relationshipId: selectedId, userId: bootstrap.currentUser.id, lastReadMessageId: latest.id, lastReadAt: new Date().toISOString() }
        const timer = window.setTimeout(() => {
            setReadCursors((current) => mergeCursor(current, cursor))
            void fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/read`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relationshipId: selectedId, messageId: latest.id }) }).catch(() => undefined)
        }, 250)
        return () => window.clearTimeout(timer)
    }, [bootstrap.currentUser.id, bootstrap.schemaReady, bootstrap.workspaceSlug, selected?.messages, selectedId])

    useEffect(() => {
        if (!selectedId) return
        window.requestAnimationFrame(() => messagePaneRef.current?.scrollTo({ top: messagePaneRef.current.scrollHeight }))
    }, [selected?.messages.length, selectedId])

    useEffect(() => {
        let disposed = false
        let channel: ReturnType<typeof supabase.channel> | null = null
        async function connect() {
            const session = await supabase.auth.getSession()
            const accessToken = session.data.session?.access_token
            if (!accessToken || disposed) { setRealtimeState("offline"); return }
            await supabase.realtime.setAuth(accessToken)
            if (disposed) return
            channel = supabase.channel(`communications:${bootstrap.workspaceSlug}`, { config: { private: true, presence: { key: clientIdRef.current } } })
            channelRef.current = channel
            channel
                .on("postgres_changes", { event: "*", schema: "public", table: "client_messages", filter: `workspace_id=eq.${bootstrap.workspaceId}` }, (payload) => {
                    const message = realtimeMessage(payload.new)
                    if (message) updateConversationMessages(message.relationshipId, [message])
                })
                .on("postgres_changes", { event: "*", schema: "public", table: "communication_read_cursors", filter: `workspace_id=eq.${bootstrap.workspaceId}` }, (payload) => {
                    const row = record(payload.new)
                    const relationshipId = stringValue(row.relationship_id)
                    const userId = stringValue(row.user_id)
                    const lastReadAt = stringValue(row.last_read_at)
                    if (relationshipId && userId && lastReadAt) setReadCursors((current) => mergeCursor(current, { relationshipId, userId, lastReadMessageId: stringValue(row.last_read_message_id), lastReadAt }))
                })
                .on("presence", { event: "sync" }, () => {
                    if (!channel) return
                    const next = Object.values(channel.presenceState<Presence>()).flatMap((entries) => entries).filter((entry) => entry.clientId && entry.userId)
                    setPresence(next)
                })
                .subscribe(async (status) => {
                    if (!channel || disposed) return
                    if (status === "SUBSCRIBED") {
                        setRealtimeState("live")
                        await channel.track({ clientId: clientIdRef.current, userId: bootstrap.currentUser.id, name: bootstrap.currentUser.name, avatarSrc: bootstrap.currentUser.avatarSrc, conversationId: selectedRef.current })
                    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setRealtimeState("offline")
                })
        }
        void connect().catch(() => setRealtimeState("offline"))
        return () => { disposed = true; channelRef.current = null; if (channel) void supabase.removeChannel(channel) }
    }, [bootstrap.currentUser, bootstrap.workspaceId, bootstrap.workspaceSlug, supabase, updateConversationMessages])

    useEffect(() => {
        const channel = channelRef.current
        if (channel && realtimeState === "live") void channel.track({ clientId: clientIdRef.current, userId: bootstrap.currentUser.id, name: bootstrap.currentUser.name, avatarSrc: bootstrap.currentUser.avatarSrc, conversationId: selectedId })
    }, [bootstrap.currentUser, realtimeState, selectedId])

    async function sendMessage(messageToRetry?: CommunicationMessage) {
        if (!selected || !bootstrap.schemaReady || !selected.canSend) return
        const messageAttachment = messageToRetry?.attachment ?? attachment
        const replyTarget = messageToRetry ? null : replyingTo
        const typedBody = messageToRetry ? (messageToRetry.attachment && messageToRetry.body === attachmentPlaceholder(messageToRetry.attachment) ? "" : messageToRetry.body) : draft.trim()
        if (!typedBody && !messageAttachment) return
        const body = typedBody || (messageAttachment ? attachmentPlaceholder(messageAttachment) : "")
        const clientRequestId = messageToRetry?.clientRequestId ?? crypto.randomUUID()
        const optimistic: CommunicationMessage = messageToRetry ? { ...messageToRetry, status: "sending", error: null, failedAt: null } : {
            id: clientRequestId,
            clientRequestId,
            relationshipId: selected.id,
            body,
            direction: "outbound",
            provider: "meta_whatsapp",
            status: "sending",
            error: null,
            senderKind: "staff",
            senderUserId: bootstrap.currentUser.id,
            automationKind: null,
            automationLabel: null,
            attachment: messageAttachment,
            providerMessageId: null,
            replyToProviderMessageId: replyTarget?.providerMessageId ?? null,
            createdAt: new Date().toISOString(),
            sentAt: null,
            deliveredAt: null,
            readAt: null,
            failedAt: null,
        }
        updateConversationMessages(selected.id, [optimistic])
        if (!messageToRetry) {
            setDraft("")
            setAttachment(null)
            setReplyingTo(null)
            localStorage.removeItem(`betelgeze:communications:draft:${bootstrap.workspaceId}:${selected.id}`)
        }
        const response = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relationshipId: selected.id, body: typedBody, attachment: messageAttachment, replyToMessageId: replyTarget?.id, clientRequestId, retry: Boolean(messageToRetry) }) }).catch(() => null)
        if (!response) {
            updateConversationMessages(selected.id, [{ ...optimistic, status: "send_uncertain", error: "Delivery is being confirmed." }])
            return
        }
        const result = await response.json().catch(() => null) as { message?: CommunicationMessage; error?: string; retryable?: boolean } | null
        if (result?.message) updateConversationMessages(selected.id, [result.message])
        else if (!response.ok) updateConversationMessages(selected.id, [{ ...optimistic, status: result?.retryable ? "send_failed" : "send_uncertain", error: result?.error ?? "Could not send message", failedAt: result?.retryable ? new Date().toISOString() : null }])
    }

    const connectedUserIds = new Set([bootstrap.currentUser.id, ...presence.map((person) => person.userId)])
    const normalizedSearch = search.trim().toLowerCase()
    const visibleConversations = conversations.filter((conversation) => !normalizedSearch || `${conversation.title} ${conversation.subtitle ?? ""} ${conversation.messages.at(-1)?.body ?? ""}`.toLowerCase().includes(normalizedSearch))
    const peopleById = new Map(bootstrap.people.map((person) => [person.id, person]))
    const senderName = (message: CommunicationMessage) => message.senderKind === "automation"
        ? message.automationLabel ?? "Automation"
        : message.senderKind === "staff"
            ? (message.senderUserId === bootstrap.currentUser.id ? "You" : peopleById.get(message.senderUserId ?? "")?.name ?? "Team")
            : message.senderKind === "legacy" ? "Previous system" : selected?.title ?? "Client"

    return <section aria-label="Client communications" className="flex h-dvh min-h-0 flex-col overflow-hidden bg-black">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-3 sm:px-4">
            <div className="min-w-0"><h1 className="truncate text-sm font-semibold">Communications</h1><p className="hidden truncate text-[11px] text-neutral-600 sm:block">{bootstrap.workspaceName}</p></div>
            <button type="button" onClick={() => searchRef.current?.focus()} aria-label="Search client chats" className="ml-1 inline-flex h-9 w-9 items-center justify-center text-neutral-500 hover:text-white"><SearchIcon /></button>
            <div className="ml-auto flex items-center gap-3">
                <div aria-label="Team presence" className="flex -space-x-1.5">{bootstrap.people.map((person) => <span key={person.id} title={`${person.name} — ${connectedUserIds.has(person.id) ? "Connected" : "Disconnected"}`} className="h-7 w-7 overflow-hidden rounded-full border-2 border-neutral-950 bg-neutral-900"><span className={`block h-full w-full ${connectedUserIds.has(person.id) ? "" : "grayscale opacity-35"}`}><Avatar src={person.avatarSrc} name={person.name} className="h-full w-full" /></span></span>)}</div>
                <span className={`hidden items-center gap-1.5 text-[11px] sm:flex ${realtimeState === "live" ? "text-emerald-500" : "text-neutral-600"}`}><span className={`h-1.5 w-1.5 rounded-full ${realtimeState === "live" ? "bg-emerald-500" : realtimeState === "connecting" ? "bg-amber-500" : "bg-neutral-700"}`} />{realtimeState === "live" ? "Live" : realtimeState === "connecting" ? "Connecting" : "Offline"}</span>
            </div>
        </header>

        {!bootstrap.schemaReady ? <div className="shrink-0 border-b border-amber-900 bg-amber-950 px-4 py-2 text-center text-xs text-amber-100">The Communications database update must be applied before live sending and read tracking are available.</div> : null}

        <div className="grid min-h-0 flex-1 lg:grid-cols-[22rem_minmax(0,1fr)]">
            <aside className={`${selected ? "hidden lg:flex" : "flex"} min-h-0 flex-col border-r border-neutral-800 bg-neutral-950`}>
                <div className="shrink-0 border-b border-neutral-800 p-3">
                    <div className="flex items-center justify-between px-1"><h2 className="text-sm font-semibold">Client chats</h2><span className="text-[11px] text-neutral-600">{visibleConversations.length}</span></div>
                    <label className="relative mt-3 block"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600"><SearchIcon /></span><input ref={searchRef} type="search" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search conversations" placeholder="Search conversations" className="h-10 w-full rounded-lg border border-neutral-800 bg-black pl-9 pr-3 text-sm outline-none placeholder:text-neutral-600 focus:border-neutral-600" /></label>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{visibleConversations.length ? visibleConversations.map((conversation) => {
                    const latest = conversation.messages.at(-1)
                    const ownCursor = readCursors.find((cursor) => cursor.relationshipId === conversation.id && cursor.userId === bootstrap.currentUser.id)
                    const cursorIndex = ownCursor?.lastReadMessageId ? conversation.messages.findIndex((message) => message.id === ownCursor.lastReadMessageId) : -1
                    const unread = conversation.messages.slice(cursorIndex + 1).filter((message) => message.direction === "inbound").length
                    return <button key={conversation.id} type="button" onClick={() => selectConversation(conversation.id)} aria-current={selectedId === conversation.id ? "page" : undefined} className={`grid w-full grid-cols-[2.75rem_minmax(0,1fr)] gap-3 border-b border-neutral-900 px-4 py-3.5 text-left transition ${selectedId === conversation.id ? "bg-neutral-900" : "hover:bg-black"}`}>
                        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-800 text-sm font-semibold text-neutral-200">{initials(conversation.title)}</span>
                        <span className="min-w-0"><span className="flex items-start justify-between gap-3"><span className="truncate text-sm font-semibold">{conversation.title}</span>{latest ? <time dateTime={latest.createdAt} className={`shrink-0 text-[11px] ${unread ? "text-emerald-400" : "text-neutral-600"}`}>{formatRelativeTime(latest.createdAt)}</time> : null}</span><span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-neutral-500">{latest?.direction === "outbound" ? <DeliveryTicks message={latest} /> : null}<span className="truncate">{latest?.body || "No messages yet"}</span>{unread ? <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-black">{unread}</span> : null}</span></span>
                    </button>
                }) : <div className="p-6 text-center"><p className="text-sm font-medium text-neutral-300">{conversations.length ? "No matching conversations" : "No clients yet"}</p><p className="mt-2 text-xs leading-5 text-neutral-600">{conversations.length ? "Try another name or message." : "Client relationships will appear here automatically."}</p></div>}</div>
            </aside>

            <div className={`${selected ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-col bg-black`}>
                {selected ? <>
                    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-3 sm:px-4">
                        <button type="button" onClick={() => selectConversation(null)} aria-label="Back to client chats" className="inline-flex h-10 w-10 items-center justify-center text-neutral-400 hover:text-white lg:hidden"><BackIcon /></button>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-xs font-semibold">{initials(selected.title)}</span>
                        <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{selected.title}</h2><p className="truncate text-[11px] text-neutral-600">{selected.subtitle ?? "WhatsApp client"}</p></div>
                        <Link href={`/${bootstrap.workspaceSlug}/relationships/${selected.id}`} className="text-xs text-neutral-500 hover:text-white">Relationship</Link>
                    </header>

                    <div ref={messagePaneRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[radial-gradient(circle_at_top,_rgba(38,38,38,0.5),_transparent_38%)] px-3 py-5 sm:px-6">
                        <div className="mx-auto flex max-w-3xl flex-col gap-2">{selected.messages.length ? selected.messages.map((message, index) => {
                            const showDay = index === 0 || !sameDay(selected.messages[index - 1].createdAt, message.createdAt)
                            const sender = senderName(message)
                            const repliedMessage = message.replyToProviderMessageId
                                ? selected.messages.find((candidate) => candidate.providerMessageId === message.replyToProviderMessageId) ?? null
                                : null
                            const readers = readCursors.filter((cursor) => cursor.relationshipId === selected.id && cursor.lastReadMessageId === message.id).flatMap((cursor) => peopleById.get(cursor.userId) ?? [])
                            return <Fragment key={message.id}>
                                {showDay ? <div className="my-3 flex justify-center"><time dateTime={message.createdAt} className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-[10px] text-neutral-500">{messageDay(message.createdAt)}</time></div> : null}
                                <div className={`flex items-center gap-2 ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                                    {message.direction === "outbound" && actionMessageId === message.id && message.providerMessageId ? <button type="button" onClick={() => beginReply(message)} className="rounded-full bg-neutral-900 px-3 py-1.5 text-[11px] font-semibold text-neutral-300 hover:text-white">↩ Reply</button> : null}
                                    <article
                                        role="button"
                                        tabIndex={0}
                                        aria-label={`Message from ${sender}. Activate for reply actions.`}
                                        onClick={() => {
                                            if (swipedMessageRef.current === message.id) { swipedMessageRef.current = null; return }
                                            setActionMessageId((current) => current === message.id ? null : message.id)
                                        }}
                                        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActionMessageId((current) => current === message.id ? null : message.id) } }}
                                        onTouchStart={(event) => { const touch = event.touches[0]; swipeStartRef.current = touch ? { id: message.id, x: touch.clientX, y: touch.clientY } : null }}
                                        onTouchEnd={(event) => {
                                            const start = swipeStartRef.current
                                            const touch = event.changedTouches[0]
                                            swipeStartRef.current = null
                                            if (start?.id === message.id && touch && touch.clientX - start.x > 54 && Math.abs(touch.clientY - start.y) < 42 && message.providerMessageId) {
                                                swipedMessageRef.current = message.id
                                                beginReply(message)
                                            }
                                        }}
                                        className={`max-w-[88%] cursor-pointer rounded-2xl px-3.5 py-2.5 text-sm shadow-sm outline-none ring-offset-2 ring-offset-black focus-visible:ring-2 focus-visible:ring-neutral-500 sm:max-w-[72%] ${message.direction === "outbound" ? "rounded-br-md bg-neutral-100 text-neutral-950" : "rounded-bl-md border border-neutral-800 bg-neutral-900 text-neutral-100"}`}
                                    >
                                        <p className={`mb-1 text-[10px] font-semibold ${message.direction === "outbound" ? "text-neutral-500" : "text-neutral-500"}`}>{sender}</p>
                                        {message.replyToProviderMessageId ? <div className={`mb-2 rounded-lg border-l-2 border-neutral-500 px-2.5 py-2 ${message.direction === "outbound" ? "bg-black/10" : "bg-black/35"}`}><p className="truncate text-[10px] font-semibold opacity-70">{repliedMessage ? senderName(repliedMessage) : "Replied message"}</p><p className="mt-0.5 truncate text-xs opacity-65">{repliedMessage ? messagePreview(repliedMessage) : "Message unavailable"}</p></div> : null}
                                        {message.attachment ? <MessageAttachment attachment={message.attachment} /> : null}
                                        {message.body && !(message.attachment && message.body === attachmentPlaceholder(message.attachment)) ? <MessageBody body={message.body} /> : null}
                                        <div className={`mt-1.5 flex items-center justify-end gap-1.5 text-[10px] ${message.direction === "outbound" ? "text-neutral-500" : "text-neutral-600"}`}><time dateTime={message.createdAt}>{messageTime(message.createdAt)}</time>{message.direction === "outbound" ? <DeliveryTicks message={message} /> : null}</div>
                                        {message.error ? <p className={`mt-1 text-[10px] ${message.status === "send_failed" || message.status === "delivery_failed" ? "text-red-600" : "text-amber-700"}`}>{message.error}</p> : null}
                                        {message.status === "send_failed" && message.clientRequestId ? <button type="button" onClick={() => void sendMessage(message)} className="mt-2 text-xs font-semibold underline underline-offset-2">Retry</button> : null}
                                    </article>
                                    {message.direction === "inbound" && actionMessageId === message.id && message.providerMessageId ? <button type="button" onClick={() => beginReply(message)} className="rounded-full bg-neutral-900 px-3 py-1.5 text-[11px] font-semibold text-neutral-300 hover:text-white">↩ Reply</button> : null}
                                </div>
                                {readers.length ? <div className={`flex -space-x-1 px-1 ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}>{readers.map((person) => <span key={person.id} title={`Read in Betelgeze by ${person.name}`} className="h-4 w-4 overflow-hidden rounded-full border border-black"><Avatar src={person.avatarSrc} name={person.name} className="h-full w-full" /></span>)}</div> : null}
                            </Fragment>
                        }) : <div className="flex min-h-64 items-center justify-center text-center"><div><p className="text-sm font-medium text-neutral-300">Start the conversation</p><p className="mt-2 text-xs text-neutral-600">Messages sent here arrive from the shared workspace WhatsApp number.</p></div></div>}</div>
                    </div>

                    <footer className="shrink-0 border-t border-neutral-800 bg-neutral-950 p-3 sm:p-4">
                        {replyingTo ? <div className="mx-auto mb-2 flex max-w-3xl items-center gap-3 rounded-xl border-l-2 border-neutral-500 bg-neutral-900 px-3 py-2 text-xs"><span className="min-w-0 flex-1"><span className="block truncate font-semibold text-neutral-300">Replying to {senderName(replyingTo)}</span><span className="mt-0.5 block truncate text-[11px] text-neutral-500">{messagePreview(replyingTo)}</span></span><button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancel reply" className="h-8 w-8 text-neutral-500 hover:text-white">×</button></div> : null}
                        {attachment || attachmentState === "uploading" || attachmentError ? <div className="mx-auto mb-2 flex max-w-3xl items-center gap-3 rounded-xl border border-neutral-800 bg-black px-3 py-2 text-xs"><span className="text-lg">{attachment?.kind === "image" ? "▧" : attachment?.kind === "video" ? "▶" : "↗"}</span><span className="min-w-0 flex-1"><span className="block truncate font-medium text-neutral-200">{attachmentState === "uploading" ? "Uploading attachment…" : attachment?.fileName ?? "Attachment failed"}</span><span className={`mt-0.5 block text-[10px] ${attachmentError ? "text-red-400" : "text-neutral-600"}`}>{attachmentError ?? formatFileSize(attachment?.size ?? null)}</span></span>{attachment ? <button type="button" onClick={() => void removeAttachment()} aria-label="Remove attachment" className="h-8 w-8 text-neutral-500 hover:text-white">×</button> : null}</div> : null}
                        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-neutral-800 bg-black px-3 py-2 focus-within:border-neutral-600">
                            <input ref={attachmentInputRef} type="file" accept="image/jpeg,image/png,video/mp4,video/3gpp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAttachment(file) }} />
                            <button type="button" onClick={() => attachmentInputRef.current?.click()} disabled={!bootstrap.schemaReady || !selected.canSend || attachmentState === "uploading"} aria-label="Attach image or file" className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-neutral-500 hover:text-white disabled:text-neutral-800"><AttachmentIcon /></button>
                            <textarea ref={composerRef} rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage() } }} disabled={!bootstrap.schemaReady || !selected.canSend} aria-label="Message client" placeholder={selected.canSend ? "Message on WhatsApp" : "Add a WhatsApp number to this relationship"} className="max-h-28 min-h-8 min-w-0 flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-neutral-600 disabled:cursor-not-allowed" />
                            <button type="button" onClick={() => void sendMessage()} disabled={(!draft.trim() && !attachment) || attachmentState === "uploading" || !bootstrap.schemaReady || !selected.canSend} aria-label="Send message" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black disabled:bg-neutral-800 disabled:text-neutral-600"><SendIcon /></button>
                        </div>
                        <p className="mx-auto mt-2 max-w-3xl text-center text-[10px] text-neutral-600">Enter to send · Shift+Enter for a new line</p>
                    </footer>
                </> : <div className="flex flex-1 items-center justify-center p-6 text-center"><div><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950 text-xl">◌</div><h2 className="mt-4 text-sm font-semibold">Select a client chat</h2><p className="mt-2 text-xs text-neutral-600">Messages update here without reloading the panel.</p></div></div>}
            </div>
        </div>
    </section>
}
