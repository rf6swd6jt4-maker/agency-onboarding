"use client"

import Image from "next/image"
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Avatar } from "@/components/account/Avatar"
import { DeleteIcon, ReplyIcon } from "@/components/communications/MessageInteractionIcons"
import { MessageMediaLightbox, type MessageMediaPreview } from "@/components/communications/MessageMediaLightbox"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"
import { formatRelativeTime } from "@/lib/ui/relative-time"
import { openWorkspaceMemberProfile } from "@/lib/workspace-member-profile"
import type { CommunicationAttachment } from "@/lib/communications/types"
import type { NativeCommunicationsBootstrap, NativeConversation, NativeMessage, WorkspaceTeam } from "@/lib/teams/types"

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"]
const EMOJI_CATALOGUE = ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "🙂", "😉", "😍", "🥰", "😎", "🤩", "🥳", "😮", "😱", "😢", "😭", "😡", "🤯", "🤔", "🫡", "🤗", "🫶", "🙏", "👏", "🙌", "👍", "👎", "👌", "✌️", "💪", "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💯", "✨", "🔥", "🎉", "🚀", "⭐", "✅", "⚡", "💡", "👀", "📌"]

function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function text(value: unknown) { return typeof value === "string" && value ? value : null }
function messageTime(value: string) { return new Intl.DateTimeFormat("en-IE", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) }
function messageDay(value: string) { return new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) }
function sameDay(left: string, right: string) { return new Date(left).toDateString() === new Date(right).toDateString() }
function attachmentPreview(attachment: CommunicationAttachment | null) { return attachment ? `${attachment.kind === "image" ? "Image" : attachment.kind === "video" ? "Video" : "File"}: ${attachment.fileName}` : "" }
function messagePreview(message: NativeMessage) { return message.body || attachmentPreview(message.attachment) || "Message" }

function SearchIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg> }
function BackIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="m15 6-6 6 6 6" /></svg> }
function SendIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="m4 4 17 8-17 8 3-8-3-8Z" /><path d="M7 12h14" /></svg> }
function AttachmentIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="m8.5 12.5 6.8-6.8a3 3 0 0 1 4.2 4.2l-9.2 9.2a5 5 0 0 1-7.1-7.1l9-9" /></svg> }
function TeamIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><circle cx="8" cy="8" r="3" /><circle cx="16" cy="9" r="2.5" /><path d="M3 19c0-3 2-5 5-5s5 2 5 5" /><path d="M13 15c1-.8 2-1.2 3.5-1 2.5.3 4 2.1 4 4.5" /></svg> }

function NativeAttachment({ attachment, onOpenImage }: { attachment: CommunicationAttachment; onOpenImage: (media: MessageMediaPreview) => void }) {
    if (attachment.kind === "image") return <button type="button" onClick={(event) => { event.stopPropagation(); onOpenImage({ url: attachment.url, alt: attachment.fileName }) }} aria-label={`Open ${attachment.fileName}`} className="mb-2 block w-full overflow-hidden rounded-xl bg-black/10"><Image unoptimized src={attachment.url} alt={attachment.fileName} width={800} height={600} className="max-h-80 h-auto w-full object-contain" /></button>
    if (attachment.kind === "video") return <video src={attachment.url} controls preload="metadata" className="mb-2 max-h-80 w-full rounded-xl bg-black" />
    return <a href={attachment.url} target="_blank" rel="noreferrer" className="mb-2 flex items-center gap-3 rounded-xl border border-current/10 bg-black/5 px-3 py-2.5 hover:bg-black/10"><span className="text-xl">↗</span><span className="min-w-0"><span className="block truncate text-xs font-semibold">{attachment.fileName}</span><span className="mt-0.5 block text-[10px] opacity-60">{attachment.size ? `${Math.max(1, Math.round(attachment.size / 1024))}KB` : "Attachment"}</span></span></a>
}

function MessageText({ body }: { body: string }) {
    const parts = body.split(/(https?:\/\/[^\s)]+)/g)
    return <p className="whitespace-pre-wrap break-words leading-5">{parts.map((part, index) => /^https?:\/\//.test(part) ? <a key={`${part}:${index}`} href={part} target="_blank" rel="noreferrer" className="underline decoration-current/40 underline-offset-2">{part}</a> : <Fragment key={index}>{part}</Fragment>)}</p>
}

function NativeReactionTray({ current, onReply, onDelete, onReact, side }: { current: string | null; onReply: () => void; onDelete: (() => void) | null; onReact: (emoji: string) => void; side: "left" | "right" }) {
    const [expanded, setExpanded] = useState(false)
    const [custom, setCustom] = useState("")
    return <div className="relative flex items-center rounded-full border border-neutral-800 bg-neutral-950 p-1 shadow-xl">
        <button type="button" onClick={onReply} aria-label="Reply" className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-white"><ReplyIcon /></button>
        {onDelete ? <button type="button" onClick={onDelete} aria-label="Delete message" className="flex h-8 w-8 items-center justify-center rounded-full text-red-500 hover:bg-red-500/10 hover:text-red-400"><DeleteIcon /></button> : null}
        {QUICK_REACTIONS.map((emoji) => <button key={emoji} type="button" onClick={() => onReact(current === emoji ? "" : emoji)} className={`flex h-8 w-8 items-center justify-center rounded-full hover:bg-neutral-800 ${current === emoji ? "bg-neutral-800" : ""}`}>{emoji}</button>)}
        <button type="button" onClick={() => setExpanded((value) => !value)} aria-label="More emoji" className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-neutral-400 hover:bg-neutral-800">+</button>
        {expanded ? <div className={`absolute bottom-11 w-72 rounded-2xl border border-neutral-800 bg-neutral-950 p-3 shadow-2xl ${side === "right" ? "right-0" : "left-0"}`}>
            <form onSubmit={(event) => { event.preventDefault(); if (custom.trim()) { onReact(current === custom.trim() ? "" : custom.trim()); setCustom(""); setExpanded(false) } }} className="flex gap-2"><input value={custom} onChange={(event) => setCustom(event.target.value)} maxLength={32} placeholder="Type or paste any emoji" className="h-9 min-w-0 flex-1 rounded-lg border border-neutral-800 bg-black px-3 text-sm outline-none" /><button className="rounded-lg bg-white px-3 text-xs font-semibold text-black">React</button></form>
            <div className="mt-3 grid max-h-40 grid-cols-8 gap-1 overflow-y-auto">{EMOJI_CATALOGUE.map((emoji) => <button key={emoji} type="button" onClick={() => { onReact(current === emoji ? "" : emoji); setExpanded(false) }} className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-neutral-800">{emoji}</button>)}</div>
        </div> : null}
    </div>
}

function TeamAvatar({ conversation, currentUserId }: { conversation: NativeConversation; currentUserId: string }) {
    if (conversation.kind === "team") return <span className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-800 text-neutral-300"><TeamIcon /></span>
    const profileUserId = conversation.memberIds.find((id) => id !== currentUserId)
    return <span role="button" tabIndex={0} aria-label={`Open ${conversation.title} profile`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (profileUserId) openWorkspaceMemberProfile(profileUserId) }} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && profileUserId) { event.preventDefault(); event.stopPropagation(); openWorkspaceMemberProfile(profileUserId) } }} className="h-11 w-11 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"><Avatar src={conversation.avatarSrc} name={conversation.title} className="h-11 w-11" /></span>
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
    const [error, setError] = useState<string | null>(null)
    const [actionMessageId, setActionMessageId] = useState<string | null>(null)
    const [swipePosition, setSwipePosition] = useState<{ id: string; offset: number; active: boolean } | null>(null)
    const [previewMedia, setPreviewMedia] = useState<MessageMediaPreview | null>(null)
    const [editingTeam, setEditingTeam] = useState<WorkspaceTeam | null | undefined>(undefined)
    const messagePaneRef = useRef<HTMLDivElement | null>(null)
    const composerRef = useRef<HTMLTextAreaElement | null>(null)
    const attachmentInputRef = useRef<HTMLInputElement | null>(null)
    const swipeStartRef = useRef<{ id: string; x: number; y: number; cancelled: boolean } | null>(null)
    const swipedMessageRef = useRef<string | null>(null)
    const selectedRef = useRef(selectedId)
    const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null
    const peopleById = useMemo(() => new Map(bootstrap.people.map((person) => [person.id, person])), [bootstrap.people])

    useEffect(() => { selectedRef.current = selectedId }, [selectedId])

    useEffect(() => {
        if (!actionMessageId) return
        const dismiss = (event: PointerEvent) => {
            const interaction = event.target instanceof Element ? event.target.closest("[data-message-interaction]") : null
            if (interaction?.getAttribute("data-message-interaction") !== actionMessageId) setActionMessageId(null)
        }
        document.addEventListener("pointerdown", dismiss)
        return () => document.removeEventListener("pointerdown", dismiss)
    }, [actionMessageId])

    const updateConversationMessages = useCallback((conversationId: string, incoming: NativeMessage[]) => {
        setConversations((current) => current.map((conversation) => conversation.id === conversationId ? { ...conversation, messages: mergeMessages(conversation.messages, incoming), updatedAt: incoming.at(-1)?.createdAt ?? conversation.updatedAt } : conversation).sort((left, right) => (right.messages.at(-1)?.createdAt ?? right.updatedAt).localeCompare(left.messages.at(-1)?.createdAt ?? left.updatedAt)))
    }, [])

    const refresh = useCallback(async (selectId?: string | null) => {
        const response = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/conversations`)
        const next = await response.json().catch(() => null) as NativeCommunicationsBootstrap | null
        if (!response.ok || !next) throw new Error("Could not refresh team conversations.")
        setConversations(next.conversations); setTeams(next.teams); setReactions(next.reactions); setReadCursors(next.readCursors)
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
        setSelectedId(id); setReplyingTo(null); setActionMessageId(null); setAttachment(null); setError(null)
        setDraft(id ? localStorage.getItem(`betelgeze:native-chat:draft:${bootstrap.workspaceId}:${id}`) ?? "" : "")
        const url = new URL(window.location.href)
        if (id) url.searchParams.set("nativeConversation", id); else url.searchParams.delete("nativeConversation")
        url.searchParams.delete("dm")
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
    }

    useEffect(() => { if (selectedId) localStorage.setItem(`betelgeze:native-chat:draft:${bootstrap.workspaceId}:${selectedId}`, draft) }, [bootstrap.workspaceId, draft, selectedId])
    useEffect(() => { if (selectedId) window.requestAnimationFrame(() => messagePaneRef.current?.scrollTo({ top: messagePaneRef.current.scrollHeight })) }, [selected?.messages.length, selectedId])

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
                    const message = realtimeMessage(payload.new); if (message) updateConversationMessages(message.conversationId, [message])
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

    async function sendMessage() {
        if (!selected?.canWrite) return
        const body = draft.trim(); if (!body && !attachment) return
        const clientRequestId = crypto.randomUUID(); const replyTarget = replyingTo
        const optimistic: NativeMessage = { id: clientRequestId, clientRequestId, conversationId: selected.id, senderUserId: bootstrap.currentUser.id, body, replyToMessageId: replyTarget?.id ?? null, attachment, createdAt: new Date().toISOString() }
        updateConversationMessages(selected.id, [optimistic]); setDraft(""); setReplyingTo(null); setAttachment(null); setError(null); localStorage.removeItem(`betelgeze:native-chat:draft:${bootstrap.workspaceId}:${selected.id}`)
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

    async function deleteMessage(message: NativeMessage) {
        if (!selected?.canWrite || message.senderUserId !== bootstrap.currentUser.id || message.clientRequestId === message.id) return
        const previous = selected.messages
        setActionMessageId(null)
        setReplyingTo((current) => current?.id === message.id ? null : current)
        setConversations((current) => current.map((conversation) => conversation.id === selected.id ? { ...conversation, messages: conversation.messages.filter((candidate) => candidate.id !== message.id) } : conversation))
        const params = new URLSearchParams({ conversationId: selected.id, messageId: message.id })
        const response = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/messages?${params}`, { method: "DELETE" }).catch(() => null)
        if (!response?.ok) {
            setConversations((current) => current.map((conversation) => conversation.id === selected.id ? { ...conversation, messages: mergeMessages(conversation.messages, previous) } : conversation))
            const result = response ? await response.json().catch(() => null) as { error?: string } | null : null
            setError(result?.error ?? "Could not delete message.")
        }
    }

    const normalizedSearch = search.trim().toLowerCase()
    const visible = conversations.filter((conversation) => (showArchived ? conversation.archived : !conversation.archived) && (!normalizedSearch || `${conversation.title} ${conversation.messages.at(-1)?.body ?? ""}`.toLowerCase().includes(normalizedSearch)))
    const currentTeam = selected?.teamId ? teams.find((team) => team.id === selected.teamId) : null

    return <section aria-label="Team communications" className="flex h-dvh min-h-0 flex-col overflow-hidden bg-black">
        {!bootstrap.schemaReady ? <div className="shrink-0 border-b border-amber-900 bg-amber-950 px-4 py-2 text-center text-xs text-amber-100">Apply the Teams database migration to enable native messaging.</div> : null}
        <div className="grid min-h-0 flex-1 lg:grid-cols-[22rem_minmax(0,1fr)]">
            <aside className={`${selected ? "hidden lg:flex" : "flex"} min-h-0 flex-col border-r border-neutral-800 bg-neutral-950`}>
                <div className="shrink-0 border-b border-neutral-800 p-3">
                    <div className="flex items-center gap-1"><div role="tablist" className="flex items-center gap-1"><button type="button" role="tab" aria-selected="false" onClick={onOpenClients} className="h-8 rounded-lg px-3 text-xs font-medium text-neutral-400 hover:bg-neutral-900 hover:text-white">Clients</button><button type="button" role="tab" aria-selected="true" className="inline-flex h-8 items-center gap-2 rounded-lg bg-neutral-800 px-3 text-xs font-semibold text-white">Team<span className="text-[10px] text-neutral-400">{visible.length}</span></button></div>{bootstrap.canManageTeams ? <button type="button" onClick={() => setEditingTeam(null)} aria-label="Create team" title="Create team" className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full text-xl text-neutral-400 hover:bg-neutral-900 hover:text-white">+</button> : null}</div>
                    <label className="relative mt-3 block"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600"><SearchIcon /></span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search team conversations" className="h-10 w-full rounded-lg border border-neutral-800 bg-black pl-9 pr-3 text-sm outline-none placeholder:text-neutral-600" /></label>
                    {bootstrap.canManageTeams && teams.some((team) => team.archivedAt) ? <button type="button" onClick={() => { setShowArchived((value) => !value); setSelectedId(null) }} className={`mt-2 text-[11px] ${showArchived ? "text-white" : "text-neutral-500"}`}>{showArchived ? "← Active conversations" : "View archived teams"}</button> : null}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">{visible.length ? visible.map((conversation) => {
                    const latest = conversation.messages.at(-1); const ownCursor = readCursors.find((cursor) => cursor.conversationId === conversation.id && cursor.userId === bootstrap.currentUser.id); const cursorIndex = ownCursor?.lastReadMessageId ? conversation.messages.findIndex((message) => message.id === ownCursor.lastReadMessageId) : -1; const unread = conversation.messages.slice(cursorIndex + 1).filter((message) => message.senderUserId !== bootstrap.currentUser.id).length
                    return <button key={conversation.id} type="button" onClick={() => selectConversation(conversation.id)} className={`grid w-full grid-cols-[2.75rem_minmax(0,1fr)] gap-3 border-b border-neutral-900 px-4 py-3.5 text-left ${selectedId === conversation.id ? "bg-neutral-900" : "hover:bg-black"}`}><TeamAvatar conversation={conversation} currentUserId={bootstrap.currentUser.id} /><span className="min-w-0"><span className="flex items-start justify-between gap-3"><span className="truncate text-sm font-semibold">{conversation.title}</span>{latest ? <time className={unread ? "text-[11px] text-emerald-400" : "text-[11px] text-neutral-600"}>{formatRelativeTime(latest.createdAt)}</time> : null}</span><span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-neutral-500"><span className="truncate">{latest ? `${latest.senderUserId === bootstrap.currentUser.id ? "You: " : ""}${messagePreview(latest)}` : conversation.subtitle}</span>{unread ? <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-black">{unread}</span> : null}</span></span></button>
                }) : <div className="p-6 text-center"><p className="text-sm text-neutral-300">{showArchived ? "No archived teams" : "No team conversations yet"}</p><p className="mt-2 text-xs text-neutral-600">{showArchived ? "Archived team history will appear here." : "Open a profile to start a DM or create a team."}</p></div>}</div>
            </aside>
            <div className={`${selected ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-col bg-black`}>
                {selected ? <>
                    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-3 sm:px-4"><button type="button" onClick={() => selectConversation(null)} className="inline-flex h-10 w-10 items-center justify-center text-neutral-400 lg:hidden"><BackIcon /></button><button type="button" onClick={() => selected.kind === "direct" ? openWorkspaceMemberProfile(selected.memberIds.find((id) => id !== bootstrap.currentUser.id) ?? bootstrap.currentUser.id) : currentTeam ? setEditingTeam(currentTeam) : undefined} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left"><span className="h-9 w-9 shrink-0">{selected.kind === "direct" ? <Avatar src={selected.avatarSrc} name={selected.title} className="h-9 w-9" /> : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-800"><TeamIcon /></span>}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{selected.title}</span><span className="block truncate text-[11px] text-neutral-600">{selected.archived ? "Archived · read-only" : selected.subtitle}</span></span></button></header>
                    <div ref={messagePaneRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[radial-gradient(circle_at_top,_rgba(38,38,38,0.5),_transparent_38%)] px-3 py-5 sm:px-6"><div className="mx-auto flex max-w-3xl flex-col gap-2">{selected.messages.length ? selected.messages.map((message, index) => {
                        const own = message.senderUserId === bootstrap.currentUser.id; const sender = peopleById.get(message.senderUserId); const reply = message.replyToMessageId ? selected.messages.find((candidate) => candidate.id === message.replyToMessageId) ?? null : null; const messageReactions = reactions.filter((reaction) => reaction.messageId === message.id); const ownReaction = messageReactions.find((reaction) => reaction.reactorUserId === bootstrap.currentUser.id); const readers = readCursors.filter((cursor) => cursor.conversationId === selected.id && cursor.userId !== message.senderUserId && cursor.lastReadAt >= message.createdAt).flatMap((cursor) => peopleById.get(cursor.userId) ?? []); const showDay = index === 0 || !sameDay(selected.messages[index - 1].createdAt, message.createdAt); const swipeOffset = swipePosition?.id === message.id ? swipePosition.offset : 0; const canDelete = own && message.clientRequestId !== message.id
                        return <Fragment key={message.id}>{showDay ? <div className="my-3 flex justify-center"><time className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-[10px] text-neutral-500">{messageDay(message.createdAt)}</time></div> : null}<div data-message-interaction={message.id} className={`relative flex items-end gap-2 ${own ? "justify-end" : "justify-start"}`}><span aria-hidden="true" style={{ opacity: Math.min(1, Math.abs(swipeOffset) / 36) }} className={`pointer-events-none absolute inset-0 rounded-2xl lg:hidden ${swipeOffset < 0 ? "bg-gradient-to-l from-red-600/45 via-red-950/20 to-transparent" : "bg-gradient-to-r from-white/20 via-white/5 to-transparent"}`} /><span aria-hidden="true" style={{ opacity: Math.min(1, Math.max(0, swipeOffset) / 38), transform: `scale(${0.72 + Math.min(0.28, Math.max(0, swipeOffset) / 190)})` }} className="pointer-events-none absolute left-3 flex h-9 w-9 items-center justify-center rounded-full bg-neutral-800 text-white lg:hidden"><ReplyIcon className="h-5 w-5" /></span>{canDelete ? <span aria-hidden="true" style={{ opacity: Math.min(1, Math.max(0, -swipeOffset) / 38), transform: `scale(${0.72 + Math.min(0.28, Math.max(0, -swipeOffset) / 190)})` }} className="pointer-events-none absolute right-3 flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-white lg:hidden"><DeleteIcon className="h-5 w-5" /></span> : null}{!own && selected.kind === "team" ? <button type="button" onClick={() => openWorkspaceMemberProfile(message.senderUserId)} aria-label={`Open ${sender?.name ?? "team member"} profile`} className="mb-1 h-7 w-7 shrink-0 overflow-hidden rounded-full outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"><Avatar src={sender?.avatarSrc} name={sender?.name ?? "Team member"} className="h-full w-full" /></button> : null}{actionMessageId === message.id && selected.canWrite ? <div className={`absolute bottom-full z-20 mb-1 ${own ? "right-0" : "left-0"}`}><NativeReactionTray current={ownReaction?.emoji ?? null} onReply={() => { setReplyingTo(message); setActionMessageId(null); composerRef.current?.focus() }} onDelete={canDelete ? () => void deleteMessage(message) : null} onReact={(emoji) => void sendReaction(message, emoji)} side={own ? "right" : "left"} /></div> : null}<article role="button" tabIndex={0} onClick={() => { if (swipedMessageRef.current === message.id) { swipedMessageRef.current = null; return } setActionMessageId((current) => current === message.id ? null : message.id) }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setActionMessageId((current) => current === message.id ? null : message.id) }} onTouchStart={(event) => { const touch = event.touches[0]; swipeStartRef.current = touch ? { id: message.id, x: touch.clientX, y: touch.clientY, cancelled: false } : null; if (touch) setSwipePosition({ id: message.id, offset: 0, active: true }) }} onTouchMove={(event) => { const start = swipeStartRef.current; const touch = event.touches[0]; if (!start || start.id !== message.id || !touch || start.cancelled) return; const deltaX = touch.clientX - start.x; const deltaY = touch.clientY - start.y; if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 8) { start.cancelled = true; setSwipePosition({ id: message.id, offset: 0, active: false }); return } const constrained = canDelete ? Math.max(-82, Math.min(82, deltaX * 0.78)) : Math.max(0, Math.min(82, deltaX * 0.78)); if (Math.abs(constrained) > 2) { event.preventDefault(); setSwipePosition({ id: message.id, offset: constrained, active: true }) } }} onTouchEnd={(event) => { const start = swipeStartRef.current; const touch = event.changedTouches[0]; swipeStartRef.current = null; const deltaX = start && touch ? touch.clientX - start.x : 0; const vertical = start && touch ? Math.abs(touch.clientY - start.y) : Infinity; const reply = Boolean(start && !start.cancelled && deltaX > 58 && vertical < 42); const remove = Boolean(start && !start.cancelled && canDelete && deltaX < -58 && vertical < 42); setSwipePosition({ id: message.id, offset: 0, active: false }); window.setTimeout(() => setSwipePosition((current) => current?.id === message.id && !current.active ? null : current), 220); if (reply) { swipedMessageRef.current = message.id; setReplyingTo(message); setActionMessageId(null); composerRef.current?.focus() } else if (remove) { swipedMessageRef.current = message.id; void deleteMessage(message) } }} style={{ transform: `translate3d(${swipeOffset}px,0,0)`, transition: swipePosition?.id === message.id && swipePosition.active ? "none" : "transform 220ms cubic-bezier(.22,1,.36,1)", willChange: swipePosition?.id === message.id ? "transform" : undefined }} className={`max-w-[88%] cursor-pointer rounded-2xl px-3.5 py-2.5 text-sm shadow-sm outline-none sm:max-w-[72%] ${own ? "rounded-br-md bg-neutral-100 text-neutral-950" : "rounded-bl-md border border-neutral-800 bg-neutral-900 text-neutral-100"}`}><button type="button" onClick={(event) => { event.stopPropagation(); openWorkspaceMemberProfile(message.senderUserId) }} className="mb-1 text-[10px] font-semibold text-neutral-500 hover:underline">{own ? "You" : sender?.name ?? "Team member"}</button>{reply ? <div className={`mb-2 rounded-lg border-l-2 border-neutral-500 px-2.5 py-2 ${own ? "bg-black/10" : "bg-black/35"}`}><p className="truncate text-[10px] font-semibold opacity-70">{reply.senderUserId === bootstrap.currentUser.id ? "You" : peopleById.get(reply.senderUserId)?.name ?? "Team member"}</p><p className="mt-0.5 truncate text-xs opacity-65">{messagePreview(reply)}</p></div> : null}{message.attachment ? <NativeAttachment attachment={message.attachment} onOpenImage={setPreviewMedia} /> : null}{message.body ? <MessageText body={message.body} /> : null}<div className={`mt-1.5 flex justify-end text-[10px] ${own ? "text-neutral-500" : "text-neutral-600"}`}><time>{messageTime(message.createdAt)}</time></div></article></div>{messageReactions.length ? <div className={`flex gap-1 px-1 ${own ? "justify-end" : "justify-start"}`}>{messageReactions.map((reaction) => <span key={reaction.id} title={`${peopleById.get(reaction.reactorUserId)?.name ?? "Team member"} reacted`} className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-sm">{reaction.emoji}</span>)}</div> : null}{readers.length ? <div className={`flex -space-x-1 px-1 ${own ? "justify-end" : "justify-start"}`}>{readers.map((person) => <button key={person.id} onClick={() => openWorkspaceMemberProfile(person.id)} title={`Read by ${person.name}`} className="h-4 w-4 overflow-hidden rounded-full border border-black"><Avatar src={person.avatarSrc} name={person.name} className="h-full w-full" /></button>)}</div> : null}</Fragment>
                    }) : <div className="flex min-h-64 items-center justify-center text-center"><div><p className="text-sm font-medium text-neutral-300">Start the conversation</p><p className="mt-2 text-xs text-neutral-600">Native Betelgeze messages update instantly.</p></div></div>}</div></div>
                    <footer className="shrink-0 border-t border-neutral-800 bg-neutral-950 p-3 sm:p-4">{replyingTo ? <div className="mx-auto mb-2 flex max-w-3xl items-center gap-3 rounded-xl border-l-2 border-neutral-500 bg-neutral-900 px-3 py-2 text-xs"><span className="min-w-0 flex-1"><span className="block truncate font-semibold text-neutral-300">Replying to {replyingTo.senderUserId === bootstrap.currentUser.id ? "yourself" : peopleById.get(replyingTo.senderUserId)?.name ?? "team member"}</span><span className="block truncate text-neutral-500">{messagePreview(replyingTo)}</span></span><button onClick={() => setReplyingTo(null)} className="h-8 w-8 text-neutral-500">×</button></div> : null}{attachment || attachmentState === "uploading" ? <div className="mx-auto mb-2 flex max-w-3xl items-center gap-3 rounded-xl border border-neutral-800 bg-black px-3 py-2 text-xs"><span className="min-w-0 flex-1 truncate">{attachmentState === "uploading" ? "Uploading attachment…" : attachment?.fileName}</span>{attachment ? <button onClick={() => setAttachment(null)} className="h-8 w-8 text-neutral-500">×</button> : null}</div> : null}{error ? <div className="mx-auto mb-2 flex max-w-3xl justify-between rounded-lg bg-red-950/60 px-3 py-2 text-xs text-red-300"><span>{error}</span><button onClick={() => setError(null)}>×</button></div> : null}<div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-neutral-800 bg-black px-3 py-2 focus-within:border-neutral-600"><input ref={attachmentInputRef} type="file" accept="image/jpeg,image/png,video/mp4,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAttachment(file) }} /><button type="button" onClick={() => attachmentInputRef.current?.click()} disabled={!selected.canWrite || attachmentState === "uploading"} className="inline-flex h-9 w-9 items-center justify-center text-neutral-500 hover:text-white disabled:text-neutral-800"><AttachmentIcon /></button><textarea ref={composerRef} rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage() } }} disabled={!selected.canWrite} placeholder={selected.canWrite ? "Message team" : "Archived conversation"} className="max-h-28 min-h-8 min-w-0 flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-neutral-600" /><button type="button" onClick={() => void sendMessage()} disabled={!selected.canWrite || (!draft.trim() && !attachment) || attachmentState === "uploading"} className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-black disabled:bg-neutral-800 disabled:text-neutral-600"><SendIcon /></button></div><p className="mx-auto mt-2 max-w-3xl text-center text-[10px] text-neutral-600">Enter to send · Shift+Enter for a new line</p></footer>
                </> : <div className="flex flex-1 items-center justify-center p-6 text-center"><div><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950"><TeamIcon /></div><h2 className="mt-4 text-sm font-semibold">Select a team conversation</h2><p className="mt-2 text-xs text-neutral-600">Direct messages and team chats update without reloading.</p></div></div>}
            </div>
        </div>
        {editingTeam !== undefined ? <TeamEditor bootstrap={{ ...bootstrap, teams }} team={editingTeam} onClose={() => setEditingTeam(undefined)} onSaved={async () => { await refresh(selectedRef.current) }} /> : null}
        <MessageMediaLightbox media={previewMedia} onClose={() => setPreviewMedia(null)} />
    </section>
}
