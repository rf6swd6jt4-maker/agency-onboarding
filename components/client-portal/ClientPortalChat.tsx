"use client"

import Image from "next/image"
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"

import { MessageMediaLightbox, type MessageMediaPreview } from "@/components/communications/MessageMediaLightbox"

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
    attachment: PortalAttachment | null
    createdAt: string
    localRequestId?: string
    sendState?: "sending" | "failed"
    sendError?: string | null
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

function messageFromValue(value: unknown): PortalMessage | null {
    const source = record(value)
    const id = text(source.id)
    const body = text(source.body)
    const createdAt = text(source.createdAt)
    const direction = source.direction === "inbound" || source.direction === "outbound" ? source.direction : null
    const senderKind = source.senderKind === "client" || source.senderKind === "staff" || source.senderKind === "automation" ? source.senderKind : null
    if (!id || body === null || !createdAt || !direction || !senderKind || !Number.isFinite(Date.parse(createdAt))) return null
    return {
        id,
        body,
        direction,
        senderKind,
        automationLabel: text(source.automationLabel),
        replyToMessageId: text(source.replyToMessageId),
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
    if (attachment.kind === "image" || attachment.kind === "sticker") {
        return <button type="button" onClick={() => onOpenImage({ url, alt: attachment.fileName })} className={`mb-2 block overflow-hidden rounded-xl ${attachment.kind === "sticker" ? "bg-transparent" : own ? "bg-black/10" : "bg-black/5"}`} aria-label={`Open ${attachment.fileName}`}>
            <Image unoptimized src={url} alt={attachment.fileName} width={720} height={560} className={`${attachment.kind === "sticker" ? "max-h-44 object-contain" : "max-h-72 object-cover"} h-auto w-full`} />
        </button>
    }
    if (attachment.kind === "video") {
        return <video controls playsInline preload="metadata" className="mb-2 max-h-72 w-full rounded-xl bg-black" aria-label={attachment.fileName}><source src={url} type={attachment.mimeType} /></video>
    }
    if (attachment.kind === "audio") {
        return <div className={`mb-2 rounded-xl p-2 ${own ? "bg-black/10" : "bg-black/5"}`}><audio controls preload="metadata" src={url} className="block h-10 w-full max-w-64" aria-label={attachment.fileName} /></div>
    }
    return <a href={url} target="_blank" rel="noreferrer" className={`mb-2 flex items-center gap-3 rounded-xl border px-3 py-3 ${own ? "border-white/20 bg-white/10 text-white" : "border-black/10 bg-black/[0.03] text-[var(--onboarding-text,#0F172A)]"}`}>
        <span className="shrink-0"><FileIcon /></span>
        <span className="min-w-0"><span className="block truncate text-sm font-semibold">{attachment.fileName}</span><span className={`mt-0.5 block text-xs ${own ? "text-white/70" : "text-[var(--onboarding-muted,#475569)]"}`}>{formatFileSize(attachment.size)}</span></span>
    </a>
}

export function ClientPortalChat({ token, workspaceName }: { token: string; workspaceName: string }) {
    const apiPath = useMemo(() => `/api/client-portal/session/${encodeURIComponent(token)}/messages`, [token])
    const [messages, setMessages] = useState<PortalMessage[]>([])
    const [nextBefore, setNextBefore] = useState<string | null>(null)
    const [initialState, setInitialState] = useState<"loading" | "ready" | "error">("loading")
    const [loadingOlder, setLoadingOlder] = useState(false)
    const [draft, setDraft] = useState("")
    const [sendError, setSendError] = useState<string | null>(null)
    const [previewMedia, setPreviewMedia] = useState<MessageMediaPreview | null>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const refreshingRef = useRef(false)
    const followingLatestRef = useRef(true)
    const scrollToLatestRef = useRef(true)

    const refreshLatest = useCallback(async (initial = false) => {
        if (refreshingRef.current) return
        refreshingRef.current = true
        try {
            const response = await fetch(`${apiPath}?limit=100`, { cache: "no-store" })
            const result = await response.json().catch(() => null) as MessagesResponse | null
            if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "Messages are unavailable.")
            const incoming = Array.isArray(result?.messages) ? result.messages.flatMap((value) => messageFromValue(value) ?? []) : []
            if (initial || followingLatestRef.current) scrollToLatestRef.current = true
            setMessages((current) => mergeMessages(current, incoming))
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
        const textarea = textareaRef.current
        if (!textarea) return
        textarea.style.height = "0px"
        textarea.style.height = `${Math.min(120, Math.max(44, textarea.scrollHeight))}px`
    }, [draft])

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
                replyToMessageId: null,
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
        if (!retry) setDraft("")

        const response = await fetch(apiPath, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body, clientRequestId }),
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

    const messageById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages])

    return <div className="flex min-h-0 flex-1 flex-col bg-[var(--onboarding-page,#F8F7F3)]">
        <div
            ref={scrollRef}
            onScroll={(event) => {
                const pane = event.currentTarget
                followingLatestRef.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 96
            }}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5"
            aria-live="polite"
            aria-busy={initialState === "loading"}
        >
            <div className="mx-auto max-w-2xl">
                {initialState === "loading" ? <div className="flex min-h-64 items-center justify-center text-sm text-[var(--onboarding-muted,#475569)]">Loading your conversation…</div> : null}
                {initialState === "error" ? <div className="flex min-h-64 items-center justify-center text-center"><div><p className="font-semibold">Your conversation could not be loaded</p><p className="mt-1 text-sm text-[var(--onboarding-muted,#475569)]">Check your connection and try again.</p><button type="button" onClick={() => void refreshLatest(true)} className="mt-4 h-11 rounded-lg bg-[var(--onboarding-primary,#1E3A5F)] px-4 text-sm font-semibold text-white">Try again</button></div></div> : null}
                {initialState === "ready" && nextBefore ? <div className="mb-5 text-center"><button type="button" onClick={() => void loadOlder()} disabled={loadingOlder} className="h-10 rounded-lg px-4 text-sm font-semibold text-[var(--onboarding-primary,#1E3A5F)] hover:bg-black/5 disabled:opacity-50">{loadingOlder ? "Loading…" : "Load earlier messages"}</button></div> : null}
                {initialState === "ready" && messages.length === 0 ? <div className="flex min-h-64 items-center justify-center text-center"><div className="max-w-xs"><p className="font-semibold">Start the conversation</p><p className="mt-2 text-sm leading-6 text-[var(--onboarding-muted,#475569)]">Send a message here and the {workspaceName} team will see it in Betelgeze.</p></div></div> : null}
                {messages.map((message, index) => {
                    const own = message.direction === "inbound"
                    const previous = messages[index - 1]
                    const repliedMessage = message.replyToMessageId ? messageById.get(message.replyToMessageId) : null
                    const showDay = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt)
                    const attachmentUrl = `${apiPath}/${encodeURIComponent(message.id)}/attachment`
                    return <Fragment key={message.id}>
                        {showDay ? <div className="my-5 flex items-center gap-3" aria-label={dayLabel(message.createdAt)}><span className="h-px flex-1 bg-black/10" /><span className="text-[11px] font-semibold text-[var(--onboarding-muted,#475569)]">{dayLabel(message.createdAt)}</span><span className="h-px flex-1 bg-black/10" /></div> : null}
                        <div className={`mb-3 flex ${own ? "justify-end" : "justify-start"}`}>
                            <article className={`min-w-0 max-w-[86%] rounded-2xl px-3.5 py-2.5 shadow-sm sm:max-w-[78%] ${own ? "rounded-br-md bg-[var(--onboarding-primary,#1E3A5F)] text-white" : "rounded-bl-md border border-black/10 bg-[var(--onboarding-surface,#FFFFFF)] text-[var(--onboarding-text,#0F172A)]"}`}>
                                <p className={`mb-1 text-[10px] font-semibold ${own ? "text-white/70" : "text-[var(--onboarding-muted,#475569)]"}`}>{own ? "You" : message.senderKind === "automation" ? message.automationLabel ?? "Automated update" : workspaceName}</p>
                                {message.replyToMessageId ? <div className={`mb-2 rounded-lg border-l-2 px-2.5 py-2 ${own ? "border-white/50 bg-black/10" : "border-[var(--onboarding-primary,#1E3A5F)]/40 bg-black/[0.03]"}`}><p className="truncate text-[10px] font-semibold opacity-70">{repliedMessage ? (repliedMessage.direction === "inbound" ? "You" : workspaceName) : "Replied message"}</p><p className="mt-0.5 truncate text-xs opacity-70">{repliedMessage ? messagePreview(repliedMessage) : "Message unavailable"}</p></div> : null}
                                {message.attachment ? <MessageAttachment attachment={message.attachment} url={attachmentUrl} own={own} onOpenImage={setPreviewMedia} /> : null}
                                {message.body && !(message.attachment && message.body === attachmentPlaceholder(message.attachment)) ? <MessageText body={message.body} own={own} /> : null}
                                <div className={`mt-1.5 flex items-center justify-end gap-2 text-[10px] ${own ? "text-white/65" : "text-[var(--onboarding-muted,#475569)]"}`}><time dateTime={message.createdAt}>{messageTime(message.createdAt)}</time>{message.sendState === "sending" ? <span>Sending…</span> : null}</div>
                                {message.sendState === "failed" ? <div className="mt-2 border-t border-white/15 pt-2"><p className="text-xs text-white/85">{message.sendError}</p><button type="button" onClick={() => void sendMessage(message)} className="mt-1 text-xs font-semibold underline underline-offset-2">Try again</button></div> : null}
                            </article>
                        </div>
                    </Fragment>
                })}
            </div>
        </div>

        <footer className="shrink-0 border-t border-black/10 bg-[var(--onboarding-surface,#FFFFFF)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
            <div className="mx-auto max-w-2xl">
                {sendError ? <p role="alert" className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{sendError}</p> : null}
                <form onSubmit={(event) => { event.preventDefault(); void sendMessage() }} className="flex items-end gap-2 rounded-2xl border border-black/10 bg-[var(--onboarding-page,#F8F7F3)] p-1.5 focus-within:border-[var(--onboarding-primary,#1E3A5F)]/50">
                    <textarea
                        ref={textareaRef}
                        rows={1}
                        value={draft}
                        maxLength={4_000}
                        enterKeyHint="send"
                        placeholder={`Message ${workspaceName}`}
                        aria-label={`Message ${workspaceName}`}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                                event.preventDefault()
                                if (draft.trim()) void sendMessage()
                            }
                        }}
                        className="min-h-11 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-2.5 py-2.5 text-base leading-6 outline-none placeholder:text-[var(--onboarding-muted,#475569)]/70 sm:text-sm"
                    />
                    <button type="submit" disabled={!draft.trim()} aria-label="Send message" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--onboarding-primary,#1E3A5F)] text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-35"><SendIcon /></button>
                </form>
                <p className="mt-1.5 hidden text-center text-[10px] text-[var(--onboarding-muted,#475569)] sm:block">Enter to send · Shift+Enter for a new line</p>
            </div>
        </footer>
        <MessageMediaLightbox media={previewMedia} onClose={() => setPreviewMedia(null)} />
    </div>
}
