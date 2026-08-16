"use client"

import Image from "next/image"
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Avatar } from "@/components/account/Avatar"
import { copyMessageText, MessageReactionActions, PrimaryMessageActions, type MessageActionView } from "@/components/communications/MessageActionMenu"
import { DeleteIcon, DoubleDeliveryCheckIcon, ReplyIcon } from "@/components/communications/MessageInteractionIcons"
import { JumpToLatestButton, messagePaneCanShowNewMessage, messagePaneIsAwayFromBottom } from "@/components/communications/JumpToLatestButton"
import { MessageMediaLightbox, type MessageMediaPreview } from "@/components/communications/MessageMediaLightbox"
import { PinnedMessageBar } from "@/components/communications/PinnedMessageBar"
import { ResizableConversationColumns } from "@/components/communications/ResizableConversationColumns"
import { VoiceNotePlayer } from "@/components/communications/VoiceNotePlayer"
import { keepComposerCurrentLineCentered } from "@/components/communications/composer-scroll"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"
import { formatRelativeTime } from "@/lib/ui/relative-time"
import { openWorkspaceMemberProfile } from "@/lib/workspace-member-profile"
import type { CommunicationAttachment, CommunicationSticker } from "@/lib/communications/types"
import type { NativeCommunicationsBootstrap, NativeConversation, NativeMessage, WorkspaceTeam } from "@/lib/teams/types"

function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function text(value: unknown) { return typeof value === "string" && value ? value : null }
function messageTime(value: string) { return new Intl.DateTimeFormat("en-IE", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) }
function messageDay(value: string) { return new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) }
function sameDay(left: string, right: string) { return new Date(left).toDateString() === new Date(right).toDateString() }
function attachmentPreview(attachment: CommunicationAttachment | null) { return attachment ? `${attachment.kind === "image" ? "Image" : attachment.kind === "video" ? "Video" : attachment.kind === "audio" ? "Voice note" : attachment.kind === "sticker" ? "Sticker" : "File"}: ${attachment.fileName}` : "" }
function messagePreview(message: NativeMessage) { return message.body || attachmentPreview(message.attachment) || "Message" }

function NativeDeliveryTicks({ message, read }: { message: NativeMessage; read: boolean }) {
    if (message.clientRequestId === message.id) return <span className="font-bold" title="Sending" aria-label="Sending">✓</span>
    return <span className={`inline-flex shrink-0 ${read ? "text-sky-500" : ""}`} title={read ? "Read" : "Delivered to account"} aria-label={read ? "Read" : "Delivered to account"}><DoubleDeliveryCheckIcon /></span>
}

function SearchIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg> }
function BackIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="m15 6-6 6 6 6" /></svg> }
function SendIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="m4 4 17 8-17 8 3-8-3-8Z" /><path d="M7 12h14" /></svg> }
function AttachmentIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="m8.5 12.5 6.8-6.8a3 3 0 0 1 4.2 4.2l-9.2 9.2a5 5 0 0 1-7.1-7.1l9-9" /></svg> }
function StickerIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="M5 3h10a4 4 0 0 1 4 4v7l-7 7H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M12 21v-5a2 2 0 0 1 2-2h5" /><path d="M7 9h.01M15 9h.01M8 13c1.5 1.2 6.5 1.2 8 0" /></svg> }
function TeamIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><circle cx="8" cy="8" r="3" /><circle cx="16" cy="9" r="2.5" /><path d="M3 19c0-3 2-5 5-5s5 2 5 5" /><path d="M13 15c1-.8 2-1.2 3.5-1 2.5.3 4 2.1 4 4.5" /></svg> }

function NativeAttachment({ attachment, onOpenImage, light }: { attachment: CommunicationAttachment; onOpenImage: (media: MessageMediaPreview) => void; light: boolean }) {
    if (attachment.kind === "sticker") return <Image unoptimized src={attachment.url} alt={attachment.fileName} width={512} height={512} className="h-auto max-h-48 w-auto max-w-48 object-contain drop-shadow-lg" />
    if (attachment.kind === "image") return <button type="button" onClick={(event) => { event.stopPropagation(); onOpenImage({ url: attachment.url, alt: attachment.fileName }) }} aria-label={`Open ${attachment.fileName}`} className="mb-2 block w-full overflow-hidden rounded-xl bg-black/10"><Image unoptimized src={attachment.url} alt={attachment.fileName} width={800} height={600} className="max-h-80 h-auto w-full object-contain" /></button>
    if (attachment.kind === "video") return <video src={attachment.url} controls preload="metadata" className="mb-2 max-h-80 w-full rounded-xl bg-black" />
    if (attachment.kind === "audio") return <VoiceNotePlayer src={attachment.url} fileName={attachment.fileName} light={light} />
    return <a href={attachment.url} target="_blank" rel="noreferrer" className="mb-2 flex items-center gap-3 rounded-xl border border-current/10 bg-black/5 px-3 py-2.5 hover:bg-black/10"><span className="text-xl">↗</span><span className="min-w-0"><span className="block truncate text-xs font-semibold">{attachment.fileName}</span><span className="mt-0.5 block text-[10px] opacity-60">{attachment.size ? `${Math.max(1, Math.round(attachment.size / 1024))}KB` : "Attachment"}</span></span></a>
}

function MessageText({ body }: { body: string }) {
    const parts = body.split(/(https?:\/\/[^\s)]+)/g)
    return <p className="whitespace-pre-wrap break-words leading-5">{parts.map((part, index) => /^https?:\/\//.test(part) ? <a key={`${part}:${index}`} href={part} target="_blank" rel="noreferrer" className="underline decoration-current/40 underline-offset-2">{part}</a> : <Fragment key={index}>{part}</Fragment>)}</p>
}

function TeamAvatar({ conversation, currentUserId }: { conversation: NativeConversation; currentUserId: string }) {
    if (conversation.kind === "team") return <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-800 text-neutral-300"><TeamIcon /></span>
    const profileUserId = conversation.memberIds.find((id) => id !== currentUserId)
    return <span role="button" tabIndex={0} aria-label={`Open ${conversation.title} profile`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (profileUserId) openWorkspaceMemberProfile(profileUserId) }} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && profileUserId) { event.preventDefault(); event.stopPropagation(); openWorkspaceMemberProfile(profileUserId) } }} className="h-11 w-11 shrink-0 overflow-hidden rounded-full outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"><Avatar src={conversation.avatarSrc} name={conversation.title} className="h-full w-full" /></span>
}

function TeamEditor({ bootstrap, team, onClose, onSaved }: { bootstrap: NativeCommunicationsBootstrap; team: WorkspaceTeam | null | undefined; onClose: () => void; onSaved: () => Promise<void> }) {
    const creating = team === null
    const selected = team ?? { id: "", name: "", kind: "custom" as const, archivedAt: null, memberIds: [], responsibilities: [], maintenanceResponsibilities: [] }
    const editable = creating ? bootstrap.canManageTeams : selected.kind === "custom" ? bootstrap.canManageTeams && !selected.archivedAt : selected.kind === "maintenance" ? bootstrap.isOwner : false
    const [name, setName] = useState(selected.name)
    const [memberIds, setMemberIds] = useState(selected.memberIds)
    const [responsibilities, setResponsibilities] = useState<Record<string, string>>(() => Object.fromEntries(selected.responsibilities.map((item) => [item.serviceId, item.userId])))
    const [maintenance, setMaintenance] = useState<Record<string, string>>(() => Object.fromEntries(selected.maintenanceResponsibilities.map((item) => [item.category, item.userId])))
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const peopleById = new Map(bootstrap.people.map((person) => [person.id, person]))
    const responsibilitiesComplete = selected.kind !== "custom" || bootstrap.services.every((service) => responsibilities[service.id] && memberIds.includes(responsibilities[service.id]))
    const maintenanceComplete = selected.kind !== "maintenance" || bootstrap.maintenanceCategories.every((category) => maintenance[category.key] && memberIds.includes(maintenance[category.key]))

    function toggleMember(userId: string) {
        if (!editable) return
        setMemberIds((current) => current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId])
    }

    async function save() {
        if (!editable || pending) return
        setPending(true); setError(null)
        const response = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/teams`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: creating ? "create" : "update", teamId: selected.id, name, memberIds, responsibilities: Object.entries(responsibilities).filter(([, userId]) => memberIds.includes(userId)).map(([serviceId, userId]) => ({ serviceId, userId })), maintenanceResponsibilities: Object.entries(maintenance).filter(([, userId]) => memberIds.includes(userId)).map(([category, userId]) => ({ category, userId })) }) })
        const result = await response.json().catch(() => null) as { error?: string } | null
        if (!response.ok) { setError(result?.error ?? "Could not save team."); setPending(false); return }
        await onSaved(); onClose()
    }

    async function archive() {
        if (!team || team.kind !== "custom" || !bootstrap.canManageTeams || pending) return
        setPending(true); setError(null)
        const response = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/teams`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "archive", teamId: team.id, memberIds: team.memberIds }) })
        const result = await response.json().catch(() => null) as { error?: string } | null
        if (!response.ok) { setError(result?.error ?? "Could not archive team."); setPending(false); return }
        await onSaved(); onClose()
    }

    return <div role="dialog" aria-modal="true" aria-labelledby="team-editor-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }} className="fixed inset-0 z-[140] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
        <div className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-950 text-white shadow-2xl">
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-neutral-800 bg-neutral-950 px-5 py-4"><div><p className="text-xs uppercase tracking-wide text-neutral-500">{creating ? "New team" : selected.kind === "admins" ? "Required team" : selected.kind === "maintenance" ? "Maintenance routing" : selected.archivedAt ? "Archived team" : "Team settings"}</p><h2 id="team-editor-title" className="mt-1 text-xl font-semibold">{creating ? "Create team" : selected.name}</h2></div><button type="button" onClick={onClose} className="h-9 w-9 rounded-full text-xl text-neutral-500 hover:bg-neutral-900 hover:text-white">×</button></header>
            <div className="space-y-6 p-5">
                {selected.kind === "admins" ? <p className="rounded-xl border border-neutral-800 bg-black px-4 py-3 text-sm leading-6 text-neutral-400">Admins membership is synchronized from workspace roles. Add or remove admins in Settings → Users.</p> : null}
                {selected.archivedAt ? <p className="rounded-xl border border-neutral-800 bg-black px-4 py-3 text-sm text-neutral-400">This archived team and its conversation are read-only.</p> : null}
                {selected.kind === "custom" ? <label className="block text-sm text-neutral-300">Team name<input value={name} onChange={(event) => setName(event.target.value)} disabled={!editable} maxLength={80} className="mt-2 h-11 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white disabled:opacity-60" /></label> : null}
                <section><h3 className="text-sm font-semibold">Members</h3><div className="mt-3 grid gap-2 sm:grid-cols-2">{bootstrap.people.map((person) => { const checked = memberIds.includes(person.id); return <button key={person.id} type="button" disabled={!editable} onClick={() => toggleMember(person.id)} className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 text-left ${checked ? "border-neutral-600 bg-neutral-900" : "border-neutral-800 bg-black"} disabled:cursor-default`}><span role="button" tabIndex={0} aria-label={`Open ${person.name} profile`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); openWorkspaceMemberProfile(person.id) }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); openWorkspaceMemberProfile(person.id) } }} className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"><Avatar src={person.avatarSrc} name={person.name} className="h-8 w-8" /></span><span className="min-w-0 flex-1 truncate text-sm">{person.name}</span><span className={checked ? "text-emerald-400" : "text-neutral-700"}>{checked ? "✓" : "○"}</span></button> })}</div></section>
                {selected.kind === "custom" ? <section><h3 className="text-sm font-semibold">Service responsibilities</h3><p className="mt-1 text-xs leading-5 text-neutral-500">Map every active service to exactly one selected member. New work always uses the team’s current map.</p><div className="mt-3 space-y-2">{bootstrap.services.map((service) => <label key={service.id} className="grid items-center gap-2 rounded-xl border border-neutral-800 bg-black px-3 py-2 sm:grid-cols-[minmax(0,1fr)_14rem]"><span className="truncate text-sm text-neutral-300">{service.name}</span><select disabled={!editable} value={responsibilities[service.id] ?? ""} onChange={(event) => setResponsibilities((current) => ({ ...current, [service.id]: event.target.value }))} className="h-9 rounded-lg border border-neutral-700 bg-neutral-950 px-2 text-sm"><option value="">Choose member</option>{memberIds.map((id) => <option key={id} value={id}>{peopleById.get(id)?.name ?? "Member"}</option>)}</select></label>)}</div></section> : null}
                {selected.kind === "maintenance" ? <section><h3 className="text-sm font-semibold">Category responsibilities</h3><p className="mt-1 text-xs leading-5 text-neutral-500">Every category has one responsible Maintenance member while the whole team retains the shared chat.</p><div className="mt-3 space-y-2">{bootstrap.maintenanceCategories.map((category) => <label key={category.key} className="grid items-center gap-2 rounded-xl border border-neutral-800 bg-black px-3 py-2 sm:grid-cols-[minmax(0,1fr)_14rem]"><span className="truncate text-sm text-neutral-300">{category.label}</span><select disabled={!editable} value={maintenance[category.key] ?? ""} onChange={(event) => setMaintenance((current) => ({ ...current, [category.key]: event.target.value }))} className="h-9 rounded-lg border border-neutral-700 bg-neutral-950 px-2 text-sm"><option value="">Choose member</option>{memberIds.map((id) => <option key={id} value={id}>{peopleById.get(id)?.name ?? "Member"}</option>)}</select></label>)}</div></section> : null}
                {error ? <p className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p> : null}
                {editable ? <div className="flex items-center justify-between gap-3 border-t border-neutral-800 pt-4">{team?.kind === "custom" ? <button type="button" onClick={() => void archive()} disabled={pending} className="h-10 rounded-lg px-3 text-sm text-red-300 hover:bg-red-500/10">Archive team</button> : <span />}<button type="button" onClick={() => void save()} disabled={pending || !name.trim() || !memberIds.length || !responsibilitiesComplete || !maintenanceComplete} className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-40">{pending ? "Saving…" : creating ? "Create team" : "Save team"}</button></div> : null}
            </div>
        </div>
    </div>
}

function mergeMessages(current: NativeMessage[], incoming: NativeMessage[]) {
    const keyed = new Map<string, NativeMessage>()
    for (const message of [...current, ...incoming]) keyed.set(message.clientRequestId ? `request:${message.clientRequestId}` : `id:${message.id}`, { ...(keyed.get(message.clientRequestId ? `request:${message.clientRequestId}` : `id:${message.id}`) ?? {}), ...message } as NativeMessage)
    return [...keyed.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

function messageAnimationKey(message: NativeMessage) {
    return message.clientRequestId ? `request:${message.clientRequestId}` : `id:${message.id}`
}

function realtimeMessage(value: unknown): NativeMessage | null {
    const row = record(value); const id = text(row.id); const conversationId = text(row.conversation_id); const senderUserId = text(row.sender_user_id); const createdAt = text(row.created_at)
    if (!id || !conversationId || !senderUserId || !createdAt) return null
    const attachment = row.attachment && typeof row.attachment === "object" && !Array.isArray(row.attachment) ? row.attachment as CommunicationAttachment : null
    return { id, clientRequestId: text(row.client_request_id), conversationId, senderUserId, body: typeof row.body === "string" ? row.body : "", replyToMessageId: text(row.reply_to_message_id), attachment, createdAt }
}

export function TeamCommunicationsWorkspace({ bootstrap, onOpenClients }: { bootstrap: NativeCommunicationsBootstrap; onOpenClients: () => void }) {
    const supabase = useMemo(() => createSupabaseBrowserClient(), [])
    const [conversations, setConversations] = useState(bootstrap.conversations)
    const [teams, setTeams] = useState(bootstrap.teams)
    const [reactions, setReactions] = useState(bootstrap.reactions)
    const [readCursors, setReadCursors] = useState(bootstrap.readCursors)
    const [selectedId, setSelectedId] = useState(bootstrap.requestedConversationId)
    const [search, setSearch] = useState("")
    const [showArchived, setShowArchived] = useState(false)
    const [draft, setDraft] = useState("")
    const [replyingTo, setReplyingTo] = useState<NativeMessage | null>(null)
    const [attachment, setAttachment] = useState<CommunicationAttachment | null>(null)
    const [attachmentState, setAttachmentState] = useState<"idle" | "uploading">("idle")
    const [stickers, setStickers] = useState(bootstrap.stickers)
    const [stickerTrayOpen, setStickerTrayOpen] = useState(false)
    const [stickerUploadState, setStickerUploadState] = useState<"idle" | "uploading">("idle")
    const [error, setError] = useState<string | null>(null)
    const [actionMessageId, setActionMessageId] = useState<string | null>(null)
    const [actionView, setActionView] = useState<MessageActionView>("actions")
    const [recentReaction, setRecentReaction] = useState<string | null>(null)
    const [swipePosition, setSwipePosition] = useState<{ id: string; offset: number; active: boolean } | null>(null)
    const [previewMedia, setPreviewMedia] = useState<MessageMediaPreview | null>(null)
    const [editingTeam, setEditingTeam] = useState<WorkspaceTeam | null | undefined>(undefined)
    const [showJumpToLatest, setShowJumpToLatest] = useState(false)
    const [enteringMessageIds, setEnteringMessageIds] = useState<Set<string>>(() => new Set())
    const messagePaneRef = useRef<HTMLDivElement | null>(null)
    const followLatestRef = useRef(true)
    const messageAnimationTimersRef = useRef<number[]>([])
    const knownMessageKeysRef = useRef(new Set(bootstrap.conversations.flatMap((conversation) => conversation.messages.map(messageAnimationKey))))
    const composerRef = useRef<HTMLTextAreaElement | null>(null)
    const attachmentInputRef = useRef<HTMLInputElement | null>(null)
    const stickerInputRef = useRef<HTMLInputElement | null>(null)
    const swipeStartRef = useRef<{ id: string; x: number; y: number; cancelled: boolean; maxDeltaX: number; minDeltaX: number; verticalAtMax: number; verticalAtMin: number } | null>(null)
    const swipedMessageRef = useRef<string | null>(null)
    const dismissedActionMessageRef = useRef<string | null>(null)
    const selectedRef = useRef(selectedId)
    const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null
    const peopleById = useMemo(() => new Map(bootstrap.people.map((person) => [person.id, person])), [bootstrap.people])

    useEffect(() => { selectedRef.current = selectedId }, [selectedId])
    useEffect(() => { const timer = window.setTimeout(() => setRecentReaction(localStorage.getItem(`betelgeze:communications:recent-reaction:${bootstrap.workspaceId}`)), 0); return () => window.clearTimeout(timer) }, [bootstrap.workspaceId])
    useEffect(() => { keepComposerCurrentLineCentered(composerRef.current) }, [draft])
    useEffect(() => {
        const resizeComposer = () => keepComposerCurrentLineCentered(composerRef.current)
        window.addEventListener("resize", resizeComposer)
        return () => window.removeEventListener("resize", resizeComposer)
    }, [])

    useEffect(() => () => messageAnimationTimersRef.current.forEach((timer) => window.clearTimeout(timer)), [])

    useEffect(() => {
        if (!actionMessageId) return
        const dismiss = (event: PointerEvent) => {
            const target = event.target instanceof Element ? event.target : null
            if (target?.closest("[data-message-action-popup]")) return
            if (target?.closest(`[data-message-interaction="${actionMessageId}"]`)) dismissedActionMessageRef.current = actionMessageId
            setActionMessageId(null)
        }
        const documents = [document]
        try { if (window.parent !== window) documents.push(window.parent.document) } catch { /* Cross-origin shells cannot be observed. */ }
        documents.forEach((ownerDocument) => ownerDocument.addEventListener("pointerdown", dismiss, true))
        return () => documents.forEach((ownerDocument) => ownerDocument.removeEventListener("pointerdown", dismiss, true))
    }, [actionMessageId])

    const updateConversationMessages = useCallback((conversationId: string, incoming: NativeMessage[], animate = false) => {
        const newMessages = incoming.filter((message) => !knownMessageKeysRef.current.has(messageAnimationKey(message)))
        incoming.forEach((message) => knownMessageKeysRef.current.add(messageAnimationKey(message)))
        if (animate && newMessages.length && selectedRef.current === conversationId && messagePaneCanShowNewMessage(messagePaneRef.current, followLatestRef.current)) {
            const ids = newMessages.map((message) => message.id)
            setEnteringMessageIds((current) => new Set([...current, ...ids]))
            const timer = window.setTimeout(() => {
                setEnteringMessageIds((current) => new Set([...current].filter((id) => !ids.includes(id))))
                messageAnimationTimersRef.current = messageAnimationTimersRef.current.filter((candidate) => candidate !== timer)
            }, 320)
            messageAnimationTimersRef.current.push(timer)
        }
        setConversations((current) => current.map((conversation) => conversation.id === conversationId ? { ...conversation, messages: mergeMessages(conversation.messages, incoming), updatedAt: incoming.at(-1)?.createdAt ?? conversation.updatedAt } : conversation).sort((left, right) => (right.messages.at(-1)?.createdAt ?? right.updatedAt).localeCompare(left.messages.at(-1)?.createdAt ?? left.updatedAt)))
    }, [])

    const refresh = useCallback(async (selectId?: string | null) => {
        const response = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/conversations`)
        const next = await response.json().catch(() => null) as NativeCommunicationsBootstrap | null
        if (!response.ok || !next) throw new Error("Could not refresh team conversations.")
        setConversations(next.conversations); setTeams(next.teams); setReactions(next.reactions); setReadCursors(next.readCursors); setStickers(next.stickers)
        setSelectedId((current) => {
            const requested = selectId ?? current
            return requested && next.conversations.some((conversation) => conversation.id === requested) ? requested : null
        })
    }, [bootstrap.workspaceSlug])

    useEffect(() => {
        if (!bootstrap.requestedDmUserId) return
        let cancelled = false
        void fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/conversations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: bootstrap.requestedDmUserId }) })
            .then(async (response) => { const result = await response.json().catch(() => null) as { conversationId?: string; error?: string } | null; if (!response.ok || !result?.conversationId) throw new Error(result?.error ?? "Could not open direct message."); if (!cancelled) await refresh(result.conversationId) })
            .catch((openError) => { if (!cancelled) setError(openError instanceof Error ? openError.message : "Could not open direct message.") })
        return () => { cancelled = true }
    }, [bootstrap.requestedDmUserId, bootstrap.workspaceSlug, refresh])

    function selectConversation(id: string | null) {
        followLatestRef.current = true; setShowJumpToLatest(false)
        setSelectedId(id); setReplyingTo(null); setActionMessageId(null); setActionView("actions"); setAttachment(null); setError(null)
        setDraft(id ? localStorage.getItem(`betelgeze:native-chat:draft:${bootstrap.workspaceId}:${id}`) ?? "" : "")
        const url = new URL(window.location.href)
        if (id) url.searchParams.set("nativeConversation", id); else url.searchParams.delete("nativeConversation")
        url.searchParams.delete("dm")
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
    }

    useEffect(() => { if (selectedId) localStorage.setItem(`betelgeze:native-chat:draft:${bootstrap.workspaceId}:${selectedId}`, draft) }, [bootstrap.workspaceId, draft, selectedId])
    useEffect(() => { if (selectedId && followLatestRef.current) window.requestAnimationFrame(() => messagePaneRef.current?.scrollTo({ top: messagePaneRef.current.scrollHeight, left: 0 })) }, [selected?.messages.length, selectedId])

    useEffect(() => {
        if (!selectedId || !selected?.messages.length) return
        const latest = selected.messages.at(-1)!
        const timer = window.setTimeout(() => {
            const cursor = { conversationId: selectedId, userId: bootstrap.currentUser.id, lastReadMessageId: latest.id, lastReadAt: latest.createdAt }
            setReadCursors((current) => [...current.filter((item) => !(item.conversationId === selectedId && item.userId === bootstrap.currentUser.id)), cursor])
            void fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/read`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: selectedId, messageId: latest.id }) })
        }, 200)
        return () => window.clearTimeout(timer)
    }, [bootstrap.currentUser.id, bootstrap.workspaceSlug, selected?.messages, selectedId])

    useEffect(() => {
        let disposed = false; let channel: ReturnType<typeof supabase.channel> | null = null
        void supabase.auth.getSession().then(async ({ data }) => {
            if (!data.session?.access_token || disposed) return
            await supabase.realtime.setAuth(data.session.access_token)
            channel = supabase.channel(`communications:${bootstrap.workspaceSlug}`, { config: { private: true } })
                .on("postgres_changes", { event: "*", schema: "public", table: "workspace_native_messages", filter: `workspace_id=eq.${bootstrap.workspaceId}` }, (payload) => {
                    if (payload.eventType === "DELETE") {
                        const deleted = record(payload.old); const messageId = text(deleted.id); const conversationId = text(deleted.conversation_id)
                        if (messageId && conversationId) setConversations((current) => current.map((conversation) => conversation.id === conversationId ? { ...conversation, messages: conversation.messages.filter((message) => message.id !== messageId) } : conversation))
                        return
                    }
                    const message = realtimeMessage(payload.new); if (message) updateConversationMessages(message.conversationId, [message], true)
                })
                .on("postgres_changes", { event: "*", schema: "public", table: "workspace_native_reactions", filter: `workspace_id=eq.${bootstrap.workspaceId}` }, (payload) => {
                    const row = record(payload.eventType === "DELETE" ? payload.old : payload.new); const messageId = text(row.message_id); const reactorUserId = text(row.reactor_user_id)
                    if (!messageId || !reactorUserId) return
                    if (payload.eventType === "DELETE") setReactions((current) => current.filter((reaction) => !(reaction.messageId === messageId && reaction.reactorUserId === reactorUserId)))
                    else { const id = text(row.id); const conversationId = text(row.conversation_id); const emoji = text(row.emoji); const updatedAt = text(row.updated_at); if (id && conversationId && emoji && updatedAt) setReactions((current) => [...current.filter((reaction) => !(reaction.messageId === messageId && reaction.reactorUserId === reactorUserId)), { id, conversationId, messageId, reactorUserId, emoji, updatedAt }]) }
                })
                .on("postgres_changes", { event: "*", schema: "public", table: "workspace_native_read_cursors", filter: `workspace_id=eq.${bootstrap.workspaceId}` }, (payload) => { const row = record(payload.new); const conversationId = text(row.conversation_id); const userId = text(row.user_id); const lastReadAt = text(row.last_read_at); if (conversationId && userId && lastReadAt) setReadCursors((current) => [...current.filter((cursor) => !(cursor.conversationId === conversationId && cursor.userId === userId)), { conversationId, userId, lastReadMessageId: text(row.last_read_message_id), lastReadAt }]) })
                .on("postgres_changes", { event: "*", schema: "public", table: "workspace_native_conversations", filter: `workspace_id=eq.${bootstrap.workspaceId}` }, () => { void refresh(selectedRef.current) })
                .on("postgres_changes", { event: "*", schema: "public", table: "workspace_team_members", filter: `workspace_id=eq.${bootstrap.workspaceId}` }, () => { void refresh(selectedRef.current) })
                .subscribe()
        }).catch(() => undefined)
        return () => { disposed = true; if (channel) void supabase.removeChannel(channel) }
    }, [bootstrap.workspaceId, bootstrap.workspaceSlug, refresh, supabase, updateConversationMessages])

    async function uploadAttachment(file: File) {
        if (!selected || attachmentState === "uploading") return
        setAttachmentState("uploading"); setError(null)
        try {
            const preparedResponse = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/attachments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: selected.id, name: file.name, size: file.size, type: file.type }) })
            const prepared = await preparedResponse.json().catch(() => null) as { uploadUrl?: string; attachment?: CommunicationAttachment; error?: string } | null
            if (!preparedResponse.ok || !prepared?.uploadUrl || !prepared.attachment) throw new Error(prepared?.error ?? "Could not prepare attachment.")
            const uploaded = await fetch(prepared.uploadUrl, { method: "PUT", headers: { "Content-Type": prepared.attachment.mimeType }, body: file })
            if (!uploaded.ok) throw new Error("Could not upload attachment.")
            setAttachment(prepared.attachment)
        } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "Could not upload attachment.") }
        finally { setAttachmentState("idle"); if (attachmentInputRef.current) attachmentInputRef.current.value = "" }
    }

    async function uploadSticker(file: File) {
        if (stickerUploadState === "uploading") return
        setStickerUploadState("uploading"); setError(null)
        try {
            const formData = new FormData(); formData.set("file", file)
            const response = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/stickers`, { method: "POST", body: formData })
            const result = await response.json().catch(() => null) as { sticker?: CommunicationSticker; error?: string } | null
            if (!response.ok || !result?.sticker) throw new Error(result?.error ?? "Could not add this sticker.")
            setStickers((current) => current.some((sticker) => sticker.id === result.sticker!.id) ? current : [...current, result.sticker!])
        } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "Could not add this sticker.") }
        finally { setStickerUploadState("idle"); if (stickerInputRef.current) stickerInputRef.current.value = "" }
    }

    async function sendSticker(sticker: CommunicationSticker) {
        if (!selected?.canWrite) return
        const clientRequestId = crypto.randomUUID(); const replyTarget = replyingTo
        const stickerAttachment: CommunicationAttachment = { kind: "sticker", fileName: sticker.fileName, mimeType: "image/webp", size: sticker.size, storagePath: sticker.storagePath, url: sticker.url }
        const optimistic: NativeMessage = { id: clientRequestId, clientRequestId, conversationId: selected.id, senderUserId: bootstrap.currentUser.id, body: "", replyToMessageId: replyTarget?.id ?? null, attachment: stickerAttachment, createdAt: new Date().toISOString() }
        updateConversationMessages(selected.id, [optimistic], true); setReplyingTo(null); setStickerTrayOpen(false); setError(null)
        const response = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: selected.id, clientRequestId, body: "", replyToMessageId: replyTarget?.id, attachment: stickerAttachment }) }).catch(() => null)
        const result = response ? await response.json().catch(() => null) as { message?: NativeMessage; error?: string } | null : null
        if (result?.message) updateConversationMessages(selected.id, [result.message])
        else { setConversations((current) => current.map((conversation) => conversation.id === selected.id ? { ...conversation, messages: conversation.messages.filter((message) => message.clientRequestId !== clientRequestId) } : conversation)); setError(result?.error ?? "Could not send sticker.") }
    }

    async function sendMessage() {
        if (!selected?.canWrite) return
        const body = draft.trim(); if (!body && !attachment) return
        const clientRequestId = crypto.randomUUID(); const replyTarget = replyingTo
        const optimistic: NativeMessage = { id: clientRequestId, clientRequestId, conversationId: selected.id, senderUserId: bootstrap.currentUser.id, body, replyToMessageId: replyTarget?.id ?? null, attachment, createdAt: new Date().toISOString() }
        updateConversationMessages(selected.id, [optimistic], true); setDraft(""); setReplyingTo(null); setAttachment(null); setError(null); localStorage.removeItem(`betelgeze:native-chat:draft:${bootstrap.workspaceId}:${selected.id}`)
        const response = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: selected.id, clientRequestId, body, replyToMessageId: replyTarget?.id, attachment: optimistic.attachment }) }).catch(() => null)
        const result = response ? await response.json().catch(() => null) as { message?: NativeMessage; error?: string } | null : null
        if (result?.message) updateConversationMessages(selected.id, [result.message])
        else { setConversations((current) => current.map((conversation) => conversation.id === selected.id ? { ...conversation, messages: conversation.messages.filter((message) => message.clientRequestId !== clientRequestId) } : conversation)); setError(result?.error ?? "Could not send message.") }
    }

    async function sendReaction(message: NativeMessage, emoji: string) {
        if (!selected?.canWrite) return
        const previous = reactions.find((reaction) => reaction.messageId === message.id && reaction.reactorUserId === bootstrap.currentUser.id) ?? null
        const optimistic = emoji ? { id: previous?.id ?? `optimistic:${message.id}`, conversationId: selected.id, messageId: message.id, reactorUserId: bootstrap.currentUser.id, emoji, updatedAt: new Date().toISOString() } : null
        setReactions((current) => optimistic ? [...current.filter((reaction) => !(reaction.messageId === message.id && reaction.reactorUserId === bootstrap.currentUser.id)), optimistic] : current.filter((reaction) => !(reaction.messageId === message.id && reaction.reactorUserId === bootstrap.currentUser.id)))
        setActionMessageId(null)
        const response = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/reactions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: selected.id, messageId: message.id, emoji }) })
        if (!response.ok) { setReactions((current) => previous ? [...current.filter((reaction) => !(reaction.messageId === message.id && reaction.reactorUserId === bootstrap.currentUser.id)), previous] : current.filter((reaction) => !(reaction.messageId === message.id && reaction.reactorUserId === bootstrap.currentUser.id))); setError("Could not send reaction.") }
    }

    function rememberRecentReaction(emoji: string) {
        setRecentReaction(emoji)
        localStorage.setItem(`betelgeze:communications:recent-reaction:${bootstrap.workspaceId}`, emoji)
    }

    async function copyMessage(message: NativeMessage) {
        setActionMessageId(null)
        setError(null)
        try {
            await copyMessageText(messagePreview(message))
        } catch (copyError) {
            setError(copyError instanceof Error ? copyError.message : "Could not copy this message.")
        }
    }

    async function togglePinnedMessage(message: NativeMessage) {
        if (!selected?.canWrite) return
        const conversationId = selected.id
        const previous = selected.pinnedMessageId
        const pinnedMessageId = previous === message.id ? null : message.id
        setActionMessageId(null)
        setError(null)
        setConversations((current) => current.map((conversation) => conversation.id === conversationId ? { ...conversation, pinnedMessageId } : conversation))
        const response = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/pins`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, messageId: pinnedMessageId }) }).catch(() => null)
        if (!response?.ok) {
            setConversations((current) => current.map((conversation) => conversation.id === conversationId ? { ...conversation, pinnedMessageId: previous } : conversation))
            const result = response ? await response.json().catch(() => null) as { error?: string } | null : null
            setError(result?.error ?? "Could not update the pinned message.")
        }
    }

    function jumpToMessage(messageId: string) {
        const target = messagePaneRef.current?.querySelector<HTMLElement>(`[data-message-interaction="${messageId}"]`)
        target?.scrollIntoView({ behavior: "smooth", block: "center" })
    }

    async function deleteMessage(message: NativeMessage) {
        if (!selected?.canWrite || message.senderUserId !== bootstrap.currentUser.id || message.clientRequestId === message.id) return
        if (!window.confirm("Delete this message? This cannot be undone.")) return
        const previous = selected.messages
        const previousPinnedMessageId = selected.pinnedMessageId
        setActionMessageId(null)
        setReplyingTo((current) => current?.id === message.id ? null : current)
        setConversations((current) => current.map((conversation) => conversation.id === selected.id ? { ...conversation, pinnedMessageId: conversation.pinnedMessageId === message.id ? null : conversation.pinnedMessageId, messages: conversation.messages.filter((candidate) => candidate.id !== message.id) } : conversation))
        const params = new URLSearchParams({ conversationId: selected.id, messageId: message.id })
        const response = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/messages?${params}`, { method: "DELETE" }).catch(() => null)
        if (!response?.ok) {
            setConversations((current) => current.map((conversation) => conversation.id === selected.id ? { ...conversation, pinnedMessageId: previousPinnedMessageId, messages: mergeMessages(conversation.messages, previous) } : conversation))
            const result = response ? await response.json().catch(() => null) as { error?: string } | null : null
            setError(result?.error ?? "Could not delete message.")
        }
    }

    const normalizedSearch = search.trim().toLowerCase()
    const visible = conversations.filter((conversation) => (showArchived ? conversation.archived : !conversation.archived) && (!normalizedSearch || `${conversation.title} ${conversation.messages.at(-1)?.body ?? ""}`.toLowerCase().includes(normalizedSearch)))
    const currentTeam = selected?.teamId ? teams.find((team) => team.id === selected.teamId) : null
    const pinnedMessage = selected?.pinnedMessageId ? selected.messages.find((message) => message.id === selected.pinnedMessageId) ?? null : null
    const pinnedPreview = pinnedMessage ? messagePreview(pinnedMessage).split(/\r?\n/, 1)[0] : selected?.pinnedMessageId ? "Pinned message unavailable" : null

    return <section aria-label="Team communications" className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-black">
        {!bootstrap.schemaReady ? <div className="shrink-0 border-b border-amber-900 bg-amber-950 px-4 py-2 text-center text-xs text-amber-100">Apply the Teams database migration to enable native messaging.</div> : null}
        <ResizableConversationColumns>
            <aside className={`${selected ? "hidden lg:flex" : "flex"} min-h-0 flex-col border-r border-neutral-800 bg-neutral-950`}>
                <div className="shrink-0 border-b border-neutral-800 p-3">
                    <div className="flex items-center gap-1"><div role="tablist" className="flex items-center gap-1"><button type="button" role="tab" aria-selected="false" onClick={onOpenClients} className="h-8 rounded-lg px-3 text-xs font-medium text-neutral-400 hover:bg-neutral-900 hover:text-white">Clients</button><button type="button" role="tab" aria-selected="true" className="inline-flex h-8 items-center gap-2 rounded-lg bg-neutral-800 px-3 text-xs font-semibold text-white">Team<span className="text-[10px] text-neutral-400">{visible.length}</span></button></div>{bootstrap.canManageTeams ? <button type="button" onClick={() => setEditingTeam(null)} aria-label="Create team" title="Create team" className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full text-xl text-neutral-400 hover:bg-neutral-900 hover:text-white">+</button> : null}</div>
                    <label className="relative mt-3 block"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600"><SearchIcon /></span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search team conversations" className="h-10 w-full rounded-lg border border-neutral-800 bg-black pl-9 pr-3 text-sm outline-none placeholder:text-neutral-600" /></label>
                    {bootstrap.canManageTeams && teams.some((team) => team.archivedAt) ? <button type="button" onClick={() => { setShowArchived((value) => !value); setSelectedId(null) }} className={`mt-2 text-[11px] ${showArchived ? "text-white" : "text-neutral-500"}`}>{showArchived ? "← Active conversations" : "View archived teams"}</button> : null}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">{visible.length ? visible.map((conversation) => {
                    const latest = conversation.messages.at(-1)
                    const ownCursor = readCursors.find((cursor) => cursor.conversationId === conversation.id && cursor.userId === bootstrap.currentUser.id)
                    const cursorIndex = ownCursor?.lastReadMessageId ? conversation.messages.findIndex((message) => message.id === ownCursor.lastReadMessageId) : -1
                    const unread = conversation.messages.slice(cursorIndex + 1).filter((message) => message.senderUserId !== bootstrap.currentUser.id).length
                    const latestRead = Boolean(latest && readCursors.some((cursor) => cursor.conversationId === conversation.id && cursor.userId !== latest.senderUserId && cursor.lastReadAt >= latest.createdAt))
                    return <button key={conversation.id} type="button" onClick={() => selectConversation(conversation.id)} className={`grid w-full grid-cols-[2.75rem_minmax(0,1fr)] gap-3 border-b border-neutral-900 px-4 py-3.5 text-left ${selectedId === conversation.id ? "bg-neutral-900" : "hover:bg-black"}`}><TeamAvatar conversation={conversation} currentUserId={bootstrap.currentUser.id} /><span className="min-w-0"><span className="flex items-start justify-between gap-3"><span className="truncate text-sm font-semibold">{conversation.title}</span>{latest ? <time className={unread ? "text-[11px] text-white" : "text-[11px] text-neutral-600"}>{formatRelativeTime(latest.createdAt)}</time> : null}</span><span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-neutral-500">{latest?.senderUserId === bootstrap.currentUser.id ? <NativeDeliveryTicks message={latest} read={latestRead} /> : null}<span className="truncate">{latest ? `${latest.senderUserId === bootstrap.currentUser.id ? "You: " : ""}${messagePreview(latest)}` : conversation.subtitle}</span>{unread ? <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-black">{unread}</span> : null}</span></span></button>
                }) : <div className="p-6 text-center"><p className="text-sm text-neutral-300">{showArchived ? "No archived teams" : "No team conversations yet"}</p><p className="mt-2 text-xs text-neutral-600">{showArchived ? "Archived team history will appear here." : "Open a profile to start a DM or create a team."}</p></div>}</div>
            </aside>
            <div className={`${selected ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-col overflow-hidden bg-black`}>
                {selected ? <>
                    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-3 sm:px-4">
                        <button type="button" onClick={() => selectConversation(null)} aria-label="Back to team conversations" className="inline-flex h-10 w-10 shrink-0 items-center justify-center text-neutral-400 lg:hidden"><BackIcon /></button>
                        <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (selected.kind === "direct") openWorkspaceMemberProfile(selected.memberIds.find((id) => id !== bootstrap.currentUser.id) ?? bootstrap.currentUser.id); else if (currentTeam) setEditingTeam(currentTeam) }} aria-label={selected.kind === "direct" ? `Open ${selected.title} profile` : `Open ${selected.title} settings`} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg text-left outline-none hover:text-neutral-200 focus-visible:ring-2 focus-visible:ring-neutral-600">
                            <span className="h-9 w-9 shrink-0 overflow-hidden rounded-full">{selected.kind === "direct" ? <Avatar src={selected.avatarSrc} name={selected.title} className="h-full w-full" /> : <span className="flex h-full w-full items-center justify-center rounded-full bg-neutral-800"><TeamIcon /></span>}</span>
                            <span className="min-w-0"><span className="block truncate text-sm font-semibold">{selected.title}</span><span className="block truncate text-[11px] text-neutral-600">{selected.archived ? "Archived · read-only" : selected.subtitle}</span></span>
                        </button>
                    </header>
                    {selected.pinnedMessageId && pinnedPreview ? <PinnedMessageBar preview={pinnedPreview} onClick={() => jumpToMessage(selected.pinnedMessageId!)} /> : null}
                    <div className="relative min-h-0 flex-1"><div ref={messagePaneRef} onScroll={(event) => { if (event.currentTarget.scrollLeft !== 0) event.currentTarget.scrollLeft = 0; followLatestRef.current = !messagePaneIsAwayFromBottom(event.currentTarget, 24); setShowJumpToLatest(messagePaneIsAwayFromBottom(event.currentTarget)) }} className="h-full touch-pan-y overflow-x-hidden overflow-y-auto overscroll-x-none overscroll-y-contain bg-[radial-gradient(circle_at_top,_rgba(38,38,38,0.5),_transparent_38%)] px-3 py-5 sm:px-6"><div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-2 lg:max-w-none">{selected.messages.length ? selected.messages.map((message, index) => {
                        const own = message.senderUserId === bootstrap.currentUser.id
                        const sender = peopleById.get(message.senderUserId)
                        const reply = message.replyToMessageId ? selected.messages.find((candidate) => candidate.id === message.replyToMessageId) ?? null : null
                        const messageReactions = reactions.filter((reaction) => reaction.messageId === message.id)
                        const ownReaction = messageReactions.find((reaction) => reaction.reactorUserId === bootstrap.currentUser.id)
                        const readers = readCursors.filter((cursor) => cursor.conversationId === selected.id && cursor.userId !== message.senderUserId && cursor.lastReadAt >= message.createdAt).flatMap((cursor) => peopleById.get(cursor.userId) ?? [])
                        const showDay = index === 0 || !sameDay(selected.messages[index - 1].createdAt, message.createdAt)
                        const swipeOffset = swipePosition?.id === message.id ? swipePosition.offset : 0
                        const canDelete = own && message.clientRequestId !== message.id
                        const canPin = selected.canWrite && message.clientRequestId !== message.id
                        const isSticker = message.attachment?.kind === "sticker"
                        return <Fragment key={message.id}>
                            {showDay ? <div className="my-3 flex justify-center"><time className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-[10px] text-neutral-500">{messageDay(message.createdAt)}</time></div> : null}
                            <div data-message-interaction={message.id} className={`relative flex items-end ${own ? "justify-end" : "justify-start"} ${enteringMessageIds.has(message.id) ? own ? "betelgeze-message-enter-right" : "betelgeze-message-enter-left" : ""}`}>
                                <span aria-hidden="true" style={{ opacity: Math.min(1, Math.abs(swipeOffset) / 36) }} className={`pointer-events-none absolute -inset-x-3 inset-y-0 lg:hidden ${swipeOffset < 0 ? "bg-gradient-to-l from-red-600/45 via-red-950/20 to-transparent" : "bg-gradient-to-r from-white/20 via-white/5 to-transparent"}`} />
                                <span aria-hidden="true" style={{ top: "50%", opacity: Math.min(1, Math.max(0, swipeOffset) / 38), transform: `translateY(-50%) scale(${0.72 + Math.min(0.28, Math.max(0, swipeOffset) / 190)})` }} className="pointer-events-none absolute left-0 flex h-9 w-9 items-center justify-center rounded-full bg-neutral-800 text-white lg:hidden"><ReplyIcon className="h-5 w-5" /></span>
                                {canDelete ? <span aria-hidden="true" style={{ top: "50%", opacity: Math.min(1, Math.max(0, -swipeOffset) / 38), transform: `translateY(-50%) scale(${0.72 + Math.min(0.28, Math.max(0, -swipeOffset) / 190)})` }} className="pointer-events-none absolute right-0 flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-white lg:hidden"><DeleteIcon className="h-5 w-5" /></span> : null}
                                {actionMessageId === message.id ? <div key={`${message.id}:${actionView}`} data-message-action-popup className={`betelgeze-reaction-popup-enter absolute bottom-full z-20 mb-1 ${own ? "right-0" : "left-0"}`}>{actionView === "actions" ? <PrimaryMessageActions onDelete={canDelete && selected.canWrite ? () => void deleteMessage(message) : null} onReply={selected.canWrite ? () => { setReplyingTo(message); setActionMessageId(null); composerRef.current?.focus() } : null} onCopy={() => void copyMessage(message)} onPin={canPin ? () => void togglePinnedMessage(message) : null} onReact={selected.canWrite ? () => setActionView("reactions") : null} pinned={selected.pinnedMessageId === message.id} /> : selected.canWrite ? <MessageReactionActions currentEmoji={ownReaction?.emoji ?? null} recentEmoji={recentReaction} onReact={(emoji) => void sendReaction(message, emoji)} onRecentEmoji={rememberRecentReaction} side={own ? "right" : "left"} /> : null}</div> : null}
                                {!own && selected.kind === "team" ? <button data-icon-button type="button" onClick={() => openWorkspaceMemberProfile(message.senderUserId)} aria-label={`Open ${sender?.name ?? "team member"} profile`} className="mb-1 mr-2 inline-flex h-7 w-7 shrink-0 aspect-square items-center justify-center overflow-hidden rounded-full p-0 outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"><Avatar src={sender?.avatarSrc} name={sender?.name ?? "Team member"} className="h-full w-full object-center" /></button> : null}
                                <article
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => {
                                        if (swipedMessageRef.current === message.id) { swipedMessageRef.current = null; return }
                                        if (dismissedActionMessageRef.current === message.id) { dismissedActionMessageRef.current = null; return }
                                        setActionView("actions")
                                        setActionMessageId((current) => current === message.id ? null : message.id)
                                    }}
                                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActionView("actions"); setActionMessageId((current) => current === message.id ? null : message.id) } }}
                                    onTouchStart={(event) => { const touch = event.touches[0]; swipeStartRef.current = touch ? { id: message.id, x: touch.clientX, y: touch.clientY, cancelled: false, maxDeltaX: 0, minDeltaX: 0, verticalAtMax: 0, verticalAtMin: 0 } : null; if (touch) setSwipePosition({ id: message.id, offset: 0, active: true }) }}
                                    onTouchMove={(event) => { const start = swipeStartRef.current; const touch = event.touches[0]; if (!start || start.id !== message.id || !touch || start.cancelled) return; const deltaX = touch.clientX - start.x; const deltaY = touch.clientY - start.y; if (deltaX > start.maxDeltaX) { start.maxDeltaX = deltaX; start.verticalAtMax = Math.abs(deltaY) } if (deltaX < start.minDeltaX) { start.minDeltaX = deltaX; start.verticalAtMin = Math.abs(deltaY) } if (Math.abs(deltaY) > Math.abs(deltaX) * 1.5 && Math.abs(deltaY) > 12) { start.cancelled = true; setSwipePosition({ id: message.id, offset: 0, active: false }); return } const constrained = canDelete ? Math.max(-82, Math.min(82, deltaX * 0.78)) : Math.max(0, Math.min(82, deltaX * 0.78)); if (Math.abs(constrained) > 2) { event.preventDefault(); setSwipePosition({ id: message.id, offset: constrained, active: true }) } }}
                                    onTouchEnd={(event) => { const start = swipeStartRef.current; const touch = event.changedTouches[0]; swipeStartRef.current = null; if (start && touch) { const deltaX = touch.clientX - start.x; const vertical = Math.abs(touch.clientY - start.y); if (deltaX > start.maxDeltaX) { start.maxDeltaX = deltaX; start.verticalAtMax = vertical } if (deltaX < start.minDeltaX) { start.minDeltaX = deltaX; start.verticalAtMin = vertical } } const replyGesture = Boolean(start && !start.cancelled && start.maxDeltaX > 52 && start.verticalAtMax < 42); const deleteGesture = Boolean(start && !start.cancelled && canDelete && start.minDeltaX < -52 && start.verticalAtMin < 42); setSwipePosition({ id: message.id, offset: 0, active: false }); window.setTimeout(() => setSwipePosition((current) => current?.id === message.id && !current.active ? null : current), 220); if (replyGesture) { swipedMessageRef.current = message.id; setReplyingTo(message); setActionMessageId(null); composerRef.current?.focus() } else if (deleteGesture) { swipedMessageRef.current = message.id; void deleteMessage(message) } }}
                                    onTouchCancel={() => { swipeStartRef.current = null; setSwipePosition({ id: message.id, offset: 0, active: false }); window.setTimeout(() => setSwipePosition((current) => current?.id === message.id && !current.active ? null : current), 220) }}
                                    style={{ transform: `translate3d(${swipeOffset}px,0,0)`, transition: swipePosition?.id === message.id && swipePosition.active ? "none" : "transform 220ms cubic-bezier(.22,1,.36,1)", willChange: swipePosition?.id === message.id ? "transform" : undefined }}
                                    className={`${isSticker ? "relative max-w-52 bg-transparent p-0 pb-1 shadow-none" : `max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm sm:max-w-[72%] ${own ? "rounded-br-md bg-neutral-100 text-neutral-950" : "rounded-bl-md border border-neutral-800 bg-neutral-900 text-neutral-100"}`} min-w-0 touch-pan-y cursor-pointer outline-none`}
                                >
                                    {selected.kind === "team" ? <button type="button" onClick={(event) => { event.stopPropagation(); openWorkspaceMemberProfile(message.senderUserId) }} className={`${isSticker ? "mb-1 w-fit rounded-full bg-neutral-950/80 px-2 py-0.5" : "mb-0.5"} block text-[10px] font-semibold leading-none text-neutral-500 hover:underline`}>{own ? "You" : sender?.name ?? "Team member"}</button> : null}
                                    {reply ? <div className={`mb-2 rounded-lg border-l-2 border-neutral-500 px-2.5 py-2 ${own ? "bg-black/10" : "bg-black/35"}`}>{selected.kind === "team" ? <p className="truncate text-[10px] font-semibold opacity-70">{reply.senderUserId === bootstrap.currentUser.id ? "You" : peopleById.get(reply.senderUserId)?.name ?? "Team member"}</p> : null}<p className={`${selected.kind === "team" ? "mt-0.5 " : ""}truncate text-xs opacity-65`}>{messagePreview(reply)}</p></div> : null}
                                    {message.attachment ? <NativeAttachment attachment={message.attachment} onOpenImage={setPreviewMedia} light={own} /> : null}
                                    {message.body ? <MessageText body={message.body} /> : null}
                                    {isSticker && messageReactions.length ? <div className={`absolute bottom-5 z-10 flex gap-0.5 ${own ? "right-0" : "left-0"}`}>{messageReactions.map((reaction) => <span key={reaction.id} title={`${peopleById.get(reaction.reactorUserId)?.name ?? "Team member"} reacted`} className="rounded-full border border-neutral-800 bg-neutral-950 px-1.5 py-0.5 text-sm shadow-sm">{reaction.emoji}</span>)}</div> : null}
                                    <div className={`mt-1.5 flex items-center justify-between gap-3 text-[10px] ${isSticker ? "ml-auto min-w-20 rounded-full bg-neutral-950/80 px-2 py-0.5 text-neutral-400" : own ? "text-neutral-500" : "text-neutral-600"}`}>
                                        <span className="flex min-w-0 items-center -space-x-1">{selected.kind === "team" ? readers.map((person) => <button data-icon-button type="button" key={person.id} onClick={(event) => { event.stopPropagation(); openWorkspaceMemberProfile(person.id) }} title={`Read by ${person.name}`} aria-label={`Open ${person.name} profile`} className="relative inline-flex h-4 w-4 shrink-0 aspect-square items-center justify-center overflow-hidden rounded-full border border-black p-0 leading-none"><Avatar src={person.avatarSrc} name={person.name} className="h-full w-full object-center" /></button>) : null}</span>
                                        <span className="flex shrink-0 items-center gap-1.5"><time>{messageTime(message.createdAt)}</time>{own ? <NativeDeliveryTicks message={message} read={readers.length > 0} /> : null}</span>
                                    </div>
                                </article>
                            </div>
                            {!isSticker && messageReactions.length ? <div className={`flex gap-1 px-1 ${own ? "justify-end" : "justify-start"}`}>{messageReactions.map((reaction) => <span key={reaction.id} title={`${peopleById.get(reaction.reactorUserId)?.name ?? "Team member"} reacted`} className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-sm">{reaction.emoji}</span>)}</div> : null}
                        </Fragment>
                    }) : <div className="flex min-h-64 items-center justify-center text-center"><div><p className="text-sm font-medium text-neutral-300">Start the conversation</p><p className="mt-2 text-xs text-neutral-600">Native Betelgeze messages update instantly.</p></div></div>}</div></div>{showJumpToLatest ? <JumpToLatestButton onClick={() => { followLatestRef.current = true; messagePaneRef.current?.scrollTo({ top: messagePaneRef.current.scrollHeight, left: 0, behavior: "smooth" }) }} /> : null}</div>
                    <footer data-communications-composer className="shrink-0 border-t border-neutral-800 bg-neutral-950 p-3 sm:p-4">
                        {replyingTo ? <div className="mx-auto mb-2 flex max-w-3xl items-center gap-3 rounded-xl border-l-2 border-neutral-500 bg-neutral-900 px-3 py-2 text-xs"><span className="min-w-0 flex-1"><span className="block truncate font-semibold text-neutral-300">{selected.kind === "team" ? `Replying to ${replyingTo.senderUserId === bootstrap.currentUser.id ? "yourself" : peopleById.get(replyingTo.senderUserId)?.name ?? "team member"}` : "Replying to message"}</span><span className="block truncate text-neutral-500">{messagePreview(replyingTo)}</span></span><button type="button" onClick={() => setReplyingTo(null)} className="h-8 w-8 text-neutral-500">×</button></div> : null}
                        {attachment || attachmentState === "uploading" ? <div className="mx-auto mb-2 flex max-w-3xl items-center gap-3 rounded-xl border border-neutral-800 bg-black px-3 py-2 text-xs"><span className="min-w-0 flex-1 truncate">{attachmentState === "uploading" ? "Uploading attachment…" : attachment?.fileName}</span>{attachment ? <button type="button" onClick={() => setAttachment(null)} className="h-8 w-8 text-neutral-500">×</button> : null}</div> : null}
                        {stickerTrayOpen ? <div className="mx-auto mb-2 max-w-3xl rounded-2xl border border-neutral-800 bg-black p-3 shadow-2xl"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold text-neutral-200">Stickers</p><p className="mt-0.5 text-[10px] text-neutral-600">Shared across client and team chats.</p></div><button type="button" onClick={() => setStickerTrayOpen(false)} aria-label="Close sticker tray" className="h-8 w-8 text-neutral-500 hover:text-white">×</button></div><div className="mt-3 grid max-h-52 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-7">{stickers.map((sticker) => <button key={sticker.id} type="button" onClick={() => void sendSticker(sticker)} disabled={!selected.canWrite} title={sticker.fileName} className="flex aspect-square items-center justify-center rounded-xl bg-neutral-950 p-1.5 hover:bg-neutral-900 disabled:opacity-40"><Image unoptimized src={sticker.url} alt={sticker.fileName} width={512} height={512} className="h-full w-full object-contain" /></button>)}<button type="button" onClick={() => stickerInputRef.current?.click()} disabled={stickerUploadState === "uploading"} className="flex aspect-square flex-col items-center justify-center rounded-xl border border-dashed border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-white disabled:opacity-40"><span className="text-2xl">+</span><span className="mt-1 text-[9px]">{stickerUploadState === "uploading" ? "Converting…" : "Add sticker"}</span></button></div></div> : null}
                        {error ? <div className="mx-auto mb-2 flex max-w-3xl justify-between rounded-lg bg-red-950/60 px-3 py-2 text-xs text-red-300"><span>{error}</span><button type="button" onClick={() => setError(null)}>×</button></div> : null}
                        <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-xl border border-neutral-800 bg-black px-3 py-1 focus-within:border-neutral-600">
                            <input ref={attachmentInputRef} type="file" accept="image/jpeg,image/png,video/mp4,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAttachment(file) }} />
                            <input ref={stickerInputRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadSticker(file) }} />
                            <div className="flex shrink-0 items-center -space-x-1">
                                <button data-icon-button type="button" onClick={() => attachmentInputRef.current?.click()} disabled={!selected.canWrite || attachmentState === "uploading"} aria-label="Attach image or file" className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-neutral-500 hover:text-white disabled:text-neutral-800"><AttachmentIcon /></button>
                                <button data-icon-button type="button" onClick={() => { setStickerTrayOpen((current) => !current); setError(null) }} disabled={!selected.canWrite} aria-label="Open sticker tray" className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-neutral-500 hover:text-white disabled:text-neutral-800"><StickerIcon /></button>
                            </div>
                            <div className="relative min-w-0 flex-1">{!draft ? <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 truncate text-sm leading-5 text-neutral-600">{selected.canWrite ? `Message ${selected.title}` : "Archived conversation"}</span> : null}<textarea ref={composerRef} rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage() } }} disabled={!selected.canWrite} aria-label={`Message ${selected.title}`} className="relative h-9 min-h-9 w-full resize-none overflow-y-hidden bg-transparent py-2 text-sm leading-5 outline-none" /></div>
                            <button data-icon-button type="button" onClick={() => void sendMessage()} disabled={!selected.canWrite || (!draft.trim() && !attachment) || attachmentState === "uploading"} aria-label="Send message" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black disabled:bg-neutral-800 disabled:text-neutral-600"><SendIcon /></button>
                        </div>
                        <p className="mx-auto mt-2 max-w-3xl text-center text-[10px] text-neutral-600">Enter to send · Shift+Enter for a new line</p>
                    </footer>
                </> : <div className="flex flex-1 items-center justify-center p-6 text-center"><div><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950"><TeamIcon /></div><h2 className="mt-4 text-sm font-semibold">Select a team conversation</h2><p className="mt-2 text-xs text-neutral-600">Direct messages and team chats update without reloading.</p></div></div>}
            </div>
        </ResizableConversationColumns>
        {editingTeam !== undefined ? <TeamEditor bootstrap={{ ...bootstrap, teams }} team={editingTeam} onClose={() => setEditingTeam(undefined)} onSaved={async () => { await refresh(selectedRef.current) }} /> : null}
        <MessageMediaLightbox media={previewMedia} onClose={() => setPreviewMedia(null)} />
    </section>
}
