"use client"

import { createPortal } from "react-dom"
import { useEffect, useRef, useState } from "react"
import { RoundPill } from "@/components/ui"
import { WorkspaceActionButton } from "@/components/workspace/WorkspaceActionButton"
import type { WorkspaceRole } from "@/lib/workspace-roles"

type ServiceOption = {
    id: string
    name: string
    state: "active" | "retired" | "archived"
    capabilities: string[]
}

export function WorkspaceUserAccessEditor({
    userId,
    email,
    role: initialRole,
    services,
    selectedServiceIds,
    canChangeRole,
    action,
}: {
    userId: string
    email: string
    role: WorkspaceRole
    services: ServiceOption[]
    selectedServiceIds: string[]
    canChangeRole: boolean
    action: (formData: FormData) => Promise<void>
}) {
    const [open, setOpen] = useState(false)
    const [role, setRole] = useState<"staff" | "admin">(initialRole === "admin" ? "admin" : "staff")
    const [selected, setSelected] = useState(() => new Set(selectedServiceIds))
    const dialogRef = useRef<HTMLDivElement>(null)
    const closeRef = useRef<HTMLButtonElement>(null)
    const portalTarget = typeof window !== "undefined" ? (window.parent !== window ? window.parent.document.body : document.body) : null
    const assignedServices = services.filter((service) => selectedServiceIds.includes(service.id))

    useEffect(() => {
        if (!open) return
        const hostDocument = dialogRef.current?.ownerDocument ?? document
        const previousOverflow = hostDocument.body.style.overflow
        const origin = hostDocument.activeElement instanceof HTMLElement ? hostDocument.activeElement : null
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
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
        closeRef.current?.focus()
        return () => {
            hostDocument.body.style.overflow = previousOverflow
            hostDocument.removeEventListener("keydown", onKeyDown)
            origin?.focus()
        }
    }, [open])

    const capabilityLabels = role === "admin"
        ? ["All workspace panels"]
        : [...new Set(services.filter((service) => selected.has(service.id)).flatMap((service) => service.capabilities))]
            .flatMap((capability) => capability === "onboarding.manage" ? ["Onboarding"] : capability === "fulfilment.manage" ? ["Fulfilment"] : capability === "appointment_setting.manage" ? ["Appointment Setting"] : [])

    function openEditor() {
        setRole(initialRole === "admin" ? "admin" : "staff")
        setSelected(new Set(selectedServiceIds))
        setOpen(true)
    }

    async function saveAccess(formData: FormData) {
        await action(formData)
        setOpen(false)
    }

    const modal = open ? <div className="fixed inset-0 z-[2147483646] flex items-center justify-center overflow-hidden overscroll-none bg-black/75 p-3 text-white backdrop-blur-sm sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`access-title-${userId}`} className="flex max-h-[min(90dvh,42rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-950 shadow-2xl shadow-black/70">
            <header className="flex items-start gap-4 border-b border-neutral-800 px-4 py-4 sm:px-5">
                <div className="min-w-0 flex-1">
                    <h2 id={`access-title-${userId}`} className="text-lg font-semibold">Edit workspace access</h2>
                    <p className="mt-1 truncate text-sm text-neutral-500">{email}</p>
                </div>
                <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label="Close access editor" className="inline-flex h-9 w-9 items-center justify-center text-xl text-neutral-500 hover:text-white">×</button>
            </header>
            <form action={saveAccess} data-workspace-mutation="background" className="flex min-h-0 flex-1 flex-col">
                <input type="hidden" name="userId" value={userId} />
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
                    {canChangeRole ? <label className="block text-sm text-neutral-300">
                        Role
                        <select name="role" value={role} onChange={(event) => setRole(event.target.value === "admin" ? "admin" : "staff")} className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white">
                            <option value="staff">Staff</option>
                            <option value="admin">Admin</option>
                        </select>
                    </label> : <input type="hidden" name="role" value="staff" />}

                    {role === "staff" ? <fieldset>
                        <legend className="text-sm font-medium text-neutral-300">Services</legend>
                        <p className="mt-1 text-xs leading-5 text-neutral-500">Access is the union of the panels and client records enabled by the selected services.</p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {services.map((service) => <label key={service.id} className="flex min-h-11 items-center gap-2 rounded-lg border border-neutral-800 bg-black px-3 text-sm text-neutral-300">
                                <input
                                    type="checkbox"
                                    name="serviceId"
                                    value={service.id}
                                    checked={selected.has(service.id)}
                                    onChange={(event) => setSelected((current) => {
                                        const next = new Set(current)
                                        if (event.target.checked) next.add(service.id)
                                        else next.delete(service.id)
                                        return next
                                    })}
                                    className="h-4 w-4 accent-white"
                                />
                                <span className="min-w-0 flex-1 truncate">{service.name}</span>
                                {service.state !== "active" ? <span className="text-xs capitalize text-neutral-600">{service.state}</span> : null}
                            </label>)}
                        </div>
                    </fieldset> : null}

                    <div>
                        <p className="text-sm font-medium text-neutral-300">Panel access</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {capabilityLabels.length ? capabilityLabels.map((label) => <RoundPill key={label} tone="sky">{label}</RoundPill>) : <span className="text-sm text-red-300">Select at least one service.</span>}
                        </div>
                    </div>
                </div>
                <footer className="flex items-center justify-end gap-2 border-t border-neutral-800 px-4 py-3 sm:px-5">
                    <button type="button" onClick={() => setOpen(false)} className="h-9 px-3 text-sm text-neutral-400 hover:text-white">Cancel</button>
                    <WorkspaceActionButton pendingLabel="Saving…" disabled={role === "staff" && selected.size === 0} className="h-9 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-40">Save access</WorkspaceActionButton>
                </footer>
            </form>
        </div>
    </div> : null

    return <>
        <div className="flex flex-wrap items-center gap-1.5">
            {initialRole === "staff" ? assignedServices.map((service) => <RoundPill key={service.id} tone="emerald">{service.name}</RoundPill>) : null}
            <button type="button" onClick={openEditor} className="h-8 rounded-lg border border-neutral-700 px-3 text-sm text-neutral-300 hover:border-neutral-500 hover:text-white">Edit access</button>
        </div>
        {portalTarget && modal ? createPortal(modal, portalTarget) : null}
    </>
}
