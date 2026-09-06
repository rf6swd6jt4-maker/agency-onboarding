"use client"

import { createPortal } from "react-dom"
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react"
import type { WorkspaceInvitationActionState } from "@/app/[workspaceSlug]/users/actions"
import { Status, type StatusTone } from "@/components/ui"
import { WorkspaceSuccessNotice } from "@/components/workspace/WorkspaceSuccessNotice"

type InvitationLookupStatus = "already_member" | "workspace_invite_pending" | "betelgeze_invite_pending" | "on_betelgeze" | "not_on_betelgeze"

type InvitationLookup = {
    status: InvitationLookupStatus
    accountExists: boolean
    email: string | null
    username: string | null
    canInvite: boolean
    actionLabel: "Invite to workspace" | "Invite to Betelgeze"
}

function lookupStatus(status: InvitationLookupStatus): { label: string; tone: StatusTone } {
    if (status === "already_member") return { label: "Already in workspace", tone: "green" }
    if (status === "workspace_invite_pending") return { label: "Invite to workspace pending", tone: "yellow" }
    if (status === "betelgeze_invite_pending") return { label: "Invite to BE pending", tone: "yellow" }
    if (status === "on_betelgeze") return { label: "On Betelgeze", tone: "green" }
    return { label: "Not on Betelgeze", tone: "grey" }
}

export function WorkspaceInvitationForm({
    workspaceSlug,
    action,
    canInviteAdmins,
    services,
}: {
    workspaceSlug: string
    action: (formData: FormData) => Promise<WorkspaceInvitationActionState>
    canInviteAdmins: boolean
    services: Array<{ id: string; name: string }>
}) {
    const [open, setOpen] = useState(false)
    const [identifier, setIdentifier] = useState("")
    const [lookup, setLookup] = useState<InvitationLookup | null>(null)
    const [lookupState, setLookupState] = useState<"idle" | "checking" | "error">("idle")
    const [lookupError, setLookupError] = useState<string | null>(null)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const [role, setRole] = useState<"staff" | "admin">("staff")
    const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(() => new Set())
    const [pending, startTransition] = useTransition()
    const dialogRef = useRef<HTMLElement>(null)
    const closeRef = useRef<HTMLButtonElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const portalTarget = typeof window !== "undefined" ? (window.parent !== window ? window.parent.document.body : document.body) : null

    useEffect(() => {
        if (!notice) return
        const timeout = window.setTimeout(() => setNotice(null), 8500)
        return () => window.clearTimeout(timeout)
    }, [notice])

    useEffect(() => {
        if (!open) return
        const hostDocument = dialogRef.current?.ownerDocument ?? document
        const previousOverflow = hostDocument.body.style.overflow
        const origin = hostDocument.activeElement instanceof HTMLElement ? hostDocument.activeElement : null
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !pending) {
                event.preventDefault()
                setOpen(false)
                return
            }
            if (event.key !== "Tab" || !dialogRef.current) return
            const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
            if (!focusable.length) return
            const first = focusable[0]
            const last = focusable.at(-1)!
            if (event.shiftKey && hostDocument.activeElement === first) { event.preventDefault(); last.focus() }
            else if (!event.shiftKey && hostDocument.activeElement === last) { event.preventDefault(); first.focus() }
        }
        hostDocument.body.style.overflow = "hidden"
        hostDocument.addEventListener("keydown", onKeyDown)
        inputRef.current?.focus()
        return () => {
            hostDocument.body.style.overflow = previousOverflow
            hostDocument.removeEventListener("keydown", onKeyDown)
            origin?.focus()
        }
    }, [open, pending])

    useEffect(() => {
        if (!open) return
        const value = identifier.trim()
        if (value.replace(/^@/, "").length < 3) {
            return
        }
        const controller = new AbortController()
        const timeout = window.setTimeout(async () => {
            try {
                const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/users/lookup?identifier=${encodeURIComponent(value)}`, { cache: "no-store", signal: controller.signal })
                const payload = await response.json() as InvitationLookup & { error?: string }
                if (!response.ok) throw new Error(payload.error ?? "Betelgeze could not check that account.")
                setLookup(payload)
                setLookupState("idle")
            } catch (error) {
                if (controller.signal.aborted) return
                setLookupState("error")
                setLookupError(error instanceof Error ? error.message : "Betelgeze could not check that account.")
            }
        }, 350)
        return () => {
            controller.abort()
            window.clearTimeout(timeout)
        }
    }, [identifier, open, workspaceSlug])

    function openDialog() {
        setIdentifier("")
        setLookup(null)
        setLookupState("idle")
        setLookupError(null)
        setSubmitError(null)
        setRole("staff")
        setSelectedServiceIds(new Set())
        setOpen(true)
    }

    function changeIdentifier(value: string) {
        setIdentifier(value)
        setLookup(null)
        setLookupError(null)
        setSubmitError(null)
        setLookupState(value.trim().replace(/^@/, "").length < 3 ? "idle" : "checking")
    }

    function submitInvitation(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!lookup?.canInvite || !lookup.email) return
        const formData = new FormData(event.currentTarget)
        setSubmitError(null)
        startTransition(async () => {
            const result = await action(formData)
            if (!result.ok) {
                setSubmitError(result.message)
                return
            }
            setOpen(false)
            setNotice("Invitation email sent")
        })
    }

    const status = lookup ? lookupStatus(lookup.status) : null
    const invitationDisabled = pending || (role === "staff" && selectedServiceIds.size === 0)
    const modal = open ? <div className="fixed inset-0 z-[2147483646] flex items-center justify-center overflow-hidden overscroll-none bg-black/75 p-3 text-white backdrop-blur-sm sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setOpen(false) }}>
        <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="add-workspace-user-title" className="betelgeze-popup-enter flex max-h-[min(92dvh,44rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-950 shadow-2xl shadow-black/70">
            <header className="flex shrink-0 items-start gap-4 border-b border-neutral-800 px-4 py-4 sm:px-5">
                <div className="min-w-0 flex-1">
                    <h2 id="add-workspace-user-title" className="text-lg font-semibold">Add user</h2>
                    <p className="mt-1 text-sm leading-5 text-neutral-500">Find someone by their exact Betelgeze username or email address.</p>
                </div>
                <button ref={closeRef} type="button" disabled={pending} onClick={() => setOpen(false)} aria-label="Close Add user" className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-xl text-neutral-500 hover:text-white disabled:opacity-40">×</button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                <label className="block text-sm font-medium text-neutral-300">Username or email
                    <input ref={inputRef} value={identifier} onChange={(event) => changeIdentifier(event.target.value)} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="@username or person@business.com" className="mt-2 h-11 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white outline-none placeholder:text-neutral-700 focus:border-neutral-500" />
                </label>

                {lookupState === "checking" ? <div className="mt-4"><Status label="Checking Betelgeze" tone="grey" /></div> : null}
                {lookupError ? <p role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{lookupError}</p> : null}

                {lookup && status ? <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900/50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                            {lookup.username ? <p className="truncate text-sm font-medium text-white">@{lookup.username}</p> : null}
                            {lookup.email ? <p className="truncate text-xs text-neutral-500">{lookup.email}</p> : <p className="text-xs text-neutral-500">Use their email address to send an invitation.</p>}
                        </div>
                        <Status label={status.label} tone={status.tone} />
                    </div>
                </div> : null}

                {lookup?.canInvite && lookup.email ? <form onSubmit={submitInvitation} className="mt-5 space-y-4">
                    <input type="hidden" name="email" value={lookup.email} />
                    <label className="block text-sm text-neutral-300">Role
                        <select name="role" value={role} onChange={(event) => setRole(event.target.value === "admin" ? "admin" : "staff")} className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white">
                            <option value="staff">Staff</option>
                            {canInviteAdmins ? <option value="admin">Admin</option> : null}
                        </select>
                    </label>

                    {role === "staff" ? <fieldset>
                        <legend className="text-sm font-medium text-neutral-300">Services</legend>
                        <p className="mt-1 text-xs leading-5 text-neutral-500">Select at least one service. Its Staff permissions determine workspace access.</p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {services.map((service) => <label key={service.id} className="flex min-h-10 items-center gap-2 rounded-lg border border-neutral-800 bg-black px-3 text-sm text-neutral-300">
                                <input type="checkbox" name="serviceId" value={service.id} checked={selectedServiceIds.has(service.id)} onChange={(event) => setSelectedServiceIds((current) => {
                                    const next = new Set(current)
                                    if (event.target.checked) next.add(service.id)
                                    else next.delete(service.id)
                                    return next
                                })} className="h-4 w-4 accent-white" />
                                <span className="min-w-0 truncate">{service.name}</span>
                            </label>)}
                        </div>
                        {!services.length ? <p className="mt-2 text-sm text-amber-300">Add an active service before inviting Staff.</p> : null}
                    </fieldset> : null}

                    {submitError ? <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{submitError}</p> : null}

                    <div className="flex items-center justify-end gap-2 border-t border-neutral-800 pt-4">
                        <button type="button" disabled={pending} onClick={() => setOpen(false)} className="h-9 px-3 text-sm text-neutral-400 hover:text-white disabled:opacity-40">Cancel</button>
                        <button type="submit" disabled={invitationDisabled} className="h-9 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-40">{pending ? "Sending…" : lookup.actionLabel}</button>
                    </div>
                </form> : null}
            </div>
        </section>
    </div> : null

    return <>
        <button type="button" onClick={openDialog} className="inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-medium text-black transition hover:bg-neutral-200">Add user</button>
        {modal && portalTarget ? createPortal(modal, portalTarget) : null}
        {notice && portalTarget ? createPortal(<WorkspaceSuccessNotice label={notice} />, portalTarget) : null}
    </>
}
