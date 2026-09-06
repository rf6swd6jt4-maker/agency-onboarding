"use client"

import Link from "next/link"
import Image from "next/image"
import { ComposerFooter } from "@/components/communications/ComposerFooter"
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"

import { CommunicationsConnectionStatus } from "@/components/communications/CommunicationsConnectionStatus"
import { ComposerMessagePreview } from "@/components/communications/ComposerMessagePreview"
import { copyMessageText, downloadMessageAttachment, MessageReactionActions, PrimaryMessageActions, type MessageActionView } from "@/components/communications/MessageActionMenu"
import { DoubleDeliveryCheckIcon, ReplyIcon, SingleDeliveryCheckIcon } from "@/components/communications/MessageInteractionIcons"
import { JumpToLatestButton, messagePaneCanShowNewMessage, observeMessagePaneResize } from "@/components/communications/JumpToLatestButton"
import { MessageComposer } from "@/components/communications/MessageComposer"
import { MessageMediaLightbox, type MessageMediaPreview } from "@/components/communications/MessageMediaLightbox"
import { MessageReadAvatars } from "@/components/communications/MessageReadAvatars"
import { PinnedMessageBar } from "@/components/communications/PinnedMessageBar"
import { ResizableConversationColumns } from "@/components/communications/ResizableConversationColumns"
import { NativeAttachment } from "@/components/communications/NativeAttachment"
import { NativeChatViewport } from "@/components/communications/NativeChatViewport"
import { NativeMessageBubble } from "@/components/communications/NativeMessageBubble"
import { VoiceNotePlayer } from "@/components/communications/VoiceNotePlayer"
import { UnreadMessageCount } from "@/components/communications/UnreadMessageCount"
import { keepComposerCurrentLineCentered } from "@/components/communications/composer-scroll"
import { createCoordinatedChat, chatMutationRequest, ChatMutationError, type ChatRead } from "@/lib/communications/coordinated-updates"
import { useMessagePaneInteractions } from "@/components/communications/useMessagePaneInteractions"
import { useReliableCommunicationsRealtime, type CommunicationsConnectionState } from "@/components/communications/useReliableCommunicationsRealtime"
import { SquarePill } from "@/components/ui"
import { useWorkspaceTabActive } from "@/components/workspace/useWorkspaceTabActive"
import type { ClientConversation, CommunicationAttachment, CommunicationDelivery, CommunicationMessage, CommunicationReaction, CommunicationReadCursor, CommunicationSticker, CommunicationsBootstrap } from "@/lib/communications/types"
import { communicationAttachmentFromRawPayload } from "@/lib/communications/attachments"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"
import { dismissReadChatNotification } from "@/lib/push/browser-notifications"
import { formatRelativeTime } from "@/lib/ui/relative-time"
import { clientConversationUnreadCount } from "@/lib/communications/unread"
import { clientMessageSupportsReaction } from "@/lib/communications/interactions"
import { closeWorkspaceComposer } from "@/lib/workspace-composer-viewport"

function record(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : null
}

const WHATSAPP_TYPING_DEBOUNCE_MS = 500
const WHATSAPP_TYPING_REFRESH_MS = 20_000

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
        replyToMessageId: stringValue(row.reply_to_message_id),
        createdAt,
        sentAt: stringValue(row.sent_at),
        deliveredAt: stringValue(row.delivered_at),
        readAt: stringValue(row.read_at),
        failedAt: stringValue(row.failed_at),
    }
}

function realtimeReaction(value: unknown): CommunicationReaction | null {
    const row = record(value)
    const id = stringValue(row.id)
    const relationshipId = stringValue(row.relationship_id)
    const messageId = stringValue(row.client_message_id)
    const emoji = stringValue(row.emoji)
    const updatedAt = stringValue(row.updated_at)
    const direction = row.direction === "inbound" ? "inbound" : row.direction === "outbound" ? "outbound" : null
    if (!id || !relationshipId || !messageId || !emoji || !updatedAt || !direction) return null
    return { id, relationshipId, messageId, direction, emoji, reactorUserId: stringValue(row.reactor_user_id), updatedAt }
}

function mergeMessages(current: CommunicationMessage[], incoming: CommunicationMessage[]) {
    const byKey = new Map<string, CommunicationMessage>()
    for (const message of [...current, ...incoming]) {
        const requestKey = message.clientRequestId ? `request:${message.clientRequestId}` : `id:${message.id}`
        const existing = byKey.get(requestKey)
        if (existing && existing.id !== existing.clientRequestId && message.id === message.clientRequestId) continue
        byKey.set(requestKey, existing ? { ...existing, ...message } : message)
    }
    return [...byKey.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

function messageAnimationKey(message: CommunicationMessage) {
    return message.clientRequestId ? `request:${message.clientRequestId}` : `id:${message.id}`
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
    if (message.readAt || status.includes("read")) return <span className="inline-flex shrink-0 text-sky-500" title="Read" aria-label="Read"><DoubleDeliveryCheckIcon /></span>
    if (message.deliveredAt || status.includes("delivered")) return <span className="inline-flex shrink-0" title="Delivered" aria-label="Delivered"><DoubleDeliveryCheckIcon /></span>
    return <span className="inline-flex shrink-0" title="Sent" aria-label="Sent"><SingleDeliveryCheckIcon /></span>
}

function usesWhatsApp(message: CommunicationMessage) {
    return message.provider === "meta_whatsapp" || Boolean(message.deliveries?.some((delivery) => delivery.provider === "meta_whatsapp"))
}

function SearchIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
}

function BackIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="m15 6-6 6 6 6" /></svg>
}

function AttachmentIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="m8.5 12.5 6.8-6.8a3 3 0 0 1 4.2 4.2l-9.2 9.2a5 5 0 0 1-7.1-7.1l9-9" /></svg>
}

function StickerIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="M5 3h10a4 4 0 0 1 4 4v7l-7 7H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M12 21v-5a2 2 0 0 1 2-2h5" /><path d="M7 9h.01M15 9h.01M8 13c1.5 1.2 6.5 1.2 8 0" /></svg>
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
    if (message.attachment) return message.attachment.kind === "sticker" ? "Sticker" : `${message.attachment.kind === "image" ? "Image" : message.attachment.kind === "video" ? "Video" : "File"}: ${message.attachment.fileName}`
    return message.body || "Message"
}

function MessageAttachment({ attachment, onOpenImage, light, whiteOnColor = false }: { attachment: CommunicationAttachment; onOpenImage: (media: MessageMediaPreview) => void; light: boolean; whiteOnColor?: boolean }) {
    if (attachment.kind === "audio") return <VoiceNotePlayer src={attachment.url} fileName={attachment.fileName} light={light} whiteOnColor={whiteOnColor} />
    return <NativeAttachment attachment={attachment} onOpenImage={onOpenImage} light={light} />
}

function MessageActionTray({ view, canInteract, currentEmoji, recentEmoji, onReact, onRecentEmoji, onReply, onCopy, onPin, onShowReactions, pinned, side, onSave, saveLabel, saveDisabled, saveActive }: {
    view: MessageActionView
    canInteract: boolean
    currentEmoji: string | null
    recentEmoji: string | null
    onReact: (emoji: string) => void
    onRecentEmoji: (emoji: string) => void
    onReply: (() => void) | null
    onCopy: () => void
    onPin: (() => void) | null
    onShowReactions: () => void
    pinned: boolean
    side: "left" | "right"
    onSave: (() => void) | null
    saveLabel?: string
    saveDisabled?: boolean
    saveActive?: boolean
}) {
    return view === "actions"
        ? <PrimaryMessageActions onDelete={null} onEdit={null} onSave={onSave} saveLabel={saveLabel} saveDisabled={saveDisabled} saveActive={saveActive} onReply={onReply} onCopy={onCopy} onPin={onPin} onReact={canInteract ? onShowReactions : null} pinned={pinned} />
        : canInteract ? <MessageReactionActions currentEmoji={currentEmoji} recentEmoji={recentEmoji} onReact={onReact} onRecentEmoji={onRecentEmoji} side={side} /> : null
}

function mergeCursor(current: CommunicationReadCursor[], incoming: CommunicationReadCursor) {
    const existing = current.find((cursor) => cursor.relationshipId === incoming.relationshipId && cursor.userId === incoming.userId)
    if (existing && existing.lastReadAt > incoming.lastReadAt) return current
    if (existing && existing.lastReadAt === incoming.lastReadAt && existing.lastReadMessageId === incoming.lastReadMessageId) return current
    return [...current.filter((cursor) => !(cursor.relationshipId === incoming.relationshipId && cursor.userId === incoming.userId)), incoming]
}

export function CommunicationsWorkspace({ active, bootstrap, onConnectionStateChange, onOpenTeam, onSelectedConversationChange, onUnreadCountChange, teamUnreadCount, conversationListWidth, onConversationListWidthChange }: {
    active: boolean
    bootstrap: CommunicationsBootstrap
    onConnectionStateChange?: (state: CommunicationsConnectionState) => void
    onOpenTeam?: () => void
    onSelectedConversationChange?: (conversationId: string | null) => void
    onUnreadCountChange?: (count: number) => void
    teamUnreadCount?: number
    conversationListWidth: number
    onConversationListWidthChange: (width: number) => void
}) {
    const supabase = useMemo(() => createSupabaseBrowserClient(), [])
    const [updates] = useState(() => createCoordinatedChat<CommunicationMessage, ClientConversation, CommunicationReaction>(bootstrap, (reaction) => `${reaction.messageId}:${reaction.direction}`))
    const { conversations, reactions } = useSyncExternalStore(updates.subscribe, updates.getSnapshot, updates.getSnapshot)
    const { setConversations } = updates
    const [schemaReady, setSchemaReady] = useState(bootstrap.schemaReady)
    const [selectedId, setSelectedId] = useState(bootstrap.selectedConversationId)
    const [search, setSearch] = useState("")
    const [draft, setDraft] = useState("")
    const [attachment, setAttachment] = useState<CommunicationAttachment | null>(null)
    const [attachmentState, setAttachmentState] = useState<"idle" | "uploading">("idle")
    const [attachmentError, setAttachmentError] = useState<string | null>(null)
    const [replyingTo, setReplyingTo] = useState<CommunicationMessage | null>(null)
    const [actionMessageId, setActionMessageId] = useState<string | null>(null)
    const [actionView, setActionView] = useState<MessageActionView>("actions")
    const [recentReaction, setRecentReaction] = useState<string | null>(null)
    const [stickers, setStickers] = useState(bootstrap.stickers)
    const [stickerTrayOpen, setStickerTrayOpen] = useState(false)
    const [stickerUploadState, setStickerUploadState] = useState<"idle" | "uploading">("idle")
    const [savingStickerMessageId, setSavingStickerMessageId] = useState<string | null>(null)
    const [downloadingMessageId, setDownloadingMessageId] = useState<string | null>(null)
    const [interactionError, setInteractionError] = useState<string | null>(null)
    const [swipePosition, setSwipePosition] = useState<{ id: string; offset: number; active: boolean } | null>(null)
    const [previewMedia, setPreviewMedia] = useState<MessageMediaPreview | null>(null)
    const [showJumpToLatest, setShowJumpToLatest] = useState(false)
    const [atLatest, setAtLatest] = useState(true)
    const [documentVisible, setDocumentVisible] = useState(() => typeof document !== "undefined" && document.visibilityState === "visible")
    const [enteringMessageIds, setEnteringMessageIds] = useState<Set<string>>(() => new Set())
    const [reactionCutoff] = useState(() => Date.now() - 30 * 24 * 60 * 60 * 1_000)
    const [readCursors, setReadCursors] = useState(bootstrap.readCursors)
    const messagePaneRef = useRef<HTMLDivElement | null>(null)
    const followLatestRef = useRef(true)
    const messageAnimationTimersRef = useRef<number[]>([])
    const knownMessageKeysRef = useRef(new Set(bootstrap.conversations.flatMap((conversation) => conversation.messages.map(messageAnimationKey))))
    const searchRef = useRef<HTMLInputElement | null>(null)
    const attachmentInputRef = useRef<HTMLInputElement | null>(null)
    const stickerInputRef = useRef<HTMLInputElement | null>(null)
    const composerRef = useRef<HTMLTextAreaElement | null>(null)
    const attachmentRef = useRef<CommunicationAttachment | null>(null)
    const swipeStartRef = useRef<{ id: string; x: number; y: number; cancelled: boolean; maxDeltaX: number; verticalAtMax: number } | null>(null)
    const selectedRef = useRef(selectedId)
    const draftRef = useRef(draft)
    const whatsAppTypingTimerRef = useRef<number | null>(null)
    const whatsAppTypingCooldownTimersRef = useRef<Record<string, number>>({})
    const pendingReadRef = useRef<CommunicationReadCursor | null>(null)
    const readRequestRef = useRef<string | null>(null)
    const workspaceTabActive = useWorkspaceTabActive()
    const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null
    const messagePaneInteractions = useMessagePaneInteractions(composerRef, followLatestRef, setAtLatest, setShowJumpToLatest)

    useEffect(() => {
        selectedRef.current = selectedId
        onSelectedConversationChange?.(selectedId)
    }, [onSelectedConversationChange, selectedId])

    useEffect(() => { draftRef.current = draft }, [draft])

    useEffect(() => {
        const update = () => setDocumentVisible(document.visibilityState === "visible")
        document.addEventListener("visibilitychange", update)
        return () => document.removeEventListener("visibilitychange", update)
    }, [])

    useEffect(() => {
        const timer = window.setTimeout(() => setRecentReaction(localStorage.getItem(`betelgeze:communications:recent-reaction:${bootstrap.workspaceId}`)), 0)
        return () => window.clearTimeout(timer)
    }, [bootstrap.workspaceId])

    useEffect(() => {
        keepComposerCurrentLineCentered(composerRef.current)
    }, [draft])

    useEffect(() => observeMessagePaneResize(messagePaneRef.current, () => followLatestRef.current, true), [selectedId])

    useEffect(() => () => messageAnimationTimersRef.current.forEach((timer) => window.clearTimeout(timer)), [])

    useEffect(() => () => {
        if (whatsAppTypingTimerRef.current !== null) window.clearTimeout(whatsAppTypingTimerRef.current)
        Object.values(whatsAppTypingCooldownTimersRef.current).forEach((timer) => window.clearTimeout(timer))
    }, [])

    useEffect(() => {
        attachmentRef.current = attachment
    }, [attachment])

    useEffect(() => {
        if (!actionMessageId) return
        const dismiss = (event: PointerEvent) => {
            const target = event.target instanceof Element ? event.target : null
            if (target?.closest("[data-message-action-popup]")) return
            setActionMessageId(null)
        }
        const documents = [document]
        try { if (window.parent !== window) documents.push(window.parent.document) } catch { /* Cross-origin shells cannot be observed. */ }
        documents.forEach((ownerDocument) => ownerDocument.addEventListener("pointerdown", dismiss, true))
        return () => documents.forEach((ownerDocument) => ownerDocument.removeEventListener("pointerdown", dismiss, true))
    }, [actionMessageId])

    const updateConversationMessages = useCallback((relationshipId: string, incoming: CommunicationMessage[], animate = false, read?: ChatRead, acknowledgement = false) => {
        if (read) incoming = updates.mergeReadMessages(read, relationshipId, incoming, acknowledgement)
        const newMessages = incoming.filter((message) => !knownMessageKeysRef.current.has(messageAnimationKey(message)))
        incoming.forEach((message) => knownMessageKeysRef.current.add(messageAnimationKey(message)))
        if (animate && newMessages.length && selectedRef.current === relationshipId && messagePaneCanShowNewMessage(messagePaneRef.current, followLatestRef.current)) {
            const ids = newMessages.map((message) => message.id)
            setEnteringMessageIds((current) => new Set([...current, ...ids]))
            const timer = window.setTimeout(() => {
                setEnteringMessageIds((current) => new Set([...current].filter((id) => !ids.includes(id))))
                messageAnimationTimersRef.current = messageAnimationTimersRef.current.filter((candidate) => candidate !== timer)
            }, 320)
            messageAnimationTimersRef.current.push(timer)
        }
        if (!read) setConversations((current) => current.map((conversation) => conversation.id === relationshipId
            ? { ...conversation, messages: mergeMessages(conversation.messages, incoming) }
            : conversation).sort((left, right) => (right.messages.at(-1)?.createdAt ?? "").localeCompare(left.messages.at(-1)?.createdAt ?? "") || left.title.localeCompare(right.title)))
    }, [setConversations, updates])

    const persistReadCursor = useCallback(async (cursor: CommunicationReadCursor) => {
        pendingReadRef.current = cursor
        setReadCursors((current) => mergeCursor(current, cursor))
        if (readRequestRef.current === cursor.lastReadMessageId) return
        readRequestRef.current = cursor.lastReadMessageId
        try {
            const response = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/read`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ relationshipId: cursor.relationshipId, messageId: cursor.lastReadMessageId }),
            })
            const result = await response.json().catch(() => null) as { cursor?: CommunicationReadCursor; notificationReadThrough?: string; error?: string } | null
            if (!response.ok || !result?.cursor) throw new Error(result?.error ?? "Could not save the read position.")
            setReadCursors((current) => mergeCursor(current, result.cursor!))
            if (result.notificationReadThrough) void dismissReadChatNotification(cursor.relationshipId, result.notificationReadThrough)
            if (pendingReadRef.current?.relationshipId === cursor.relationshipId && pendingReadRef.current.lastReadMessageId === cursor.lastReadMessageId) pendingReadRef.current = null
        } finally {
            if (readRequestRef.current === cursor.lastReadMessageId) readRequestRef.current = null
        }
    }, [bootstrap.workspaceSlug])

    const flushPendingRead = useCallback(async () => {
        const pending = pendingReadRef.current
        if (pending) await persistReadCursor(pending)
    }, [persistReadCursor])

    const selectConversation = useCallback((conversationId: string | null) => {
        closeWorkspaceComposer(composerRef.current)
        void flushPendingRead().catch(() => undefined)
        const pendingAttachment = attachmentRef.current
        const previousRelationshipId = selectedRef.current
        if (pendingAttachment && previousRelationshipId) {
            void fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/attachments`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ relationshipId: previousRelationshipId, storagePath: pendingAttachment.storagePath }),
            }).catch(() => undefined)
        }
        followLatestRef.current = true
        setAtLatest(true)
        setShowJumpToLatest(false)
        setSelectedId(conversationId)
        setAttachment(null)
        setAttachmentError(null)
        setReplyingTo(null)
        setActionMessageId(null)
        setActionView("actions")
        setStickerTrayOpen(false)
        setInteractionError(null)
        setSwipePosition(null)
        setDraft(conversationId ? localStorage.getItem(`betelgeze:communications:draft:${bootstrap.workspaceId}:${conversationId}`) ?? "" : "")
    }, [bootstrap.workspaceId, bootstrap.workspaceSlug, flushPendingRead])

    function beginReply(message: CommunicationMessage) {
        setReplyingTo(message)
        setActionMessageId(null)
        window.requestAnimationFrame(() => composerRef.current?.focus())
    }

    function rememberRecentReaction(emoji: string) {
        setRecentReaction(emoji)
        localStorage.setItem(`betelgeze:communications:recent-reaction:${bootstrap.workspaceId}`, emoji)
    }

    async function copyMessage(message: CommunicationMessage) {
        setActionMessageId(null)
        setInteractionError(null)
        const body = message.body && !(message.attachment && message.body === attachmentPlaceholder(message.attachment)) ? message.body : messagePreview(message)
        try {
            await copyMessageText(body)
        } catch (error) {
            setInteractionError(error instanceof Error ? error.message : "Could not copy this message.")
        }
    }

    async function togglePinnedMessage(message: CommunicationMessage) {
        if (!selected) return
        const relationshipId = selected.id
        const pinnedMessageId = selected.pinnedMessageId === message.id ? null : message.id
        setActionMessageId(null)
        setInteractionError(null)
        try {
            await updates.mutatePin(relationshipId, pinnedMessageId, async () => {
                const result = await chatMutationRequest<{ pinnedMessageId: string | null }>(`/api/workspaces/${bootstrap.workspaceSlug}/communications/pins`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relationshipId, messageId: pinnedMessageId }) })
                if (result.pinnedMessageId !== pinnedMessageId) throw new ChatMutationError("Could not confirm the pinned message.", true)
            })
        } catch (error) { setInteractionError(error instanceof Error ? error.message : "Could not pin message.") }
        finally { void synchronize().catch(() => undefined) }
    }

    function jumpToMessage(messageId: string) {
        const pane = messagePaneRef.current
        const target = pane?.querySelector<HTMLElement>(`[data-message-interaction="${CSS.escape(messageId)}"]`)
        if (!pane || !target) return
        followLatestRef.current = false
        setAtLatest(false)
        setShowJumpToLatest(true)
        const paneBounds = pane.getBoundingClientRect()
        const targetBounds = target.getBoundingClientRect()
        pane.scrollTo({ top: pane.scrollTop + targetBounds.top - paneBounds.top - (pane.clientHeight - targetBounds.height) / 2, behavior: "instant" })
        target.animate([{ filter: "brightness(1.5)" }, { filter: "brightness(1)" }], { duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 900 })
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
            const prepared = await prepareResponse.json().catch(() => null) as { uploadUrl?: string; uploadHeaders?: Record<string, string>; attachment?: CommunicationAttachment; error?: string } | null
            if (!prepareResponse.ok || !prepared?.uploadUrl || !prepared.attachment) throw new Error(prepared?.error ?? "Could not prepare attachment.")
            const uploadResponse = await fetch(prepared.uploadUrl, {
                method: "PUT",
                headers: { "Content-Type": prepared.attachment.mimeType, ...(prepared.uploadHeaders ?? {}) },
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

    async function uploadSticker(file: File) {
        if (stickerUploadState === "uploading") return
        setStickerUploadState("uploading")
        setInteractionError(null)
        try {
            const formData = new FormData()
            formData.set("file", file)
            const response = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/stickers`, { method: "POST", body: formData })
            const result = await response.json().catch(() => null) as { sticker?: CommunicationSticker; error?: string } | null
            if (!response.ok || !result?.sticker) throw new Error(result?.error ?? "Could not add this sticker.")
            setStickers((current) => [...current, result.sticker!])
        } catch (error) {
            setInteractionError(error instanceof Error ? error.message : "Could not add this sticker.")
        } finally {
            setStickerUploadState("idle")
            if (stickerInputRef.current) stickerInputRef.current.value = ""
        }
    }

    async function saveSticker(message: CommunicationMessage) {
        if (message.attachment?.kind !== "sticker" || savingStickerMessageId) return
        setSavingStickerMessageId(message.id)
        setInteractionError(null)
        try {
            const response = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/stickers`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messageId: message.id }),
            })
            const result = await response.json().catch(() => null) as { sticker?: CommunicationSticker; error?: string } | null
            if (!response.ok || !result?.sticker) throw new Error(result?.error ?? "Could not save this sticker.")
            setStickers((current) => current.some((sticker) => sticker.storagePath === result.sticker!.storagePath)
                ? current
                : [...current, result.sticker!])
        } catch (error) {
            setInteractionError(error instanceof Error ? error.message : "Could not save this sticker.")
        } finally {
            setSavingStickerMessageId(null)
        }
    }

    async function saveOrDownloadAttachment(message: CommunicationMessage) {
        if (!message.attachment) return
        setActionMessageId(null)
        if (message.attachment.kind === "sticker") {
            await saveSticker(message)
            return
        }
        if (downloadingMessageId) return
        setDownloadingMessageId(message.id)
        setInteractionError(null)
        try {
            await downloadMessageAttachment(message.attachment.url, message.attachment.fileName)
        } catch (error) {
            setInteractionError(error instanceof Error ? error.message : "Could not download this attachment.")
        } finally {
            setDownloadingMessageId(null)
        }
    }

    async function sendSticker(sticker: CommunicationSticker) {
        if (!selected || !schemaReady || !selected.canSend) return
        const replyTarget = replyingTo
        const clientRequestId = crypto.randomUUID()
        const stickerAttachment: CommunicationAttachment = { kind: "sticker", fileName: sticker.fileName, mimeType: "image/webp", size: sticker.size, storagePath: sticker.storagePath, url: sticker.url }
        const optimistic: CommunicationMessage = {
            id: clientRequestId,
            clientRequestId,
            relationshipId: selected.id,
            body: attachmentPlaceholder(stickerAttachment),
            direction: "outbound",
            provider: "omnichannel",
            status: "sending",
            error: null,
            senderKind: "staff",
            senderUserId: bootstrap.currentUser.id,
            automationKind: null,
            automationLabel: null,
            attachment: stickerAttachment,
            providerMessageId: null,
            replyToProviderMessageId: replyTarget?.providerMessageId ?? null,
            replyToMessageId: replyTarget?.id ?? null,
            createdAt: new Date().toISOString(),
            sentAt: null,
            deliveredAt: null,
            readAt: null,
            failedAt: null,
        }
        updateConversationMessages(selected.id, [optimistic], true)
        setStickerTrayOpen(false)
        setReplyingTo(null)
        setInteractionError(null)
        const acknowledgementRead = updates.beginRead()
        const response = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ relationshipId: selected.id, stickerId: sticker.id, replyToMessageId: replyTarget?.id, clientRequestId }),
        }).catch(() => null)
        if (!response) {
            updateConversationMessages(selected.id, [{ ...optimistic, status: "send_uncertain", error: "Delivery is being confirmed." }])
            return
        }
        const result = await response.json().catch(() => null) as { message?: CommunicationMessage; error?: string; retryable?: boolean } | null
        if (result?.message) updateConversationMessages(selected.id, [result.message], false, acknowledgementRead, true)
        else updateConversationMessages(selected.id, [{ ...optimistic, status: result?.retryable ? "send_failed" : "send_uncertain", error: result?.error ?? "Could not send sticker", failedAt: result?.retryable ? new Date().toISOString() : null }])
    }

    async function sendReaction(message: CommunicationMessage, emoji: string) {
        if (!selected || !message.providerMessageId) return
        const relationshipId = selected.id
        const optimistic: CommunicationReaction | null = emoji ? { id: `optimistic:${message.id}`, relationshipId, messageId: message.id, direction: "outbound", reactorUserId: bootstrap.currentUser.id, emoji, updatedAt: new Date().toISOString() } : null
        setActionMessageId(null)
        setInteractionError(null)
        try {
            await updates.mutateReaction(`${message.id}:outbound`, optimistic, async () => {
                const result = await chatMutationRequest<{ reaction: CommunicationReaction | null }>(`/api/workspaces/${bootstrap.workspaceSlug}/communications/reactions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relationshipId, messageId: message.id, emoji }) })
                if (!("reaction" in result)) throw new ChatMutationError("Could not confirm the reaction.", true)
                return result.reaction
            })
        } catch (error) { setInteractionError(error instanceof Error ? error.message : "Could not send reaction.") }
        finally { void synchronize().catch(() => undefined) }
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
        const read = updates.beginRead()
        void fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/messages?relationshipId=${encodeURIComponent(selectedId)}`, { signal: controller.signal })
            .then(async (response) => response.ok ? response.json() as Promise<{ messages?: CommunicationMessage[] }> : null)
            .then((result) => { if (result?.messages) updateConversationMessages(selectedId, result.messages, false, read) })
            .catch(() => undefined)
        return () => controller.abort()
    }, [bootstrap.workspaceSlug, selectedId, updateConversationMessages, updates])

    useEffect(() => {
        if (!selectedId || !followLatestRef.current) return
        window.requestAnimationFrame(() => messagePaneRef.current?.scrollTo({ top: messagePaneRef.current.scrollHeight, left: 0 }))
    }, [selected?.messages.length, selectedId])

    const synchronize = useCallback(async () => {
        const read = updates.beginRead()
        const conversationId = selectedRef.current
        const search = conversationId ? `?conversation=${encodeURIComponent(conversationId)}` : ""
        const response = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/sync${search}`, { cache: "no-store" })
        const result = await response.json().catch(() => null) as CommunicationsBootstrap | { error?: string } | null
        if (!response.ok || !result || !("conversations" in result)) throw new Error(result && "error" in result ? result.error ?? "Could not check for missed messages." : "Could not check for missed messages.")
        result.conversations.forEach((conversation) => conversation.messages.forEach((message) => knownMessageKeysRef.current.add(messageAnimationKey(message))))
        setSchemaReady(result.schemaReady)
        if (!updates.applySnapshot(read, result)) return
        setReadCursors((current) => result.readCursors.reduce((next, cursor) => mergeCursor(next, cursor), current))
        setStickers(result.stickers)
        await flushPendingRead()
    }, [bootstrap.workspaceSlug, flushPendingRead, updates])

    const registerRealtime = useCallback((channel: ReturnType<typeof supabase.channel>) => channel
                .on("postgres_changes", { event: "*", schema: "public", table: "client_messages", filter: `workspace_id=eq.${bootstrap.workspaceId}` }, (payload) => {
                    if (payload.eventType === "DELETE") {
                        const deleted = record(payload.old)
                        const messageId = stringValue(deleted.id)
                        if (messageId) {
                            updates.removeMessage(messageId)
                            setReplyingTo((current) => current?.id === messageId ? null : current)
                            setActionMessageId((current) => current === messageId ? null : current)
                        }
                        return
                    }
                    const message = realtimeMessage(payload.new)
                    if (message) updateConversationMessages(message.relationshipId, [message], true)
                    else {
                        const row = record(payload.new)
                        const previous = record(payload.old)
                        const relationshipId = stringValue(row.relationship_id)
                        const messageId = stringValue(row.id)
                        const encryptedContentChanged = row.body_ciphertext !== previous.body_ciphertext || row.raw_payload_ciphertext !== previous.raw_payload_ciphertext
                        if (payload.eventType === "UPDATE" && relationshipId && messageId && !encryptedContentChanged) {
                            setConversations((current) => current.map((conversation) => conversation.id === relationshipId ? {
                                ...conversation,
                                messages: conversation.messages.map((candidate) => candidate.id === messageId ? {
                                    ...candidate,
                                    status: stringValue(row.status) ?? candidate.status,
                                    error: stringValue(row.error),
                                    providerMessageId: stringValue(row.whatsapp_message_id) ?? stringValue(row.provider_message_id) ?? candidate.providerMessageId,
                                    sentAt: stringValue(row.sent_at),
                                    deliveredAt: stringValue(row.delivered_at),
                                    readAt: stringValue(row.read_at),
                                    failedAt: stringValue(row.failed_at),
                                } : candidate),
                            } : conversation))
                            return
                        }
                        const read = updates.beginRead()
                        if (relationshipId && messageId) void fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/messages?relationshipId=${encodeURIComponent(relationshipId)}&messageId=${encodeURIComponent(messageId)}`, { cache: "no-store" })
                            .then(async (response) => response.ok ? response.json() as Promise<{ message?: CommunicationMessage }> : null)
                            .then((result) => { if (result?.message) updateConversationMessages(relationshipId, [result.message], true, read) })
                            .catch(() => undefined)
                    }
                })
                .on("postgres_changes", { event: "*", schema: "public", table: "communication_message_deliveries", filter: `workspace_id=eq.${bootstrap.workspaceId}` }, (payload) => {
                    const row = record(payload.new)
                    const messageId = stringValue(row.client_message_id)
                    const provider = row.provider === "meta_whatsapp" || row.provider === "twilio_sms" ? row.provider : null
                    if (!messageId || !provider) return
                    const delivery: CommunicationDelivery = {
                        provider,
                        providerMessageId: stringValue(row.provider_message_id),
                        status: stringValue(row.status) ?? "sending",
                        error: stringValue(row.error),
                        sentAt: stringValue(row.sent_at),
                        deliveredAt: stringValue(row.delivered_at),
                        readAt: stringValue(row.read_at),
                        failedAt: stringValue(row.failed_at),
                    }
                    setConversations((current) => current.map((conversation) => ({
                        ...conversation,
                        messages: conversation.messages.map((message) => message.id === messageId ? {
                            ...message,
                            deliveries: [...(message.deliveries ?? []).filter((candidate) => candidate.provider !== provider), delivery],
                        } : message),
                    })))
                })
                .on("postgres_changes", { event: "*", schema: "public", table: "communication_read_cursors", filter: `workspace_id=eq.${bootstrap.workspaceId}` }, (payload) => {
                    const row = record(payload.new)
                    const relationshipId = stringValue(row.relationship_id)
                    const userId = stringValue(row.user_id)
                    const lastReadAt = stringValue(row.last_read_at)
                    if (relationshipId && userId && lastReadAt) setReadCursors((current) => mergeCursor(current, { relationshipId, userId, lastReadMessageId: stringValue(row.last_read_message_id), lastReadAt }))
                })
                .on("postgres_changes", { event: "*", schema: "public", table: "communication_reactions", filter: `workspace_id=eq.${bootstrap.workspaceId}` }, (payload) => {
                    if (payload.eventType === "DELETE") {
                        const deleted = record(payload.old)
                        const messageId = stringValue(deleted.client_message_id)
                        const direction = deleted.direction
                        if (messageId && (direction === "inbound" || direction === "outbound")) updates.receiveReaction(`${messageId}:${direction}`, null, stringValue(deleted.updated_at) ?? undefined)
                        return
                    }
                    const reaction = realtimeReaction(payload.new)
                    if (reaction) updates.receiveReaction(`${reaction.messageId}:${reaction.direction}`, reaction)
                })
                .on("postgres_changes", { event: "UPDATE", schema: "public", table: "relationships", filter: `workspace_id=eq.${bootstrap.workspaceId}` }, (payload) => {
                    const row = record(payload.new)
                    const relationshipId = stringValue(row.id)
                    if (!relationshipId || !("communication_pinned_message_id" in row)) return
                    if (updates.getSnapshot().conversations.find((conversation) => conversation.id === relationshipId)?.pinnedMessageId !== stringValue(row.communication_pinned_message_id)) void synchronize().catch(() => undefined)
                }), [bootstrap.workspaceId, bootstrap.workspaceSlug, supabase, updateConversationMessages, setConversations, updates, synchronize])

    const connection = useReliableCommunicationsRealtime({
        active,
        privateChannel: false,
        register: registerRealtime,
        schemaReady,
        supabase,
        synchronize,
        topic: `communications-client:${bootstrap.workspaceSlug}`,
    })

    const clearPendingWhatsAppTyping = useCallback(() => {
        if (whatsAppTypingTimerRef.current === null) return
        window.clearTimeout(whatsAppTypingTimerRef.current)
        whatsAppTypingTimerRef.current = null
    }, [])

    function handleClientDraftChange(value: string) {
        draftRef.current = value
        setDraft(value)
        clearPendingWhatsAppTyping()
        if (!value.trim() || !selected?.channels?.includes("meta_whatsapp") || !active || !workspaceTabActive || !documentVisible) return
        const relationshipId = selected.id
        if (whatsAppTypingCooldownTimersRef.current[relationshipId]) return
        whatsAppTypingTimerRef.current = window.setTimeout(() => {
            whatsAppTypingTimerRef.current = null
            if (selectedRef.current !== relationshipId || !draftRef.current.trim() || document.visibilityState !== "visible") return
            whatsAppTypingCooldownTimersRef.current[relationshipId] = window.setTimeout(() => {
                delete whatsAppTypingCooldownTimersRef.current[relationshipId]
            }, WHATSAPP_TYPING_REFRESH_MS)
            void fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/typing`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ relationshipId }),
            }).then((response) => {
                if (!response.ok) {
                    window.clearTimeout(whatsAppTypingCooldownTimersRef.current[relationshipId])
                    delete whatsAppTypingCooldownTimersRef.current[relationshipId]
                }
            }).catch(() => {
                window.clearTimeout(whatsAppTypingCooldownTimersRef.current[relationshipId])
                delete whatsAppTypingCooldownTimersRef.current[relationshipId]
            })
        }, WHATSAPP_TYPING_DEBOUNCE_MS)
    }

    useEffect(() => { clearPendingWhatsAppTyping() }, [clearPendingWhatsAppTyping, selectedId])

    useEffect(() => onConnectionStateChange?.(connection.state), [connection.state, onConnectionStateChange])

    const unreadCount = useMemo(() => conversations.reduce((total, conversation) => {
        const ownCursor = readCursors.find((cursor) => cursor.relationshipId === conversation.id && cursor.userId === bootstrap.currentUser.id)
        const visiblyReading = conversation.id === selectedId && active && workspaceTabActive && documentVisible && atLatest
        return total + clientConversationUnreadCount(conversation, ownCursor, visiblyReading)
    }, 0), [active, atLatest, bootstrap.currentUser.id, conversations, documentVisible, readCursors, selectedId, workspaceTabActive])

    useEffect(() => onUnreadCountChange?.(unreadCount), [onUnreadCountChange, unreadCount])

    useEffect(() => {
        if (!active || !workspaceTabActive || !documentVisible || !atLatest || !selectedId || !selected?.messages.length || !schemaReady) return
        const latest = selected.messages.at(-1)!
        const current = readCursors.find((cursor) => cursor.relationshipId === selectedId && cursor.userId === bootstrap.currentUser.id)
        if (current?.lastReadMessageId === latest.id) {
            void dismissReadChatNotification(selectedId, latest.createdAt)
            return
        }
        const cursor: CommunicationReadCursor = { relationshipId: selectedId, userId: bootstrap.currentUser.id, lastReadMessageId: latest.id, lastReadAt: latest.createdAt }
        const timer = window.setTimeout(() => { void persistReadCursor(cursor).catch(() => undefined) }, 0)
        return () => window.clearTimeout(timer)
    }, [active, atLatest, bootstrap.currentUser.id, documentVisible, persistReadCursor, readCursors, schemaReady, selected?.messages, selectedId, workspaceTabActive])

    async function sendMessage(messageToRetry?: CommunicationMessage) {
        if (!selected || !schemaReady || !selected.canSend) return
        const messageAttachment = messageToRetry?.attachment ?? attachment
        const replyTarget = messageToRetry ? null : replyingTo
        const replyMessageId = messageToRetry?.replyToMessageId ?? replyTarget?.id ?? null
        const typedBody = messageToRetry ? (messageToRetry.attachment && messageToRetry.body === attachmentPlaceholder(messageToRetry.attachment) ? "" : messageToRetry.body) : draft.trim()
        if (!typedBody && !messageAttachment) return
        clearPendingWhatsAppTyping()
        const body = typedBody || (messageAttachment ? attachmentPlaceholder(messageAttachment) : "")
        const clientRequestId = messageToRetry?.clientRequestId ?? crypto.randomUUID()
        const optimistic: CommunicationMessage = messageToRetry ? { ...messageToRetry, status: "sending", error: null, failedAt: null } : {
            id: clientRequestId,
            clientRequestId,
            relationshipId: selected.id,
            body,
            direction: "outbound",
            provider: "omnichannel",
            status: "sending",
            error: null,
            senderKind: "staff",
            senderUserId: bootstrap.currentUser.id,
            automationKind: null,
            automationLabel: null,
            attachment: messageAttachment,
            providerMessageId: null,
            replyToProviderMessageId: replyTarget?.providerMessageId ?? null,
            replyToMessageId: replyTarget?.id ?? null,
            createdAt: new Date().toISOString(),
            sentAt: null,
            deliveredAt: null,
            readAt: null,
            failedAt: null,
        }
        updateConversationMessages(selected.id, [optimistic], true)
        if (!messageToRetry) {
            draftRef.current = ""
            setDraft("")
            setAttachment(null)
            setReplyingTo(null)
            localStorage.removeItem(`betelgeze:communications:draft:${bootstrap.workspaceId}:${selected.id}`)
        }
        const acknowledgementRead = updates.beginRead()
        const response = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relationshipId: selected.id, body: typedBody, attachment: messageAttachment, replyToMessageId: replyMessageId, clientRequestId, retry: Boolean(messageToRetry) }) }).catch(() => null)
        if (!response) {
            updateConversationMessages(selected.id, [{ ...optimistic, status: "send_uncertain", error: "Delivery is being confirmed." }])
            return
        }
        const result = await response.json().catch(() => null) as { message?: CommunicationMessage; error?: string; retryable?: boolean } | null
        if (result?.message) updateConversationMessages(selected.id, [result.message], false, acknowledgementRead, true)
        else if (!response.ok) updateConversationMessages(selected.id, [{ ...optimistic, status: result?.retryable ? "send_failed" : "send_uncertain", error: result?.error ?? "Could not send message", failedAt: result?.retryable ? new Date().toISOString() : null }])
    }

    const normalizedSearch = search.trim().toLowerCase()
    const visibleConversations = conversations.filter((conversation) => !normalizedSearch || `${conversation.title} ${conversation.subtitle ?? ""} ${conversation.messages.at(-1)?.body ?? ""}`.toLowerCase().includes(normalizedSearch))
    const peopleById = new Map(bootstrap.people.map((person) => [person.id, person]))
    const senderName = (message: CommunicationMessage) => message.senderKind === "automation"
        ? message.automationLabel ?? "Automation"
        : message.senderKind === "staff"
            ? (message.senderUserId === bootstrap.currentUser.id ? "You" : peopleById.get(message.senderUserId ?? "")?.name ?? "Team")
            : message.senderKind === "legacy" ? "Previous system" : selected?.title ?? "Client"
    const pinnedMessage = selected?.pinnedMessageId ? selected.messages.find((message) => message.id === selected.pinnedMessageId) ?? null : null
    const pinnedPreview = pinnedMessage ? messagePreview(pinnedMessage).split(/\r?\n/, 1)[0] : selected?.pinnedMessageId ? "Pinned message unavailable" : null

    return <section data-workspace-record-title={active ? selected?.title : undefined} aria-label="Client communications" className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-black">
        {!schemaReady ? <div className="shrink-0 border-b border-amber-900 bg-amber-950 px-4 py-2 text-center text-xs text-amber-100">The Communications database update must be applied before live sending and read tracking are available.</div> : null}

        <ResizableConversationColumns listWidth={conversationListWidth} onListWidthChange={onConversationListWidthChange}>
            <aside className={`${selected ? "hidden lg:flex" : "flex"} min-h-0 flex-col border-r border-neutral-800 bg-neutral-950`}>
                <div className="shrink-0 border-b border-neutral-800 p-3">
                    <div role="tablist" aria-label="Communication conversations" className="flex items-center gap-1">
                        <button type="button" role="tab" aria-selected="true" className="inline-flex h-8 items-center rounded-lg bg-neutral-800 px-3 text-xs font-semibold text-white">Clients</button>
                        <button type="button" role="tab" aria-selected="false" onClick={onOpenTeam} className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-medium text-neutral-400 hover:bg-neutral-900 hover:text-white">Team<UnreadMessageCount count={teamUnreadCount ?? 0} label="unread Team messages" /></button>
                        <span className="ml-auto"><CommunicationsConnectionStatus state={connection.state} error={connection.error} /></span>
                    </div>
                    <label className="relative mt-3 block"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600"><SearchIcon /></span><input ref={searchRef} type="search" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search conversations" placeholder="Search conversations" className="h-10 w-full rounded-lg border border-neutral-800 bg-black pl-9 pr-3 text-sm outline-none placeholder:text-neutral-600 focus:border-neutral-600" /></label>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{visibleConversations.length ? visibleConversations.map((conversation) => {
                    const latest = conversation.messages.at(-1)
                    const ownCursor = readCursors.find((cursor) => cursor.relationshipId === conversation.id && cursor.userId === bootstrap.currentUser.id)
                    const visiblyReading = conversation.id === selectedId && active && workspaceTabActive && documentVisible && atLatest
                    const unread = clientConversationUnreadCount(conversation, ownCursor, visiblyReading)
                    return <button key={conversation.id} type="button" onClick={() => selectConversation(conversation.id)} aria-current={selectedId === conversation.id ? "page" : undefined} className={`grid w-full grid-cols-[2.75rem_minmax(0,1fr)] gap-3 border-b border-neutral-900 px-4 py-3.5 text-left transition ${selectedId === conversation.id ? "bg-neutral-900" : "hover:bg-black"}`}>
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-800 text-sm font-semibold text-neutral-200">{initials(conversation.title)}</span>
                        <span className="min-w-0"><span className="flex min-w-0 items-start justify-between gap-3"><span className="min-w-0 flex-1 truncate text-sm font-semibold">{conversation.title}</span><span className="flex shrink-0 items-center gap-2">{conversation.isTest ? <SquarePill tone="yellow" className="!min-h-5 !px-2 !py-0.5 !text-[10px] !leading-3">Test</SquarePill> : null}{latest ? <time dateTime={latest.createdAt} className={`text-[11px] ${unread ? "text-white" : "text-neutral-600"}`}>{formatRelativeTime(latest.createdAt)}</time> : null}</span></span><span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-neutral-500">{latest?.direction === "outbound" ? <DeliveryTicks message={latest} /> : null}<span className="truncate">{latest?.body || "No messages yet"}</span>{unread ? <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-black">{unread}</span> : null}</span></span>
                    </button>
                }) : <div className="p-6 text-center"><p className="text-sm font-medium text-neutral-300">{conversations.length ? "No matching conversations" : "No clients yet"}</p><p className="mt-2 text-xs leading-5 text-neutral-600">{conversations.length ? "Try another name or message." : "Client relationships will appear here automatically."}</p></div>}</div>
            </aside>

            <NativeChatViewport className={`${selected ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-col overflow-hidden bg-black`}>
                {selected ? <>
                    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-3 sm:px-4">
                        <button type="button" onClick={() => selectConversation(null)} aria-label="Back to client chats" className="inline-flex h-10 w-10 items-center justify-center text-neutral-400 hover:text-white lg:hidden"><BackIcon /></button>
                        <Link href={`/${bootstrap.workspaceSlug}/relationships/${selected.id}`} aria-label={`Open ${selected.title} relationship`} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg outline-none hover:text-neutral-200 focus-visible:ring-2 focus-visible:ring-neutral-600">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-800 text-xs font-semibold">{initials(selected.title)}</span>
                            <span className="min-w-0"><span className="flex min-w-0 items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm font-semibold">{selected.title}</span>{selected.isTest ? <SquarePill tone="yellow" className="!min-h-5 !px-2 !py-0.5 !text-[10px] !leading-3">Test</SquarePill> : null}</span><span className="block truncate text-[11px] text-neutral-600">{selected.subtitle ?? "WhatsApp client"}</span></span>
                        </Link>
                        <CommunicationsConnectionStatus state={connection.state} error={connection.error} />
                    </header>
                    {selected.pinnedMessageId && pinnedPreview ? <PinnedMessageBar preview={pinnedPreview} onClick={() => jumpToMessage(selected.pinnedMessageId!)} /> : null}

                    <div className="relative min-h-0 flex-1">
                    <div ref={messagePaneRef} {...messagePaneInteractions} style={{ overflowAnchor: "none" }} className="h-full touch-pan-y overflow-x-hidden overflow-y-auto overscroll-x-none overscroll-y-contain bg-[radial-gradient(circle_at_top,_rgba(38,38,38,0.5),_transparent_38%)] px-3 py-5 sm:px-6">
                        <div className="mx-auto flex min-h-full w-full min-w-0 max-w-3xl flex-col gap-2 lg:max-w-none">
                            {selected.messages.length ? <div aria-hidden="true" className="mt-auto" /> : null}
                            {selected.messages.length ? selected.messages.map((message, index) => {
                            const showDay = index === 0 || !sameDay(selected.messages[index - 1].createdAt, message.createdAt)
                            const sender = senderName(message)
                            const repliedMessage = message.replyToMessageId
                                ? selected.messages.find((candidate) => candidate.id === message.replyToMessageId) ?? null
                                : message.replyToProviderMessageId
                                    ? selected.messages.find((candidate) => candidate.providerMessageId === message.replyToProviderMessageId) ?? null
                                    : null
                            const messageReactions = reactions.filter((reaction) => reaction.messageId === message.id)
                            const teamReaction = messageReactions.find((reaction) => reaction.direction === "outbound") ?? null
                            const canInteract = clientMessageSupportsReaction(message, reactionCutoff)
                            const swipeOffset = swipePosition?.id === message.id ? swipePosition.offset : 0
                            const isSticker = message.attachment?.kind === "sticker"
                            const isWhatsAppClientMessage = message.direction === "inbound" && usesWhatsApp(message)
                            const stickerSaved = Boolean(isSticker && stickers.some((sticker) => sticker.storagePath === message.attachment?.storagePath))
                            const canSaveAttachment = Boolean(message.attachment && (isSticker || message.senderUserId !== bootstrap.currentUser.id))
                            const saveAttachmentLabel = isSticker ? stickerSaved ? "Sticker saved" : savingStickerMessageId === message.id ? "Saving sticker" : "Save sticker" : `Download ${message.attachment?.fileName ?? "attachment"}`
                            const saveAttachmentDisabled = stickerSaved || savingStickerMessageId === message.id || downloadingMessageId === message.id
                            const canPin = message.clientRequestId !== message.id
                            const showActions = actionMessageId === message.id
                            const readers = readCursors.filter((cursor) => cursor.relationshipId === selected.id && cursor.userId !== message.senderUserId && cursor.lastReadAt >= message.createdAt).flatMap((cursor) => peopleById.get(cursor.userId) ?? [])
                            return <Fragment key={messageAnimationKey(message)}>
                                {showDay ? <div className="my-3 flex justify-center"><time dateTime={message.createdAt} className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-[10px] text-neutral-500">{messageDay(message.createdAt)}</time></div> : null}
                                <div data-message-interaction={message.id} className={`relative flex items-center gap-2 transition-[filter,opacity,transform] duration-150 ${message.direction === "outbound" ? "justify-end origin-right" : "justify-start origin-left"} ${replyingTo ? replyingTo.id === message.id ? "pointer-events-none z-10 scale-[1.03]" : "pointer-events-none opacity-30 blur-[1px]" : ""} ${enteringMessageIds.has(message.id) ? message.direction === "outbound" ? "betelgeze-message-enter-right" : "betelgeze-message-enter-left" : ""}`}>
                                    <span aria-hidden="true" style={{ opacity: Math.min(1, swipeOffset / 36) }} className="pointer-events-none absolute -inset-x-3 inset-y-0 bg-gradient-to-r from-white/20 via-white/5 to-transparent lg:hidden" />
                                    <span aria-hidden="true" style={{ top: "50%", opacity: Math.min(1, swipeOffset / 38), transform: `translateY(-50%) scale(${0.72 + Math.min(0.28, swipeOffset / 190)})` }} className="pointer-events-none absolute left-0 flex h-9 w-9 items-center justify-center rounded-full bg-neutral-800 text-white lg:hidden"><ReplyIcon className="h-5 w-5" /></span>
                                    {message.direction === "outbound" && showActions ? <div key={`${message.id}:${actionView}`} data-message-action-popup className="betelgeze-popup-enter absolute bottom-full right-0 z-20 mb-1"><MessageActionTray view={actionView} canInteract={canInteract} currentEmoji={teamReaction?.emoji ?? null} recentEmoji={recentReaction} onReact={(emoji) => void sendReaction(message, emoji)} onRecentEmoji={rememberRecentReaction} onReply={() => beginReply(message)} onCopy={() => void copyMessage(message)} onPin={canPin ? () => void togglePinnedMessage(message) : null} onShowReactions={() => setActionView("reactions")} pinned={selected.pinnedMessageId === message.id} side="right" onSave={canSaveAttachment ? () => void saveOrDownloadAttachment(message) : null} saveLabel={saveAttachmentLabel} saveDisabled={saveAttachmentDisabled} saveActive={stickerSaved} /></div> : null}
                                    <NativeMessageBubble
                                        video={message.attachment?.kind === "video"}
                                        role="button"
                                        tabIndex={0}
                                        aria-label={`Message from ${sender}. Right-click or long-press for message actions.`}
                                        onOpenActions={() => { setActionView("actions"); setActionMessageId(message.id) }}
                                        onTouchStart={(event) => {
                                            const touch = event.touches[0]
                                            swipeStartRef.current = touch ? { id: message.id, x: touch.clientX, y: touch.clientY, cancelled: false, maxDeltaX: 0, verticalAtMax: 0 } : null
                                            if (touch) setSwipePosition({ id: message.id, offset: 0, active: true })
                                        }}
                                        onTouchMove={(event) => {
                                            const start = swipeStartRef.current
                                            const touch = event.touches[0]
                                            if (!start || start.id !== message.id || !touch || start.cancelled) return
                                            const deltaX = touch.clientX - start.x
                                            const deltaY = touch.clientY - start.y
                                            if (deltaX > start.maxDeltaX) {
                                                start.maxDeltaX = deltaX
                                                start.verticalAtMax = Math.abs(deltaY)
                                            }
                                            if (Math.abs(deltaY) > Math.abs(deltaX) * 1.5 && Math.abs(deltaY) > 12) {
                                                start.cancelled = true
                                                setSwipePosition({ id: message.id, offset: 0, active: false })
                                                return
                                            }
                                            if (deltaX > 0) {
                                                event.preventDefault()
                                                setSwipePosition({ id: message.id, offset: Math.min(82, deltaX * 0.78), active: true })
                                            }
                                        }}
                                        onTouchEnd={(event) => {
                                            const start = swipeStartRef.current
                                            const touch = event.changedTouches[0]
                                            swipeStartRef.current = null
                                            if (start && touch && touch.clientX - start.x > start.maxDeltaX) {
                                                start.maxDeltaX = touch.clientX - start.x
                                                start.verticalAtMax = Math.abs(touch.clientY - start.y)
                                            }
                                            const completed = Boolean(start && !start.cancelled && start.maxDeltaX > 52 && start.verticalAtMax < 42)
                                            setSwipePosition({ id: message.id, offset: 0, active: false })
                                            window.setTimeout(() => setSwipePosition((current) => current?.id === message.id && !current.active ? null : current), 180)
                                            if (completed) {

                                                beginReply(message)
                                            }
                                        }}
                                        onTouchCancel={() => {
                                            swipeStartRef.current = null
                                            setSwipePosition({ id: message.id, offset: 0, active: false })
                                            window.setTimeout(() => setSwipePosition((current) => current?.id === message.id && !current.active ? null : current), 220)
                                        }}
                                        style={{ transform: `translate3d(${swipeOffset}px,0,0)`, transition: swipePosition?.id === message.id && swipePosition.active ? "none" : "transform 220ms cubic-bezier(.22,1,.36,1)", willChange: swipePosition?.id === message.id ? "transform" : undefined }}
                                        className={`${isSticker ? "relative max-w-52 bg-transparent p-0 pb-1 shadow-none" : `max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm sm:max-w-[72%] ${message.direction === "outbound" ? "rounded-br-md" : "rounded-bl-md"} ${isWhatsAppClientMessage ? "bg-[#154D37] text-white" : message.direction === "outbound" ? "bg-neutral-100 text-neutral-950" : "border border-neutral-800 bg-neutral-900 text-neutral-100"}`} min-w-0 touch-pan-y cursor-pointer outline-none ring-offset-2 ring-offset-black focus-visible:ring-2 focus-visible:ring-neutral-500`}
                                    >
                                        <p className={`${isSticker ? "mb-1 w-fit rounded-full bg-neutral-950/80 px-2 py-0.5 text-neutral-400" : `mb-0.5 leading-none ${isWhatsAppClientMessage ? "text-white/70" : "text-neutral-500"}`} text-[10px] font-semibold`}>{sender}</p>
                                        {message.replyToMessageId || message.replyToProviderMessageId ? <button type="button" disabled={!repliedMessage} aria-label="Jump to replied message" onPointerDown={(event) => { if (event.button === 0) event.preventDefault() }} onClick={(event) => { event.stopPropagation(); if (repliedMessage) jumpToMessage(repliedMessage.id) }} className={`block w-full text-left disabled:cursor-default focus-visible:outline focus-visible:outline-2 mb-2 rounded-lg border-l-2 px-2.5 py-2 ${isWhatsAppClientMessage ? "border-white/40 bg-black/20" : message.direction === "outbound" ? "border-neutral-500 bg-black/10" : "border-neutral-500 bg-black/35"}`}><p className="truncate text-[10px] font-semibold opacity-70">{repliedMessage ? senderName(repliedMessage) : "Replied message"}</p><p className="mt-0.5 truncate text-xs opacity-65">{repliedMessage ? messagePreview(repliedMessage) : "Message unavailable"}</p></button> : null}
                                        {message.attachment ? <MessageAttachment attachment={message.attachment} onOpenImage={setPreviewMedia} light={message.direction === "outbound"} whiteOnColor={isWhatsAppClientMessage} /> : null}
                                        {message.body && !(message.attachment && message.body === attachmentPlaceholder(message.attachment)) ? <MessageBody body={message.body} /> : null}
                                        {isSticker && messageReactions.length ? <div className={`absolute bottom-5 z-10 flex gap-0.5 ${message.direction === "outbound" ? "right-0" : "left-0"}`}>{messageReactions.map((reaction) => <span key={`${reaction.messageId}:${reaction.direction}`} title={reaction.direction === "inbound" ? `Reacted by ${selected.title}` : `Reacted in Betelgeze by ${peopleById.get(reaction.reactorUserId ?? "")?.name ?? "Team"}`} className="rounded-full border border-neutral-800 bg-neutral-950 px-1.5 py-0.5 text-sm shadow-sm">{reaction.emoji}</span>)}</div> : null}
                                        <div className={`mt-1.5 flex items-center justify-between gap-3 text-[10px] ${isSticker ? "ml-auto min-w-20 rounded-full bg-neutral-950/80 px-2 py-0.5 text-neutral-400" : isWhatsAppClientMessage ? "text-white/65" : message.direction === "outbound" ? "text-neutral-500" : "text-neutral-600"}`}><MessageReadAvatars readers={readers} /><span className="flex shrink-0 items-center gap-1.5"><time dateTime={message.createdAt}>{messageTime(message.createdAt)}</time>{message.direction === "outbound" ? <DeliveryTicks message={message} /> : null}</span></div>
                                        {message.error ? <p className={`mt-1 text-[10px] ${message.status === "send_failed" || message.status === "delivery_failed" ? "text-red-600" : "text-amber-700"}`}>{message.error}</p> : null}
                                        {["send_failed", "partial_sent"].includes(message.status) && message.clientRequestId ? <button type="button" onClick={() => void sendMessage(message)} className="mt-2 text-xs font-semibold underline underline-offset-2">Retry failed channel{message.status === "partial_sent" ? "" : "s"}</button> : null}
                                    </NativeMessageBubble>
                                    {message.direction === "inbound" && showActions ? <div key={`${message.id}:${actionView}`} data-message-action-popup className="betelgeze-popup-enter absolute bottom-full left-0 z-20 mb-1"><MessageActionTray view={actionView} canInteract={canInteract} currentEmoji={teamReaction?.emoji ?? null} recentEmoji={recentReaction} onReact={(emoji) => void sendReaction(message, emoji)} onRecentEmoji={rememberRecentReaction} onReply={() => beginReply(message)} onCopy={() => void copyMessage(message)} onPin={canPin ? () => void togglePinnedMessage(message) : null} onShowReactions={() => setActionView("reactions")} pinned={selected.pinnedMessageId === message.id} side="left" onSave={canSaveAttachment ? () => void saveOrDownloadAttachment(message) : null} saveLabel={saveAttachmentLabel} saveDisabled={saveAttachmentDisabled} saveActive={stickerSaved} /></div> : null}
                                </div>
                                {!isSticker && messageReactions.length ? <div className={`flex gap-1 px-1 ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}>{messageReactions.map((reaction) => <span key={`${reaction.messageId}:${reaction.direction}`} title={reaction.direction === "inbound" ? `Reacted by ${selected.title}` : `Reacted in Betelgeze by ${peopleById.get(reaction.reactorUserId ?? "")?.name ?? "Team"}`} className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-sm shadow-sm">{reaction.emoji}</span>)}</div> : null}
                            </Fragment>
                        }) : <div className="flex min-h-64 items-center justify-center text-center"><div><p className="text-sm font-medium text-neutral-300">Start the conversation</p><p className="mt-2 text-xs text-neutral-600">Messages sent here use this relationship&apos;s connected SMS and WhatsApp channels.</p></div></div>}</div>
                    </div>
                    {showJumpToLatest ? <JumpToLatestButton onClick={() => { followLatestRef.current = true; setAtLatest(true); messagePaneRef.current?.scrollTo({ top: messagePaneRef.current.scrollHeight, left: 0, behavior: "instant" }) }} /> : null}
                    </div>

                    <ComposerFooter className="relative z-10 shrink-0 touch-manipulation border-t border-neutral-800 bg-neutral-950 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:p-4">
                        {replyingTo ? <ComposerMessagePreview label={`Replying to ${senderName(replyingTo)}`} preview={messagePreview(replyingTo)} onCancel={() => { setReplyingTo(null); composerRef.current?.focus({ preventScroll: true }) }} /> : null}
                        {attachment || attachmentState === "uploading" || attachmentError ? <div className="mx-auto mb-2 flex max-w-3xl items-center gap-3 rounded-xl border border-neutral-800 bg-black px-3 py-2 text-xs"><span className="text-lg">{attachment?.kind === "image" ? "▧" : attachment?.kind === "video" ? "▶" : "↗"}</span><span className="min-w-0 flex-1"><span className="block truncate font-medium text-neutral-200">{attachmentState === "uploading" ? "Uploading attachment…" : attachment?.fileName ?? "Attachment failed"}</span><span className={`mt-0.5 block text-[10px] ${attachmentError ? "text-red-400" : "text-neutral-600"}`}>{attachmentError ?? formatFileSize(attachment?.size ?? null)}</span></span>{attachment ? <button type="button" onClick={() => void removeAttachment()} aria-label="Remove attachment" className="h-8 w-8 text-neutral-500 hover:text-white">×</button> : null}</div> : null}
                        {stickerTrayOpen ? <div className="mx-auto mb-2 max-w-3xl rounded-2xl border border-neutral-800 bg-black p-3 shadow-2xl">
                            <div className="flex items-center justify-between"><div><p className="text-xs font-semibold text-neutral-200">Stickers</p><p className="mt-0.5 text-[10px] text-neutral-600">JPEG and PNG images are converted automatically.</p></div><button type="button" onClick={() => setStickerTrayOpen(false)} aria-label="Close sticker tray" className="h-8 w-8 text-neutral-500 hover:text-white">×</button></div>
                            <div data-composer-scroll className="mt-3 grid max-h-52 grid-cols-4 gap-2 overflow-y-auto overscroll-y-none sm:grid-cols-7">
                                {stickers.map((sticker) => <button key={sticker.id} type="button" onClick={() => void sendSticker(sticker)} disabled={!selected.canSend} title={sticker.fileName} className="flex aspect-square items-center justify-center rounded-xl bg-neutral-950 p-1.5 hover:bg-neutral-900 disabled:opacity-40"><Image unoptimized src={sticker.url} alt={sticker.fileName} width={512} height={512} className="h-full w-full object-contain" /></button>)}
                                <button type="button" onClick={() => stickerInputRef.current?.click()} disabled={stickerUploadState === "uploading"} className="flex aspect-square flex-col items-center justify-center rounded-xl border border-dashed border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-white disabled:opacity-40"><span className="text-2xl">+</span><span className="mt-1 text-[9px]">{stickerUploadState === "uploading" ? "Converting…" : "Add sticker"}</span></button>
                            </div>
                        </div> : null}
                        {interactionError ? <div className="mx-auto mb-2 flex max-w-3xl items-center justify-between gap-3 rounded-lg bg-red-950/60 px-3 py-2 text-xs text-red-300"><span>{interactionError}</span><button type="button" onClick={() => setInteractionError(null)} aria-label="Dismiss interaction error">×</button></div> : null}
                        <input ref={attachmentInputRef} type="file" accept="image/jpeg,image/png,video/mp4,video/3gpp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAttachment(file) }} />
                        <input ref={stickerInputRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadSticker(file) }} />
                        <MessageComposer
                            textareaRef={composerRef}
                            draft={draft}
                            placeholder={selected.canSend ? `Message ${selected.title}` : "Add a phone number and connect SMS or WhatsApp"}
                            disabled={!schemaReady || !selected.canSend}
                            sendDisabled={(!draft.trim() && !attachment) || attachmentState === "uploading" || !schemaReady || !selected.canSend}
                            onDraftChange={handleClientDraftChange}
                            onBlur={clearPendingWhatsAppTyping}
                            onSend={() => void sendMessage()}
                            leadingActions={<>
                                <button data-icon-button type="button" onClick={() => attachmentInputRef.current?.click()} disabled={!schemaReady || !selected.canSend || attachmentState === "uploading"} aria-label="Attach image or file" className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-neutral-500 hover:text-white disabled:text-neutral-800 lg:h-9 lg:w-9"><AttachmentIcon /></button>
                                <button data-icon-button type="button" onClick={() => { setStickerTrayOpen((current) => !current); setInteractionError(null) }} disabled={!schemaReady || !selected.canSend} aria-label="Open sticker tray" className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-neutral-500 hover:text-white disabled:text-neutral-800 lg:h-9 lg:w-9"><StickerIcon /></button>
                            </>}
                        />
                    </ComposerFooter>
                </> : <div className="flex flex-1 items-center justify-center p-6 text-center"><div><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950 text-xl">◌</div><h2 className="mt-4 text-sm font-semibold">Select a client chat</h2><p className="mt-2 text-xs text-neutral-600">Messages update here without reloading the panel.</p></div></div>}
            </NativeChatViewport>
        </ResizableConversationColumns>
        <MessageMediaLightbox media={previewMedia} onClose={() => setPreviewMedia(null)} />
    </section>
}
