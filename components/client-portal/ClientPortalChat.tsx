"use client"

import Image from "next/image"
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"

import { MessageReactionActions, PrimaryMessageActions, copyMessageText, downloadMessageAttachment, type MessageActionView } from "@/components/communications/MessageActionMenu"
import { DeleteIcon, ReplyIcon } from "@/components/communications/MessageInteractionIcons"
import { MessageMediaLightbox, type MessageMediaPreview } from "@/components/communications/MessageMediaLightbox"
import { observeMessagePaneResize } from "@/components/communications/JumpToLatestButton"
import { keepComposerCurrentLineCentered } from "@/components/communications/composer-scroll"
import { useClientPortalComposerViewport } from "@/components/client-portal/client-portal-composer-viewport"

type PortalAttachment = {
    kind: "image" | "video" | "audio" | "document" | "sticker"
    fileName: string
    mimeType: string
    size: number | null
}

type PortalMessage = {
    id: string
    body: string
    direction: "inbound" | "outbound"
    senderKind: "client" | "staff" | "automation"
    automationLabel: string | null
    replyToMessageId: string | null
    source: "agency" | "external" | "portal" | "sms" | "whatsapp"
    reactions: PortalReaction[]
    attachment: PortalAttachment | null
    createdAt: string
    localRequestId?: string
    sendState?: "sending" | "failed"
    sendError?: string | null
}

type PortalReaction = {
    id: string
    direction: "inbound" | "outbound"
    emoji: string
    updatedAt: string
}

type MessagesResponse = {
    messages?: unknown
    nextBefore?: unknown
    message?: unknown
    error?: unknown
}

function record(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown) {
    return typeof value === "string" ? value : null
}

function attachmentFromValue(value: unknown): PortalAttachment | null {
    const source = record(value)
    const kind = source.kind
    const fileName = text(source.fileName)
    const mimeType = text(source.mimeType)
    if (!(kind === "image" || kind === "video" || kind === "audio" || kind === "document" || kind === "sticker") || !fileName || !mimeType) return null
    return {
        kind,
        fileName,
        mimeType,
        size: typeof source.size === "number" && Number.isFinite(source.size) && source.size >= 0 ? source.size : null,
    }
}

function reactionFromValue(value: unknown): PortalReaction | null {
    const source = record(value)
    const id = text(source.id)
    const direction = source.direction === "inbound" || source.direction === "outbound" ? source.direction : null
    const emoji = text(source.emoji)
    const updatedAt = text(source.updatedAt)
    if (!id || !direction || !emoji || !updatedAt || !Number.isFinite(Date.parse(updatedAt))) return null
    return { id, direction, emoji, updatedAt }
}

function messageFromValue(value: unknown): PortalMessage | null {
    const source = record(value)
    const id = text(source.id)
    const body = text(source.body)
    const createdAt = text(source.createdAt)
    const direction = source.direction === "inbound" || source.direction === "outbound" ? source.direction : null
    const senderKind = source.senderKind === "client" || source.senderKind === "staff" || source.senderKind === "automation" ? source.senderKind : null
    const messageSource = source.source === "agency" || source.source === "external" || source.source === "portal" || source.source === "sms" || source.source === "whatsapp" ? source.source : null
    if (!id || body === null || !createdAt || !direction || !senderKind || !messageSource || !Number.isFinite(Date.parse(createdAt))) return null
    return {
        id,
        body,
        direction,
        senderKind,
        automationLabel: text(source.automationLabel),
        replyToMessageId: text(source.replyToMessageId),
        source: messageSource,
        reactions: Array.isArray(source.reactions) ? source.reactions.flatMap((candidate) => reactionFromValue(candidate) ?? []) : [],
        attachment: attachmentFromValue(source.attachment),
        createdAt,
    }
}

function sortMessages(messages: PortalMessage[]) {
    return [...messages].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id))
}

function mergeMessages(current: PortalMessage[], incoming: PortalMessage[]) {
    const incomingIds = new Set(incoming.map((message) => message.id))
    const unmatchedIncoming = new Set(incoming.map((message) => message.id))
    const retained = current.filter((message) => {
        if (!message.id.startsWith("local:")) return !incomingIds.has(message.id)
        const match = incoming.find((candidate) => unmatchedIncoming.has(candidate.id)
            && candidate.direction === "inbound"
            && candidate.body === message.body
            && Math.abs(Date.parse(candidate.createdAt) - Date.parse(message.createdAt)) < 120_000)
        if (!match) return true
        unmatchedIncoming.delete(match.id)
        return false
    })
    return sortMessages([...retained, ...incoming])
}

function mergeLatestSnapshot(current: PortalMessage[], incoming: PortalMessage[]) {
    const local = current.filter((message) => message.id.startsWith("local:"))
    if (!incoming.length) return local
    const firstIncomingAt = Date.parse(incoming[0].createdAt)
    const older = current.filter((message) => !message.id.startsWith("local:") && Date.parse(message.createdAt) < firstIncomingAt)
    return mergeMessages([...older, ...local], incoming)
}

function dayKey(value: string) {
    const date = new Date(value)
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function dayLabel(value: string) {
    const date = new Date(value)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    if (dayKey(value) === dayKey(today.toISOString())) return "Today"
    if (dayKey(value) === dayKey(yesterday.toISOString())) return "Yesterday"
    return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" }).format(date)
}

function messageTime(value: string) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value))
}

function formatFileSize(value: number | null) {
    if (value === null) return "Shared file"
    if (value < 1024) return `${value} B`
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
    return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function attachmentPlaceholder(attachment: PortalAttachment) {
    return `[${attachment.kind[0].toUpperCase()}${attachment.kind.slice(1)}] ${attachment.fileName}`
}

function messagePreview(message: PortalMessage) {
    if (message.attachment) return `${message.attachment.kind === "image" ? "Image" : message.attachment.kind === "video" ? "Video" : message.attachment.kind === "audio" ? "Audio" : "File"}: ${message.attachment.fileName}`
    return message.body || "Message"
}

function SendIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m4 4 17 8-17 8 3-8-3-8Z" /><path d="M7 12h14" /></svg>
}

function FileIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-none stroke-current" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /></svg>
}

function MessageText({ body, own }: { body: string; own: boolean }) {
    const parts = body.split(/(https?:\/\/[^\s]+)/giu)
    return <p className="whitespace-pre-wrap break-words text-[15px] leading-6">{parts.map((part, index) => part.match(/^https?:\/\//iu)
        ? <a key={`${part}:${index}`} href={part} target="_blank" rel="noreferrer" className={`underline decoration-1 underline-offset-2 ${own ? "decoration-white/60" : "text-[var(--onboarding-primary,#1E3A5F)]"}`}>{part}</a>
        : <Fragment key={index}>{part}</Fragment>)}</p>
}

function MessageAttachment({ attachment, url, own, onOpenImage }: {
    attachment: PortalAttachment
    url: string
    own: boolean
    onOpenImage: (media: MessageMediaPreview) => void
}) {
    if (attachment.kind === "sticker") {
        return <button type="button" onClick={(event) => { event.stopPropagation(); onOpenImage({ url, alt: attachment.fileName }) }} className="block w-fit max-w-52 bg-transparent" aria-label={`Open ${attachment.fileName}`}>
            <Image unoptimized src={url} alt={attachment.fileName} width={512} height={512} className="h-auto max-h-48 w-auto max-w-52 object-contain drop-shadow-lg" />
        </button>
    }
    if (attachment.kind === "image") {
        return <button type="button" onClick={(event) => { event.stopPropagation(); onOpenImage({ url, alt: attachment.fileName }) }} className={`mb-2 block overflow-hidden rounded-xl ${own ? "bg-black/10" : "bg-black/5"}`} aria-label={`Open ${attachment.fileName}`}>
            <Image unoptimized src={url} alt={attachment.fileName} width={720} height={560} className="h-auto max-h-72 w-full object-cover" />
        </button>
    }
    if (attachment.kind === "video") {
        return <video controls playsInline preload="metadata" onClick={(event) => event.stopPropagation()} className="mb-2 max-h-72 w-full rounded-xl bg-black" aria-label={attachment.fileName}><source src={url} type={attachment.mimeType} /></video>
    }
    if (attachment.kind === "audio") {
        return <div onClick={(event) => event.stopPropagation()} className={`mb-2 rounded-xl p-2 ${own ? "bg-black/10" : "bg-black/5"}`}><audio controls preload="metadata" src={url} className="block h-10 w-full max-w-64" aria-label={attachment.fileName} /></div>
    }
    return <a href={url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className={`mb-2 flex items-center gap-3 rounded-xl border px-3 py-3 ${own ? "border-white/20 bg-white/10 text-white" : "border-black/10 bg-black/[0.03] text-[var(--onboarding-text,#0F172A)]"}`}>
        <span className="shrink-0"><FileIcon /></span>
        <span className="min-w-0"><span className="block truncate text-sm font-semibold">{attachment.fileName}</span><span className={`mt-0.5 block text-xs ${own ? "text-white/70" : "text-[var(--onboarding-muted,#475569)]"}`}>{formatFileSize(attachment.size)}</span></span>
    </a>
}

export function ClientPortalChat({ token, workspaceName }: { token: string; workspaceName: string }) {
    const apiPath = useMemo(() => `/api/client-portal/session/${encodeURIComponent(token)}/messages`, [token])
    const reactionsApiPath = useMemo(() => `/api/client-portal/session/${encodeURIComponent(token)}/reactions`, [token])
    const [messages, setMessages] = useState<PortalMessage[]>([])
    const [nextBefore, setNextBefore] = useState<string | null>(null)
    const [initialState, setInitialState] = useState<"loading" | "ready" | "error">("loading")
    const [loadingOlder, setLoadingOlder] = useState(false)
    const [draft, setDraft] = useState("")
    const [sendError, setSendError] = useState<string | null>(null)
    const [interactionError, setInteractionError] = useState<string | null>(null)
    const [replyingTo, setReplyingTo] = useState<PortalMessage | null>(null)
    const [actionMessageId, setActionMessageId] = useState<string | null>(null)
    const [actionView, setActionView] = useState<MessageActionView>("actions")
    const [recentReaction, setRecentReaction] = useState<string | null>(() => typeof window === "undefined" ? null : localStorage.getItem("betelgeze:client-portal:recent-reaction"))
    const [swipePosition, setSwipePosition] = useState<{ id: string; offset: number; active: boolean } | null>(null)
    const [previewMedia, setPreviewMedia] = useState<MessageMediaPreview | null>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const refreshingRef = useRef(false)
    const followingLatestRef = useRef(true)
    const scrollToLatestRef = useRef(true)
    const swipeStartRef = useRef<{ id: string; x: number; y: number; cancelled: boolean; maxDeltaX: number; minDeltaX: number; verticalAtMax: number; verticalAtMin: number } | null>(null)
    const swipedMessageRef = useRef<string | null>(null)
    const dismissedActionMessageRef = useRef<string | null>(null)
    useClientPortalComposerViewport(textareaRef)

    const refreshLatest = useCallback(async (initial = false) => {
        if (refreshingRef.current) return
        refreshingRef.current = true
        try {
            const response = await fetch(`${apiPath}?limit=100`, { cache: "no-store" })
            const result = await response.json().catch(() => null) as MessagesResponse | null
            if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "Messages are unavailable.")
            const incoming = Array.isArray(result?.messages) ? result.messages.flatMap((value) => messageFromValue(value) ?? []) : []
            if (initial || followingLatestRef.current) scrollToLatestRef.current = true
            setMessages((current) => initial ? mergeMessages(current, incoming) : mergeLatestSnapshot(current, incoming))
            if (initial) setNextBefore(typeof result?.nextBefore === "string" ? result.nextBefore : null)
            setInitialState("ready")
        } catch {
            if (initial) setInitialState("error")
        } finally {
            refreshingRef.current = false
        }
    }, [apiPath])

    useEffect(() => {
        const initialRefresh = window.setTimeout(() => { void refreshLatest(true) }, 0)
        const interval = window.setInterval(() => {
            if (document.visibilityState === "visible") void refreshLatest()
        }, 5_000)
        const refreshWhenActive = () => { if (document.visibilityState === "visible") void refreshLatest() }
        window.addEventListener("focus", refreshWhenActive)
        window.addEventListener("online", refreshWhenActive)
        document.addEventListener("visibilitychange", refreshWhenActive)
        return () => {
            window.clearTimeout(initialRefresh)
            window.clearInterval(interval)
            window.removeEventListener("focus", refreshWhenActive)
            window.removeEventListener("online", refreshWhenActive)
            document.removeEventListener("visibilitychange", refreshWhenActive)
        }
    }, [refreshLatest])

    useEffect(() => {
        if (!scrollToLatestRef.current) return
        scrollToLatestRef.current = false
        const frame = window.requestAnimationFrame(() => {
            const pane = scrollRef.current
            if (pane) pane.scrollTop = pane.scrollHeight
        })
        return () => window.cancelAnimationFrame(frame)
    }, [messages])

    useEffect(() => {
        keepComposerCurrentLineCentered(textareaRef.current)
    }, [draft])

    useEffect(() => observeMessagePaneResize(scrollRef.current, () => followingLatestRef.current, true), [])

    useEffect(() => {
        if (!actionMessageId) return
        const dismiss = (event: PointerEvent) => {
            const target = event.target instanceof Element ? event.target : null
            if (target?.closest("[data-message-action-popup]")) return
            if (target?.closest(`[data-message-interaction="${actionMessageId}"]`)) dismissedActionMessageRef.current = actionMessageId
            setActionMessageId(null)
        }
        document.addEventListener("pointerdown", dismiss, true)
        return () => document.removeEventListener("pointerdown", dismiss, true)
    }, [actionMessageId])

    async function loadOlder() {
        const pane = scrollRef.current
        if (!nextBefore || loadingOlder || !pane) return
        setLoadingOlder(true)
        const previousHeight = pane.scrollHeight
        try {
            const response = await fetch(`${apiPath}?before=${encodeURIComponent(nextBefore)}&limit=100`, { cache: "no-store" })
            const result = await response.json().catch(() => null) as MessagesResponse | null
            if (!response.ok) throw new Error()
            const incoming = Array.isArray(result?.messages) ? result.messages.flatMap((value) => messageFromValue(value) ?? []) : []
            setMessages((current) => mergeMessages(current, incoming))
            setNextBefore(typeof result?.nextBefore === "string" ? result.nextBefore : null)
            window.requestAnimationFrame(() => { pane.scrollTop += pane.scrollHeight - previousHeight })
        } catch {
            setSendError("Earlier messages could not be loaded. Please try again.")
        } finally {
            setLoadingOlder(false)
        }
    }

    async function sendMessage(retry?: PortalMessage) {
        const body = (retry?.body ?? draft).trim()
        if (!body) return
        const clientRequestId = retry?.localRequestId ?? crypto.randomUUID()
        const localId = retry?.id ?? `local:${clientRequestId}`
        const optimistic: PortalMessage = retry
            ? { ...retry, sendState: "sending", sendError: null }
            : {
                id: localId,
                body,
                direction: "inbound",
                senderKind: "client",
                automationLabel: null,
                replyToMessageId: replyingTo?.id ?? null,
                source: "portal",
                reactions: [],
                attachment: null,
                createdAt: new Date().toISOString(),
                localRequestId: clientRequestId,
                sendState: "sending",
                sendError: null,
            }
        scrollToLatestRef.current = true
        followingLatestRef.current = true
        setMessages((current) => sortMessages(retry ? current.map((message) => message.id === retry.id ? optimistic : message) : [...current, optimistic]))
        setSendError(null)
        if (!retry) {
            setDraft("")
            setReplyingTo(null)
        }

        const response = await fetch(apiPath, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body, clientRequestId, replyToMessageId: optimistic.replyToMessageId }),
        }).catch(() => null)
        const result = response ? await response.json().catch(() => null) as MessagesResponse | null : null
        const stored = messageFromValue(result?.message)
        if (response?.ok && stored) {
            scrollToLatestRef.current = true
            setMessages((current) => mergeMessages(current.filter((message) => message.id !== localId), [stored]))
            return
        }
        const error = typeof result?.error === "string" ? result.error : "The message was not confirmed. Check your connection and try again."
        setMessages((current) => current.map((message) => message.id === localId ? { ...message, sendState: "failed", sendError: error } : message))
    }

    function beginReply(message: PortalMessage) {
        if (message.id.startsWith("local:")) return
        setReplyingTo(message)
        setActionMessageId(null)
        window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }))
    }

    function rememberRecentReaction(emoji: string) {
        setRecentReaction(emoji)
        localStorage.setItem("betelgeze:client-portal:recent-reaction", emoji)
    }

    async function copyMessage(message: PortalMessage) {
        setActionMessageId(null)
        setInteractionError(null)
        const body = message.body && !(message.attachment && message.body === attachmentPlaceholder(message.attachment)) ? message.body : messagePreview(message)
        try {
            await copyMessageText(body)
        } catch (error) {
            setInteractionError(error instanceof Error ? error.message : "Could not copy this message.")
        }
    }

    async function downloadAttachment(message: PortalMessage) {
        if (!message.attachment) return
        setActionMessageId(null)
        setInteractionError(null)
        try {
            await downloadMessageAttachment(`${apiPath}/${encodeURIComponent(message.id)}/attachment`, message.attachment.fileName)
        } catch (error) {
            setInteractionError(error instanceof Error ? error.message : "Could not download this attachment.")
        }
    }

    async function deleteMessage(message: PortalMessage) {
        if (message.direction !== "inbound" || message.source !== "portal" || message.id.startsWith("local:")) return
        if (!window.confirm("Delete this message? It will disappear for you and the agency, and this cannot be undone.")) return
        const previous = messages
        setActionMessageId(null)
        setReplyingTo((current) => current?.id === message.id ? null : current)
        setInteractionError(null)
        setMessages((current) => current.filter((candidate) => candidate.id !== message.id).map((candidate) => candidate.replyToMessageId === message.id ? { ...candidate, replyToMessageId: null } : candidate))
        const params = new URLSearchParams({ messageId: message.id })
        const response = await fetch(`${apiPath}?${params}`, { method: "DELETE" }).catch(() => null)
        const result = response ? await response.json().catch(() => null) as { deleted?: boolean; messageId?: string; error?: string } | null : null
        if (!response?.ok || result?.deleted !== true || result.messageId !== message.id) {
            setMessages((current) => mergeMessages(current, previous))
            setInteractionError(result?.error ?? "Could not delete this message.")
        }
    }

    async function sendReaction(message: PortalMessage, emoji: string) {
        if (message.direction !== "outbound" || message.id.startsWith("local:")) return
        const previous = message.reactions
        const optimistic = emoji ? {
            id: previous.find((reaction) => reaction.direction === "inbound")?.id ?? `local-reaction:${message.id}`,
            direction: "inbound" as const,
            emoji,
            updatedAt: new Date().toISOString(),
        } : null
        setActionMessageId(null)
        setInteractionError(null)
        setMessages((current) => current.map((candidate) => candidate.id === message.id ? {
            ...candidate,
            reactions: [...candidate.reactions.filter((reaction) => reaction.direction !== "inbound"), ...(optimistic ? [optimistic] : [])],
        } : candidate))
        const response = await fetch(reactionsApiPath, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messageId: message.id, emoji }),
        }).catch(() => null)
        const result = response ? await response.json().catch(() => null) as { reaction?: unknown; error?: string } | null : null
        const stored = reactionFromValue(result?.reaction)
        if (!response?.ok || (emoji && !stored)) {
            setMessages((current) => current.map((candidate) => candidate.id === message.id ? { ...candidate, reactions: previous } : candidate))
            setInteractionError(result?.error ?? "Could not update this reaction.")
            return
        }
        setMessages((current) => current.map((candidate) => candidate.id === message.id ? {
            ...candidate,
            reactions: [...candidate.reactions.filter((reaction) => reaction.direction !== "inbound"), ...(stored ? [stored] : [])],
        } : candidate))
    }

    const messageById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages])

    return <div className="flex min-h-0 flex-1 flex-col bg-[var(--onboarding-page,#F8F7F3)]">
        <div
            ref={scrollRef}
            onScroll={(event) => {
                const pane = event.currentTarget
                followingLatestRef.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 96
            }}
            onClick={() => textareaRef.current?.blur()}
            style={{ overflowAnchor: "none" }}
            className="min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-x-none overscroll-y-contain px-4 py-5 sm:px-5"
            aria-live="polite"
            aria-busy={initialState === "loading"}
        >
            <div className="mx-auto flex min-h-full max-w-2xl flex-col">
                {messages.length ? <div aria-hidden="true" className="mt-auto" /> : null}
                {initialState === "loading" ? <div className="flex min-h-64 items-center justify-center text-sm text-[var(--onboarding-muted,#475569)]">Loading your conversation…</div> : null}
                {initialState === "error" ? <div className="flex min-h-64 items-center justify-center text-center"><div><p className="font-semibold">Your conversation could not be loaded</p><p className="mt-1 text-sm text-[var(--onboarding-muted,#475569)]">Check your connection and try again.</p><button type="button" onClick={() => void refreshLatest(true)} className="mt-4 h-11 rounded-lg bg-[var(--onboarding-primary,#1E3A5F)] px-4 text-sm font-semibold text-white">Try again</button></div></div> : null}
                {initialState === "ready" && nextBefore ? <div className="mb-5 text-center"><button type="button" onClick={() => void loadOlder()} disabled={loadingOlder} className="h-10 rounded-lg px-4 text-sm font-semibold text-[var(--onboarding-primary,#1E3A5F)] hover:bg-black/5 disabled:opacity-50">{loadingOlder ? "Loading…" : "Load earlier messages"}</button></div> : null}
                {initialState === "ready" && messages.length === 0 ? <div className="flex min-h-64 items-center justify-center text-center"><div className="max-w-xs"><p className="font-semibold">Start the conversation</p><p className="mt-2 text-sm leading-6 text-[var(--onboarding-muted,#475569)]">Send a message here and the {workspaceName} team will see it.</p></div></div> : null}
                {messages.map((message, index) => {
                    const own = message.direction === "inbound"
                    const previous = messages[index - 1]
                    const repliedMessage = message.replyToMessageId ? messageById.get(message.replyToMessageId) : null
                    const showDay = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt)
                    const attachmentUrl = `${apiPath}/${encodeURIComponent(message.id)}/attachment`
                    const persistent = !message.id.startsWith("local:")
                    const canDelete = persistent && own && message.source === "portal"
                    const canReact = persistent && !own
                    const canReply = persistent
                    const clientReaction = message.reactions.find((reaction) => reaction.direction === "inbound") ?? null
                    const isWhatsApp = own && message.source === "whatsapp"
                    const isSticker = message.attachment?.kind === "sticker"
                    const showActions = actionMessageId === message.id
                    const swipeOffset = swipePosition?.id === message.id ? swipePosition.offset : 0
                    const senderLabel = own
                        ? message.source === "whatsapp" ? "You · WhatsApp" : message.source === "sms" ? "You · SMS" : "You"
                        : message.senderKind === "automation" ? message.automationLabel ?? "Automated update" : workspaceName
                    return <Fragment key={message.id}>
                        {showDay ? <div className="my-5 flex items-center gap-3" aria-label={dayLabel(message.createdAt)}><span className="h-px flex-1 bg-black/10" /><span className="text-[11px] font-semibold text-[var(--onboarding-muted,#475569)]">{dayLabel(message.createdAt)}</span><span className="h-px flex-1 bg-black/10" /></div> : null}
                        <div data-message-interaction={message.id} className={`relative mb-3 flex items-center transition-[filter,opacity,transform] duration-150 ${own ? "justify-end origin-right" : "justify-start origin-left"} ${replyingTo ? replyingTo.id === message.id ? "pointer-events-none z-10 scale-[1.03]" : "pointer-events-none opacity-35 blur-[1px]" : ""}`}>
                            <span aria-hidden="true" style={{ opacity: Math.min(1, Math.abs(swipeOffset) / 36) }} className={`pointer-events-none absolute -inset-x-4 inset-y-0 lg:hidden ${swipeOffset < 0 ? "bg-gradient-to-l from-red-600/35 via-red-100/40 to-transparent" : "bg-gradient-to-r from-black/10 via-black/[0.03] to-transparent"}`} />
                            <span aria-hidden="true" style={{ top: "50%", opacity: Math.min(1, Math.max(0, swipeOffset) / 38), transform: `translateY(-50%) scale(${0.72 + Math.min(0.28, Math.max(0, swipeOffset) / 190)})` }} className="pointer-events-none absolute left-0 flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900 text-white lg:hidden"><ReplyIcon className="h-5 w-5" /></span>
                            {canDelete ? <span aria-hidden="true" style={{ top: "50%", opacity: Math.min(1, Math.max(0, -swipeOffset) / 38), transform: `translateY(-50%) scale(${0.72 + Math.min(0.28, Math.max(0, -swipeOffset) / 190)})` }} className="pointer-events-none absolute right-0 flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-white lg:hidden"><DeleteIcon className="h-5 w-5" /></span> : null}
                            {showActions ? <div key={`${message.id}:${actionView}`} data-message-action-popup className={`betelgeze-popup-enter absolute bottom-full z-20 mb-1 ${own ? "right-0" : "left-0"}`}>
                                {actionView === "actions" ? <PrimaryMessageActions
                                    onDelete={canDelete ? () => void deleteMessage(message) : null}
                                    onEdit={null}
                                    onSave={persistent && message.attachment ? () => void downloadAttachment(message) : null}
                                    saveLabel={message.attachment ? `Download ${message.attachment.fileName}` : undefined}
                                    onReply={canReply ? () => beginReply(message) : null}
                                    onCopy={() => void copyMessage(message)}
                                    onPin={null}
                                    onReact={canReact ? () => setActionView("reactions") : null}
                                    pinned={false}
                                /> : canReact ? <MessageReactionActions currentEmoji={clientReaction?.emoji ?? null} recentEmoji={recentReaction} onReact={(emoji) => void sendReaction(message, emoji)} onRecentEmoji={rememberRecentReaction} side={own ? "right" : "left"} /> : null}
                            </div> : null}
                            <article
                                role="button"
                                tabIndex={0}
                                aria-label={`Message from ${senderLabel}. Activate for message actions.`}
                                onClick={() => {
                                    if (swipedMessageRef.current === message.id) { swipedMessageRef.current = null; return }
                                    if (dismissedActionMessageRef.current === message.id) { dismissedActionMessageRef.current = null; return }
                                    setActionView("actions")
                                    setActionMessageId((current) => current === message.id ? null : message.id)
                                }}
                                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActionView("actions"); setActionMessageId((current) => current === message.id ? null : message.id) } }}
                                onTouchStart={(event) => {
                                    const target = event.target instanceof Element ? event.target : null
                                    if (target?.closest("button,a,audio,video")) return
                                    const touch = event.touches[0]
                                    swipeStartRef.current = touch ? { id: message.id, x: touch.clientX, y: touch.clientY, cancelled: false, maxDeltaX: 0, minDeltaX: 0, verticalAtMax: 0, verticalAtMin: 0 } : null
                                    if (touch) setSwipePosition({ id: message.id, offset: 0, active: true })
                                }}
                                onTouchMove={(event) => {
                                    const start = swipeStartRef.current
                                    const touch = event.touches[0]
                                    if (!start || start.id !== message.id || !touch || start.cancelled) return
                                    const deltaX = touch.clientX - start.x
                                    const deltaY = touch.clientY - start.y
                                    if (deltaX > start.maxDeltaX) { start.maxDeltaX = deltaX; start.verticalAtMax = Math.abs(deltaY) }
                                    if (deltaX < start.minDeltaX) { start.minDeltaX = deltaX; start.verticalAtMin = Math.abs(deltaY) }
                                    if (Math.abs(deltaY) > Math.abs(deltaX) * 1.5 && Math.abs(deltaY) > 12) {
                                        start.cancelled = true
                                        setSwipePosition({ id: message.id, offset: 0, active: false })
                                        return
                                    }
                                    const constrained = canDelete ? Math.max(-82, Math.min(82, deltaX * 0.78)) : Math.max(0, Math.min(82, deltaX * 0.78))
                                    if (Math.abs(constrained) > 2) { event.preventDefault(); setSwipePosition({ id: message.id, offset: constrained, active: true }) }
                                }}
                                onTouchEnd={(event) => {
                                    const start = swipeStartRef.current
                                    const touch = event.changedTouches[0]
                                    swipeStartRef.current = null
                                    if (start && touch) {
                                        const deltaX = touch.clientX - start.x
                                        const vertical = Math.abs(touch.clientY - start.y)
                                        if (deltaX > start.maxDeltaX) { start.maxDeltaX = deltaX; start.verticalAtMax = vertical }
                                        if (deltaX < start.minDeltaX) { start.minDeltaX = deltaX; start.verticalAtMin = vertical }
                                    }
                                    const replyGesture = Boolean(start && !start.cancelled && canReply && start.maxDeltaX > 52 && start.verticalAtMax < 42)
                                    const deleteGesture = Boolean(start && !start.cancelled && canDelete && start.minDeltaX < -52 && start.verticalAtMin < 42)
                                    setSwipePosition({ id: message.id, offset: 0, active: false })
                                    window.setTimeout(() => setSwipePosition((current) => current?.id === message.id && !current.active ? null : current), 220)
                                    if (replyGesture) { swipedMessageRef.current = message.id; beginReply(message) }
                                    else if (deleteGesture) { swipedMessageRef.current = message.id; void deleteMessage(message) }
                                }}
                                onTouchCancel={() => {
                                    swipeStartRef.current = null
                                    setSwipePosition({ id: message.id, offset: 0, active: false })
                                    window.setTimeout(() => setSwipePosition((current) => current?.id === message.id && !current.active ? null : current), 220)
                                }}
                                style={{ transform: `translate3d(${swipeOffset}px,0,0)`, transition: swipePosition?.id === message.id && swipePosition.active ? "none" : "transform 220ms cubic-bezier(.22,1,.36,1)", willChange: swipePosition?.id === message.id ? "transform" : undefined }}
                                className={`min-w-0 touch-pan-y cursor-pointer outline-none ring-offset-2 ring-offset-[var(--onboarding-page,#F8F7F3)] focus-visible:ring-2 focus-visible:ring-[var(--onboarding-primary,#1E3A5F)] ${isSticker ? "relative max-w-52 bg-transparent p-0 pb-1 shadow-none" : `max-w-[86%] rounded-2xl px-3.5 py-2.5 shadow-sm sm:max-w-[78%] ${isWhatsApp ? "rounded-br-md bg-[#154D37] text-white" : own ? "rounded-br-md bg-[var(--onboarding-primary,#1E3A5F)] text-white" : "rounded-bl-md border border-black/10 bg-[var(--onboarding-surface,#FFFFFF)] text-[var(--onboarding-text,#0F172A)]"}`}`}
                            >
                                <p className={`${isSticker ? "mb-1 w-fit rounded-full bg-black/70 px-2 py-0.5 text-white/75" : `mb-1 ${own ? "text-white/70" : "text-[var(--onboarding-muted,#475569)]"}`} text-[10px] font-semibold`}>{senderLabel}</p>
                                {message.replyToMessageId ? <div className={`mb-2 rounded-lg border-l-2 px-2.5 py-2 ${own ? "border-white/50 bg-black/10" : "border-[var(--onboarding-primary,#1E3A5F)]/40 bg-black/[0.03]"}`}><p className="truncate text-[10px] font-semibold opacity-70">{repliedMessage ? (repliedMessage.direction === "inbound" ? "You" : workspaceName) : "Replied message"}</p><p className="mt-0.5 truncate text-xs opacity-70">{repliedMessage ? messagePreview(repliedMessage) : "Message unavailable"}</p></div> : null}
                                {message.attachment ? <MessageAttachment attachment={message.attachment} url={attachmentUrl} own={own} onOpenImage={setPreviewMedia} /> : null}
                                {message.body && !(message.attachment && message.body === attachmentPlaceholder(message.attachment)) ? <MessageText body={message.body} own={own} /> : null}
                                {isSticker && message.reactions.length ? <div className={`absolute bottom-5 z-10 flex gap-0.5 ${own ? "right-0" : "left-0"}`}>{message.reactions.map((reaction) => <span key={reaction.id} title={reaction.direction === "inbound" ? "You reacted" : `${workspaceName} reacted`} className="rounded-full border border-black/15 bg-[var(--onboarding-surface,#FFFFFF)] px-1.5 py-0.5 text-sm shadow-sm">{reaction.emoji}</span>)}</div> : null}
                                <div className={`mt-1.5 flex items-center justify-end gap-2 text-[10px] ${isSticker ? "ml-auto w-fit rounded-full bg-black/70 px-2 py-0.5 text-white/75" : own ? "text-white/65" : "text-[var(--onboarding-muted,#475569)]"}`}><time dateTime={message.createdAt}>{messageTime(message.createdAt)}</time>{message.sendState === "sending" ? <span>Sending…</span> : null}</div>
                                {message.sendState === "failed" ? <div className="mt-2 border-t border-white/15 pt-2"><p className="text-xs text-white/85">{message.sendError}</p><button type="button" onClick={() => void sendMessage(message)} className="mt-1 text-xs font-semibold underline underline-offset-2">Try again</button></div> : null}
                            </article>
                        </div>
                        {!isSticker && message.reactions.length ? <div className={`mb-2 flex gap-1 px-1 ${own ? "justify-end" : "justify-start"}`}>{message.reactions.map((reaction) => <span key={reaction.id} title={reaction.direction === "inbound" ? "You reacted" : `${workspaceName} reacted`} className="rounded-full border border-black/10 bg-[var(--onboarding-surface,#FFFFFF)] px-2 py-0.5 text-sm shadow-sm">{reaction.emoji}</span>)}</div> : null}
                    </Fragment>
                })}
            </div>
        </div>

        <footer className="relative z-10 shrink-0 touch-manipulation border-t border-black/10 bg-[var(--onboarding-surface,#FFFFFF)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:p-4">
            <div className="mx-auto max-w-2xl">
                {replyingTo ? <div className="mb-2 flex items-center gap-3 border-l-2 border-[var(--onboarding-primary,#1E3A5F)] px-3 py-1 text-xs">
                    <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-[var(--onboarding-text,#0F172A)]">Replying to {replyingTo.direction === "inbound" ? "yourself" : workspaceName}</span><span className="block truncate text-[var(--onboarding-muted,#475569)]">{messagePreview(replyingTo)}</span></span>
                    <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={() => { setReplyingTo(null); textareaRef.current?.focus({ preventScroll: true }) }} aria-label="Cancel reply" className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-[var(--onboarding-muted,#475569)] hover:text-[var(--onboarding-text,#0F172A)]">×</button>
                </div> : null}
                {interactionError ? <div role="alert" className="mb-2 flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700"><span>{interactionError}</span><button type="button" onClick={() => setInteractionError(null)} aria-label="Dismiss interaction error">×</button></div> : null}
                {sendError ? <p role="alert" className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{sendError}</p> : null}
                <form onSubmit={(event) => { event.preventDefault(); void sendMessage() }} className="flex touch-manipulation items-center gap-2 rounded-2xl border border-black/10 bg-[var(--onboarding-page,#F8F7F3)] p-1.5 focus-within:border-[var(--onboarding-primary,#1E3A5F)]/50">
                    <textarea
                        ref={textareaRef}
                        rows={1}
                        value={draft}
                        maxLength={4_000}
                        enterKeyHint="send"
                        placeholder={`Message ${workspaceName}`}
                        aria-label={`Message ${workspaceName}`}
                        onPointerDown={(event) => {
                            if (document.activeElement !== event.currentTarget) event.currentTarget.focus({ preventScroll: true })
                        }}
                        onClick={(event) => {
                            if (document.activeElement !== event.currentTarget) event.currentTarget.focus({ preventScroll: true })
                        }}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                                event.preventDefault()
                                if (draft.trim()) void sendMessage()
                            }
                        }}
                        className="h-11 min-h-11 min-w-0 flex-1 resize-none overflow-y-hidden bg-transparent px-2.5 py-2.5 text-base leading-6 outline-none transition-[height] duration-[180ms] ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transition-none placeholder:text-[var(--onboarding-muted,#475569)]/70 lg:text-sm lg:leading-5"
                    />
                    <button type="submit" disabled={!draft.trim()} aria-label="Send message" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--onboarding-primary,#1E3A5F)] text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-35"><SendIcon /></button>
                </form>
                <p className="mt-1.5 hidden text-center text-[10px] text-[var(--onboarding-muted,#475569)] lg:block">Enter to send · Shift+Enter for a new line</p>
            </div>
        </footer>
        <MessageMediaLightbox media={previewMedia} onClose={() => setPreviewMedia(null)} />
    </div>
}
