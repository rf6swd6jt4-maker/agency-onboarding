"use client"

import { useEffect, useRef, useState } from "react"

import { ClientPortalChat } from "@/components/client-portal/ClientPortalChat"

type PortalPanel = "chat" | "resources"

function firstName(name: string) {
    return name.trim().split(/\s+/)[0] || "there"
}

function localGreeting(hour: number) {
    if (hour < 12) return "Good morning"
    if (hour < 18) return "Good afternoon"
    return "Good evening"
}

function BackIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
}

function ChatIcon({ className = "h-5 w-5" }: { className?: string }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} fill-none stroke-current`} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20 15a3 3 0 0 1-3 3H9l-5 3v-6a3 3 0 0 1-1-2.2V7a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3Z" /><path d="M8 9h8M8 13h5" /></svg>
}

function ResourceIcon({ className = "h-5 w-5" }: { className?: string }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} fill-none stroke-current`} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5M12 17v-6M9.5 13.5 12 11l2.5 2.5" /></svg>
}

function ActionsIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-none stroke-current" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5h10M9 12h10M9 19h10" /><path d="m3 5 1 1 2-2M3 12l1 1 2-2M3 19l1 1 2-2" /></svg>
}

function ResultsIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-none stroke-current" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
}

function ArrowIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
}

function PortalSidePanel({ panel, token, workspaceName, onBack }: { panel: PortalPanel; token: string; workspaceName: string; onBack: () => void }) {
    const chat = panel === "chat"
    const panelRef = useRef<HTMLElement>(null)
    const backRef = useRef<HTMLButtonElement>(null)

    useEffect(() => {
        const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const trapFocus = (event: KeyboardEvent) => {
            if (event.key !== "Tab" || !panelRef.current) return
            const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
            if (!focusable.length) return
            const first = focusable[0]
            const last = focusable.at(-1)!
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
        }
        backRef.current?.focus()
        document.addEventListener("keydown", trapFocus)
        return () => {
            document.removeEventListener("keydown", trapFocus)
            origin?.focus()
        }
    }, [])

    return <>
        <button type="button" aria-label="Close panel" onClick={onBack} className="fixed inset-0 z-40 hidden bg-black/25 backdrop-blur-[1px] md:block" />
        <aside ref={panelRef} data-client-portal-panel role="dialog" aria-modal="true" aria-labelledby="client-portal-panel-title" className="fixed inset-x-0 top-0 z-50 flex h-[var(--client-portal-viewport-bottom,100dvh)] min-h-0 flex-col bg-[var(--onboarding-surface,#FFFFFF)] text-[var(--onboarding-text,#0F172A)] shadow-2xl [backface-visibility:hidden] md:left-auto md:w-[30rem] md:border-l md:border-black/10">
            <header className="flex h-16 shrink-0 items-center gap-3 border-b border-black/10 px-4 sm:px-5">
                <button ref={backRef} type="button" onClick={onBack} className="inline-flex h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-[var(--onboarding-primary,#1E3A5F)] transition hover:bg-black/5" aria-label={`Back from ${chat ? "chat" : "resources"}`}><BackIcon /><span>Back</span></button>
                <div className="min-w-0 border-l border-black/10 pl-4">
                    <h2 id="client-portal-panel-title" className="truncate text-base font-semibold">{chat ? "Chat" : "Resources"}</h2>
                    <p className="truncate text-xs text-[var(--onboarding-muted,#475569)]">{workspaceName}</p>
                </div>
            </header>

            <div className={`flex min-h-0 flex-1 flex-col ${chat ? "" : "p-4 sm:p-6"}`}>
                {chat ? <ClientPortalChat token={token} workspaceName={workspaceName} /> : <div className="flex min-h-0 flex-1 flex-col">
                    <div className="rounded-2xl border border-black/10 p-5">
                        <h3 className="font-semibold">Send something to the team</h3>
                        <p className="mt-2 text-sm leading-6 text-[var(--onboarding-muted,#475569)]">Documents, images and other resources will be securely attached to your account.</p>
                    </div>
                    <div className="mt-4 flex flex-1 items-center justify-center rounded-2xl border-2 border-dashed border-black/15 bg-[var(--onboarding-page,#F8F7F3)] p-8 text-center">
                        <div className="max-w-xs">
                            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--onboarding-primary,#1E3A5F)]/10 text-[var(--onboarding-primary,#1E3A5F)]"><ResourceIcon className="h-6 w-6" /></span>
                            <h3 className="mt-4 font-semibold">Resource submission is coming next</h3>
                            <p className="mt-2 text-sm leading-6 text-[var(--onboarding-muted,#475569)]">This space will let you upload files without email attachments or external drive links.</p>
                        </div>
                    </div>
                </div>}
            </div>
        </aside>
    </>
}

export function ClientPortalShell({ token, workspaceName, primaryPersonName }: { token: string; workspaceName: string; primaryPersonName: string }) {
    const [panel, setPanel] = useState<PortalPanel | null>(null)
    const [greeting, setGreeting] = useState("Welcome")

    useEffect(() => {
        function updateGreeting() {
            setGreeting(localGreeting(new Date().getHours()))
        }
        updateGreeting()
        const interval = window.setInterval(updateGreeting, 60_000)
        return () => window.clearInterval(interval)
    }, [])

    useEffect(() => {
        if (!panel) return
        const previousOverflow = document.body.style.overflow
        const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setPanel(null) }
        document.body.style.overflow = "hidden"
        document.addEventListener("keydown", closeOnEscape)
        return () => {
            document.body.style.overflow = previousOverflow
            document.removeEventListener("keydown", closeOnEscape)
        }
    }, [panel])

    return <div data-betelgeze-client-portal-session="valid" className="min-h-screen bg-[var(--onboarding-page,#F8F7F3)] text-[var(--onboarding-text,#0F172A)]">
        <header className="border-b border-black/10 bg-[var(--onboarding-surface,#FFFFFF)]">
            <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
                <p className="min-w-0 truncate text-base font-semibold tracking-tight sm:text-lg">{workspaceName}</p>
                <nav aria-label="Client portal" className="flex shrink-0 items-center gap-1 sm:gap-2">
                    <button type="button" onClick={() => setPanel("resources")} className="inline-flex h-11 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-[var(--onboarding-muted,#475569)] transition hover:bg-black/5 hover:text-[var(--onboarding-text,#0F172A)] sm:px-3"><ResourceIcon /><span className="hidden sm:inline">Resources</span></button>
                    <button type="button" onClick={() => setPanel("chat")} className="inline-flex h-11 items-center gap-2 rounded-lg bg-[var(--onboarding-primary,#1E3A5F)] px-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-95"><ChatIcon /><span>Chat</span></button>
                </nav>
            </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-11 lg:px-8">
            <section aria-labelledby="portal-greeting">
                <p className="text-sm font-semibold text-[var(--onboarding-primary,#1E3A5F)]">Your client portal</p>
                <h1 id="portal-greeting" className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{greeting}, {firstName(primaryPersonName)}</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--onboarding-muted,#475569)] sm:text-base">Everything you need from {workspaceName}, kept in one simple place.</p>
            </section>

            <section aria-labelledby="required-actions-title" className="mt-7 overflow-hidden rounded-2xl border border-black/10 bg-[var(--onboarding-surface,#FFFFFF)] shadow-sm">
                <div className="flex items-start gap-4 p-5 sm:p-6">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--onboarding-accent,#F0B429)]/20 text-[var(--onboarding-primary,#1E3A5F)]"><ActionsIcon /></span>
                    <div className="min-w-0 flex-1">
                        <h2 id="required-actions-title" className="text-xl font-semibold">Required actions</h2>
                        <p className="mt-1.5 text-sm leading-6 text-[var(--onboarding-muted,#475569)]">Anything the team needs from you will appear here.</p>
                    </div>
                </div>
                <div className="border-t border-black/10 bg-black/[0.015] px-5 py-5 sm:px-6">
                    <div className="rounded-xl border border-dashed border-black/15 px-4 py-5">
                        <p className="font-medium">No actions to show yet</p>
                        <p className="mt-1 text-sm text-[var(--onboarding-muted,#475569)]">The required-action submission system will be added here.</p>
                    </div>
                </div>
            </section>

            <section aria-labelledby="results-title" className="mt-5 rounded-2xl border border-black/10 bg-[var(--onboarding-surface,#FFFFFF)] p-5 shadow-sm sm:p-6">
                <div className="flex items-start gap-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--onboarding-primary,#1E3A5F)]/10 text-[var(--onboarding-primary,#1E3A5F)]"><ResultsIcon /></span>
                    <div>
                        <h2 id="results-title" className="text-xl font-semibold">Your results</h2>
                        <p className="mt-1.5 text-sm leading-6 text-[var(--onboarding-muted,#475569)]">The most important performance numbers will appear here.</p>
                    </div>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3" aria-label="Results dashboard placeholder">
                    {["Main result", "Progress", "Latest update"].map((label) => <div key={label} className="rounded-xl border border-dashed border-black/15 p-4"><p className="text-xs font-medium text-[var(--onboarding-muted,#475569)]">{label}</p><div className="mt-3 h-7 w-20 rounded bg-black/[0.06]" /></div>)}
                </div>
            </section>

            <section aria-labelledby="resources-title" className="mt-5 rounded-2xl bg-[var(--onboarding-primary,#1E3A5F)] p-5 text-white shadow-sm sm:p-6">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-4">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10"><ResourceIcon className="h-6 w-6" /></span>
                        <div><h2 id="resources-title" className="text-lg font-semibold">Resource submission</h2><p className="mt-1.5 max-w-xl text-sm leading-6 text-white/75">A secure place to send documents, images and other files to the team.</p></div>
                    </div>
                    <button type="button" onClick={() => setPanel("resources")} className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-semibold text-[var(--onboarding-primary,#1E3A5F)] transition hover:bg-white/90">Open resources <ArrowIcon /></button>
                </div>
            </section>
        </main>

        {panel ? <PortalSidePanel panel={panel} token={token} workspaceName={workspaceName} onBack={() => setPanel(null)} /> : null}
    </div>
}
