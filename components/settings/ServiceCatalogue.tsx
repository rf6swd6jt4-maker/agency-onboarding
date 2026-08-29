"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { createPortal } from "react-dom"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { saveOnboardingService, setOnboardingServiceState } from "@/app/[workspaceSlug]/settings/service-actions"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { MobileListActionSurface } from "@/components/list/MobileCardActionSurface"
import { Assignee, SquarePill, Status, type StatusTone } from "@/components/ui"
import type { OnboardingAssigneeOption, OnboardingModuleSummary, OnboardingServiceDefinition, OnboardingServiceState, OnboardingServiceType } from "@/lib/onboarding/configuration-types"
import { SERVICE_TEMPLATES } from "@/lib/onboarding/service-templates"
import { shortId } from "@/lib/ui/relative-time"

const inputClass = "mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white outline-none focus:border-neutral-500"
const textareaClass = "mt-1.5 w-full resize-none rounded-lg border border-neutral-700 bg-black px-3 py-2 text-sm leading-5 text-white outline-none focus:border-neutral-500"

function serviceStatus(state: OnboardingServiceState): { label: string; tone: StatusTone } {
    if (state === "active") return { label: "Active", tone: "green" }
    if (state === "retired") return { label: "Retired", tone: "yellow" }
    return { label: "Archived", tone: "grey" }
}

function blankService(): OnboardingServiceDefinition {
    return {
        id: "",
        revisionId: null,
        code: "Generated after save",
        name: "",
        description: "",
        serviceType: "one_time",
        recurringName: "",
        recurringDescription: "",
        defaultBillingInterval: "month",
        defaultBillingIntervalCount: 1,
        thumbnailPath: null,
        thumbnailUrl: null,
        state: "active",
        version: 0,
        isTest: false,
        defaultUpfrontPriceCents: 0,
        defaultRecurringPriceCents: 0,
        currency: "USD",
        defaultAssigneeId: null,
        displayPriority: 100,
        modules: [],
        archiveBlockers: [],
        lastEditedAt: null,
    }
}

function priceLabel(cents: number, currency: string) {
    try {
        return new Intl.NumberFormat("en-IE", { style: "currency", currency }).format(cents / 100)
    } catch {
        return `${currency} ${(cents / 100).toFixed(2)}`
    }
}

function intervalLabel(service: OnboardingServiceDefinition) {
    const count = service.defaultBillingIntervalCount
    const unit = service.defaultBillingInterval
    return count === 1 ? `per ${unit}` : `every ${count} ${unit}s`
}

function intervalCountMaximum(interval: OnboardingServiceDefinition["defaultBillingInterval"]) {
    return interval === "year" ? 3 : interval === "month" ? 36 : 156
}

function ServiceTemplatesModal({ onClose, onCreateCustom }: { onClose: () => void; onCreateCustom: () => void }) {
    const modalRef = useRef<HTMLElement>(null)
    const closeRef = useRef<HTMLButtonElement>(null)

    useEffect(() => {
        const hostDocument = modalRef.current?.ownerDocument ?? document
        const origin = hostDocument.activeElement instanceof HTMLElement ? hostDocument.activeElement : null
        const previousOverflow = hostDocument.body.style.overflow
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault()
                onClose()
                return
            }
            if (event.key !== "Tab" || !modalRef.current) return
            const focusable = [...modalRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
            if (!focusable.length) return
            const first = focusable[0]
            const last = focusable.at(-1)!
            if (event.shiftKey && hostDocument.activeElement === first) { event.preventDefault(); last.focus() }
            else if (!event.shiftKey && hostDocument.activeElement === last) { event.preventDefault(); first.focus() }
        }
        hostDocument.body.style.overflow = "hidden"
        hostDocument.addEventListener("keydown", handleKey)
        closeRef.current?.focus()
        return () => {
            hostDocument.body.style.overflow = previousOverflow
            hostDocument.removeEventListener("keydown", handleKey)
            origin?.focus()
        }
    }, [onClose])

    return <div className="fixed inset-0 z-[2147483646] flex items-center justify-center overflow-hidden overscroll-none bg-black/75 p-3 text-white backdrop-blur-sm sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
        <section ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="service-templates-title" aria-describedby="service-templates-description" className="flex max-h-[min(92dvh,52rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-950 shadow-2xl shadow-black/70 sm:h-[min(90dvh,52rem)]">
            <header className="flex shrink-0 items-start gap-4 border-b border-neutral-800 px-4 py-4 sm:px-6 sm:py-5">
                <div className="min-w-0 flex-1">
                    <h2 id="service-templates-title" className="text-xl font-semibold tracking-tight sm:text-2xl">Service Templates</h2>
                    <p id="service-templates-description" className="mt-1.5 text-sm leading-6 text-neutral-500">Start with a ready-made service for your agency catalogue.</p>
                </div>
                <button ref={closeRef} type="button" onClick={onClose} aria-label="Close service templates" className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-xl text-neutral-500 transition hover:text-white">×</button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5" aria-label="Available service templates">
                    <button type="button" onClick={onCreateCustom} className="group min-w-0 overflow-hidden rounded-xl border border-dashed border-neutral-700 bg-black text-left transition hover:border-neutral-500 hover:bg-neutral-900/60">
                        <span className="flex aspect-[16/10] items-center justify-center border-b border-dashed border-neutral-800 text-neutral-500 transition group-hover:text-white">
                            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-9 w-9 fill-none stroke-current" strokeWidth="1.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                        </span>
                        <span className="block p-4">
                            <span className="block font-semibold text-white">Add your own</span>
                            <span className="mt-1.5 block text-sm leading-5 text-neutral-500">Create a custom service from scratch.</span>
                        </span>
                    </button>
                    {SERVICE_TEMPLATES.map((template) => <article key={template.id} className="min-w-0 overflow-hidden rounded-xl border border-neutral-800 bg-black">
                        <div className="relative aspect-[16/10] overflow-hidden border-b border-neutral-800 bg-[#080834]">
                            <Image src={template.thumbnail.src} alt={template.thumbnail.alt} fill sizes="(max-width: 639px) calc(100vw - 3.5rem), (max-width: 1023px) 40vw, 17rem" className="object-contain" />
                        </div>
                        <div className="p-4">
                            <h3 className="font-semibold text-white">{template.name}</h3>
                            <p className="mt-1.5 text-sm leading-5 text-neutral-500">{template.description}</p>
                        </div>
                    </article>)}
                </div>
            </div>
        </section>
    </div>
}

function ServiceEditor({ workspaceSlug, service, assignees, schemaReady, onClose }: {
    workspaceSlug: string
    service: OnboardingServiceDefinition
    assignees: OnboardingAssigneeOption[]
    schemaReady: boolean
    onClose: () => void
}) {
    const router = useRouter()
    const [draft, setDraft] = useState(service)
    const [upfrontPrice, setUpfrontPrice] = useState((service.defaultUpfrontPriceCents / 100).toFixed(2))
    const [recurringPrice, setRecurringPrice] = useState((service.defaultRecurringPriceCents / 100).toFixed(2))
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const [uploading, setUploading] = useState(false)
    const editorRef = useRef<HTMLElement>(null)
    const closeRef = useRef<HTMLButtonElement>(null)
    const parsedUpfrontPriceCents = Math.max(0, Math.round((Number(upfrontPrice) || 0) * 100))
    const parsedRecurringPriceCents = draft.serviceType === "retainer" ? Math.max(0, Math.round((Number(recurringPrice) || 0) * 100)) : 0
    const effectiveDraft = { ...draft, defaultUpfrontPriceCents: parsedUpfrontPriceCents, defaultRecurringPriceCents: parsedRecurringPriceCents }
    const dirty = JSON.stringify(effectiveDraft) !== JSON.stringify(service)

    useEffect(() => {
        const hostDocument = editorRef.current?.ownerDocument ?? document
        const origin = hostDocument.activeElement instanceof HTMLElement ? hostDocument.activeElement : null
        const previousOverflow = hostDocument.body.style.overflow
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault()
                onClose()
                return
            }
            if (event.key !== "Tab" || !editorRef.current) return
            const focusable = [...editorRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]')]
            if (!focusable.length) return
            const first = focusable[0]
            const last = focusable.at(-1)!
            if (event.shiftKey && hostDocument.activeElement === first) { event.preventDefault(); last.focus() }
            else if (!event.shiftKey && hostDocument.activeElement === last) { event.preventDefault(); first.focus() }
        }
        hostDocument.body.style.overflow = "hidden"
        hostDocument.addEventListener("keydown", handleKey)
        closeRef.current?.focus()
        return () => {
            hostDocument.body.style.overflow = previousOverflow
            hostDocument.removeEventListener("keydown", handleKey)
            origin?.focus()
        }
    }, [onClose])

    function run(operation: () => Promise<{ ok: boolean; error?: string }>) {
        setError(null)
        startTransition(async () => {
            const outcome = await operation()
            if (!outcome.ok) { setError(outcome.error ?? "The service could not be saved."); return }
            router.refresh()
            onClose()
        })
    }

    function save() {
        run(() => saveOnboardingService(workspaceSlug, service.id || null, effectiveDraft))
    }

    function changeState(state: OnboardingServiceState) {
        if (!service.id) return
        run(() => setOnboardingServiceState(workspaceSlug, service.id, state))
    }

    function changeType(serviceType: OnboardingServiceType) {
        setDraft((current) => ({
            ...current,
            serviceType,
            recurringName: serviceType === "retainer" ? current.recurringName : "",
            recurringDescription: serviceType === "retainer" ? current.recurringDescription : "",
        }))
        if (serviceType === "one_time") setRecurringPrice("0.00")
    }

    async function uploadThumbnail(file: File | null) {
        if (!file) return
        setError(null)
        setUploading(true)
        try {
            const prepared = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/service-thumbnails/upload`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: file.name, size: file.size, type: file.type }),
            })
            const payload = await prepared.json() as { error?: string; uploadUrl?: string; previewUrl?: string; thumbnail?: { path?: string } }
            if (!prepared.ok || !payload.uploadUrl || !payload.thumbnail?.path) throw new Error(payload.error ?? "Could not prepare the thumbnail upload.")
            const uploaded = await fetch(payload.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file })
            if (!uploaded.ok) throw new Error("The thumbnail upload did not complete.")
            setDraft((current) => ({ ...current, thumbnailPath: payload.thumbnail!.path!, thumbnailUrl: payload.previewUrl ?? null }))
        } catch (uploadError) {
            setError(uploadError instanceof Error ? uploadError.message : "The thumbnail could not be uploaded.")
        } finally {
            setUploading(false)
        }
    }

    const saveDisabled = pending || uploading || !schemaReady || service.state === "archived" || !draft.name.trim()
        || (draft.serviceType === "retainer" && (!draft.recurringName.trim() || parsedRecurringPriceCents < 1))
        || (service.state === "active" && !dirty && Boolean(service.id))

    return <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-3 text-white backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
        <section ref={editorRef} role="dialog" aria-modal="true" aria-labelledby="service-editor-title" className="flex max-h-[min(92dvh,54rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-950 shadow-2xl shadow-black/70">
            <header className="flex shrink-0 items-start gap-4 border-b border-neutral-800 px-4 py-4 sm:px-6">
                <div className="min-w-0 flex-1"><p className="text-xs font-medium text-neutral-500">{service.id ? `Revision ${service.version} · ${service.code}` : "Service catalogue"}</p><h2 id="service-editor-title" className="mt-1 truncate text-xl font-semibold">{service.id ? service.name : "New service"}</h2></div>
                <button ref={closeRef} type="button" onClick={onClose} aria-label="Close service editor" className="inline-flex h-9 w-9 items-center justify-center text-xl text-neutral-500 hover:text-white">×</button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
                {!schemaReady ? <p className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-100">The editable catalogue schema is not available yet. Existing services remain visible but read-only.</p> : null}

                <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_12rem]">
                    <div>
                        <p className="text-sm font-medium text-neutral-200">Service type</p>
                        <div className="mt-2 grid grid-cols-2 rounded-lg border border-neutral-700 bg-black p-1" role="group" aria-label="Service type">
                            <button type="button" aria-pressed={draft.serviceType === "one_time"} onClick={() => changeType("one_time")} className={`h-9 rounded-md text-sm ${draft.serviceType === "one_time" ? "bg-white font-medium text-black" : "text-neutral-400 hover:text-white"}`}>One-time</button>
                            <button type="button" aria-pressed={draft.serviceType === "retainer"} onClick={() => changeType("retainer")} className={`h-9 rounded-md text-sm ${draft.serviceType === "retainer" ? "bg-white font-medium text-black" : "text-neutral-400 hover:text-white"}`}>Retainer</button>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-neutral-600">{draft.serviceType === "one_time" ? "One Checkout line item, charged once." : "Separate upfront and subscription line items at Checkout."}</p>
                    </div>

                    <div>
                        <p className="text-sm font-medium text-neutral-200">Thumbnail <span className="font-normal text-neutral-600">(optional)</span></p>
                        <div className="mt-2 flex items-center gap-2">
                            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-neutral-800 bg-black text-[9px] uppercase tracking-wide text-neutral-600">{draft.thumbnailUrl ? <Image src={draft.thumbnailUrl} alt="" width={56} height={56} unoptimized className="h-full w-full object-cover" /> : "Service"}</div>
                            <div className="flex min-w-0 flex-col items-start gap-1"><label className="cursor-pointer text-xs text-neutral-300 underline underline-offset-4 hover:text-white">{uploading ? "Uploading…" : draft.thumbnailPath ? "Replace" : "Upload"}<input type="file" accept="image/*" disabled={uploading || pending} onChange={(event) => { void uploadThumbnail(event.target.files?.[0] ?? null); event.currentTarget.value = "" }} className="sr-only" /></label>{draft.thumbnailPath ? <button type="button" onClick={() => setDraft((current) => ({ ...current, thumbnailPath: null, thumbnailUrl: null }))} className="text-xs text-neutral-600 hover:text-white">Remove</button> : null}</div>
                        </div>
                    </div>
                </div>

                <div className="mt-5 rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 sm:p-4">
                    <p className="text-sm font-medium text-neutral-200">{draft.serviceType === "retainer" ? "Upfront charge" : "Service details"}</p>
                    <p className="mt-1 text-xs leading-5 text-neutral-600">The name and description below are used directly on Stripe Checkout.</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
                        <label className="text-xs text-neutral-500">{draft.serviceType === "retainer" ? "Upfront name" : "Name"}<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required maxLength={120} className={inputClass} /></label>
                        <label className="text-xs text-neutral-500">{draft.serviceType === "retainer" ? "Upfront price" : "Price"}<div className="mt-1.5 flex"><span className="inline-flex h-10 items-center rounded-l-lg border border-r-0 border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-500">{draft.currency}</span><input value={upfrontPrice} onChange={(event) => setUpfrontPrice(event.target.value)} onBlur={() => setUpfrontPrice((parsedUpfrontPriceCents / 100).toFixed(2))} type="number" min="0" step="0.01" className="h-10 min-w-0 flex-1 rounded-r-lg border border-neutral-700 bg-black px-2 text-sm text-white outline-none focus:border-neutral-500" /></div></label>
                        <label className="text-xs text-neutral-500 sm:col-span-2">{draft.serviceType === "retainer" ? "Upfront description" : "Description"} <span className="text-neutral-700">(optional)</span><textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={2} maxLength={4000} className={textareaClass} /></label>
                    </div>
                </div>

                {draft.serviceType === "retainer" ? <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 sm:p-4">
                    <p className="text-sm font-medium text-neutral-200">Recurring charge</p>
                    <p className="mt-1 text-xs leading-5 text-neutral-600">Used for the subscription line item and as the default schedule in the POS.</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
                        <label className="text-xs text-neutral-500">Recurring name<input value={draft.recurringName} onChange={(event) => setDraft({ ...draft, recurringName: event.target.value })} required maxLength={120} className={inputClass} /></label>
                        <label className="text-xs text-neutral-500">Recurring price<div className="mt-1.5 flex"><span className="inline-flex h-10 items-center rounded-l-lg border border-r-0 border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-500">{draft.currency}</span><input value={recurringPrice} onChange={(event) => setRecurringPrice(event.target.value)} onBlur={() => setRecurringPrice((parsedRecurringPriceCents / 100).toFixed(2))} type="number" min="0.01" step="0.01" className="h-10 min-w-0 flex-1 rounded-r-lg border border-neutral-700 bg-black px-2 text-sm text-white outline-none focus:border-neutral-500" /></div></label>
                        <label className="text-xs text-neutral-500 sm:col-span-2">Recurring description <span className="text-neutral-700">(optional)</span><textarea value={draft.recurringDescription} onChange={(event) => setDraft({ ...draft, recurringDescription: event.target.value })} rows={2} maxLength={4000} className={textareaClass} /></label>
                        <div className="flex gap-2 sm:col-span-2"><label className="text-xs text-neutral-500">Repeat every<input value={draft.defaultBillingIntervalCount} onChange={(event) => setDraft({ ...draft, defaultBillingIntervalCount: Math.max(1, Math.min(intervalCountMaximum(draft.defaultBillingInterval), Math.round(Number(event.target.value) || 1))) })} type="number" min="1" max={intervalCountMaximum(draft.defaultBillingInterval)} className={`${inputClass} w-24`} /></label><label className="min-w-0 flex-1 text-xs text-neutral-500">Period<select value={draft.defaultBillingInterval} onChange={(event) => { const interval = event.target.value as OnboardingServiceDefinition["defaultBillingInterval"]; setDraft({ ...draft, defaultBillingInterval: interval, defaultBillingIntervalCount: Math.min(draft.defaultBillingIntervalCount, intervalCountMaximum(interval)) }) }} className={inputClass}><option value="week">Week(s)</option><option value="month">Month(s)</option><option value="year">Year(s)</option></select></label></div>
                    </div>
                </div> : null}

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <label className="text-xs text-neutral-500">Currency<input value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value.toUpperCase().slice(0, 3) })} maxLength={3} className={`${inputClass} uppercase`} /></label>
                    <label className="text-xs text-neutral-500">Default assignee<select value={draft.defaultAssigneeId ?? ""} onChange={(event) => setDraft({ ...draft, defaultAssigneeId: event.target.value || null })} className={inputClass}><option value="">Unassigned</option>{assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}</select></label>
                    <label className="text-xs text-neutral-500">Display priority<input value={draft.displayPriority} onChange={(event) => setDraft({ ...draft, displayPriority: Math.max(0, Math.round(Number(event.target.value) || 0)) })} type="number" min="0" className={inputClass} /><span className="mt-1 block text-[11px] text-neutral-700">Higher numbers compose earlier in onboarding.</span></label>
                    <label className="mt-auto flex h-10 items-center gap-2 rounded-lg border border-neutral-800 bg-black px-3 text-sm text-neutral-300"><input type="checkbox" checked={draft.isTest} onChange={(event) => setDraft({ ...draft, isTest: event.target.checked })} className="h-4 w-4 accent-white" />Test service</label>
                </div>

                {error ? <p role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
                {service.archiveBlockers.length ? <div className="mt-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-100"><p className="font-medium">Archive unavailable</p><ul className="mt-1 list-disc pl-5 text-xs leading-5">{service.archiveBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div> : null}
            </div>

            <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-neutral-800 bg-neutral-950 px-4 py-3 sm:px-6">
                {service.id && service.state === "active" ? <button type="button" disabled={pending || dirty} onClick={() => changeState("retired")} className="h-9 px-2 text-sm text-neutral-400 hover:text-white disabled:opacity-30">Retire</button> : null}
                {service.id && service.state === "retired" ? <button type="button" disabled={pending || dirty || Boolean(service.archiveBlockers.length)} onClick={() => changeState("archived")} className="h-9 px-2 text-sm text-red-300 hover:text-red-200 disabled:opacity-30">Archive</button> : null}
                {service.id && service.state === "archived" ? <button type="button" disabled={pending} onClick={() => changeState("retired")} className="h-9 px-2 text-sm text-neutral-300 hover:text-white disabled:opacity-30">Restore as Retired</button> : null}
                <button type="button" onClick={onClose} className="ml-auto h-9 px-3 text-sm text-neutral-400 hover:text-white">Cancel</button>
                <button type="button" disabled={saveDisabled} onClick={save} className="h-9 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-40">{pending ? "Saving…" : !service.id ? "Create service" : service.state === "retired" ? "Save and reactivate" : "Save new revision"}</button>
            </footer>
        </section>
    </div>
}

export function ServiceCatalogue({ workspaceSlug, services, assignees, schemaReady, initialServiceId }: {
    workspaceSlug: string
    services: OnboardingServiceDefinition[]
    modules: OnboardingModuleSummary[]
    assignees: OnboardingAssigneeOption[]
    schemaReady: boolean
    initialServiceId?: string | null
}) {
    const [selectedId, setSelectedId] = useState<string | null>(initialServiceId && initialServiceId !== "new" ? initialServiceId : null)
    const [templatesOpen, setTemplatesOpen] = useState(false)
    const selected = selectedId === "new" ? blankService() : services.find((service) => service.id === selectedId) ?? null
    const assigneeById = useMemo(() => new Map(assignees.map((assignee) => [assignee.id, assignee])), [assignees])
    const portalTarget = typeof window !== "undefined" ? (window.parent !== window ? window.parent.document.body : document.body) : null

    return <>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
                <h2 className="text-xl font-semibold tracking-tight text-white">Services</h2>
                <p className="mt-1 text-sm leading-6 text-neutral-400">Manage the services your agency offers and the default prices used when preparing client work.</p>
            </div>
            <button type="button" onClick={() => setTemplatesOpen(true)} className="inline-flex h-10 w-full shrink-0 items-center justify-center rounded-lg bg-white px-4 text-sm font-medium text-black transition hover:bg-neutral-200 sm:w-auto">New service</button>
        </div>

        {!schemaReady ? <p className="mt-5 rounded-lg border border-yellow-500/20 bg-yellow-500/[0.06] px-4 py-3 text-xs text-yellow-200">Showing compatible hard-coded definitions while the editable catalogue schema is applied.</p> : null}

        <List ariaLabel="Services" className={!schemaReady ? "mt-3" : ""}>
            {services.map((service) => {
                const status = serviceStatus(service.state)
                const assignee = service.defaultAssigneeId ? assigneeById.get(service.defaultAssigneeId) : null
                const href = `?service=${encodeURIComponent(service.id)}#services`
                const actions = [{ label: "Edit service", href }]
                const description = service.description || (service.serviceType === "retainer" ? service.recurringName : "No description")
                return <ListItem key={service.id}>
                    <MobileListActionSurface actions={actions} label={`Open actions for ${service.name}`}>
                        <ListPrimaryRow>
                            <ListTitle href={href} className="flex-1">{service.name}</ListTitle>
                            {service.serviceType === "retainer" ? <SquarePill tone="sky">Retainer</SquarePill> : null}
                            {service.isTest ? <SquarePill tone="yellow">Test</SquarePill> : null}
                            <Status label={status.label} tone={status.tone} className="ml-auto shrink-0" />
                        </ListPrimaryRow>
                        <ListSecondaryRow>
                            <span className="min-w-0 flex-1 truncate tabular-nums text-neutral-300">
                                {priceLabel(service.defaultUpfrontPriceCents, service.currency)}{service.serviceType === "retainer" ? " upfront" : " one-time"}
                            </span>
                            {service.serviceType === "retainer" ? <span className="hidden shrink-0 tabular-nums text-neutral-500 sm:inline">{priceLabel(service.defaultRecurringPriceCents, service.currency)} {intervalLabel(service)}</span> : null}
                            <span className="hidden min-w-0 flex-1 truncate text-neutral-500 xl:inline">{description}</span>
                            {assignee
                                ? <span className="hidden shrink-0 md:inline-flex"><Assignee userId={assignee.id} name={assignee.name} avatarSrc={assignee.avatarSrc} /></span>
                                : <span className="hidden shrink-0 text-neutral-500 md:inline">Unassigned</span>}
                            <ListTrailing>
                                <span className="font-mono text-neutral-500">{shortId(service.id)}</span>
                                <ListActionMenu actions={actions} label={`Open actions for ${service.name}`} className="hidden sm:block" />
                            </ListTrailing>
                        </ListSecondaryRow>
                    </MobileListActionSurface>
                </ListItem>
            })}
            {!services.length ? <div className="p-6"><p className="font-medium">No services yet.</p><p className="mt-2 text-sm text-neutral-500">Create the first service to make it available in the POS.</p></div> : null}
        </List>
        {templatesOpen && portalTarget ? createPortal(<ServiceTemplatesModal onClose={() => setTemplatesOpen(false)} onCreateCustom={() => { setTemplatesOpen(false); setSelectedId("new") }} />, portalTarget) : null}
        {selected && portalTarget ? createPortal(<ServiceEditor key={selected.id || "new"} workspaceSlug={workspaceSlug} service={selected} assignees={assignees} schemaReady={schemaReady} onClose={() => setSelectedId(null)} />, portalTarget) : null}
    </>
}
