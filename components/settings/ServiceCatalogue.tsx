"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { saveOnboardingService, setOnboardingServiceState } from "@/app/[workspaceSlug]/settings/service-actions"
import { SortableAuthoringList } from "@/components/onboarding-builder/SortableAuthoringList"
import { Assignee, RoundPill, SquarePill, Status, type StatusTone } from "@/components/ui"
import type { OnboardingAssigneeOption, OnboardingModuleSummary, OnboardingServiceDefinition, OnboardingServiceState } from "@/lib/onboarding/configuration-types"

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
        state: "active",
        version: 0,
        isTest: false,
        defaultPriceCents: 0,
        currency: "USD",
        defaultAssigneeId: null,
        displayPriority: 100,
        modules: [],
        archiveBlockers: [],
        lastEditedAt: null,
    }
}

function ServiceEditor({ workspaceSlug, service, modules, assignees, schemaReady, onClose }: {
    workspaceSlug: string
    service: OnboardingServiceDefinition
    modules: OnboardingModuleSummary[]
    assignees: OnboardingAssigneeOption[]
    schemaReady: boolean
    onClose: () => void
}) {
    const router = useRouter()
    const [draft, setDraft] = useState(service)
    const [price, setPrice] = useState((service.defaultPriceCents / 100).toFixed(2))
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const [mobileDialog, setMobileDialog] = useState(false)
    const editorRef = useRef<HTMLElement>(null)
    const closeRef = useRef<HTMLButtonElement>(null)
    const assignedIds = new Set(draft.modules.map((module) => module.moduleId))
    const availableModules = modules.filter((module) => module.status === "published" && !assignedIds.has(module.id))
    const parsedPriceCents = Math.max(0, Math.round((Number(price) || 0) * 100))
    const effectiveDraft = { ...draft, defaultPriceCents: parsedPriceCents }
    const dirty = JSON.stringify(effectiveDraft) !== JSON.stringify(service)

    useEffect(() => {
        const media = window.matchMedia("(max-width: 1023px)")
        const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const updateMode = () => setMobileDialog(media.matches)
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault()
                onClose()
                return
            }
            if (event.key !== "Tab" || !media.matches || !editorRef.current) return
            const focusable = [...editorRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]')]
            if (!focusable.length) return
            const first = focusable[0]
            const last = focusable.at(-1)!
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
        }
        updateMode()
        media.addEventListener("change", updateMode)
        document.addEventListener("keydown", handleKey)
        if (media.matches) closeRef.current?.focus()
        return () => {
            media.removeEventListener("change", updateMode)
            document.removeEventListener("keydown", handleKey)
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

    return <aside ref={editorRef} role={mobileDialog ? "dialog" : undefined} aria-modal={mobileDialog ? true : undefined} aria-labelledby="service-editor-title" aria-label={service.id ? `Edit ${service.name}` : "Create service"} className="fixed inset-x-0 bottom-0 top-0 z-[80] flex min-h-0 flex-col border-neutral-700 bg-neutral-950 shadow-2xl shadow-black/60 lg:sticky lg:top-5 lg:z-0 lg:max-h-[calc(100dvh-2.5rem)] lg:rounded-2xl lg:border">
        <div className="flex items-start gap-4 border-b border-neutral-800 px-4 py-4 sm:px-5">
            <div className="min-w-0 flex-1"><h3 id="service-editor-title" className="truncate text-lg font-semibold">{service.id ? service.name : "New service"}</h3><p className="mt-1 text-xs text-neutral-500">{service.id ? `Revision ${service.version} · ${service.code}` : "A permanent internal code is generated on first save."}</p></div>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close service editor" className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-xl text-neutral-500 hover:bg-neutral-900 hover:text-white">×</button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
            {!schemaReady ? <p className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-100">The editable catalogue schema is not available yet. Existing services remain visible but read-only.</p> : null}
            <label className="block text-sm text-neutral-300">Service name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required maxLength={120} className="mt-2 h-11 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white" /></label>
            <label className="block text-sm text-neutral-300">Description <span className="text-neutral-600">(optional)</span><textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={4} className="mt-2 w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-white" /></label>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                <label className="block text-sm text-neutral-300">Default price<div className="mt-2 flex"><span className="inline-flex h-11 items-center rounded-l-lg border border-r-0 border-neutral-700 bg-neutral-900 px-3 text-sm text-neutral-500">{draft.currency}</span><input value={price} onChange={(event) => setPrice(event.target.value)} onBlur={() => { if (price.trim()) setPrice((parsedPriceCents / 100).toFixed(2)) }} type="number" min="0" step="0.01" className="h-11 min-w-0 flex-1 rounded-r-lg border border-neutral-700 bg-black px-3 text-white" /></div></label>
                <label className="block text-sm text-neutral-300">Currency<input value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value.toUpperCase().slice(0, 3) })} maxLength={3} className="mt-2 h-11 w-full rounded-lg border border-neutral-700 bg-black px-3 uppercase text-white" /></label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm text-neutral-300">Default assignee<select value={draft.defaultAssigneeId ?? ""} onChange={(event) => setDraft({ ...draft, defaultAssigneeId: event.target.value || null })} className="mt-2 h-11 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white"><option value="">Unassigned</option>{assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}</select></label>
                <label className="block text-sm text-neutral-300">Display priority<input value={draft.displayPriority} onChange={(event) => setDraft({ ...draft, displayPriority: Math.max(0, Math.round(Number(event.target.value) || 0)) })} type="number" min="0" aria-describedby="service-priority-help" className="mt-2 h-11 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white" /><span id="service-priority-help" className="mt-1 block text-xs leading-5 text-neutral-600">Higher numbers compose earlier in onboarding.</span></label>
            </div>
            <label className="flex min-h-11 items-center gap-3 rounded-lg border border-neutral-800 bg-black px-3 text-sm text-neutral-300"><input type="checkbox" checked={draft.isTest} onChange={(event) => setDraft({ ...draft, isTest: event.target.checked })} className="h-4 w-4 accent-white" />Mark this service as Test</label>
            <section>
                <div className="flex items-end justify-between gap-3"><div><h4 className="font-medium">Onboarding modules</h4><p className="mt-1 text-xs leading-5 text-neutral-500">Drag to set the order used after mandatory modules.</p></div>{availableModules.length ? <select aria-label="Add module" defaultValue="" onChange={(event) => { const moduleDefinition = modules.find((item) => item.id === event.target.value); if (moduleDefinition) setDraft({ ...draft, modules: [...draft.modules, { moduleId: moduleDefinition.id, moduleCode: moduleDefinition.code, moduleName: moduleDefinition.name, sortOrder: draft.modules.length }] }); event.currentTarget.value = "" }} className="h-10 rounded-lg border border-neutral-700 bg-black px-2 text-sm text-white"><option value="" disabled>Add module…</option>{availableModules.map((moduleDefinition) => <option key={moduleDefinition.id} value={moduleDefinition.id}>{moduleDefinition.name}</option>)}</select> : null}</div>
                <div className="mt-3">
                    {draft.modules.length ? <SortableAuthoringList items={draft.modules.map((item, index) => ({ ...item, id: item.moduleId, sortOrder: index }))} onChange={(items) => setDraft({ ...draft, modules: items.map((item, index) => ({ moduleId: item.moduleId, moduleCode: item.moduleCode, moduleName: item.moduleName, sortOrder: index })) })} ariaLabel="Service onboarding module order" renderItem={(module, _index, handle) => <div className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-black px-2 py-1.5">{handle}<span className="min-w-0 flex-1 truncate text-sm text-neutral-200">{module.moduleName}</span><button type="button" onClick={() => setDraft({ ...draft, modules: draft.modules.filter((item) => item.moduleId !== module.moduleId) })} className="h-9 px-2 text-xs text-neutral-500 hover:text-red-300">Remove</button></div>} /> : <p className="rounded-lg border border-dashed border-neutral-800 px-3 py-5 text-center text-sm text-neutral-600">No onboarding modules assigned.</p>}
                </div>
            </section>
            {error ? <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
            {service.archiveBlockers.length ? <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-100"><p className="font-medium">Archive unavailable</p><ul className="mt-1 list-disc pl-5 text-xs leading-5">{service.archiveBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-800 bg-neutral-950 px-4 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:px-5">
            {service.id && service.state === "active" ? <button type="button" disabled={pending || dirty} onClick={() => changeState("retired")} className="h-10 px-2 text-sm text-neutral-400 hover:text-white disabled:opacity-30">Retire</button> : null}
            {service.id && service.state === "retired" ? <button type="button" disabled={pending || dirty || Boolean(service.archiveBlockers.length)} onClick={() => changeState("archived")} className="h-10 px-2 text-sm text-red-300 hover:text-red-200 disabled:opacity-30">Archive</button> : null}
            {service.id && service.state === "archived" ? <button type="button" disabled={pending} onClick={() => changeState("retired")} className="h-10 px-2 text-sm text-neutral-300 hover:text-white disabled:opacity-30">Restore as Retired</button> : null}
            <button type="button" disabled={pending || !schemaReady || (service.state === "archived") || (service.state === "active" && !dirty && Boolean(service.id))} onClick={save} className="ml-auto h-10 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-40">{pending ? "Saving…" : !service.id ? "Create service" : service.state === "retired" ? "Save revision and reactivate" : service.state === "archived" ? "Restore before editing" : "Save new revision"}</button>
        </div>
    </aside>
}

export function ServiceCatalogue({ workspaceSlug, services, modules, assignees, schemaReady, initialServiceId }: {
    workspaceSlug: string
    services: OnboardingServiceDefinition[]
    modules: OnboardingModuleSummary[]
    assignees: OnboardingAssigneeOption[]
    schemaReady: boolean
    initialServiceId?: string | null
}) {
    const [selectedId, setSelectedId] = useState<string | null>(initialServiceId ?? null)
    const selected = selectedId === "new" ? blankService() : services.find((service) => service.id === selectedId) ?? null
    const assigneeById = useMemo(() => new Map(assignees.map((assignee) => [assignee.id, assignee])), [assignees])

    return <div className={`relative grid min-w-0 gap-4 ${selected ? "lg:grid-cols-[minmax(0,1fr)_minmax(21rem,26rem)]" : ""}`}>
        <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
            <div className="flex items-start justify-between gap-4 border-b border-neutral-800 p-4 sm:p-5"><div><h3 className="font-semibold">Service catalogue</h3><p className="mt-1 text-sm leading-6 text-neutral-500">Prices are defaults. A relationship keeps its negotiated snapshot when the invoice is sent.</p></div><button type="button" onClick={() => setSelectedId("new")} className="shrink-0 rounded-lg bg-white px-3 py-2 text-sm font-medium text-black">New service</button></div>
            {!schemaReady ? <p className="border-b border-yellow-500/20 bg-yellow-500/[0.06] px-4 py-3 text-xs text-yellow-200 sm:px-5">Showing compatible hard-coded definitions while the editable catalogue schema is applied.</p> : null}
            <div className="divide-y divide-neutral-800">
                {services.map((service) => {
                    const status = serviceStatus(service.state)
                    const assignee = service.defaultAssigneeId ? assigneeById.get(service.defaultAssigneeId) : null
                    return <button key={service.id} type="button" onClick={() => setSelectedId(service.id)} className="block w-full bg-black/35 px-4 py-3 text-left transition hover:bg-neutral-800/70 sm:px-5">
                        <span className="flex min-w-0 items-center gap-2"><span className="min-w-0 flex-1 truncate font-medium text-white">{service.name}</span>{service.isTest ? <SquarePill tone="yellow">Test</SquarePill> : null}<Status label={status.label} tone={status.tone} className="ml-auto shrink-0" /></span>
                        <span className="mt-2 flex min-w-0 items-center gap-2 text-xs text-neutral-500"><span className="shrink-0 tabular-nums">{new Intl.NumberFormat("en-US", { style: "currency", currency: service.currency }).format(service.defaultPriceCents / 100)}</span><span className="truncate">Priority {service.displayPriority}</span><span className="hidden min-w-0 flex-1 gap-1 overflow-hidden sm:flex">{service.modules.slice(0, 3).map((module) => <RoundPill key={module.moduleId}>{module.moduleName}</RoundPill>)}{service.modules.length > 3 ? <span className="self-center">+{service.modules.length - 3}</span> : null}</span>{assignee ? <Assignee name={assignee.name} avatarSrc={assignee.avatarSrc} compact compactSize="md" className="ml-auto" /> : <span className="ml-auto shrink-0">Unassigned</span>}</span>
                    </button>
                })}
                {!services.length ? <div className="p-6"><p className="font-medium">No services yet.</p><p className="mt-2 text-sm text-neutral-500">Create the first catalogue service and assign its onboarding modules.</p></div> : null}
            </div>
        </section>
        {selected ? <ServiceEditor key={selected.id || "new"} workspaceSlug={workspaceSlug} service={selected} modules={modules} assignees={assignees} schemaReady={schemaReady} onClose={() => setSelectedId(null)} /> : null}
    </div>
}
