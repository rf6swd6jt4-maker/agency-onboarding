"use client"

import Link from "next/link"
import { useState } from "react"

import { Status, type StatusTone } from "@/components/ui"
import { formatRelativeTime } from "@/lib/ui/relative-time"

export type CommunicationMessage = {
    id: string
    body: string
    direction: string
    provider: string
    status: string
    created_at: string
}

export type ClientConversation = {
    id: string
    title: string
    subtitle: string | null
    messages: CommunicationMessage[]
}

type CommunicationsWorkspaceProps = {
    workspaceSlug: string
    activeArea: "clients" | "team" | "calendar"
    conversations: ClientConversation[]
    selectedConversationId: string | null
}

function workspaceHref(workspaceSlug: string, suffix = "") {
    const cleanSuffix = suffix.replace(/^\/+/, "")
    return `/${workspaceSlug}${cleanSuffix ? `/${cleanSuffix}` : ""}`
}

function relationshipHubHref(workspaceSlug: string, relationshipId: string) {
    return workspaceHref(workspaceSlug, `relationships/${relationshipId}`)
}

function BackIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="m15 6-6 6 6 6" /></svg>
}

function SearchIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
}

function VideoIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" /></svg>
}

function CalendarIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>
}

function PeopleIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><circle cx="9" cy="8" r="3" /><circle cx="17" cy="10" r="2.5" /><path d="M3 20a6 6 0 0 1 12 0M14 20a4.5 4.5 0 0 1 7 0" /></svg>
}

function initials(value: string) {
    return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?"
}

function providerLabel(provider: string) {
    if (provider === "meta_whatsapp" || provider === "whatsapp" || provider === "clickup_chat") return "WhatsApp"
    if (provider === "clickup") return "ClickUp"
    return provider.replace(/_/g, " ")
}

function messageStatus(status: string): { label: string; tone: StatusTone } {
    const normalized = status.toLowerCase()
    if (normalized.includes("failed") || normalized.includes("error")) return { label: "Failed", tone: "red" }
    if (normalized.includes("queued") || normalized.includes("pending") || normalized.includes("sending")) return { label: "Sending", tone: "yellow" }
    if (normalized.includes("delivered") || normalized.includes("read")) return { label: "Delivered", tone: "green" }
    return { label: "Sent", tone: "grey" }
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

function EmptyArea({ area }: { area: "team" | "calendar" }) {
    const calendar = area === "calendar"
    return <section className="flex min-h-[32rem] flex-1 items-center justify-center p-6 text-center lg:min-h-0">
        <div className="max-w-md">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-neutral-800 bg-neutral-900 text-neutral-400">
                {calendar ? <CalendarIcon /> : <PeopleIcon />}
            </span>
            <h2 className="mt-4 text-lg font-semibold">{calendar ? "Calendar is the next communications workspace" : "Team chat is the next communications workspace"}</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-500">
                {calendar
                    ? "Meeting scheduling and Google Meet links need a calendar connection and meeting model before they can be used here."
                    : "Internal conversations need their own workspace-scoped message model before messages can be created here."}
            </p>
        </div>
    </section>
}

export function CommunicationsWorkspace({ workspaceSlug, activeArea, conversations, selectedConversationId }: CommunicationsWorkspaceProps) {
    const [searchQuery, setSearchQuery] = useState("")
    const selected = conversations.find((conversation) => conversation.id === selectedConversationId) ?? null
    const normalizedSearch = searchQuery.trim().toLowerCase()
    const visibleConversations = normalizedSearch
        ? conversations.filter((conversation) => `${conversation.title} ${conversation.subtitle ?? ""} ${conversation.messages.at(-1)?.body ?? ""}`.toLowerCase().includes(normalizedSearch))
        : conversations
    const baseHref = workspaceHref(workspaceSlug, `communications?area=${activeArea}`)

    if (activeArea !== "clients") {
        return <div className="mt-5 overflow-hidden rounded-2xl border border-neutral-800 bg-black lg:sticky lg:top-5 lg:flex lg:h-[calc(100dvh-2.5rem)]">
            <EmptyArea area={activeArea} />
        </div>
    }

    return (
        // A conversation workspace is intentionally not built from List: its two panes and message timeline are interactive navigation, not a comparable-record list.
        <section aria-label="Client conversations" className="mt-5 overflow-hidden rounded-2xl border border-neutral-800 bg-black lg:sticky lg:top-5 lg:grid lg:h-[calc(100dvh-2.5rem)] lg:grid-cols-[22rem_minmax(0,1fr)]">
            <aside className={`${selected ? "hidden lg:flex" : "flex"} min-h-[34rem] flex-col border-neutral-800 lg:min-h-0 lg:border-r`}>
                <div className="border-b border-neutral-800 bg-neutral-950 p-4">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <h2 className="font-semibold">Client chats</h2>
                            <p className="mt-0.5 text-xs text-neutral-500">{visibleConversations.length} conversation{visibleConversations.length === 1 ? "" : "s"}</p>
                        </div>
                        <span className="text-xs text-neutral-600">Newest first</span>
                    </div>
                    <div className="relative mt-3">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600"><SearchIcon /></span>
                        <input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} aria-label="Search client chats" placeholder="Search conversations" className="h-10 w-full rounded-lg border border-neutral-800 bg-black pl-9 pr-3 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-neutral-600" />
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                    {visibleConversations.length ? visibleConversations.map((conversation) => {
                        const latest = conversation.messages.at(-1)!
                        const selectedRow = conversation.id === selectedConversationId
                        const href = workspaceHref(workspaceSlug, `communications?area=clients&conversation=${conversation.id}`)
                        return <Link key={conversation.id} href={href} aria-current={selectedRow ? "page" : undefined} className={`grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3 border-b border-neutral-900 px-4 py-3.5 transition ${selectedRow ? "bg-neutral-900" : "hover:bg-neutral-950"}`}>
                            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-800 text-sm font-semibold text-neutral-200">{initials(conversation.title)}</span>
                            <span className="min-w-0">
                                <span className="flex items-start justify-between gap-3">
                                    <span className="truncate text-sm font-semibold text-neutral-100">{conversation.title}</span>
                                    <time dateTime={latest.created_at} className={`shrink-0 text-[11px] ${latest.direction === "inbound" ? "text-amber-300" : "text-neutral-600"}`}>{formatRelativeTime(latest.created_at)}</time>
                                </span>
                                <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-neutral-500">
                                    {latest.direction === "outbound" ? <span aria-hidden="true">You:</span> : null}
                                    <span className="truncate">{latest.body || "No message body saved"}</span>
                                </span>
                            </span>
                        </Link>
                    }) : <div className="p-6 text-center"><p className="font-medium text-neutral-200">{conversations.length ? "No matching conversations" : "No client conversations yet"}</p><p className="mt-2 text-sm leading-6 text-neutral-500">{conversations.length ? "Try another client name or message." : "Recorded client messages will appear here in latest-activity order."}</p></div>}
                </div>
            </aside>

            <div className={`${selected ? "flex" : "hidden lg:flex"} min-h-[34rem] min-w-0 flex-col lg:min-h-0`}>
                {selected ? <>
                    <header className="flex h-[4.5rem] shrink-0 items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-3 sm:px-4">
                        <Link href={baseHref} aria-label="Back to client chats" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:text-white lg:hidden"><BackIcon /></Link>
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-xs font-semibold text-neutral-200">{initials(selected.title)}</span>
                        <div className="min-w-0 flex-1">
                            <h2 className="truncate text-sm font-semibold">{selected.title}</h2>
                            <p className="mt-0.5 truncate text-xs text-neutral-500">{selected.subtitle || providerLabel(selected.messages.at(-1)?.provider ?? "whatsapp")}</p>
                        </div>
                        <button type="button" disabled title="Meeting links will be available with Calendar" aria-label="Start meeting (not yet available)" className="flex h-10 w-10 shrink-0 cursor-not-allowed items-center justify-center rounded-full text-neutral-700"><VideoIcon /></button>
                        <Link href={relationshipHubHref(workspaceSlug, selected.id)} className="hidden text-xs text-neutral-400 underline decoration-neutral-700 underline-offset-4 hover:text-white sm:block">Relationship</Link>
                    </header>

                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[radial-gradient(circle_at_top,_rgba(38,38,38,0.45),_transparent_35%)] px-3 py-5 sm:px-6">
                        <div className="mx-auto flex max-w-3xl flex-col gap-2">
                            {selected.messages.map((message, index) => {
                                const status = messageStatus(message.status)
                                const showDay = index === 0 || !sameDay(selected.messages[index - 1].created_at, message.created_at)
                                return <div key={message.id}>
                                    {showDay ? <div className="my-4 flex justify-center first:mt-0"><time dateTime={message.created_at} className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-[11px] text-neutral-500">{messageDay(message.created_at)}</time></div> : null}
                                    <article className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                                        <div className={`max-w-[86%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm sm:max-w-[72%] ${message.direction === "outbound" ? "rounded-br-md bg-neutral-100 text-neutral-950" : "rounded-bl-md border border-neutral-800 bg-neutral-900 text-neutral-100"}`}>
                                            <p className="whitespace-pre-wrap break-words leading-5">{message.body || "No message body saved"}</p>
                                            <div className={`mt-1.5 flex items-center justify-end gap-2 text-[10px] ${message.direction === "outbound" ? "text-neutral-500" : "text-neutral-600"}`}>
                                                <span>{providerLabel(message.provider)}</span>
                                                <time dateTime={message.created_at}>{messageTime(message.created_at)}</time>
                                                {message.direction === "outbound" ? <Status label={status.label} tone={status.tone} compact /> : null}
                                            </div>
                                        </div>
                                    </article>
                                </div>
                            })}
                        </div>
                    </div>

                    <footer className="shrink-0 border-t border-neutral-800 bg-neutral-950 p-3 sm:p-4">
                        <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-xl border border-neutral-800 bg-black px-3 py-2">
                            <textarea rows={1} disabled aria-label="Message composer unavailable" placeholder="In-app replies are coming next" className="max-h-28 min-h-8 min-w-0 flex-1 resize-none bg-transparent py-1 text-sm text-neutral-500 outline-none placeholder:text-neutral-600" />
                            <button type="button" disabled className="h-9 shrink-0 cursor-not-allowed rounded-lg bg-neutral-800 px-4 text-sm font-medium text-neutral-600">Send</button>
                        </div>
                        <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-neutral-600">Message history is live. Sending remains disabled until the workspace-aware outbound path is connected.</p>
                    </footer>
                </> : <div className="flex flex-1 items-center justify-center p-6 text-center">
                    <div><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-neutral-800 bg-neutral-900 text-neutral-500"><PeopleIcon /></span><h2 className="mt-4 font-semibold">Select a client chat</h2><p className="mt-2 text-sm text-neutral-500">Choose a conversation from the left to read its recorded messages.</p></div>
                </div>}
            </div>
        </section>
    )
}
